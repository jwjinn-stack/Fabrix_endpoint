# Langfuse 기능 정리 (langfuse.com/docs 전수, read-only 대시보드 관점)

기준: 공식 docs + OpenAPI(`/generated/api/openapi.yml`), 2025–2026 현행. 모든 Public API: base `/api/public`, **HTTP Basic Auth**(user=Public Key, pass=Secret Key), 셀프호스트는 host만 교체.
범례: 소비 = 셀프호스트 read-only 대시보드에서 API로 가져올 수 있는가.

## ★ 차단 프롬프트 원문 조회 (우리 핵심 요구)
- Langfuse는 **직접 차단하지 않음** — 외부 가드레일(LLM Guard/NeMo/Prompt Armor 등) 결과를 **사후 기록·관찰**.
- **GUARDRAIL observation** 에 `input`(차단된 프롬프트 원문) + `output`(`{blocked, reason, category}`) 저장.
- 조회: `GET /api/public/observations/{id}` 또는 `GET /api/public/v2/observations?fields=io`. Trace 의 `input/output` 도 원문 포함.
- **마스킹 미설정 시 원문 그대로 저장·조회.** 마스킹은 클라이언트 사이드(서버 전송 전)에서만.
- → FABRIX 적용: 가드레일 증적 상세에서 trace_id 로 Langfuse 원문 lazy 조회. (구현됨: [web/src/pages/Guard.tsx](../web/src/pages/Guard.tsx) `fetchGuardContent`)

## A. Observability / Tracing
| 기능 | API | 소비 |
|---|---|---|
| Traces (요청 컨테이너) | `GET /traces`, `/traces/{id}` (필터 userId/sessionId/name/tags/timestamp) | O (input/output 포함) |
| Observations (10 type) | `/observations`, `/observations/{id}`, **`/v2/observations`**(`fields=core/io/usage/...`) | O |
| Sessions | `/sessions`, `/sessions/{id}`(traces 포함) | O |
| Users | 전용 없음 → `traces?userId=` + Metrics | 부분 |
| Tags / Metadata | trace 필드 inline | O |
| Latency / TTFT | `latency`, `timeToFirstToken` | O |
| Log levels (DEBUG/DEFAULT/WARNING/ERROR) | observation `level` + `statusMessage` | O |
| Multi-modal | `/media/{id}` (토큰 resolve) | O |

observation 10종: event, span, generation, **agent, tool, chain, retriever, evaluator, embedding, guardrail**.

## B. Prompt Management
프롬프트 버전관리·라벨(production/latest/커스텀)·config(model/tool/response_format)·text·chat·`{{var}}`. `GET /v2/prompts`, `/v2/prompts/{name}?label=production`. 배포=라벨 변경. A/B=라벨로. 소비 O(읽기).

## C. Evaluation
Scores(NUMERIC/CATEGORICAL/BOOLEAN, value/source/comment) `GET /v3/scores`. Score configs `/score-configs`. LLM-as-a-judge(managed+custom, 데이터모델 개편중·불안정). Human annotation queues `/annotation-queues`. 소비 O(버전 주의).

## D. Datasets
테스트 케이스 모음 + dataset runs(=experiments). `/v2/datasets`, `/dataset-items`, `/datasets/{name}/runs`, `/dataset-run-items`. 소비 O.

## E. Metrics / Dashboards
**Metrics API v2** `GET /v2/metrics?query=<URL-encoded JSON>` — `view`(observations/scores-numeric/scores-categorical), `metrics[{measure,aggregation}]`(sum/avg/count/p50~p99), `dimensions`, `filters`, `timeDimension.granularity`, from/to. ★대시보드 집계 엔진. (histogram은 aggregation 아님 → `config.bins`).

## F. Playground
모델 플레이그라운드·tool schema·structured output — **UI 전용, API 없음**.

## G. Guardrails / Security
위 ★ 참조. PII/데이터 마스킹(`mask`/`mask_otel_spans`, 클라 사이드). RBAC/SSO/데이터보존.

## H. Cost / Usage
모델 가격 등록(빌트인+커스텀, regex 매칭, tier) `GET/POST /models`. `usageDetails`(input/output/cached/audio/image), `costDetails`(USD by type), `totalCost`. generation/embedding만 추적, trace로 상향 집계.

## I. 주요 Public GET
traces · observations(v2) · sessions · v3/scores · score-configs · v2/prompts · v2/datasets · dataset-items · models · **v2/metrics** · projects · health · comments · media · annotation-queues · integrations/blob-storage.

## J. Sessions & Users
Session: `/sessions(/{id})` turnkey. User: 재구성(traces?userId + Metrics dimensions).

## K. Integrations / SDK
Python/JS SDK(OTel 기반), OpenAI 래퍼(drop-in), 네이티브 OTel 엔드포인트(`/api/public/otel`), LangChain 콜백.

## L. Data platform
UI/배치 export(CSV/JSON, 대용량 S3 presigned), Scheduled Blob Export(S3/GCS/Azure), Blob/S3 인프라, 데이터 보존(프로젝트별).

---
## ★ FABRIX 대시보드(read-only, API 소비)에 넣을 Top 8
1. **Traces** `/traces(/{id})` → id,timestamp,input,output,userId,sessionId,tags,latency,observations[],scores[]
2. **GUARDRAIL = 차단 프롬프트** `/v2/observations?fields=io` (type=guardrail) → input(원문),output{blocked,reason,category},level
3. **Metrics v2** `/v2/metrics?query=` → 대시보드 집계
4. **Cost/Token** observation usageDetails/costDetails/totalCost + `/models`
5. **Scores** `/v3/scores` + `/score-configs` → 위험도/품질/차단 플래그
6. **Sessions** `/sessions(/{id})` → 대화 단위 추적/replay
7. **User 집계** `/traces?userId=` + Metrics dimensions
8. **Log/에러** observation level=ERROR + statusMessage/latency

주의: Scores read는 v1/v2/v3 버전차 큼, Metrics/Observations v2는 신규 — 셀프호스트 버전 확인 필수.
