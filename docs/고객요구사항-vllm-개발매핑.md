# FABRIX Endpoint — 고객요구사항 × vLLM Production Stack 개발 매핑 보고서

> **목적**: `고객요구사항정리.md`(증권사向 인퍼런스 관제 요구)를 `vLLM Production Stack on Dell AI Factory`(기술 레퍼런스)와 매핑하고, Backend.AI UI 벤치마킹을 얹어 **우리가 무엇을 만들지**를 개발 항목으로 떨군다.
> **입력 자료**: ① `docs/고객요구사항정리.md` ② `docs/h04711-vllm-production-stack-dell-ai-factory.pdf`(H04711, 2026-05) ③ `docs/backendai-benchmark-report.md`(Backend.AI WebUI 벤치마킹).
> 작성일 2026-06-17.

---

## 0. 한 줄 요약

> 고객(증권사 성격)이 원하는 건 **"누가·어떤 앱이·어떤 모델/GPU를 얼마나 잘 쓰는지 + 가드레일 증적까지 한 화면에서 관제하는 인퍼런스 거버넌스 플랫폼"**이다.
> vLLM Production Stack은 **메트릭·라우팅·가드레일·오토스케일의 백엔드 원천**을 거의 다 제공한다(Prometheus/Grafana/Jaeger, Semantic Router, KEDA, API Key).
> **우리(FABRIX endpoint)가 만들 것 = 그 위의 거버넌스/관제 레이어**: 사내 DB 연동 유저 식별 → 사용자·앱·API키 단위 사용량 귀속 → MIG/GPU 효율 가시화 → 가드레일 증적 → 커스텀 관제 대시보드.

---

## 1. 고객요구사항 해석 (러프 노트 → 명확한 요구)

`고객요구사항정리.md`의 메모를 요구사항으로 정규화했다. (괄호는 원문 표현)

| # | 요구사항 | 원문 근거 |
|---|----------|-----------|
| R1 | **사용 주체 식별·귀속**: GPU/인퍼런스를 "누가" 쓰는지 특정. 유저 단위 = sessionId / 사내 DB ID, **사내 DB·SI 연동** | "누가를 특정을 지어야함", "유저의 단위: sessionId, DB ID, SI인데 사내 DB랑 연동" |
| R2 | **사용 현황·품질 메트릭**: API별 사용현황, **TTFT**, "누가 얼마나 잘 쓰나" | "vllm으로 api 별로 사용현황 ttft", "누가 얼마나 잘 사용하고 있나" |
| R3 | **출처(프론트/앱) 귀속**: "어느 프론트가 보냈나" → vLLM 메트릭에 연결 | "어느 프론트가 보냈나 -> vllm 매트릭" |
| R4 | **API Key 단위 분석**: 단일 모델이라도 **API 키별** 사용량 구분 | "모델별로 개인 API key를… 어느 API 키 별로" |
| R5 | **프록시/Pod 통신 가시화**: pod 간 통신 흐름, **프록시 성능·메트릭** | "pod 간의 통신의 흐름…프록시의 성능 프록시 매트릭" |
| R6 | **애플리케이션 레벨 모니터링**: 앱(챗봇/batch/agentic) 단위 흐름 | "application 레벨 별의 모니터링의 흐름" |
| R7 | **GPU 효율·MIG 검증**: GPU 사용량 기준 + **MIG 적용** + "MIG 얼마나 잘 짤랐는지" | "gpu 사용량에 대한 기준 -> mig 적용 -> mig 도 얼마나 잘 짤랐는지" |
| R8 | **멀티 워크로드/멀티 모델**: 챗봇·batch·오픈코드·내부 agentic AI, gemma·qwen 등 | "대고객은 챗봇, batch, 오픈코드…내부 agentic AI…gemma4 gwen3.5" |
| R9 | **가드레일(AI 기반) + 증적**: 가드레일이 AI 모델 활용, **결과 증적** 보관, 문제 시 fluent로 메트릭 송출 | "가드레일은 AI 모델을 활용", "가드레일의 결과에 대한 증적", "SDS: gardrail…fluent 를 통해서 매트릭" |
| R10 | **커스텀 관제**: "애플리케이션을 통해 관제 입맛대로" | "어플리케이션을 통해 관제 입맛대로" |
| R11 | **네트워크 요건** (온프렘/사설망) | "네트워크도 필요한데", 증권사 = 폐쇄망 |

