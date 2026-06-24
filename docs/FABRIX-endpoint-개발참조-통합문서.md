# FABRIX Endpoint — 개발 참조 통합 문서 (Single Source of Truth)

> **이 문서 하나로 개발에 착수**할 수 있도록, 그동안 생성·수집한 모든 자료를 통합한 개발 참조 문서다.
> **통합한 입력 자료**
> - `docs/고객요구사항정리.md` — 증권사向 인퍼런스 관제 요구(러프)
> - `docs/h04711-vllm-production-stack-dell-ai-factory.pdf` — 백엔드 기술 레퍼런스 (Dell H04711, 2026-05)
> - `docs/backendai-benchmark-report.md` — Backend.AI WebUI 기능·UI 벤치마킹
> - `docs/고객요구사항-vllm-개발매핑.md` — 요구사항↔기술 매핑
>
> **이 문서의 3대 산출물**: ① 가드레일 증적 데이터 스키마 ② 사용량 귀속 메트릭 라벨 설계 ③ 관제 대시보드 와이어프레임
> 작성일 2026-06-17 · 기준: vLLM Production Stack(H04711), Backend.AI 25.15

---

## MVP 착수 기준 (확정 사항)

> 사내 환경·프론트앱 구성이 미상이므로, **추정이 필요한 부분은 가장 마찰이 적고 나중에 재작업이 없는 선택**으로 고정한다. 아래는 추정이 아니라 **착수 시점의 결정(Decision)** 이다. 환경이 파악되면 enrichment만 추가하면 되고, 앞단(증적·메트릭·대시보드)은 바뀌지 않는다.

### D-1. 신원 모델 — sessionID 우선 (확정)

| 용도 | 1차 소스 | 위조 위험 | 비고 |
|------|----------|-----------|------|
| **세션 추적** (`user_ref`) | `x-user-id` = **sessionID** | 무관 (상관관계 핸들) | vLLM이 세션/KV-aware 라우팅에 이미 쓰는 헤더(PDF p41) → 추적 + 캐시 어피니티 동시 확보 |
| **앱 귀속** (`app_id`) | **API 키 → 앱 매핑** (1순위), `x-fabrix-app-id` (보조) | 키는 위조 불가 | 프론트가 헤더 못 실어도 키만 있으면 앱 귀속 성립 |
| **직원/부서** | (후속) sessionID → 사내 DB 매핑 | — | MVP에선 비워둠. 스키마가 이미 수용 |

**근거 / 왜 이게 정석인가**
- 업계 표준은 신원을 두 군데서 받음: ① **API 키**(과금·쿼터·보안의 1차 근거, 위조 불가 — OpenAI 호환 생태계·LiteLLM·Portkey·Kong 공통), ② **요청 식별 필드/헤더**(OpenAI `user` 필드처럼 귀속·세션 추적용).
- **클라이언트가 보낸 헤더는 신뢰하지 않는다**가 원칙: 보안·과금 신원은 게이트웨이가 키를 인증해 결정, `x-user-id`는 상관관계 핸들로만 사용. sessionID는 애초에 보안 클레임이 아니라 위조 우려가 무의미.
- 따라서 **보안/과금 = API 키**, **세션 추적 = `x-user-id`(sessionID)** 로 분리하는 것이 표준 구현이며, 우리도 그대로 따른다.

**재작업 없음 보장**: `user_identity.resolved_source='session_only'`, `employee_id=NULL`로 시작. 후속에 sessionID→직원 매핑만 채우면 직원/부서 귀속이 소급 적용됨(증적·메트릭·대시보드 구조 불변).

### D-2. 프론트앱 헤더 규약 (확정)

| 헤더 | MVP 필수 여부 | 없을 때 동작 |
|------|---------------|--------------|
| `Authorization: Bearer <key>` | **필수** | 없으면 401 (vLLM API Key 인증) |
| `x-user-id` (=sessionID) | **권장** | 없으면 세션 추적 불가 → `user_ref=null`, 라우팅은 load-balance로 폴백 |
| `x-fabrix-app-id` | 선택 | 없으면 **API 키→앱 매핑으로 대체** (앱 귀속 유지) |

> 프론트앱 수정 권한이 불확실하므로 **헤더 없이도 키만으로 앱 귀속이 되도록** 설계가 1순위. `x-user-id`/`x-fabrix-app-id`는 "있으면 더 정밀"한 보강.

### D-3. MVP 범위 동결

| 포함 (MVP) | 제외 (후속) |
|------------|-------------|
| sessionID 기반 세션 추적 | 직원/부서 소급 매핑 (사내 DB 연동 확정 후) |
| API 키 → 앱 귀속 | SI 토큰·DB ID 1차 키 |
| 가드레일 증적 (Part 2) | MIG 효율 스코어 (DCGM 도입 후, P2) |
| 사용량 귀속 집계 (Part 3, dept/app/key/model) | 커스텀 관제뷰 빌더 (P3) |
| 관제 대시보드·사용량 리포트·증적 뷰 (Part 4) | RAG 연동 (P3) |
| 한국어 PII 룰 1차 필터 (G7 일부) | — |

### D-4. 착수 전 단 하나 남은 확인 (블로커)
- **프론트앱이 sessionID를 `x-user-id`로 실어줄 수 있는가** (또는 우리가 게이트웨이에서 세션 쿠키→헤더 변환을 해줘야 하는가). → 못 실어주면 MVP는 **API 키 단위 추적만**으로 시작하고 세션 추적은 P1로 미룬다. 이 한 가지만 확인되면 착수 가능.

> 그 외 §6의 항목(SI 토큰, MIG 정책, 증적 보존기간, fluent/SDS)은 **MVP 블로커 아님** — 후속 단계에서 결정.

### D-5. 서빙·엔드포인트 관리 레이어 — NVIDIA Dynamo (확정)

엔드포인트(모델 배포) 관리는 **NVIDIA Dynamo**로 진행한다. Dynamo는 vLLM Production Stack의 자체 라우터(lmstack-router)를 **대체**하는 데이터센터급 분산 추론 서빙 프레임워크다. **추론 엔진은 vLLM을 그대로 유지**하고, 그 위 오케스트레이션/엔드포인트 관리만 Dynamo로 바꾼다.

