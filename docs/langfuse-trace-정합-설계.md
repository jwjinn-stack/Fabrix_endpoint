# FABRIX Trace ↔ Langfuse 정합 설계 (하이브리드 / 방식 B)

문서 범위: 자체 개발한 FABRIX 추론 트레이스 뷰어([web/src/pages/Traces.tsx](../web/src/pages/Traces.tsx))를
오픈소스 **Langfuse**(v3 스택, Public API)와 정합한다. 방식은 **하이브리드(B)** —
OTel Collector fan-out 으로 한 번 계측해서, **서빙 내부 스팬**(prefill/decode/queue/router/proxy)은
victoria-traces 로, **LLM 토큰·비용·프롬프트·가드레일/검색**은 Langfuse 로 보낸다.
뷰어는 두 소스를 한 waterfall 에 병합해 보여준다.

> 본 문서의 Langfuse 세부(필드명·API·SDK)는 2025–2026 현행 공식 문서로 검증함.
> 단 Langfuse 는 빠르게 변하므로 도입 직전 현행 OpenAPI(`cloud.langfuse.com/generated/api/openapi.yml`)와 재대조.

---

## 1. 책임 분리 (왜 하이브리드인가)

문서 "Application → vLLM Trace 아키텍처 §1.1"의 분리를 그대로 따른다.

| 측정 | 소스 | 트레이스 뷰 표기 |
|---|---|---|
| 요청별 총지연·TTFT·체감지연·귀속 | **Langfuse** (클라이언트 관점) | root generation 스팬 |
| 입출력/캐시 토큰, 요청별 원가 | **Langfuse** (Worker 서버측 비용계산) | generation usageDetails/cost |
| 가드레일 판정, 검색(RAG)·툴 호출 | **Langfuse** (GUARDRAIL/RETRIEVER/TOOL observation) | langfuse-source 스팬 |
| prefill/decode 분해, queue, ITL 분포 | **victoria-traces / Prometheus** (서버측) | otel-source 스팬 |
| GPU util/mem/temp/power | DCGM/Prometheus | (트레이스 밖 — GPU 화면) |

핵심: **Langfuse 엔 서빙 내부 스팬이 없다.** prefill/decode/queue 는 vLLM/Dynamo 내부이므로
OTel(victoria-traces) 로만 들어온다. 따라서 우리 리치 waterfall 을 유지하려면 두 소스를 병합해야 한다.

---

## 2. 데이터 모델 매핑 (FABRIX DTO ↔ Langfuse v2)

뷰어가 쓰는 DTO는 그대로 두고, **BFF(Go provider)가 Langfuse Public API + victoria-traces 를
우리 `TraceSummary`/`TraceSpan` 으로 매핑**한다(기존 `backend/internal/provider` 인터페이스 패턴).

### 2.1 Trace 단위

| FABRIX `TraceSummary` | Langfuse | 비고 |
|---|---|---|
| `trace_id` | trace `id` | 동일 |
| `ts` | trace `timestamp` | |
| `model` | root generation `providedModelName` | |
| `total_ms` | trace `latency` | |
| `ttft_ms` | `completionStartTime − startTime` | ✅ Langfuse TTFT 정의 |
| `prompt_tokens`/`completion_tokens`/`cached_tokens` | `usageDetails.{input, output, cache_read_input_tokens}` | v2 필드명 |
| **`total_cost_krw`/`input_cost_krw`/`output_cost_krw`** | `costDetails` / `totalCost`(v2) | **서버측 계산값 소비** (클라 계산 폐기) |
| `app_id`·`dept_id`·`route` | trace `metadata.route` + `tags` | 귀속 태그 규약(§4) |
| `user_id`/`session_id` | trace `userId`/`sessionId` | `langfuse_user_id` 등 예약키 |
| `status` | observation `level`(DEFAULT/WARNING/ERROR) + `statusMessage` | |
| `decision`(가드레일) | **GUARDRAIL** observation + Langfuse **score** | |
| `finish_reason`·`http_status`·`stream` | `metadata`(gen_ai.response.finish_reasons 등) | Langfuse 1급 필드 아님 |

### 2.2 Span(Observation) 단위

| FABRIX `TraceSpan` | Langfuse observation | source |
|---|---|---|
| `span_id` / `parent_id` | `id` / `parentObservationId` | |
| `name` | `name` | |
| `kind=generation` | type **GENERATION** | langfuse |
| `kind=guardrail` | type **GUARDRAIL** (2025-08 신설) | langfuse |
| `kind=retriever` | type **RETRIEVER** | langfuse |
| `kind=embedding` | type **EMBEDDING** | langfuse |
| `kind=tool` | type **TOOL** | langfuse |
| `kind=proxy/router/queue/prefill/decode` | (Langfuse 미존재) | **otel** (victoria-traces) |
| `start_ms`/`duration_ms` | `startTime`/`endTime` | offset↔절대 변환 |
| `attributes` | `metadata` + 자동매핑(gen_ai.*) | |

**Langfuse observation type 10종**(2025-08-27 확장): GENERATION/SPAN/EVENT/AGENT/TOOL/CHAIN/RETRIEVER/EMBEDDING/EVALUATOR/GUARDRAIL.
우리 guardrail/retriever/embedding/tool 은 그대로 매핑되고, 멀티스텝 에이전트 확장 시 AGENT/CHAIN 을 그대로 사용한다.