**고객 페르소나**: 증권사. 즉 폐쇄망/온프렘, 컴플라이언스·증적 필수, 부서·앱·사용자별 과금/책임 추적이 핵심. → Dell AI Factory(온프렘 vLLM)와 정확히 같은 전제.

---

## 2. 요구사항 → vLLM Production Stack 매핑 (백엔드 원천)

vLLM Production Stack이 **이미 제공**하는 것과, 그걸 우리가 어떻게 끌어쓰는지.

| 고객요구 | vLLM Stack 제공 기능 (출처: H04711) | 우리가 쓰는 법 |
|----------|--------------------------------------|----------------|
| R2 TTFT/사용량 | **Prometheus 메트릭**: TTFT 분포, ITL(Inter-Token Latency), QPS, running/pending requests, GPU KV cache 사용률·hit rate. `vllm:num_requests_running`, `vllm_num_requests_waiting` (p23-24) | Prometheus를 데이터 소스로. 우리 대시보드가 직접 쿼리 |
| R2/R6 추적 | **OpenTelemetry + Jaeger 분산 트레이싱**: client→router→engine 전 구간 span (p24-25). `routerSpec.otel`, `OTEL_*` env | 요청 단위 추적 → 앱/유저 귀속의 기반 |
| R3/R4 귀속 | **세션 헤더 `x-user-id`** 라우팅 어피니티 지원 (KV-aware/session routing, p41). **OpenAI 호환 API** `/v1/chat/completions` | 프론트가 보낸 `x-user-id`/API키를 메트릭 라벨·트레이스 태그로 전파 |
| R4 API Key | **3단 API Key**: ① Single(전 모델 공통) ② **Dedicated per-model**(`vllmApiKey` per modelSpec) ③ Router-level (p19-20) | per-model/per-key 키 발급·회수를 우리 콘솔에서 관리 |
| R5 프록시 | **Intelligent Router**(`vllm-router`, lmcache/lmstack-router) = 단일 진입점, replica 로드분산·서비스 디스커버리. Envoy AI Gateway(Semantic Router) (p8,13). 라우팅 오버헤드 ≈ 0 검증 (p14-15) | 프록시 메트릭(라우팅 결정·포워딩)을 트레이스/메트릭으로 노출 |
| R7 GPU/MIG | **Fractional GPU**(vLLM/Backend.AI 공통 개념), Grafana에 GPU 메모리·KV cache·HW 사용률 (p24). KEDA가 `vllm:num_requests_running`로 스케일 (p26) | MIG 슬라이스별 사용률은 **DCGM(NVIDIA) 메트릭 추가 수집** 필요(스택 기본 외 — 4-2 참고) |
| R8 멀티모델 | **Multi-Model Routing**: `modelSpec` 리스트로 여러 모델 동시 배포, 단일 라우터 엔드포인트. `/v1/models`로 노출 (p13) | 모델 카탈로그 화면이 `/v1/models`를 그대로 소비 |
| R9 가드레일 | **Semantic Router 보안**: PII 탐지(ModernBERT `mmbert32k-pii-detector`, 35 PII 클래스), Jailbreak 탐지, 응답 헤더 `x-vsr-pii-violation`/`x-vsr-pii-types`/`x-vsr-jailbreak-blocked`/`-confidence` (p18-19). Intent 분류로 expert 모델 선택(`x-vsr-selected-model`) | 헤더를 수집해 **증적 레코드**로 적재. ⚠ **탐지율 한계 주의**(4-3) |
| R9 증적 송출 | 메트릭 export(Prometheus Adapter), OTLP. (fluent/fluentd는 스택 기본 외) | 가드레일 이벤트를 **Fluent Bit로 증적 스토리지(S3/ObjectScale)** 적재 — 우리가 붙임 |
| R8/HA | **KEDA 오토스케일**(0→4 replica, 5분 cooldown), **HA**(router가 unhealthy replica 자동 제외) (p26,36) | 워크로드별 스케일 정책 UI |
| R8 성능 | **LMCache KV offloading**(GPU HBM→CPU→SSD→Remote 4계층), Prefix/KV-aware routing → TTFT 최대 **~70% 감소** 실측 (p37-43) | RAG/챗봇처럼 prefix 공유 큰 워크로드에 강력. 캐시 hit rate를 대시보드 지표로 |