**무엇이 바뀌나 (vLLM PS 라우터 → Dynamo)**
| 항목 | 변경 |
|------|------|
| 엔드포인트 정의 | Helm `modelSpec` → **`DynamoGraphDeployment` CRD** (K8s 선언적 리소스). 우리 콘솔이 이 CR을 CRUD |
| 라이프사이클 | **Dynamo Operator**가 CR 조정(원하는 상태 유지). 배포/설정/스케일 자동화 |
| 라우팅 | Dynamo **KV-aware Router**(대규모 GPU 플릿에 KV 캐시 중복 최소화) |
| 오토스케일 | Dynamo **SLO Planner**(SLO 기반 용량·prefill 모니터링 → GPU 조정). KEDA 대체 가능 |
| 분리 서빙 | **Disaggregated prefill/decode** + NIXL(저지연 KV 전송) 지원. 배포 패턴 `agg.yaml`(dev)/`agg_router.yaml`(prod)/`disagg_router.yaml`(고성능) |
| 모델 관리 | **Model Express**(선택적 모델 관리 엔드포인트) |

**무엇이 유지되나 (재작업 없음)**
- **가드레일**: vLLM Semantic Router가 **Dynamo 위에 설치 가능**(공식 지원) → `x-vsr-*` 헤더·증적 스키마(Part 2) **그대로**.
- **귀속 식별자**(D-1): sessionID/API키/app/model 축 불변. KV-aware 라우팅 어피니티는 Dynamo가 수행.
- **엔진 메트릭**: 워커가 vLLM이므로 엔진 레벨 메트릭 유지. 단 **라우터/플래너 메트릭 출처가 Dynamo로 바뀜**(§3 라벨 설계는 유지, 스크레이프 타깃만 교체).

**우리(FABRIX) 역할 재정의**: "키·앱 관리 콘솔"이 **엔드포인트 관리 콘솔**로 확장 — 모델 배포 = `DynamoGraphDeployment` CR 생성/수정(아키텍처 패턴 선택 포함), 상태/스케일은 Dynamo Operator·Planner에서 읽어 표시.

**확인 필요 (Dynamo 도입 전제)**
- Dynamo가 노출하는 **메트릭 이름·Prometheus 엔드포인트** (vLLM PS의 `vllm:*`와 동일/상이 여부) — §3 스크레이프 타깃 확정용.
- Semantic Router를 Dynamo 앞단(Envoy)에 두는 배포 토폴로지 검증 (vllm-semantic-router Dynamo 설치 가이드 기준).
- 온프렘 GPU(MIG)·멀티노드에서 Dynamo Operator 운영 요건.

---

