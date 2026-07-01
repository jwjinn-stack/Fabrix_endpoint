package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/maymust/fabrix-endpoint/internal/catalog"
	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// fakeEvalStore — server 패키지 내에서 EvalStore seam 만 충족하는 경량 인메모리 구현(테스트용).
type fakeEvalStore struct {
	mu   sync.Mutex
	ds   []EvalDataset
	exps []Experiment
	seq  int
}

func (f *fakeEvalStore) ListDatasets(context.Context) ([]EvalDataset, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]EvalDataset, len(f.ds))
	copy(out, f.ds)
	return out, nil
}
func (f *fakeEvalStore) CreateDataset(_ context.Context, d EvalDataset) (EvalDataset, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seq++
	d.ID = "ds_test_" + itoa(f.seq)
	if d.Version <= 0 {
		d.Version = 1
	}
	d.CreatedAt = "2026-06-30T00:00:00Z"
	d.UpdatedAt = d.CreatedAt
	for i := range d.Items {
		if d.Items[i].ID == "" {
			d.Items[i].ID = "c" + itoa(i+1)
		}
	}
	f.ds = append([]EvalDataset{d}, f.ds...)
	return d, nil
}
func (f *fakeEvalStore) GetDataset(_ context.Context, id string) (EvalDataset, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, d := range f.ds {
		if d.ID == id {
			return d, true
		}
	}
	return EvalDataset{}, false
}
func (f *fakeEvalStore) ListExperiments(context.Context) ([]Experiment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Experiment, len(f.exps))
	copy(out, f.exps)
	return out, nil
}
func (f *fakeEvalStore) SaveExperiment(_ context.Context, e Experiment) (Experiment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seq++
	e.ID = "ex_test_" + itoa(f.seq)
	e.CreatedAt = "2026-06-30T0" + itoa(len(f.exps)) + ":00:00Z" // 단조 증가(정렬 검증용)
	f.exps = append([]Experiment{e}, f.exps...)
	return e, nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

// evalTestServer — eval suite 핸들러용. catalog 는 업스트림이 없는 상태(Chat 호출은 실패하지만
// scoreCase 가 graceful 하게 score=0/rationale 로 처리 → 집계 범위 검증에는 충분).
// guard/audit 는 nil → classifyAndAudit 가 DecisionAllow 로 처리(차단 케이스 없음).
func evalTestServer(t *testing.T) *Server {
	t.Helper()
	cat := catalog.New("http://127.0.0.1:0") // 도달 불가 업스트림(Chat 은 BadGateway → scoreCase graceful)
	return &Server{evalStore: &fakeEvalStore{}, catalog: cat}
}

func TestDatasetCRUD(t *testing.T) {
	s := evalTestServer(t)

	// 생성
	body := `{"name":"테스트셋","items":[{"input":"질문1","expected_output":"정답1"},{"input":"질문2"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/eval/datasets", strings.NewReader(body))
	rec := httptest.NewRecorder()
	s.handleCreateDataset(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", rec.Code, rec.Body.String())
	}
	var ds EvalDataset
	if err := json.Unmarshal(rec.Body.Bytes(), &ds); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if ds.ID == "" || ds.Version != 1 || len(ds.Items) != 2 {
		t.Fatalf("dataset 필드 이상: %+v", ds)
	}
	if ds.Items[0].ID == "" || ds.Items[1].ID == "" {
		t.Errorf("케이스 ID 미할당: %+v", ds.Items)
	}
	// expected_output 없는 케이스(reference-free) 허용
	if ds.Items[1].ExpectedOutput != "" {
		t.Errorf("두번째 케이스는 expected 없어야: %+v", ds.Items[1])
	}

	// 목록
	lrec := httptest.NewRecorder()
	s.handleListDatasets(lrec, httptest.NewRequest(http.MethodGet, "/api/v1/eval/datasets", nil))
	if lrec.Code != http.StatusOK {
		t.Fatalf("list status=%d", lrec.Code)
	}
	var lout struct {
		Datasets []EvalDataset `json:"datasets"`
	}
	_ = json.Unmarshal(lrec.Body.Bytes(), &lout)
	if len(lout.Datasets) != 1 {
		t.Errorf("목록 개수=%d want 1", len(lout.Datasets))
	}
}

func TestDatasetValidation(t *testing.T) {
	s := evalTestServer(t)
	cases := []struct {
		name, body string
	}{
		{"name 누락", `{"items":[{"input":"q"}]}`},
		{"items 빈", `{"name":"x","items":[]}`},
		{"input 빈", `{"name":"x","items":[{"input":"  "}]}`},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		s.handleCreateDataset(rec, httptest.NewRequest(http.MethodPost, "/api/v1/eval/datasets", strings.NewReader(c.body)))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status=%d want 400", c.name, rec.Code)
		}
	}
	// items 초과(51개) → 400
	var sb strings.Builder
	sb.WriteString(`{"name":"big","items":[`)
	for i := 0; i < 51; i++ {
		if i > 0 {
			sb.WriteString(",")
		}
		sb.WriteString(`{"input":"q"}`)
	}
	sb.WriteString(`]}`)
	rec := httptest.NewRecorder()
	s.handleCreateDataset(rec, httptest.NewRequest(http.MethodPost, "/api/v1/eval/datasets", strings.NewReader(sb.String())))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("items 초과: status=%d want 400", rec.Code)
	}
}

func TestRunExperimentBatchScores(t *testing.T) {
	s := evalTestServer(t)
	// 데이터셋 시드(3 케이스, 1개는 expected 없음)
	es := s.evalStore.(*fakeEvalStore)
	es.ds = []EvalDataset{{
		ID: "ds_x", Name: "셋", Version: 2,
		Items: []EvalDatasetItem{
			{ID: "c1", Input: "질문1", ExpectedOutput: "정답1"},
			{ID: "c2", Input: "질문2"},
			{ID: "c3", Input: "질문3", Criteria: "간결성"},
		},
	}}

	body := `{"dataset_id":"ds_x","config":{"model":"gemma-3-27b-it","prompt_version":"v2"}}`
	rec := httptest.NewRecorder()
	s.handleRunExperiment(rec, httptest.NewRequest(http.MethodPost, "/api/v1/eval/experiments", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("run status=%d body=%s", rec.Code, rec.Body.String())
	}
	var exp Experiment
	if err := json.Unmarshal(rec.Body.Bytes(), &exp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(exp.Cases) != 3 {
		t.Fatalf("케이스 수=%d want 3", len(exp.Cases))
	}
	// config snapshot 보존 — judge 미지정 시 model 로 폴백, criteria 기본값 채움.
	if exp.Config.JudgeModel != "gemma-3-27b-it" {
		t.Errorf("judge 폴백 실패: %q", exp.Config.JudgeModel)
	}
	if exp.Config.PromptVersion != "v2" {
		t.Errorf("prompt_version 스냅샷 실패: %q", exp.Config.PromptVersion)
	}
	if exp.Config.Criteria == "" {
		t.Error("criteria 기본값 미채움")
	}
	// dataset version snapshot
	if exp.DatasetVer != 2 {
		t.Errorf("dataset_version 스냅샷=%d want 2", exp.DatasetVer)
	}
	// 점수 집계 — mock 카탈로그가 비차단이면 mean/pass-rate 산출(0~5 범위).
	if exp.MeanScore < 0 || exp.MeanScore > 5 {
		t.Errorf("mean=%v 범위 밖", exp.MeanScore)
	}
	if exp.PassRate < 0 || exp.PassRate > 1 {
		t.Errorf("pass_rate=%v 범위 밖", exp.PassRate)
	}
}

func TestRunExperimentMissingDataset(t *testing.T) {
	s := evalTestServer(t)
	rec := httptest.NewRecorder()
	s.handleRunExperiment(rec, httptest.NewRequest(http.MethodPost, "/api/v1/eval/experiments",
		strings.NewReader(`{"dataset_id":"nope","config":{"model":"m"}}`)))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status=%d want 404", rec.Code)
	}
}

func TestExperimentStoreNil(t *testing.T) {
	s := &Server{} // evalStore nil
	rec := httptest.NewRecorder()
	s.handleListDatasets(rec, httptest.NewRequest(http.MethodGet, "/api/v1/eval/datasets", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status=%d want 503", rec.Code)
	}
}

func TestListExperimentsSorted(t *testing.T) {
	s := evalTestServer(t)
	es := s.evalStore.(*fakeEvalStore)
	es.exps = []Experiment{
		{ID: "a", CreatedAt: "2026-06-30T01:00:00Z", MeanScore: 3},
		{ID: "b", CreatedAt: "2026-06-30T03:00:00Z", MeanScore: 4},
		{ID: "c", CreatedAt: "2026-06-30T02:00:00Z", MeanScore: 2},
	}
	rec := httptest.NewRecorder()
	s.handleListExperiments(rec, httptest.NewRequest(http.MethodGet, "/api/v1/eval/experiments", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d", rec.Code)
	}
	var out struct {
		Experiments []Experiment `json:"experiments"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if len(out.Experiments) != 3 || out.Experiments[0].ID != "b" || out.Experiments[2].ID != "a" {
		t.Errorf("최신순 정렬 실패: %+v", out.Experiments)
	}
}

// guard 차단 케이스는 score=0/blocked 로 집계에서 제외됨을 보장(verdict 주입은 어려우므로 round 헬퍼만 검증).
func TestEvalRound2(t *testing.T) {
	if got := evalRound2(0.6666); got != 0.67 {
		t.Errorf("evalRound2(0.6666)=%v want 0.67", got)
	}
	if got := evalRound2(4.0/3.0); got != 1.33 {
		t.Errorf("evalRound2(1.333)=%v want 1.33", got)
	}
}

// (참고) domain import 보존 — guard verdict 타입 참조 가능성.
var _ = domain.DecisionBlocked