**결론**: R1·R7(MIG)·R9(증적 적재)·R10을 제외하면 **메트릭/가드레일/라우팅/스케일의 원천 데이터는 vLLM Stack에 다 있다.** 우리는 "수집·귀속·가시화·증적·관제"의 상위 레이어를 만든다.

---

## 3. Gap 분석 — FABRIX Endpoint가 "만들" 것

vLLM Stack이 안 주거나 부족한 것 = 우리 제품의 본체.

| Gap | 내용 | 왜 우리가 만들어야 하나 |
|-----|------|------------------------|
| **G1. 유저 아이덴티티 브로커** (R1) | `x-user-id`/sessionId ↔ **사내 DB·SI 사용자/부서** 매핑. 토큰·세션을 실제 직원/조직에 귀속 | vLLM은 헤더만 전파할 뿐, 사내 신원과 연결은 외부 시스템 몫 |
| **G2. 사용량 귀속·집계 엔진** (R2~R6) | Prometheus 메트릭 + Jaeger 트레이스를 **(유저 × 앱 × API키 × 모델 × 시간)** 차원으로 롤업. 과금/리포트 | Stack 메트릭은 인스턴스/모델 라벨 중심. 사람·앱 단위 집계는 우리가 구성 |
| **G3. API Key/앱 등록 콘솔** (R3,R4,R6) | per-model 키 발급·회수·쿼터, 프론트/앱 등록(앱→키→유저 매핑) | `vllmApiKey`는 Helm 값일 뿐, 라이프사이클 관리 UI 없음 |
| **G4. MIG/GPU 효율 가시화** (R7) | DCGM 기반 MIG 슬라이스별 점유·낭비율, "얼마나 잘 잘랐나" 스코어 | Stack 기본 관측은 KV cache·HBM 수준. MIG 파티션 효율은 별도 수집·해석 필요 |
| **G5. 가드레일 증적 파이프라인** (R9) | `x-vsr-*` 헤더 → 증적 레코드(누가/언제/무엇이 차단됐나) → **Fluent Bit → S3/ObjectScale** 불변 적재 + 조회 UI | 컴플라이언스(증권사) 핵심. Stack은 헤더만 줌 |
| **G6. 커스텀 관제 대시보드** (R10) | 앱/부서별 입맛 대시보드, 알람(임계치), 관제 뷰 구성 | Grafana는 운영자用. 고객 "관제 입맛대로"는 제품화된 UX 필요 |
| **G7. 가드레일 정확도 보강** (R9) | PII 26.7%·Jailbreak 5.7% 탐지율(기본) → 임계치 튜닝/모델 교체/한국어 PII(주민번호·계좌) 추가 | 한국 증권사 = 주민번호·계좌번호. 기본 ModernBERT로 부족(4-3) |

---

## 4. 핵심 기술 포인트 (PDF 근거 + 결정 필요)

### 4-1. 메트릭 카탈로그 (그대로 채택, Grafana 인사이트 목록 p24)
- Available vLLM Instances / Average Latency / **Request Latency 분포** / **Current QPS** / **TTFT 분포** / Running·Pending Requests / **GPU KV Usage % · Hit Rate** / Swapped Requests / **Average ITL** / HW 사용률(GPU mem·CPU·Mem·Disk).
- 오토스케일 트리거: `vllm:num_requests_running` (KEDA), `vllm_num_requests_waiting`(HPA). → 우리 "용량/스케일" 패널의 1급 지표.

