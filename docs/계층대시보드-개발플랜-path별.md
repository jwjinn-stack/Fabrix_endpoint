# 계층 대시보드 + groupby + MCP — path별 개발 플랜

> 기반 리서치/검토: [docs/research/2026-06-29-계층적대시보드-MCP해석-리서치.md](research/2026-06-29-계층적대시보드-MCP해석-리서치.md)
> 목적: 16개 화면(path)을 **L1(추상) → L2(groupby) → L3(상세/trace)** 계층으로 재배치하고, 공통 차원·메트릭 카탈로그·metric→trace 조인·FABRIX MCP를 단계적으로 붙이기 위한 **개발 참조 문서**.
> 상태 범례: ✅완료 · 🟡일부 · ⬜없음

---

## 0. 설계 원칙 (모든 path 공통)

- **3계층**: L1 = 요약/이상 Top-N(클릭 유도), L2 = 공통 차원 groupby(어느 그룹이 튀나), L3 = 개별 trace/장비 상세.
- **2종 drill 구분**: **drill-down**(같은 화면서 차원 분해) vs **drill-through**(다른 화면/trace로 점프, 컨텍스트=필터 전달).
- **공통 차원(4+2축)**: `model · endpoint · namespace · time`(+ `tenant/dept·status`). Dynamo 라벨 `model`/`dynamo_endpoint`/`dynamo_namespace`, Langfuse `providedModelName`/`environment`, 귀속은 ClickHouse rollup(dept/app/key).
- **metric→trace 조인**: VictoriaMetrics exemplar 미지원 → **(model, time[, decision]) 차원+시간窓**으로 Langfuse trace 목록 조회(글루가 이미 trace id·차원 적재).
- **단일 출처 재사용**: 차원/카탈로그는 [domain/breakdown.go](../backend/internal/domain/breakdown.go) `MetricDimensions` 한 곳 → L2 UI·MCP가 공유.

---

## 1. 공통(Cross-cutting) 작업 — path보다 먼저/같이 가는 인프라

| # | 작업 | 산출물 | 상태 | 비고 |
|---|---|---|---|---|
| C1 | 메트릭 차원 groupby API | `GET /metrics/breakdown`,`/metrics/dimensions` + provider | ✅ | [구현 E](research/2026-06-29-계층적대시보드-MCP해석-리서치.md) |
| C2 | **메트릭 카탈로그 확장** | [breakdown.go](../backend/internal/domain/breakdown.go) `MetricCatalog`(의미·단위·방향·임계치·관련메트릭), `/metrics/dimensions`에 동봉 | ✅ | AI grounding(R3-5). L2 UI 툴팁·MCP resource 공유 |
| C3 | **라우터가 필터 컨텍스트 운반** | [router.ts](../web/src/router.ts) `NavParams`/`NavFn` 일반화(model/dim/key/range/decision/from/to), App.navigate·전 페이지 적용 | ✅ | drill-through 전제 |
| C4 | **공통 L2 컴포넌트** `<DimensionBreakdown>` | [DimensionBreakdown.tsx](../web/src/components/DimensionBreakdown.tsx) 차원 셀렉터 + 정렬표 + 행클릭 drill + 카탈로그 이상강조 | ✅ | Grafana 13.1 "Filter & Group by" 패턴(R3-3) |
| C5 | **metric→trace 조인 핸들러** | `GET /traces?model=&decision=` 이미 지원 + [Traces](../web/src/pages/Traces.tsx)가 URL 필터 시드 | ✅ | Langfuse 조인(R3-2). from/to 정밀窓은 후속 |
| C6 | **이상 강조 유틸** `top_outliers` | 프론트(DimensionBreakdown 셀 강조) + 서버(MCP `top_outliers` tool, [mcp.go](../backend/internal/server/mcp.go) `outliers`) | ✅ | BubbleUp형(R1-3·R2-6) |
| C7 | **FABRIX MCP 서버** | [mcp.go](../backend/internal/server/mcp.go) JSON-RPC `POST /api/v1/mcp` — 카탈로그 resource + 인사이트 동사 tool(list_dimensions·groupby_metric·top_outliers·summarize_endpoint_health), read-only | ✅ | Langfuse 네이티브 MCP와 역할 분리. 실클라이언트 streamable-HTTP/SSE 는 후속 |

> 진행 완료(2026-06-29): **C1~C7 + S2(usage/endpoints/traffic) + S3(dashboard L1 링크·traces 필터)** 구현·검증.
> 검증: go build/vet/test ✅, web tsc + prod build ✅, MCP JSON-RPC curl ✅, 브라우저 — /usage L2 패널·차원 전환·이상강조·행클릭→`/traces?model=` drill-through·콘솔에러 0 ✅.
> 후속(미구현): S3 guard decision groupby 화면, S4(traffic/gpu 병목판정 카드·eval 품질축), C5 정밀 시간窓(from/to), MCP streamable-HTTP/SSE 전송.

