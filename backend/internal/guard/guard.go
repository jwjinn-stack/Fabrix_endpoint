// Package guard 는 Semantic Router(HTTP classify API)로 추론 프롬프트를
// PII/Jailbreak 판정하고, 증권사 컴플라이언스 정책에 따라 차단/표시/통과를 결정한다.
//
// 모든 추론 요청이 우리 레이어를 통과하므로 여기서 가드레일을 강제하고(SSOT R9),
// 판정 결과는 증적(audit) 으로 적재된다. SR 이 약한 한국어 PII 는 정규식으로 1차 보강한다.
//
// SR HTTP API (실측):
//   POST /api/v1/classify/pii      → {has_pii, entities[{type,value,confidence}], security_recommendation}
//   POST /api/v1/classify/security → {is_jailbreak, risk_score, recommendation, patterns_detected, confidence}
//   POST /api/v1/classify/intent   → {classification{category,confidence}, routing_decision}
package guard

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// Client 는 Semantic Router classify API 클라이언트 + 정책 평가기.
type Client struct {
	base      string // 예: http://semantic-router.vllm-semantic-router-system:8080 (dev: http://localhost:18080)
	http      *http.Client
	policyVer string
	enabled   bool
	mu        sync.RWMutex
	policy    domain.GuardPolicy
}

// New 는 SR 베이스 URL로 가드레일 클라이언트를 만든다. base 가 비면 비활성(통과).
func New(base, policyVer string) *Client {
	if policyVer == "" {
		policyVer = "v1"
	}
	return &Client{
		base:      strings.TrimRight(base, "/"),
		http:      &http.Client{Timeout: 5 * time.Second},
		policyVer: policyVer,
		enabled:   base != "",
		policy:    domain.DefaultPolicy(),
	}
}

// Enabled 는 가드레일 강제 여부.
func (c *Client) Enabled() bool { return c.enabled }

// PolicyVersion 은 현재 정책 버전.
func (c *Client) PolicyVersion() string { return c.policyVer }

// Policy 는 현재 정책을 반환한다(#12).
func (c *Client) Policy() domain.GuardPolicy {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.policy
}

// SetPolicy 는 정책을 교체한다(#12 토글 UI). action 검증.
func (c *Client) SetPolicy(p domain.GuardPolicy) {
	norm := func(r domain.PolicyRule) domain.PolicyRule {
		if r.Action != "flag" {
			r.Action = "block"
		}
		return r
	}
	c.mu.Lock()
	c.policy = domain.GuardPolicy{PII: norm(p.PII), Jailbreak: norm(p.Jailbreak), Secrets: norm(p.Secrets)}
	c.mu.Unlock()
}

// secretRules — 시크릿/크리덴셜 탐지(PII 외 다축). 프롬프트에 키·토큰 유출 차단.
var secretRules = []struct {
	name string
	re   *regexp.Regexp
}{
	{"aws_key", regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`)},
	{"private_key", regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----`)},
	{"bearer", regexp.MustCompile(`(?i)\bbearer\s+[A-Za-z0-9._\-]{20,}`)},
	{"generic_secret", regexp.MustCompile(`(?i)(api[_-]?key|secret|access[_-]?token|password)\s*[:=]\s*['"]?[A-Za-z0-9._\-]{12,}`)},
	{"fabrix_key", regexp.MustCompile(`\bfbx_[0-9a-f]{16,}\b`)},
}

func detectSecrets(text string) []string {
	var out []string
	seen := map[string]bool{}
	for _, r := range secretRules {
		if r.re.MatchString(text) && !seen[r.name] {
			seen[r.name] = true
			out = append(out, r.name)
		}
	}
	return out
}

// ── SR 응답 구조 ──

type piiResp struct {
	HasPII   bool `json:"has_pii"`
	Entities []struct {
		Type       string  `json:"type"`
		Confidence float64 `json:"confidence"`
	} `json:"entities"`
	SecurityRecommendation string `json:"security_recommendation"`
}

type securityResp struct {
	IsJailbreak      bool     `json:"is_jailbreak"`
	RiskScore        float64  `json:"risk_score"`
	Confidence       float64  `json:"confidence"`
	Recommendation   string   `json:"recommendation"`
	PatternsDetected []string `json:"patterns_detected"`
}

type intentResp struct {
	Classification struct {
		Category   string  `json:"category"`
		Confidence float64 `json:"confidence"`
	} `json:"classification"`
}

func (c *Client) post(ctx context.Context, path, text string, out any) error {
	body, _ := json.Marshal(map[string]string{"text": text})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(out)
}

