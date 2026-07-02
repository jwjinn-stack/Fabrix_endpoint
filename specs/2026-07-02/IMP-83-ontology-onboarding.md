# IMP-83 — 온톨로지 무엇/왜 온보딩 — 과업→객체→조치 3단 직관 설명

- **Type**: ux (sev=medium, effort=S)
- **Directions**: 6(간결 인라인 설명·정보폭탄 금지) + 10(온톨로지를 쉽게 이해·직관적 가치 전달)
- **Area**: `web/src/pages/Ontology.tsx`, `web/src/components/InfoTip.tsx`(재사용), `web/src/pages/Ontology.test.tsx`, `web/src/index.css`

## Why
Ontology 화면은 스코어카드/스키마 탭으로 곧장 들어가 처음 보는 오퍼레이터에게 "온톨로지가 무엇이고 이걸로 뭐가 좋아지나"를 전달하는 진입 온보딩이 없다. 개념 헤더(semantic↔kinetic, Object/Link/Action)는 보조 "스키마 참조" 탭에 묻혀 용어를 이미 아는 사람만 이해하고, 유일한 진입 설명은 breadcrumb InfoTip 하나뿐.

## What (구현 정확히)
백로그가 메커닉을 정정: auto-expand localStorage 상단 카드가 아니라 **진행형/맥락형 disclosure(action-first)**.

1. **주의 요약은 여전히 첫 노출** — 스코어카드 "지금 주의를 요하는 것"을 온보딩 chrome 아래로 밀지 않는다(action-first).
2. **항상-접힌 한 줄 어포던스** — 탭바 인근에 "온톨로지란? 3단계로 보기" disclosure(`<details>`/버튼). **localStorage 상태 없음**(observe/manage·clone 재트리거 회피). 펼치면 3-concept 콘텐츠(과업(Task) → 객체·관계(Object/Link) → 조치(Action))가 각 1~2줄 "무엇 + 왜 좋은가"로 노출. 양 탭 공통 위치(탭바 아래, 탭 컨텐트 위) — 두 탭이 한 설명을 공유.
3. **묻힌 개념 헤더 승격** — 스키마 탭의 개념 헤더(semantic↔kinetic·"느낌" 3카드)를 그 disclosure로 이동, 스키마 탭에서는 제거(중복 카피 제거·gap 봉합).
4. **첫 at-risk 행 1회성 인라인 예시** — 구체 2줄 예시(Endpoint --serves--> Model, 클릭 → kinetic Action)를 스코어리스트의 **첫 at-risk 행에만** 인라인 힌트로 부착(맥락형 "learn as you work"). 1회성 = 첫 at-risk 행만(localStorage 없음).
5. **InfoTip 확대(재사용)** — 미설명 요소에 InfoTip 부착:
   - 3개 그룹 라벨(운영 준비=Production Readiness / 관측성=Observability / 오너십=Ownership) — 요약 미니바.
   - 3단 disclosure 안의 핵심 용어(Object/Link/Action/kinetic) — 짧은 정의.
   Palantir Foundry 어휘 정합. 간결(정보폭탄 아님).

## a11y
- InfoTip 재사용(WCAG 1.4.13 toggletip·키보드·Esc 이미 처리) — 새 의존성 0.
- disclosure는 네이티브 `<details>`/버튼 토글(키보드 접근·`aria-expanded`).
- 색-only 신호 금지 준수(기존 글리프+텍스트 유지).

## 테스트 케이스 (Ontology.test.tsx)
1. 기본 진입 시 "지금 주의를 요하는 것"(주의 요약)이 여전히 첫 섹션으로 보인다(action-first, disclosure에 안 밀림).
2. disclosure "온톨로지란? 3단계로 보기"가 기본 접힘 — 3-concept 콘텐츠(과업/객체·관계/조치, "온톨로지 렌즈")가 처음엔 DOM에 없다.
3. disclosure를 펼치면 3단 콘텐츠(과업→객체·관계→조치, 온톨로지 렌즈·Kinetic 제어·접지된 AI) 등장.
4. disclosure는 **양 탭에서 동일**(스코어카드/스키마 탭 모두 하나의 어포던스). 스키마 탭에는 더 이상 별도 개념 헤더 카드가 중복되지 않는다.
5. 첫 at-risk 행에 1회성 예시 힌트(Endpoint --serves--> Model) 존재, 나머지 at-risk 행엔 없다.
6. 그룹 라벨 InfoTip + 용어 InfoTip(재사용) 존재 — trigger 버튼 렌더.
7. localStorage 미사용(재렌더/재마운트해도 disclosure 기본 접힘 유지).
8. 기존 케이스 유지: 스코어카드 딥링크(상세/조사)·스키마 그래프 보조 탭·route/nav·failure·all-pass/empty·IMP-77 폴링·IMP-88 격리 green.

## Out of scope
- URL 동기화(IMP-70), 실백엔드, 스코어 규칙 변경, 새 색 토큰.
