package guard

import "testing"

// 한국어 PII 탐지율 PoC(#10). SR ModernBERT 가 약한 한국어 PII 를 정규식이 얼마나
// 잡는지 라벨 데이터셋으로 측정한다. 기준: 재현율(recall) ≥ 0.9, 오탐(클린 false-positive) = 0.
func TestKoreanPIIDetectionRate(t *testing.T) {
	pii := []struct{ text, want string }{
		{"제 주민번호는 901201-1234567 입니다", "rrn_kr"},
		{"외국인등록번호 900101-5234567", "rrn_kr"},
		{"여권번호 M12345678 로 예약", "passport_kr"},
		{"운전면허 11-22-345678-90", "driver_kr"},
		{"사업자등록번호 123-45-67890", "biznum_kr"},
		{"법인등록번호 110111-1234567", "corpnum_kr"},
		{"카드번호 1234-5678-9012-3456", "card_kr"},
		{"연락처 010-1234-5678 로 주세요", "phone_kr"},
		{"계좌 110-234-567890 으로 입금", "account_kr"},
		{"이메일 hong@example.com 으로 회신", "email"},
	}
	clean := []string{
		"코스피 전망을 알려줘",
		"삼성전자 목표주가는 얼마인가요",
		"오늘 환율 동향 요약",
		"2024년 3분기 실적 분석",
		"안녕하세요 반갑습니다",
	}

	detected := 0
	for _, c := range pii {
		ents := koreanPII(c.text)
		if len(ents) == 0 {
			t.Errorf("미탐지(PII 놓침): %q", c.text)
			continue
		}
		detected++
	}
	recall := float64(detected) / float64(len(pii))

	falsePos := 0
	for _, c := range clean {
		if ents := koreanPII(c); len(ents) > 0 {
			t.Errorf("오탐(클린을 PII로): %q → %v", c, ents)
			falsePos++
		}
	}

	t.Logf("한국어 PII 탐지율: recall=%.1f%% (%d/%d), 오탐=%d/%d",
		recall*100, detected, len(pii), falsePos, len(clean))
	if recall < 0.9 {
		t.Errorf("재현율 미달: %.2f < 0.9", recall)
	}
	if falsePos > 0 {
		t.Errorf("오탐 발생: %d", falsePos)
	}
}
