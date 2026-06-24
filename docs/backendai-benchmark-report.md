# Backend.AI 기능·UI 벤치마킹 & 개발 적용 보고서

> **목적**: Backend.AI(Lablup) WebUI의 "모델 사용·활용" 기능과 화면을 분해해, 우리 엔드포인트 제품(FABRIX endpoint)이 **무엇을 어떻게 만들지** 결정할 수 있는 수준으로 정리한다.
> **출처**: ① 사내 PDF `docs/Backend AI ….pdf`(WebUI 공식 문서 25.15 캡처, 24개 화면) + ② 자체 웹 리서치(Model Service / FastTrack / 25.15 LTS 릴리스).
> **기준 버전**: Backend.AI 25.15 (LTS, 2025-11). 작성일 2026-06-17.
> ※ "확인 필요" 표기 항목은 공식 문서 추가 대조가 필요한 부분.

---

## 0. TL;DR — 우리가 베껴올 5가지

| # | 베껴올 것 | 왜 | 난이도 |
|---|-----------|----|--------|
| 1 | **모델 정의(`model-definition.yml`) ↔ 컨테이너 이미지 분리** | 모델 교체 시 이미지 재빌드 0회. 서빙 제품의 핵심 토대 | 中 |
| 2 | **5단계 세션/서빙 생성 위저드** (Type→Env&Resource→Data&Storage→Network→Confirm) | 진입 마찰 최소화. 초보·숙련 모두 수용 | 中 |
| 3 | **추론 세션 오토스케일 + 무중단 복구** (stateless 세션 + 요청 포워딩) | "운영 가능한" 서빙의 기준선 | 高 |
| 4 | **대시보드/요약의 정보 밀도** (할당 vs 한도 vs 사용량을 카드로 한 화면) | 리소스 거버넌스 UX의 정답지 | 低 |
| 5 | **LLM Playground(채팅) 내장** (배포한 모델을 즉시 채팅으로 검증) | 배포→검증 루프를 한 화면에서 닫음 | 中 |

---

## 1. 제품 구조 한눈에

Backend.AI는 단일 앱이 아니라 **GPU 오케스트레이션 OS** 위에 모듈이 얹힌 구조다. "모델 활용" 관점의 벤치마킹 핵심은 셋.

```
┌─────────────────────────────────────────────────────────┐
│  Backend.AI WebUI  (웹 + 데스크톱 앱: Win/Linux/macOS)     │
│   - 세션 / 리소스 / 데이터 / 모델 / 통계 / 관리자 콘솔      │
├──────────────────────┬──────────────────────────────────┤
│  Model Service        │  FastTrack 3 (MLOps 파이프라인)    │
│  (추론 API 배포·스케일)│  (DAG: 전처리→학습→검증→배포)      │
├──────────────────────┴──────────────────────────────────┤
│  Core: Manager ── Agent(노드) 구조 / Fractional GPU 가상화 │
│         vfolder(가상 폴더) 스토리지 / 컨테이너 세션         │
└─────────────────────────────────────────────────────────┘
```

**핵심 개념 (우리 데이터 모델에 그대로 매핑 가능)**

- **Domain → Project → User**: 3계층 테넌시. 프로젝트별로 자원 정책이 다름.
- **Session**: 자원이 할당된 독립 컨테이너 실행 단위. 4종 — `Interactive`(주피터/IDE), `Batch`(스크립트 실행), `Inference`(서빙), `System`(플랫폼 자동 관리).
- **Image**: 실행 환경(레지스트리/아키텍처/버전/태그/digest). 세션은 이미지에서 뜬다.
- **vfolder(가상 폴더)**: 세션과 수명 분리된 영속 스토리지. 종류 = `General`/`Models`/`Pipeline`/`Auto-Mount`.
- **Model Storage**: `Models` 타입 vfolder + `model-definition.yml` + 모델 파일. 서빙의 단위.
- **Resource Policy**: keypair/user/project별 동시성·클러스터 크기·idle timeout·세션 수·MTP 세션 한도.

---

## 2. 화면(메뉴) 전수 인벤토리 — 개발 관점

PDF에 캡처된 24개 화면을 **기능 / UI 구성 / UX 포인트 / 우리 개발 적용**으로 분해한다. ★ = 우리 제품에 우선순위 높음.

### 2-1. 개요·설치·인증 (기반)

