# FABRIX Endpoint — 개발/QA 세션 인계 (Living)

> 다시 시작할 때 이 문서를 먼저 읽는다. 최종 2026-06-19 · 버전 **v0.16.0**.

## ★ Round P4-🟠 — 백엔드 데이터 보강 9항목 (2026-06-19, v0.16.0)
> **무엇**: v0.14.0에서 잔여였던 P4 🟠(백엔드 보강 필요) 항목 9개를 전부 실데이터로 구현. **QA 평균 9.3, console error 0.** go build·test·tsc 통과.
> **신규 API**: `GET /gpu/timeseries?uuid=`(per-GPU 시계열) · `GET /proxy/pipeline`(엔진 단계 분해) · `GET /usage/trend`(추세) · `GET /models/metrics`(모델 운영메트릭) · `GET /endpoints/{ns}/{name}/logs`(파드 로그 tail).
> **신규 컴포넌트**: `LatencyPanel`·`RankCard`·`EnginePipelinePanel`·`UsageTrendChart`. 강화: `Gpu`(드릴다운 SlidePanel)·`Keys`(예산 폼·게이지)·`Models`(ops 칩)·`Playground`(응답 칩)·`Endpoints`(로그 모달)·`Guard`(status/latency 컬럼)·`Traffic`(파이프라인 패널).
> **QA 검증(실데이터·CDP)**: 대시보드(TTFT 97/TPOT 51/E2E 1900 3분할·토큰분해·Top5 gemma/key_rb01) · GPU(유휴갭 5/15·드릴다운 /gpu/timeseries 200·MIG 미파티션 정직표시) · 트래픽(파이프라인 483ms=prefill52.8+decode377.8·Tree/Waterfall) · 사용량(forecast 외삽+밴드) · 키(**tpd=10 → 2차 429 하드캡 실증**·예산폼·게이지) · 가드레일(status 403/200·latency) · 엔드포인트(실 파드 로그) · 모델(ctx 실측·미배포 배지).
> **🐞 발견·수정(QA loop)**: 키 화면 **API 500** — `alert_threshold` 컬럼 추가가 **앱 DB 롤의 api_key owner 권한 부재로 ALTER 거부(42501)** → SELECT 깨짐. → api_key DDL 의존 제거, 경고 임계를 `quota.Limiter` 인메모리로 전환(DDL 권한 불필요). 키 화면 복구.
> **함정/주의**: ① idle 상태에선 latency/scheduler/pipeline 이 **0**(rate[5m] 윈도우에 트래픽 없음) — 정상. 플레이그라운드로 트래픽 발생 후 ~1 스크레이프(30s) 지나면 실값. ② tokens_today·alert_threshold 는 **인메모리**(재시작 시 리셋, tpd 하드캡도 인메모리 일일 카운터) — dev 단일 인스턴스용. 영속/분산은 Redis·owner DB 마이그레이션 후속. ③ `dev-up.sh` 는 **반드시 리포 루트에서** 실행(`bash scripts/dev-up.sh`) — backend 하위에서 상대경로로 실행 시 "No such file". ④ 모델 화면 ops 칩은 **Harbor 레포명 ↔ 서빙 model id 가 일치할 때만** 표시(현재 Harbor=test 모델뿐이라 미배포 배지 — 정상/정직).
> **🧭 IA 정리(사용자 피드백)**: 추론 지연 분해·엔진 스케줄러·토큰 분해·Top5 는 처음엔 관제(overview)에 얹었으나 스크롤 유발 → **사용량(Usage) 화면으로 이전**. 관제 = 글랜스(KPI 4카드+분포+시계열+알람, scrollHeight=viewport=1화면). 사용량 = 분석 심화(점유율·forecast·지연 3분할·스케줄러·토큰·Top5·테이블). `Dashboard.tsx` 에서 LatencyPanel/RankCard/토큰 StackedShareBar 제거, `Usage.tsx` 가 `fetchOverview(range)` 로 동일 데이터 재사용. App.tsx `<Usage onNavigate>` 추가.
> **🟠 후속(인프라 미보유 = MAY)**: MIG 슬라이스 per-slice(GPU 미파티션) · 개별 분산 스팬 트리(victoria-traces 미수집) · 응답별 TTFT(스트리밍 미도입) · 길이 heatmap · disagg 병렬 막대 · 경고임계/예산 영속화(owner DB).


