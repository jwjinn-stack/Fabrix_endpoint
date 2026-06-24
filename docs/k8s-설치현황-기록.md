# FABRIX Endpoint — K8s 설치현황 & 검증 기록 (Living Log)

> **목적**: 실제 클러스터에 *무엇이 설치돼 있고/없는지*, *무엇을 우리가 설치했는지*, *통신 검증 결과*를 지속 기록한다.
> 최초 작성 2026-06-18 · 갱신은 맨 아래 "설치·검증 로그"에 누적.
> 짝 문서: [dev-설치-검증-정의.md](dev-설치-검증-정의.md)(무엇을 설치할지 정의), [통합문서](FABRIX-endpoint-개발참조-통합문서.md)(SSOT)

---

## 0. 클러스터 사실 (실측 2026-06-18)
- **K8s v1.35.3**, containerd. 4노드: `master-01`(control-plane) · `cpu-worker-01` · **`gpu-worker-02`(GPU 8장)** · **`gpu-worker-03`(GPU 7장)**. 노드 IP `192.168.160.43~76`.
- 개발 머신 → 클러스터 **NodePort 통신 가능** (검증됨).
- 현재 **MIG 미분할** (노드에 full GPU만 노출, `nvidia.com/mig-*` 없음).
- context: `kubernetes-admin@kubernetes`.

## 1. 네임스페이스 결정
- **우리 산출물 = `fabrix-endpoint` (신규 생성함)**.
- ⚠ 기존 `fabrix` / `fabrix-etri` 는 **다른 버전(fabrix-v2**, `ghcr.io/maymustai/fabrix-v2-{backend,frontend}`)** → **건드리지 않음**.

---

## 2. 컴포넌트 설치현황 (정의 §1 대비)

### ✅ 이미 설치됨 (재사용)
| 컴포넌트 | 버전 / 위치 | 비고 |
|----------|-------------|------|
| **GPU Operator** | `v26.3.0` (ns gpu-operator) | DCGM·MIG manager·device-plugin·driver 포함. GPU 8+7 노출 |
| **NFD** | node-feature-discovery 0.18.3 | GPU Operator 전제 |
| **Dynamo** | `dynamo-platform 1.1.0` (ns dynamo-system) | Operator + **NATS** 구동 중. **etcd 별도 파드 없음**(이 버전은 미사용) |
| Dynamo CRDs | `dynamographdeployments.nvidia.com` 등 7종 | apiVersion nvidia.com |
| **작동 중 모델 엔드포인트** | `gemma4-31b-vllm-agg` (ns dynamo-inference, **READY**) | agg 패턴. NodePort 30812 → `/v1/models`=`gemma-4-31b-it` |
| **Envoy Gateway** | `gateway-helm v1.7.2` (ns envoy-gateway-system) | Gateway API CRD + envoy CRD 존재 |
| **cert-manager** | (ns cert-manager) | CRD 존재 |
| **Harbor** | `2.15.0` (ns harbor) | 사내 OCI 레지스트리 |
| **MinIO** | (ns minio) | S3 호환 — 후속 모델저장소/WORM 대체 후보 |
| **관측: VictoriaMetrics 스택** | victoria-metrics-k8s-stack 0.72.6 (ns observability) | **Prometheus 대체**. 쿼리=`vmselect-vm:8481`(NodePort 30401), Grafana NodePort 32200, monitoring.coreos.com CRD 호환 |
| **트레이스: victoria-traces** | 0.0.9 (ns observability) | Jaeger 대체. NodePort 30832. + opentelemetry-operator |
| **로그/수집: Vector + victoria-logs** | (ns vector/observability) | **Fluent Bit 대체 후보** |
| **PostgreSQL: CloudNativePG** | cnpg 1.29.1 (ns cnpg-system) | `clusters.postgresql.cnpg.io` CRD로 인스턴스 생성 |
| **KEDA** | 2.19.0 | 오토스케일(SLO Planner 보완/대체) |
| 기타 vLLM 모델 | ns vllm: qwen3·qwen25vl·bge-m3·bge-reranker (ClusterIP :8000) | OpenAI 호환 |

