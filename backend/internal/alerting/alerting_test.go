package alerting

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestValidateWebhookURL_SchemeAndSSRF — scheme 화이트리스트 + 메타데이터/루프백 거부.
func TestValidateWebhookURL_SchemeAndSSRF(t *testing.T) {
	reject := []string{
		"file:///etc/passwd",
		"ftp://example.com/x",
		"http://",                       // host 없음
		"http://localhost/hook",         // 루프백 이름
		"http://127.0.0.1/hook",         // 루프백 IP
		"http://169.254.169.254/latest", // 클라우드 메타데이터
		"http://[::1]/hook",             // IPv6 루프백
		"http://metadata.google.internal/x",
	}
	for _, u := range reject {
		if _, err := ValidateWebhookURL(u); err == nil {
			t.Errorf("거부해야 하는 URL 이 통과됨: %q", u)
		}
	}
	// 정상 외부/내부 relay 는 허용(경고는 가능).
	accept := []string{"https://relay.internal.example.com/hook", "http://relay.fabrix.svc.cluster.local/hook"}
	for _, u := range accept {
		if _, err := ValidateWebhookURL(u); err != nil {
			t.Errorf("허용해야 하는 URL 이 거부됨: %q (%v)", u, err)
		}
	}
	// 빈 문자열 = 채널 해제(err 없음).
	if _, err := ValidateWebhookURL(""); err != nil {
		t.Errorf("빈 URL 은 해제로 허용되어야 함: %v", err)
	}
	// 사설망 IP 는 경고(저장 허용).
	w, err := ValidateWebhookURL("http://10.0.0.5/hook")
	if err != nil {
		t.Fatalf("사설망 IP 는 경고만 — 거부되면 안 됨: %v", err)
	}
	if len(w) == 0 {
		t.Error("사설망 IP 는 폐쇄망 안내 경고가 있어야 함")
	}
}

// TestDispatch_FiresAndPayloadHashed — 발송 1회 + 페이로드 token 이 평문 keyID 가 아닌 해시.
func TestDispatch_FiresAndPayloadHashed(t *testing.T) {
	var got Event
	var calls int32
	done := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(200)
		select {
		case done <- struct{}{}:
		default:
		}
	}))
	defer srv.Close()

	d := NewDispatcher(true, "test-salt")
	d.setWebhookUnchecked(srv.URL)
	keyID := "key-abc-123"
	d.Dispatch(keyID, Event{Event: EventThresholdCrossed, EventGroup: "key", Spend: 10, MaxBudget: 100})

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("발송이 일어나지 않음")
	}
	if c := atomic.LoadInt32(&calls); c != 1 {
		t.Fatalf("발송 1회여야 함, got %d", c)
	}
	if strings.Contains(got.Token, keyID) || got.Token == keyID {
		t.Errorf("페이로드 token 에 평문 keyID 가 들어가면 안 됨: %q", got.Token)
	}
	if !strings.HasPrefix(got.Token, "k_") {
		t.Errorf("token 은 salted hash(k_...) 여야 함: %q", got.Token)
	}
}

// TestDispatch_DedupWithinTTL — 같은 키×event 재발생은 TTL 내 억제.
func TestDispatch_DedupWithinTTL(t *testing.T) {
	var calls int32
	var wg sync.WaitGroup
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(200)
		wg.Done()
	}))
	defer srv.Close()

	d := NewDispatcher(true, "salt")
	d.setWebhookUnchecked(srv.URL)
	wg.Add(1)
	d.Dispatch("k1", Event{Event: EventThresholdCrossed})
	wg.Wait() // 첫 발송 도달 보장
	// 같은 키×event 재발생 — 억제(발송 goroutine 자체가 안 뜸).
	d.Dispatch("k1", Event{Event: EventThresholdCrossed})
	time.Sleep(150 * time.Millisecond)
	if c := atomic.LoadInt32(&calls); c != 1 {
		t.Fatalf("dedup 으로 1회만 발송되어야 함, got %d", c)
	}
}

// TestDispatch_ObserveNoSend — enabled=false(observe) 면 발송 안 함.
func TestDispatch_ObserveNoSend(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(200)
	}))
	defer srv.Close()

	d := NewDispatcher(false, "salt") // observe
	d.setWebhookUnchecked(srv.URL)
	d.Dispatch("k1", Event{Event: EventBudgetCrossed})
	time.Sleep(150 * time.Millisecond)
	if c := atomic.LoadInt32(&calls); c != 0 {
		t.Fatalf("observe 는 발송하면 안 됨, got %d", c)
	}
}

// TestDispatch_FailureAuditedNotFatal — 서버 500 → panic 없음, 감사에 실패 기록.
func TestDispatch_FailureAuditedNotFatal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
	}))
	defer srv.Close()

	d := NewDispatcher(true, "salt")
	d.setWebhookUnchecked(srv.URL)
	d.Dispatch("k1", Event{Event: EventThresholdCrossed})

	// 발송 + 재시도(1회) + backoff 후 감사 기록될 때까지 대기.
	deadline := time.Now().Add(3 * time.Second)
	var rec []SendRecord
	for time.Now().Before(deadline) {
		rec = d.Audit()
		if len(rec) > 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if len(rec) == 0 {
		t.Fatal("실패 발송이 감사에 기록되어야 함")
	}
	if rec[0].OK {
		t.Errorf("500 응답은 실패(OK=false)여야 함: %+v", rec[0])
	}
}

// TestSend_NetworkErrorNoURLLeak — 네트워크 실패 사유에 URL(토큰 임베드 가능)이 새지 않아야 함.
func TestSend_NetworkErrorNoURLLeak(t *testing.T) {
	// 닫힌 포트로 즉시 연결 실패를 유도(쿼리에 가짜 토큰 임베드).
	ch := newWebhookChannelUnchecked("http://127.0.0.1:1/hook?token=supersecret-abc123")
	err := ch.Send(context.Background(), Event{Event: EventThresholdCrossed})
	if err == nil {
		t.Fatal("연결 실패해야 함")
	}
	if strings.Contains(err.Error(), "supersecret") || strings.Contains(err.Error(), "127.0.0.1") {
		t.Errorf("에러 메시지에 URL/토큰이 새면 안 됨: %q", err.Error())
	}
}

// TestSMTPChannel_Stub — SMTP 는 인터페이스 스텁(미구현).
func TestSMTPChannel_Stub(t *testing.T) {
	if err := (SMTPChannel{}).Send(context.Background(), Event{}); err != ErrNotImplemented {
		t.Errorf("SMTP 는 미구현 스텁이어야 함: %v", err)
	}
}
