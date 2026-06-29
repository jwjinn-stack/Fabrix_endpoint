# gateway-glue — 프롬프트/응답 원문 캡처 서비스

게이트웨이(Semantic Router) 옆에서 동작하는 작은 데이터플레인 컴포넌트. vLLM OTEL 이 보내지 않는
**프롬프트/응답 원문**을 마스킹 정책 통제하에 Langfuse 로 채운다. (배경: [docs/integration/k8s-otel-langfuse-연동.md §4.5](../../../docs/integration/k8s-otel-langfuse-연동.md))

## 하는 일
1. FABRIX BFF 의 **마스킹 정책 폴링·캐시** (`GET {bff}/api/v1/masking/policy`, 기본 30s).
2. 게이트웨이/어댑터가 보낸 캡처 1건을 **정책대로 마스킹**(none/masked/full + PII 유형별 보관/마스킹/해시/제거).
3. 요청의 **W3C trace-id 로 Langfuse ingestion 배치** 생성(GUARDRAIL observation + GENERATION + score) → OTEL 스팬과 한 트레이스로 병합.
4. **비동기 배치 전송**(audit Sink 패턴, 최대 100건/1초).

> BFF 와 분리(추론 경로 밖). 외부 의존 0 — stdlib + `internal/domain` 만.

## 실행
```bash
go run ./cmd/glue        # 또는 go build -o glue ./cmd/glue
```

### 환경변수
| 변수 | 기본 | 설명 |
|---|---|---|
| `GLUE_ADDR` | `:8090` | 캡처 HTTP 리슨 |
| `FABRIX_BFF_URL` | `http://localhost:8080` | 마스킹 정책 소스 |
| `GLUE_MASKING_POLL_SECONDS` | `30` | 정책 폴링 주기 |
| `LANGFUSE_HOST` | (없음) | 예: `http://langfuse-web.langfuse:3000`. 비면 전송 비활성 |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | (없음) | `pk-lf-` / `sk-lf-` |
| `GLUE_MASK_SALT` | `fabrix-glue-salt` | 해시 마스킹 솔트(운영은 Secret) |

## API (게이트웨이/어댑터가 호출)
```
POST /v1/capture     # JSON CaptureRequest → 202 Accepted (비동기 적재)
GET  /healthz
```

### CaptureRequest (요지)
```json
{
  "traceparent": "00-<32hex trace-id>-<16hex span-id>-01",   // OTEL 스팬과 병합 키(권장)
  "session_id": "...", "user_id": "<해시>", "app_id": "...", "dept_id": "...",
  "model": "gemma-4-31b-it",
  "prompt": "<원문>", "response": "<원문>",                    // 글루가 정책대로 마스킹
  "decision": "blocked", "guard_types": ["jailbreak"], "jb_confidence": 0.95,
  "pii_entities": [{"type":"name","value":"홍길동"}],          // SR 정밀 스팬(있으면 우선)
  "start_time": "...", "completion_start_time": "...", "end_time": "...",
  "prompt_tokens": 123, "completion_tokens": 45
}
```

## 게이트웨이 연결(어댑터)
`/v1/capture` 는 게이트웨이 비종속 인터페이스다. 다음 중 하나로 호출:
- **Envoy ext_proc** 확장에서 요청/응답/판정을 모아 POST
- SR/게이트웨이 **사이드카**
- 게이트웨이 **액세스로그 tailer**(Vector/Fluent Bit → HTTP)

## 검증 상태
- ✅ 마스킹 엔진 단위테스트(`internal/glue`): 캡처모드·유형별 처리·entity 우선·partial mask.
- ⏳ 종단(실 Langfuse 전송)은 서버 구성 후. `LANGFUSE_HOST` 미설정 시 전송 비활성(큐 no-op)이라 HTTP 표면만 검증 가능.