### ❌ 미설치 → 설치 대상
| 컴포넌트 | 용도 | 계획 |
|----------|------|------|
| **vLLM Semantic Router** | 가드레일(PII/Jailbreak/intent) → `x-vsr-matched-*` 헤더 | 기존 Envoy GW v1.7.2에 **`EnvoyExtensionPolicy`(per-route, 전역 플래그 불필요)** 로 ext_proc(:50051) 부착. 차트 `oci://ghcr.io/vllm-project/charts/semantic-router`. 모델은 부팅 시 HF 자동다운로드→`persistence` PVC(기본 10Gi) 캐시; 인터넷 egress 가능 dev에선 자동, 폐쇄망 전환 시 `existingClaim`/hostPath로 사전반입. RBAC: ClusterRole `dynamo-extproc-access`→SA `semantic-router`. 상세 [dev-설치-검증-정의 §2-E / §4](dev-설치-검증-정의.md) |
| **ClickHouse** | 증적/롤업 분석 미러 | ns `fabrix-endpoint`, localPV |
| **fabrix-endpoint 워크로드** | api·web·audit-ingestor·rollup-worker | 우리 이미지 → Harbor → ns `fabrix-endpoint` |
| **Dynamo→VM 스크레이프** | `dynamo_frontend_*` 메트릭 수집 | VMServiceScrape 추가 (현재 VM이 dynamo 미수집) |

### 🔁 정의 대비 적응(클러스터 현실에 맞춤)
- 관측은 **Prometheus/Grafana 신규설치 ❌ → 기존 VictoriaMetrics 재사용**. relabel/scrape는 VM(VMServiceScrape) 방식.
- 트레이스는 Jaeger ❌ → **victoria-traces(OTLP)** 재사용.
- Postgres 단독 파드 ❌ → **CNPG `Cluster` CR**로 생성.
- Fluent Bit 신규 ❌ → 기존 **Vector** 재사용 검토.

---

## 3. 통신·응답 검증 결과 (지시 #3)

| 검증 | 방법 | 결과 |
|------|------|------|
| 모델 목록 | `GET :30812/v1/models` | ✅ `gemma-4-31b-it` |
| **추론 왕복** | `POST :30812/v1/chat/completions` (gemma4) | ✅ 한국어 정상 응답, usage `prompt 22 / completion 33` |
| Dynamo 메트릭 노출 | `GET :30812/metrics` | ✅ `dynamo_frontend_*` 노출 (정의 §2-D 확인) |
| 가드레일 헤더 | 위 응답 헤더 | ❌ `x-vsr-*` 없음 — 현재 client→Dynamo 직결, Envoy+SemanticRouter 미경유(예상된 갭) |
| 메트릭 쿼리 | `vmselect :30401 /select/0/prometheus/api/v1/query` | ✅ 동작(`up` 56 series). 단 `dynamo_frontend_*`는 **VM 미수집**(스크레이프 타깃 추가 필요) |

**결론**: 서빙·추론 경로는 실증 완료. 갭은 (a) 가드레일 경로(Semantic Router) (b) ClickHouse (c) Dynamo 메트릭 VM 수집.

---

## 4. 설치·검증 로그 (누적)

### 2026-06-18
- 클러스터 인벤토리 실시, 위 §2 현황 확정.
- `kubectl create namespace fabrix-endpoint` — ✅ 우리 작업 네임스페이스 생성.
- gemma4 Dynamo 엔드포인트 통신 검증 ✅ (models/chat/metrics).
- vmselect 쿼리 API 검증 ✅ (live provider 소스로 사용 가능).
- **중요 발견**: ClickHouse 이미지가 `docker.io`에서 정상 pull됨(17s) → **이 dev 클러스터는 인터넷 egress 가능**. 즉 *폐쇄망은 운영 목표*이고, 현재 dev는 공개 이미지 직접 pull 가능(개발 속도에 유리). 운영 전환 시 Harbor 미러링 필요.
- ✅ **ClickHouse 설치 완료** (ns fabrix-endpoint): `clickhouse/clickhouse-server:24.8-alpine`, Deployment+PVC(local-path 10Gi)+Service. 매니페스트 [deploy/k8s/clickhouse.yaml](../deploy/k8s/clickhouse.yaml).
- ✅ **ClickHouse 스키마 생성**: `fabrix.guard_audit`, `fabrix.usage_rollup` (문서 2-4/3-5). DDL [deploy/k8s/clickhouse-schema.sql](../deploy/k8s/clickhouse-schema.sql). 접속: svc `clickhouse.fabrix-endpoint:8123/9000`, user `fabrix`/`fabrix_dev`, db `fabrix`.
- **메트릭 파이프라인 갭 발견·수정**:
  - DCGM GPU 메트릭은 VM에 실시간 수집 중(375 시리즈) → GPU 카드 실데이터 가능.
  - `dynamo.*`/`vllm.*`는 0건이었음. 원인 = 기존 `dynamo` 스크레이프가 `system`(9090) 포트만 봄. 추론 메트릭은 `openai-http`(8000)에 존재.
  - ✅ **VMServiceScrape `dynamo-frontend-openai` 추가**([deploy/k8s/vmservicescrape-dynamo-frontend.yaml](../deploy/k8s/vmservicescrape-dynamo-frontend.yaml)) → `dynamo_frontend_requests_total` 등 VM 수집 확인(3 시리즈).
