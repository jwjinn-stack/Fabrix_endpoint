# FABRIX Endpoint — Dev 검증 환경 **설치·검증 정의**

> **목적**: 본격 개발 전에 *무엇을 설치하고 무엇을 검증할지*를 단일 출처로 고정한다. (설치 *순서*가 아니라 *대상·검증 항목* 정의)
> **범위**: dev 검증 환경 (단일/소수 내부 노드, GPU 실물, 폐쇄망 가정)
> 작성일 2026-06-18 · 기준 SSOT: [FABRIX-endpoint-개발참조-통합문서.md](FABRIX-endpoint-개발참조-통합문서.md)
> ⚠ 아래 "확신도"는 공식 문서 대조 결과다. **불확실/미확인 항목은 대상 릴리스 버전 문서로 재확인 후 확정**한다.

---

## 0. 확정된 결정사항 (dev 검증)

| # | 결정 | 비고 |
|---|------|------|
| D-a | **GPU 스택 = NVIDIA GPU Operator로 설치** (호스트 직접 설치 아님) | 드라이버·toolkit·device-plugin·MIG·DCGM을 Pod/DaemonSet으로 일괄 |
| D-b | **상태 저장 서비스 = 클러스터 내 Pod + localPV PVC** | 외부 매니지드/SAN 없는 dev 한계 |
| D-c | **모든 컨테이너 이미지 = Harbor(사내 레지스트리)에서 pull** | containerd 미러 설정 |
| D-d | **모델 가중치 = 이번 dev에선 내부 노드 로컬에서 마운트** (hostPath/localPV) | 개발 속도 ↑. 모델 저장소(MinIO 등) 분리는 후속 |
| D-e | **ObjectScale(WORM 증적) = P2로 보류** | dev에선 증적 WORM 타깃 미설치 |

---

## 1. 설치 인벤토리 (레이어별)

> 형식: **컴포넌트 / 설치 방식 / dev 적용 / 검증 포인트**. 출처·확신도는 §3 참조.

### 1-1. 플랫폼
| 컴포넌트 | 설치 | dev 적용 | 검증 |
|----------|------|----------|------|
| **NVIDIA GPU Operator** | Helm `nvidia/gpu-operator` (NGC repo) | 드라이버·`nvidia-container-toolkit`·device-plugin·**GFD**·**DCGM+DCGM Exporter**·**MIG Manager**·Validator(+NFD) 일괄 배포 | `nvidia-smi`(드라이버 파드) · `nvidia.com/mig-*` 리소스 노출 · MIG 슬라이스 생성 · dcgm-exporter 메트릭 |
| **MIG 설정** | GPU Operator `mig.strategy=single\|mixed` + MIG Manager | `nvidia.com/mig.config` 노드 레이블로 프로파일 적용 | 슬라이스가 `kubectl describe node`에 노출 (Ampere↑ GPU 필요: A100/A30/H100/H200/Blackwell) |
| **local-path-provisioner** (또는 static localPV) + StorageClass | manifest | PVC 백엔드 (D-b 전제) | PVC 생성→Bound, Pod 마운트 |

> **DCGM Exporter는 GPU Operator에 기본 포함·활성**(`dcgmExporter.enabled=true`). **별도 설치 아님.**

### 1-2. 서빙·라우팅 (ns: `vllm-prod-stack`)
| 컴포넌트 | 설치 | dev 적용 | 검증 |
|----------|------|----------|------|
| **Dynamo CRDs** | Helm `dynamo/dynamo-crds` (repo `https://nvidia.github.io/dynamo`) | CRD: `DynamoGraphDeployment`, `DynamoComponentDeployment` 등 (`*.nvidia.com`) | `kubectl get crd | grep nvidia.com` |
| **Dynamo Platform** | Helm `dynamo/dynamo-platform` | **Operator + etcd + NATS(JetStream) 번들 포함** | `dynamo-operator-*`, `etcd-*`, `nats-*` 파드 Running |
| **vLLM 워커** | `DynamoGraphDeployment` CR | 패턴 `agg.yaml`(1GPU) / `agg_router.yaml`(2GPU)부터. disagg는 후순위 | CR apply→워커 Running · `/v1/models` · `/v1/chat/completions` 응답 |
| ⚙ **모델 가중치** | **내부 노드 로컬 → hostPath/localPV 마운트** (D-d) | dev 한정. 폐쇄망 모델 저장소 분리는 후속 | 워커가 노드 경로에서 가중치 로드 성공 |

