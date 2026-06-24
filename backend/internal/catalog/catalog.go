// Package catalog 은 클러스터에 서빙 중인 모델을 카탈로그로 노출하고,
// 플레이그라운드 채팅을 업스트림 OpenAI 엔드포인트로 프록시한다.
// (Fireworks/Together UX 벤치마킹: 카탈로그→플레이그라운드→엔드포인트)
package catalog

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// entry 는 레지스트리 항목 = 카탈로그 메타 + 업스트림 OpenAI 베이스 URL.
type entry struct {
	info     domain.ModelInfo
	upstream string // 예: http://host:8000  (/v1/... 가 붙는다)
}

// Catalog 은 모델 레지스트리 + 프록시.
type Catalog struct {
	entries []entry
	http    *http.Client
}

// New 는 클러스터 서빙 모델 레지스트리를 구성한다.
// gemmaUpstream 만 환경별로 주입(dev=NodePort / 인클러스터=svc), 나머지는 인클러스터 DNS.
func New(gemmaUpstream string) *Catalog {
	return &Catalog{
		http: &http.Client{Timeout: 60 * time.Second},
		entries: []entry{
			{
				info: domain.ModelInfo{
					ID: "gemma-4-31b-it", DisplayName: "Gemma 4 31B Instruct", Provider: "google",
					Type: domain.TypeChat, ContextWindow: 65536, Serving: "dynamo-agg",
					Namespace: "dynamo-inference", Workload: "gemma4-31b-vllm-agg", Playground: true,
				},
				upstream: gemmaUpstream,
			},
			{
				info: domain.ModelInfo{
					ID: "qwen3", DisplayName: "Qwen3", Provider: "qwen",
					Type: domain.TypeChat, ContextWindow: 32768, Serving: "vllm",
					Namespace: "vllm", Workload: "qwen3-vllm", Playground: true,
				},
				upstream: "http://qwen3-vllm.vllm:8000",
			},
			{
				info: domain.ModelInfo{
					ID: "qwen2.5-vl", DisplayName: "Qwen2.5-VL", Provider: "qwen",
					Type: domain.TypeVision, ContextWindow: 32768, Serving: "vllm",
					Namespace: "vllm", Workload: "qwen25vl-vllm", Playground: true,
				},
				upstream: "http://qwen25vl-vllm.vllm:8000",
			},
			{
				info: domain.ModelInfo{
					ID: "bge-m3", DisplayName: "BGE-M3 (Embedding)", Provider: "baai",
					Type: domain.TypeEmbedding, ContextWindow: 8192, Serving: "vllm",
					Namespace: "vllm", Workload: "bge-m3-vllm", Playground: false,
				},
				upstream: "http://bge-m3-vllm.vllm:8000",
			},
			{
				info: domain.ModelInfo{
					ID: "bge-reranker", DisplayName: "BGE Reranker", Provider: "baai",
					Type: domain.TypeRerank, ContextWindow: 8192, Serving: "vllm",
					Namespace: "vllm", Workload: "bge-reranker-vllm", Playground: false,
				},
				upstream: "http://bge-reranker-vllm.vllm:8000",
			},
		},
	}
}

// Models 는 카탈로그를 반환하고, 도달 가능한 모델은 /v1/models 로 status 를 갱신한다.
func (c *Catalog) Models(ctx context.Context) domain.ModelCatalog {
	models := make([]domain.ModelInfo, 0, len(c.entries))
	for _, e := range c.entries {
		m := e.info
		m.Status = c.probe(ctx, e.upstream)
		models = append(models, m)
	}
	return domain.ModelCatalog{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Models:      models,
	}
}

// probe 는 업스트림 /v1/models 로 빠르게 status 를 확인한다(ready|unreachable).
func (c *Catalog) probe(ctx context.Context, upstream string) string {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstream+"/v1/models", nil)
	if err != nil {
		return "unknown"
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return "unreachable"
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		return "ready"
	}
	return "unknown"
}

// upstreamFor 는 model id 의 업스트림 베이스 URL 을 찾는다.
func (c *Catalog) upstreamFor(model string) (string, bool) {
	for _, e := range c.entries {
		if e.info.ID == model {
			return e.upstream, true
		}
	}
	return "", false
}

// openAIResp 는 채팅 응답 파싱용 최소 구조.
type openAIResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

// Chat 은 선택 모델의 업스트림으로 채팅을 프록시하고 관측 지표를 덧붙인다.
// (모든 추론 트래픽이 우리 레이어를 통과 = 거버넌스/귀속 지점. 향후 x-fabrix-app-id 주입 위치)
func (c *Catalog) Chat(ctx context.Context, in domain.ChatRequest) (domain.ChatResponse, int, error) {
	upstream, ok := c.upstreamFor(in.Model)
	if !ok {
		return domain.ChatResponse{}, http.StatusBadRequest, fmt.Errorf("알 수 없는 모델: %s", in.Model)
	}
	if in.MaxTokens == 0 {
		in.MaxTokens = 256
	}

	body, _ := json.Marshal(map[string]any{
		"model": in.Model, "messages": in.Messages, "max_tokens": in.MaxTokens,
		"temperature": in.Temperature, "stream": false,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, upstream+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return domain.ChatResponse{}, http.StatusInternalServerError, err
	}
	req.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := c.http.Do(req)
	if err != nil {
		return domain.ChatResponse{}, http.StatusBadGateway, fmt.Errorf("업스트림 도달 실패: %w", err)
	}
	defer resp.Body.Close()
	elapsed := time.Since(start)

	if resp.StatusCode != http.StatusOK {
		return domain.ChatResponse{}, http.StatusBadGateway, fmt.Errorf("업스트림 %d", resp.StatusCode)
	}
	var oa openAIResp
	if err := json.NewDecoder(resp.Body).Decode(&oa); err != nil {
		return domain.ChatResponse{}, http.StatusBadGateway, err
	}
	content := ""
	if len(oa.Choices) > 0 {
		content = oa.Choices[0].Message.Content
	}
	tps := 0.0
	if s := elapsed.Seconds(); s > 0 {
		tps = float64(oa.Usage.CompletionTokens) / s
	}
	return domain.ChatResponse{
		Model:            in.Model,
		Content:          content,
		PromptTokens:     oa.Usage.PromptTokens,
		CompletionTokens: oa.Usage.CompletionTokens,
		LatencyMs:        elapsed.Milliseconds(),
		TokensPerSec:     float64(int(tps*10)) / 10,
	}, http.StatusOK, nil
}
