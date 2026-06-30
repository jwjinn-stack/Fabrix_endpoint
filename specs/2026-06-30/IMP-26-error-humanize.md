# 기능: 에러 메시지 정규화 공용화

## 목적
친절한 에러 변환이 Settings 한 곳(local humanizeError)에만 — 타 페이지는 raw `(e as Error).message`("API 503", "Failed to fetch")를 그대로 노출. 관제 콘솔에서 비친화적.

## 요구사항
- `web/src/utils/errors.ts` 공용 `humanizeError(msg)` — network/timeout/429/403/404/409/5xx/invalid-email → 한국어 안내, 그 외 원문 유지.
- Settings local 함수 제거 → 공용으로 통합.
- 페이지 catch 의 bare `setError((e as Error).message)`(및 setErr/setContentErr/logs error) → `humanizeError(...)` 일괄 래핑 + import.

## 테스트 케이스
- errors.test.ts: network/5xx/403/429/invalid-email 매핑 + unknown passthrough(6건).
- regression: tsc·lint·test(17)·build green.

## 출력 위치
- `web/src/utils/errors.ts`(신규), `errors.test.ts`, 15개 페이지.

## 의존성
- 없음. (IMP-13 러너로 단위테스트.)
