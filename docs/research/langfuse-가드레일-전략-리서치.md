# Langfuse 가드레일 전략 리서치 — 교차검증 & 통신 흐름 설계

> 질문: "지금은 Semantic Router 로 jailbreak 등을 막는데, **Langfuse 가 제공하는 가드레일 기술(Python SDK)** 로 바꾸면 Semantic Router 모델은 안 써도 되지 않을까?"
>
> 리서치 일자: 2026-06-27 · 대상: Langfuse 기능/API/MCP, 대안 가드레일 · 방식: 공식 docs + 검색 교차검증(4+ 소스)

---

## TL;DR (결론)

1. **전제가 틀렸다 — Langfuse 는 가드레일(런타임 차단) 기술을 제공하지 않는다.** Langfuse 는 **관측(observability) + 평가(evaluation)** 플랫폼이다. 공식 문서가 명시적으로 "런타임 보안은 보안 라이브러리가, **Langfuse 는 사후(ex-post) 평가**를 담당한다"고 선을 긋는다.
2. 따라서 **"Langfuse 로 Semantic Router 를 대체"는 성립하지 않는다.** 둘은 **대체재가 아니라 보완재**다(SR=차단, Langfuse=관측/평가).
3. **Langfuse Python SDK** 는 차단이 아니라 **트레이싱/스코어링**용이다(`@observe()`, `score_current_observation()`). "Python SDK 가드레일"의 실체는 *LLM Guard 같은 별도 라이브러리가 차단하고 Langfuse 가 그 결과를 기록*하는 패턴이다.
4. **Langfuse 평가(LLM-as-a-Judge)는 비동기**다 — 요청을 실시간 차단할 수 없다. PII/jailbreak 를 모델 호출 **전에** 막으려면 인라인 엔진(SR 등)이 반드시 필요하다.
5. 권장: **3-레이어 분리** — Semantic Router(인라인 차단) + ClickHouse/WORM(불변 증적=컴플라이언스 원본) + Langfuse(관측 + 비동기 2차 평가). Semantic Router 는 유지하고 Langfuse 를 *위에 얹는다*.
6. 한국어 금융(삼성증권) 맥락에서 SR 을 굳이 빼야 한다면 그건 Langfuse 가 아니라 **가드레일 엔진 교체**(LLM Guard/Llama Guard/관리형 API) 문제다. 그러나 (a) 우리 BFF 는 Go 인데 LLM Guard 는 Python → Python 가드 서비스 신설 필요, (b) Presidio 한국어는 기본 미지원, (c) 관리형 API 는 데이터가 클러스터 밖으로 나감 → 데이터 레지던시 위배. **결국 SR 유지가 가장 합리적**이다.

---

## 1. 교차검증: Langfuse 는 가드레일이 아니다

여러 공식 페이지가 동일하게 "Langfuse=사후 평가, 보안 라이브러리=런타임 차단"으로 역할을 분리한다.

| 구분 | 런타임 보안 라이브러리 | Langfuse |
|---|---|---|
| 역할 | 유해/부적절 프롬프트를 **모델 전송 전에 차단**, PII 레다크션, 런타임 평가 | **사후(ex-post) 평가** — "보안 메커니즘 각 단계의 가시성·신뢰 확보" |
| 차단 가능? | ✅ 실시간 차단 | ❌ 차단 불가(관측·점수화만) |
| 타이밍 | 동기(모델 호출 경로) | **비동기**(트레이스 적재 후) |