## ★ Round Org — 조직·귀속 통합 화면 (2026-06-19, 백엔드 소폭 변경)
> **왜**: 부서·앱·키·사용자가 화면마다 흩어지고 `app`에 dept_id 부재로 "이 앱이 어느 부서?" 추적 불가 + 대시보드(런타임 dept)와 설정(Postgres dept) 불일치.
> **백엔드**: `app` ALTER ADD `dept_id`(비파괴) · `internal/store/org.go`(OrgTree + SetAppDept, nil→[] 보장) · `internal/domain/org.go` · `internal/server/org.go` · 라우트 `GET /api/v1/org`·`PUT /api/v1/apps/{id}/dept`. **go build·tsc 통과. 백엔드 재시작 필요(ALTER+신규 라우트)** — `scripts/dev-up.sh`.
> **프론트**: nav '조직·귀속'(page `org`) · `pages/Organization.tsx`(부서 카드: 사용자 chip + 앱→키 트리 + 앱별 부서 할당 셀렉트) · `api/types.ts`(OrgTree 등) · `api/client.ts`(fetchOrg/setAppDept) · App.tsx·Layout.tsx 라우팅.
> **QA PASS(mutating)**: quota-test → 리서치본부 할당 → Postgres 영속 → 미귀속 4→3 반영.
> **🟠 후속**: 런타임 귀속을 `app.dept_id` 기준으로 정렬(현재 x-user-id 기준 → 트레이딩/unknown 발생). 정렬하면 대시보드↔조직 부서 완전 일치.
> **함정(겪음)**: ① Go 빈 슬라이스→JSON `null`→프론트 `.length` 크래시(백지) → store 에서 `[]` 보장 + 프론트 `?? []` 방어. ② PG 콜드 커넥션: org/keys 첫 호출 `unexpected EOF`/500(재연결 레이스) → 새로고침 1회로 안정화(코드 정상).

## ★ Round P4 — UI/UX 화면 폴리싱 (2026-06-19, 프론트엔드 전용·백엔드 무변경)
> 근거: [상용SW-화면UIUX-리서치.md](상용SW-화면UIUX-리서치.md) · 로드맵 §2 P4. **신규 공통 컴포넌트 7종** + 11개 화면 적용. tsc 통과, 백엔드 미변경.
> **신규 컴포넌트**: `Sparkline` · `Badge`(+statusTone) · `SlidePanel`(+DetailRow) · `StackedShareBar` · `PipelineWaterfall` · `GpuLedGrid` · `EventHistogram`. **강화**: `StatCard`(delta+spark) · `BarList`(Top-N+기타+클릭) · `TimeseriesChart`(avg/cur/max·드래그줌·SLO선).
> **화면 QA PASS(CDP 캡처+상호작용 검증)**: 대시보드(KPI 스파크·변화율·Top-N 슬라이드 드릴다운) · GPU(노드 LED 그리드·임계컬러) · 트래픽(평균요청 워터폴, 플레이그라운드 트래픽으로 실데이터 검증: 가드472ms·엔진352ms) · 사용량(3 KPI·스택 점유바·차원토글 부서 4색) · 키(일 토큰 한도 게이지) · 모델(검증 배지·검색) · 플레이그라운드(실추론 토큰20/6·352ms·17tok/s, View code URL 자동주입) · 엔드포인트(프리셋 r3·G2 자동채움·Badge) · 가드레일(시간대별 히스토그램·정책 3-state off/관찰/차단) · 설정(역할×권한 매트릭스).
> **🟠 백엔드 보강 필요(미구현, 다음 라운드)**: 추론지연 TTFT/TPOT/E2E 3분할·Scheduler State(overview/timeseries 확장) · Top5 엔드포인트/키 랭킹 · MIG 슬라이스 per-slice(GPU_I_PROFILE) · 개별 요청 스팬 트리(victoria-traces) · 증적 http_status/latency 컬럼 · 키 권한 라디오·last-used · 모델 카드 운영메트릭(tok/s) · 평가 데이터셋·영구 회귀배치 · scale-to-zero·엔진별 리소스 자동주입 · 응답별 TTFT(스트리밍).
> **주의(환경)**: 키·사용자 화면은 PG 포트포워드 의존 — idle 후 첫 호출이 503/500(재연결 레이스)날 수 있음. `scripts/dev-up.sh pf` + 재호출 시 안정화(코드 정상). ClickHouse/Harbor는 NodePort라 안 끊김.

