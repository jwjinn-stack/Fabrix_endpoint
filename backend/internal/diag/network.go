package diag

import (
	"bufio"
	"context"
	"net"
	"net/url"
	"os"
	"strings"
	"time"
)

// Network 는 파드 레벨 네트워크/설정 점검 결과(의존성 무관, 1회).
// "쿠버에 배포했을 때 통신 설정이 제대로 됐는가"를 프로브 던지기 전에 미리 보여준다:
// 이름 해석(CoreDNS)·resolv.conf·인클러스터 토큰·프록시 함정·env→호스트 해석.
type Network struct {
	InCluster     bool        `json:"in_cluster"`            // serviceaccount 토큰 + KUBERNETES_SERVICE_HOST
	APIServer     string      `json:"api_server,omitempty"`  // in-cluster API 주소(host:port)
	KubeDNS       []string    `json:"kube_dns"`              // /etc/resolv.conf nameserver
	SearchDomains []string    `json:"search_domains"`        // resolv.conf search (네임스페이스 보강)
	HTTPProxy     string      `json:"http_proxy,omitempty"`  // env(자격증명 마스킹)
	HTTPSProxy    string      `json:"https_proxy,omitempty"` // env(자격증명 마스킹)
	NoProxy       string      `json:"no_proxy,omitempty"`    // env
	ProxyWarnings []string    `json:"proxy_warnings,omitempty"`
	Hosts         []HostCheck `json:"hosts"` // 의존성 호스트별 설정 해석 + DNS
}

// HostCheck 는 의존성 1개의 설정 해석(env→scheme/host/port) + 이름 해석 결과.
type HostCheck struct {
	Name      string   `json:"name"`                // 의존성 이름(harbor 등)
	EnvKey    string   `json:"env_key"`             // FABRIX_HARBOR_URL
	Scheme    string   `json:"scheme,omitempty"`    // http|https
	Host      string   `json:"host,omitempty"`      // 호스트(creds 없음)
	Port      string   `json:"port,omitempty"`      // 포트(기본 추론 포함)
	Resolved  []string `json:"resolved,omitempty"`  // 해석된 IP 목록
	LatencyMs int64    `json:"latency_ms"`          // DNS 해석 소요
	Error     string   `json:"error,omitempty"`     // 해석 실패 사유
	ProxyVia  string   `json:"proxy_via,omitempty"` // 프록시 경유 시 경고 라벨
}

// DepEndpoint 는 BuildNetwork 입력(의존성 이름 + env 키 + 원문 URL).
// 원문 URL 은 creds 가 섞여 있을 수 있어 BuildNetwork 내부에서만 파싱하고 host 만 보관한다.
type DepEndpoint struct {
	Name   string
	EnvKey string
	RawURL string
}