// ── 한국어 PII 정규식 (1차 보강 — SR ModernBERT 는 한국어 PII 약함) ──
// #10(한국어 PII 룰 보강)에서 ModernBERT 2차/탐지율 PoC 로 확장.
// 한국어 PII 정규식 카탈로그(#10 보강). 증권사 민감정보 중심, 오탐 최소화 위해 경계/형식 고정.
var krRules = []struct {
	name string
	re   *regexp.Regexp
}{
	{"rrn_kr", regexp.MustCompile(`\b\d{6}[-\s]?[1-8]\d{6}\b`)},                       // 주민등록번호(내국 1-4·외국 5-8)
	{"passport_kr", regexp.MustCompile(`\b[MSRODGmsrodg]\d{8}\b`)},                    // 여권번호
	{"driver_kr", regexp.MustCompile(`\b\d{2}[-\s]?\d{2}[-\s]?\d{6}[-\s]?\d{2}\b`)},   // 운전면허번호
	{"biznum_kr", regexp.MustCompile(`\b\d{3}-\d{2}-\d{5}\b`)},                        // 사업자등록번호
	{"corpnum_kr", regexp.MustCompile(`\b\d{6}-\d{7}\b`)},                             // 법인등록번호
	{"card_kr", regexp.MustCompile(`\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b`)},     // 카드번호(16자리)
	{"phone_kr", regexp.MustCompile(`\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b`)},        // 휴대폰
	{"account_kr", regexp.MustCompile(`\b\d{2,6}-\d{2,6}-\d{2,7}\b`)},                 // 계좌번호(loose)
	{"email", regexp.MustCompile(`\b[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}\b`)},            // 이메일
}

func koreanPII(text string) []domain.PIIEntity {
	var out []domain.PIIEntity
	seen := map[string]bool{}
	for _, r := range krRules {
		if r.re.MatchString(text) && !seen[r.name] {
			seen[r.name] = true
			out = append(out, domain.PIIEntity{Type: r.name, Confidence: 0.99})
		}
	}
	return out
}

// Classify 는 텍스트를 PII/Jailbreak/Intent 로 분류하고 정책 판정을 반환한다.
// SR 미설정/도달 실패 시 한국어 정규식만으로 판정(graceful degradation).
func (c *Client) Classify(ctx context.Context, text string) domain.GuardVerdict {
	start := time.Now()
	v := domain.GuardVerdict{
		Decision:   domain.DecisionAllow,
		GuardTypes: []string{},
		PolicyVer:  c.policyVer,
	}
	if !c.enabled {
		v.LatencyMs = time.Since(start).Milliseconds()
		return v
	}

	guardTypes := map[string]bool{}

	// SR PII
	var pr piiResp
	if err := c.post(ctx, "/api/v1/classify/pii", text, &pr); err == nil {
		if pr.HasPII {
			guardTypes["pii"] = true
			for _, e := range pr.Entities {
				v.PIIEntities = append(v.PIIEntities, domain.PIIEntity{Type: e.Type, Confidence: round2(e.Confidence)})
			}
		}
	}

	// 한국어 정규식 보강 (SR 누락분)
	for _, e := range koreanPII(text) {
		guardTypes["pii"] = true
		v.PIIEntities = append(v.PIIEntities, e)
	}

	// SR Security(jailbreak)
	var sr securityResp
	if err := c.post(ctx, "/api/v1/classify/security", text, &sr); err == nil {
		if sr.IsJailbreak {
			guardTypes["jailbreak"] = true
			v.JBConfidence = round2(sr.Confidence)
		}
	}

	// 시크릿/크리덴셜 탐지(PII 외 다축, #12)
	secrets := detectSecrets(text)
	if len(secrets) > 0 {
		guardTypes["secrets"] = true
	}

	// SR Intent(분류 — 라우팅 카테고리)
	var ir intentResp
	if err := c.post(ctx, "/api/v1/classify/intent", text, &ir); err == nil {
		v.Category = ir.Classification.Category
	}

	// 정책 평가(#12 토글/액션). 각 탐지 축에 정책 규칙(enabled+action) 적용.
	pol := c.Policy()
	rules := map[string]domain.PolicyRule{"pii": pol.PII, "jailbreak": pol.Jailbreak, "secrets": pol.Secrets}
	reasons := map[string]string{
		"jailbreak": "탈옥(jailbreak) 시도가 감지되어 요청이 차단되었습니다.",
		"pii":       "개인식별정보(PII)가 포함되어 요청이 차단되었습니다. 민감정보를 제거 후 다시 시도하세요.",
		"secrets":   "비밀정보(API 키/토큰 등)가 포함되어 요청이 차단되었습니다.",
	}
	v.GuardTypes = []string{} // JSON null 방지
	decision := domain.DecisionAllow
	for _, t := range []string{"jailbreak", "pii", "secrets"} {
		if !guardTypes[t] {
			continue
		}
		rule, ok := rules[t]
		if !ok || !rule.Enabled {
			continue // 정책 꺼짐 → 미적용(통과)
		}
		v.GuardTypes = append(v.GuardTypes, t)
		if rule.Action == "block" {
			if decision != domain.DecisionBlocked {
				v.Reason = reasons[t]
			}
			decision = domain.DecisionBlocked
		} else if decision == domain.DecisionAllow {
			decision = domain.DecisionFlagged
		}
	}
	v.Decision = decision

	v.LatencyMs = time.Since(start).Milliseconds()
	return v
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}