- **live provider 가용 소스 확정**: vmselect(`:30401` 또는 svc `vmselect-vm.observability:8481`) PromQL로 (a) GPU=DCGM_FI_DEV_*, (b) 트래픽/품질=dynamo_frontend_* 조회 가능. 가드레일=Semantic Router 설치 후.
- ✅ **live provider 구현·검증 완료** ([backend/internal/provider/live/live.go](../backend/internal/provider/live/live.go)). `FABRIX_DATA_SOURCE=live` + `FABRIX_VMSELECT_URL`.
  - 매핑: GPU=DCGM_FI_DEV_*, 트래픽/품질=dynamo_frontend_*(rate·histogram_quantile), 모델분포=`model` 라벨. 가드레일=0(Semantic Router 후), dept=빈값(귀속 라벨 후).
  - **실클러스터 검증**(dev머신→vmselect NodePort 30401): gemma4 부하 20건 후 TTFT p50/p95=**156/214ms**, ITL=**47ms**, QPS=0.1, KV=0.25, 모델분포 gemma-4-31b-it=100%, timeseries 비-0. **요청→Dynamo→VM→live provider→대시보드 전체 루프 실증.**
- (다음) Semantic Router(⚠ 공유 Envoy GW 변경 — 승인 필요) / 우리 워크로드 배포(이미지 빌드→Harbor→fabrix-endpoint) / UI 개선 / intent-qa-loop.

### 2026-06-18 (추가: Semantic Router 설치 사전조사 — 웹/공식소스 대조)
- **공유 Envoy GW v1.7.2 변경 최소화 경로 확정**: 공식 Dynamo 가이드는 `EnvoyPatchPolicy`라 **컨트롤러 전역 `enableEnvoyPatchPolicy: true`가 필요**하나(공유 GW에 영향), Envoy Gateway 네이티브 `EnvoyExtensionPolicy`는 **전역 플래그 없이 HTTPRoute 단위(per-route)** 부착 가능 → **EnvoyExtensionPolicy 채택 권장**(공유 GW 영향 최소). 출처: SR repo `deploy/kubernetes/dynamo/dynamo-resources/*`, gateway.envoyproxy.io ext-proc 태스크. 확신도 높음.
- **ext_proc gRPC = :50051** (SR 차트 `service.grpc.port`), HTTP API 8080 / metrics 9190.
- **모델 다운로드**: 최신 차트는 initContainer 없이 부팅 시 HF 자동 다운로드(`mom_registry`)→`persistence` PVC(기본 `standard`/`RWO`/`10Gi`) 캐시. 다운로드 10~20분(startupProbe 여유 큼). 폐쇄망=`persistence.existingClaim` 또는 `extraVolumes` hostPath 사전반입.
- **RBAC**: ClusterRole `dynamo-extproc-access`(dynamographdeployments·pods·services·endpoints·deployments·statefulsets 읽기) → SA `semantic-router`(ns `vllm-semantic-router-system`).
- **응답 헤더 확정**(소스 `pkg/headers/headers.go`): `x-vsr-selected-{category,decision,confidence,reasoning,model,modality}`, `x-vsr-matched-pii`, `x-vsr-matched-jailbreak`, `x-vsr-cache-hit`, `x-vsr-fast-response` 등. SSOT의 `x-vsr-pii-violation`/`x-vsr-jailbreak-blocked`는 **부재** → audit-ingestor 매핑 수정 필요.
- **남은 확인**: SR 차트 버전 핀(공식은 롤링 `v0.0.0-latest` — 폐쇄망 재현성 위해 다이제스트 핀 필요), 분류기 모델 총 용량 실측(차트 PVC 기본 10Gi, "~1.5GB"는 단일모델 가정치 가능성).

