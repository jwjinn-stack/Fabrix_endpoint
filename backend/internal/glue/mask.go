package glue

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// PIIEntity 는 게이트웨이/SR 이 제공하는 정밀 PII 스팬(있으면 정규식보다 우선).
type PIIEntity struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// 내장 정규식 탐지기(한국어 PII). SR 이 엔티티를 주지 않을 때의 폴백.
// account/name/address 는 정규식이 불안정하므로 entity 경로로만 처리(정책 rule 은 둬도 무방).
var detectors = []struct {
	typ string
	re  *regexp.Regexp
}{
	{"rrn", regexp.MustCompile(`\d{6}[-\s]?[1-4]\d{6}`)},
	{"card", regexp.MustCompile(`\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}`)},
	{"phone", regexp.MustCompile(`01[016789][-\s]?\d{3,4}[-\s]?\d{4}`)},
	{"email", regexp.MustCompile(`[\w.+-]+@[\w-]+\.[\w.-]+`)},
}

// Masker 는 MaskingPolicy 를 프롬프트/응답 텍스트에 적용한다.
type Masker struct{ salt string }

// NewMasker 는 해시 솔트로 마스커를 만든다.
func NewMasker(salt string) *Masker { return &Masker{salt: salt} }

// Apply 는 캡처 모드에 따라 트레이스에 보존할 텍스트를 반환한다.
//   - none   → "" (호출측이 필드 생략)
//   - full   → 원문
//   - masked → 정책 규칙 적용(enabled=false 면 full 로 취급)
func (m *Masker) Apply(text string, mode domain.CaptureMode, p domain.MaskingPolicy, entities []PIIEntity) string {
	if text == "" {
		return ""
	}
	switch mode {
	case domain.CaptureNone:
		return ""
	case domain.CaptureFull:
		return text
	default: // masked
		if !p.Enabled {
			return text // 마스킹 비활성 → 원문
		}
		return m.mask(text, p, entities...)
	}
}

func (m *Masker) mask(text string, p domain.MaskingPolicy, entities ...PIIEntity) string {
	actions := make(map[string]domain.MaskAction, len(p.Rules))
	for _, r := range p.Rules {
		actions[r.Type] = r.Action
	}
	out := text
	// 1) entity 기반(정밀) — SR 이 준 스팬 우선.
	for _, e := range entities {
		act, ok := actions[e.Type]
		if !ok || act == domain.MaskKeep || e.Value == "" {
			continue
		}
		out = strings.ReplaceAll(out, e.Value, m.token(e.Type, e.Value, act))
	}
	// 2) 정규식 폴백 — 내장 유형 중 정책에 있는 것만.
	for _, d := range detectors {
		act, ok := actions[d.typ]
		if !ok || act == domain.MaskKeep {
			continue
		}
		out = d.re.ReplaceAllStringFunc(out, func(s string) string { return m.token(d.typ, s, act) })
	}
	return out
}

// token 은 매칭된 값을 처리 규칙대로 대체한다.
func (m *Masker) token(typ, val string, act domain.MaskAction) string {
	switch act {
	case domain.MaskRemove:
		return "[REDACTED:" + typ + "]"
	case domain.MaskHash:
		h := sha256.Sum256([]byte(m.salt + val))
		return "[" + typ + ":" + hex.EncodeToString(h[:])[:10] + "]"
	case domain.MaskMask:
		return partialMask(val)
	default: // keep
		return val
	}
}

// partialMask 는 앞 3·뒤 2 글자만 남기고 가린다(짧으면 전부 가림).
func partialMask(s string) string {
	r := []rune(s)
	if len(r) <= 5 {
		return strings.Repeat("●", len(r))
	}
	return string(r[:3]) + strings.Repeat("●", len(r)-5) + string(r[len(r)-2:])
}