| 화면 | 핵심 | 우리 적용 |
|------|------|-----------|
| 개요(Overview) | 클라우드/온프렘 자원 관리 OS. Fractional GPU 분할로 1 GPU 다중 사용자 공유 | 멀티테넌시 + GPU 공유는 우리도 필수 전제로 명시 |
| 설치(Installation) | **웹 서비스형**(브라우저만) + **단독 데스크톱 앱**(Win/Linux/macOS) 이중 배포. 권장 Chrome 80+, 최소 2코어/4GiB | 웹 우선, 데스크톱 앱은 후순위. SSH/SFTP 편의 때문에 데스크톱이 의미 있음(2-20 참고) |
| 가입·로그인 | Email/Username + Password + **Endpoint** 입력. `CLICK TO USE IAM`(SالسO/IAM 전환). 초대 토큰 기반 Signup(베타), 이메일 인증 | **Endpoint 입력 필드**가 포인트: 동일 WebUI가 여러 클러스터를 가리킴. 우리도 멀티 클러스터 지향 시 채택 |

### 2-2. 상단 바(Header) — 전역 UX 뼈대 ★

- **프로젝트 선택기**(좌상단): 현재 프로젝트 전환 → 자원 정책이 통째로 바뀜. (멀티테넌시 UX의 핵심 컨트롤)
- **알림(Notifications)** 패널: `All / In progress` 탭. 장기 작업(이미지 풀, 세션 준비) 진행률을 우측 드로어로.
- **테마 모드**: 라이트/다크 토글.
- **사용자 메뉴**: About / My Account / Preferences / Logs·Errors / Download Desktop App / Log Out.

> **개발 적용**: 전역 레이아웃을 `[프로젝트 선택기] · [검색] · [알림 드로어] · [테마] · [유저 메뉴]`로 고정. 알림 드로어는 비동기 작업(서빙 배포 등) 진행률 표면화 채널로 처음부터 설계.

### 2-3. 시작 페이지(Start) ★

- 자주 쓰는 기능 **바로가기 카드** 4종: `Create Storage Folder` · `Start Interactive Session` · `Start Batch Session` · `Start Model Service`.
- 카드 좌상단 버튼으로 위치(순서) 조정 가능.
- 환경에 따라 모델 서비스 카드가 **비활성화**될 수 있음(관리자 설정 의존).

> **개발 적용**: 첫 화면 = "할 일 카드". 우리는 `모델 배포` · `엔드포인트 테스트(채팅)` · `데이터 업로드` · `세션 시작`을 핵심 카드로. 기능 플래그로 카드 on/off.

### 2-4. 대시보드(Dashboard) ★★

- 전 프로젝트/리소스 그룹의 **자원 사용량·한도·실행 세션**을 한 화면에.
- 카드 구성: `My Sessions`(Interactive/Batch/Inference/Upload 카운트) · `My Total Resources Limit`(CPU/RAM, Used 표시) · `My Resources in <RG>`(Used/Free) · `Total Resources in default`(Used/Free) · `Recently Created Sessions`(테이블: 상태/가속기/CPU/메모리/경과시간/환경/리소스그룹/타입/클러스터모드/생성시각/에이전트).
- 각 패널 **새로고침 아이콘**으로 개별 갱신.

> **개발 적용**: 정보 밀도가 정답지. "**내 할당 / 내 한도 / 그룹 전체**"를 3단으로 보여주는 카드 패턴 그대로 채택. 최근 세션 테이블 컬럼 셋도 거의 그대로 재사용 가능.

### 2-5. 요약 페이지(Summary)

- `Resource Statistics`(리소스 그룹 선택 + CPU/RAM/Sessions 사용률 바, 현재 그룹 vs 유저 한도 2색 표기) · `System Resources`(Active Sessions 수) · `Invitation`(폴더 초대) · **`Download Desktop App`**(OS 선택 + ARM64/X64).
- 대시보드와 역할이 겹침 → 25.x에서 대시보드로 통합 흐름. **확인 필요**(요약/대시보드 통폐합 상태).

### 2-6. 데이터 페이지(Data / vFolder) ★

