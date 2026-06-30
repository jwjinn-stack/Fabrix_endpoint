// Package config 는 환경변수에서 서버 설정을 읽는다.
// 실제 데이터 소스(Prometheus/ClickHouse) 연동 시 여기에 엔드포인트 설정이 추가된다.
package config

import (
	"os"
	"strconv"
	"strings"
)

// Config 는 FABRIX Endpoint API 서버 런타임 설정.
type Config struct {
	// Profile 은 배포 프로파일. "manage"(기본, 풀버전) | "observe"(읽기 전용 관제, 예: 삼성증권).
	// 동일 바이너리를 env 만으로 두 제품처럼 배포한다. capability.Resolve 로 기능 집합 산출.
	Profile string
	// Features 는 프로파일 기본값에 대한 cap 미세조정("+cap,-cap" 콤마 구분).
	// 예: observe 에 읽기 엔드포인트/키 화면 추가 → "+endpoints,+keys". 고객사별 조정용.
	Features string
	// Addr 은 HTTP 리슨 주소 (예: ":8080").
	Addr string
	// AllowedOrigins 는 CORS 허용 오리진 목록. 개발 시 Vite 데브서버.
	AllowedOrigins []string
	// DataSource 는 데이터 제공자 선택 ("mock" | "live"). MVP 는 mock.
	DataSource string
	// VMSelectURL 은 VictoriaMetrics(vmselect) Prometheus 쿼리 베이스 URL.
	// 예(인클러스터): http://vmselect-vm.observability:8481/select/0/prometheus
	// 예(로컬 dev):   http://192.168.160.75:30401/select/0/prometheus
	VMSelectURL string
	// GemmaUpstream 은 gemma4 Dynamo 프론트엔드 OpenAI 베이스 URL(플레이그라운드 프록시용).
	// dev(머신→NodePort): http://192.168.160.75:30812
	// 인클러스터: http://gemma4-31b-vllm-agg-frontend-nodeport.dynamo-inference:8000
	GemmaUpstream string
	// DatabaseURL 은 PostgreSQL(CNPG) 연결 문자열. 비면 키·앱 기능 비활성.
	// 인클러스터: postgres://fabrix:<pw>@fabrix-pg-rw.fabrix-endpoint:5432/fabrix
	// dev: port-forward 후 postgres://fabrix:<pw>@localhost:5432/fabrix
	DatabaseURL string
	// SRURL 은 Semantic Router HTTP classify API 베이스 URL. 비면 가드레일 비활성(통과).
	// 인클러스터: http://semantic-router.vllm-semantic-router-system:8080
	// dev: port-forward 후 http://localhost:18080
	SRURL string
	// ClickHouseURL 은 ClickHouse HTTP 인터페이스(creds 포함). 비면 증적 적재/조회 비활성.
	// 인클러스터: http://fabrix:<pw>@clickhouse.fabrix-endpoint:8123
	// dev: port-forward 후 http://fabrix:fabrix_dev@localhost:18123
	ClickHouseURL string
	// AuditSalt 는 user_ref 비식별 해시 솔트. (운영은 Secret 주입)
	AuditSalt string
	// PolicyVersion 은 가드레일 정책 버전(증적에 기록).
	PolicyVersion string
	// KubectlPath 는 엔드포인트(DynamoGraphDeployment CR) 조작용 kubectl 경로(dev). 비면 "kubectl".
	KubectlPath string
	// EndpointsNS 는 엔드포인트 생성 기본 네임스페이스.
	EndpointsNS string
	// WORMURL 은 MinIO/ObjectScale S3 엔드포인트(creds 포함). 비면 WORM 보존 비활성.
	// dev: http://fabrixadmin:fabrix_worm_dev@192.168.160.43:30903
	WORMURL string
	// WORMBucket 은 Object Lock 버킷명. WORMRetainDays 는 보존 기간(일).
	WORMBucket     string
	WORMRetainDays int
	// HarborURL 은 Harbor 레지스트리 API(creds 포함). 모델 저장소 조회/임포트.
	// dev: http://admin:<pw>@192.168.160.43:30834
	HarborURL string
	// Langfuse 정합 — 트레이스/세션/가드레일 원문. 비면 synthetic 폴백(서버 없이 동작).
	// 인클러스터: http://langfuse-web.langfuse.svc.cluster.local:3000
	LangfuseHost      string
	LangfusePublicKey string
	LangfuseSecretKey string

	// ── 셀프-reconfigure (A1) — 화면에서 연동 설정을 고치면 자기 ConfigMap 을 patch 하고
	// 자기 Deployment 를 rollout restart 해 새 설정으로 재기동한다(Stakater Reloader/GitOps 패턴).
	// 셋 다 채워지고 kubectl 이 동작할 때만 재구성 활성. 비면 화면은 읽기 전용 안내.
	SelfNamespace  string // env FABRIX_SELF_NAMESPACE  (자기 파드 네임스페이스)
	SelfDeployment string // env FABRIX_SELF_DEPLOYMENT (자기 Deployment 이름)
	SelfConfigMap  string // env FABRIX_SELF_CONFIGMAP  (envFrom 으로 읽는 ConfigMap 이름)

	// ── per-key 레이트리밋 (IMP-28). 키별 토큰버킷(httpx.RateLimit). 0 이면 비활성(통과).
	// profile-aware 기본값: observe(읽기 관제, 폴링 다수 → 넉넉) > manage. env 로 명시 오버라이드 가능.
	RateLimitRPS   float64 // env FABRIX_RATELIMIT_RPS   (초당 토큰 보충률, 키별)
	RateLimitBurst int     // env FABRIX_RATELIMIT_BURST (버킷 용량)
}

