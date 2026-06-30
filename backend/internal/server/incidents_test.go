package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/maymust/fabrix-endpoint/internal/capability"
	"github.com/maymust/fabrix-endpoint/internal/incident"
)

// newIncidentServer 는 인시던트 store 를 갖춘 테스트 서버를 만든다(seed 1건).
func newIncidentServer(caps capability.Set) (*Server, string) {
	s := &Server{caps: caps, incidents: incident.NewStore()}
	inc := s.incidents.Observe("dk-test", "critical", "테스트 인시던트")
	return s, inc.ID
}

func doReq(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

// 7) observe 게이트: incident.write 없는 caps → resolve 404(미등록), ack 200(처리됨).
func TestIncidents_ObserveAckOnly(t *testing.T) {
	caps := capability.Set{capability.Guard: true, capability.IncidentAck: true} // observe 유사(write 없음)
	s, id := newIncidentServer(caps)
	h := s.Handler()

	// resolve 는 미등록 → 404 (observe 는 ack 까지만).
	rec := doReq(t, h, http.MethodPost, "/api/v1/incidents/"+id+"/resolve", "")
	if rec.Code != http.StatusNotFound {
		t.Errorf("write cap 없음 → resolve 는 404(미등록) 여야 하는데 %d", rec.Code)
	}
	// snooze 도 미등록 → 404.
	rec = doReq(t, h, http.MethodPost, "/api/v1/incidents/"+id+"/snooze", `{"minutes":10}`)
	if rec.Code != http.StatusNotFound {
		t.Errorf("write cap 없음 → snooze 는 404 여야 하는데 %d", rec.Code)
	}
	// ack 는 등록·동작 → 200.
	rec = doReq(t, h, http.MethodPost, "/api/v1/incidents/"+id+"/ack", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("ack 는 200 이어야 하는데 %d (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"state":"acked"`) {
		t.Errorf("ack 응답에 state=acked 가 있어야 하는데 %s", rec.Body.String())
	}
}

// 8) manage: ack/resolve/snooze 200 + 상태 반영. snooze 범위 밖 400.
func TestIncidents_ManageFullLifecycle(t *testing.T) {
	caps := capability.Set{capability.Guard: true, capability.IncidentAck: true, capability.IncidentWrite: true}
	s, id := newIncidentServer(caps)
	h := s.Handler()

	// 목록 조회 — 1건 + counts.
	rec := doReq(t, h, http.MethodGet, "/api/v1/incidents", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("목록은 200 이어야 하는데 %d", rec.Code)
	}
	var list struct {
		Incidents []incident.Incident `json:"incidents"`
		Counts    map[string]int      `json:"counts"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("목록 파싱 실패: %v", err)
	}
	if len(list.Incidents) != 1 {
		t.Errorf("seed 1건이어야 하는데 %d건", len(list.Incidents))
	}

	// snooze 정상.
	rec = doReq(t, h, http.MethodPost, "/api/v1/incidents/"+id+"/snooze", `{"minutes":30}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"state":"snoozed"`) {
		t.Fatalf("snooze 는 200+snoozed 여야 하는데 %d (%s)", rec.Code, rec.Body.String())
	}
	// snooze 범위 밖 → 400.
	rec = doReq(t, h, http.MethodPost, "/api/v1/incidents/"+id+"/snooze", `{"minutes":99999}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("범위 밖 snooze 는 400 이어야 하는데 %d", rec.Code)
	}
	// resolve 정상.
	rec = doReq(t, h, http.MethodPost, "/api/v1/incidents/"+id+"/resolve", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"state":"resolved"`) {
		t.Fatalf("resolve 는 200+resolved 여야 하는데 %d (%s)", rec.Code, rec.Body.String())
	}
	// 이미 해소된 인시던트 재해소 → 409.
	rec = doReq(t, h, http.MethodPost, "/api/v1/incidents/"+id+"/ack", "")
	if rec.Code != http.StatusConflict {
		t.Errorf("해소된 인시던트 ack 는 409 여야 하는데 %d", rec.Code)
	}
}

// 인박스 조회 자체는 Guard read 없으면 미등록(404).
func TestIncidents_ListGatedByGuard(t *testing.T) {
	s := &Server{caps: capability.Set{capability.Dashboard: true}, incidents: incident.NewStore()}
	rec := doReq(t, s.Handler(), http.MethodGet, "/api/v1/incidents", "")
	if rec.Code != http.StatusNotFound {
		t.Errorf("Guard cap 없음 → /incidents 는 404(미등록) 여야 하는데 %d", rec.Code)
	}
}
