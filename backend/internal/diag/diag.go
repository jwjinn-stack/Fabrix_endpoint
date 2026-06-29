// Package diag 는 외부 의존성에 대한 능동 헬스 프로브 결과(연동 상태)를 표현한다.
//
// 실사이트 연동·디버깅용: server.handleDiagnostics 가 각 클라이언트의 Probe 를 동시
// 실행해 "이 Pod 에서 무엇이 실제로 도달 가능한가"를 한 번에 보여준다. /capabilities 의
// integrations(설정 여부)보다 한 단계 깊은, 실제 연결성·지연·에러를 담는다.
//
// 단순 도달성(L1)에 더해, HTTP 프로브에는 net/http/httptrace 를 ctx 로 주입해
// DNS→TCP→TLS→TTFB 단계 타이밍(L2)·TLS 인증서·실패 원인 분류를 프로브 코드 변경 없이
// 수집한다. 쿠버네티스 배포 시 "어디서 끊겼는지(이름해석/포트/인증서/인증/방화벽)"를
// 엔지니어가 바로 짚도록 하는 것이 목적이다.
package diag

import (
	"context"
	"crypto/tls"
	"net/http/httptrace"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// 실패 원인 분류(FailKind) — 사용자가 취할 조치가 종류마다 다르다.
const (
	KindOK          = "ok"
	KindDNSFail     = "dns_fail"     // 이름 해석 실패: 서비스명 오타 / CoreDNS / search domain
	KindConnRefused = "conn_refused" // TCP 거부: 포트·NetworkPolicy egress·Pod 미기동
	KindTLSFail     = "tls_fail"     // TLS/인증서: CA·SNI·만료·프록시 MITM
	KindAuthFail    = "auth_fail"    // 401/403: 키·시크릿·RBAC
	KindTimeout     = "timeout"      // 시간초과: 방화벽 drop·과부하·잘못된 IP
	KindBadStatus   = "bad_status"   // 도달했으나 4xx/5xx: 업스트림 자체 이상
	KindUnreachable = "unreachable"  // 분류 불가
)

// Timing 은 단일 HTTP 프로브의 단계별 소요(ms). 미측정 단계는 0. 비-HTTP 프로브는 nil.
type Timing struct {
	DNSMs     int64 `json:"dns_ms"`     // 이름 해석
	ConnectMs int64 `json:"connect_ms"` // TCP 3-way 핸드셰이크
	TLSMs     int64 `json:"tls_ms"`     // TLS 핸드셰이크
	TTFBMs    int64 `json:"ttfb_ms"`    // 첫 응답 바이트까지(서버 처리 포함)
	ServerMs  int64 `json:"server_ms"`  // TTFB - (DNS+Connect+TLS) ≈ 순수 서버 처리 추정
	TotalMs   int64 `json:"total_ms"`
	Reused    bool  `json:"reused"` // keep-alive 커넥션 재사용(GotConnInfo.Reused)
}

// TLSInfo 는 https 프로브에서 협상된 인증서/세션 정보(사내 인증서 만료·CA 디버깅용).
type TLSInfo struct {
	Version  string `json:"version"`   // 예: "TLS 1.3"
	Cipher   string `json:"cipher"`    // 예: "TLS_AES_128_GCM_SHA256"
	Subject  string `json:"subject"`   // 서버 인증서 CN
	Issuer   string `json:"issuer"`    // 발급자
	NotAfter string `json:"not_after"` // 만료일(RFC3339)
	DaysLeft int    `json:"days_left"` // 만료까지 남은 일(음수면 이미 만료)
}

// ProbeRequest 는 이 프로브가 실제로 보내는 요청의 명세(클릭 시 "무슨 요청을 API 에 보내나" 확인용).
// 정적 메타데이터 — 코드가 실제 던지는 요청과 1:1(메서드·대상·인증·기대 응답).
type ProbeRequest struct {
	Method string `json:"method"`           // GET|POST|SQL|TCP|EXEC|S3
	Target string `json:"target"`           // /api/v2.0/projects?page_size=1  또는 SELECT 1
	Auth   string `json:"auth,omitempty"`   // Basic|Bearer|none
	Body   string `json:"body,omitempty"`   // POST 본문 미리보기
	Expect string `json:"expect,omitempty"` // 기대 응답(예: 200 JSON array)
}

// ProbeTrace 는 단일 라이브 재프로브("지금 테스트") 1회 왕복의 실제 요청/응답(캡처).
// httpx.Capture 에서 채워 server 가 부착한다(자격증명 마스킹·본문 캡). HTTP 프로브에만.
type ProbeTrace struct {
	ReqMethod   string            `json:"req_method,omitempty"`
	ReqURL      string            `json:"req_url,omitempty"`
	ReqHeaders  map[string]string `json:"req_headers,omitempty"`
	ReqBody     string            `json:"req_body,omitempty"`
	StatusCode  int               `json:"status_code,omitempty"`
	HTTPVersion string            `json:"http_version,omitempty"`
	RespHeaders map[string]string `json:"resp_headers,omitempty"`
	RespBody    string            `json:"resp_body,omitempty"`
}

// Sample 은 history(추세 sparkline)용 1회 측정.
type Sample struct {
	At        string `json:"at"`
	Reachable bool   `json:"reachable"`
	LatencyMs int64  `json:"latency_ms"`
	FailKind  string `json:"fail_kind,omitempty"`
}

// Status 는 단일 외부 의존성의 진단 결과.
type Status struct {
	Name         string   `json:"name"`                    // 식별자 (예: clickhouse_audit)
	Title        string   `json:"title"`                   // 표시명
	Category     string   `json:"category"`                // 메트릭|증적|사용량|가드레일|트레이스|키스토어|모델레지스트리|오케스트레이션|추론|보존
	Endpoint     string   `json:"endpoint"`                // 대상 URL(자격증명 제거)
	Configured   bool     `json:"configured"`              // env 로 구성됨
	Reachable    bool     `json:"reachable"`               // 능동 프로브 성공
	LatencyMs    int64    `json:"latency_ms"`              // 프로브 왕복(ms)
	Error        string   `json:"error,omitempty"`         // 실패 사유(자격증명 비포함)
	Optional     bool     `json:"optional"`                // 미구성 시 graceful 폴백(true)인지 필수인지
	RequiredBy   []string `json:"required_by"`             // 이 의존성이 받쳐주는 capability 들
	FallbackNote string   `json:"fallback_note,omitempty"` // 미구성/실패 시 동작 설명

	// L2/L3 — 통신 디버깅 상세(능동 프로브 시에만 채워짐).
	Request    *ProbeRequest  `json:"request,omitempty"`     // 이 프로브가 API 에 보내는 요청 명세
	FailKind   string         `json:"fail_kind,omitempty"`   // 실패 원인 분류(위 Kind*)
	RemoteAddr string         `json:"remote_addr,omitempty"` // 실제 연결된 IP:port(해석 결과 확인)
	Timing     *Timing        `json:"timing,omitempty"`      // 단계별 타이밍(HTTP 프로브)
	TLS        *TLSInfo       `json:"tls,omitempty"`         // TLS 인증서 정보(https)
	Details    map[string]any `json:"details,omitempty"`     // 클라이언트별 진단 데이터(verbose)
	History    []Sample       `json:"history,omitempty"`     // 최근 N회 추세(sparkline)
	Probe      *ProbeTrace    `json:"probe,omitempty"`       // 단일 재프로브의 실제 요청/응답(server 부착)
}

// Summary 는 집계.
type Summary struct {
	Total      int `json:"total"`
	Configured int `json:"configured"`
	Reachable  int `json:"reachable"`
	Degraded   int `json:"degraded"` // configured 인데 unreachable (실제 문제)
}

// Report 는 전체 연동 상태.
type Report struct {
	GeneratedAt string   `json:"generated_at"`
	Profile     string   `json:"profile"`
	Verbose     bool     `json:"verbose"`
	Summary     Summary  `json:"summary"`
	Network     *Network `json:"network,omitempty"` // 파드 레벨 네트워크/설정 점검(network.go)
	Checks      []Status `json:"checks"`
}

// Prober 는 의존성 1개의 진단 정의. Probe 가 nil 이거나 Configured=false 면 프로브를 건너뛴다.
type Prober struct {
	Name, Title, Category string
	Endpoint              string
	Configured            bool
	Optional              bool
	RequiredBy            []string
	FallbackNote          string
	Request               *ProbeRequest // 이 프로브가 보내는 요청 명세(표시용, 코드와 1:1)
	Probe                 func(ctx context.Context) error
	// Details 는 verbose 모드에서만 호출되는 선택적 심층 진단(추가 왕복 가능). nil 이면 생략.
	Details func(ctx context.Context) map[string]any
}

// Run 은 모든 Prober 를 동시 실행해 Report 를 만든다(전체는 가장 느린 프로브 시간).
// now 는 호출자가 주입(테스트 결정성). 각 Probe 자체 타임아웃은 클라이언트가 건다.
// verbose=true 면 Prober.Details(추가 왕복)까지 수집한다.
func Run(ctx context.Context, profile string, now time.Time, verbose bool, probers []Prober) Report {
	checks := make([]Status, len(probers))
	var wg sync.WaitGroup
	for i, p := range probers {
		st := Status{
			Name: p.Name, Title: p.Title, Category: p.Category, Endpoint: p.Endpoint,
			Configured: p.Configured, Optional: p.Optional, RequiredBy: p.RequiredBy,
			FallbackNote: p.FallbackNote, Request: p.Request,
		}
		if st.RequiredBy == nil {
			st.RequiredBy = []string{}
		}
		if !p.Configured || p.Probe == nil {
			checks[i] = st // 미구성 → 프로브 생략
			continue
		}
		wg.Add(1)
		go func(i int, p Prober, st Status) {
			defer wg.Done()
			runProbe(ctx, now, verbose, p, &st)
			checks[i] = st
		}(i, p, st)
	}
	wg.Wait()

	var sum Summary
	sum.Total = len(checks)
	for _, c := range checks {
		if c.Configured {
			sum.Configured++
		}
		if c.Reachable {
			sum.Reachable++
		}
		if c.Configured && !c.Reachable {
			sum.Degraded++
		}
	}
	return Report{
		GeneratedAt: now.UTC().Format(time.RFC3339),
		Profile:     profile,
		Verbose:     verbose,
		Summary:     sum,
		Checks:      checks,
	}
}

// runProbe 는 ctx 에 httptrace 를 심어 단계 타이밍·TLS 를 수집하면서 1개 프로브를 실행한다.
// HTTP 프로브는 ctx 를 그대로 http.NewRequestWithContext 에 넘기므로 코드 변경 없이 계측된다.
// 비-HTTP 프로브(pgx Ping, kubectl)는 콜백이 안 울리므로 Timing/TLS 는 nil 로 남는다.
func runProbe(ctx context.Context, now time.Time, verbose bool, p Prober, st *Status) {
	var t Timing
	var dnsStart, connStart, tlsStart time.Time
	var httpSeen bool // 콜백이 1회라도 울렸는가(HTTP 프로브 판별)
	start := time.Now()

	trace := &httptrace.ClientTrace{
		DNSStart: func(httptrace.DNSStartInfo) { httpSeen = true; dnsStart = time.Now() },
		DNSDone: func(httptrace.DNSDoneInfo) {
			if !dnsStart.IsZero() {
				t.DNSMs = msSince(dnsStart)
			}
		},
		ConnectStart: func(_, _ string) { httpSeen = true; connStart = time.Now() },
		ConnectDone: func(_, addr string, err error) {
			if !connStart.IsZero() {
				t.ConnectMs = msSince(connStart)
			}
			if err == nil && st.RemoteAddr == "" {
				st.RemoteAddr = addr
			}
		},
		TLSHandshakeStart: func() { httpSeen = true; tlsStart = time.Now() },
		TLSHandshakeDone: func(cs tls.ConnectionState, err error) {
			if !tlsStart.IsZero() {
				t.TLSMs = msSince(tlsStart)
			}
			if err == nil {
				st.TLS = tlsInfoFrom(cs, now)
			}
		},
		GotConn: func(g httptrace.GotConnInfo) {
			httpSeen = true
			t.Reused = g.Reused
			if g.Conn != nil && st.RemoteAddr == "" {
				st.RemoteAddr = g.Conn.RemoteAddr().String()
			}
		},
		GotFirstResponseByte: func() { t.TTFBMs = msSince(start) },
	}

	pctx := httptrace.WithClientTrace(ctx, trace)
	err := p.Probe(pctx)

	st.LatencyMs = msSince(start)
	t.TotalMs = st.LatencyMs
	t.ServerMs = t.TTFBMs - (t.DNSMs + t.ConnectMs + t.TLSMs)
	if t.ServerMs < 0 {
		t.ServerMs = 0
	}
	if httpSeen {
		st.Timing = &t
	}

	if err != nil {
		st.Error = err.Error()
		st.FailKind = classify(err.Error())
	} else {
		st.Reachable = true
		st.FailKind = KindOK
		if verbose && p.Details != nil {
			st.Details = p.Details(ctx)
		}
	}
}

var statusCodeRe = regexp.MustCompile(`\b([45]\d\d)\b`)

// classify 는 에러 문자열로 실패 원인을 분류한다(사용자 조치가 종류마다 다름).
func classify(msg string) string {
	m := strings.ToLower(msg)
	switch {
	case strings.Contains(m, "no such host"), strings.Contains(m, "server misbehaving"),
		strings.Contains(m, "lookup ") && strings.Contains(m, "no such"):
		return KindDNSFail
	case strings.Contains(m, "x509"), strings.Contains(m, "tls:"),
		strings.Contains(m, "certificate"):
		return KindTLSFail
	case strings.Contains(m, "connection refused"):
		return KindConnRefused
	case strings.Contains(m, "deadline exceeded"), strings.Contains(m, "timeout"),
		strings.Contains(m, "i/o timeout"), strings.Contains(m, "context canceled"):
		return KindTimeout
	}
	if mm := statusCodeRe.FindStringSubmatch(msg); mm != nil {
		switch mm[1] {
		case "401", "403", "407":
			return KindAuthFail
		default:
			return KindBadStatus
		}
	}
	return KindUnreachable
}

// tlsInfoFrom 은 협상된 ConnectionState 에서 표시용 TLS 정보를 추출한다.
func tlsInfoFrom(cs tls.ConnectionState, now time.Time) *TLSInfo {
	info := &TLSInfo{
		Version: tlsVersionName(cs.Version),
		Cipher:  tls.CipherSuiteName(cs.CipherSuite),
	}
	if len(cs.PeerCertificates) > 0 {
		c := cs.PeerCertificates[0]
		info.Subject = c.Subject.CommonName
		info.Issuer = c.Issuer.CommonName
		info.NotAfter = c.NotAfter.UTC().Format(time.RFC3339)
		info.DaysLeft = int(c.NotAfter.Sub(now).Hours() / 24)
	}
	return info
}

func tlsVersionName(v uint16) string {
	switch v {
	case tls.VersionTLS13:
		return "TLS 1.3"
	case tls.VersionTLS12:
		return "TLS 1.2"
	case tls.VersionTLS11:
		return "TLS 1.1"
	case tls.VersionTLS10:
		return "TLS 1.0"
	default:
		return "unknown"
	}
}

func msSince(t time.Time) int64 { return time.Since(t).Milliseconds() }

// Redact 는 URL 에서 자격증명(비밀번호)·경로·쿼리를 제거해 표시용 문자열로 만든다.
// 파싱 실패 시 빈 문자열(원문에 자격증명이 섞여 있을 수 있어 절대 그대로 노출하지 않음).
func Redact(raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if u.User != nil {
		u.User = url.User(u.User.Username()) // 비밀번호 제거, 사용자명만 유지
	}
	u.Path, u.RawQuery, u.Fragment = "", "", ""
	return u.String()
}
