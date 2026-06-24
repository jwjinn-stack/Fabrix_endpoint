# FABRIX Endpoint — 상용 SW 화면 UI/UX 리서치 (화면 단위)

> **목적**: 우리가 개발한 11개 화면의 UI/UX를 개선하기 위해, **상업적으로 판매하는(또는 표준이 된 OSS) 소프트웨어가 같은 종류의 화면을 "어떤 레이아웃·컴포넌트·인터랙션으로" 제공하는지**를 화면 단위로 정리한다. "어떤 소프트웨어가 어떤 화면을 어떻게 보여주는가" + "FABRIX가 가져올 점"이 핵심.
> **기존 문서와의 차이**: [경쟁솔루션-벤치마킹.md](경쟁솔루션-벤치마킹.md)는 *기능/역량 갭*(따라잡을 것/능가할 것) 중심. **이 문서는 *화면 디자인(레이아웃·컴포넌트·동선)* 중심** — 중복 금지, 서로 참조.
> **연결**: [개발 우선순위](goal/개발-우선순위.md) · [경쟁솔루션-벤치마킹.md](경쟁솔루션-벤치마킹.md) · [nutanix-nai-benchmark.md](nutanix-nai-benchmark.md) · [backendai-benchmark-report.md](backendai-benchmark-report.md) · UI 톤: 라이트 + 오렌지 액센트(Backend.AI 스타일, 다크/네온 금지)
> **버전**: `v1.0.0` · 작성 2026-06-19 (Asia/Seoul) · 방식: WebSearch + 공식 docs/대시보드 JSON WebFetch 실제 리서치
> **확신도 범례**: 높음(공식 docs/제품페이지/대시보드 JSON 직접 확인) · 중간(2차 자료·일관된 다수 출처) · 불확실(추측 — "추측" 명시)
> ⚠ 한계: 대상 제품 다수가 로그인 기반 SPA라 픽셀 단위 배치·정확한 색상값·차트 타입 일부는 미확정(해당 항목 "추측" 표기). **외부 제안서/공시에 특정 제품 거동·수치를 인용할 경우 공식 원본 대조 필수.**

---

## 0. TL;DR — 화면 전반에 깔 디자인 표준 7

리서치한 거의 모든 제품에서 **공통으로 검증된** 패턴. 우리 11개 화면 전반에 일관 적용한다.

1. **KPI 카드 = "현재값 + 임계 색상 + 전기간 대비 변화율 화살표 + 미니 스파크라인"** 한 셀. (Datadog Query Value, New Relic billboard, Nutanix 공통) — 라이트+오렌지에서 *위험·주의만* 강조색, 정상은 무채색.
2. **3단 골격: 필터바(시간범위·차원 셀렉터) → 차트/시계열 → 그룹 테이블.** (사용량·관제·증적 모두 동일) + **시간범위가 전 위젯 동기화**.
3. **마스터-디테일 동선: 목록 행 클릭 → 우측 슬라이드 상세 패널**(페이지 이동 없음). (Datadog·Splunk·Langfuse·Lakera 공통)
4. **드래그-투-줌(시계열에서 구간 드래그) → 하단 테이블 자동 필터.** (New Relic, Splunk 타임라인 히스토그램)
5. **Top-N + "Other" 통합**: 상위 N개만 노출, 5% 미만은 "기타"로 묶음. (OpenAI Usage, AWS Cost Explorer)
6. **상태/심각도 배지 + 임계 3단 컬러**: 정상/주의/위험(GPU 온도·전력·사용률, 가드레일 L1~L4 등) — 일관된 팔레트.
7. **모든 변경 액션(정책 토글·권한 부여·키 발급·알림 처리)을 감사 이벤트로 캡처** → 폐쇄망 증권사 컴플라이언스의 관통 차별점.

> **FABRIX 고유 차별 축(경쟁사에 거의 없음)** — 화면 전반에 녹일 것:
> - **추론 성능의 가시화**: TTFT / Inter-Token(TPOT) / tok-per-sec를 카탈로그 카드·플레이그라운드 응답·관제 KPI에 *1급 시민*으로. (vLLM/Dynamo 강점)
> - **Dynamo disagg vs agg 라우팅 비교**를 플레이그라운드 멀티컬럼·트레이스 스팬에.
> - **할당 vs 실사용 갭(idle allocation)** + **사용량 대비 한도(quota) 게이지** = 거버넌스 정체성.
> - **OTel 수집 → 자체 React 화면**(외부 SaaS 불필요) = 폐쇄망 적합.

---

## 화면별 리서치

> 형식: **우리 화면** → *상용 제품은 이렇게(제품 · 화면 · 레이아웃/컴포넌트/인터랙션)* → **FABRIX가 가져올 점**

---

### 1. 관제 대시보드 (`Dashboard.tsx`)

