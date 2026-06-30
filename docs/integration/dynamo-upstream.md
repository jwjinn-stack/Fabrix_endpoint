# Dynamo / vLLM 추론 업스트림 — OpenAI 호환

플레이그라운드 채팅 프록시 + 모델 카탈로그 readiness. 모든 서빙 모델은 OpenAI 호환 HTTP API 를 노출한다.

- 코드: [`backend/internal/catalog/catalog.go`](../../backend/internal/catalog/catalog.go), [`backend/internal/server/catalog.go`](../../backend/internal/server/catalog.go)
- capability: `playground`(채팅), `models`(상태표시) · 프로파일: manage 핵심, observe 는 상태표시만

## 연결
| 항목 | 값 |
|---|---|
| env | `FABRIX_GEMMA_UPSTREAM` (gemma 만 주입; 나머지는 인클러스터 DNS 고정) |
| 인클러스터(gemma) | `http://gemma4-31b-vllm-agg-frontend-nodeport.dynamo-inference:8000` |
| dev(gemma) | `http://192.168.160.75:30812` |
| 고정 업스트림 | `qwen3`,`qwen2.5-vl`,`bge-m3`,`bge-reranker` → `http://<name>-vllm.vllm:8000` |
| 프로토콜 | HTTP, OpenAI 호환(`:8000`) |
| 인증 | 없음 |
| 타임아웃 | 채팅 60초, readiness 프로브 2초 |

등록 모델 목록·메타는 `catalog.New()`(`catalog.go:31`)에 하드코딩(클러스터 서빙 모델 레지스트리).

## 호출 API
- **모델 readiness**: `GET {upstream}/v1/models` → 200=ready, 연결실패=unreachable, 기타=unknown (`catalog.go:94`). `k8s.ModelReadiness()` 로 워크로드 상태 보정(`server/catalog.go:18`).
- **채팅**: `POST {upstream}/v1/chat/completions` (`server/catalog.go:170`)
  - 요청: `{model, messages[], max_tokens(기본256), temperature, stream:false}`
  - 응답: `choices[0].message.content`, `usage.prompt_tokens/completion_tokens`
  - 핫패스 순서: 키 쿼터 확인 → 가드레일 판정(classifyAndAudit) → 업스트림 호출 → 토큰 카운팅 → 사용량 롤업

## 미설정/실패 시
업스트림 도달 불가 → 모델 status=`unreachable`(카탈로그/플레이그라운드에 표시). 채팅은 502/500.

## 진단 프로브
`/diagnostics` → `dynamo_upstream`. 대표로 첫 항목(gemma=env 주입)을 `GET /v1/models` 로 점검(`catalog.go` `Probe()`). 모델별 상세 상태는 **모델 카탈로그 화면**에서 개별 확인.

## 실사이트 매칭 체크리스트
- [ ] 고객사 서빙이 Dynamo/vLLM 인가? 모델별 서빙 URL·이름이 `catalog.New()` 하드코딩과 일치하는가 → **불일치 시 `catalog.go` 의 entries 수정 필요**(현재 모델셋이 고객사와 다르면 가장 먼저 손볼 곳).
- [ ] gemma 업스트림 `FABRIX_GEMMA_UPSTREAM` 주입. 나머지 모델은 `*-vllm.vllm:8000` DNS 가 맞는지.
- [ ] NetworkPolicy: BFF → `dynamo-inference`·`vllm` 네임스페이스 `:8000` egress.

## 트러블슈팅
| 증상 | 원인 | 조치 |
|---|---|---|
| 모델 전부 unreachable | DNS/포트/네임스페이스 불일치 | entries 의 upstream 과 실제 svc 비교 |
| 채팅 502 | 업스트림 5xx/모델 미로딩 | 해당 워크로드 로그(엔드포인트 화면) 확인 |
| 모델 목록이 고객사와 다름 | 하드코딩 레지스트리 | `catalog.go` entries 갱신(향후 동적화 후보) |