---

## 3. BFF(Go provider) 설계

```
브라우저(뷰어) → FABRIX BFF /api/v1/traces(+/{id})        ← 기존 그대로
                     │
                     ├─ Langfuse Public API (Basic auth, secret 서버보관)
                     │    GET /api/public/traces, /traces/{id}
                     │    GET /api/public/observations(/{id})
                     │    GET /api/public/v2/metrics   ← 대시보드 집계
                     └─ victoria-traces (OTel) 서빙 스팬 조회
                  → 두 소스 병합 → TraceSummary/TraceSpan
```

- 인증: HTTP **Basic** (`public key`=user, `secret key`=password). secret 은 **BFF에만** 보관, 브라우저 전달 금지.
- 목적지: `langfuse-web` ClusterIP (`http://langfuse-web.langfuse.svc.cluster.local:3000`). 폐쇄망 내부에서 닫힘.
- metrics v2 주의(현행 검증): `view` 에 **traces 없음** → `observations`/`scores-numeric`/`scores-categorical`.
  쿼리는 request body 아니라 **URL `query` 파라미터에 URL-encoded JSON**. `histogram` 은 aggregation 이 아니라 `config.bins`(1–100).
- 병합 키: Langfuse trace `id` ↔ victoria-traces `trace_id`(동일 W3C traceparent 이어야 함 → OTel Collector fan-out 으로 같은 trace context 공유).

---

## 4. 계측·귀속 규약 (App 측)

- OTel Collector **fan-out**: 앱은 한 번만 계측(raw OTel SDK 또는 OpenInference/OpenLLMetry) → Collector 가
  LLM 관련 span 은 Langfuse(`/api/public/otel`)로, 전체 span 은 victoria-traces 로 동시 전송.
  (네이티브 `langfuse.openai` 래퍼는 Langfuse 직전송이라 단일계측·이중백엔드가 안 됨 → 하이브리드는 Collector 경로 채택. 문서 §10.)
- 귀속 태그 규약 통일: `metadata.route`, `langfuse_user_id`, `langfuse_session_id`, `langfuse_tags=[dept_id, app_id]`.
- 스트리밍: `stream_options={"include_usage": True}` 必 (없으면 usage 청크 누락 → 토큰 0 → 비용 0).
- 모델명: Langfuse 등록 단가 모델명과 **일관** (§5).

## 5. 비용 단가 등록 (self-host)

- 자체 상각 단가 = `GPU 시간당 비용 / 시간당 처리 토큰 수` (장비 상각+전력+운영비).
- 등록: UI 또는 `POST /api/public/models` (`matchPattern` 정규식 + input/output 단가).
  **주의**: `prices` 맵의 public API 지원은 2025-12 추가 — 셀프호스트 버전 확인. 구버전은 레거시 `inputPrice/outputPrice`.
- Worker 가 ingestion 시 단가를 곱해 `totalCost` 확정 → 뷰어는 이 값을 표시(클라 계산 폐기).
- **단일 비용 소스 통일**: Models/Usage 화면의 비용 facet 도 동일 단가 모델을 참조하도록 정렬.
- 초기 대안: 단가 0 → 토큰 수를 비용 프록시로(로컬 vs 외부 상대비교엔 충분).

## 6. 배포 체크리스트 (하이브리드)

인프라:
- [ ] Langfuse Helm(`langfuse/langfuse`) 번들 모드 배포(PG/ClickHouse/Redis/MinIO). ClickHouse 는 **NVMe StorageClass** 분리.
- [ ] CPU 노드 affinity (GPU 노드 회피, KAI Scheduler 비점유).
- [ ] Redis `maxmemory-policy noeviction` (큐 유실 방지).
- [ ] 서버 시크릿 `NEXTAUTH_SECRET`/`SALT`/`ENCRYPTION_KEY(32B hex)`.
- [ ] PG·ClickHouse 백업.
- [ ] OTel Collector(Deployment/DaemonSet) fan-out 구성 (→ Langfuse `/api/public/otel` + victoria-traces).
- [ ] NetworkPolicy: `App/Collector/BFF → langfuse-web` 만 허용.

앱/BFF:
- [ ] OTel 계측 + 귀속 태그 규약(§4).
- [ ] Job/CronJob 종료 전 flush.
- [ ] 자체 상각단가 등록(또는 토큰 프록시) + 모델명 매칭 통일.
- [ ] BFF Langfuse provider: Basic auth(secret 서버보관), `/traces`·`/observations`·`/v2/metrics` 매핑.

## 7. 프론트(뷰어) 정합 변경 요약 → §구현

- `SpanKind` 를 Langfuse 10 type + 서빙 내부(otel)로 재정렬, `TraceSpan.source`(`langfuse`|`otel`) 추가.
- `TraceSummary` 에 서버제공 비용(`total_cost_krw` 등) 추가, 클라 계산 폐기.
- 뷰어: 스팬별 **소스 배지**(Langfuse / victoria-traces), 비용 표시, 속성 패널 `usageDetails/costDetails` 키 반영.
- mock 을 위 형태로 reshape → 추후 BFF 가 `/api/public/*` 프록시해도 화면 불변.
