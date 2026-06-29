# 셀프-reconfigure (A1) — 화면에서 연동 설정을 고치면 재기동되어 통신이 맞춰진다

> 관리 화면(설정 · 관리 → "연동 설정 · 재구성")에서 연동 대상(URL/네임스페이스)을 고쳐 저장하면,
> FABRIX 가 **자기 ConfigMap 을 patch** 하고 **자기 Deployment 를 rollout restart** 해 새 설정으로 재기동한다.
> 재기동 후 [연동 상태](./README.md) 화면에서 통신이 맞춰졌는지 바로 확인한다. 어댑터 파드 없이 추가 홉 0.

이건 새로 발명한 게 아니라 **정립된 패턴**이다:
- **ConfigMap 변경 → rollout restart** 로 새 설정 반영 — [Stakater Reloader](https://github.com/stakater/Reloader)·GitOps 가 매일 하는 일. FABRIX 는 그걸 **자기 자신에게** 한다.
- 재시작 없이 즉시 반영하는 변형(A2)은 [Spring Cloud Config `@RefreshScope`](https://docs.spring.io/spring-cloud/docs/current/reference/html/#refresh-scope)·Envoy xDS 의 동적 설정과 같은 계열(후속 과제).

구현: [reconfigure.go](../../backend/internal/server/reconfigure.go)(핸들러·린트) · [k8s.go](../../backend/internal/k8s/k8s.go)(PatchConfigMap·RolloutRestart·RolloutStatus) · [ReconfigurePanel.tsx](../../web/src/components/ReconfigurePanel.tsx)(UI).

---

## 1. 흐름

```
[설정 화면] 값 편집 → 저장
   ↓ PUT /api/v1/config  (현재 파드가 처리)
1. 검증(린트): scheme 누락·포트·FQDN 권장·mock:// vs live → 형식 오류면 400(저장 차단)
2. kubectl patch configmap fabrix-config   (변경 키만 병합)
3. kubectl rollout restart deploy/fabrix-endpoint  → 202 "reconfiguring"
   ↓
[화면] GET /api/v1/config/status 폴링 → "재배포 중 (1/2 준비)" → "ready"
   ↓
[연동 상태] 재프로브 → 새 설정으로 통신 확인(초록)
```

- **비동기 202**: 저장을 처리한 파드 자신이 롤아웃으로 교체되므로 동기로 안 기다린다(Kafka Connect 의 `restart` 202 와 동일).
- **편집 대상은 비밀이 아닌 연동 설정만**(ConfigMap 백킹): `FABRIX_DATA_SOURCE`·`VMSELECT_URL`·`GEMMA_UPSTREAM`·`SR_URL`·`LANGFUSE_HOST`·`ENDPOINTS_NS`. 비밀번호·키는 [자격증명 화면](../../backend/internal/k8s/k8s.go) / 외부 Secret 으로 분리(편집 RBAC 최소화).

---

## 2. 안전장치 (왜 파드 형태여도 안전한가)

- **잘못된 설정을 저장해도 서비스가 안 죽는다.** `maxUnavailable: 0` + readinessProbe → 새 파드가 readiness 통과 못 하면 옛(정상) 파드를 안 죽이고 롤아웃이 멈춘다. 옛 파드가 계속 서빙 → 롤백 가능.
- **저장 전 린트**(C3, [reconfigure.go](../../backend/internal/server/reconfigure.go) `lintField`)로 형식 오류를 미리 차단.
- 자격증명은 응답·로그에 노출되지 않음(편집 대상에서 제외).

---

## 3. 활성화 (이게 안 되어 있으면 화면은 "읽기 전용")

세 가지가 모두 필요하다. 없으면 `GET /config` 가 `editable:false` + 사유를 반환하고 화면은 현재값만 보여준다.

### (a) self-identity env (자기 자신을 가리키게)
```yaml
env:
  - name: FABRIX_SELF_NAMESPACE
    valueFrom: { fieldRef: { fieldPath: metadata.namespace } }   # Downward API
  - name: FABRIX_SELF_DEPLOYMENT
    value: "fabrix-endpoint"
  - name: FABRIX_SELF_CONFIGMAP
    value: "fabrix-config"
```

### (b) envFrom 으로 ConfigMap 을 읽기 (patch 가 반영되도록)
```yaml
envFrom:
  - configMapRef: { name: fabrix-config }
  - secretRef:    { name: fabrix-secrets }
```

### (c) RBAC — 자기 ConfigMap patch + 자기 Deployment rollout restart
```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: fabrix-self-reconfigure, namespace: fabrix-endpoint }
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["fabrix-config"]      # 자기 ConfigMap 만
    verbs: ["get", "patch"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    resourceNames: ["fabrix-endpoint"]    # 자기 Deployment 만
    verbs: ["get", "patch"]               # rollout restart = deployment patch
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: fabrix-self-reconfigure, namespace: fabrix-endpoint }
subjects:
  - kind: ServiceAccount
    name: fabrix-endpoint
    namespace: fabrix-endpoint
roleRef: { kind: Role, name: fabrix-self-reconfigure, apiGroup: rbac.authorization.k8s.io }
```

### (d) Deployment 전략 — 무중단·안전 롤아웃
```yaml
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate: { maxUnavailable: 0, maxSurge: 1 }   # 새 파드 health 전엔 옛 파드 유지
  template:
    spec:
      serviceAccountName: fabrix-endpoint
      containers:
        - name: api
          readinessProbe: { httpGet: { path: /api/v1/healthz, port: 8080 } }
```

> `resourceNames` 로 **자기 리소스만** 만질 수 있게 좁혔다(권한 최소화). `kubectl` 바이너리(또는 in-cluster client)와 ServiceAccount 토큰이 파드에 있어야 한다.

---

## 4. mock 동작 (서버 없이 지금 확인)

실백엔드 없이도 프론트 단독([mock.ts](../../web/src/api/mock.ts))에서 전체 루프가 동작한다:
- 설정 저장 → 재배포 진행(시뮬레이션) → 완료 → 연동 상태에 새 endpoint 반영.
- mock 값은 `localStorage`(`fabrix.mock.config`)에 영속 → 리로드해도 유지(실백엔드의 ConfigMap 영속과 대응). 초기화: `localStorage.removeItem('fabrix.mock.config')`.

추후 실서버를 받으면 §3 만 매니페스트에 채우면 같은 화면이 실제 ConfigMap/Deployment 를 조작한다.

---

## 5. 한계

- 설정 1개를 바꿔도 **전체 FABRIX 가 롤아웃**된다(레플리카 2+면 무중단이지만 수 초 소요 = "재시작 blip").
- 비밀(creds) 편집은 의도적으로 제외 — 별도 Secret/자격증명 화면. (필요 시 write-only 필드로 후속.)

---

## 6. 결정 기록 — A1 유지 vs A2(핫리로드) 전환

> **상태: 🟡 보류 — 실서버 1차 배포 후 실측으로 결정.** 현재는 **A1 적용**(재시작 기반).
> A2 는 재시작 blip 까지 없애지만 리팩터 비용이 있어, *실제로 blip 이 문제인지* 측정한 뒤 판단한다.

### A2 로 전환을 검토하는 트리거 (아래 중 하나라도 참이면)
- **설정 변경이 잦다**(주 수회 이상) — 매번 전체 롤아웃이 운영 부담.
- **롤아웃 수 초 blip 이 관제 연속성/SLA 에 문제** — 특히 observe(삼성증권 관제)는 화면이 끊기면 안 됨.
- **단일 레플리카 운영**(무중단 보장 안 됨) — restart 가 곧 짧은 다운타임.
- **진행 중 스트리밍/장기 요청**이 재기동에 끊기면 곤란.

### A1 유지가 맞는 경우 (현재 가정)
- 연동 설정 변경이 **드물다**(초기 구성·가끔 조정) **+ 레플리카 2+**(무중단 롤아웃) → 추가 코드/복잡도 불필요. **이대로 둔다.**

### A2 비용 (전환 시 작업 범위)
- 연동 설정을 **PostgreSQL 설정 테이블**(이미 manage 에 `store` 존재)에 저장.
- [server.New](../../backend/internal/server/server.go) 의 **startup-only 클라이언트 생성**을 "설정 변경 시 rebuild(핫스왑)"로 리팩터 — 동시성 안전(원자적 교체) 필요.
- 영향 클라이언트: guard·audit·usage·harbor·langfuse·k8s·dashboard provider.
- 규모: **중간**. 진단 화면이 이미 live 프로브라 저장 직후 바로 초록 확인은 그대로.

### 실서버에서 측정할 지표 (이 값으로 결정)
| 지표 | A1 유지 | A2 검토 |
|---|---|---|
| 롤아웃 실측 소요 | 수 초, 무중단 | 길거나 체감 끊김 |
| 설정 변경 빈도 | 드묾 | 잦음 |
| 레플리카 수 | 2+ | 1 |
| 관제 연속성 요구 | 보통 | 무중단 필수(observe) |

### 결정 방법/시점
실서버 1차 배포 → 위 지표 측정 → **트리거 충족 시 A2 착수**, 아니면 **A1 유지**. 진행 추적: [상용패턴 추적표](./연동상태-상용패턴-구현추적표.md)(A2 행).
