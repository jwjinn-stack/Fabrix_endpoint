package mockstore

import (
	"context"
	"fmt"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/server"
)

// IMP-39 — eval suite(데이터셋·실험) 인메모리 구현. server.EvalStore seam 충족.
// DataStore/UsageSource 와 동일 식: live 연동 시 PostgreSQL 구현으로 교체하면 핸들러는 불변.
//
// Store 의 별도 mutex(evalMu)로 키/유저 경로와 독립적으로 보호한다.

func (s *Store) seedEval() {
	if s.datasets != nil {
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	s.datasets = []server.EvalDataset{
		{
			ID: "ds_kr_qa", Name: "한국어 사실 QA (샘플)", Version: 1,
			CreatedAt: now, UpdatedAt: now,
			Items: []server.EvalDatasetItem{
				{ID: "c1", Input: "대한민국의 수도와 인구를 한 문장으로 알려줘", ExpectedOutput: "서울이며 인구는 약 940만 명입니다.", Criteria: "정확성·간결성"},
				{ID: "c2", Input: "환율이 오르면 수출 기업에 어떤 영향이 있나요?", Criteria: "정확성·근거 제시"},
				{ID: "c3", Input: "ETF와 펀드의 차이를 두 문장으로 설명해줘", ExpectedOutput: "ETF는 거래소에 상장되어 실시간 거래가 가능하고, 펀드는 기준가로 하루 한 번 거래됩니다."},
			},
		},
	}
	s.experiments = []server.Experiment{}
}

func (s *Store) ListDatasets(_ context.Context) ([]server.EvalDataset, error) {
	s.evalMu.Lock()
	defer s.evalMu.Unlock()
	s.seedEval()
	out := make([]server.EvalDataset, len(s.datasets))
	copy(out, s.datasets)
	return out, nil
}

func (s *Store) CreateDataset(_ context.Context, d server.EvalDataset) (server.EvalDataset, error) {
	s.evalMu.Lock()
	defer s.evalMu.Unlock()
	s.seedEval()
	now := time.Now().UTC().Format(time.RFC3339)
	s.evalSeq++
	d.ID = fmt.Sprintf("ds_%06x", seed(d.Name+fmt.Sprint(s.evalSeq))%0xffffff)
	if d.Version <= 0 {
		d.Version = 1
	}
	d.CreatedAt = now
	d.UpdatedAt = now
	// 케이스 ID 비면 채움(스냅샷·매트릭스 행 키 안정성).
	for i := range d.Items {
		if d.Items[i].ID == "" {
			d.Items[i].ID = fmt.Sprintf("c%d", i+1)
		}
	}
	s.datasets = append([]server.EvalDataset{d}, s.datasets...)
	return d, nil
}

func (s *Store) GetDataset(_ context.Context, id string) (server.EvalDataset, bool) {
	s.evalMu.Lock()
	defer s.evalMu.Unlock()
	s.seedEval()
	for _, d := range s.datasets {
		if d.ID == id {
			return d, true
		}
	}
	return server.EvalDataset{}, false
}

func (s *Store) ListExperiments(_ context.Context) ([]server.Experiment, error) {
	s.evalMu.Lock()
	defer s.evalMu.Unlock()
	s.seedEval()
	out := make([]server.Experiment, len(s.experiments))
	copy(out, s.experiments)
	return out, nil
}

func (s *Store) SaveExperiment(_ context.Context, e server.Experiment) (server.Experiment, error) {
	s.evalMu.Lock()
	defer s.evalMu.Unlock()
	s.seedEval()
	s.evalSeq++
	e.ID = fmt.Sprintf("ex_%06x", seed(e.DatasetID+fmt.Sprint(s.evalSeq))%0xffffff)
	e.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	// 이전 run 보존(append) — run-vs-run 회귀 비교를 위해 누적.
	s.experiments = append([]server.Experiment{e}, s.experiments...)
	return e, nil
}