- 세션 종료 시 컨테이너 내부 데이터는 삭제 → **중요 데이터는 vfolder에 보관**이라는 대원칙.
- 상단 카드: `Storage Status`(My/Project/Invited Folders 수) · `Quota per storage volume`(볼륨별 쿼터 %).
- 폴더 테이블: `General / Auto Mount / Models` 탭, 컬럼 = Name / Controls(공유·삭제) / Status / Location(NFS 호스트) / Type(User·Project) / Mount Permission(RW·RO) / Owner. `Active / Trash`(휴지통).
- **폴더 탐색기(File browser)** + **Run SFTP server**: 폴더 단위 파일 업/다운, SFTP 직결.

> **개발 적용**: 모델/데이터/파이프라인을 **폴더 타입으로 구분**하는 설계가 핵심. 우리 모델 레지스트리도 "Models 타입 폴더 = 배포 단위"로 통일하면 서빙과 자연 연결.

### 2-7. 세션 페이지(Sessions) ★★ — 가장 많이 쓰는 화면

- 상단 `Total Resources in <RG>`(CPU/RAM/GPU 현황) + `Start Session` 버튼.
- 세션 테이블: `All / Interactive / Batch / Inference / Upload` 탭, `Running / Finished` 필터, 컬럼 = Session Name / Status / AI Accelerator / CPU / Memory / Elapsed Time / Agent / Owner Email. 페이지네이션.
- **세션 생성 5단계 위저드(NEO)**:
  1. **Session Type** — Interactive / Batch / Inference 선택(+세션 이름, 선택). `Recent History`로 과거 설정 재사용. `Skip to review` 단축.
  2. **Environments & Resource allocation** — 이미지 선택 + CPU/RAM/GPU(Fractional 포함) 슬라이더.
  3. **Data & Storage** — 마운트할 vfolder 다중 선택(`Path & Alias` 지정).
  4. **Network** — 포트/엔드포인트 설정.
  5. **Confirm and Launch** — 최종 확인 후 실행.
- 24.09부터 NEO 런처가 **기본값**(빠른 로드·간소화 레이아웃).

> **개발 적용**: 이 위저드가 제품의 심장. 우리는 **배포 위저드**로 변형 — `모델 선택 → 런타임/자원 → 스토리지 마운트 → 엔드포인트/네트워크/오토스케일 → 확인`. `Recent History`(직전 설정 재사용)와 `Skip to review`(숙련자 단축)는 반드시 포함.

### 2-8. 세션 부가 기능

| 화면 | 핵심 | 우리 적용 |
|------|------|-----------|
| 폴더 마운트(2-12) | Data&Storage 단계에서 다중 vfolder 마운트, `Path & Alias` 지정(예 `/home/work/user1-ml-test`) | 배포 시 모델·데이터 폴더 동시 마운트 UX |
| 폴더 공유·접근제어(2-13) | 개인/프로젝트 폴더를 타 유저에 공유, RW/RO 권한. File browser + Run SFTP server | 협업 모델 공유 + 권한 모델 |
| SSH/SFTP 접속(2-20) ★ | 세션 컨테이너에 SSH/SFTP. App 런처: `Console / SSH-SFTP / VSCode / VSCode(Desktop) / JupyterLab / Jupyter Notebook`. 자동 생성 SSH key(`id_container`), 접속 정보 다이얼로그(host/port/예시 명령) | 개발형 세션 제공 시 App 런처 패턴 채택 |
| Import & Run(2-16) | Jupyter notebook URL 또는 GitHub/GitLab repo를 URL로 즉석 임포트·실행. 세션 런처와 동일 다이얼로그(노트북 자동 실행) | "URL만 붙이면 실행" 진입로 — 데모/온보딩에 강력 |
| 나의 실행 환경(2-17) | 세션을 커밋해 만든 **사용자 정의 이미지** 목록(레지스트리/아키텍처/네임스페이스/언어/버전/기반/제약/digest). 이미지 복사로 새 세션 생성 | 커스텀 런타임 관리. "세션 커밋 → 이미지화" 흐름 검토 |

### 2-9. 모델 서빙(Model Serving) ★★★ — 우리 제품 직결, 가장 중요

> **엔터프라이즈 전용 기능. 23.09부터 정식 지원.**

**개념·아키텍처 (PDF 다이어그램 + 리서치 종합)**

```
                          Inference Service Cluster
        ┌──────────────┐   ┌──> Inference Session ─┐
 User ──┤ Service Proxy │──┼──> Inference Session ──┼──> (model storage)
        └──────────────┘   ├──> Inference Session ──┤      ↑ update model
        Model loader ──> AutoScaling ──> ...─────────┘
```