- 공식: *"Langfuse serves as ex-post evaluation of the effectiveness of security measures, while LLM Security libraries provide the run-time security measures."* — [Security & Guardrails](https://langfuse.com/docs/security-and-guardrails)
- 평가 페이지: *"Langfuse's model-based evaluations will run **asynchronously** and can scan traces for things such as toxicity or sensitivity to flag potential risks."* — [LLM Security & Guardrails (evaluation)](https://langfuse.com/docs/evaluation/features/security-and-guardrails)
- 권장 외부 도구(=실제 차단 주체): **LLM Guard**(Protect AI), Lakera, Prompt Armor, NeMo Guardrails, Azure AI Content Safety, Microsoft Presidio. — [LLM Security 모니터링 블로그](https://langfuse.com/blog/2024-06-monitoring-llm-security)

> 즉 "Langfuse 가드레일"이라는 제품 기능은 없다. 있는 건 **"가드레일을 Langfuse 로 관측·평가하는 방법"**이다.

---

## 2. Langfuse 가 실제로 제공하는 것

[Langfuse](https://langfuse.com/) = 오픈소스 LLM 엔지니어링 플랫폼(YC W23). 핵심 4축:

1. **Observability/Tracing** — LLM 호출·검색·에이전트 동작을 트레이스로 기록. OpenTelemetry 기반. SDK 는 비동기 배치 전송이라 앱 지연에 영향 없음. — [Observability SDK](https://langfuse.com/docs/observability/sdk/overview)
2. **Evaluation** — LLM-as-a-Judge, 코드 평가자, 사용자 피드백, 수동 라벨링, 커스텀 점수. **온라인 평가도 비동기**(프로덕션 트레이스를 사후 스캔). — [Scores 개요](https://langfuse.com/docs/scores/overview)
3. **Prompt Management** — 프롬프트 버전관리·캐싱.
4. **Datasets / Playground** — 데이터셋, 프롬프트 실험.

### Python SDK 의 역할(중요)
3가지 계측 방식: 데코레이터 `@observe()`, 컨텍스트 매니저, 수동 observation. `LangfuseSpan`/`LangfuseGeneration` 은 OTel span 래퍼. **차단 로직은 없다** — 점수 기록(`score_current_observation`)·미디어·트레이스 메타만 다룬다.

### "보안 모니터링" 통합 패턴(쿡북 실측)
[LLM Security 모니터링 쿡북](https://langfuse.com/guides/cookbook/example_llm_security_monitoring): **LLM Guard 가 차단, Langfuse 가 기록**.
```python
# 차단 주체 = LLM Guard (Langfuse 아님)
sanitized, is_valid, risk_score = scanner.scan(user_input)   # LLM Guard
langfuse_context.score_current_observation(name="input-score", value=risk_score)  # Langfuse=기록
if risk_score > threshold:
    return "Blocked"                                          # 차단 결정도 앱 코드가
response = openai.chat.completions.create(...)               # 통과 시 LLM 호출
```
→ "Python SDK 로 가드레일"의 실체가 이것이다. Langfuse SDK 는 **점수 기록**만, 차단은 LLM Guard + 앱 코드.

---

## 3. Langfuse Public API (Go BFF 연동 관점)

레퍼런스: [api.reference.langfuse.com](https://api.reference.langfuse.com/) · [Public API 문서](https://langfuse.com/docs/api-and-data-platform/features/public-api)

- 베이스: `{host}/api/public/*` · 인증: **HTTP Basic**(username=public `pk-lf-...`, password=secret `sk-lf-...`).
- 주요 리소스: `traces`, `observations`, `sessions`, `scores`, `ingestion`(배치 이벤트 적재), `prompts`, `datasets`, `metrics`, exports.
- **Scores API** = 가드레일 결과를 Langfuse 에 남기는 통로:
  - `POST /api/public/scores` — `{id, traceId, observationId?, name, value, dataType, configId?, comment}`
  - dataType: `NUMERIC | CATEGORICAL | BOOLEAN(float 1/0) | TEXT(1~500자)`
  - **언어 무관 공개 API** → **우리 Go BFF 가 Python 없이 직접 POST 가능**(Python SDK 불필요). 트레이스보다 점수가 먼저 도착해도 `traceId` 로 나중에 링크됨. — [Scores via API/SDK](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk)

> 우리 코드 정합: BFF 가 이미 `/api/public/traces|observations|sessions` 를 GET 으로 읽는다(읽기 전용 대시보드). 가드레일 결과를 **쓰려면** `ingestion`/`scores` 로 POST 하면 된다. 단, 우리는 이미 ClickHouse `guard_audit`(+WORM) 라는 **컴플라이언스 원본**을 갖고 있어, Langfuse scores 는 "관측·분석용 2차 사본"으로 보는 게 맞다(아래 §6).

---

## 4. Langfuse MCP 서버 (가드레일 아님 — 관측 데이터 조회/프롬프트 관리)

레퍼런스: [mcp.reference.langfuse.com](https://mcp.reference.langfuse.com/) · [MCP Server 문서](https://langfuse.com/docs/api-and-data-platform/features/mcp-server)

- 엔드포인트: `{host}/api/public/mcp` · 전송: **streamableHttp** · 인증: Basic(`base64(pk-lf:sk-lf)`) · 별도 빌드/설치 불필요(서버 내장).
- 리전: EU `cloud.langfuse.com`, US `us.cloud.langfuse.com`, JP `jp.cloud.langfuse.com`, HIPAA, self-hosted.
- 용도: **AI 에이전트(Claude Code/Cursor/Codex)가 Langfuse 데이터를 질의** — 트레이스/제너레이션 조회, 예외·고지연 스팬 디버깅, 세션 분석, **프롬프트·데이터셋·스코어·어노테이션 큐 관리**(read+write). — [블로그](https://langfuse.com/blog/2025-12-09-building-langfuse-mcp-server)
- **가드레일과 무관**. 우리 입장에서 MCP 는 "개발/디버깅 편의"(프로덕션 트레이스를 IDE 에서 질의)지 런타임 경로가 아니다. 별도로 프롬프트 관리 전용 MCP(`langfuse/mcp-server-langfuse`)도 있음.

---

## 5. 가드레일 엔진 옵션 비교 (실제 결정 대상)

"SR 모델을 안 쓰고 싶다"는 **가드레일 엔진** 선택 문제다(Langfuse 와 무관). 한국어 금융 맥락 기준 비교:

| 엔진 | 인라인 차단 | 한국어 PII | 데이터 레지던시 | 배포 복잡도 | 비고 |
|---|---|---|---|---|---|
| **vLLM Semantic Router**(현재) | ✅ | △(토큰 분류 모델 + 우리 정규식 보강) | ✅ 클러스터 내 | 중(서비스+모델 배포, 이미 가동) | ModernBERT+LoRA 다태스크(PII=token labeling, jailbreak=seq cls), per-decision 플러그인. [vLLM SR](https://vllm-semantic-router.com/) · 가드모델(Qwen3Guard/Llama Guard) 통합 진행중 [#626](https://github.com/vllm-project/semantic-router/issues/626) |
| **LLM Guard**(Protect AI) | ✅(앱 코드가 임계 판단) | ✕ 기본(내부 Presidio=영어 전용, 한국어 별도 설정) | ✅ 자체 호스팅 | 중상(**Python** — Go BFF 와 별도 서비스 필요) | Langfuse 쿡북의 그 도구. PII/injection/toxicity 스캐너 |
| **Llama Guard / Qwen3Guard / Granite Guardian** | ✅(LLM 호출) | 모델별 상이 | ✅ 자체 호스팅 | 상(GPU 추론 비용·지연↑) | BERT 분류기보다 무겁지만 안전 탐지 강력. SR 이 흡수 중 |
| **관리형 API**(Azure Content Safety/OpenAI Moderation/Lakera) | ✅ | 서비스별 | ❌ **데이터 외부 유출** | 하 | 삼성증권 데이터 레지던시에 부적합 가능성 큼 |
| **Langfuse 비동기 eval** | ❌(사후) | LLM 판정 의존 | host 따라 | 하 | **차단 불가** — 2차 점검용 |

### 한국어 PII 교차검증 (삼성증권 핵심)
- **Presidio**(LLM Guard 내부 엔진): 최근 **한국 RRN(주민번호) recognizer + 체크섬** 추가됨. 그러나 기본 모델은 **영어 전용** — 한국어 NER 은 NlpEngine/recognizer 커스터마이즈 필요. — [Presidio 다국어](https://microsoft.github.io/presidio/analyzer/languages/)
- 즉 LLM Guard 로 가도 **한국어 PII 는 추가 셋업 + 우리 정규식(이미 보유) 유지**가 불가피. SR 대비 이점이 크지 않다.
- 현재 코드는 이미 한국어 PII/시크릿 정규식 1차 보강을 SR 위에 얹어둠(`guard.go`) — 엔진을 바꿔도 이 보강은 자산.

---

## 6. 권장 아키텍처 — 3-레이어 분리

각자 다른 일을 한다. 하나로 합치려 하지 말 것.

```
① 인라인 차단(enforcement)   : Semantic Router   — 동기, 모델 호출 전, 저지연 BERT 분류
② 컴플라이언스 원본(불변)     : ClickHouse guard_audit + MinIO WORM — 규제 대응 불변 증적
③ 관측·평가(observability)   : Langfuse          — 트레이스 + 비동기 LLM-as-judge 2차 점검
```

### 권장 통신 흐름 (추론 요청 1건, BFF 기준)
```
브라우저 → BFF(/playground/chat)
  1. 쿼터 확인(quota)
  2. [①] BFF → Semantic Router classify(PII/jailbreak)        ← 동기·차단지점
        └ block/flag 결정(policy). blocked 면 여기서 403 종료.
  3. allowed → BFF → Dynamo/vLLM 업스트림(LLM)                 ← 모델 호출
  4. (옵션) 출력 가드: SR on output
  5. [②] BFF → ClickHouse guard_audit(+WORM)                  ← 불변 증적(컴플라이언스 원본)
  6. [③] BFF → Langfuse ingestion: trace + GENERATION/GUARDRAIL observation  ← 관측
        └ (옵션) BFF → POST /api/public/scores: guard 결정·위험점수  ← Go 에서 직접
  7. [③-async] Langfuse LLM-as-Judge 가 트레이스를 사후 스캔 → toxicity/PII 2차 점수 → 대시보드
```

- **차단은 항상 ②③ 이전(2단계)** — Langfuse/eval 은 절대 차단 경로에 두지 않는다(비동기라 못 막음).
- ②(ClickHouse/WORM)와 ③(Langfuse)의 역할 분담: **규제 증적은 ClickHouse/WORM 이 원본**(불변 보존), **Langfuse 는 분석·디버깅·2차 평가**. 둘 다 같은 trace_id 로 상호참조. Langfuse scores 를 컴플라이언스 원본으로 삼지 말 것(보존/불변성 보장은 WORM 이 담당).
- Langfuse 가 주는 추가 가치: ① SR 이 통과시킨 것 중 위험을 **사후에 잡는 2차 그물**(LLM-as-judge toxicity/PII), ② SR 판정·지연의 가시화/대시보드, ③ 프롬프트 버전관리·MCP 디버깅.

---

## 7. 만약 그래도 Semantic Router 를 빼고 싶다면

전제: 그건 "Langfuse 로 교체"가 아니라 "**가드레일 엔진 교체**"다. 조건/트레이드오프:

- **LLM Guard 채택 시**: Python 가드 서비스(HTTP)를 신설하고 Go BFF 가 호출(현 SR 호출 구조와 동일). 한국어 PII 는 Presidio 커스터마이즈 + 우리 정규식. → SR 대비 운영 이점 거의 없음, 오히려 Python 스택 추가.
- **관리형 API 채택 시**: 데이터가 외부로 → 삼성증권/금융 데이터 레지던시 검토 필수(대개 불가).
- **결론**: 한국어 + 데이터 레지던시 + 이미 Go→HTTP 호출 구조를 감안하면 **SR 유지가 최선**. 안전 탐지 강화가 필요하면 SR 의 가드모델 통합([#626](https://github.com/vllm-project/semantic-router/issues/626): Qwen3Guard/Llama Guard/Granite Guardian)을 기다리거나 SR 뒤에 보조 가드를 두는 방향.

---

## 8. 다음 액션 후보
- [ ] (관측 강화) BFF 의 추론 경로에서 Langfuse `ingestion` 으로 trace+GUARDRAIL observation 을 **쓰기** 추가 → 현재 읽기전용(synthetic 폴백)을 실데이터로. `/diagnostics` 의 langfuse 가 reachable 이어야 함.
- [ ] (2차 평가) Langfuse online LLM-as-Judge 평가자 구성(toxicity/PII) → SR 통과분 사후 점검.
- [ ] (역할 문서화) [docs/integration/semantic-router.md](../integration/semantic-router.md) 와 [langfuse.md](../integration/langfuse.md) 에 "①차단 vs ③관측" 분리 원칙 명시.
- [ ] (선택) 개발 편의용 Langfuse MCP 를 사내 IDE 에 연결(프로덕션 트레이스 디버깅).

---

## 출처
- [Langfuse — Security & Guardrails](https://langfuse.com/docs/security-and-guardrails)
- [Langfuse — LLM Security & Guardrails (Evaluation, 비동기 명시)](https://langfuse.com/docs/evaluation/features/security-and-guardrails)
- [Langfuse — LLM Security 모니터링 쿡북(LLM Guard 패턴)](https://langfuse.com/guides/cookbook/example_llm_security_monitoring)
- [Langfuse — Monitoring LLM Security 블로그](https://langfuse.com/blog/2024-06-monitoring-llm-security)
- [Langfuse — Observability SDK 개요](https://langfuse.com/docs/observability/sdk/overview) · [Scores 개요](https://langfuse.com/docs/scores/overview) · [Scores via API/SDK](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk)
- [Langfuse — Public API](https://langfuse.com/docs/api-and-data-platform/features/public-api) · [API 레퍼런스](https://api.reference.langfuse.com/)
- [Langfuse — MCP Server](https://langfuse.com/docs/api-and-data-platform/features/mcp-server) · [MCP 레퍼런스](https://mcp.reference.langfuse.com/) · [MCP 빌드 블로그](https://langfuse.com/blog/2025-12-09-building-langfuse-mcp-server)
- [vLLM Semantic Router](https://vllm-semantic-router.com/) · [가드모델 통합 이슈 #626](https://github.com/vllm-project/semantic-router/issues/626) · [분류 모델(DeepWiki)](https://deepwiki.com/vllm-project/semantic-router/4.3-classification-models)
- [Microsoft Presidio — 다국어 지원](https://microsoft.github.io/presidio/analyzer/languages/)
