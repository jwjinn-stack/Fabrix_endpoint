# Nutanix Enterprise AI (NAI) — UI/UX 참고 (인퍼런스·대시보드·엔드포인트)

> **목적**: `docs/naiUIReferenceImage/` 의 Nutanix Enterprise AI 화면 5종을 분해해, FABRIX Endpoint의 **대시보드·모델·엔드포인트·키 발급·인퍼런스 검증** UI에 차용할 패턴을 정리한다.
> 작성일 2026-06-18 · 출처: 사내 캡처 이미지(naiUIReferenceImage). ※ 공개 문서 미대조 — 화면 캡처 기반 해석.

---

## 0. 차용할 핵심 7가지 (TL;DR)
1. **대시보드 = 요약 도넛 + 인프라 행 + Top5 테이블** 3블록 구성 (Endpoints / Infra / API Requests).
2. **엔드포인트 상태 도넛**(Active/Failed/Pending) — 우리 4-1 GPU 카드 옆 "엔드포인트 요약"으로 차용.
3. **인프라 요약 행**(K8s Health · CPU · Memory · Disk %) — 우리 GPU/MIG·노드 헬스로 매핑.
4. **모델 추가 = 3-소스 카드**(NVIDIA NGC / HuggingFace / Upload) — 우리는 폐쇄망이라 NGC/Harbor/PVC 소스로 치환.
5. **엔드포인트 생성 폼** = Basic Details + Model Deployment(GPU·instances) + **Endpoint Access(API Key 선택/생성)** — 우리 4-6 + DynamoGraphDeployment 매핑.
6. **엔드포인트 상세** = Access(URL·키·**View Sample API Code**) + API Requests 도넛 + **Latency p50/p95/p99 차트**.
7. **Create API Key 모달**(Key Name→Create→1회 표시) + **RBAC 사용자 관리**(역할: Super Admin/AI·ML Admin/User).

---

## 1. 대시보드 (image.png)
**구성**: 다크 상단바(☰ · ✕ Nutanix Enterprise AI · admin▾) + 라이트 콘텐츠 + 우상단 `Last 15 mins` 기간선택.
- **Endpoints Summary**: 좌 도넛(Total 15) + 우 범례 `● Active 5 / ● Failed 0 / ● Pending 8` + `View All Endpoints`.
- **Infrastructure Summary**: `Kubernetes Cluster Health ● Healthy` / `Memory 23.56%` / `CPU 0.79%` / `Disk 14.39%` + `View Usage Details`.
- **API Requests Summary**: 도넛(Total 129, Successful/Failed/Invalid) + 시간대 **막대 차트**(08:25~08:39).
- **AI Endpoints (Top 5)** 테이블: Endpoints / User / Requests (llama-3-8b-it · admin · 129).
- **API Keys (Top 5)** 테이블: Key Name / Owner / No. of Requests.

> **우리 적용**: 관제 대시보드(4-1)에 **엔드포인트 요약 도넛**(Active/Failed/Pending)과 **AI Endpoints/API Keys Top5** 블록을 추가. Infra 행은 DCGM(GPU)·노드 헬스로. 가격/요금 자리는 **가드레일·부서 귀속** 지표로 치환(증권사 거버넌스).

## 2. 모델 (image copy.png)
**좌측 다크 사이드바**: Dashboard / Models / Endpoints / ⚙ Settings.
- 빈 상태 일러스트 "No Models Available" + 안내.
- **3-소스 임포트 카드**: `From NVIDIA NGC Catalog` / `From Hugging Face Model Hub` / `Import Model(Upload Manually)`.

> **우리 적용**: 모델 카탈로그(이미 구현)에 **모델 추가** 진입점 추가 — 폐쇄망이라 소스는 `NVIDIA NGC(미러)` / `Harbor·내부 레지스트리` / `PVC 업로드`. 빈 상태/온보딩 카드 패턴 차용.

## 3. 엔드포인트 생성 (image copy 2.png)
풀페이지 `Create an Endpoint` 폼:
- **Basic Details**: Endpoint Name(llama3-8b-ep) / Description.
- **Model Deployment**: Model Instance Name / `☑ Use GPUs for running the models` / CPU·Memory / **No of Instances**.
- **Endpoint Access**: `Create a New API Key` 링크 / API Keys 드롭다운(Please select).
- 인라인 **Create API Key 모달**: Key Name(llama3-dev-key) → Cancel/Create.

> **우리 적용**: 4-6 엔드포인트 관리 = **DynamoGraphDeployment CR 생성 폼**으로 매핑(배포패턴 agg/agg_router, replica, MIG). Endpoint Access의 **키 발급 모달**은 지금 구현 중인 키 발급 UI와 정확히 일치 — 이 패턴 채택.

## 4. 엔드포인트 상세 (image copy 3.png)
- **Details**: Endpoint Name / Status(`Active`) / Deployed Model Instance / Use GPUs / No of GPUs.
- **Endpoint Access**: **Endpoint URL**(`https://….nutanix.com/api/v1/chat/completions`) / API Keys(5) 마스킹+요청수 / **View Sample API Code**.
- **Number of Instances**: Configured Maximum / Currently Running. vCPUs·Memory per Instance.
- **API Requests Summary** 도넛(Total 142) + **Latency 차트**(Avg / 50th / 95th / 99th percentile, 24h).

> **우리 적용**: 엔드포인트 상세 = 우리 **사용량(4-2)·관제(4-1) 지표를 모델/엔드포인트 단위로** 묶은 뷰. Latency p50/p95/p99는 이미 vmselect에 있는 `dynamo_frontend_time_to_first_token` 히스토그램으로 바로 구현 가능. **View Sample API Code**(curl/python) = 카탈로그 엔드포인트 스니펫 확장.

## 5. 사용자·RBAC (image copy 4.png)
`Admin Configuration > Users`: Add User / Actions, 테이블(Name/Username/Role/Email/Status/Date Added). 역할 = `Super Admin` / `AI / ML Admin` / `AI / ML User`. 좌 사이드바에 Admin Configuration > Users / Compute.

> **우리 적용**: 설정·관리 화면(후속). 증권사는 **부서·승인자·데이터등급** 메타가 1급(Fireworks/Together엔 없는 차별점). 키·앱을 **부서 귀속 + 역할 기반**으로.

---

## 6. FABRIX 구현 매핑 (우선순위)
| Nutanix 패턴 | FABRIX 화면 | 단계 | 상태 |
|--------------|-------------|------|------|
| 엔드포인트 상태 도넛 + Top5 | 관제 대시보드(4-1) 보강 | MVP+ | 후보 |
| 3-소스 모델 임포트 | 모델 카탈로그 "모델 추가" | P1 | 후보(폐쇄망 소스로 치환) |
| Create API Key 모달 | 키 발급 UI | **진행 중** | 구현 중 |
| 엔드포인트 생성 폼 | 4-6 엔드포인트(=DynamoGraphDeployment CR) | P1/P2 | 후속 |
| 엔드포인트 상세 + Latency p50/95/99 | 엔드포인트 상세 | P2 | 후속(vmselect 데이터 보유) |
| RBAC 사용자 관리 | 설정/관리 | P3 | 후속 |

> ⚠ Nutanix는 **다크 좌측 사이드바**지만, 우리는 Backend.AI 톤(라이트+오렌지)을 유지한다 — 차용 대상은 **정보 구조·플로우**(도넛/Top5/생성폼/키모달/Latency차트)이지 색/크롬이 아니다.
