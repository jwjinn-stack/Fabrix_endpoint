# Kubernetes API — 엔드포인트(DynamoGraphDeployment CR) 오케스트레이션

모델 배포(엔드포인트)를 K8s CR 로 조회/생성/삭제, Pod 로그 조회, 서드파티 자격증명 Secret, 모델 임포트 Job. dev 는 kubectl 셸아웃, 인클러스터는 ServiceAccount + RBAC.

- 코드: [`backend/internal/k8s/k8s.go`](../../backend/internal/k8s/k8s.go)
- capability: `endpoints`(조회/로그), `endpoints.write`(생성/삭제), `credentials`, `models.write`(임포트 Job) · 프로파일: 주로 manage

## 연결
| 항목 | 값 |
|---|---|
| env | `FABRIX_KUBECTL`(기본 `kubectl`), `FABRIX_ENDPOINTS_NS`(기본 `dynamo-inference`) |
| 방식 | kubectl 셸아웃 → K8s API(`:443`) |
| 인증 | kubeconfig(dev) / ServiceAccount 토큰(인클러스터) |
| CR | `dynamographdeployments.nvidia.com` (`nvidia.com/v1alpha1`) |
| 타임아웃 | 명령 15초, 기동 readiness 3초 |
| 활성화 | `kubectl version --client` 성공 시 `enabled=true`(=바이너리 존재; 실제 연결은 프로브로 확인) |

## 실행 명령 (k8s.go)
- 목록: `kubectl get dynamographdeployments.nvidia.com -A -o json` (`k8s.go:85`)
- 모델 readiness: `kubectl get deployments -n vllm -o json`
- 생성: `kubectl apply -f - -o name` (stdin YAML, 기본 `--dry-run=server`, `apply=true` 일 때만 실제) (`k8s.go:354`)
- 삭제(보호): managed 라벨 확인 후 `kubectl delete dynamographdeployments... && delete svc <name>-api` (`k8s.go:496`)
- 로그: `kubectl logs -n <ns> -l <selector> --tail --all-containers --prefix` (`k8s.go:517`)
- 자격증명: `kubectl get/apply secret fabrix-thirdparty -n fabrix-endpoint`(hf_token/ngc_key, base64) (`k8s.go:572`)

### 안전장치(운영 보호)
- **managed 라벨**: `fabrix.managed-by=fabrix-endpoint` 인 CR 만 삭제 가능.
- **보호 네임스페이스 거부**(`k8s.go:490`): `vllm-semantic-router-system`, `observability`, `kserve`, `project001`, `kube-system`.
- 생성은 기본 server-side dry-run → 미리보기 후 apply.

## 미설정/실패 시
kubectl 미존재 → `enabled=false`: 엔드포인트 조회/배포·자격증명·임포트 비활성. 나머지 정상.

## 진단 프로브
`/diagnostics` → `kubernetes`. 프로브 = `kubectl get --raw=/healthz`(API 서버 실제 도달, 5초) (`k8s.go` `Probe()`). `enabled`(바이너리)와 달리 **클러스터 연결**을 검증. `/healthz` nonResourceURL get 권한이 없으면 그 에러가 그대로 노출(RBAC 점검 신호).

## 실사이트 매칭 체크리스트(인클러스터 RBAC)
ServiceAccount 에 다음 권한:
- [ ] `dynamographdeployments.nvidia.com`: get/list/create/delete (대상 네임스페이스).
- [ ] `deployments`(vllm ns): get/list. `pods`: get/list, `pods/log`: get.
- [ ] `services`: get/create/delete. `secrets`(fabrix-endpoint ns): get/create. `jobs`: create(모델 임포트).
- [ ] nonResourceURLs `/healthz`: get (진단 프로브용; 없으면 진단만 실패하고 기능은 별개).
- [ ] `FABRIX_ENDPOINTS_NS` = 고객사 배포 네임스페이스. 보호 네임스페이스 목록(`k8s.go:490`)을 고객사 환경에 맞게 조정.
- [ ] 인클러스터에 kubectl 바이너리 포함된 이미지(또는 client-go 전환은 향후 과제).

## 트러블슈팅
| 증상 | 원인 | 조치 |
|---|---|---|
| diagnostics `connection refused localhost:8080` | kubeconfig/SA 없음 | 인클러스터 SA·토큰 마운트 확인 |
| `forbidden` | RBAC 부족 | 위 권한 부여 |
| 삭제 거부 | managed 라벨/보호 ns | 라벨 확인, 운영 CR 은 보호됨(정상) |
| 엔드포인트 목록 빔 | CR 없음/ns 불일치 | `FABRIX_ENDPOINTS_NS`·CRD 설치 확인 |
