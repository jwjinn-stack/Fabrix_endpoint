package server

import (
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// 셀프-reconfigure (A1) — 화면에서 연동 설정을 고치면 자기 ConfigMap 을 patch 하고
// 자기 Deployment 를 rollout restart 한다(Stakater Reloader/GitOps 패턴). 새 파드가
// readiness 를 통과해야 옛 파드가 교체되므로, 잘못된 설정을 저장해도 서비스는 안 죽는다.
//
// 편집 대상은 ConfigMap 백킹의 **비밀 아닌** 연동 설정(URL/host/port/프로파일)만이다.
// 비밀(creds)은 자격증명 화면/외부 Secret 으로 분리(편집 RBAC 최소화).

// cfgField 는 편집 가능한 설정 1개(현재값 + 형식 + 린트 경고).
type cfgField struct {
	Key      string   `json:"key"`
	EnvKey   string   `json:"env_key"`
	Label    string   `json:"label"`
	Value    string   `json:"value"`
	Kind     string   `json:"kind"` // url | enum | text
	Options  []string `json:"options,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
}

// cfgView 는 GET /api/v1/config 응답.
type cfgView struct {
	Editable   bool       `json:"editable"`         // 재구성 가능(kubectl + self-identity)
	Reason     string     `json:"reason,omitempty"` // 불가 사유
	Namespace  string     `json:"namespace"`
	ConfigMap  string     `json:"config_map"`
	Deployment string     `json:"deployment"`
	Fields     []cfgField `json:"fields"`
}

// editableFields 는 편집 가능한 설정의 현재값(s.cfg)을 반환한다.
func (s *Server) editableFields() []cfgField {
	c := s.cfg
	return []cfgField{
		{Key: "data_source", EnvKey: "FABRIX_DATA_SOURCE", Label: "데이터 소스", Value: c.DataSource, Kind: "enum", Options: []string{"mock", "live"}},
		{Key: "vmselect_url", EnvKey: "FABRIX_VMSELECT_URL", Label: "메트릭 (VictoriaMetrics)", Value: c.VMSelectURL, Kind: "url"},
		{Key: "gemma_upstream", EnvKey: "FABRIX_GEMMA_UPSTREAM", Label: "추론 업스트림 (Dynamo)", Value: c.GemmaUpstream, Kind: "url"},
		{Key: "sr_url", EnvKey: "FABRIX_SR_URL", Label: "가드레일 (Semantic Router)", Value: c.SRURL, Kind: "url"},
		{Key: "langfuse_host", EnvKey: "FABRIX_LANGFUSE_HOST", Label: "트레이스 (Langfuse)", Value: c.LangfuseHost, Kind: "url"},
		{Key: "endpoints_ns", EnvKey: "FABRIX_ENDPOINTS_NS", Label: "엔드포인트 네임스페이스", Value: c.EndpointsNS, Kind: "text"},
	}
}

// reconfigurable 은 재구성 가능 여부와 불가 사유를 판정한다.
func (s *Server) reconfigurable() (bool, string) {
	if s.k8s == nil || !s.k8s.Enabled() {
		return false, "kubectl 미구성 — 설정은 읽기 전용(재구성 비활성)"
	}
	if s.cfg.SelfNamespace == "" || s.cfg.SelfDeployment == "" || s.cfg.SelfConfigMap == "" {
		return false, "self-identity 미설정 — FABRIX_SELF_NAMESPACE/DEPLOYMENT/CONFIGMAP 필요"
	}
	return true, ""
}

// lintField 는 설정 1개를 검증한다(Kiali validation 패턴). hardErr 가 있으면 저장 차단,
// warnings 는 안내만(저장 허용).
func lintField(f cfgField, dataSource string) (warnings []string, hardErr string) {
	v := strings.TrimSpace(f.Value)
	switch f.Kind {
	case "enum":
		for _, o := range f.Options {
			if o == v {
				return nil, ""
			}
		}
		return nil, "허용값: " + strings.Join(f.Options, ", ")
	case "url":
		if v == "" {
			return nil, "" // 빈 값 = 미구성(폴백 허용)
		}
		if strings.HasPrefix(v, "mock://") {
			if dataSource == "live" {
				warnings = append(warnings, "data_source=live 인데 mock:// 주소 — 실연동 안 됨")
			}
			return warnings, ""
		}
		u, err := url.Parse(v)
		if err != nil || u.Host == "" {
			return nil, "URL 형식 오류 — scheme://host[:port] 형태로"
		}
		if u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "postgres" {
			warnings = append(warnings, "scheme 확인 필요: "+u.Scheme)
		}
		host := u.Hostname()
		if !strings.Contains(host, ".") && net.ParseIP(host) == nil {
			warnings = append(warnings, "단일 라벨 호스트 — 다른 네임스페이스면 FQDN(host.ns.svc.cluster.local) 권장")
		}
	}
	return warnings, ""
}

// handleGetConfig 는 GET /api/v1/config — 편집 가능 설정 현재값 + 린트 경고 + 재구성 가능 여부.
func (s *Server) handleGetConfig(w http.ResponseWriter, _ *http.Request) {
	editable, reason := s.reconfigurable()
	fields := s.editableFields()
	for i := range fields {
		fields[i].Warnings, _ = lintField(fields[i], s.cfg.DataSource)
	}
	httpx.JSON(w, http.StatusOK, cfgView{
		Editable: editable, Reason: reason,
		Namespace: s.cfg.SelfNamespace, ConfigMap: s.cfg.SelfConfigMap, Deployment: s.cfg.SelfDeployment,
		Fields: fields,
	})
}

// handleSetConfig 는 PUT /api/v1/config — 검증 → ConfigMap patch → rollout restart(비동기 202).
// body: {"fields": {"sr_url": "http://...", ...}}.
func (s *Server) handleSetConfig(w http.ResponseWriter, r *http.Request) {
	editable, reason := s.reconfigurable()
	if !editable {
		httpx.Error(w, http.StatusConflict, reason)
		return
	}
	var req struct {
		Fields map[string]string `json:"fields"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Fields == nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 요청 본문(fields 맵 필요)")
		return
	}

	dataSource := s.cfg.DataSource
	if v, ok := req.Fields["data_source"]; ok {
		dataSource = v
	}
	defByKey := map[string]cfgField{}
	for _, f := range s.editableFields() {
		defByKey[f.Key] = f
	}

	patch := map[string]string{}
	fieldErrs := map[string]string{}
	changed := []string{}
	for k, v := range req.Fields {
		def, ok := defByKey[k]
		if !ok {
			fieldErrs[k] = "편집 불가 항목"
			continue
		}
		def.Value = v
		if _, hard := lintField(def, dataSource); hard != "" {
			fieldErrs[k] = hard
			continue
		}
		patch[def.EnvKey] = v
		changed = append(changed, def.EnvKey)
	}
	if len(fieldErrs) > 0 {
		httpx.JSON(w, http.StatusBadRequest, map[string]any{"error": "설정 검증 실패", "fields": fieldErrs})
		return
	}
	if len(patch) == 0 {
		httpx.Error(w, http.StatusBadRequest, "변경할 항목이 없습니다")
		return
	}

	ctx := r.Context()
	if err := s.k8s.PatchConfigMap(ctx, s.cfg.SelfNamespace, s.cfg.SelfConfigMap, patch); err != nil {
		httpx.Error(w, http.StatusBadGateway, "ConfigMap patch 실패: "+err.Error())
		return
	}
	if err := s.k8s.RolloutRestart(ctx, s.cfg.SelfNamespace, s.cfg.SelfDeployment); err != nil {
		httpx.Error(w, http.StatusBadGateway, "rollout restart 실패(ConfigMap 은 갱신됨): "+err.Error())
		return
	}
	httpx.JSON(w, http.StatusAccepted, map[string]any{
		"phase":   "reconfiguring",
		"message": "새 설정으로 재기동을 시작했습니다. /config/status 를 폴링하세요.",
		"changed": changed, // 변경된 env 키(값은 비노출)
	})
}

// handleConfigStatus 는 GET /api/v1/config/status — 롤아웃 진행 상태(화면 폴링).
func (s *Server) handleConfigStatus(w http.ResponseWriter, r *http.Request) {
	editable, reason := s.reconfigurable()
	if !editable {
		httpx.JSON(w, http.StatusOK, map[string]any{"phase": "idle", "message": reason})
		return
	}
	st, err := s.k8s.RolloutStatus(r.Context(), s.cfg.SelfNamespace, s.cfg.SelfDeployment)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, st)
}