### 2026-06-18 (Semantic Router 설치 착수 + 워크로드 배포 파이프라인 + UI 개선)
- ✅ **워크로드 배포 파이프라인 작성**: backend/web Dockerfile, [.github/workflows/build-and-push.yml](../.github/workflows/build-and-push.yml)(GHCR), [deploy/k8s/fabrix-endpoint.yaml](../deploy/k8s/fabrix-endpoint.yaml)(api live+web NodePort 30092). git init 완료. 활성화=GitHub(maymustai) push→Actions→GHCR→`kubectl apply`.
- ✅ **Semantic Router helm 설치** (ns `vllm-semantic-router-system`): 차트 `oci://ghcr.io/vllm-project/charts/semantic-router@v0.0.0-latest`, values [deploy/k8s/semantic-router-values.yaml](../deploy/k8s/semantic-router-values.yaml). PVC `local-path` 20Gi Bound, SA+ClusterRole `semantic-router` 생성. svc: `semantic-router:50051`(gRPC ext_proc)·`:8080`(HTTP)·`-metrics:9190`. **분류기 모델 HF 자동 다운로드 진행(~10-20분)**.
- ⏭ **다음**: SR Ready 후 격리 전용 Gateway(`envoy` 클래스) + HTTPRoute(→gemma4 Dynamo) + **EnvoyExtensionPolicy(per-route ext_proc→SR:50051)** + 교차-ns ReferenceGrant 배선 → `x-vsr-matched-*` 헤더 검증. (공유 Envoy GW 미변경)
- ✅ **UI 개선(design-review)**: 포커스 링·시맨틱 버튼/aria, AA 명도대비, 빈/로딩/에러 상태, 토큰화(하드코딩 hex 0), 색맹 대응 알람 기호, reduced-motion. 빌드 통과.

### 2026-06-18 (Semantic Router CrashLoop 해결)
- **원인 확정**: 롤링 `v0.0.0-latest` 차트가 *옛 스키마(pre-v0.3)* config를 렌더하는데, `latest` 이미지(v0.3.x)는 *canonical v0.3* config(version/listeners/providers/routing/global)를 요구 → `runtime_config_load_failed` fatal로 CrashLoop.
- **해결**: 릴리스 태그 확인(v0.3.0/v0.2.0/v0.1.0) 후 **이미지를 `v0.2.0`(pre-v0.3, GHCR 200 확인)으로 핀** → 차트 config 스키마와 정합. helm upgrade(rev3) → 파드 Running, **config 로드 통과**(canonical fatal 소멸), 현재 분류기 모델 HF 다운로드 중. values [deploy/k8s/semantic-router-values.yaml](../deploy/k8s/semantic-router-values.yaml)에 `image.tag: v0.2.0` 반영.
- 롤아웃 중 2파드가 동일 RWO PVC 다운로드 락 경합 → 구 RS scale 0으로 단일 파드 수렴.
- ⏭ SR Ready(모델 다운로드 완료) 후: 격리 Gateway + HTTPRoute(→gemma4) + EnvoyExtensionPolicy(ext_proc→SR:50051) + ReferenceGrant 배선 → `x-vsr-matched-*` 검증.

