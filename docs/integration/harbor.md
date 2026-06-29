# Harbor — 모델 레지스트리 (v2.0)

모델을 OCI 아티팩트로 보관하는 레지스트리 조회 + HF→Harbor 임포트. Dynamo 가 Harbor 에서 pull 해 서빙(목표 아키텍처).

- 코드: [`backend/internal/harbor/harbor.go`](../../backend/internal/harbor/harbor.go) (임포트 Job 은 [`k8s.go`](../../backend/internal/k8s/k8s.go))
- capability: `models`(조회), `models.write`(임포트) · 프로파일: manage(observe 는 옵션 조회)

## 연결
| 항목 | 값 |
|---|---|
| env | `FABRIX_HARBOR_URL`(creds 포함, 빈값=비활성) |
| 인클러스터 | `harbor-core.harbor` (임포트 Job 내 push 대상) |
| dev | `http://admin:<pw>@192.168.160.43:30834` |
| 프로토콜 | HTTP REST v2.0 |
| 인증 | HTTP Basic (URL 의 user:pw → `SetBasicAuth`, `harbor.go:53`) |
| 타임아웃 | 8초 |

## 호출 API (harbor.go)
- `GET /api/v2.0/repositories?page_size=100` → 모델(레포) 목록 (`harbor.go:103`)
- `GET /api/v2.0/projects/{project}/repositories/{repo}/artifacts?page_size=5&with_tag=true` → 태그/크기
- `GET /api/v2.0/projects?page_size=50` → 프로젝트 목록 → `/harbor/status`
- 임포트(`/harbor/import`): K8s ImportModelJob 생성(initContainer `huggingface_hub` 다운로드 → `oras push --plain-http harbor-core.harbor`). 자격증명은 `fabrix-endpoint/harbor-import` Secret.

## 미설정/실패 시
env 비면 `enabled=false`: 모델 목록/임포트 비활성(모델 화면 빈 상태).

## 진단 프로브
`/diagnostics` → `harbor`. 프로브 = `GET /api/v2.0/projects?page_size=1`(Basic auth 검증, 2초) (`harbor.go` `Probe()`).

## 실사이트 매칭 체크리스트
- [ ] Harbor v2.0 + 프로젝트(예: `llm`,`embeddings`).
- [ ] 조회 계정 Basic auth. 임포트용 `harbor-import` Secret(레지스트리 push 권한).
- [ ] 임포트 Job 이 인클러스터 `harbor-core.harbor` 로 `--plain-http` push — TLS 면 매니페스트 조정 필요(`k8s.go` ImportJob).
- [ ] NetworkPolicy: BFF → Harbor API egress, 임포트 Job → Harbor + HF egress.

## 트러블슈팅
| 증상 | 원인 | 조치 |
|---|---|---|
| diagnostics `harbor 401` | Basic auth 오류 | URL creds 확인 |
| 모델 목록 빔 | 프로젝트/레포 없음 or 권한 | Harbor 콘솔에서 확인 |
| 임포트 Job 실패 | HF 토큰/oras push 권한 | `fabrix-thirdparty`/`harbor-import` Secret 점검 |
