# Langfuse Public API — 할 수 있는 것 전부 (FABRIX 연동 레퍼런스)

> 목적: 나중에 BFF↔Langfuse 연동을 확장할 때 쓰는 능력 카탈로그. "무엇을 읽고 쓸 수 있나"를 엔드포인트 단위로 정리.
> 권위 출처: [api.reference.langfuse.com](https://api.reference.langfuse.com/) · OpenAPI [cloud.langfuse.com/generated/api/openapi.yml](https://cloud.langfuse.com/generated/api/openapi.yml) · Postman `cloud.langfuse.com/generated/postman/collection.json`
> 관련: 역할/전략은 [../research/langfuse-가드레일-전략-리서치.md](../research/langfuse-가드레일-전략-리서치.md), 트레이스 화면 연동은 [langfuse.md](langfuse.md).

## 한 줄 요약
"all Langfuse data and features are available via the API." 우리는 지금 **읽기(trace/session 대시보드)**만 쓰는데, **쓰기(ingestion·scores)**·**관리(prompts·datasets·models)**까지 전부 열려 있다. **언어 무관**(HTTP Basic) → **Go BFF 가 SDK 없이 직접** 호출 가능.

## 인증·기본
| 항목 | 값 |
|---|---|
| 베이스 | `{host}/api/public` (셀프호스트면 우리 host, 클라우드면 EU/US/JP/HIPAA) |
| 인증 | **HTTP Basic** — username=`pk-lf-...`(public), password=`sk-lf-...`(secret) |
| 키 범위 | 대부분 **프로젝트 범위**(project-scoped). org/SCIM·instance 관리 엔드포인트는 org 키 |
| 헬스 | `GET /api/public/health` (API+DB 상태) |
| 비동기성 | ingestion 은 배치 적재 — 즉시 일관성 아님(트레이스 표시까지 약간 지연) |

> 보안: secret 키는 **서버에만**(우리 `FABRIX_LANGFUSE_SECRET_KEY`, Secret 주입). 절대 프론트 노출 금지.

---

## 전체 엔드포인트 맵 (resource × method)

### ✍️ 쓰기(Write) — 데이터 적재
| 엔드포인트 | 용도 | FABRIX 활용 |
|---|---|---|
| `POST /api/public/ingestion` | **배치 적재**(trace/observation/score/event) | ★ 추론 경로에서 trace+가드레일 observation 기록(현재 synthetic→실데이터) |
| `POST /api/public/otel/v1/traces` | OTLP/HTTP 트레이스(권장 표준) | OTel 파이프라인 쓸 때 대안 적재 경로 |
| `POST /api/public/scores`, `POST /api/public/v2/scores` | 점수 생성(trace/observation/session) | ★ 가드레일 판정·위험점수·사용량 점수 기록 |
| `DELETE /api/public/scores/{id}`, `/v2/scores/{id}` | 점수 삭제 | |
| `POST /api/public/score-configs` | 점수 스키마(범주/수치) 정의 | toxicity/PII 점수 정의 |
| `POST /api/public/traces/{id}/tags`, `DELETE .../tags/{tag}` | 트레이스 태그 | 차단/부서/앱 태깅 |

### 📖 읽기(Read) — 대시보드·분석
| 엔드포인트 | 용도 | FABRIX 활용 |
|---|---|---|
| `GET /api/public/traces`, `/traces/{id}` | 트레이스 목록·상세(v1) | ★ 현재 트레이스 화면이 사용 |
| `GET /api/public/v2/traces` | 트레이스(v2, 커서 페이징·필드선택) | 대량/성능 개선 시 전환 |
| `GET /api/public/v2/observations` | 관측(span/generation/event) 목록 | 가드레일 GUARDRAIL observation 조회 |
| `GET /api/public/sessions`, `/sessions/{id}` | 세션 목록·상세 | ★ 세션 화면이 사용 |
| `GET /api/public/metrics`, `/v2/metrics` | 집계 메트릭(사용량·비용·품질, JSON 쿼리) | 비용/토큰/지연 대시보드 보강 |
| `GET /api/public/comments`, `/comments/{id}` | 코멘트 | 협업 주석 |

### 🛠 관리(Manage) — 프롬프트·데이터셋·모델·평가
| 엔드포인트 | 용도 | FABRIX 활용 |
|---|---|---|
| `GET/POST /api/public/prompts`, `/prompts/{name}`, `/prompts/{name}/versions/{v}` | 프롬프트 버전관리 | 가드레일/시스템 프롬프트 중앙관리·버저닝 |
| `GET/POST /api/public/v2/datasets`, `/datasets/{name}` | 데이터셋(평가 입력) | 회귀/안전 테스트셋 |
| `dataset-items`, `dataset-run-items`, `/datasets/{name}/runs[/{run}]` | 데이터셋 항목·실행 | 평가 실행 기록 |
| `GET/POST /api/public/models`, `/models/{id}`, DELETE | 모델 가격/토큰 정의 | 비용 계산용 커스텀 모델 단가 |
| `annotation-queues` (큐·items·assignments CRUD) | 수동 라벨링 큐 | 사람 검수 워크플로 |
| `POST/GET/PATCH /api/public/media[/{id}]` | 미디어(presigned URL) | 멀티모달 입력 보존 |
| `llm-connections` (GET/PUT/DELETE) | LLM 커넥션(평가자용) | LLM-as-judge 연결 |

### 🏢 조직/인스턴스 (org 키, 보통 미사용)
`organizations/memberships`(SCIM), `projects/{id}/memberships`, `integrations/blob-storage`(증적 내보내기 연동) — 멀티테넌시·SSO·blob export 필요 시.

---

## Ingestion 상세 (가장 중요한 write 경로)

`POST /api/public/ingestion` 는 **이벤트 배치**를 받는다. 한 요청에 여러 이벤트(트레이스 생성 + generation + 가드레일 span + score)를 함께 보낼 수 있다.

요청 형식:
```json
{ "batch": [
  { "id": "<event-uuid>", "type": "trace-create",      "timestamp": "<ISO8601>", "body": { "id": "<traceId>", "name": "playground-chat", "userId": "...", "sessionId": "...", "tags": ["blocked"], "metadata": {"app_id":"...","dept_id":"..."} } },
  { "id": "...", "type": "generation-create", "timestamp": "...", "body": { "id":"<obsId>", "traceId":"<traceId>", "name":"llm", "model":"gemma-4-31b-it", "input":[...], "output":"...", "usageDetails":{"input":123,"output":45} } },
  { "id": "...", "type": "observation-create", "timestamp": "...", "body": { "id":"<guardObsId>", "traceId":"<traceId>", "type":"GUARDRAIL", "name":"semantic-router", "input":"<원문>", "output":{"decision":"blocked","reason":"jailbreak"}, "level":"ERROR" } },
  { "id": "...", "type": "score-create", "timestamp": "...", "body": { "traceId":"<traceId>", "name":"jb_confidence", "value":0.95, "dataType":"NUMERIC" } }
]}
```
이벤트 타입: `trace-create`, `span-create`, `generation-create`, `event-create`, `observation-create`/`observation-update`, `score-create`, `sdk-log`.

> 이게 우리 트레이스 화면을 **실데이터로** 채우는 길이다. 현재 BFF 는 Langfuse 를 GET 으로만 읽고 미설정 시 synthetic 폴백([langfuse.md](langfuse.md)) — 추론 파이프라인(또는 BFF)이 위 ingestion 으로 써야 실데이터가 보인다.

## Scores 상세 (가드레일/품질 결과 기록 통로)
`POST /api/public/scores` (또는 `/v2/scores`):
```json
{ "traceId":"<traceId>", "observationId":"<obsId?>", "name":"input-jailbreak",
  "value":1, "dataType":"BOOLEAN", "comment":"SR θ=0.9 초과" }
```
- dataType: `NUMERIC`(float) | `CATEGORICAL`(문자, score-config 검증) | `BOOLEAN`(1/0) | `TEXT`(1~500자).
- 트레이스보다 점수가 먼저 도착해도 `traceId` 로 나중에 링크됨.
- **Go BFF 에서 직접 POST 가능**(Python SDK 불필요).

---

## Go BFF 호출 예 (SDK 없이)
```go
// 공통: Basic auth
req.SetBasicAuth(publicKey, secretKey) // pk-lf / sk-lf
req.Header.Set("Content-Type", "application/json")

// 점수 1건
POST {host}/api/public/scores
{"traceId": tid, "name": "guard.decision", "value": "blocked", "dataType": "CATEGORICAL"}

// 트레이스+관측 배치
POST {host}/api/public/ingestion   { "batch": [ ...위 예시... ] }
```
우리 기존 langfuse 클라이언트([`backend/internal/langfuse/client.go`](../../backend/internal/langfuse/client.go))는 이미 Basic auth + `/api/public` GET 을 구현했으니, **POST ingestion/scores 메서드만 추가**하면 된다.

---

## 역할 분리 주의 (중복 방지)
- **컴플라이언스 원본은 ClickHouse `guard_audit` + WORM** — 불변 보존 보장이 필요. Langfuse scores/traces 는 **분석·관측용 2차 사본**으로, 같은 `trace_id` 로 상호참조.
- 즉 Langfuse 에 쓰는 건 "관측 강화"지 "증적 이전"이 아니다. 규제 보존은 WORM 이 SSOT.
- 차단 판정은 Semantic Router(인라인). Langfuse 는 차단 경로 밖.

## 연동 로드맵(나중에)
1. langfuse 클라이언트에 `Ingest(batch)`·`Score(...)` 추가 → 추론 경로에서 trace+GUARDRAIL observation+score 기록.
2. `/diagnostics` 의 langfuse 가 reachable 확인 후 활성.
3. (선택) prompts API 로 시스템/가드 프롬프트 버저닝, models API 로 단가 등록.
4. (선택) metrics v2 로 비용/지연 위젯 보강.

## 출처
- [Public API 문서](https://langfuse.com/docs/api-and-data-platform/features/public-api) · [API 레퍼런스](https://api.reference.langfuse.com/) · [OpenAPI](https://cloud.langfuse.com/generated/api/openapi.yml)
- [Scores via API/SDK](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk) · [Ingestion/OTel](https://langfuse.com/integrations/native/opentelemetry)
- [API 아키텍처(DeepWiki)](https://deepwiki.com/langfuse/langfuse/4.1-api-architecture)
