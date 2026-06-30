// Package glue 는 게이트웨이(Semantic Router) 옆에서 동작하는 작은 캡처 서비스다.
//
// 역할: 추론 요청의 프롬프트·응답·가드레일 판정을 받아(HTTP /v1/capture),
//  1. FABRIX BFF 의 마스킹 정책을 폴링·캐시해 적용하고(원문/마스킹/미저장),
//  2. 요청의 W3C trace-id 로 Langfuse ingestion 배치를 만들어(동일 trace 병합),
//  3. 비동기로 Langfuse `/api/public/ingestion` 에 전송한다.
//
// FABRIX BFF 와 분리된 데이터플레인 컴포넌트다(BFF 는 추론 경로 밖). 외부 의존 없이 stdlib + domain 만 쓴다.
// 실제 게이트웨이 연결(ext_proc / 사이드카 / 로그 tailer)은 이 서비스의 /v1/capture 를 호출하면 된다.
package glue

import (
	"os"
	"strconv"
	"time"
)

// Config 는 글루 런타임 설정(전부 환경변수).
type Config struct {
	// Addr 은 캡처 HTTP 리슨 주소(게이트웨이/어댑터가 호출). 기본 ":8090".
	Addr string
	// BFFURL 은 마스킹 정책 소스(FABRIX BFF). 예: http://fabrix-endpoint.fabrix-endpoint:8080
	BFFURL string
	// PollInterval 은 마스킹 정책 폴링 주기. 기본 30s.
	PollInterval time.Duration
	// Langfuse OTLP 가 아닌 ingestion REST 대상(원문 캡처용).
	LangfuseHost   string // 예: http://langfuse-web.langfuse:3000
	LangfusePublic string // pk-lf-...
	LangfuseSecret string // sk-lf-...
	// MaskSalt 은 해시 마스킹 솔트(비식별). 운영은 Secret 주입.
	MaskSalt string
}

// Load 는 환경변수에서 설정을 읽는다.
func Load() Config {
	return Config{
		Addr:           env("GLUE_ADDR", ":8090"),
		BFFURL:         env("FABRIX_BFF_URL", "http://localhost:8080"),
		PollInterval:   time.Duration(envInt("GLUE_MASKING_POLL_SECONDS", 30)) * time.Second,
		LangfuseHost:   env("LANGFUSE_HOST", ""),
		LangfusePublic: env("LANGFUSE_PUBLIC_KEY", ""),
		LangfuseSecret: env("LANGFUSE_SECRET_KEY", ""),
		MaskSalt:       env("GLUE_MASK_SALT", "fabrix-glue-salt"),
	}
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