| 제품 · 화면 | 레이아웃 / 핵심 컴포넌트 / 인터랙션 | 확신도 |
|---|---|---|
| **Datadog · LLM Observability Overview** | 좌측 글로벌 nav + 상단 필터·타임레인지 바 + 위젯 그리드. KPI = **Query Value 위젯**(현재값+임계 조건부 색상+변화율 화살표+배경 스파크라인). 토큰을 입력/출력/캐시 read·write로 **분해**. 타임레인지로 전 위젯 동기화 | 높음(배치 일부 추측) |
| **New Relic · AI Monitoring** | 인프라 메트릭 + AI 메트릭 **side-by-side**. 상단 billboard KPI 3종(total responses / avg response time / avg token usage). **드래그-투-줌 → 하단 테이블 동기화 필터**. "tokens used vs token limit" 한도 표시 | 높음 |
| **Grafana · vLLM 공식 대시보드** | 상단 KPI 없이 곧장 2열 시계열 그리드 + heatmap("엔지니어 관제형"). 패널: E2E Latency, Token Throughput, **TTFT, Inter-Token Latency(TPOT)**, Scheduler State(running/waiting/swapped), KV Cache Util, Queue Time, Prefill/Decode Time. model_name 변수 셀렉터 | 높음(JSON 직접 파싱) |
| **Nutanix EAI · Dashboard** | KPI 4종(Endpoint Summary 상태 카운트·Infra 게이지·API Requests) → 하단 요청량 추세 막대 + **Top 5 Endpoints / Top 5 API Keys** 랭킹 테이블 | 높음(상세 차트 중간) |
| **Backend.AI · Dashboard** | 좌측 사이드바 + 5패널 그리드(My Sessions·내 한도·그룹 내 내 리소스·그룹 전체·Recently Created 5행). **카드는 게이지보다 "카운트 + 사용/여유 비교 막대"**. 라이트+오렌지 기조 | 높음(색상값 불확실) |

