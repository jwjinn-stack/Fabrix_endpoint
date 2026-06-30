# IMP-41 스파이크 플랜 — 메트릭 알림 백본을 Prometheus + Alertmanager로 백킹 (사람이 실행)

> **상태: `spike-needed`** — ADOPT(클러스터에 새 서비스 배포) 부분은 코드 PR이 아니라 인프라 채택이다.
> BUILD/MIGRATE 부분(/metrics 계측·PrometheusRule CRUD seam·alerting.go dedup 이관)은 코드로 환원 가능하나,
> **백본이 배포된 뒤에만 의미**가 있으므로 이 스파이크의 P0 결정(고객이 Prometheus를 운영/소유하는가) 이후 진행한다.

## 핵심 결정 (oss-evaluate 2026-06-30)
**ADOPT** kube-prometheus-stack(백본) + karma(silence/dedup UI) · **BUILD** Go BFF PrometheusRule CRUD seam +
React 19 룰 에디터 + /metrics 계측 · **MIGRATE** alerting.go 의 per-pod 인메모리 dedup → Alertmanager-as-receiver.
- in-house 룰 평가 재발명 금지(flapping 억제·`for:` duration·라우팅·silence·HA dedup 을 Alertmanager/Prometheus가 소유).
- **IMP-36(알림 룰 authoring UI)는 PrometheusRule CRD를 read/write 하는 thin editor로 유지** — 제품 surface는 갖되 평가 엔진은 미소유.

## 채택 순서 (P0 → P4)
- **P0 — 소유 경계 결정 (가장 중요)**: 고객 플랫폼팀이 이미 in-cluster Prometheus+Alertmanager를 운영/소유하면 →
  FABRIX는 rule/silence/webhook 레이어로만 통합(integration=medium 유지). 없어서 FABRIX가 번들해야 하면 →
  air-gapped 2-프로파일 배포에 Alertmanager(StatefulSet, gossip-clustered, ≤3 replica)+Prometheus rule evaluator 포함
  → SRE 부담 큼. **이 결정 없이는 코드 시작 금지.**
- **P1 — 백본 미러**: kube-prometheus-stack을 Harbor로 미러(`global.imageRegistry`+`global.imagePullSecrets`, 서브차트 전파 확인됨).
  불필요한 서브차트(grafana/node-exporter/kube-state-metrics) disable로 미러·공격면 축소. CRD는 upgrade 시 수동 관리(Helm 자동 안 함).
- **P2 — 계측 + 룰 (코드)**: Go BFF에 `prometheus/client_golang`(Apache-2.0) 추가, **전용 내부 포트**(public BFF mux 아님 —
  profile/network policy 게이트)에 `/metrics` 노출, inference+guard counters/gauges/histograms emit. 제안 룰(flapping 임계·`for:` duration)을
  **PrometheusRule CRD**로 정의(중요: `for:` semantics는 Prometheus rule engine 소유, Alertmanager 아님). BFF에 controller-runtime
  클라이언트(또는 kubectl-apply seam)로 PrometheusRule CRUD, write=manage / read=observe 게이트.
- **P3 — dedup 이관 (MIGRATE)**: alerting.go의 per-pod `seen map` dedup 은퇴 → **FABRIX를 Alertmanager route의 webhook RECEIVER 타깃으로**
  (Alertmanager가 dedup/grouping/inhibition/silence 후 FABRIX로 JSON POST → 기존 통지 UX·SSRF allow-list·audit ring 보존, dedup 정확성만 상류로).
  라우팅/리시버는 AlertmanagerConfig CRD(YAML/CRD — live mutable API 아님; 라우팅 UI는 config regenerate+reload 필요).
- **P4 — silence/state UI**: **karma**(ghcr.io/prymitive/karma 미러)를 별도 Deployment로, 기존 reverse-proxy/auth 뒤에
  (karma 네이티브 SSO 없음), observe=`readonly:true` / manage=silence ACL → 2-프로파일에 near-exact map. FABRIX UI에서 링크(임베드 불가).
  룰 *authoring* 절반은 어떤 후보도 제공 안 함 → React 19 에디터를 BFF PrometheusRule CRUD 대상으로 BUILD.

## 후보 매트릭스
- **Prometheus Alertmanager = ADOPT** (dedup/silence/routing 백본; rule engine 필수 페어) Apache-2.0 · CNCF Graduated · multi-vendor · v0.33.0(2026-06) · fit 8.5
- **kube-prometheus-stack = ADOPT** (권장 install path) Apache-2.0 · CNCF · chart 87.3.0/Operator v0.92.0 · air-gap 서브차트 전파 FAVORABLY REFUTED · fit 8
- **karma = ADOPT** (silence/dedup UI) Apache-2.0 · single-binary/OCI · air-gap 가능 · fit 7.5 — 룰 author 안 함·임베드 불가·single-maintainer·SSO 없음
- **VictoriaMetrics operator/vmalert = CONSIDER** (저메모리 runner-up; single-vendor 거버넌스 약점, Alertmanager 백본 대체 아님) fit 6.5

## 위협 모델 / Caveats (go/no-go)
1. Alertmanager 단독 불가 — 모든 경로가 rule engine(Prometheus/vmalert)을 요구, `for:` duration도 거기 소유.
2. "Alertmanager 위 룰 UI"는 카테고리 혼동 — 룰은 PrometheusRule CRD에 살고 UI는 2-surface(부분 hand-built).
3. self-operating Alertmanager air-gapped = stateful HA gossip cluster(fail-open, ~3 replica) 실 SRE 부담 — 고객 미소유 시.
4. License watch: 코어는 깨끗한 Apache-2.0이나 VictoriaMetrics 일부 인접 기능(object-storage rule·multitenancy·downsampling·anomaly)은 Enterprise 게이트 → 룰 UI가 이들 미사용 확인.
5. karma single-maintainer + SSO 없음 → 보안이 reverse proxy 구성에 전적 의존(misconfig 시 manage silence-write API 노출 위험).
6. 전 후보 2026-06 릴리스 — 채택 시점 최신 chart/operator/CRD 호환 재검증.

## 사람 승인 체크리스트
- [ ] **P0**: 고객이 in-cluster Prometheus+Alertmanager 운영/소유 여부 확정 (소유=통합만 / 미소유=번들+SRE 부담)
- [ ] Harbor에 kube-prometheus-stack 이미지 미러 + 불필요 서브차트 disable
- [ ] /metrics 전용 내부 포트 + network policy 게이트(public 노출 금지) 합의
- [ ] PrometheusRule CRUD write=manage/read=observe 게이트 + `for:`는 rule engine 소유 인지
- [ ] alerting.go dedup → Alertmanager receiver 이관 시 기존 SSRF/audit 보존 확인
- [ ] karma reverse-proxy/auth(SSO 없음) 구성 + observe readonly/manage silence ACL

## BUILD/MIGRATE (백본 결정 후 코드 PR로 환원 가능)
- /metrics 계측(client_golang, 순수 additive import) · PrometheusRule CRUD seam · React 룰 에디터 · alerting.go→receiver 이관.
- 이들은 IMP-36(in-house 룰 authoring/평가)과 상보적 — 백본 있으면 평가는 Prometheus, 없으면 IMP-36 in-house fallback.

## 출처
- https://prometheus.io/docs/alerting/latest/configuration/ , https://github.com/prometheus-community/helm-charts/blob/main/charts/kube-prometheus-stack/README.md
- https://github.com/prymitive/karma , https://prometheus.io/docs/guides/go-application/ , https://docs.victoriametrics.com/victoriametrics/vmalert/