- 학습 끝난 모델을 **추론 API 서비스**로 배포. 최종 사용자(모바일/웹 백엔드)가 추론 API 호출.
- 기존 학습용 세션을 확장: **자동 유지·보수 + 스케일링**, **영구 포트·엔드포인트 매핑**. 개발자/관리자는 세션을 수동 생성·삭제할 필요 없이 **스케일링 파라미터만 지정**.
- **오토스케일**: 세션당 GPU 사용량 / API 호출 수 / 시간대 기준으로 추론 세션 자동 증감.
- **무중단 복구**: 추론 세션은 stateless·volatile. 죽으면 새 세션을 띄우는 **동시에 살아있는 세션으로 요청 포워딩** → 다운타임 최소화.
- **모델 정의 분리**: `model-definition.yml`(시작·초기화·스케일 설정)을 **컨테이너 이미지와 분리**해 Models 타입 vfolder에 저장 → 모델 바뀌어도 이미지 재빌드 불필요.

**배포 워크플로우 (24.03 기준, 5단계)**
1. `model-definition.yml` 작성 (파일명 비우면 `model-definition.yml/.yaml` 자동 인식)
2. **Models 타입 vfolder 생성** → 폴더 탐색기로 정의 파일 업로드
   - `Create a new storage folder` 다이얼로그: `Usage Mode = Models` / Folder name / Location / Type(User·Project) / Permission(RW·RO) / Cloneable 토글
3. 모델 서빙 생성 / 검증
4. (비공개 서비스면) **토큰 획득**
5. 엔드포인트 접근으로 서빙 검증

> **개발 적용 (핵심)**: 우리 엔드포인트 제품의 데이터 모델/플로우를 이 구조에 맞춘다.
> - **배포 단위 = `(Models 폴더 + model-definition + 런타임 이미지)`** 3요소 분리.
> - **엔드포인트 = 영구 주소 + 토큰 인증**, 뒤에 N개 추론 세션(replica).
> - **오토스케일 정책**(min/max replica, GPU%·QPS·시간대 트리거)을 1급 객체로.
> - **무중단 배포/복구**(롤링, 헬스체크, 요청 포워딩)를 MVP 이후 우선 백로그.
> - `model-definition.yml` 스키마를 우리 포맷으로 정의(모델 경로/실행 커맨드/포트/헬스체크/스케일 힌트).

### 2-10. 채팅 / LLM Playground ★★

- 25.05부터 **별도 "채팅" 페이지** 제공. 여러 LLM 모델을 **직접 선택·체험**.
- UI: 모델 탭(예 `Llama`, `Llama-65`) 멀티 선택, 입력창, 우하단 **TPS·토큰 수** 표시.
- Backend.AI가 제공하는 서비스 + 사용자가 배포한 모델 모두 체험.

> **개발 적용**: 배포한 엔드포인트를 **즉시 채팅으로 검증**하는 화면을 제품에 내장. 모델 동시 비교(멀티 탭), TPS/토큰/지연 메트릭 표면화 → 배포→검증 루프를 한 화면에서 닫는다. 우리 차별화 포인트로 키울 수 있음.

### 2-11. 통계·모니터링 (운영)

