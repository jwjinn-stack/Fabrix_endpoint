package server

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/httpx"
)

// 프롬프트/평가 관리(#17) — LLM-as-judge. 대상 모델 응답을 심판 모델이 1~5점 채점.
// Langfuse/Databricks 평가 패턴. dev 는 gemma 가 대상/심판 겸용(이상적으론 더 강한 심판 분리).

type evalRequest struct {
	Model     string `json:"model"`
	JudgeModel string `json:"judge_model"`
	Prompt    string `json:"prompt"`
	Criteria  string `json:"criteria"` // 채점 기준(선택)
}

type evalResult struct {
	Model     string `json:"model"`
	JudgeModel string `json:"judge_model"`
	Prompt    string `json:"prompt"`
	Response  string `json:"response"`
	Score     int    `json:"score"`     // 1..5
	Rationale string `json:"rationale"`
	LatencyMs int64  `json:"latency_ms"`
	Guard     *domain.GuardVerdict `json:"guard,omitempty"`
}

var scoreRe = regexp.MustCompile(`[1-5]`)

// handleEvalRun 은 POST /api/v1/eval/run (LLM-as-judge 단건 평가).
func (s *Server) handleEvalRun(w http.ResponseWriter, r *http.Request) {
	var req evalRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "잘못된 요청 본문")
		return
	}
	if req.Model == "" || req.Prompt == "" {
		httpx.Error(w, http.StatusBadRequest, "model 과 prompt 는 필수입니다")
		return
	}
	judge := req.JudgeModel
	if judge == "" {
		judge = req.Model
	}
	criteria := req.Criteria
	if criteria == "" {
		criteria = "정확성·완결성·한국어 표현의 자연스러움"
	}

	// 가드레일 통과해야 평가(증권사 정책 일관).
	verdict := s.classifyAndAudit(r.Context(), r, req.Prompt, req.Model)
	if verdict.Decision == domain.DecisionBlocked {
		v := verdict
		httpx.JSON(w, http.StatusOK, evalResult{Model: req.Model, JudgeModel: judge, Prompt: req.Prompt,
			Response: verdict.Reason, Score: 0, Rationale: "가드레일 차단으로 평가하지 않음", Guard: &v})
		return
	}

	// 1) 대상 모델 응답
	target, _, err := s.catalog.Chat(r.Context(), domain.ChatRequest{
		Model: req.Model, Messages: []domain.ChatMessage{{Role: "user", Content: req.Prompt}}, MaxTokens: 256,
	})
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "대상 모델 호출 실패: "+err.Error())
		return
	}

	// 2) 심판 모델 채점
	judgePrompt := "당신은 엄격한 평가자입니다. 아래 [질문]에 대한 [답변]을 기준(" + criteria +
		")에 따라 1~5점으로 채점하세요.\n반드시 JSON 한 줄로만 출력: {\"score\": <1-5>, \"rationale\": \"<간단한 근거>\"}\n\n[질문]\n" +
		req.Prompt + "\n\n[답변]\n" + target.Content
	judgeResp, _, jerr := s.catalog.Chat(r.Context(), domain.ChatRequest{
		Model: judge, Messages: []domain.ChatMessage{{Role: "user", Content: judgePrompt}}, MaxTokens: 200,
	})
	score, rationale := 0, ""
	if jerr == nil {
		score, rationale = parseJudge(judgeResp.Content)
	} else {
		rationale = "심판 모델 호출 실패: " + jerr.Error()
	}

	v := verdict
	httpx.JSON(w, http.StatusOK, evalResult{
		Model: req.Model, JudgeModel: judge, Prompt: req.Prompt, Response: target.Content,
		Score: score, Rationale: rationale, LatencyMs: target.LatencyMs, Guard: &v,
	})
}

// parseJudge 는 심판 응답에서 score/rationale 을 추출한다(JSON 우선, 실패 시 정규식 폴백).
func parseJudge(text string) (int, string) {
	if i := strings.Index(text, "{"); i >= 0 {
		if j := strings.LastIndex(text, "}"); j > i {
			var out struct {
				Score     json.Number `json:"score"`
				Rationale string      `json:"rationale"`
			}
			if err := json.Unmarshal([]byte(text[i:j+1]), &out); err == nil {
				sc, _ := strconv.Atoi(strings.TrimSpace(out.Score.String()))
				if sc >= 1 && sc <= 5 {
					return sc, out.Rationale
				}
			}
		}
	}
	// 폴백: 첫 1~5 숫자
	if m := scoreRe.FindString(text); m != "" {
		sc, _ := strconv.Atoi(m)
		return sc, strings.TrimSpace(text)
	}
	return 0, strings.TrimSpace(text)
}
