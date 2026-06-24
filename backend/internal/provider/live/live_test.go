package live

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// vectorJSON 은 Prometheus vector 응답 JSON을 만든다. model "" 이면 라벨 없음.
func vectorJSON(samples [][2]string) string {
	var b strings.Builder
	b.WriteString(`{"status":"success","data":{"resultType":"vector","result":[`)
	for i, s := range samples {
		if i > 0 {
			b.WriteString(",")
		}
		if s[0] == "" {
			fmt.Fprintf(&b, `{"metric":{},"value":[1700000000,%q]}`, s[1])
		} else {
			fmt.Fprintf(&b, `{"metric":{"model":%q},"value":[1700000000,%q]}`, s[0], s[1])
		}
	}
	b.WriteString(`]}}`)
	return b.String()
}

// mockVMSelect 는 쿼리 expr 부분문자열로 분기해 카드/사용량 매핑을 검증할 값을 반환한다.
func mockVMSelect() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("query")
		w.Header().Set("Content-Type", "application/json")
		var resp string
		switch {
		case strings.Contains(q, "DCGM_FI_DEV_GPU_UTIL"):
			resp = vectorJSON([][2]string{{"", "80"}})
		case strings.Contains(q, "FB_USED"):
			resp = vectorJSON([][2]string{{"", "20"}})
		case strings.Contains(q, "FB_FREE"):
			resp = vectorJSON([][2]string{{"", "60"}})
		case strings.Contains(q, "GR_ENGINE_ACTIVE"):
			resp = vectorJSON([][2]string{{"", "0.5"}})
		case strings.Contains(q, "requests_total") && strings.Contains(q, "by (model)"):
			resp = vectorJSON([][2]string{{"m1", "100"}, {"m2", "50"}})
		case strings.Contains(q, "input_sequence_tokens_sum") && strings.Contains(q, "by (model)"):
			resp = vectorJSON([][2]string{{"m1", "1000"}, {"m2", "500"}})
		case strings.Contains(q, "output_tokens_total") && strings.Contains(q, "by (model)"):
			resp = vectorJSON([][2]string{{"m1", "2000"}, {"m2", "800"}})
		case strings.Contains(q, "time_to_first_token") && strings.Contains(q, "model,le"):
			resp = vectorJSON([][2]string{{"m1", "0.2"}, {"m2", "0.3"}})
		case strings.Contains(q, "inter_token_latency") && strings.Contains(q, "by (model)"):
			resp = vectorJSON([][2]string{{"m1", "0.04"}, {"m2", "0.05"}})
		default:
			resp = vectorJSON(nil)
		}
		_, _ = w.Write([]byte(resp))
	}))
}

func TestUsageMapping(t *testing.T) {
	srv := mockVMSelect()
	defer srv.Close()
	p := New(srv.URL)

	rep, err := p.Usage(context.Background(), domain.Range1h)
	if err != nil {
		t.Fatalf("Usage: %v", err)
	}
	if len(rep.Rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rep.Rows))
	}
	// 요청수 내림차순 정렬 → m1(100) 먼저
	if rep.Rows[0].Model != "m1" || rep.Rows[1].Model != "m2" {
		t.Errorf("정렬 오류: %s, %s", rep.Rows[0].Model, rep.Rows[1].Model)
	}
	r0 := rep.Rows[0]
	if r0.Requests != 100 || r0.PromptTokens != 1000 || r0.CompletionTokens != 2000 {
		t.Errorf("m1 카운트 오류: %+v", r0)
	}
	// 초→ms 변환 검증: 0.2s → 200ms, 0.04s → 40ms
	if r0.TTFTp95ms != 200 || r0.ITLavgMs != 40 {
		t.Errorf("m1 지연 변환 오류: ttft=%v itl=%v (want 200, 40)", r0.TTFTp95ms, r0.ITLavgMs)
	}
}

func TestUsageNaNLatencyIsJSONSafe(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("query")
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(q, "requests_total") && strings.Contains(q, "by (model)"):
			_, _ = w.Write([]byte(vectorJSON([][2]string{{"m1", "1"}})))
		case strings.Contains(q, "time_to_first_token") || strings.Contains(q, "inter_token_latency"):
			_, _ = w.Write([]byte(vectorJSON([][2]string{{"m1", "NaN"}})))
		default:
			_, _ = w.Write([]byte(vectorJSON(nil)))
		}
	}))
	defer srv.Close()

	rep, err := New(srv.URL).Usage(context.Background(), domain.Range1h)
	if err != nil {
		t.Fatalf("Usage: %v", err)
	}
	if len(rep.Rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rep.Rows))
	}
	if rep.Rows[0].TTFTp95ms != 0 || rep.Rows[0].ITLavgMs != 0 {
		t.Fatalf("NaN latency was not sanitized: %+v", rep.Rows[0])
	}
	if _, err := json.Marshal(rep); err != nil {
		t.Fatalf("Usage report must be JSON safe: %v", err)
	}
}

func TestOverviewGPUMapping(t *testing.T) {
	srv := mockVMSelect()
	defer srv.Close()
	p := New(srv.URL)

	ov, err := p.Overview(context.Background(), domain.Range1h)
	if err != nil {
		t.Fatalf("Overview: %v", err)
	}
	// GPU util 80 → 0.8
	if ov.GPU.UsagePerc != 0.8 {
		t.Errorf("usage_perc = %v, want 0.8", ov.GPU.UsagePerc)
	}
	// KV = FB_USED/(USED+FREE) = 20/80 = 0.25
	if ov.GPU.KVCachePerc != 0.25 {
		t.Errorf("kv_cache_perc = %v, want 0.25", ov.GPU.KVCachePerc)
	}
	// MIG = GR_ENGINE_ACTIVE = 0.5
	if ov.GPU.MIGEfficiency != 0.5 {
		t.Errorf("mig_efficiency = %v, want 0.5", ov.GPU.MIGEfficiency)
	}
	// app_usage 는 model 분포로 채워짐(m1,m2) — 합 비율 1.0 근처
	if len(ov.AppUsage) != 2 {
		t.Errorf("app_usage 항목 = %d, want 2", len(ov.AppUsage))
	}
}

func TestEmptyVectorSafe(t *testing.T) {
	// 모든 쿼리가 빈 결과여도 0으로 안전 폴백하는지 (유휴 클러스터 시나리오)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))
	defer srv.Close()
	p := New(srv.URL)

	ov, err := p.Overview(context.Background(), domain.Range1h)
	if err != nil {
		t.Fatalf("Overview(empty): %v", err)
	}
	if ov.GPU.UsagePerc != 0 || ov.Traffic.QPS != 0 {
		t.Errorf("빈 결과인데 0 아님: gpu=%v qps=%v", ov.GPU.UsagePerc, ov.Traffic.QPS)
	}
	rep, err := p.Usage(context.Background(), domain.Range1h)
	if err != nil {
		t.Fatalf("Usage(empty): %v", err)
	}
	if len(rep.Rows) != 0 {
		t.Errorf("빈 결과인데 행 있음: %d", len(rep.Rows))
	}
}