| 화면 | 핵심 | 우리 적용 |
|------|------|-----------|
| 자원 요약(Agent Summary, 2-18) | 22.09+. 에이전트 노드별 엔드포인트/CPU 아키텍처/자원 할당량/**Schedulable** 상태. 세션 생성 시 자원 배치 판단용 | 노드 헬스/스케줄 가능 여부 가시화 |
| Statistics(2-19) | `Allocation History` + `User Session History`. 그래프 항목 = Sessions/CPU/Memory/GPU/IO-Read/IO-Write, **기간 선택**(1 Day·주간). 종료 세션 기준 집계 | 사용량/과금 근거 데이터. GPU는 Fractional 시 물리 GPU와 불일치 주의 |

### 2-12. 클러스터 세션(Cluster Session)

- 20.09+. 분산 학습/연산용. 여러 컨테이너가 여러 Agent 노드에 걸쳐 생성, **사설 네트워크로 자동 연결**(임시 도메인 `main1/sub1/sub2`…). 컨테이너 간 SSH용 키·설정 자동.
- 구조: `Manager`(세션 X/Y/Z) ── `Agent`(Overlay Network + Local Bridge Network, main/sub kernel).

> **개발 적용**: 멀티 GPU/멀티 노드 학습·서빙 확장 시 참고. MVP 범위 밖이면 후순위.

### 2-13. 사용자 설정 / 관리자

| 화면 | 핵심 |
|------|------|
| 사용자 설정(2-21) | 유저 메뉴 → Preferences. `General / Logs` 탭, `Display Only Changes`, 데스크톱 알림 토글 |
| 관리자(Administration, 2-23) | super-admin 전용 좌하단 메뉴. **Users / Credentials**(역할·생성·삭제, 비번 8자+, ID 최대 64자) · **Resource Policy**(Keypair/User/Project 탭, 컬럼 = Resource Policy/Concurrency/Cluster Size/idle Timeout/Max Session Lifetime/Storage Nodes/Max Pending Session Count/Max Concurrent **MTP** Sessions, `∞`=무제한, 기본 정책 `gardener·student·default`) · **Images**(이미지 목록, `installed` 태그, Controls로 최소 자원 요구량 변경) · **Resource Presets / Registries** · 노드 상세(CPU/RAM/Network/GPU Memory/GPU Utilization) · `Configurations`(이미지 auto install/update 규칙 `Digest·Tag·None`, Overlay Network 등) |

> **개발 적용**: 관리자 콘솔의 **Resource Policy 컬럼 셋**이 SaaS 거버넌스의 사실상 표준. 우리도 동시성/세션 수명/idle timeout/스토리지 한도를 정책 객체로. 이미지 자동 설치 규칙은 `Digest`(checksum 검증) 권장, `Tag`는 무결성 미보장이라 개발용만.

### 2-14. FAQ / 문제 해결

- 세션 목록 미표시 → 브라우저 새로고침(Ctrl-R / Shift-Ctrl-R 캐시 무시). 로그인 불가 → 시크릿 모드 / 쿠키·앱 데이터 삭제.

> **개발 적용**: SPA 캐시·세션 동기화 이슈는 우리도 겪을 것. **자동 폴링/웹소켓 기반 실시간 갱신**으로 애초에 "새로고침 안내"가 필요 없게 설계.

---

## 3. 핵심 사용자 워크플로우 (모델 등록 → 배포 → 호출)

Backend.AI 기준 엔드투엔드 흐름. 우리 제품 플로우 설계의 기준선.

```
[1] 데이터 페이지 → Models 타입 vfolder 생성
        └ Usage Mode=Models, Permission=RW, (Cloneable)
[2] 폴더 탐색기 → model-definition.yml + 모델 파일 업로드
[3] 모델 서빙 생성 (위저드: 모델 폴더 선택 → 런타임 이미지 → 자원 → 오토스케일 파라미터)
[4] (비공개) 토큰 발급
[5] 영구 엔드포인트로 추론 API 호출  ←→  채팅 페이지에서 즉시 검증(TPS/토큰)
[6] Statistics에서 사용량/세션 이력 모니터링, 오토스케일 자동 증감
```

**우리 제품(FABRIX endpoint) 목표 플로우 (제안)**

```
모델 업로드/연결(HF·로컬·레지스트리)
   → 배포 위저드(런타임·자원·스토리지·엔드포인트/오토스케일·확인)
   → 엔드포인트 생성(영구 URL + 토큰)
   → 내장 채팅 Playground로 즉시 검증
   → 대시보드/통계로 운영(사용량·헬스·스케일)
```

---

## 4. 벤치마킹 → 개발 로드맵

### 4-1. 화면 우선순위(MVP→확장)

| 단계 | 화면/기능 | 근거(벤치마킹) |
|------|-----------|----------------|
| **MVP** | 로그인(+Endpoint) / 대시보드 / **배포 위저드** / **엔드포인트 목록·상세** / **채팅 Playground** / 데이터(Models 폴더) | 2-4, 2-7, 2-9, 2-10, 2-6 |
| **P1** | 오토스케일 정책 UI / 토큰 관리 / 통계(사용량·세션 이력) / 알림 드로어 | 2-9, 2-11, 2-2 |
| **P2** | 관리자(Users/Resource Policy/Images) / SSH·App 런처 / Import&Run | 2-13, 2-20, 2-16 |
| **P3** | 클러스터(분산) / 사용자 정의 이미지 커밋 / 데스크톱 앱 | 2-12, 2-17, 2-1 |

### 4-2. 데이터 모델 제안(베껴오기)

```
Tenant(Domain) ─< Project ─< Membership >─ User
Project ─< ResourcePolicy (concurrency, cluster_size, idle_timeout,
                           max_session_lifetime, storage_quota, max_pending)
Project ─< VFolder (type: general|models|pipeline|automount, permission: rw|ro, cloneable)
VFolder(models) ─ ModelDefinition(yml) ─ ModelFiles
Endpoint (= permanent_url + auth_token)
   ├─ RuntimeImage (registry/arch/version/digest)
   ├─ ScalePolicy (min/max replica, triggers: gpu%/qps/schedule)
   └─< InferenceSession (replica, stateless, health)
UsageRecord (sessions/cpu/mem/gpu/io_read/io_write, by terminated session)
```

### 4-3. UI 패턴 체크리스트(그대로 채택)

- [ ] 전역 헤더: 프로젝트 선택기 · 검색 · 알림 드로어(진행률) · 테마 토글 · 유저 메뉴
- [ ] 시작 페이지: "할 일 카드"(배포·테스트·업로드·세션), 기능 플래그 on/off
- [ ] 대시보드 카드: **내 할당 / 내 한도 / 그룹 전체 / 최근 세션 테이블**
- [ ] 생성 위저드: 5단계 + `Recent History`(설정 재사용) + `Skip to review`(숙련자 단축)
- [ ] 리스트: 탭(타입별) + 상태 필터 + 표준 컬럼셋 + 패널별 새로고침
- [ ] 폴더 타입 구분(models/general/pipeline) + File browser + SFTP
- [ ] 실시간 갱신(폴링/WS)으로 "새로고침 안내" 제거

### 4-4. 차별화 기회 (Backend.AI 약점 = 우리 기회)

1. **배포→검증 루프 단축**: 채팅 Playground를 배포 화면과 한 흐름으로 묶기(BackendAI는 채팅이 별도 페이지).
2. **모델 카탈로그/스토어 UX 보강**: HF 직접 임포트형 카탈로그가 BackendAI에서 약함(**확인 필요**). 우리는 "검색→원클릭 배포" 카탈로그로 차별화.
3. **온보딩 마찰**: BackendAI는 엔터프라이즈·관리자 의존(모델 서비스 기능이 환경따라 비활성). 우리는 기본 활성 + 가이드 위저드로.
4. **광고/잡요소 없는 깔끔한 콘솔**: (참고용 문서엔 외부 광고 배너 노출) 제품 신뢰도 측면 우위.

---

## 5. 한계·확인 필요 목록

- 모델 **스토어/카탈로그**(HF 직접 임포트 UI)의 현재 동작 — 공식 문서 추가 대조 **필요**.
- 요약 페이지와 대시보드의 **통폐합 상태**(25.x) — **확인 필요**.
- Model Service의 **트래픽 라우팅/카나리/A-B 배포** 지원 여부 — **공식 문서 미확인**.
- 과금/billing 연동 모델 — 본 문서 범위 밖.

---

### 출처
- 사내 PDF: `docs/Backend AI 382888f36d5180c09de5db82a441d913.pdf` (WebUI 25.15 화면 캡처 24종)
- [Model Serving — WebUI User Guide 25.15](https://webui.docs.backend.ai/en/latest/model_serving/model_serving.html)
- [Sneak Peek: Backend.AI Model Service](https://www.backend.ai/blog/2023-05-30-backend.AI-model-service-sneak-peek)
- [WebUI — AI Workload Management Interface](https://www.backend.ai/platform/webui) · [backend.ai-webui (GitHub)](https://github.com/lablup/backend.ai-webui)
- [Compute Sessions — WebUI 25.15](https://webui.docs.backend.ai/en/latest/sessions_all/sessions_all.html) · [Summary Page](https://webui.docs.backend.ai/en/latest/summary/summary.html)
- [Introducing FastTrack](https://www.backend.ai/blog/2022-11-backend.ai-fasttrack) · [FastTrack 3](https://www.backend.ai/product/fasttrack3)
- [Release: Backend.AI 25.15 (LTS)](https://www.backend.ai/blog/2025-11-Backend.AI-25.15-Update)