### 4-2. MIG 가시화는 별도 수집 (G4)
- PDF는 Fractional GPU·KV cache까지만 관측. **MIG 슬라이스 단위 효율은 NVIDIA DCGM Exporter**(`DCGM_FI_PROF_*`, MIG profile 라벨)를 추가로 Prometheus에 물려야 함. → "MIG 얼마나 잘 잘랐나" = 슬라이스 점유율 vs 할당량 대비 낭비 스코어로 정의.

### 4-3. 가드레일 정확도 — 반드시 보강 (G7, p18-19)
- 기본 측정치: **PII 8/30 = 26.7%**, **Jailbreak 2/35 = 5.7%**. 명시적/구조화 PII·노골적 유해는 잡지만 **맥락·우회·간접은 놓침**.
- PDF 권고: 임계치 튜닝 / 대체 classifier / GPU 가속 모델. 
- **우리 추가 필수**: 한국어 PII(주민등록번호·계좌번호·여권번호) 룰 기반 1차 필터 + ModernBERT 2차. (조직 보안지침상 입력금지 데이터와 직결)
- 모든 가드레일 판정은 Envoy AI Gateway의 `ext_proc`에서 발생 → 헤더로 증적 수집 가능.

### 4-4. 라우팅 전략 선택 (p39-41, 표5)
| 전략 | 캐시 친화 | 오버헤드 | 적합 |
|------|-----------|----------|------|
| Round-Robin | 없음 | 매우 낮음 | 겹침 없는 트래픽 |
| Session-Based(`x-user-id`) | 세션 고정 | 낮음 | **챗봇/멀티턴 (증권사 상담)** |
| Prefix-Aware | 텍스트 prefix | prompt 길이 비례 | **RAG/시스템프롬프트 공유** |
| KV-Aware | 토큰 단위(정확) | 중간(토크나이즈+컨트롤러) | 대규모 멀티테넌트 |
> 증권사 멀티앱이면 **Session-Based(상담봇) + Prefix-Aware(RAG)** 혼합이 현실적. KV-Aware는 규모 커지면.

### 4-5. 성능 캐싱 효과 (p43, 표7) — 세일즈 포인트
- KV offload(LMCache) 적용 시 **평균 TTFT 342.9ms → 102.3ms (-70.2%)**, 멀티턴/공유 prompt 워크로드. → "도입하면 체감 응답 70% 빨라짐" 수치 그대로 제안서에 사용 가능.

---

## 5. 화면 설계 (Backend.AI 벤치마킹 + 고객요구 결합)

`backendai-benchmark-report.md`의 UI 패턴에 고객요구(R1~R10)를 얹은 화면 목록.

| 화면 | 내용 | 충족 요구 | 벤치마킹 출처 |
|------|------|-----------|----------------|
| **관제 대시보드** ★ | 전사/부서/앱 카드: QPS·TTFT·활성요청·GPU/MIG 사용률·가드레일 차단 건수. 패널별 새로고침 | R2,R6,R7,R9,R10 | BackendAI 대시보드(할당/한도/그룹 3단) |
| **사용량·귀속 리포트** ★ | (유저×앱×API키×모델×기간) 피벗. TTFT/토큰/요청수, CSV export | R1~R4 | BackendAI Statistics(기간선택) |
| **API Key / 앱 관리** | per-model 키 발급·회수·쿼터, 앱 등록(앱↔키↔부서) | R3,R4 | BackendAI 관리자 Credentials |
| **모델 카탈로그** | `/v1/models` 소비, 모델별 replica·상태·키·라우팅 전략 | R8 | BackendAI 모델서빙 |
| **트래픽/프록시 뷰** | client→router→engine 트레이스(Jaeger 임베드), pod 통신·프록시 지연 | R5,R6 | (신규) Jaeger UI |
| **가드레일 증적** ★ | 차단 로그(누가/언제/PII유형/jailbreak/confidence), 필터·검색, 불변 보관 | R9 | (신규) — 증권사 핵심 |
| **GPU/MIG 효율** | DCGM 기반 슬라이스 점유·낭비 스코어, 노드별 | R7 | BackendAI Agent Summary |
| **스케일/용량** | 워크로드별 KEDA min/max·트리거, replica 추이 | R8 | BackendAI 자원정책 |
| **유저 신원 연동 설정** | 사내 DB/SI 매핑 규칙(`x-user-id`→직원/부서) | R1 | (신규) |
| **채팅 Playground** | 배포 모델 즉시 검증, TPS/토큰/지연 | R8 검증 | BackendAI 25.05 채팅 |