## 목차
- [MVP 착수 기준 (확정 사항)](#mvp-착수-기준-확정-사항)
- [Part 0. 제품 정의 & 아키텍처](#part-0-제품-정의--아키텍처)
- [Part 1. 데이터 귀속 모델 (공통 토대)](#part-1-데이터-귀속-모델-공통-토대)
- [Part 2. ① 가드레일 증적 데이터 스키마](#part-2--가드레일-증적-데이터-스키마)
- [Part 3. ② 사용량 귀속 메트릭 라벨 설계](#part-3--사용량-귀속-메트릭-라벨-설계)
- [Part 4. ③ 관제 대시보드 와이어프레임](#part-4--관제-대시보드-와이어프레임)
- [Part 5. 컴포넌트/배포 구성](#part-5-컴포넌트배포-구성)
- [Part 6. 개발 백로그 & 확인 필요](#part-6-개발-백로그--확인-필요)
- [부록 A. vLLM 응답 헤더·메트릭 레퍼런스](#부록-a-vllm-응답-헤더메트릭-레퍼런스)

---

## Part 0. 제품 정의 & 아키텍처

**한 줄 정의**: FABRIX Endpoint = vLLM Production Stack(추론 백엔드) 위에 올라가는 **인퍼런스 거버넌스·관제 레이어**. 누가·어떤 앱·어떤 키·어떤 모델/GPU를 얼마나 잘 쓰는지 귀속하고, 가드레일 증적을 남기며, 입맛대로 관제한다.

**전체 데이터 흐름 (요청 1건의 생애)**
```
[프론트앱]  POST /v1/chat/completions
  Headers: Authorization: Bearer <api_key>
           x-user-id: <session/employee ref>
           x-fabrix-app-id: <app>            ← 우리가 규약화
        │
        ▼
[Envoy AI Gateway + Semantic Router]  ext_proc
   - PII 탐지   → x-vsr-pii-violation / x-vsr-pii-types
   - Jailbreak  → x-vsr-jailbreak-blocked / -confidence
   - Intent     → x-vsr-selected-category / x-vsr-selected-model
   ※ 차단 시 여기서 응답 종료(모델 미호출)
        │ (통과)
        ▼
[NVIDIA Dynamo]  KV-aware Router + SLO Planner (엔드포인트=DynamoGraphDeployment CRD)
        │         ※ vLLM PS 라우터 대체 (D-5)
        ▼
[vLLM Engine(s) = Dynamo workers]  multi-model · (disagg prefill/decode) · MIG GPU
        │
        ├─▶ 응답 스트림 (TTFT/ITL/tokens)
        │
   관측 채널 ─────────────────────────────────────────
   Prometheus(메트릭) · Jaeger(트레이스) · DCGM(MIG) · 가드레일 헤더
        │
        ▼
[FABRIX Endpoint]
   (A) 신원 브로커(MVP): api_key→앱귀속 + x-user-id(sessionID)→세션추적
        └ 직원/부서 매핑은 후속(사내 DB 연동 확정 시 소급 enrich)
   (B) 귀속·집계 엔진: (user×app×key×model×time) 롤업
   (C) 증적 파이프라인: 가드레일 이벤트 → Fluent Bit → ObjectScale(WORM)
   (D) 관제 대시보드 / 리포트 / 키·앱 관리 / MIG 효율
```

**관통 식별자 (모든 Part가 공유)** — 이 4개 차원이 증적·메트릭·대시보드를 잇는 축이다. (MVP 확정값은 [D-1](#d-1-신원-모델--sessionid-우선-확정) 참조)

| 차원 | 키 | 출처 (MVP 확정) | 비고 |
|------|----|------|------|
| 사용자 | `user_ref` | `x-user-id` = **sessionID** (직원/부서는 후속 매핑) | R1. 보안 클레임 아님, 상관관계 핸들 |
| 앱/프론트 | `app_id` | **API 키 → 앱 매핑** (1순위) / `x-fabrix-app-id` (보조) | R3,R6. 헤더 없어도 귀속 성립 |
| API 키 | `api_key_id` | `Authorization` Bearer → 키 메타(해시 매핑) | R4. **원문 키 저장 금지**, 해시·식별자만 |
| 모델 | `model` | 요청 `model` 필드 / `/v1/models` | R8 |

---

## Part 1. 데이터 귀속 모델 (공통 토대)

증적(Part2)과 메트릭(Part3)이 공유하는 마스터 데이터. **관계형 + 시계열** 하이브리드.

```
ORG (사내 DB/SI 미러)
  organization(dept_id PK, name, parent_dept_id, cost_center)
  employee(employee_id PK, dept_id FK, name_masked, status)

IDENTITY (G1 신원 브로커)  -- MVP: session_only로 시작, 직원/부서는 후속 소급 enrich
  user_identity(
    user_ref PK,          -- x-user-id = sessionID (해시 저장)
    employee_id FK NULL,  -- MVP에선 NULL. 사내 DB 연동 확정 후 채움
    resolved_source,      -- MVP='session_only' / (후속) 'internal_db'|'si_token'
    first_seen, last_seen)

ACCESS (G3 키/앱 관리)
  app(app_id PK, name, type,         -- chatbot|batch|opencode|agentic
      dept_id FK, owner_employee_id FK, created_at, status)
  api_key(api_key_id PK, app_id FK, model_scope, -- '*' or model name
      key_hash, quota_rpm, quota_tpd, enabled,
      created_at, revoked_at NULL)

MODEL (G... 카탈로그)
  model_registry(model PK, display_name, replica_count,
      routing_logic, mig_profile, status)
```
> **개인정보 처리 주의**(조직 보안지침): `name_masked`만 보관, `x-user-id`·API 키는 **해시/식별자**만. 원문 키·주민번호·계좌번호는 절대 저장 금지(가드레일에서 마스킹).

---

## Part 2. ① 가드레일 증적 데이터 스키마

> 충족 요구: R9(가드레일 결과 증적), 컴플라이언스(증권사). 원천: Semantic Router `x-vsr-*` 헤더(PDF p18-19). ⚠ 기본 탐지율 PII 26.7%·Jailbreak 5.7% → 한국어 PII 보강 전제(§6 G7).

### 2-1. 설계 원칙
- **불변(append-only, WORM)**: 증적은 수정·삭제 불가. ObjectScale/S3 Object Lock.
- **민감정보 비저장**: 탐지된 PII 원문은 저장 금지. **유형·위치·마스킹 샘플**만.
- **차단/통과 모두 기록**: 통과도 "검사했고 깨끗" 증적 가치 있음(샘플링 가능).
- **추적 연결**: `trace_id`로 Jaeger·메트릭과 조인.

### 2-2. 증적 레코드 스키마 (JSON, 1 이벤트 = 1 라인 JSONL)

```jsonc
{
  "event_id": "uuid-v7",              // 시간정렬 가능 UUID
  "ts": "2026-06-17T13:22:41.123Z",   // UTC, Asia/Seoul 변환은 표시단
  "trace_id": "jaeger-trace-id",      // 분산추적 조인 키
  "request_id": "vllm-req-id",

  // ── 귀속 차원 (Part1 공통) ──
  "user_ref": "sha256:...",           // 해시
  "employee_id": "E12345",            // 매핑 안 되면 null
  "dept_id": "D-SEC-IB",
  "app_id": "wm-advisor-chatbot",
  "api_key_id": "key_0a1b",
  "model": "Qwen/Qwen3-30B-A3B",

  // ── 가드레일 판정 ──
  "guard": {
    "decision": "blocked",            // blocked | allowed | flagged
    "stage": "pre_model",             // ext_proc 단계
    "checks": [
      {
        "type": "pii",                // pii | jailbreak | intent
        "violation": true,
        "subtypes": ["I-PERSON","KR-RRN","KR-ACCOUNT"], // 한국형 추가
        "confidence": 0.98,
        "detector": "kr-rule+mmbert32k-pii",
        "masked_sample": "홍**, 주민번호 ******-*******", // 마스킹만
        "match_count": 2
      },
      {
        "type": "jailbreak",
        "violation": false,
        "confidence": 0.12,
        "detector": "mmbert32k-jailbreak"
      }
    ],
    "selected_category": "finance",   // intent 분류 (x-vsr-selected-category)
    "selected_model": "finance-expert"
  },

  // ── 컨텍스트 ──
  "client_ip_masked": "10.20.x.x",
  "prompt_tokens": 312,
  "policy_version": "guard-2026.06",  // 적용 정책 버전(증적 재현용)
  "action_taken": "content_filter_refusal" // 차단 시 사용자에 반환된 동작
}
```

### 2-3. 헤더 → 필드 매핑 (수집 규칙)

| vLLM/Envoy 응답 헤더 | 증적 필드 | 변환 |
|----------------------|-----------|------|
| `x-vsr-pii-violation` | `checks[pii].violation` | bool |
| `x-vsr-pii-types` | `checks[pii].subtypes` | CSV→배열, 한국형 룰 결과 머지 |
| `x-vsr-jailbreak-blocked` | `checks[jailbreak].violation` | bool |
| `x-vsr-jailbreak-confidence` | `checks[jailbreak].confidence` | float |
| `x-vsr-selected-category` | `guard.selected_category` | str |
| `x-vsr-selected-model` | `guard.selected_model` | str |
| (게이트웨이 차단 응답) | `guard.decision`, `action_taken` | refusal 감지 |

### 2-4. 조회용 인덱스 (분석 DB 적재 시, 예: ClickHouse/PostgreSQL)
```sql
-- 원본은 ObjectScale(WORM), 조회 미러는 컬럼스토어
CREATE TABLE guard_audit (
  event_id      UUID,
  ts            DateTime64(3),
  trace_id      String,
  user_ref      String,
  employee_id   Nullable(String),
  dept_id       LowCardinality(String),
  app_id        LowCardinality(String),
  api_key_id    LowCardinality(String),
  model         LowCardinality(String),
  decision      LowCardinality(String),  -- blocked|allowed|flagged
  guard_types   Array(String),           -- ['pii','jailbreak']
  pii_subtypes  Array(String),
  jb_confidence Float32,
  policy_version LowCardinality(String)
) ENGINE = MergeTree
ORDER BY (ts, dept_id, app_id);
-- 주요 조회: 부서별/앱별 차단 추이, PII 유형 분포, 특정 user_ref 이력
```

### 2-5. 보존·증적 요건 (확인 필요 §6)
- 보존기간(예: 3년/5년), Object Lock 모드(Governance vs Compliance), 접근 감사 로그 필요.
- 증적 레코드 자체에 `policy_version`을 박아 **사후 재현성** 확보.

### 2-6. audit-ingestor 의사코드 (헤더 → 증적 정규화 → 적재)

> 역할(G5): 게이트웨이/라우터가 남긴 가드레일 결과를 **2-2 스키마로 정규화 → sessionID 해시 → Fluent Bit → ObjectScale(WORM) + ClickHouse 미러** 적재.
> 배치 위치: Envoy `ext_proc` access-log 또는 라우터 응답 후크에서 이벤트 수신(스트리밍). 모델 호출 핫패스를 막지 않도록 **비동기**.

```python
# audit_ingestor.py — 핵심 의사코드 (실제 구현은 async 큐 + 배치 flush)
import hashlib, uuid

# 환경 상수
HASH_SALT       = env("FABRIX_USER_HASH_SALT")     # 회전 가능, KMS 보관
POLICY_VERSION  = env("FABRIX_GUARD_POLICY_VER")   # 예: "guard-2026.06"
SAMPLE_ALLOWED  = float(env("AUDIT_ALLOWED_SAMPLE", "0.05"))  # 통과 이벤트 샘플링 5%

def hash_user(x_user_id: str | None) -> str | None:
    # D-1: x-user-id = sessionID. 원값 저장 금지 → salted SHA-256
    if not x_user_id:
        return None
    return "sha256:" + hashlib.sha256((HASH_SALT + x_user_id).encode()).hexdigest()

def resolve_app(api_key_id: str, x_app_id: str | None) -> str:
    # D-2: app_id는 API키→앱 매핑이 1순위, 헤더는 보조
    return app_from_key(api_key_id) or x_app_id or "unknown"

def parse_pii(headers) -> dict | None:
    if headers.get("x-vsr-pii-violation", "false") != "true":
        # 통과 PII 체크도 '검사함' 증적 가치 → 호출측에서 샘플링 결정
        return {"type": "pii", "violation": False}
    subtypes = split_csv(headers.get("x-vsr-pii-types"))      # I-PERSON,...
    subtypes += kr_pii_rule_hits(headers.get("x-fabrix-pii-kr"))  # G7 한국형 룰 결과 머지(주민/계좌/여권)
    return {
        "type": "pii", "violation": True,
        "subtypes": dedupe(subtypes),
        "confidence": to_float(headers.get("x-vsr-pii-confidence")),
        "detector": "kr-rule+mmbert32k-pii",
        # ⚠ 원문 PII 저장 금지 — 마스킹 샘플만(업스트림에서 마스킹된 값)
        "masked_sample": headers.get("x-fabrix-masked-sample"),
        "match_count": to_int(headers.get("x-fabrix-pii-count")),
    }

def parse_jailbreak(headers) -> dict:
    return {
        "type": "jailbreak",
        "violation": headers.get("x-vsr-jailbreak-blocked", "false") == "true",
        "confidence": to_float(headers.get("x-vsr-jailbreak-confidence")),
        "detector": "mmbert32k-jailbreak",
    }

def build_event(req, resp_headers) -> dict | None:
    pii = parse_pii(resp_headers)
    jb  = parse_jailbreak(resp_headers)
    blocked = pii["violation"] or jb["violation"]

    # 통과(allowed)는 샘플링하여 볼륨 제어 (차단/flagged는 항상 기록)
    if not blocked and not sampled(SAMPLE_ALLOWED):
        return None

    api_key_id = key_id_from_bearer(req.headers.get("authorization"))  # 해시→ID, 원문 미보관
    return {
        "event_id":   str(uuid7()),
        "ts":         now_utc_iso(),                     # 표시단에서 Asia/Seoul 변환
        "trace_id":   resp_headers.get("x-trace-id") or req.trace_id,
        "request_id": resp_headers.get("x-request-id"),
        # 귀속 차원 (Part 1)
        "user_ref":    hash_user(req.headers.get("x-user-id")),
        "employee_id": None,                             # MVP: NULL (D-1, 후속 enrich)
        "dept_id":     dept_from_app(resolve_app(api_key_id, req.headers.get("x-fabrix-app-id"))),
        "app_id":      resolve_app(api_key_id, req.headers.get("x-fabrix-app-id")),
        "api_key_id":  api_key_id,
        "model":       req.json.get("model"),
        # 가드레일 판정
        "guard": {
            "decision": "blocked" if blocked else "allowed",
            "stage": "pre_model",
            "checks": [c for c in (pii, jb) if c],
            "selected_category": resp_headers.get("x-vsr-selected-category"),
            "selected_model":    resp_headers.get("x-vsr-selected-model"),
        },
        "client_ip_masked": mask_ip(req.client_ip),
        "prompt_tokens":    to_int(resp_headers.get("x-prompt-tokens")),
        "policy_version":   POLICY_VERSION,
        "action_taken":     "content_filter_refusal" if blocked else None,
    }

def on_request_complete(req, resp_headers):           # 비동기 후크
    ev = build_event(req, resp_headers)
    if ev is None:
        return
    audit_queue.put(ev)                               # 핫패스 비차단

# 백그라운드 플러시: 2경로 동시 적재
def flush_loop():
    for batch in audit_queue.drain(max=500, every="2s"):
        fluentbit_emit_jsonl(batch)        # → ObjectScale(WORM, Object Lock) 불변 원본
        clickhouse_insert(batch, "guard_audit")  # → 조회 미러(2-4)
```

**Fluent Bit 경로 (R9 "fluent로 송출")** — DaemonSet/사이드카가 JSONL을 받아 라우팅:
```ini
# fluent-bit.conf (요지)
[INPUT]   Name forward            # audit-ingestor가 forward 프로토콜로 push
[FILTER]  Name record_modifier    # 누락 필드 방어, ts 표준화
[OUTPUT]  Name s3                  # → ObjectScale (S3 호환), Object Lock 버킷
          bucket  fabrix-guard-audit
          use_put_object On        # 객체 단위 PUT(불변)
[OUTPUT]  Name http                # (옵션) 사내 보안시스템 "SDS"로 메트릭/이벤트 — 포맷 확인 필요(§6)
```

**불변·민감정보 가드(반드시 준수)**
- `x-user-id`(sessionID)·API 키는 **해시/ID만**. 원문 절대 미저장.
- 탐지된 PII 원문 미저장 — `masked_sample`은 **업스트림에서 이미 마스킹된 값**만 수신.
- ObjectScale은 **Object Lock(WORM)** 버킷, ClickHouse는 조회용 가변 미러(원본 아님).
- `policy_version` 포함 → 어떤 정책으로 판정했는지 사후 재현.

---

## Part 3. ② 사용량 귀속 메트릭 라벨 설계

> 충족 요구: R2(TTFT/사용량)·R3(프론트 귀속)·R4(API키)·R5(프록시)·R6(앱)·R7(GPU/MIG). 원천: Prometheus(PDF p23-24), KEDA 트리거 메트릭, DCGM(MIG는 추가).

### 3-1. 라벨 표준 (모든 시계열 공통 차원)
귀속의 핵심은 **고카디널리티 사람·앱 라벨을 어디서 붙이느냐**다. vLLM 엔진 메트릭에는 `user_ref`가 없으므로 **두 경로**로 나눈다.

| 라벨 | 카디널리티 | 어디서 부여 | 비고 |
|------|------------|-------------|------|
| `dept_id` | 낮음 | 라우터/게이트웨이 relabel | 부서 롤업 |
| `app_id` | 낮음 | `x-fabrix-app-id` | 안전 라벨 |
| `api_key_id` | 중간 | 키 해시→ID 매핑 | 원문 키 금지 |
| `model` | 낮음 | 엔진 라벨 | 기본 제공 |
| `routing_logic` | 낮음 | Dynamo KV-aware router (D-5) | round-robin/prefix/session/kv |
| `mig_profile` | 낮음 | DCGM 라벨 | 1g.10gb 등 |
| `user_ref` | **높음** | **메트릭 금지 → 트레이스/증적에만** | 카디널리티 폭발 방지 |

> **원칙**: 사람 단위(`user_ref`) 집계는 **메트릭이 아니라 트레이스·증적 기반 배치 롤업**으로. 메트릭 라벨엔 `dept_id`/`app_id`/`api_key_id`까지만.

### 3-2. 채택 메트릭 (PDF Grafana 인사이트 p24 → 우리 패널 소스)

| 메트릭(원천) | 의미 | 패널 |
|--------------|------|------|
| `vllm:time_to_first_token_seconds`(histogram) | **TTFT** 분포 | 품질 |
| `vllm:time_per_output_token_seconds` | ITL | 품질 |
| `vllm:num_requests_running` | 실행 요청수(=KEDA 트리거) | 용량 |
| `vllm:num_requests_waiting` | 대기 요청수(=HPA 트리거) | 용량 |
| `vllm:gpu_cache_usage_perc` | GPU KV cache 사용률 | GPU |
| `vllm:gpu_prefix_cache_hit_rate` | prefix/KV 캐시 hit rate | 성능(캐시 효과) |
| `vllm:request_success_total` / `_total` | QPS·성공률 | 트래픽 |
| `vllm:e2e_request_latency_seconds` | 요청 지연 | 품질 |
| `DCGM_FI_PROF_GR_ENGINE_ACTIVE` 등 | GPU/MIG 점유 | GPU/MIG (DCGM 추가) |

### 3-3. Prometheus relabel — 귀속 라벨 주입

**(a) 게이트웨이/라우터 메트릭에 app/dept/key 라벨 부여**
요청 헤더는 메트릭에 자동 안 붙으므로, Envoy/라우터가 **헤더값을 메트릭 라벨로 내보내도록** 구성(ext_proc에서 라벨 emit) 후 스크레이프에서 정규화.

```yaml
# prometheus scrape_config 예시 — 라우터/게이트웨이 잡
scrape_configs:
  - job_name: "vllm-router"
    kubernetes_sd_configs: [{ role: pod }]
    relabel_configs:
      # 네임스페이스 고정
      - source_labels: [__meta_kubernetes_namespace]
        regex: "vllm-prod-stack"
        action: keep
      # 파드 라벨 app → app_id (프론트앱이 deploy 라벨로 심은 경우)
      - source_labels: [__meta_kubernetes_pod_label_fabrix_app_id]
        target_label: app_id
      - source_labels: [__meta_kubernetes_pod_label_fabrix_dept_id]
        target_label: dept_id
    metric_relabel_configs:
      # 엔진이 노출한 model 라벨 정규화(레지스트리/태그 제거)
      - source_labels: [model_name]
        target_label: model
      # 고카디널리티 라벨 드랍 (user_ref가 실수로 붙는 경우 차단)
      - regex: "user_ref|session_id|raw_api_key"
        action: labeldrop
```

**(b) DCGM(MIG) 잡 — mig_profile 라벨 유지**
```yaml
  - job_name: "dcgm-exporter"
    kubernetes_sd_configs: [{ role: pod }]
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        regex: "dcgm-exporter"
        action: keep
    metric_relabel_configs:
      # DCGM가 노출하는 GPU_I_PROFILE(MIG 슬라이스)를 mig_profile로
      - source_labels: [GPU_I_PROFILE]
        target_label: mig_profile
      - source_labels: [Hostname]
        target_label: node
```

**(c) 사람/앱별 정밀 귀속은 트레이스에서 배치 롤업**
```
Jaeger/OTel span attributes:
  fabrix.user_ref, fabrix.app_id, fabrix.api_key_id, fabrix.model,
  gen_ai.usage.prompt_tokens, gen_ai.usage.completion_tokens,
  gen_ai.latency.time_to_first_token
  → 배치 작업이 (user×app×key×model×시간버킷) 집계 → 귀속 리포트 테이블 적재
```

### 3-4. MIG 효율 스코어 (R7 "얼마나 잘 잘랐나" — 우리가 정의)
```
mig_alloc_efficiency = Σ(슬라이스 실제 점유시간 × 점유율)
                       ─────────────────────────────────────
                       Σ(슬라이스 할당시간 × 100%)

판정: ≥0.7 양호 / 0.4~0.7 재검토 / <0.4 과할당(슬라이스 낭비)
입력: DCGM_FI_PROF_GR_ENGINE_ACTIVE(점유) vs 할당 슬라이스 시간
```

### 3-5. 집계 테이블 (귀속 리포트 소스)
```sql
CREATE TABLE usage_rollup (
  bucket        DateTime,            -- 5분/1시간 버킷
  dept_id       LowCardinality(String),
  app_id        LowCardinality(String),
  api_key_id    LowCardinality(String),
  model         LowCardinality(String),
  req_count     UInt64,
  prompt_tokens UInt64,
  completion_tokens UInt64,
  ttft_p50_ms   Float32,
  ttft_p95_ms   Float32,
  itl_avg_ms    Float32,
  error_count   UInt64
) ENGINE = SummingMergeTree
ORDER BY (bucket, dept_id, app_id, api_key_id, model);
-- user_ref 단위는 별도 user_usage_rollup (트레이스 롤업, 보존기간 짧게)
```

---

## Part 4. ③ 관제 대시보드 와이어프레임

> 충족 요구: R10(입맛대로 관제) + 전체 가시화. UX 패턴은 Backend.AI 벤치마킹(대시보드 3단 카드·기간선택·패널 새로고침·전역헤더) 채택.

### 4-0. 전역 레이아웃 (Backend.AI 헤더 패턴 차용)
```
┌──────────────────────────────────────────────────────────────────────┐
│ FABRIX  [부서/프로젝트 ▼]   🔍검색      🔔알림  ◐테마  ⚙   👤관리자 ▼ │
├───────────┬──────────────────────────────────────────────────────────┤
│ ◈ 관제     │                                                          │
│ ◈ 사용량   │                  (콘텐츠 영역)                            │
│ ◈ 가드레일 │                                                          │
│ ◈ 모델     │                                                          │
│ ◈ GPU/MIG │                                                          │
│ ◈ 키·앱   │                                                          │
│ ◈ 트래픽   │                                                          │
│ ◈ 설정     │                                                          │
└───────────┴──────────────────────────────────────────────────────────┘
```

### 4-1. 관제 대시보드 (메인) ★MVP
```
┌─ 관제 대시보드 ───────────────────  기간: [최근 1시간 ▼]  [↻ 전체]─┐
│                                                                      │
│ ┌── 실시간 트래픽 ──┐ ┌── 응답 품질 ──┐ ┌── 가드레일 ──┐ ┌─ GPU ─┐│
│ │ QPS      12.4    │ │ TTFT p50 103ms│ │ 차단(1h) 37 │ │사용 72%││
│ │ 실행중   148     │ │ TTFT p95 131ms│ │ PII   24   │ │KV   58%││
│ │ 대기     3       │ │ ITL avg  18ms │ │ JB     2   │ │MIG eff ││
│ │ 성공률   99.6%   │ │ 캐시hit  64%  │ │ flagged 11 │ │ 0.71  ││
│ └──────────────────┘ └───────────────┘ └─[증적보기]─┘ └────────┘│
│                                                                      │
│ ┌── 부서별 사용량 (Top) ─────────┐ ┌── 앱별 요청 분포 ──────────┐ │
│ │ IB본부    ███████████ 42%      │ │ wm-chatbot   ████████ 38%  │ │
│ │ 리테일    ███████ 27%          │ │ batch-report ████ 19%      │ │
│ │ 리서치    █████ 18%            │ │ opencode     ███ 14%       │ │
│ │ 컴플라이언스 ██ 8%             │ │ agentic-ai   ██ 9% ...     │ │
│ └────────────────────────────────┘ └────────────────────────────┘ │
│                                                                      │
│ ┌── 시계열: QPS / TTFT / 차단건수 (겹쳐보기) ──────────────────┐  │
│ │  [라인차트, 좌축 QPS·우축 ms, 차단은 막대]                    │  │
│ └──────────────────────────────────────────────────────────────┘  │
│  ⚠ 알람: [IB본부 TTFT p95 > 500ms]  [agentic-ai 키 쿼터 90%]        │
└──────────────────────────────────────────────────────────────────┘
```
- 카드는 Backend.AI "할당/한도/그룹" 3단 패턴 → 우리는 "트래픽/품질/가드레일/GPU" 4카드.
- 모든 카드 **드릴다운**: 부서→앱→키→모델→개별 트레이스.

### 4-2. 사용량·귀속 리포트 ★MVP
```
┌─ 사용량 리포트 ──────────  기간:[2026-06-01~06-17]  [CSV 내보내기]─┐
│ 그룹기준: [부서 ▼][앱][API키][모델]   필터: dept=IB  app=*         │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ 부서   │ 앱        │ 모델      │ 요청   │토큰(in/out)│TTFT p95│ │
│ ├──────────────────────────────────────────────────────────────┤ │
│ │ IB본부 │ wm-chatbot│ qwen3-30B │ 12,403 │ 3.2M/1.1M  │ 128ms  │ │
│ │ IB본부 │ batch-rpt │ gemma-4   │  2,910 │ 8.7M/0.4M  │ 540ms  │ │
│ │ 리테일 │ wm-chatbot│ qwen3-30B │  9,021 │ 2.1M/0.9M  │ 119ms  │ │
│ └──────────────────────────────────────────────────────────────┘ │
│ [▸ user_ref 단위 펼치기] (권한 필요·민감)                          │
└──────────────────────────────────────────────────────────────────┘
```

### 4-3. 가드레일 증적 ★MVP (증권사 핵심)
```
┌─ 가드레일 증적 ───────────  [blocked▼][PII▼] 기간:[오늘]  [내보내기]┐
│ 요약: 검사 9,210 · 차단 37 · PII 24 · Jailbreak 2 · flagged 11      │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ 시각      │부서 │앱        │유형      │신뢰도│동작     │상세  │ │
│ ├──────────────────────────────────────────────────────────────┤ │
│ │13:22:41  │IB  │wm-chatbot│PII:KR-RRN│0.98  │차단(거부)│[▸]  │ │
│ │13:19:02  │리테일│opencode │Jailbreak │1.00  │차단      │[▸]  │ │
│ │13:05:55  │리서치│agentic  │PII:계좌  │0.91  │마스킹    │[▸]  │ │
│ └──────────────────────────────────────────────────────────────┘ │
│ 상세[▸]: trace_id·정책버전·마스킹샘플(원문 비표시)·연결 트레이스   │
│  ⓘ 증적은 변경 불가(WORM). 보존 N년.                               │
└──────────────────────────────────────────────────────────────────┘
```

### 4-4. GPU/MIG 효율
```
┌─ GPU / MIG 효율 ─────────────────────────────  [노드 전체 ▼]──────┐
│ 노드 dell-xe9680-01                                                 │
│  GPU0 ┌1g.10gb┐┌1g.10gb┐┌2g.20gb──┐┌3g.40gb────┐                  │
│       │ 88% ● ││ 12% ◐ ││  74% ●   ││  remain     │  eff 0.71      │
│       └───────┘└───────┘└──────────┘└────────────┘                 │
│  → 슬라이스 #2(12%) 과할당 경고: 통합/재배치 권장                   │
│ ┌── MIG 효율 추이 ──┐ ┌── 슬라이스별 점유 히트맵 ──┐                │
│ └───────────────────┘ └──────────────────────────────┘             │
└──────────────────────────────────────────────────────────────────┘
```

### 4-5. 트래픽/프록시 뷰 (Jaeger 임베드)
```
┌─ 트래픽 추적 ───────────────────────────────────────────────────┐
│ client → router → engine  (요청 1건 span 타임라인)               │
│  ├ gateway(ext_proc guard)  4ms                                  │
│  ├ router(prefix-aware)     1ms                                  │
│  └ engine(qwen3-30B)  TTFT 102ms ─ decode 1.8s                   │
│ [Jaeger 전체 트레이스 열기]   프록시 오버헤드: ~0ms (검증치 p14)  │
└──────────────────────────────────────────────────────────────────┘
```

### 4-6. 엔드포인트·키·앱 관리 / 설정
- **엔드포인트 관리 (Dynamo, D-5)**: 모델 배포 = **`DynamoGraphDeployment` CR 생성/수정**. 배포 패턴 선택(`agg`/`agg_router`/`disagg_router`), replica·MIG프로파일·라우팅, 상태·스케일은 Dynamo Operator·SLO Planner에서 조회. `/v1/models`로 노출 모델 확인.
- **키·앱 관리**: per-model 키 발급·회수·쿼터(rpm/tpd), 앱↔키↔부서 매핑. (Backend.AI Credentials 패턴)
- **설정**: (후속)사내 DB 신원 매핑 규칙, 가드레일 정책(임계치·한국어 PII 룰), 알람 임계치, 관제뷰 빌더(R10).

---

## Part 5. 컴포넌트/배포 구성

```
namespace: vllm-prod-stack (백엔드)  /  fabrix-system (우리)

[백엔드 - NVIDIA Dynamo (서빙·엔드포인트 관리, D-5) + vLLM 엔진]
  envoy-ai-gateway + semantic-router   (가드레일·intent, Dynamo 앞단)
  dynamo-operator                      (DynamoGraphDeployment/Component CR 조정)
  dynamo KV-aware router + SLO planner (라우팅·오토스케일, lmstack-router/KEDA 대체)
  vllm-engine x N = Dynamo workers     (modelSpec→CR, disagg prefill/decode, MIG)
  NIXL                                 (GPU간 저지연 KV 전송)
  prometheus + grafana + prometheus-adapter
  jaeger(collector/query) + otel-collector
  ※ 엔드포인트 생성/수정 = DynamoGraphDeployment CR (우리 콘솔이 K8s API로 CRUD)

[추가 수집기]
  dcgm-exporter            (MIG/GPU 메트릭)        ← G4
  fluent-bit (DaemonSet)   (가드레일 증적 → ObjectScale) ← G5

[FABRIX Endpoint - 우리]
  identity-broker  (사내 DB/SI 커넥터)             ← G1
  rollup-worker    (트레이스→귀속 집계 배치)        ← G2
  audit-ingestor   (헤더→증적 스키마 정규화)        ← G5
  api (BFF) + web  (대시보드/리포트/관리 콘솔)      ← C/D
  store: ClickHouse(분석미러) + PostgreSQL(마스터) + ObjectScale(WORM 증적)
```

**API 규약(우리가 프론트앱에 요구할 것)**
- 헤더 ([D-2](#d-2-프론트앱-헤더-규약-확정)): `Authorization: Bearer <key>`(필수) · `x-user-id`=sessionID(권장) · `x-fabrix-app-id`(선택, 키매핑으로 대체 가능)
- 모델 호출은 OpenAI 호환(`/v1/chat/completions`, `/v1/completions`, `/v1/models`) — 라우터 단일 엔드포인트.

### 5-1. 배포 템플릿 (초안, `docs/templates/`)

> ⚠ 모든 템플릿은 **초안**. Dynamo CRD 필드명은 설치 버전별로 다르므로 배포 전 부록 B의 공식 문서로 키 재확인.

**엔드포인트 (DynamoGraphDeployment, D-5)** — 3개 패턴
| 패턴 | 파일 | 용도 |
|------|------|------|
| 집약(agg) | [dynamo-agg.yaml](templates/dynamo-agg.yaml) | 개발/테스트, 단일 워커(prefill+decode) |
| 집약+라우터(agg_router) | [dynamo-agg-router.yaml](templates/dynamo-agg-router.yaml) | 프로덕션, 다중 replica + KV-aware 세션 라우팅(`x-user-id`) + SLO Planner |
| 분리(disagg_router) | [dynamo-disagg-router.yaml](templates/dynamo-disagg-router.yaml) | 고성능, prefill/decode 분리 + NIXL, 긴 입력(RAG) |

공통: `Frontend`(OpenAI 호환 진입점) + `VllmWorker`(엔진), PowerScale PVC로 가중치 로드, `--served-model-name`이 `/v1/models` 노출명, FABRIX 귀속 라벨(`fabrix.app_id`/`fabrix.dept_id`)로 §3 relabel 연결.

**세션쿠키 → x-user-id (D-4 대안)** — [envoy-session-cookie-to-xuserid.yaml](templates/envoy-session-cookie-to-xuserid.yaml)
- 프론트앱이 `x-user-id`를 못 실을 때, **게이트웨이가 세션 쿠키를 읽어 헤더 주입**. Lua 필터.
- **배치 순서**: ext_proc(가드레일)·라우터 **앞**에 둬야 증적·세션 라우팅이 동일 sessionID를 봄.
- 이미 `x-user-id`가 있으면 존중, 쿠키도 없으면 무주입(`user_ref=null` 폴백). 게이트웨이 종류별 래퍼(A: Envoy Gateway / B: Istio / C: 순수 Envoy) 제공 — 어느 것인지 §6 확인.

---

## Part 6. 개발 백로그 & 확인 필요

### 6-1. 로드맵 (Gap → 화면 매핑)
| 단계 | 항목 | Gap | 화면 |
|------|------|-----|------|
| **MVP** | 신원브로커·귀속집계·증적·관제대시보드·사용량리포트·증적뷰 | G1,G2,G5 | 4-1,4-2,4-3 |
| **P1** | 키·앱 관리, 모델 카탈로그, 한국어 PII 보강 | G3,G7 | 4-6 |
| **P2** | GPU/MIG(DCGM), 트래픽·프록시 뷰, 스케일 UI | G4,G6 | 4-4,4-5 |
| **P3** | 관제뷰 빌더, 채팅 Playground, RAG 연동 | G6 | 4-6 |

### 6-2. 확인 필요

**✅ 확정됨 (MVP 착수 기준 §D 참조)**
- 유저 1차 키 → **sessionID** (`x-user-id`). 직원/부서는 후속 소급 enrich. [D-1]
- 앱 귀속 → **API 키 매핑** 1순위, 헤더는 보조. [D-1/D-2]

**⏳ 착수 직전 단 하나 (MVP 블로커)**
- **프론트앱이 sessionID를 `x-user-id`로 실을 수 있는가?** 못 하면 MVP는 **키 단위 추적만**으로 시작하고 세션 추적은 P1로. (게이트웨이에서 세션쿠키→헤더 변환 대안 검토) [D-4]

**🔜 후속 단계 결정 (MVP 블로커 아님)**
1. **사내 DB 연동 방식** (REST/직접/배치 동기화) — 직원/부서 enrich 시점.
2. **"SDS"** 의미: 가드레일→fluent의 SDS = 사내 보안 시스템? 송출 포맷·수신처?
3. **MIG 정책**: 프로파일·모델별 슬라이스 배치 기준. DCGM 도입 승인 (P2).
4. **증적 보존 요건**: 기간·Object Lock 모드·접근감사 — 컴플라이언스 확정.
5. **가드레일 기준**: 기본 탐지율(PII 26.7%/JB 5.7%) 부족 → 한국어 PII 룰·임계치 PoC.
6. **온프렘 적용성**: vLLM Stack의 Dell HW 종속(PowerScale/DCGM) vs 우리 환경.

### 6-3. 리스크
- **카디널리티 폭발**: `user_ref`를 메트릭에 붙이면 Prometheus 폭주 → 트레이스/증적 경로로 분리(§3-1) 반드시 준수.
- **가드레일 우회**: 기본 모델 간접/맥락 공격 취약 → 룰+ML 2단, 정책버전 관리.
- **개인정보**: 증적·메트릭에 원문 PII/키 저장 금지(조직 보안지침). 마스킹·해시 일관 적용.

---

## 부록 A. vLLM 응답 헤더·메트릭 레퍼런스

**Semantic Router 헤더 (PDF p17-19)**
| 헤더 | 의미 |
|------|------|
| `x-vsr-selected-category` | intent 분류 결과(math/physics/finance…) |
| `x-vsr-selected-model` | 선택된 expert 모델 |
| `x-vsr-selected-confidence` | 분류 신뢰도 |
| `x-vsr-pii-violation` / `x-vsr-pii-types` | PII 위반 여부 / 유형 |
| `x-vsr-jailbreak-blocked` / `x-vsr-jailbreak-confidence` | jailbreak 차단 / 신뢰도 |

**API Key 구성 (PDF p19-20)**: `vllmApiKey` — ① servingEngineSpec(전 모델 공통) ② modelSpec별(모델 전용) ③ routerSpec(라우터 레벨). Bearer 인증, 미인증 시 `{"error":"Unauthorized"}`.

**라우팅 로직 (PDF p39-41)**: `routerSpec.routingLogic` = `roundrobin` | `session`(sessionKey: x-user-id) | `prefixaware` | `kvaware`(lmcacheControllerPort).

**오토스케일 (PDF p26)**: KEDA ScaledObject, 트리거 `vllm:num_requests_running`, min/max replica, cooldown 5분(GPU 로딩 시간 고려).

**캐시 성능 실측 (PDF p43, 표7)**: KV offload 시 평균 TTFT **342.9→102.3ms (-70.2%)**, 멀티턴 공유 prompt 기준.

**참조 HW (PDF 표2)**: Mgmt 4×PowerEdge R670 / Compute XE7740·XE9680 / Storage PowerScale F710 / vLLM·LangChain·PyTorch.

---

## 부록 B. NVIDIA Dynamo 레퍼런스 (엔드포인트 관리, D-5)

**정의**: 데이터센터급 오픈소스 분산 추론 서빙 프레임워크. vLLM/SGLang/TensorRT-LLM 엔진을 라우팅·KV-aware 스케줄링이 있는 멀티노드 시스템으로 오케스트레이션.

**핵심 컴포넌트**
| 컴포넌트 | 역할 |
|----------|------|
| KV-aware Router | 대규모 GPU 플릿에 트래픽 분배, 중복 KV 캐시 재계산 최소화 |
| SLO Planner | 용량·prefill 모니터링 → SLO 충족 위해 GPU 리소스 조정(오토스케일) |
| NIXL | GPU간·이종 메모리/스토리지간 저지연 KV 캐시 전송 라이브러리 |
| Dynamo Operator | `DynamoGraphDeployment`/`DynamoComponentDeployment` CR 조정(라이프사이클 자동화) |
| Model Express | (선택) 모델 관리 엔드포인트 |

**K8s 배포 패턴**: `agg.yaml`(dev/test) · `agg_router.yaml`(prod, 로드밸런싱) · `disagg_router.yaml`(고성능, prefill/decode 분리).

**우리 연동**: 엔드포인트 CRUD = `DynamoGraphDeployment` CR을 K8s API로 조작. Semantic Router(가드레일)는 Dynamo 앞단 설치 지원.

**출처**
- [NVIDIA Dynamo (제품)](https://www.nvidia.com/en-us/ai/dynamo/) · [개발자 페이지](https://developer.nvidia.com/dynamo) · [GitHub ai-dynamo/dynamo](https://github.com/ai-dynamo/dynamo)
- [Dynamo Operator 문서](https://docs.nvidia.com/dynamo/latest/kubernetes/dynamo_operator.html) · [K8s 배포 가이드](https://docs.nvidia.com/dynamo/latest/kubernetes-deployment/deployment-guide)
- [vLLM Semantic Router — Dynamo 설치 가이드](https://vllm-semantic-router.com/docs/v0.1/installation/k8s/dynamo/)
- ⚠ Dynamo 메트릭 이름/Prometheus 엔드포인트는 §3 스크레이프 타깃 확정 시 공식 문서 재확인 필요.