> **etcd/NATS**: v0.9.0 K8s 설치 기준 `dynamo-platform`에 번들. (이후 버전에서 제거되었다는 3자 보도 있으나 **공식 미확정 — 대상 버전 문서 재확인**)
> **Prometheus/Grafana는 Dynamo 번들 아님**(선택). → §1-4에서 별도 설치.

### 1-3. 가드레일 게이트웨이 (Dynamo 앞단)
| 컴포넌트 | 설치 | dev 적용 | 검증 |
|----------|------|----------|------|
| **Envoy Gateway** | Helm `oci://docker.io/envoyproxy/gateway-helm` | **실클러스터는 기존 v1.7.2 재사용** → ext_proc는 `EnvoyExtensionPolicy`(per-route, **전역 플래그 불필요**)로 부착. (공식 가이드 v1.3.0 + `enableEnvoyPatchPolicy`는 폴백) → §2-E | Gateway 기동, 라우트 통과 |
| **vLLM Semantic Router** | Helm `oci://ghcr.io/vllm-project/charts/semantic-router` (ns `vllm-semantic-router-system`) | ext_proc gRPC **:50051**(HTTP 8080·metrics 9190). 모델은 부팅 시 HF 자동 다운로드→`persistence` PVC 캐시(기본 10Gi). 폐쇄망은 `persistence.existingClaim` 또는 hostPath(`extraVolumes`)로 사전 반입 | PII/Jailbreak 샘플 → `x-vsr-matched-*` 응답헤더 · 차단 시 `x-vsr-fast-response` |
| RBAC (Semantic Router → Dynamo CRD 접근) | `kubectl apply` (ClusterRole `dynamo-extproc-access` → SA `semantic-router`) | dynamographdeployments·pods·services·endpoints·deployments·statefulsets 읽기 | Router가 Dynamo CR 조회 가능 |

> ⚠ **토폴로지 주의(정정 사항 §2-B)**: 공식 Dynamo 통합 가이드는 **순수 Envoy Gateway + Semantic Router(ext_proc)** 경로다. SSOT의 "Envoy **AI** Gateway"는 **별개 제품**(Envoy Gateway v1.8.1+/K8s 1.32+ 요구)이다. **dev 검증은 공식 통합 가이드 경로(순수 Envoy Gateway)를 따른다.**

### 1-4. 관측 (ns: `vllm-prod-stack` 또는 `monitoring`)
| 컴포넌트 | 설치 | 검증 |
|----------|------|------|
| **Prometheus (+Grafana, prometheus-adapter)** | Helm `kube-prometheus-stack` | 스크레이프: **`dynamo_*` / `dynamo_frontend_*` + 패스스루 `vllm:*`** (단일 `/metrics`) |
| **Jaeger + OTel Collector** | Helm | 트레이스 수집·조인, span에 `fabrix.*` 속성 |

> **메트릭 접두사 정정(§2-C)**: 프론트엔드 TTFT는 `dynamo_frontend_time_to_first_token_seconds`. 엔진 네이티브 `vllm:*`도 함께 노출됨 → §3 relabel 타깃을 **둘 다** 잡는다.

### 1-5. 증적 / 스토어
| 컴포넌트 | 설치 | dev 적용 | 검증 |
|----------|------|----------|------|
| **Fluent Bit** | DaemonSet | 증적 JSONL 수집 | OUTPUT 흐름 확인. **WORM 타깃(ObjectScale)은 P2 — dev 미설치(D-e)** |
| **PostgreSQL** (마스터) | Pod + localPV | 앱·키·모델 레지스트리 | 스키마 생성·쓰기·조회 |
| **ClickHouse** (분석 미러) | Pod + localPV | 증적/롤업 조회 미러 | `guard_audit`/`usage_rollup` 적재·조회 |

### 1-6. 폐쇄망 레지스트리
| 컴포넌트 | 설치 | 검증 |
|----------|------|------|
| **Harbor** | Pod + localPV (또는 기존) | containerd 미러 설정 → **인터넷 차단 상태에서 전 워크로드가 Harbor에서만 pull** |

> 반입 대상: GPU Operator 이미지(드라이버 태그에 **OS명** 필요, 예 `…-ubuntu22.04`), Dynamo(nvidia.github.io/NGC), Envoy Gateway(DockerHub), Semantic Router(GHCR) + **분류기 모델 ~1.5GB**, 우리 이미지.

### 1-7. FABRIX 우리 워크로드 (ns: `fabrix-system`)
| 컴포넌트 | 설치 | 검증 |
|----------|------|------|
| **fabrix-api · fabrix-web** | Deployment + Service (+Ingress) | 대시보드가 실제 Prometheus/ClickHouse 읽기 (mock→live) |
| **audit-ingestor** | Deployment | `x-vsr-*` 헤더→증적 스키마 정규화→적재 |
| **rollup-worker** | Deployment/CronJob | 트레이스→`(user×app×key×model×time)` 집계 |
| identity-broker | (후속) | 사내 DB 연동 확정 후 |

