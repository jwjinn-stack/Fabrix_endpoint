// Package config 는 환경변수에서 서버 설정을 읽는다.
// 실제 데이터 소스(Prometheus/ClickHouse) 연동 시 여기에 엔드포인트 설정이 추가된다.
package config

import (
	"os"
	"strconv"
	"strings"
)

// Config 는 FABRIX Endpoint API 서버 런타임 설정.
type Config struct {
	// Addr 은 HTTP 리슨 주소 (예: ":8080").
	Addr string
	// AllowedOrigins 는 CORS 허용 오리진 목록. 개발 시 Vite 데브서버.
	AllowedOrigins []string
	// DataSource 는 데이터 제공자 선택 ("mock" | "live"). MVP 는 mock.
	DataSource string
	// VMSelectURL 은 VictoriaMetrics(vmselect) Prometheus 쿼리 베이스 URL.
	// 예(인클러스터): http://vmselect-vm.observability:8481/select/0/prometheus
	// 예(로컬 dev):   http://192.168.160.75:30401/select/0/prometheus
	VMSelectURL string
	// GemmaUpstream 은 gemma4 Dynamo 프론트엔드 OpenAI 베이스 URL(플레이그라운드 프록시용).
	// dev(머신→NodePort): http://192.168.160.75:30812
	// 인클러스터: http://gemma4-31b-vllm-agg-frontend-nodeport.dynamo-inference:8000
	GemmaUpstream string
	// DatabaseURL 은 PostgreSQL(CNPG) 연결 문자열. 비면 키·앱 기능 비활성.
	// 인클러스터: postgres://fabrix:<pw>@fabrix-pg-rw.fabrix-endpoint:5432/fabrix
	// dev: port-forward 후 postgres://fabrix:<pw>@localhost:5432/fabrix
	DatabaseURL string
	// SRURL 은 Semantic Router HTTP classify API 베이스 URL. 비면 가드레일 비활성(통과).
	// 인클러스터: http://semantic-router.vllm-semantic-router-system:8080
	// dev: port-forward 후 http://localhost:18080
	SRURL string
	// ClickHouseURL 은 ClickHouse HTTP 인터페이스(creds 포함). 비면 증적 적재/조회 비활성.
	// 인클러스터: http://fabrix:<pw>@clickhouse.fabrix-endpoint:8123
	// dev: port-forward 후 http://fabrix:fabrix_dev@localhost:18123
	ClickHouseURL string
	// AuditSalt 는 user_ref 비식별 해시 솔트. (운영은 Secret 주입)
	AuditSalt string
	// PolicyVersion 은 가드레일 정책 버전(증적에 기록).
	PolicyVersion string
	// KubectlPath 는 엔드포인트(DynamoGraphDeployment CR) 조작용 kubectl 경로(dev). 비면 "kubectl".
	KubectlPath string
	// EndpointsNS 는 엔드포인트 생성 기본 네임스페이스.
	EndpointsNS string
	// WORMURL 은 MinIO/ObjectScale S3 엔드포인트(creds 포함). 비면 WORM 보존 비활성.
	// dev: http://fabrixadmin:fabrix_worm_dev@192.168.160.43:30903
	WORMURL string
	// WORMBucket 은 Object Lock 버킷명. WORMRetainDays 는 보존 기간(일).
	WORMBucket     string
	WORMRetainDays int
	// HarborURL 은 Harbor 레지스트리 API(creds 포함). 모델 저장소 조회/임포트.
	// dev: http://admin:<pw>@192.168.160.43:30834
	HarborURL string
}

// Load 는 환경변수에서 설정을 읽고, 없으면 개발 친화적 기본값을 쓴다.
func Load() Config {
	return Config{
		Addr:           env("FABRIX_API_ADDR", ":8080"),
		AllowedOrigins: splitCSV(env("FABRIX_ALLOWED_ORIGINS", "http://localhost:5173")),
		DataSource:     env("FABRIX_DATA_SOURCE", "mock"),
		VMSelectURL:    env("FABRIX_VMSELECT_URL", "http://vmselect-vm.observability:8481/select/0/prometheus"),
		GemmaUpstream:  env("FABRIX_GEMMA_UPSTREAM", "http://gemma4-31b-vllm-agg-frontend-nodeport.dynamo-inference:8000"),
		DatabaseURL:    env("FABRIX_DATABASE_URL", ""),
		SRURL:          env("FABRIX_SR_URL", ""),
		ClickHouseURL:  env("FABRIX_CLICKHOUSE_URL", ""),
		AuditSalt:      env("FABRIX_AUDIT_SALT", "fabrix-dev-salt"),
		PolicyVersion:  env("FABRIX_POLICY_VERSION", "v1"),
		KubectlPath:    env("FABRIX_KUBECTL", ""),
		EndpointsNS:    env("FABRIX_ENDPOINTS_NS", "dynamo-inference"),
		WORMURL:        env("FABRIX_WORM_URL", ""),
		WORMBucket:     env("FABRIX_WORM_BUCKET", "fabrix-worm"),
		WORMRetainDays: envInt("FABRIX_WORM_RETAIN_DAYS", 365),
		HarborURL:      env("FABRIX_HARBOR_URL", ""),
	}
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