★ = MVP 필수.

---

## 6. 개발 로드맵

| 단계 | 산출물 | 핵심 |
|------|--------|------|
| **MVP** | 관제 대시보드 / 사용량·귀속 리포트 / 가드레일 증적 / 유저신원 연동 | G1·G2·G5 + Prometheus·Jaeger·`x-vsr-*` 수집 |
| **P1** | API Key·앱 관리 / 모델 카탈로그 / 한국어 PII 보강 | G3·G7 |
| **P2** | GPU/MIG 효율(DCGM) / 트래픽·프록시 뷰 / 스케일 UI | G4·G6 |
| **P3** | 커스텀 관제 빌더 / 채팅 Playground / RAG 연동 | G6 + AIDP 패턴 |

**아키텍처 스케치**
```
[프론트앱들: 챗봇·batch·오픈코드·agentic]  ──x-user-id / API key──┐
                                                                  ▼
                                        Envoy AI Gateway + Semantic Router
                                        (PII·jailbreak·intent → x-vsr-* 헤더)
                                                                  │
                                              vLLM Router (model/prefix/session/KV)
                                                                  │
                                       vLLM Engines (multi-model, LMCache, MIG GPU)
        ┌─────────────────────────────────────────────────────────┘
        ▼ 메트릭/트레이스/헤더
  Prometheus · Jaeger · DCGM · Fluent Bit
        ▼
  ┌──────────────────────────────────────────────┐
  │  FABRIX Endpoint (우리 제품)                   │
  │  G1 신원브로커 ← 사내DB/SI                      │
  │  G2 귀속·집계  G3 키/앱관리  G4 MIG효율         │
  │  G5 증적(→S3/ObjectScale)  G6 관제대시보드      │
  └──────────────────────────────────────────────┘
```

---

## 7. 확인 필요 / 리스크

- **유저 식별 방식 미확정** (R1): sessionId vs DB ID vs SI 토큰 중 무엇을 1차 키로? 사내 DB 스키마·연동 방식(API/직접 조회) **고객 확인 필요**.
- **MIG 운영 정책 미상**: MIG 프로파일(1g.10gb 등)·모델별 슬라이스 배치 기준 **확인 필요**. DCGM Exporter 도입 전제.
- **가드레일 탐지율**(4-3): 기본 26.7%/5.7%는 증권사 컴플라이언스 기준 미달 가능성 높음 → PoC에서 한국어 PII 보강 효과 **검증 필요**.
- **fluent 경로**: "SDS guardrail → fluent" 메모의 SDS가 무엇인지(사내 보안 시스템?) **확인 필요**.
- **증적 보관 요건**: 보존기간·불변성(WORM)·접근통제 수준 **고객 컴플라이언스 확인 필요**.
- vLLM Stack은 오픈소스 레퍼런스 — Dell AI Factory HW 종속 여부, 우리 온프렘 환경 적용성 **검증 필요**.

---

### 출처
- `docs/고객요구사항정리.md`
- `docs/h04711-vllm-production-stack-dell-ai-factory.pdf` (Dell H04711, 2026-05) — 페이지 인용 표기
- `docs/backendai-benchmark-report.md` (Backend.AI WebUI 벤치마킹)