> v0.12.0: **모델 화면 = Harbor 레지스트리 실데이터**(하드코딩 제거, Nutanix Models 패턴). Harbor 연동(`internal/harbor`, NodePort 30834, 프로젝트 models). HF→Harbor 임포트 잡(UI 트리거+k8s Job, dev는 CLI push 병행). 배포까지 Harbor 참조(엔드포인트 위저드 `harbor_ref` → initContainer oras pull, dry-run 검증). `.env.dev.local`에 `FABRIX_HARBOR_URL`(admin creds) 추가.
> **모델 push(dev)**: `huggingface-cli download <id>` → `oras push 192.168.160.43:30834/models/<name>:latest <dir>` (Harbor admin: harbor-admin 시크릿). push 후 모델 화면·엔드포인트 위저드(harbor_ref)에서 사용. ⚠ pw에 특수문자 → `oras login -u admin -p "$PW"`(env) 후 push(쉘 이스케이프 회피).
> **Harbor 스토리지(2026-06-19 이전)**: registry 가 emptyDir(35G, 비영구)였음 → **gpu-worker-02:/data(md0 3.4T, 여유 1.4T)** local PV/PVC 로 이전 + 노드 고정. `deploy/k8s/harbor-registry-storage.yaml`(PV/PVC) + `harbor-registry-patch.yaml`. 실 push 검증 완료(아티팩트 → 백엔드 /harbor/models 표시). gemma(59G) 등 대형 모델 수용 가능. ⚠ Harbor helm upgrade 시 패치 revert 가능 → 영구화는 helm values.
>
> v0.11.0 추가: #15 다크모드(☾ 토글·라이트 기본) · #18 모델 임포트(HF/NGC/Upload 위저드) · #21 disagg 패턴(위저드 dry-run) · **#20 WORM**(MinIO Object Lock 배포 + 증적 불변 미러 + 🔒 배지). 가드레일 게이트웨이 매니페스트(deploy/k8s/guardrail-gateway.yaml) 작성+dry-run 검증(적용은 보호 ns 승인 필요).
> 신규 인프라: **MinIO NodePort 30903**(WORM, creds fabrixadmin/fabrix_worm_dev). minio-go 의존성 추가.

## ▶ 다시 시작하는 법 (이동 후 복귀)
1. **백엔드 + 포트포워드 한 번에**: `cd ~/개발/fabrix_endpoint && scripts/dev-up.sh`
   - 자동으로: SR(:18080)·PG(:5432) 포트포워드 + **keeper(20s 자동복구)** + `.env.dev.local` 로드 + `go run ./cmd/api`(:8080). ClickHouse는 **NodePort 30123**(포트포워드 불필요).
   - :8080 점유 프로세스는 스크립트가 알아서 종료(go-build 캐시 바이너리 포함).