---

## 2. Path 분류

| 그룹 | paths | 계층 적용 |
|---|---|---|
| **관측 코어** (L1→L2→L3 풀) | dashboard, usage, gpu, traffic, endpoints, traces, sessions, guard, eval, models | 본 플랜의 주 대상 |
| **운영/설정** (계층 대상 아님) | playground, keys, diagnostics, settings, credentials, model-import | MCP read-only 노출만(C7), UI 계층화 제외 |

---

## 3. 관측 코어 — path별 상세

### 3-1. `/dashboard` — 전체 관제 (L1의 대표)
- **현재**: `fetchOverview`+`fetchTimeseries`. 4카드+시계열. drill ⬜(평면).
- **목표 계층**: **L1 그 자체.** 요약 카드 + 이상 Top-N + "정상 vs 거부/차단" 분리(R2-3·R3-4).
- **할 일**:
  1. 각 카드/시계열을 **클릭 → 해당 L2로 drill-through**(예: TTFT 카드 → `/usage?dim=model` 또는 신규 L2, GPU 카드 → `/gpu`, 차단 카드 → `/guard`).
  2. 알람(이미 `alarms`)에 **원인 차원 링크** 부여(C6 결과 연결).
  3. latency 카드에 토큰정규화/거부율 보조 표기(R2-3).
- **의존**: C3(필터 운반), C6(이상).

### 3-2. `/usage` — 사용량·귀속 (L2의 대표, 이미 groupby 보유) 🟡
- **현재**: `fetchUsage(group_by=model|dept|app|api_key)`+trend+overview, keys로 navigate. **groupby 가장 성숙.**
- **목표 계층**: **L2(Group).** 기존 usage(귀속/비용축) + 신규 **성능축 breakdown(C1)** 병합.
- **할 일**:
  1. `<DimensionBreakdown>`(C4)로 차원 셀렉터 통합: 비용/귀속(dept/app/key=rollup) + 성능(model/endpoint/namespace=`/metrics/breakdown`).
  2. 행 클릭 → **drill-through to `/traces` (model+time 필터, C5)** = L3.
  3. 비용 차원 1급화: tenant/dept × model 매트릭스(R2-4), cache hit를 비용 드라이버로 표시(R1-2).
- **의존**: C1✅, C4, C5.

### 3-3. `/gpu` — GPU/MIG (L1→L3 drill 이미 완성형) ✅🟡
- **현재**: `fetchGPU`(요약+per-GPU)→`fetchGPUTimeseries(uuid)`. **3단 drill 모범 사례.**
- **목표 계층**: 이 패턴을 **다른 화면 일반화의 레퍼런스**로 삼음.
- **할 일**(소):
  1. GPU↔model 연결: 장비 상세에서 "이 GPU가 서빙 중인 model" → `/usage?dim=model` 또는 trace로 cross-link.
  2. idle-alloc gap(이미 계산) → 이상 강조(C6) 표준화.
- **의존**: C6.

### 3-4. `/traffic` — 트래픽/프록시·파이프라인 (L2, 병목 진단) 🟡
- **현재**: `fetchProxyStats`+`fetchEnginePipeline`(queue→prefill→decode)+`fetchGuardAudit`. **R1-3 병목분해 이미 보유.**
- **목표 계층**: **L2(병목 판정).** prefill/decode 큐·HOL·KV전송으로 "어디가 병목"(R1-3) 카드화.
- **할 일**:
  1. 파이프라인을 **차원별(model/endpoint)로 분해**(C1 확장 — stage_duration by label).
  2. 병목 자동 판정 카드(prefill큐 vs decode큐 vs KV전송 → ①/② 라벨, C6).
  3. 특정 구간 클릭 → 그 model/time의 trace(C5) = L3.
- **의존**: C1확장, C5, C6.

### 3-5. `/endpoints` — 엔드포인트(DynamoGraphDeployment) (L1→L2) 🟡
- **현재**: `fetchEndpoints`+harbor+org+keys+`fetchEndpointLogs`, model-import navigate.
- **목표 계층**: **L1(엔드포인트 카드=건강도) → L2(엔드포인트별 메트릭 breakdown, `dim=endpoint`).**
- **할 일**:
  1. 각 엔드포인트 카드에 `/metrics/breakdown?dim=endpoint`의 해당 행(QPS·TTFT·cache hit) 인라인.
  2. 카드 클릭 → 엔드포인트 상세(로그+메트릭 시계열+서빙 model) = L2/L3.
  3. endpoint↔model↔namespace 차원 연결(C3).
- **의존**: C1✅, C3, C4.

