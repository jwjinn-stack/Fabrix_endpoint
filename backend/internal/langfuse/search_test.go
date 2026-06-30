package langfuse

import (
	"strings"
	"testing"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// traceMatchesQ — 화이트리스트 코퍼스(메타 + 보존 미리보기)에 대해 AND 토큰 부분일치.
func TestTraceMatchesQ(t *testing.T) {
	s := domain.TraceSummary{
		TraceID: "tr_abc", Model: "qwen3-32b", AppID: "app-cs-bot", DeptID: "d-cs",
		Decision: "allowed", Status: "ok", FinishReason: "stop",
	}
	in := "환불 지연 관련 정중한 답변 초안"
	out := "요청하신 내용을 정리하면 다음과 같습니다."

	cases := []struct {
		q    string
		want bool
	}{
		{"", true},                  // 빈 q = 필터 미적용
		{"   ", true},               // 공백만 = 미적용
		{"qwen3", true},             // 모델 메타 매칭
		{"QWEN3-32B", true},         // 대소문자 무시
		{"app-cs-bot", true},        // 앱 메타
		{"환불", true},                // 입력 미리보기 매칭
		{"정리하면", true},              // 출력 미리보기 매칭
		{"qwen3 환불", true},          // AND: 둘 다 만족
		{"qwen3 존재하지않는토큰", false}, // AND: 하나라도 불일치면 탈락
		{"gemma", false},            // 다른 모델 — 불일치
	}
	for _, c := range cases {
		if got := traceMatchesQ(s, in, out, c.q); got != c.want {
			t.Errorf("traceMatchesQ(q=%q)=%v want %v", c.q, got, c.want)
		}
	}
}

// SENSITIVE 핵심: 마스킹/가드레일 차단 원문은 검색 코퍼스에 없어야 한다.
// 차단 트레이스 미리보기는 "[차단됨] …" 플레이스홀더이며, guard 원문 어휘(DAN/주민번호/AKIA 등)는
// synthGuardContent 에만 있고 q 코퍼스로 절대 흘러들지 않는다.
func TestQDoesNotLeakMaskedContent(t *testing.T) {
	// 차단 트레이스의 보존 미리보기(synthPreview blocked 분기).
	blockedIn, blockedOut := synthPreview(12345, "blocked")
	if !strings.Contains(blockedIn, "[차단됨]") {
		t.Fatalf("차단 트레이스 input 미리보기가 플레이스홀더가 아님: %q", blockedIn)
	}
	s := domain.TraceSummary{TraceID: "tr_x", Model: "qwen3-32b", Decision: "blocked", Status: "ok"}

	// guard 원문에만 등장하는 민감 어휘들 — q 로 절대 매칭되면 안 된다.
	guardOnlyTokens := []string{"DAN", "주민번호", "880101", "AKIA", "4123-4567", "010-1234-5678"}
	for _, tok := range guardOnlyTokens {
		if traceMatchesQ(s, blockedIn, blockedOut, tok) {
			t.Errorf("마스킹/차단 원문 누설: q=%q 가 차단 트레이스에 매칭됨(원문이 코퍼스에 들어감)", tok)
		}
	}
	// 차단 트레이스는 플레이스홀더 토큰으로만 검색됨(정상).
	if !traceMatchesQ(s, blockedIn, blockedOut, "차단됨") {
		t.Errorf("차단 트레이스가 플레이스홀더 토큰으로도 안 잡힘")
	}

	// searchableText 코퍼스 자체에 guard 원문이 없음을 직접 확인.
	corpus := searchableText(s, blockedIn, blockedOut)
	for _, tok := range guardOnlyTokens {
		if strings.Contains(corpus, strings.ToLower(tok)) {
			t.Errorf("코퍼스에 민감 어휘 포함됨: %q", tok)
		}
	}
}

// q 가 synthTraceList 에서 드롭다운 필터와 AND 결합. 빈 q = 미적용(기존 건수).
func TestSynthTraceListQ(t *testing.T) {
	base := synthTraceList("24h", Filters{})
	if len(base.Traces) == 0 {
		t.Fatal("기준 목록이 비어 있음")
	}

	// 빈 q = 필터 미적용 → 동일 건수.
	if got := synthTraceList("24h", Filters{Q: ""}); len(got.Traces) != len(base.Traces) {
		t.Errorf("빈 q 인데 건수 변함: %d != %d", len(got.Traces), len(base.Traces))
	}

	// 모델 토큰으로 q → 결과가 기준보다 좁아지고(필터 효과), 0건이 아님.
	model := base.Traces[0].Model
	byQ := synthTraceList("24h", Filters{Q: model})
	if len(byQ.Traces) == 0 {
		t.Fatalf("q=%q 결과가 0건", model)
	}
	if len(byQ.Traces) > len(base.Traces) {
		t.Errorf("q 가 결과를 넓힘(필터가 아님): %d > %d", len(byQ.Traces), len(base.Traces))
	}

	// AND 결합: decision=blocked + q=<불일치 토큰> → 0건 가능, 일치 토큰이면 blocked 만.
	combined := synthTraceList("24h", Filters{Decision: "blocked", Q: "차단됨"})
	for _, tr := range combined.Traces {
		if tr.Decision != "blocked" {
			t.Errorf("AND 결합 위반: decision=%s (blocked 만 와야 함)", tr.Decision)
		}
	}
	// 존재하지 않는 토큰 → 0건.
	none := synthTraceList("24h", Filters{Q: "이런토큰은코퍼스에절대없다xyzzy"})
	if len(none.Traces) != 0 {
		t.Errorf("불일치 q 인데 %d 건 반환", len(none.Traces))
	}
}
