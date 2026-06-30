# 기능: 정적 메트릭 카탈로그 fetch 모듈 캐시 (IMP-8 부분 · 무의존 최소안)

> 출처: evolve/IMPROVEMENTS.md IMP-8 (oss · low · M · high)

## 목적
DimensionBreakdown 이 마운트마다 거의 정적인 `/metrics/dimensions`(메트릭 카탈로그)를 재요청.
2개 화면(Usage·Endpoints) + 리마운트로 동일 데이터 중복 패치.

## 요구사항 (무의존 최소안 — SWR/TanStack 미도입)
- `client.ts` `fetchMetricDimensions` 에 모듈 레벨 promise 캐시 → 최초 1회만 요청, 이후 캐시 반환.
  실패 시 캐시를 비워 재시도 허용. (정적 데이터라 abort 불필요.)
- **(follow-up)** overview dedup(Dashboard·Usage 공유)·폴링 타이머 통합·SWR vs TanStack 결정은
  `oss-evaluate` deep-dive(이번 사이클 미실행) 후 별도 진행.

## 변경 위치
- `web/src/api/client.ts`

## 테스트 케이스
- tsc 통과. (런타임: 차원분해 화면 반복 진입 시 `/metrics/dimensions` 네트워크 호출 1회만 — 앱 구동 시 확인.)

## 의존성
- 없음(새 라이브러리 도입 안 함 — 미니멀 스택 유지 의도).

## 비고
- IMP-8 의 **안전한 부분(정적 카탈로그 메모이즈)** 만 구현. 광범위한 캐시 전략(SWR)은 deep-dive 후 결정.