// Load 는 환경변수에서 설정을 읽고, 없으면 개발 친화적 기본값을 쓴다.
func Load() Config {
	profile := env("FABRIX_PROFILE", "manage")
	// profile-aware 레이트리밋 기본값: observe 는 폴링형 읽기 관제라 넉넉하게,
	// manage 는 변경 동작 포함이라 조금 더 보수적으로. env 가 있으면 명시 오버라이드.
	rlRPS, rlBurst := 20.0, 40
	if profile == "observe" {
		rlRPS, rlBurst = 40.0, 80
	}
	return Config{
		Profile:           profile,
		Features:          env("FABRIX_FEATURES", ""),
		Addr:              env("FABRIX_API_ADDR", ":8080"),
		AllowedOrigins:    splitCSV(env("FABRIX_ALLOWED_ORIGINS", "http://localhost:5173")),
		DataSource:        env("FABRIX_DATA_SOURCE", "mock"),
		VMSelectURL:       env("FABRIX_VMSELECT_URL", "http://vmselect-vm.observability:8481/select/0/prometheus"),
		GemmaUpstream:     env("FABRIX_GEMMA_UPSTREAM", "http://gemma4-31b-vllm-agg-frontend-nodeport.dynamo-inference:8000"),
		DatabaseURL:       env("FABRIX_DATABASE_URL", ""),
		SRURL:             env("FABRIX_SR_URL", ""),
		ClickHouseURL:     env("FABRIX_CLICKHOUSE_URL", ""),
		AuditSalt:         env("FABRIX_AUDIT_SALT", "fabrix-dev-salt"),
		PolicyVersion:     env("FABRIX_POLICY_VERSION", "v1"),
		KubectlPath:       env("FABRIX_KUBECTL", ""),
		EndpointsNS:       env("FABRIX_ENDPOINTS_NS", "dynamo-inference"),
		WORMURL:           env("FABRIX_WORM_URL", ""),
		WORMBucket:        env("FABRIX_WORM_BUCKET", "fabrix-worm"),
		WORMRetainDays:    envInt("FABRIX_WORM_RETAIN_DAYS", 365),
		HarborURL:         env("FABRIX_HARBOR_URL", ""),
		LangfuseHost:      env("FABRIX_LANGFUSE_HOST", ""),
		LangfusePublicKey: env("FABRIX_LANGFUSE_PUBLIC_KEY", ""),
		LangfuseSecretKey: env("FABRIX_LANGFUSE_SECRET_KEY", ""),

		SelfNamespace:  env("FABRIX_SELF_NAMESPACE", ""),
		SelfDeployment: env("FABRIX_SELF_DEPLOYMENT", ""),
		SelfConfigMap:  env("FABRIX_SELF_CONFIGMAP", ""),

		RateLimitRPS:   envFloat("FABRIX_RATELIMIT_RPS", rlRPS),
		RateLimitBurst: envInt("FABRIX_RATELIMIT_BURST", rlBurst),
	}
}

func envFloat(key string, def float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