### 2026-06-18 (개발 백로그: 사용량 리포트 + 라우팅 + 테스트 / SR 2차 이슈)
- ✅ **사용량·귀속 리포트(문서 4-2) 구현·실데이터 검증**: API `GET /api/v1/usage?range=`(live provider가 vmselect 모델별 increase/histogram 조인). 화면 [web/src/pages/Usage.tsx] 테이블+CSV 내보내기+빈 상태. 실측: gemma-4-31b-it 요청 104·입력 2.5K·출력 17.3K·TTFT 217ms·ITL 46ms.
- ✅ **클라이언트 라우팅**: 사이드바 관제↔사용량 전환(Layout page/onNavigate, App 상태). 브라우저 검증(h1 전환·테이블 렌더·콘솔 에러 0).
- ✅ **Go 단위 테스트**(`go test ./...` 통과): domain ParseRange/Buckets/PromDuration, live PromQL 매핑(httptest mock vmselect — Usage 정렬·초→ms 변환·토큰 정수, Overview GPU util/KV/MIG, 빈 결과 0 폴백).
- ⚠ **Semantic Router 2차 이슈**: v0.2.0 핀으로 config 로드는 통과, BERT 모델 다운로드까지 됐으나 `models/mom-pii-classifier/pii_type_mapping.json` 부재로 ExtProc 생성 fatal(CrashLoop). 롤링 차트 config가 기대하는 PII 모델 파일 레이아웃 ↔ v0.2.0 이미지/HF 모델 정합 문제. 단순 버전핀 이상 — config의 PII 모델 경로/모델셋 정합 필요. **판단 대기**(추가 정합 작업 vs 가드레일 후속 보류).

### 2026-06-18 (Semantic Router CrashLoop 해결 — 3차: PII mapping 경로 정합 → Ready 달성)
- **원인 확정**: 차트 `v0.0.0-latest` 기본 values(`values.yaml` L276-281)의 `config.classifier.pii_model` 블록이 **자기모순**. `model_id: models/pii_classifier_modernbert-base_presidio_token_model`(HF에서 정상 다운로드)인데 `pii_mapping_path: models/mom-pii-classifier/pii_type_mapping.json`(존재하지 않는 디렉토리/파일)을 가리킴 → ExtProc 생성 시 `failed to load PII mapping: open models/mom-pii-classifier/pii_type_mapping.json: no such file or directory` fatal → CrashLoop.
- **실측(디버그 파드로 PVC `semantic-router-models` 조사)**: PVC에는 `mom-pii-classifier/`가 아예 없고, 실제 PII 모델 디렉토리 `pii_classifier_modernbert-base_presidio_token_model/`에는 `pii_type_mapping.json`이 없으며 대신 **`label_mapping.json`** 존재. 그 포맷(`{label_to_idx, id_to_label}`)은 정상 동작하는 jailbreak `jailbreak_type_mapping.json`과 동일 → 로더 호환. (다운로드된 모델 4종 모두 ready, 재다운로드 불필요)
- **공식 소스 대조**: `github.com/vllm-project/semantic-router` v0.2.0 태그 `config/config.yaml`의 PII는 `pii_mapping_path: models/mom-pii-classifier/label_mapping.json`(파일명 = `label_mapping.json`). 즉 차트 기본값의 `pii_type_mapping.json`이 잘못. 출처: raw.githubusercontent.com/vllm-project/semantic-router/v0.2.0/config/config.yaml. 확신도 높음.
- **해결**: values [deploy/k8s/semantic-router-values.yaml](../deploy/k8s/semantic-router-values.yaml)에 `config.classifier.pii_model` override 추가 — `pii_mapping_path`를 실제 다운로드된 `models/pii_classifier_modernbert-base_presidio_token_model/label_mapping.json`으로 교정(model_id·threshold·use_cpu·use_modernbert 함께 명시). 차트 ConfigMap은 `.Values.config`를 deepCopy 후 toYaml 렌더 → deep merge로 다른 섹션(bert_model/prompt_guard/category_model 등) 보존 확인(helm template dry-run).
- **결과**: `helm upgrade`(REVISION 4) → 롤아웃 성공, 구 RS 종료 후 신 파드 **Running 1/1 Ready**(`semantic-router-67c896d95d-wwmfb`). 로그상 PII Detector가 `label_mapping.json` 로드 성공(Traditional BERT 자동감지 실패 후 ModernBERT fallback으로 정상 초기화 — fatal 아님), ExtProc gRPC :50051 listening, HTTP API :8080 listening.
- **동작 검증**: `:8080/health` → HTTP 200. PII classify API — 명시적 PII("john.smith@acme.com"·"415-555-0199") 입력 시 `has_pii:true`/`security_recommendation:block`/confidence 0.748로 정상 차단 판단(추론 ~154ms). gRPC :50051 svc endpoint 등록 확인(`10.0.4.78:50051`). 디버그 파드는 검증 후 삭제.
- **values diff 요약**: 기존 `image.tag: v0.2.0` + persistence/SA/RBAC 유지에 더해, 신규 `config.classifier.pii_model` 블록 추가(pii_mapping_path 교정). 그 외 변경 없음.
- ⏭ SR Ready 달성 — 다음 단계(이 작업 범위 밖): 격리 Gateway + HTTPRoute(→gemma4) + EnvoyExtensionPolicy(ext_proc→SR:50051) + ReferenceGrant 배선 → `x-vsr-matched-*` 헤더 검증.

