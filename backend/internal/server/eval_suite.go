package server

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strings"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// IMP-39 — eval suite. 단건 LLM-as-judge(eval.go) 를 데이터셋·실험·회귀 비교로 확장.
// Langfuse Datasets+Experiments, Phoenix experiments 패턴: "프롬프트/모델을 바꿨을 때
// N개 케이스 점수 변화" 가 핵심 가치. v1 은 소량 동기 배치(대량 async 큐는 후속) — 단,
// experiment 는 config/dataset version 스냅샷을 저장해 idempotent/재실행/비교가 가능하다.

// 입력 가드(증권사 콘솔 — 핸들러 입력은 항상 bounded).
const (
	maxDatasetItems = 50
	maxDatasetInput = 8 * 1024
	maxDatasetName  = 200
)

// EvalDatasetItem 은 고정 테스트 케이스 1건. expected_output 은 OPTIONAL(reference-free 허용).
type EvalDatasetItem struct {
	ID             string `json:"id"`
	Input          string `json:"input"`
	ExpectedOutput string `json:"expected_output,omitempty"`
	Criteria       string `json:"criteria,omitempty"`
	Metadata       string `json:"metadata,omitempty"`
}

// EvalDataset 은 케이스 집합. Version 은 아이템 스냅샷 기준(experiment 가 참조).
type EvalDataset struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Version   int               `json:"version"`
	Items     []EvalDatasetItem `json:"items"`
	CreatedAt string            `json:"created_at"`
	UpdatedAt string            `json:"updated_at"`
}

// ExperimentConfig 는 실험 run 의 고정(pinned) 설정 — judge 교체 시 비교성 위해 스냅샷 저장.
type ExperimentConfig struct {
	Model         string `json:"model"`
	JudgeModel    string `json:"judge_model"`
	PromptVersion string `json:"prompt_version,omitempty"`
	Criteria      string `json:"criteria"`
}

// ExperimentCaseResult 는 케이스 1건의 채점 결과.
type ExperimentCaseResult struct {
	ItemID    string `json:"item_id"`
	Input     string `json:"input"`
	Response  string `json:"response"`
	Score     int    `json:"score"`
	Rationale string `json:"rationale"`
	Blocked   bool   `json:"blocked"`
}

// Experiment 은 데이터셋×config 1회 배치 실행 레코드(이전 실행 보존 → run-vs-run 비교).
type Experiment struct {
	ID          string                 `json:"id"`
	DatasetID   string                 `json:"dataset_id"`
	DatasetName string                 `json:"dataset_name"`
	DatasetVer  int                    `json:"dataset_version"`
	Config      ExperimentConfig       `json:"config"`
	Cases       []ExperimentCaseResult `json:"cases"`
	MeanScore   float64                `json:"mean_score"`
	PassRate    float64                `json:"pass_rate"`
	CreatedAt   string                 `json:"created_at"`
}

// ── 데이터셋 ──

func (s *Server) handleListDatasets(w http.ResponseWriter, r *http.Request) {
	if s.evalStore == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "eval 데이터 스토어가 구성되지 않았습니다")
		return
	}
	list, err := s.evalStore.ListDatasets(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "데이터셋 조회 실패")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"datasets": list})
}

func (s *Server) handleCreateDataset(w http.ResponseWriter, r *http.Request) {
	if s.evalStore == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "eval 데이터 스토어가 구성되지 않았습니다")
		return
	}
	var req EvalDataset
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 요청 본문")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httpx.Error(w, http.StatusBadRequest, "name 은 필수입니다")
		return
	}
	if len(req.Name) > maxDatasetName {
		httpx.Error(w, http.StatusBadRequest, "name 이 너무 깁니다")
		return
	}
	if len(req.Items) == 0 {
		httpx.Error(w, http.StatusBadRequest, "items 는 최소 1건 필요합니다")
		return
	}
	if len(req.Items) > maxDatasetItems {
		httpx.Error(w, http.StatusBadRequest, "items 는 최대 50건까지 허용됩니다")
		return
	}
	for i := range req.Items {
		req.Items[i].Input = strings.TrimSpace(req.Items[i].Input)
		if req.Items[i].Input == "" {
			httpx.Error(w, http.StatusBadRequest, "각 케이스의 input 은 필수입니다")
			return
		}
		if len(req.Items[i].Input) > maxDatasetInput {
			httpx.Error(w, http.StatusBadRequest, "케이스 input 이 너무 깁니다")
			return
		}
	}
	out, err := s.evalStore.CreateDataset(r.Context(), req)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "데이터셋 생성 실패")
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

// ── 실험(배치 채점) ──

type runExperimentRequest struct {
	DatasetID string           `json:"dataset_id"`
	Config    ExperimentConfig `json:"config"`
}

func (s *Server) handleListExperiments(w http.ResponseWriter, r *http.Request) {
	if s.evalStore == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "eval 데이터 스토어가 구성되지 않았습니다")
		return
	}
	list, err := s.evalStore.ListExperiments(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "실험 조회 실패")
		return
	}
	// 최신순(비교 UI 가 최근 run 을 먼저 본다).
	sort.SliceStable(list, func(i, j int) bool { return list[i].CreatedAt > list[j].CreatedAt })
	httpx.JSON(w, http.StatusOK, map[string]any{"experiments": list})
}

