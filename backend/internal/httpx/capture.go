package httpx

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"sync"
)

// Capture 는 단일 라이브 재프로브("지금 테스트") 1회 왕복의 요청/응답을 기록한다.
// ctx 에 WithCapture 로 심어두면 Capturing 으로 감싼 transport 가 채운다(대량 진단에는 미주입).
// 자격증명(Authorization/키/쿠키)·URL userinfo 는 마스킹, 본문은 maxBody 로 캡.
type Capture struct {
	mu          sync.Mutex
	ReqMethod   string
	ReqURL      string
	ReqHeaders  map[string]string
	ReqBody     string
	StatusCode  int
	HTTPVersion string
	RespHeaders map[string]string
	RespBody    string
}

type captureKey struct{}

// WithCapture 는 ctx 에 새 Capture 를 심고 (ctx, recorder) 를 반환한다.
func WithCapture(ctx context.Context) (context.Context, *Capture) {
	rec := &Capture{}
	return context.WithValue(ctx, captureKey{}, rec), rec
}

func captureFrom(ctx context.Context) *Capture {
	rec, _ := ctx.Value(captureKey{}).(*Capture)
	return rec
}

const maxBody = 2048 // 본문 미리보기 상한(B)

// Capturing 은 base(nil 이면 DefaultTransport)를 감싸 ctx 에 Capture 가 있을 때만 기록한다.
// 캡처가 없으면 그대로 위임(대량 진단·일반 호출은 영향 0).
func Capturing(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return &captureTransport{base: base}
}

type captureTransport struct{ base http.RoundTripper }

func (t *captureTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	rec := captureFrom(req.Context())
	if rec == nil {
		return t.base.RoundTrip(req)
	}

	reqBody := ""
	if req.Body != nil && req.GetBody != nil { // 비파괴 읽기(GetBody 로 사본)
		if rc, err := req.GetBody(); err == nil {
			b, _ := io.ReadAll(io.LimitReader(rc, maxBody))
			rc.Close()
			reqBody = string(b)
		}
	}

	resp, err := t.base.RoundTrip(req)

	rec.mu.Lock()
	defer rec.mu.Unlock()
	rec.ReqMethod = req.Method
	rec.ReqURL = redactURL(req.URL.String())
	rec.ReqHeaders = maskHeaders(req.Header)
	rec.ReqBody = reqBody
	if err != nil || resp == nil {
		return resp, err
	}
	rec.StatusCode = resp.StatusCode
	rec.HTTPVersion = resp.Proto
	rec.RespHeaders = maskHeaders(resp.Header)
	if resp.Body != nil { // 본문 읽고 되감아 호출자가 계속 읽게(io.ReadCloser 소비 주의)
		full, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		resp.Body = io.NopCloser(bytes.NewReader(full))
		snippet := full
		if len(snippet) > maxBody {
			snippet = snippet[:maxBody]
		}
		rec.RespBody = string(snippet)
	}
	return resp, err
}

var sensitiveHeader = map[string]bool{
	"authorization": true, "proxy-authorization": true, "cookie": true, "set-cookie": true,
}

// maskHeaders 는 자격증명/키/토큰 헤더 값을 *** 로 가린다.
func maskHeaders(h http.Header) map[string]string {
	out := make(map[string]string, len(h))
	for k, v := range h {
		lk := strings.ToLower(k)
		val := strings.Join(v, ", ")
		if sensitiveHeader[lk] || strings.Contains(lk, "key") || strings.Contains(lk, "token") || strings.Contains(lk, "secret") {
			val = "***"
		}
		out[k] = val
	}
	return out
}

// redactURL 은 URL 의 userinfo(user:pass@)를 가린다.
func redactURL(u string) string {
	i := strings.Index(u, "://")
	if i < 0 {
		return u
	}
	rest := u[i+3:]
	at := strings.Index(rest, "@")
	slash := strings.Index(rest, "/")
	if at >= 0 && (slash < 0 || at < slash) {
		return u[:i+3] + "***@" + rest[at+1:]
	}
	return u
}