### 2026-06-18 (Fireworks/Together·Nutanix 벤치마킹 기능: 카탈로그·플레이그라운드·키발급)
- ✅ **모델 카탈로그** `GET /api/v1/models`(클러스터 5모델 + 라이브 status 프로브) + 카드 그리드 화면 + **모달리티 탭 필터**.
- ✅ **플레이그라운드** `POST /api/v1/playground/chat`(업스트림 OpenAI 프록시, 우리 레이어 통과) + 채팅 화면. gemma4 실추론 검증(토큰·지연·TPS).
- ✅ **엔드포인트 발급(키·앱)** — **CNPG Postgres** `fabrix-pg` provision(ns fabrix-endpoint, local-path 5Gi) + 스키마 `app`/`api_key`. Go: pgx + `internal/store`. API `POST/GET/DELETE /api/v1/keys`. **검증(curl)**: 발급→평문 1회 반환, 목록→마스킹(prefix만), 회수→enabled=false, **DB엔 sha256 해시만(R4 준수)**. UI: 키·앱 페이지(Nutanix 플로우 — 목록·상태 pill·회수, 발급 모달·평문 1회 표시). dev는 port-forward로 DB 접속(인클러스터 배포 시 `fabrix-pg-rw:5432` 직결).
- 참고 문서: [fireworks-together-benchmark.md](fireworks-together-benchmark.md), Nutanix UI 이미지(docs/naiUIReferenceImage).
- ⚠ dev 한정: kubectl port-forward(Postgres)가 간헐 drop → retry 루프로 보강. 인클러스터 배포 시 불필요.

### 2026-06-18 (모델 카탈로그·플레이그라운드·엔드포인트 발급 + Nutanix/Fireworks 참고)
- ✅ **모델 카탈로그**(`/api/v1/models`)·**플레이그라운드**(`/api/v1/playground/chat` 프록시) 구현·검증. 카탈로그=클러스터 5모델 카드+모달리티 탭, 플레이그라운드=gemma4 실추론(TPS/토큰/지연). Fireworks/Together 벤치마킹.
- ✅ **엔드포인트 발급(키·앱) 완성·실DB 검증**:
  - **CNPG Postgres `fabrix-pg`** provision(ns fabrix-endpoint, 1 instance healthy). 스키마 `app`/`api_key`([deploy/k8s/fabrix-pg-schema.sql], 해시만 저장·R4).
  - 백엔드 `internal/store`(pgx) + `/api/v1/keys`(발급/목록/회수). 발급 plaintext 1회 반환, DB엔 sha256 해시+prefix만.
  - UI 키·앱 페이지: 발급 모달→평문 1회 표시+경고+복사, 목록(상태 활성/회수됨), 회수. **브라우저 end-to-end 검증**(발급→5개 키→회수됨 반영).
  - 연결: 인클러스터 `fabrix-pg-rw.fabrix-endpoint:5432` / dev는 port-forward + `FABRIX_DATABASE_URL`.
- ✅ 참고 문서: [fireworks-together-benchmark.md] + [nutanix-nai-benchmark.md](nutanix-nai-benchmark.md)(대시보드 도넛/Top5·엔드포인트 생성폼·Create API Key 모달·Latency p50/95/99 패턴).
- 현재 화면 5종 실데이터 동작: 관제·사용량·모델·플레이그라운드·키앱.