---

## 2. 공식 문서 대조로 드러난 **정정 사항** (SSOT 반영 필요)

### 2-A. etcd/NATS는 Dynamo Platform 번들
- `dynamo-platform` 차트에 **etcd + NATS(JetStream) 포함**(v0.9.0). 별도 미결로 두지 않아도 됨. (단 버전 종속 — 재확인)

### 2-B. Envoy "AI" Gateway ≠ 공식 Dynamo 통합 경로 ★중요
- SSOT 아키텍처는 "Envoy **AI** Gateway + Semantic Router"라고 적혀 있으나, **공식 Dynamo 통합 가이드는 순수 Envoy Gateway(v1.3.0) + Semantic Router(ext_proc)** 다.
- 두 제품은 Envoy Gateway 요구 버전이 다름(AI Gateway는 v1.8.1+/K8s 1.32+). **dev는 공식 통합 경로를 채택**하고, "AI Gateway" 도입은 별도 결정.

### 2-C. 가드레일 헤더 이름이 SSOT와 다름 ★중요 (audit-ingestor 영향)
- SSOT(Part 2-3)의 `x-vsr-pii-violation`, `x-vsr-jailbreak-blocked`는 **공식 헤더 레퍼런스에 그 이름 그대로 없음**.
- **실제 헤더(소스 상수 `src/semantic-router/pkg/headers/headers.go` 확인, 2026-06-18, 확신도 높음)**:
  - 결정/선택: `x-vsr-selected-category`, `x-vsr-selected-decision`, `x-vsr-selected-confidence`, `x-vsr-selected-reasoning`(on/off), `x-vsr-selected-model`, `x-vsr-selected-modality`
  - 가드레일 매칭: **`x-vsr-matched-pii`**, **`x-vsr-matched-jailbreak`**, `x-vsr-matched-authz` 등 다수 `x-vsr-matched-*`
  - 캐시/응답: `x-vsr-cache-hit`, `x-vsr-fast-response`(가드레일 차단 시 정책 거부 메시지 반환 경로), `x-vsr-injected-system-prompt`, `x-vsr-schema-version`
  - (참고) PII/Jailbreak "위반·차단"의 단일 boolean 헤더(SSOT의 `x-vsr-pii-violation`/`x-vsr-jailbreak-blocked`)는 **존재하지 않음.** 차단 신호는 `x-vsr-matched-pii`/`x-vsr-matched-jailbreak`(+ `x-vsr-fast-response`)로 표현됨.
- → **audit-ingestor 헤더→증적 매핑(Part 2-3)을 위 실제 헤더 이름으로 수정**할 것. (배포 버전에서 실제 응답 헤더 한 번 더 캡처 권장)

### 2-D. Dynamo 메트릭 접두사
- Dynamo는 `dynamo_*` / `dynamo_frontend_*` 를 노출하고, vLLM 엔진의 `vllm:*` 도 **패스스루**한다(단일 `/metrics`). → §3 스크레이프는 **양쪽 접두사 모두** 대상.

### 2-E. Envoy Gateway v1.7.2 ext_proc 부착 — EnvoyPatchPolicy vs EnvoyExtensionPolicy ★중요 (2026-06-18 확인)
- **공식 Dynamo 통합 가이드 경로**(Envoy Gateway v1.3.0 기준): `EnvoyPatchPolicy`로 raw ext_proc 필터를 JSON 패치 주입한다. 이 방식은 EnvoyGateway 설정에 **`extensionApis.enableEnvoyPatchPolicy: true` 전역 플래그가 필수**다. (출처: SR repo `deploy/kubernetes/dynamo/dynamo-resources/envoy-gateway-values.yaml`, `gwapi-resources.yaml` — `kind: EnvoyPatchPolicy`, authority `semantic-router.vllm-semantic-router-system:50051`. 확신도 높음)
- **우리 환경(기존 Envoy Gateway v1.7.2, 공유 컨트롤러)** 에는 **`EnvoyExtensionPolicy`(네이티브 ext_proc CRD) 경로를 권장**한다.
  - `EnvoyExtensionPolicy`는 **전역 feature 플래그 없이** 동작하고(공유 컨트롤러의 `enableEnvoyPatchPolicy`를 켤 필요 없음), `targetRefs`로 **HTTPRoute 단위(per-route)** 부착이 가능하다 → 공유 GW에 미치는 영향 최소화. (출처: gateway.envoyproxy.io/docs/tasks/extensibility/ext-proc/ — `EnvoyExtensionPolicy`/`spec.extProc.backendRefs`, prerequisites에 별도 플래그 요구 없음. 확신도 높음)
  - 매핑 예: `extProc.backendRefs`를 SR 서비스 **gRPC 50051** 으로, `processingMode`로 request/response 헤더 처리 지정.
  - ⚠ **dev 정정**: §1-3 표의 "v1.3.0 + enableEnvoyPatchPolicy" 표기는 *공식 가이드 기준값*이며, **실클러스터(v1.7.2)에서는 EnvoyExtensionPolicy(per-route, 플래그 불필요)로 진행**한다. EnvoyPatchPolicy는 폴백 옵션.
  - (추측) v1.3→v1.7 사이 ext_proc 스키마 자체의 파괴적 변경은 확인되지 않음(릴리스 노트에 버그픽스 위주). 단 적용 시 `EnvoyExtensionPolicy` apiVersion `gateway.envoyproxy.io/v1alpha1` 으로 실측 확인 필요. 확신도 중간.

