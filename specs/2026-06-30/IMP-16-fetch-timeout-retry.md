# 기능: API 클라이언트 요청 타임아웃 + 일시 오류 재시도

## 목적
`getJSON`(client.ts:57)은 `fetch(apiPath(path), { signal })` 단일 호출이 전부 — 타임아웃이 없어 백엔드가 매달리면 무한 대기, 502/일시 네트워크 오류 재시도(backoff)도 없어 폴링 한 틱 실패 시 그 주기 데이터가 통째로 빈다. Prometheus/ClickHouse 위 BFF가 일시적으로 느려지는 운영 환경에서 체감 신뢰도 하락.

## 요구사항 / 함수 시그니처
- `getJSON<T>(path, signal?)` 시그니처·반환 불변(호출부 무수정).
- 기본 타임아웃: `AbortSignal.timeout(DEFAULT_TIMEOUT_MS)` (12s). 외부 signal 과 `AbortSignal.any([signal, timeout])` 로 합성해 호출부 취소 의미 보존.
- 재시도: GET 멱등 가정. 최대 2회(총 3시도) 지수 백오프(예: 300ms, 900ms + 소량 지터).
  - **재시도 대상**: 네트워크 오류(fetch reject, 단 외부 signal abort 는 제외) + 429 + 5xx.
  - **재시도 금지**: 4xx(429 제외) 클라이언트 오류 → 즉시 throw. 외부 signal 로 인한 abort → 즉시 throw.
  - 타임아웃 abort 는 일시 오류로 간주해 재시도(다음 시도에 새 timeout).
- 폴링 호출부와 다음 틱이 겹치지 않게 maxRetry 작게(2) + backoff 캡.
- 에러 메시지 형식 유지(`API <status><detail>`).
- 표준 웹 API만 사용(AbortSignal.timeout/any) — 추가 의존성 0. (SWR 도입(IMP-8) 시 재시도 책임 이관 — 주석 명시.)

## 테스트 케이스
- normal: 200 → 1회 fetch, 파싱 반환.
- retry: 첫 시도 503 → 백오프 후 재시도 → 200 성공.
- failure: 3회 모두 503 → 마지막 에러 throw.
- bad-input(4xx): 400/404 → 재시도 없이 즉시 throw.
- env-missing/network: fetch reject(네트워크) → 재시도; 외부 signal abort → 즉시 중단(재시도 안 함).
- timeout: 응답 지연 → timeout abort → 재시도.
- (프론트 테스트 러너 미도입(IMP-13) — tsc + 코드리뷰로 검증, 러너 도입 후 단위테스트 추가)

## 출력 위치
- `web/src/api/client.ts` (getJSON 내부 + 상단 헬퍼/상수).

## 의존성
- 없음(표준 AbortSignal.timeout / AbortSignal.any).
