# 쿠버네티스: application → Semantic Router → vLLM 을 OpenTelemetry 로 Langfuse 모니터링

> 목적: 프로덕션 흐름(app→SR→추론)을 **Python SDK 없이 OTEL**로 Langfuse에 모니터링하는 설치~설정. 모든 항목 공식문서 교차검증(2026-06).
> 관련: 역할분리 [../research/langfuse-가드레일-전략-리서치.md](../research/langfuse-가드레일-전략-리서치.md), 트레이스 정합 [../langfuse-trace-정합-설계.md](../langfuse-trace-정합-설계.md), API 카탈로그 [langfuse-api.md](langfuse-api.md).

## 한 줄 결론 (교차검증된 현실)
- **OTEL로 잡히는 것**: 라우팅/분류/**jailbreak 판정**(SR 스팬) + **토큰·latency**(vLLM) + app→SR→vLLM **한 트레이스**(컨텍스트 전파). → 모니터링 골격 완성.
- **OTEL로 안 잡히는 것**: **프롬프트·응답 원문**. vLLM은 "토큰·latency만 export, 입출력은 별도 캡처 필요"라고 **공식 명시**. → 원문은 **ingestion REST**(또는 SDK)로 별도 캡처.
- BFF는 적재에 관여 안 함 — 데이터플레인(SR/vLLM)이 OTEL로 emit, BFF는 **읽어서 표시만**.

---

## 1. 아키텍처 (K8s 인클러스터)

```
                  ┌──────────────────────── 한 trace (동일 traceparent) ────────────────────────┐
application ──────► Semantic Router(Envoy ext_proc) ──────► vLLM 서빙 Pod
  (OTEL SDK)         │ spans: classification,                │ spans: 토큰·latency
                     │        routing.decision(verdict),     │ (입출력 원문 ✗)
                     │        security, backend, upstream     │
                     └──────────────┬───────────────────────┘
                                    │ OTLP (gRPC :4317 / HTTP :4318)
                                    ▼
                       OTel Collector (Deployment, fan-out)
                          ├── otlphttp/langfuse → {langfuse}/api/public/otel/v1/traces   (Basic auth)
                          └── otlp/victoria-traces → 서빙 내부 스팬 보관
                                    │
   프롬프트/응답 원문(마스킹) ──────────┴── 게이트웨이/SR → POST {langfuse}/api/public/ingestion (option B)
                                    ▼
                          Langfuse (web+worker, PG/ClickHouse/Redis/S3)
                                    ▲
                          FABRIX BFF (읽기 전용) → 트레이스/세션/대시보드 화면
```

핵심: SR·vLLM이 **같은 trace context 를 전파**해야 한 waterfall로 묶임(SR 문서: "correlate traces across router and vLLM backends").

---

## 2. 무엇이 어디서 나오나 (교차검증 표)

| 데이터 | 소스 | OTEL로? | 검증(출처) |
|---|---|---|---|
| 라우팅 분류 | SR `semantic_router.classification` | ✅ | SR 분산추적 문서 |
| **jailbreak/정책 판정** | SR `semantic_router.routing.decision`·security 스팬 | ✅ | SR 분산추적 문서 |
| 토큰 수·latency·TTFT | vLLM | ✅ | Langfuse vLLM 통합 문서 |
| app→SR→vLLM 한 트레이스 | 컨텍스트 전파 | ✅ | SR "correlate across router and vLLM" |
| **프롬프트·응답 원문** | (vLLM OTEL ✗) | ❌ | **vLLM 통합 문서 명시**: "vLLM only exports token counts and latency … input/output need to be manually captured" |
| 비용 | 모델단가×토큰 | ✅(설정) | Langfuse `POST /models` 단가 |
| 판정을 **점수 지표**로 | Scores | ❌ OTEL | `POST /api/public/scores`(REST) |

→ 원문·점수만 REST, 나머지는 OTEL.

---

## 3. 설치 (Helm)

### 3.1 Langfuse (self-host)
```bash
helm repo add langfuse https://langfuse.github.io/langfuse-k8s
helm repo update
# values.yaml: 시크릿(NEXTAUTH_SECRET/SALT/ENCRYPTION_KEY 32B hex) + PG/ClickHouse/Redis/S3
helm install langfuse langfuse/langfuse -n langfuse --create-namespace -f values.yaml
```
- web+worker 배포. PG/ClickHouse/Redis/S3 는 번들 또는 BYO(운영은 BYO 권장, ClickHouse는 NVMe SC 분리).
- v3 = ClickHouse 에 trace/observation/score, PG 는 메타(유저/프로젝트/프롬프트/키).
- (현행) 차트가 `bitnamilegacy/*` 이미지 기본 — Bitnami 레지스트리 개편 대응.

### 3.2 OpenTelemetry Collector
```bash
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update
helm install otel-collector open-telemetry/opentelemetry-collector -n observability --create-namespace \
  --set mode=deployment -f collector-values.yaml
```
- mode: `deployment`(게이트웨이형 fan-out) 또는 `daemonset`(노드 로컬 수집). fan-out 용도는 deployment.
- values 의 config 는 기본값과 **병합**되며, **리스트는 병합 안 됨**(pipeline 정의 시 전체 명시).

---

## 4. 설정

### 4.1 Langfuse OTLP 엔드포인트·인증 (교차검증)
| 항목 | 값 |
|---|---|
| 엔드포인트 | `{host}/api/public/otel` (signal: `.../otel/v1/traces`). self-host 는 `http://langfuse-web.langfuse:3000/api/public/otel` |
| 프로토콜 | **OTLP over HTTP** (`http/json` 또는 `http/protobuf`). **gRPC 미지원** ⚠️ |
| 인증 | **Basic**, `base64(pk-lf:sk-lf)` |
| 추가 헤더 | `x-langfuse-ingestion-version: 4` |

```bash
AUTH=$(echo -n "pk-lf-...:sk-lf-..." | base64)
```

### 4.2 Collector exporter (otlphttp → Langfuse) + fan-out
```yaml
# collector-values.yaml
extraEnvs:
  - name: LF_AUTH
    valueFrom: { secretKeyRef: { name: langfuse-otlp, key: basic } }   # base64(pk:sk)
config:
  exporters:
    otlphttp/langfuse:
      endpoint: "http://langfuse-web.langfuse:3000/api/public/otel"     # HTTP, 내부 ClusterIP
      headers:
        Authorization: "Basic ${env:LF_AUTH}"
        x-langfuse-ingestion-version: "4"
    otlp/victoria:                                                       # 서빙 내부 스팬 보관(하이브리드)
      endpoint: "victoria-traces.observability:10428"
  service:
    pipelines:
      traces:                                                            # 리스트 전체 명시(병합 안 됨)
        receivers: [otlp]
        processors: [batch]
        exporters: [otlphttp/langfuse, otlp/victoria]
```
> auth 는 **Secret** 으로 주입. gRPC 안 되므로 반드시 `otlphttp`.

### 4.3 vLLM (토큰·latency)
```bash
# Collector 로 보냄(권장: fan-out·auth 중앙화). Collector OTLP HTTP=:4318
vllm serve <model> \
  --otlp-traces-endpoint="http://otel-collector.observability:4318/v1/traces"
# env
OTEL_SERVICE_NAME=vllm
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/protobuf
```
- 대안(직결): 엔드포인트를 `{langfuse}/api/public/otel/v1/traces` 로, `OTEL_EXPORTER_OTLP_TRACES_HEADERS=Authorization=Basic <b64>` 추가. 단 fan-out 안 됨.
- ⚠️ **재확인**: vLLM 은 토큰·latency만 보냄 → 원문은 §4.5 로 보완.

### 4.4 Semantic Router (분류·판정 스팬)
```yaml
# SR observability 설정
observability:
  tracing:
    enabled: true
    provider: opentelemetry
    exporter:
      type: otlp
      endpoint: "otel-collector.observability:4317"   # 또는 4318(http)
```
- emit 스팬: `semantic_router.classification`, `semantic_router.routing.decision`(판정), security/cache/backend/upstream. → 판정·confidence가 트레이스에 들어옴.
- app→SR→vLLM 가 한 트레이스가 되려면 **W3C traceparent 전파**(app 이 trace context 시작, SR·vLLM 이 이어받음).

### 4.5 프롬프트/응답 원문 캡처 (option B, 게이트웨이 글루)
vLLM OTEL 로 안 오므로, 게이트웨이/SR(데이터플레인) 옆 **작은 글루**가 캡처해 ingestion REST 로 보낸다.

**글루 동작(요청마다):**
1. **마스킹 정책 폴링·캐시**: `GET {fabrix-bff}/api/v1/masking/policy` (FABRIX 가 PG 에 영속, 설정 화면에서 편집).
2. 정책에 따라 프롬프트/응답 캡처 모드 결정(none/masked/full) + PII 유형별 처리(보관/마스킹/해시/제거).
3. **동일 W3C trace-id** 로 ingestion POST → OTEL 스팬과 한 트레이스로 병합:
```
POST {langfuse}/api/public/ingestion   (Basic auth, x-langfuse-ingestion-version: 4)
 batch: [ trace-create(id=<W3C trace-id>),
          observation-create(traceId=<동일>, type=GUARDRAIL, input=마스킹된 원문, output=판정),
          generation-create(traceId=<동일>, input/output=프롬프트/응답(정책 적용)),
          score-create(traceId=<동일>, jb_confidence) ]
```
→ 한 화면에 "프롬프트(정책대로) → 판정 → 응답 + 토큰/latency".

**마스킹 정책(고객사별 설정)** — FABRIX 설정 화면(가드레일 > 마스킹 탭)에서 편집, PG 영속:
| 필드 | 의미 |
|---|---|
| `enabled` | 마스킹 적용 여부 |
| `capture_input`/`capture_output` | 프롬프트/응답 보존: `none`/`masked`/`full` |
| `blocked_capture` | 차단건 보존(감사용 `full` 등) |
| `rules[]` | PII 유형별 `action`: `keep`/`mask`/`hash`/`remove` (rrn·account·card·phone·email·name·address…) |

- API: `GET /api/v1/masking/policy`(guard cap), `PUT`(guard.write cap). 모델: [`backend/internal/domain/masking.go`](../../backend/internal/domain/masking.go).
- **자동계측보다 통제 쉬움 = 금융 적합** — POST 직전 정책으로 거르므로 원문 노출 범위를 운영자가 통제.
- 글루는 BFF 가 아니라 게이트웨이 레이어(ext_proc enrich / 사이드카 / 로그 tailer). 언어 무관(REST).
- **구현(스캐폴딩 완료)**: [`backend/cmd/glue`](../../backend/cmd/glue/) — `POST /v1/capture` 로 받아 정책 폴링·마스킹·trace-id 병합·ingestion 배치. 게이트웨이/어댑터가 `/v1/capture` 호출. 마스킹 엔진 단위테스트 통과, 종단은 Langfuse 구성 후 검증.

---

## 5. 함정·체크리스트
- [ ] ⚠️ **gRPC 금지**: Langfuse OTLP 는 HTTP 전용 → Collector exporter 는 `otlphttp`.
- [ ] ⚠️ **vLLM 원문 미전송**: 프롬프트/응답은 OTEL 로 안 옴 → §4.5 ingestion 필수.
- [ ] **traceparent 전파**: app→SR→vLLM 동일 trace context (안 되면 따로 노는 트레이스).
- [ ] Collector `config` 의 pipeline **리스트 전체 명시**(Helm 리스트 병합 안 됨).
- [ ] auth 헤더 + `x-langfuse-ingestion-version: 4` 는 **Secret** 주입.
- [ ] NetworkPolicy: `Collector/gateway → langfuse-web:3000` 만 허용(폐쇄망).
- [ ] Langfuse 서버 시크릿(NEXTAUTH_SECRET/SALT/ENCRYPTION_KEY), ClickHouse NVMe SC, Redis noeviction.
- [ ] 비용 보려면 `POST /api/public/models` 단가 등록 + 모델명 일치.

## 6. 우리 코드 정합
- **BFF 는 적재 안 함** — 읽기만([`backend/internal/langfuse/client.go`](../../backend/internal/langfuse/client.go) GET). 위 파이프라인이 채운 Langfuse 를 트레이스/세션 화면이 읽음.
- observe 프로파일(읽기전용)과 정확히 일치 — 텔레메트리는 데이터플레인이 만들고 FABRIX 는 관제.
- playground 경로의 BFF 직접 호출은 **테스트 예외**(프로덕션 모니터링과 무관).

## 출처
- [Langfuse OpenTelemetry 엔드포인트/인증](https://langfuse.com/integrations/native/opentelemetry)
- [Langfuse self-host Kubernetes(Helm)](https://langfuse.com/self-hosting/deployment/kubernetes-helm) · [langfuse-k8s](https://github.com/langfuse/langfuse-k8s)
- [OpenTelemetry Collector Helm Chart](https://opentelemetry.io/docs/platforms/kubernetes/helm/collector/)
- [Langfuse ↔ vLLM OpenTelemetry 통합(원문 미전송 명시)](https://langfuse.com/integrations/model-providers/vllm) · [vLLM OpenTelemetry 예제](https://docs.vllm.ai/en/stable/examples/online_serving/opentelemetry/)
- [vLLM Semantic Router 분산추적](https://vllm-semantic-router.com/docs/v0.1/tutorials/observability/distributed-tracing/) · [OTEL 통합 이슈 #328](https://github.com/vllm-project/semantic-router/issues/328)