**FABRIX가 가져올 점**
1. **KPI 행 표준화** — 요청량·지연(p95)·에러율·토큰·GPU 5카드를 "현재값+임계색상+변화율+스파크라인"으로. (TL;DR #1)
2. **추론 지연 3분할 패널** — 평균 1개 대신 **TTFT / Inter-Token(TPOT) / E2E** + p95/p99 게이지 + 길이 heatmap. 병목 위치를 즉시 식별(vLLM 표준).
3. **Scheduler State + Queue Time**으로 큐 적체 가시화, **토큰을 입력/출력/캐시로 분해**, **Top 5 Endpoints/API Keys 랭킹**(책임추적·쿼터 근거) 카드 추가.
4. **"내 한도 vs 그룹 vs 전체" 3계층 리소스 카드**(Backend.AI) → 테넌트/모델/클러스터 GPU·토큰 비교에 응용.

---

### 2. GPU/MIG 물리 관제 (`Gpu.tsx`)

| 제품 · 화면 | 레이아웃 / 핵심 컴포넌트 / 인터랙션 | 확신도 |
|---|---|---|
| **Grafana · NVIDIA DCGM Exporter (ID 12239, 공식)** | "**와이드 시계열(18w) + 사이드 게이지(6w)**" 짝 행 반복: Temperature / Power / SM Clocks+Tensor Core / Utilization+Framebuffer Mem. **임계 3단 컬러 게이지**(Temp 0–83 녹/83 황/87+ 적, Power 정격 75%/90%). 범례에 **avg/current/max 동시** 표기. $gpu multi-select | 높음(JSON 직접 파싱) |
| **Grafana · MIG DCGM (ID 16640, 23382)** | bargauge/gauge/pie/stat/table 혼합. **bargauge로 다중 GPU/슬라이스 가로 막대 비교**, pie로 할당/유휴 비율. MIG 슬라이스는 `GPU_I_ID`·`GPU_I_PROFILE`(1g.10gb 등) 라벨로 시리즈 분리 | 중간 |
| **NVIDIA Run:ai · 클러스터 대시보드** | Overview(Ready/Allocated GPU·실행/대기 카운트) + Analytics(GPU 할당 시계열·**idle allocation time**·프로젝트별 사용). fractional GPU·MIG 할당 | 중간 |
| **all-smi / nvidia-smi 패턴 (lablup OSS)** | 다중 노드 시 **Cluster Overview = 집계 카드 + 노드별 LED 그리드**(상태 점 매트릭스). GPU별 가로 행 반복(사용률/메모리/온도/전력 막대+수치). 임계 컬러(사용률 ≤60 녹/60–80 황/>80 적, 온도 80 경고/90 심각) | 높음(배치 낮음) |

**FABRIX가 가져올 점**
1. **3단 진입 구조**: ① **노드 LED 그리드**(수십~수백 GPU를 상태 점 매트릭스로 한 화면 압축) → ② **GPU 행 테이블**(사용률/메모리/온도/전력 가로 막대+수치, 카드보다 스캔성↑) → ③ GPU 드릴다운(시계열 + MIG bargauge + 인퍼런스 지연 동기 차트).
2. **MIG 슬라이스 = bargauge 가로 스택**("물리 GPU 1개 안의 슬라이스들") + 테이블에 `GPU_I_PROFILE`(슬라이스 크기) + **할당 테넌트** 칼럼.
3. **표준 임계 컬러 채택**: 온도 87–90 / 전력 90% / 사용률 80% → 라이트+오렌지(황색→오렌지 매핑). 범례 avg/current/max를 `TimeseriesChart`에 적용.
4. **거버넌스 차별 KPI: "할당 vs 실사용 갭(idle allocation)"**(Run:ai) — 인퍼런스 거버넌스 정체성에 직결.

---

### 3. 트래픽 / 요청 트레이스 뷰 (`Traffic.tsx`)

| 제품 · 화면 | 레이아웃 / 핵심 컴포넌트 / 인터랙션 | 확신도 |
|---|---|---|
| **Langfuse · Trace Detail (2025 New Trace View)** | **2분할: 좌측 계층 트리 + 우측 상세**. Tree↔Timeline(워터폴) 토글, Timeline은 지속시간 비례 막대. **GENERATION 막대에 TTFT 구간 별도 표시**. 형제 노드 대비 latency/cost **백분위 색상**(느리거나 비싼 스텝 강조). 노드 클릭→우측 동기화, expand/collapse | 높음(색상값 추측) |
| **Datadog · APM Trace View** | 한 트레이스 4뷰 전환(Flame Graph / **Waterfall** / Span List / Map). Waterfall: 행=스팬, 상대막대+절대 ms+서비스/리소스명+상태코드, chevron 접기. 색=서비스, 길이=지속시간, 에러=빨강. 클릭→상세(연결 logs/metrics 이동) | 높음(critical path 불확실) |

**FABRIX가 가져올 점**
1. **좌측 gateway→router→engine 스팬 트리 + 우측 상세, Tree↔Waterfall 토글.** 단계가 적으니 Waterfall 우선(행=상대막대+ms+단계명+상태코드).
2. **(차별점) 엔진 막대를 `queue → prefill(TTFT) → decode` 색 분할** — 한 막대에서 TTFT vs TPOT를 분리. Dynamo disaggregated는 prefill/decode를 **병렬 막대**로.
3. **형제 대비 백분위 색상**으로 병목(라우터 큐잉 / KV transfer) 자동 강조.
4. **상세 패널에 도메인 정보**: 라우팅 결정 근거(선택 엔진/로드) · 게이트웨이 정책 결과(레이트리밋/인증) · 엔진 KV-cache 상태 + 트레이스 레벨 요약 헤더(총 지연/TTFT/토큰/큐 대기 배지).

---

### 4. 사용량 · 귀속 리포트 (`Usage.tsx`)

| 제품 · 화면 | 레이아웃 / 핵심 컴포넌트 | 확신도 |
|---|---|---|
| **OpenAI Platform · Usage** ★모범 | 필터바(프로젝트 선택 + 날짜범위) + Cost/Activity 전환 탭 + **일별 스택 바차트(막대 안을 그룹 차원 세그먼트로 분할)** + 그룹 테이블. group_by = model/project/api_key/user. **Top-N + "Other"** | 높음 |
| **OpenRouter · Activity** | 필터바(**1H/1D/1M/1Y 토글** + 차원) + **3 메트릭 카드(Spend/Tokens/Requests)** → 카드 클릭 expand → 추세+테이블. 차원 Model/API Key/Creator. **Export CSV/PDF** | 높음 |
| **LiteLLM · Usage(NewUsagePage)** | KPI + 추세 + 그룹 테이블. 탭 Cost/Activity/Customer/Endpoint. 차원 team/customer/key/user/model/provider/tag. Logs **Live Tail 실시간 스트리밍** | 높음(차트 중간) |
| **Anthropic Console · Usage / Cost(분리)** | Usage(input/output 토큰 막대) ↔ Cost(일별 비용 line/area) **별도 화면**. 차원 model/workspace/key/tier. CSV 내보내기 | 높음 |
| **Nutanix EAI · Dashboard** ★온프레미스 | 상태 타일(Active/Pending/Failed) + Infra KPI + **API Requests Trends 막대** + **Top 5 Endpoints / Top 5 API Keys** + 모델 성능(TTFT/TPOT/tok-per-sec). API 키별 정렬 귀속 | 높음 |
| **Datadog · Cost Explorer** | 타임시리즈(절대$/변화율%/달러변화$ 3뷰) + Group By 다중 + `Top changes only`. **행 클릭→사이드 패널**(사용량 vs 단가 동인 분해) | 높음 |
| **AWS/Azure/GCP Cost (공통)** | 컨트롤 + 좌/우 Filters(Group by + Filter) + 차트(Bar/Stack/Line 전환) + 테이블. **Top 10 + Others**, **forecast 구간 연한 색**, Group by 즉시 재집계 | 높음 |

**FABRIX가 가져올 점**
1. **메인 레이아웃 = OpenAI식 일별 스택 바차트(차원 세그먼트) + OpenRouter식 3 메트릭 카드(Spend/Tokens/Requests) + 차원 토글** 결합.
2. **부서↔앱↔키↔모델 차원 즉시 전환**(우리 4축 귀속 강점) + **Top-N + "기타"** + **NAI식 Top 5 테이블**(Endpoints/API Keys 책임추적).
3. **Datadog식 행 클릭→사이드 패널 드릴다운**(사용량 vs 단가 동인 분해) + **CSV/PDF Export**(OpenRouter) + 추세에 **forecast 구간**(클라우드 공통).

---

### 5. 키 · 예산 관리 (`Keys.tsx`)

**키 발급/마스킹 (공통 표준, 확신도 높음)**: 생성 시 시크릿 **1회만 노출 → 이후 영구 마스킹**(`sk-...abc`). Anthropic·OpenAI·Nutanix·OpenRouter 전부 동일.

| 제품 | 키 생성/관리 패턴 | 확신도 |
|---|---|---|
| **LiteLLM · Virtual Keys** | 생성 모달에 **Budget Window(일/주/월 복수) + RPM/TPM + max_parallel + 모델 제한 + expiry** 인라인. 키별 spend 컬럼 + 리셋. block/unblock·삭제·**키 회전**(엔터프라이즈) | 높음 |
| **OpenAI · API keys** | 컬럼 = 이름/마스킹/생성일/**last used**/권한/프로젝트. 생성 모달 **Permissions 라디오 3종(All / Restricted[엔드포인트별 None·Read·Write] / Read Only)** | 높음 |
| **Nutanix EAI · API Keys** ★ | 1회 표시 후 마스킹 + **키별 엔드포인트 스코프** + 발급 전 UI에서 **모델 one-click test**. 키별 사용량 = 대시보드 Top-5 | 높음 |
| **Azure OpenAI** | **KEY1/KEY2 2개 = 무중단 로테이션**, 개별 Regenerate. 한도 도달 시 **HTTP 429** + rate-limit 헤더 | 높음 |
| **Portkey · Budget Limits** ★폼 가장 구체적 | Budget Allocation 탭: **Cost/Tokens 토글 + Budget Limit($) + Alert Threshold($) + Periodic Reset(No/Weekly/Monthly/Custom 1–365일) + Rate Limit(Req/Token × Min/Hour/Day)**. 초과 시 자동 차단 + 임계 도달 이메일 알림 | 높음 |
| **GCP / AWS / Azure Budgets (공통)** | 임계값 % + **Actual vs Forecasted 토글**, 2계층 한도(조직→하위). **GCP는 목록에 진행 게이지 + 클릭 드릴다운**. 대부분 소프트(알림) | 높음 |

**FABRIX가 가져올 점**
1. **키 생성 모달에 예산·rate limit·스코프 인라인 통합**: LiteLLM식 Budget Window(일/주/월) + RPM/TPM/TPD + OpenAI식 권한 라디오 + **NAI식 엔드포인트 스코프**. (우리 스키마 `quota_rpm`/`quota_tpd`와 정합)
2. **키 테이블에 키별 사용량/스펜드 컬럼 + last used + 클릭 드릴다운**, 키 회전(또는 Azure식 KEY1/KEY2).
3. **예산 폼 = Portkey식**(Cost/Token 토글 + Budget Limit + **Alert Threshold 사전경고** + Periodic Reset). **인앱 예산 진행 게이지를 자체 구현**(GCP식 목록 게이지+드릴다운) — 경쟁사 대부분 Grafana 의존이라 **차별점**. **하드 캡(초과 시 차단, 429) + 사전 경고 배너 + Actual vs Forecasted 토글**.

---

### 6. 모델 카탈로그 (`Models.tsx`)

| 제품 · 화면 | 레이아웃 / 카드 컴포넌트 | 확신도 |
|---|---|---|
| **Fireworks · Model Library** | 카드 그리드 + 상단 가로 칩 바. 카드에 **가격($/M In·Out) + 컨텍스트 + 타입 태그**, 별도 **벤치마크 비교 뷰(intelligence·tok/s·TTFT)** | 높음 |
| **Together · Model Library** | 카드 그리드 + 상단 모달리티 탭. 가격 3종(Input/Output/**Cached**), 기능 태그(Function Calling/JSON) | 높음 |
| **OpenRouter · Models** | 세로 리스트 + **좌측 사이드바 필터**. 상세에 **동일 모델 × 여러 provider 비교 테이블**(가격·컨텍스트·throughput·latency·uptime) | 중간 |
| **Hugging Face · Models Hub** | 카드 그리드 + 좌측 필터. **메타데이터=필터=카드 배지 일원화**, 상세에 Inference widget + "Deploy" CTA | 높음 |
| **Vertex · Model Garden** | 카드 그리드 + 좌측 4분류 필터(Tasks/Collections/Providers/Features) | 높음 |
| **Nutanix EAI** ★ | **내 Models=테이블 / NGC·HF=카탈로그 분리**, **검증 배지 + "검증 모델만 보기" 토글**, 컬러 점 Status(Pending/Processing/Ready) | 중간 |
| **Backend.AI · Model Serving** | 좌측 사이드바 + 서비스 테이블. 행에서 **"LLM Chat Test" 즉시 진입**, Runtime Variant(vLLM/NIM/Custom) | 높음 |

**FABRIX가 가져올 점**
1. **두 화면 분리**: NAI식 "모델 카탈로그(검증 배지·필터)" + Backend.AI식 "내 엔드포인트 테이블(Chat Test·Validate·종료)".
2. **카드 전면에 운영 메트릭**: throughput(tok/s)·TTFT·컨텍스트·GPU 요구·서빙모드(agg/disagg) — "추론 성능 비교 카탈로그"로 포지셔닝.
3. **차별화**: Together **Cached 가격** → KV/prefix 캐시 단가로, NAI **검증 배지** → "vLLM 호환 / Dynamo disagg 지원" 배지로 응용.

---

### 7. 플레이그라운드 + 멀티모델 비교 (`Playground.tsx`)

**레이아웃 표준(확신도 높음)**: 중앙 대화 + **우측 카드형 설정 패널**(Together·Vertex·Bedrock·OpenAI 공통). 파라미터 = temperature/max_tokens/top_p/top_k + 시스템 프롬프트 전용 영역(프리셋+인라인 편집).

**멀티모델 비교**:
- **AWS Bedrock Compare** ★ — 가로 pane 나란히(기본 2개→최대 3개), **응답마다 Input/Output tokens·Latency 인라인 표시**.
- **OpenRouter Chatroom** — 두 모델 선택→비교 채팅방 자동 생성. **HF Playground** — 동일 모델의 다른 설정도 비교.

**View code(확신도 높음)**: Anthropic "Get Code" 원클릭(Python/TS/curl), Vertex "Get code"→Colab, Fireworks/OpenRouter/HF 다중 언어 탭+복사.

**FABRIX가 가져올 점**
1. **(최우선) 응답마다 TTFT / tok-per-sec / 토큰 / Latency 인라인 표시** — vLLM/Dynamo 차별점을 화면에서 체감(Bedrock·Fireworks).
2. **최대 3컬럼 Compare** — 모델 비교뿐 아니라 **동일 모델 disagg vs agg 라우팅 비교**(Dynamo 강점 직결).
3. **View code 원클릭** — OpenAI 호환 cURL/Python/TS 탭 + **자사 엔드포인트 URL 자동 주입**(마이그레이션 학습비↓).

---

### 8. 엔드포인트 생성 / 모델 임포트 위저드 (`Endpoints.tsx`, `Models.tsx` Import)

**엔드포인트 생성 위저드**

| 제품 | 핵심 패턴 | 확신도 |
|---|---|---|
| **Nutanix EAI · Create Endpoint** ★ | 선형 멀티스텝(YAML 없음): 모델→GPU→**vLLM 선택 시 vCPU/RAM 자동 채움**→replica→API키. Pending→Active 상태 머신 | 높음 |
| **Backend.AI · Start Service** ★ | **선언적 오토스케일 룰 빌더**(메트릭+연산자+임계값+Step Size+CoolDown) + **Validate 사전검증** + HEALTHY/UNHEALTHY | 높음 |
| **HF Inference Endpoints** | GPU **타일 카드 + 시간당 단가 + 비호환 회색 비활성**, Scale-to-Zero, Pending-requests 트리거 | 높음 |
| **Fireworks / Replicate** | **목적별 프리셋(Fast/Throughput/Minimal)**, Min=1 웜 / Min=0 scale-to-zero | 높음 |
| **Vertex / RunPod** | Min/Max nodes + 사용률 타겟, **Traffic split(카나리)**, GPU 우선순위 폴백 리스트 | 중간~높음 |

**모델 임포트 위저드**

| 제품 | 핵심 패턴 | 확신도 |
|---|---|---|
| **Nutanix EAI · Import Models** ★ | **드롭다운 3분기(HF/NGC/Manual)** + 검증 모델 테이블 + 커스텀 URL 이중경로 + **라이선스 게이트 경고** + **3색 인디케이터(Pending/Processing/Active)** | 높음 |
| **Backend.AI** | Runtime Variant(vLLM/NIM/Custom) + **Validate + 실시간 로그 팝업**. (HF 직접 import GUI 부재=차별 기회) | 높음/중간 |
| **AWS Bedrock · Import** | S3 경로 + **Browse 버튼** + IAM 롤 자동생성 + **비동기 Job + Status 추적** | 높음 |

**FABRIX가 가져올 점**
1. **모델 선택 → vLLM 엔진 선택 시 vCPU/RAM 자동 채움 + GPU 자동 추천**(Nutanix+SageMaker) — vLLM 기반이라 그대로 적용, 오선택·인지부하 최소화.
2. **MIG/fGPU 분할을 "프리셋 카드"로 추상화** + replica **Min=0(scale-to-zero)/Min=1(웜) 명시 토글** + **vLLM 특화 오토스케일 룰 빌더**(큐 지연/Pending 기반, Step Size·CoolDown) + **Validate 사전검증·상태 머신**.
3. **임포트: 3색 라이프사이클(Pending→Processing→Active) + 실시간 검증/기동 로그 팝업**, 소스 4분기(HF/NGC/Upload/S3), **약관/gated repo 게이트 경고**를 import 직전 명시. **HF URL 직접 import로 차별화**.

---

### 9. 가드레일 증적 / 이벤트 뷰 (`Guard.tsx`, `GuardOverview.tsx`)

| 제품 · 화면 | 레이아웃 / 컴포넌트 | 확신도 |
|---|---|---|
| **Splunk · Search/Events + Audit** ★증적 정석 | 상단 **타임라인 히스토그램(드래그 줌)** + 하단 이벤트 목록(인라인 확장) + 좌측 Selected/Interesting Fields. 표준 컬럼 `_time·action·user·clientip·status` | 높음 |
| **Lakera Guard · Logs/Analytics** | 좌측 nav. **Logs = "All Requests" / "Threats" 2탭 분리**. PII는 상세에서 `<EMAIL>`·`<CREDIT_CARD>` **타입 토큰 마스킹**. 신뢰도 **L1~L4 등급** | 중간 |
| **Arize Phoenix · Trace/Span** | Trace 트리→Span 상세. 평가 어노테이션이 **label + score + explanation(판정근거)** 스키마 | 중간 |
| **NeMo Guardrails · Observability** | 전용 UI 없음, **OTel 트레이스+JSON 로그**. 스팬 필드 `rail.type`(input/output)·`rail.name`·**`rail.stop`(차단여부)**·`rail.decisions`(판정근거) | 중간~높음 |
| **Databricks · Inference Tables** | 전용 UI 아닌 **쿼리 가능한 Delta 테이블**("증적=테이블" 철학). 컬럼에 input/output·**http_status·latency** | 중간 |

**FABRIX가 가져올 점**
1. **종합 레이아웃**: KPI 카드 행 + **시간대별 위반 히스토그램(드래그 줌, 오렌지 막대)** + 필터바(시간/유형/동작/라우트/confidence) + 테이블(`_time · rail.type · 유형 · severity(L1~L4) · action · user · client_ip · route/model · latency · http_status`) + **All/Threats 2탭** + 행클릭 상세.
2. **상세 모달 = 마스킹 원문(타입 토큰) + 판정근거(explanation/`rail.decisions` 단계 순서) + 원시 API 응답**. 원문 로깅은 admin 설정으로 분리.
3. **http_status+latency를 증적 1급 컬럼**(보안+SLA 동시 조망), **SIEM 표준 컬럼명 그대로 채택**(학습비 0), **OTel 수집→자체 React 화면**(폐쇄망).

---

### 10. 가드레일 정책 카탈로그 / 토글 (`GuardPolicy.tsx`)

| 제품 | 멘탈 모델 / UI 패턴 | 확신도 |
|---|---|---|
| **Portkey Guardrails** ★ | **"체크(원자) → Guardrail(묶음) → Config(라우트 적용)" 3계층**. 50+ 체크 우측 사이드바 카탈로그. input/output 이원화. Actions: Async / **Deny(차단)** / Feedback | 높음 |
| **Lakera Policies** | Policies 테이블 + 카테고리 토글 + **민감도 L1~L4 슬라이더** + 역할별 적용(user/assistant/tool). 정책↔프로젝트 분리. **토글 변경 감사 기록** | 높음 |
| **NeMo Guardrails** | **5종 rail: input → dialog → retrieval → output → execution**(요청 생애주기) | 높음 |
| **LiteLLM Guardrails** | mode: pre_call/post_call/**logging_only** + `default_on` 토글 + 키/팀/모델 단위 attach | 높음 |
| **Databricks AI Gateway** | 엔드포인트 생성 폼의 한 섹션(Input/Output Safety·PII 토글) + 배포 후 Playground 즉시 테스트 | 중간~높음 |

**FABRIX가 가져올 점**
1. **요청 생애주기 스윔레인 레이아웃**(NeMo 5-rail: input→retrieval→output…)에 정책 카드를 단계별 레인에 배치 → vLLM/Dynamo 흐름과 매핑.
2. **3-state 토글 `off / monitor(logging_only) / enforce`**(LiteLLM) — monitor로 관찰 후 enforce 전환 = 폐쇄망 도입 리스크 최소화. + **enforce vs monitor 배지**, **L1~L4 민감도 슬라이더**(비전문 컴플라이언스 담당용).
3. **3계층 멘탈 모델(체크→정책→라우트 적용)**(Portkey), 정책 정의/attach 분리, **토글 변경 감사 자동 기록**, 정책 카드 인라인 테스트 프리뷰, GUI 토글→선언형 YAML export(GitOps 감사).

---

### 11. 프롬프트 / 평가(Eval) 관리 (`Eval.tsx`)

| 제품 | 핵심 화면 패턴 | 확신도 |
|---|---|---|
| **Langfuse** | ChartScores(이동평균 시계열) + ScoresTable. **프롬프트 버전 = immutable 목록 + 레이블 칩(production/staging) → 레이블 이동으로 deploy/rollback**. LLM-judge 폼 = 스텝형(모델→evaluator→프롬프트→Score유형→변수매핑→**최근 24h 라이브 프리뷰**). Experiments Run A vs B | 높음 |
| **Arize Phoenix** | **Experiments Compare**: Table(예제별 출력 나란히) + **Diff Mode**(baseline 대비 개선/악화) + **Diff Output Mode**(텍스트 삽입/삭제 하이라이트). +Compare로 A/B/C/D | 높음 |
| **Databricks MLflow 3 GenAI** | Pass/Fail 배지 + **judge rationale 툴팁** + 행클릭 trace drill-down. Run-to-Run(V1/V2 좌우 + ✓/✗). **자연어 Guidelines judge** | 높음 |
| **Braintrust** | Experiment diff + **"Order by regressions"(점수 하락 행 상단 정렬)** + grade pills + Monitor 시계열(드래그 줌) | 높음 |

**FABRIX가 가져올 점**
1. **회귀 비교를 1급 화면으로** — Braintrust "Order by regressions" + Phoenix "Diff Mode" 결합. **점수 하락 행 자동 상단 정렬 + delta 배지**(개선=오렌지, 회귀=저채도 레드/회색). 모델 교체·양자화 전후 증거 보존.
2. **LLM-judge = 단계형 폼 + 라이브 프리뷰 + 자연어 Guidelines judge** — 컴플라이언스 담당이 공시 규정·금칙어를 자연어 체크리스트로 정의.
3. **프롬프트 버전 = 레이블 포인터 deploy/rollback**(Langfuse) + 보호 레이블 RBAC + 감사 로그 연결.

---

### 12. RBAC / Settings + 알림 드로어 (`Settings.tsx`, `Notifications.tsx`, `Alarms.tsx`)

**RBAC**

| 제품 | 패턴 | 확신도 |
|---|---|---|
| **Langfuse** | 역할 5종(Owner/Admin/Member/Viewer/None) + **역할 × 스코프 권한 매트릭스** + **자신보다 높은 역할 부여 불가 게이트**(에스컬레이션 차단) | 높음 |
| **LiteLLM** | 조직>팀>사용자>가상키 계층, 역할 5종. **키 귀속 유형(사용자 키 vs 팀 서비스계정 키)** 구분 | 높음 |

**알림 드로어**

| 제품 | 패턴 | 확신도 |
|---|---|---|
| **PatternFly(정석)** | 우측 슬라이드 패널. 항목=상태 아이콘+메시지(읽지않음 볼드)+상대/절대 시간+인라인 액션. **카테고리 아코디언(하나만 열림)**, 읽지않음 카운트 배지. **"Clear는 화면에서만 제거, 감사 로그는 유지"** | 높음 |
| **GitHub** | **이유 레이블(reason)** + 필터 탭(Assigned/Mentioned/안읽음) + 알림 클릭→딥링크 | 높음 |

**FABRIX가 가져올 점**
1. **역할 × 스코프 매트릭스를 읽기전용 참조표로 동봉** + **상향 권한 부여 차단 게이트** + **조회 전용 Admin 역할(감사관용)** + 키 귀속 주체/퇴사 정책 컬럼.
2. **알림 = PatternFly 슬라이드 패널**(심각도 색: critical=레드, warning=오렌지) + **이유 레이블 + 필터 탭 + 딥링크** + 토스트(휘발)/드로어(히스토리) 2단 분리.
3. **모든 권한 토글·알림 처리(Clear/Read)도 감사 로그 유지** — 폐쇄망 컴플라이언스 관통.

---

## 부록 A. 출처 (URL + 확신도)

> 출처는 공식 docs/제품페이지/대시보드 JSON 직접 확인 위주. 일부는 SPA·rate limit으로 미확정 → "추측" 표기. **외부 인용 시 원본 대조 필수.**

**관제 / GPU / 트레이스**
- Datadog LLM Observability / Query Value / Trace View — docs.datadoghq.com/llm_observability, /dashboards/widgets/query_value, /tracing/trace_explorer/trace_view (높음)
- New Relic AI Monitoring — docs.newrelic.com/docs/ai-monitoring (높음)
- Grafana vLLM 대시보드 / DCGM Exporter(12239) / MIG(16640·23382) — grafana.com/grafana/dashboards/12239, /16640, /23382, vLLM grafana.json (높음~중간)
- NVIDIA Run:ai — docs.nvidia.com/dgx-cloud/run-ai, docs.run.ai (중간)
- Triton metrics / all-smi(lablup) — Triton docs(높음), github.com/lablup/all-smi(높음, 배치 낮음)
- Langfuse Trace View — langfuse.com/docs, /changelog (높음)

**사용량 / 키 / 예산**
- OpenAI Usage — help.openai.com/articles/10478918 (높음) · OpenRouter Activity/Keys — openrouter.ai/docs (높음)
- LiteLLM Usage/Virtual Keys/Budgets — docs.litellm.ai/docs/proxy/{cost_tracking,virtual_keys,users} (높음)
- Portkey Analytics/Budget Limits/Model Catalog — portkey.ai/docs/product/observability/analytics (높음)
- Anthropic Console Usage/Cost/Keys — support.claude.com/articles/9534590 (높음)
- AWS/Azure/GCP Cost·Budgets — docs.aws.amazon.com/ce, learn.microsoft.com, cloud.google.com/billing (높음)
- Nutanix EAI Dashboard/API Keys — nutanix.com/products·blog, nutanix.dev (높음, 상세차트 중간)

**카탈로그 / 플레이그라운드 / 위저드**
- Fireworks / Together / OpenRouter / HF Hub / Vertex Model Garden / AWS Bedrock — 각 공식 docs (높음~중간)
- AWS Bedrock Compare(멀티모델) — docs.aws.amazon.com/bedrock (높음)
- Nutanix Create Endpoint·Import / Backend.AI Start Service·Model Serving — nutanix.dev, lablup/backend.ai-docs-webui (높음)
- HF Inference Endpoints / SageMaker JumpStart / Replicate / RunPod — 각 공식 docs (높음)

**가드레일 / 평가 / RBAC / 알림**
- Lakera Guard — docs.lakera.ai/docs/platform, /defenses, /policies (중간)
- Portkey Guardrails / LiteLLM Guardrails — portkey.ai/docs, docs.litellm.ai/docs/proxy/guardrails (높음)
- NeMo Guardrails — docs.nvidia.com/nemo/guardrails (중간~높음) · Databricks AI Gateway/Inference Tables — docs.databricks.com (중간)
- Arize Phoenix(traces/experiments) / Langfuse(eval·prompt) / MLflow 3 GenAI / Braintrust — 각 공식 docs (높음, 일부 색상·diff형식 추측)
- Splunk(증적 정석) — docs.splunk.com (높음) · PatternFly(알림 드로어) — patternfly.org (높음) · GitHub/Linear 알림 (높음~중간)

## 부록 B. 다음 액션(제안)
- 이 문서의 "FABRIX가 가져올 점"을 [개발 우선순위](goal/개발-우선순위.md) §2 각 화면 노드의 *iteration 포인트*로 승격.
- 핵심 레퍼런스(OpenAI Usage, Portkey Budget, NAI Dashboard, Bedrock Compare, Langfuse Trace, DCGM 대시보드)는 **실콘솔 로그인 스크린샷으로 재확인** 후 본 문서에 캡처 첨부.
- 공통 컴포넌트부터 착수 권장: `StatCard`(KPI 5패턴), `TimeseriesChart`(avg/cur/max 범례·드래그줌·임계 3단색), 마스터-디테일 슬라이드 패널, Top-N+기타 BarList.

---

> ※ 본 문서는 **내부 UI/UX 설계 참고용 리서치**이며, 경쟁사 공개 자료 기반 분석입니다. 일부 판정·수치는 벤더 표방·2차 자료로 "확인 필요"입니다. 외부 발송·고객 제안서에 특정 제품의 거동/수치를 인용할 경우 공식 문서 원본과 대조하고 IR/PR 담당자 1인 이상의 검토가 필요합니다.