func (s *Server) handleRunExperiment(w http.ResponseWriter, r *http.Request) {
	if s.evalStore == nil {
		httpx.Error(w, http.StatusServiceUnavailable, "eval 데이터 스토어가 구성되지 않았습니다")
		return
	}
	var req runExperimentRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 요청 본문")
		return
	}
	if req.DatasetID == "" || req.Config.Model == "" {
		httpx.Error(w, http.StatusBadRequest, "dataset_id 와 config.model 은 필수입니다")
		return
	}
	ds, ok := s.evalStore.GetDataset(r.Context(), req.DatasetID)
	if !ok {
		httpx.Error(w, http.StatusNotFound, "데이터셋을 찾을 수 없습니다")
		return
	}
	cfg := req.Config
	if cfg.JudgeModel == "" {
		cfg.JudgeModel = cfg.Model
	}
	if strings.TrimSpace(cfg.Criteria) == "" {
		cfg.Criteria = "정확성·완결성·한국어 표현의 자연스러움"
	}

	exp := Experiment{
		DatasetID:   ds.ID,
		DatasetName: ds.Name,
		DatasetVer:  ds.Version,
		Config:      cfg,
		Cases:       make([]ExperimentCaseResult, 0, len(ds.Items)),
	}
	var sum, scored, passed int
	for _, item := range ds.Items {
		cr := s.scoreCase(r.Context(), r, cfg, item)
		exp.Cases = append(exp.Cases, cr)
		if !cr.Blocked {
			sum += cr.Score
			scored++
			if cr.Score >= 4 {
				passed++
			}
		}
	}
	if scored > 0 {
		exp.MeanScore = evalRound2(float64(sum) / float64(scored))
		exp.PassRate = evalRound2(float64(passed) / float64(scored))
	}

	out, err := s.evalStore.SaveExperiment(r.Context(), exp)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "실험 저장 실패")
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

// scoreCase 는 케이스 1건을 채점한다(단건 eval.go 와 동일한 judge 경로 재사용).
// criteria 우선순위: 케이스별 criteria > config.Criteria. expected_output 이 있으면
// reference-based(정답 대비), 없으면 reference-free 기준으로 judge 프롬프트를 구성한다.
func (s *Server) scoreCase(ctx context.Context, r *http.Request, cfg ExperimentConfig, item EvalDatasetItem) ExperimentCaseResult {
	cr := ExperimentCaseResult{ItemID: item.ID, Input: item.Input}

	// 가드레일 — 차단 케이스는 채점하지 않음(증권사 정책 일관, 단건 경로와 동일).
	verdict := s.classifyAndAudit(ctx, r, item.Input, cfg.Model)
	if verdict.Decision == domain.DecisionBlocked {
		cr.Blocked = true
		cr.Response = verdict.Reason
		cr.Rationale = "가드레일 차단으로 평가하지 않음"
		return cr
	}

	criteria := strings.TrimSpace(item.Criteria)
	if criteria == "" {
		criteria = cfg.Criteria
	}

	// 1) 대상 모델 응답
	target, _, err := s.catalog.Chat(ctx, domain.ChatRequest{
		Model:    cfg.Model,
		Messages: []domain.ChatMessage{{Role: "user", Content: item.Input}},
		MaxTokens: 256,
	})
	if err != nil {
		cr.Rationale = "대상 모델 호출 실패: " + err.Error()
		return cr
	}
	cr.Response = target.Content

	// 2) 심판 모델 채점 — expected_output 유무에 따라 reference-based / reference-free.
	var sb strings.Builder
	sb.WriteString("당신은 엄격한 평가자입니다. 아래 [질문]에 대한 [답변]을 기준(")
	sb.WriteString(criteria)
	sb.WriteString(")에 따라 1~5점으로 채점하세요.\n")
	if exp := strings.TrimSpace(item.ExpectedOutput); exp != "" {
		sb.WriteString("[기대답변]과의 정합성도 함께 고려하세요.\n")
		sb.WriteString("반드시 JSON 한 줄로만 출력: {\"score\": <1-5>, \"rationale\": \"<간단한 근거>\"}\n\n[질문]\n")
		sb.WriteString(item.Input)
		sb.WriteString("\n\n[기대답변]\n")
		sb.WriteString(exp)
		sb.WriteString("\n\n[답변]\n")
		sb.WriteString(target.Content)
	} else {
		sb.WriteString("반드시 JSON 한 줄로만 출력: {\"score\": <1-5>, \"rationale\": \"<간단한 근거>\"}\n\n[질문]\n")
		sb.WriteString(item.Input)
		sb.WriteString("\n\n[답변]\n")
		sb.WriteString(target.Content)
	}
	judgeResp, _, jerr := s.catalog.Chat(ctx, domain.ChatRequest{
		Model:    cfg.JudgeModel,
		Messages: []domain.ChatMessage{{Role: "user", Content: sb.String()}},
		MaxTokens: 200,
	})
	if jerr != nil {
		cr.Rationale = "심판 모델 호출 실패: " + jerr.Error()
		return cr
	}
	cr.Score, cr.Rationale = parseJudge(judgeResp.Content)
	return cr
}

func evalRound2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}