---

## 3. dev 검증 최소셋 (요약)

```
[플랫폼]   GPU Operator(+MIG, DCGM 포함) · local-path-provisioner
[서빙]     dynamo-crds + dynamo-platform(etcd/NATS/Operator) + DynamoGraphDeployment(agg)
           └ 모델 가중치: 내부 노드 로컬 마운트 (dev)
[가드레일] Envoy Gateway(v1.3.0) + vLLM Semantic Router(ext_proc, 모델 ~1.5GB 사전반입)
[관측]     kube-prometheus-stack + Jaeger + OTel Collector
[증적/스토어] Fluent Bit · PostgreSQL · ClickHouse  (모두 localPV)
[폐쇄망]   Harbor (전 이미지 미러)
[우리]     fabrix-api · fabrix-web · audit-ingestor · rollup-worker
```

**P2 이후 보류**: ObjectScale(WORM 증적 타깃), 모델 저장소 분리(MinIO 등), disagg/NIXL, identity-broker 사내DB 연동, Envoy AI Gateway 제품 도입.

---

## 4. 재확인 항목 — 클러스터 실측으로 해소 (2026-06-18)

> 실제 클러스터 대조로 대부분 해소됨. 상세는 [k8s-설치현황-기록.md](k8s-설치현황-기록.md).

| 항목 | 상태 | 실측 결과 |
|------|------|-----------|
| Dynamo etcd/NATS 번들 | ✅ 해소 | `dynamo-platform 1.1.0` 에서 **NATS만 구동, etcd 별도 파드 없음**(이 버전 미사용) |
| GPU Operator ↔ K8s 버전 | ✅ 해소 | GPU Operator **v26.3.0** + K8s **v1.35.3** 정상 동작 중 |
| cert-manager 필요 여부 | ✅ 해소 | cert-manager 이미 설치됨 (CRD 존재) |
| Gateway API CRD | ✅ 해소 | `gateway.networking.k8s.io` CRD 존재, Envoy Gateway v1.7.2 구동 |
| Dynamo 메트릭 이름 | ✅ 해소 | `dynamo_frontend_*` 라이브 확인 (`/metrics`) |
| 관측 스택 | ✅ 해소(적응) | Prometheus/Jaeger 대신 **VictoriaMetrics + victoria-traces** 재사용 |

**재확인 — 웹(공식 문서/소스) 대조로 해소 (2026-06-18)**