// BuildNetwork 는 파드 네트워크/설정 점검을 1회 수행한다. now 는 주입(결정성).
func BuildNetwork(ctx context.Context, deps []DepEndpoint) *Network {
	n := &Network{}

	// 인클러스터 판별: API server env + serviceaccount 토큰 존재.
	host := os.Getenv("KUBERNETES_SERVICE_HOST")
	if host != "" {
		port := os.Getenv("KUBERNETES_SERVICE_PORT")
		n.APIServer = net.JoinHostPort(host, defaultStr(port, "443"))
	}
	if _, err := os.Stat("/var/run/secrets/kubernetes.io/serviceaccount/token"); err == nil && host != "" {
		n.InCluster = true
	}

	n.KubeDNS, n.SearchDomains = readResolvConf("/etc/resolv.conf")

	// 프록시 env(자격증명 마스킹).
	n.HTTPProxy = Redact(firstEnv("HTTP_PROXY", "http_proxy"))
	n.HTTPSProxy = Redact(firstEnv("HTTPS_PROXY", "https_proxy"))
	n.NoProxy = firstEnv("NO_PROXY", "no_proxy")
	proxyActive := n.HTTPProxy != "" || n.HTTPSProxy != ""

	for _, d := range deps {
		hc := HostCheck{Name: d.Name, EnvKey: d.EnvKey}
		if d.RawURL == "" {
			hc.Error = "미구성(env 비어 있음)"
			n.Hosts = append(n.Hosts, hc)
			continue
		}
		host, scheme, port := parseHostPort(d.RawURL)
		hc.Scheme, hc.Host, hc.Port = scheme, host, port
		if host == "" {
			hc.Error = "URL 파싱 실패(scheme 누락?)"
			n.Hosts = append(n.Hosts, hc)
			continue
		}

		// 이름 해석(CoreDNS) — no such host 면 서비스명/네임스페이스/search domain 문제.
		start := time.Now()
		ips, err := net.DefaultResolver.LookupHost(ctx, host)
		hc.LatencyMs = time.Since(start).Milliseconds()
		if err != nil {
			hc.Error = err.Error()
		} else {
			hc.Resolved = ips
		}

		// 프록시 함정: 인클러스터(.svc/단일라벨/.local) 호스트가 NO_PROXY 에 없는데 프록시 활성.
		if proxyActive && isClusterLocal(host) && !noProxyCovers(n.NoProxy, host) {
			hc.ProxyVia = "프록시 경유 위험 — 인클러스터 호스트는 NO_PROXY 에 추가 필요"
		}
		n.Hosts = append(n.Hosts, hc)
	}

	if proxyActive {
		var bad []string
		for _, h := range n.Hosts {
			if h.ProxyVia != "" {
				bad = append(bad, h.Host)
			}
		}
		if len(bad) > 0 {
			n.ProxyWarnings = append(n.ProxyWarnings,
				"프록시가 활성인데 인클러스터 호스트가 NO_PROXY 에 없음: "+strings.Join(bad, ", "))
		}
	}
	return n
}

// parseHostPort 는 URL 에서 scheme/host/port 를 뽑는다(creds 제거, 기본 포트 추론).
func parseHostPort(raw string) (host, scheme, port string) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", "", ""
	}
	scheme = u.Scheme
	host = u.Hostname()
	port = u.Port()
	if port == "" {
		switch scheme {
		case "https":
			port = "443"
		case "http":
			port = "80"
		}
	}
	return host, scheme, port
}

// readResolvConf 는 nameserver·search 도메인을 파싱한다(없으면 빈 슬라이스).
func readResolvConf(path string) (ns, search []string) {
	f, err := os.Open(path)
	if err != nil {
		return []string{}, []string{}
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 {
			continue
		}
		switch fields[0] {
		case "nameserver":
			ns = append(ns, fields[1])
		case "search":
			search = append(search, fields[1:]...)
		}
	}
	if ns == nil {
		ns = []string{}
	}
	if search == nil {
		search = []string{}
	}
	return ns, search
}

// isClusterLocal 은 호스트가 인클러스터(서비스 DNS)로 보이는지 휴리스틱 판별한다.
func isClusterLocal(host string) bool {
	if net.ParseIP(host) != nil {
		return false // IP 직접 지정은 프록시 함정 대상 아님
	}
	if !strings.Contains(host, ".") {
		return true // 단일 라벨 = 같은 네임스페이스 서비스
	}
	return strings.Contains(host, ".svc") ||
		strings.HasSuffix(host, ".local") ||
		strings.HasSuffix(host, ".cluster.local")
}

// noProxyCovers 는 NO_PROXY 목록이 host 를 포괄하는지(접미사/와일드카드) 본다.
func noProxyCovers(noProxy, host string) bool {
	if noProxy == "" {
		return false
	}
	for _, p := range strings.Split(noProxy, ",") {
		p = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(p), "*"))
		if p == "" {
			continue
		}
		if p == host || strings.HasSuffix(host, p) || strings.HasSuffix(host, "."+strings.TrimPrefix(p, ".")) {
			return true
		}
	}
	return false
}

func firstEnv(keys ...string) string {
	for _, k := range keys {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return ""
}

func defaultStr(v, def string) string {
	if v == "" {
		return def
	}
	return v
}