2. **프론트**: `cd ~/개발/fabrix_endpoint/web && npm run dev` (→ http://localhost:5173, /api→:8080 프록시)
3. **헬스 체크**: `curl localhost:8080/api/v1/healthz` → `{"data_source":"live","status":"ok"}`
4. 통신: ClickHouse `192.168.160.43:30123`(NodePort, dev-nodeports.yaml), vmselect `:30401`, gemma `:30812`. SR/PG는 keeper port-forward. kubectl 접근 필요.
- **"화면이 텅 빔" 디버그**: 대부분 SR/PG 포트포워드 끊김 → `scripts/dev-up.sh pf`로 복구(keeper가 보통 자동). ClickHouse는 NodePort라 안 끊김.

## 비밀/설정
- `.env.dev.local`(gitignore됨): `FABRIX_DATABASE_URL`(CNPG 시크릿 uri에서 1회 생성). 파일 그대로 두면 재시작 시 자동 로드.
- dev env 전부 `scripts/dev-up.sh`가 주입. ClickHouse creds=fabrix/fabrix_dev(클러스터 매니페스트 값).

## 빌드 상태 (모두 통과)
- `cd backend && go build ./...` ✅ · `go test ./...` ✅(domain·live·guard 한국어PII recall 100%)
- `cd web && npx tsc --noEmit` ✅

## 완료 (이 세션, v0.5.0~v0.10.0 · 26/29)
**P1**: #1 가드레일 enforcement · #2 audit-ingestor · #3 증적 뷰 · #4 rollup-worker · #5 키 쿼터(429) · #6 배포(매니페스트+dry-run, 활성화 외부).
**P2**: #7 엔드포인트 위저드 · #8 GPU/MIG(DCGM) · #9 트래픽/프록시 · #10 한국어 PII(recall 100%) · #11 멀티모델+View code · #12 정책 카탈로그+토글 · #13 RBAC/Users · #14 identity-broker(로컬). #15 다크모드=보류.
**P3**: #16 관제뷰 빌더(lite) · #17 평가(LLM-judge) · #19 알림 드로어. #18 모델 임포트=HF는 #7 커버. #20 WORM·#21 disagg=인프라 대기.
**가시성/UX**: ClickHouse NodePort 30123 · 대시보드 24h+부서/앱 분포 · 전 화면 행클릭→상세(DetailModal) · 알림 드로어.

신규 백엔드 pkg: `internal/{guard,audit,usage,quota,k8s,proxystats}` + store users/migrate. 신규 화면: `pages/{Guard,Endpoints,Gpu,Traffic,Settings,Eval}.tsx` + `components/{DetailModal,GuardPolicy,Notifications}.tsx`.
신규 API: `/guard/{audit,status,classify,policy}`, `/usage?group_by=`, `/keys?range=`, `/endpoints`(CRUD+preview), `/gpu`, `/proxy/stats`, `/users`(CRUD), `/eval/run`.

## QA 결과
- Round 1(가드레일·플레이그라운드·기존화면) 평균 **9.4** 통과. 이후 화면(#7~11)은 빌드별 스크린샷+상호작용 검증 완료(/tmp/qa-shots/).
- **남은 QA**: Round 2 — 신규 6화면(엔드포인트·GPU·트래픽·사용량귀속·키쿼터·멀티모델) 종합 9+ 재확인.

## 후속 — 코드 아님, "적용/외부 승인"만 남음
- [ ] **가드레일 게이트웨이 적용** — `kubectl apply -f deploy/k8s/guardrail-gateway.yaml` (dry-run 4/5 검증됨). **보호 ns(dynamo-inference·SR) + 운영 추론 경로 변경**이라 명시 승인 필요. 적용 후 x-vsr-matched-* 헤더 검증. (현재 프록시 1차 enforcement 가 우리 트래픽 강제 중)
- [ ] **#6 배포 활성화** — git 원격(maymustai)+GHCR 인증+`kubectl apply -f deploy/k8s/fabrix-endpoint.yaml`(외부). 매니페스트+env+dry-run 검증 완료.
- [ ] **#21 disagg 실배포** — 위저드/매니페스트 준비됨. 운영 GPU 재구성이라 작은 모델로 승인 후.
- [ ] **#14 외부 사내DB 동기화** — 현재 로컬(app_user) email→부서. 세션ID→직원 외부 연동은 고객 확인.
- [ ] 후속(P3): 평가 데이터셋·회귀 배치, scale-to-zero, SLO Planner.
- 참고: backend 는 startup 시 PG/SR(port-forward) 연결을 확정(재연결 안 함). dev-up.sh 가 startup 전 ensure_pf+keeper 로 보장하나, 키/사용자 503 이면 재기동. ClickHouse·MinIO 는 NodePort 라 안 끊김.

## 보호 대상 (mutating 시 절대 회피)
- `dynamo-inference`의 운영 엔드포인트(gemma4-31b-vllm-agg) — 엔드포인트 화면에서 managed 라벨 없으면 삭제 버튼 미표시(코드 가드).
- ns `vllm-semantic-router-system`·`observability`·`kserve`·`project001`·`kube-system` — 삭제 거부.
- 공유 Envoy GW(`envoy` 클래스), ClickHouse 스키마 ALTER(운영 승인 후).
- 테스트 리소스는 `purpose=intent-qa-test` 라벨 → 세션 끝 `kubectl delete ... -l purpose=intent-qa-test`.

## 다음 세션 첫 명령
`기능-현황-로드맵.md 이어서 #12부터 진행` 또는 `/intent-qa-loop 이어서`(Round 2).