### 3-6. `/traces` — 트레이스 (L3의 핵심) 🟡✅
- **현재**: `fetchTraces`(목록)→`fetchTrace(id)`(상세). **L2→L3 이미 존재.**
- **목표 계층**: **L3(Detail).** 다른 화면(L2)에서 (model,time,decision) 필터로 진입하는 **종착지**.
- **할 일**:
  1. 목록 필터를 공통 차원으로 정합: `?model=&endpoint=&from=&to=&decision=`(C5).
  2. span 트리에 token/cost/latency/score 인라인(R3-6) — 글루가 이미 적재(generation usageDetails, score).
  3. L1/L2에서 들어온 필터 컨텍스트 표시(빵부스러기).
- **의존**: C3, C5.

### 3-7. `/sessions` — 세션 (L3, 멀티턴) 🟡
- **현재**: `fetchSessions`→`fetchSession(id)`. Langfuse Sessions(R3-2)와 정합.
- **목표 계층**: **L3.** trace를 세션으로 묶은 리플레이.
- **할 일**: traces와 동일 필터 정합 + 세션→포함 trace 링크. (소)

### 3-8. `/guard` — 가드레일 증적 (L2, 거부/차단축) 🟡
- **현재**: `fetchGuardStatus`+`fetchGuardAudit`+`fetchGuardContent`. ClickHouse guard_audit.
- **목표 계층**: **L2(decision 차원).** "정상 vs flagged vs blocked"를 1급 차원으로(R3-4, R2-3의 "빠른=거부" 해소).
- **할 일**:
  1. decision/guard_type별 groupby + 시계열.
  2. 항목 클릭 → 해당 trace(C5, trace_id 이미 보유) = L3.
  3. dashboard 차단 카드 ↔ 여기로 drill-through.
- **의존**: C5.

### 3-9. `/eval` — 평가 (L2, 품질축) ⬜
- **현재**: `fetchModels`만(실행 위주).
- **목표 계층**: **L2(품질 score 차원).** Langfuse score를 model/promptVersion별 groupby + 시계열(R1-4).
- **할 일**:
  1. Langfuse score 집계 연동(네이티브 MCP `queryMetrics`/`listScores` 또는 백엔드 프록시).
  2. score 급락 → 해당 trace drill-through(C5). 품질을 알림 대상 메트릭으로(R1-4).
- **의존**: C5, (Langfuse score 조회 경로).

### 3-10. `/models` — 모델 카탈로그 (L1→L2) 🟡
- **현재**: harbor+status+`fetchModelMetrics`(model별 live), endpoints/import navigate.
- **목표 계층**: **L1(모델 카드)→L2(`dim=model` breakdown).**
- **할 일**: 모델 카드 메트릭을 `/metrics/breakdown?dim=model` 행과 정합 + 카드→usage/traces drill-through. (중)

---

## 4. 운영/설정 path (계층화 제외, MCP read-only만)
`/playground`·`/keys`·`/diagnostics`·`/settings`·`/settings/credentials`·`/models/import`:
- UI 계층화 **대상 아님**(액션/설정 화면).
- C7(FABRIX MCP)에서 **읽기 전용 상태 노출**만 고려: `/capabilities`·`/diagnostics`를 MCP resource로(에이전트가 환경 상태 파악). observe 프로파일은 read-only.

---

## 5. 차원 적용 매트릭스 (어느 화면이 어느 차원으로 groupby)

| path | model | endpoint | namespace | dept/app/key | decision | time |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| dashboard(L1) | 요약 | 요약 | — | — | 분리표기 | ✓ |
| usage | ✓ | ✓ | ✓ | ✓(rollup) | — | ✓ |
| traffic | ✓ | ✓ | ✓ | — | — | ✓ |
| endpoints | ✓ | ✓(주축) | ✓ | — | — | ✓ |
| guard | ✓ | — | — | dept | ✓(주축) | ✓ |
| eval | ✓ | — | — | — | — | ✓ |
| models | ✓(주축) | — | — | — | — | ✓ |
| gpu | (GPU↔model 링크) | — | — | — | — | ✓ |

---

## 6. 개발 시퀀스 (스프린트 묶음)

- **S1 (기반)**: C2 메트릭 카탈로그 → C3 라우터 필터 운반 → C4 `<DimensionBreakdown>`.
- **S2 (L2 적용)**: usage(3-2) → endpoints(3-5) → traffic(3-4) 순으로 C4 부착.
- **S3 (drill-through)**: C5 metric→trace 조인 → traces/sessions/guard 필터 정합(3-6·3-7·3-8) → dashboard L1 링크(3-1).
- **S4 (이상·품질)**: C6 top_outliers → traffic/gpu 병목판정 → eval 품질축(3-9).
- **S5 (AI)**: C7 FABRIX MCP(카탈로그 resource + 인사이트 동사 tool) → (선택) ReAct RCA.

> 각 단계는 직전 산출물(차원/카탈로그/컴포넌트)을 재사용 — UI와 MCP가 동일 자산을 공유하므로 중복 없음.
