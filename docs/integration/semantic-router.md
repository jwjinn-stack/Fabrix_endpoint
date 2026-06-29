# Semantic Router — 가드레일(PII / Jailbreak)

모든 추론 프롬프트를 PII/Jailbreak/Intent 분류해 증권사 컴플라이언스 정책에 따라 차단/표시/통과를 결정한다.

- 코드: [`backend/internal/guard/guard.go`](../../backend/internal/guard/guard.go)
- capability: `guard`(조회/판정), `guard.write`(정책 변경) · 프로파일: observe 조회, manage 정책변경

## 연결
| 항목 | 값 |
|---|---|
| env | `FABRIX_SR_URL` (빈값=비활성→통과) / `FABRIX_POLICY_VERSION`(기본 `v1`) |
| 인클러스터 | `http://semantic-router.vllm-semantic-router-system:8080` |
| dev | `http://localhost:18080` (port-forward) |
| 프로토콜 | HTTP REST(`:8080`), POST JSON |
| 인증 | 없음 |
| 타임아웃 | 5초 |

## 호출 API (guard.go)
요청 본문은 셋 다 `{"text": "<프롬프트>"}` (`guard.go:126` `post()`).
- `POST /api/v1/classify/pii` → `{has_pii, entities[{type,confidence}], security_recommendation}` (`guard.go:189`)
- `POST /api/v1/classify/security` → `{is_jailbreak, risk_score, confidence, recommendation, patterns_detected}` (`guard.go:206`)
- `POST /api/v1/classify/intent` → `{classification{category, confidence}}` (`guard.go:221`)

판정 결과 `GuardVerdict{decision(allowed/blocked/flagged), guard_types, pii_entities, jb_confidence, category, reason, policy_ver}`. 정책(`GuardPolicy`: pii/jailbreak/secrets 각각 enabled+action=block|flag)으로 최종 결정. **SR 호출 실패해도 graceful** — 한국어 PII 정규식(`guard.go:144`)·시크릿 정규식(`guard.go:76`)으로 1차 보강은 항상 동작.

## 미설정/실패 시
`FABRIX_SR_URL` 비면 `enabled=false` → 모든 요청 `allowed`(통과). 단 한국어 PII/시크릿 정규식 보강은 유지. → 즉 SR 없이도 추론은 동작하되 ML 기반 차단은 비활성.

## 진단 프로브
`/diagnostics` → `semantic_router`. 프로브 = `POST /api/v1/classify/pii {"text":"ping"}` (`guard.go` `Probe()`, 3초). 정책 변경/분류 테스트(POST)는 observe 에 미등록이라 진단만 별도로 동작.

## 실사이트 매칭 체크리스트
- [ ] 고객사 SR 의 classify 경로가 `/api/v1/classify/{pii,security,intent}` 와 일치하는가? 다르면 `guard.go` 의 경로 상수 수정.
- [ ] 응답 필드명(`has_pii`,`is_jailbreak`,`entities[].type` 등) 일치 확인.
- [ ] 정책(`/api/v1/guard/policy`)에서 pii/jailbreak/secrets action(block/flag) 합의.
- [ ] NetworkPolicy: BFF → `semantic-router.vllm-semantic-router-system:8080` egress.

## 트러블슈팅
| 증상 | 원인 | 조치 |
|---|---|---|
| diagnostics reachable=false | SR 다운/경로 불일치 | error(connection/404) 로 분류, 경로 확인 |
| 차단이 안 됨 | SR 미설정(통과 모드) | `FABRIX_SR_URL` 주입, `/guard/status` 의 enforcing 확인 |
| 한국어 PII만 잡힘 | SR 미연동, 정규식만 동작 | SR 연동 |
