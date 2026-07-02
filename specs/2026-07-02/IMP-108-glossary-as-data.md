# IMP-108 — statusGlossary를 전역 glossary-as-data로 승격

## 배경 / 문제
`web/src/api/statusGlossary.ts`(IMP-97)는 인시던트 상태 7개 term에만 국한된다
(triggered/acked/notready/backpressure/warn/crit/blast). 어시스트(IMP-104 explain-this,
IMP-105 widgetMeta relatedTerms, IMP-106 explain_term MCP resource)가 인용할 관측 도메인 용어
(TTFT·p95·prefill·throttle·NVLink·에러율·토큰비용 등)와 별칭/연관 관계가 어디에도 **선언적으로**
없다. 이대로면 각 표면이 용어 문구를 ad-hoc 문자열로 흩뿌리게 되어 단일 출처가 깨진다.

## 목표
관측 도메인 전반을 아우르는 **전역 glossary-as-data 단일 출처**를 만들고,
IMP-97 상태 7개 term의 소비자(StatusInfoTip)는 **회귀 0**로 그대로 동작하게 한다.

## 설계
- 신규 `web/src/api/glossary.ts` = 확장 스키마 + 전 도메인 term 데이터 + `lookupTerm`.
- 기존 `web/src/api/statusGlossary.ts` = `glossary.ts`에서 상태 7개 term만 파생한
  `STATUS_GLOSSARY`와 `glossaryTerm`을 **re-export**(하위 호환·회귀 0).
- 순수·의존성 0·결정적. 이 단일 출처를 IMP-104/105/106/110이 인용.

### 스키마 확장 (GlossaryTerm)
IMP-97의 `term`/`short`/`why`(short 1줄 + why 1줄 규약, 정보폭탄 금지) 유지 + 추가:
- `category`: `"incident-status" | "latency" | "gpu" | "traffic" | "ontology"`
- `aliases?: string[]`: 영문·검색 동의어(예: "TTFT" → "time to first token")
- `relatedKeys?: string[]`: 다른 glossary key(연관 탐색)

### 등재 도메인 용어 (데이터)
- latency: TTFT, p95, p99, prefill, decode, slo
- gpu: xid, nvlink, pcie, ecc, replica, cordon, drain
- traffic: throttle, throttle-reason, error-rate, block-rate, qps, token-cost,
  backpressure(상태와 공유), queue-depth, concurrency
- incident-status: 기존 7개(triggered/acked/notready/backpressure/warn/crit/blast)

### lookupTerm(query)
- key 완전일치(대소문자 무시) → term
- 없으면 aliases 완전일치(대소문자 무시) → term
- 그래도 없으면 `null`(환각 금지 — 없는 용어를 지어내지 않음)

## 테스트 케이스 (vitest)
1. 스키마: 모든 term에 category 존재; short/why 1줄(정보폭탄 방지 길이 상한).
2. 도메인 term 등재 확인(TTFT/p95/prefill/throttle/nvlink/token-cost 등 present).
3. `lookupTerm`: key로 조회 성공(대소문자 무시); alias로 조회 성공(예: "time to first token"→ttft, 대소문자 무시).
4. `lookupTerm` 미지 용어 → `null`(fabrication 없음).
5. relatedKeys는 실제 존재하는 key만 가리킨다(정합성).
6. 회귀 0: `STATUS_GLOSSARY` 7개 key 그대로 존재, `glossaryTerm("acked")` 문구 IMP-97과 동일.
7. StatusInfoTip: 7개 상태 term 여전히 렌더(IncidentReadingGuide 테스트 green 유지).
8. IMP-88 isolation 테스트 green 유지.

## Out of scope
어시스트 패널/MCP resource 구현(IMP-104/105/106) — 본 항목은 데이터 원천만 제공.
