package glue

import (
	"strings"
	"testing"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

func policyWith(rules ...domain.MaskRule) domain.MaskingPolicy {
	return domain.MaskingPolicy{Enabled: true, CaptureInput: domain.CaptureMasked, Rules: rules}
}

func TestApplyCaptureModes(t *testing.T) {
	m := NewMasker("salt")
	p := domain.DefaultMaskingPolicy()
	const text = "내 번호 010-1234-5678"
	if got := m.Apply(text, domain.CaptureNone, p, nil); got != "" {
		t.Errorf("none 은 빈 문자열이어야 함, got %q", got)
	}
	if got := m.Apply(text, domain.CaptureFull, p, nil); got != text {
		t.Errorf("full 은 원문이어야 함, got %q", got)
	}
	if got := m.Apply(text, domain.CaptureMasked, p, nil); got == text || !strings.Contains(got, "●") {
		t.Errorf("masked 는 전화번호를 가려야 함, got %q", got)
	}
}

func TestMaskDisabledReturnsFull(t *testing.T) {
	m := NewMasker("salt")
	p := domain.DefaultMaskingPolicy()
	p.Enabled = false
	const text = "주민번호 901201-1234567"
	if got := m.Apply(text, domain.CaptureMasked, p, nil); got != text {
		t.Errorf("enabled=false 면 masked 라도 원문, got %q", got)
	}
}

func TestRegexActionsByType(t *testing.T) {
	m := NewMasker("salt")
	p := policyWith(
		domain.MaskRule{Type: "rrn", Action: domain.MaskHash},
		domain.MaskRule{Type: "phone", Action: domain.MaskMask},
		domain.MaskRule{Type: "email", Action: domain.MaskRemove},
	)
	out := m.mask("주민 901201-1234567 폰 010-1234-5678 메일 a@b.com", p)
	if strings.Contains(out, "901201-1234567") {
		t.Error("rrn 원문이 남으면 안 됨")
	}
	if !strings.Contains(out, "[rrn:") {
		t.Errorf("rrn 은 해시 토큰이어야 함: %q", out)
	}
	if strings.Contains(out, "010-1234-5678") || !strings.Contains(out, "●") {
		t.Errorf("phone 은 마스킹되어야 함: %q", out)
	}
	if !strings.Contains(out, "[REDACTED:email]") {
		t.Errorf("email 은 제거되어야 함: %q", out)
	}
}

func TestKeepActionLeavesText(t *testing.T) {
	m := NewMasker("salt")
	p := policyWith(domain.MaskRule{Type: "phone", Action: domain.MaskKeep})
	const text = "폰 010-1234-5678"
	if got := m.mask(text, p); got != text {
		t.Errorf("keep 은 원문 유지, got %q", got)
	}
}

func TestUnconfiguredTypeUntouched(t *testing.T) {
	m := NewMasker("salt")
	p := policyWith(domain.MaskRule{Type: "rrn", Action: domain.MaskHash}) // phone 규칙 없음
	const text = "폰 010-1234-5678"
	if got := m.mask(text, p); got != text {
		t.Errorf("정책에 없는 유형은 건드리지 않아야 함, got %q", got)
	}
}

func TestEntityBasedMaskingPrecise(t *testing.T) {
	m := NewMasker("salt")
	p := policyWith(domain.MaskRule{Type: "name", Action: domain.MaskMask}) // 이름은 정규식 없음 → entity 경로
	out := m.mask("상담원 홍길동 입니다", p, PIIEntity{Type: "name", Value: "홍길동"})
	if strings.Contains(out, "홍길동") {
		t.Errorf("entity 로 준 이름은 가려져야 함: %q", out)
	}
}

func TestPartialMask(t *testing.T) {
	if got := partialMask("12"); got != "●●" {
		t.Errorf("짧은 값은 전부 가림, got %q", got)
	}
	if got := partialMask("01012345678"); !strings.HasPrefix(got, "010") || !strings.HasSuffix(got, "78") {
		t.Errorf("앞3·뒤2 노출, got %q", got)
	}
}