| 항목 | 상태 | 결과 / 출처 / 확신도 |
|------|------|----------------------|
| Semantic Router를 **기존 Envoy Gateway v1.7.2**에 ext_proc 부착 방식 | ✅ 해소 | **공식 Dynamo 가이드는 `EnvoyPatchPolicy`(raw ext_proc 필터 패치) 사용 → `extensionApis.enableEnvoyPatchPolicy: true` 전역 플래그 필수.** 단 Envoy Gateway 네이티브 ext_proc 경로(`EnvoyExtensionPolicy`)는 **플래그 불필요·HTTPRoute별(per-route) 부착 가능** → **v1.7.2 환경에서는 EnvoyExtensionPolicy 채택을 권장**(아래 §2-E). 출처: github.com/vllm-project/semantic-router `deploy/kubernetes/dynamo/dynamo-resources/{envoy-gateway-values,gwapi-resources}.yaml`, gateway.envoyproxy.io/docs/tasks/extensibility/ext-proc/. 확신도 **높음** |
| ext_proc gRPC 포트 | ✅ 해소 | Semantic Router 차트 `service.grpc.port = **50051**` (HTTP API 8080, metrics 9190). EnvoyPatchPolicy authority=`semantic-router.vllm-semantic-router-system:50051`. 출처: SR 차트 `deploy/helm/semantic-router/values.yaml`, dynamo `gwapi-resources.yaml`. 확신도 **높음** |
| 분류기 모델 다운로드/PVC | ✅ 해소(설계 변경) | **최신 차트는 initContainer 없이 라우터 부팅 시 Go modeldownload로 HuggingFace에서 자동 다운로드**(config.yaml `mom_registry` 기준), `persistence`(기본 `enabled`, `storageClassName: standard`, `accessMode: ReadWriteOnce`, `size: 10Gi`)에 캐시. 부팅 10~20분 소요로 startupProbe 여유 큼. **폐쇄망**은 (a) `persistence.existingClaim`으로 모델을 미리 채운 PVC 주입, 또는 (b) `extraVolumes`/`extraVolumeMounts`로 hostPath 모델 마운트 권장. 출처: SR 차트 `values.yaml`(L118~222). 확신도 **높음** |
| Semantic Router → Dynamo RBAC | ✅ 해소 | ClusterRole `dynamo-extproc-access`: `nvidia.com/dynamographdeployments(+/status)` get/list/watch, core `pods·services·endpoints`, apps `deployments·statefulsets` 읽기. SA `semantic-router`(ns `vllm-semantic-router-system`)에 ClusterRoleBinding. 출처: `deploy/kubernetes/dynamo/dynamo-resources/rbac.yaml`. 확신도 **높음** |
| 가드레일 응답 헤더 정확한 이름 | ✅ 해소 | 소스 상수 파일 확인(아래 §2-C 갱신). 출처: `src/semantic-router/pkg/headers/headers.go`. 확신도 **높음** |
| Dynamo `dynamo_frontend_*` VictoriaMetrics 수집 | ✅ 해소 | VMServiceScrape `dynamo-frontend-openai` 추가로 수집 확인(k8s-설치현황 §4 2026-06-18 로그). 확신도 **높음** |

**아직 남은 것**
- Semantic Router **차트 버전 핀**: 공식 가이드는 `--version v0.0.0-latest`(롤링 태그). 폐쇄망/재현성 위해 **반입 시점의 고정 다이제스트로 핀** 필요(공식 문서에 안정 SemVer 핀 미명시 — 확신도 중간).
- 분류기 모델의 **정확한 총 용량**: 차트 PVC 기본이 10Gi이고 모델 세트(분류기·PII·jailbreak·임베딩 mmbert 등)가 config `mom_registry`에 따라 달라짐. 기존 SSOT의 "~1.5GB"는 단일 모델 가정치일 수 있어 **반입 직전 실측 권장**(확신도 불확실).

---

## 5. 출처 (공식 우선, 2026-06-18 확인)
- **GPU Operator**: docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/ (index, getting-started, gpu-operator-mig, install-gpu-operator-air-gapped, platform-support) · MIG 지원 GPU: docs.nvidia.com/datacenter/tesla/mig-user-guide/supported-gpus.html
- **Dynamo**: docs.nvidia.com/dynamo/ (kubernetes-deployment/deployment-guide, backends/v-llm/observability, kubernetes/observability/metrics) · github.com/ai-dynamo/dynamo (examples/backends/vllm/deploy)
- **Envoy (AI) Gateway**: aigateway.envoyproxy.io/docs/getting-started/ · gateway.envoyproxy.io/docs/install/install-helm/
- **vLLM Semantic Router**: vllm-semantic-router.com/docs/ (installation, installation/k8s/dynamo, v0.1/troubleshooting/vsr-headers) · github.com/vllm-project/semantic-router 소스 직접 확인(2026-06-18): `src/semantic-router/pkg/headers/headers.go`(헤더 상수), `deploy/helm/semantic-router/values.yaml`(grpc 50051·persistence PVC·모델 자동다운로드), `deploy/kubernetes/dynamo/dynamo-resources/{envoy-gateway-values,gwapi-resources,rbac}.yaml`(EnvoyPatchPolicy·RBAC)
- **Envoy Gateway ext_proc(네이티브)**: gateway.envoyproxy.io/docs/tasks/extensibility/ext-proc/ (`EnvoyExtensionPolicy`, per-route, 전역 플래그 불필요) · 릴리스 노트 v1.7

> ※ 본 문서의 일부 항목(버전 분기·폐쇄망 세부·헤더 버전 차)은 공식 문서 미확정으로 표시했다. 도입 전 대상 릴리스 버전과 클러스터에서 재확인할 것.
