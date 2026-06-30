package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// handleRecordScore — POST 본문을 정규화된 Score 로 echo, trace_id 채움, source 보존.
func TestHandleRecordScore(t *testing.T) {
	s := &Server{}
	body := `{"name":"정확성","value":4,"data_type":"numeric","comment":"근거 명확","source":"llm-judge"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/traces/tr_abc/scores", strings.NewReader(body))
	req.SetPathValue("id", "tr_abc")
	rec := httptest.NewRecorder()
	s.handleRecordScore(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var out domain.Score
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.TraceID != "tr_abc" {
		t.Errorf("trace_id=%q want tr_abc", out.TraceID)
	}
	if out.Name != "정확성" || out.Value != 4 || out.Source != "llm-judge" || out.DataType != "numeric" {
		t.Errorf("필드 보존 실패: %+v", out)
	}
	if out.TS == "" {
		t.Error("ts 미설정")
	}
}

// 잘못된 data_type/source 는 안전한 기본값으로 정규화된다.
func TestHandleRecordScoreNormalizes(t *testing.T) {
	s := &Server{}
	body := `{"name":"x","value":1,"data_type":"weird","source":"evil"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/traces/tr_x/scores", strings.NewReader(body))
	req.SetPathValue("id", "tr_x")
	rec := httptest.NewRecorder()
	s.handleRecordScore(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d", rec.Code)
	}
	var out domain.Score
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.DataType != "numeric" {
		t.Errorf("data_type 정규화 실패: %s", out.DataType)
	}
	if out.Source != "api" {
		t.Errorf("source 정규화 실패: %s", out.Source)
	}
}

// name 누락 시 400.
func TestHandleRecordScoreRequiresName(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/traces/tr_x/scores", strings.NewReader(`{"value":1}`))
	req.SetPathValue("id", "tr_x")
	rec := httptest.NewRecorder()
	s.handleRecordScore(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status=%d want 400", rec.Code)
	}
}
