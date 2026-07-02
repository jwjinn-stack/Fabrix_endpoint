# IMP-92 Spike — LLM 트레이스/평가 백본을 Langfuse 로 백킹

> Status: **spike-needed** (다일짜리 인프라 채택 — 코드 PR 아님).
> 전제: 손수 짠 synthetic 트레이스(mock)를 실 LLM 관측 백본으로 승격하는 단계.
> 프론트는 mock-first 유지 — 이 spike 없이도 트레이스/평가 화면은 buildable.

## 왜
현재 trace/eval 데이터는 mock 합성이다. 실 배포에서 LLM 트레이스·평가를 신뢰성 있게 저장·질의하려면
표준 백본이 필요하다. Langfuse(OSS 코어)가 정착 표준. 관련 메모리: 가드레일 vs Langfuse(관측+평가, 가드레일 아님).

## 후보
| 옵션 | 라이선스 | 비고 |
|---|---|---|
| **Langfuse (권장)** | OSS 코어(MIT 계열) | K8s Helm 자체호스팅, trace/eval/dataset, 우리 BFF 가 API 로 받아 우리 화면에 렌더(자체 UI 미노출) |
| OTEL→ClickHouse 직접 | Apache-2.0 | 경량이나 eval/dataset 은 직접 구현 |

## 검증
1. Langfuse Helm(Postgres+ClickHouse+Redis) 폐쇄망 이미지 미러링 가능 여부.
2. 게이트웨이/앱 OTEL export → Langfuse ingestion 경로.
3. observe 프로파일: 읽기만(우리 BFF 프록시), manage: 동일 + 쓰기 없음(Langfuse 는 관측 계층).
4. 카디널리티·보존 예산.

## 채택 순서
1. Go 조건: 실 트레이스 수요 확정 시.
2. Langfuse Helm 배포 → BFF 가 Langfuse API 로 trace/eval 조회 → 기존 mock 계약과 동일 형태 서빙(VITE_MOCK=off transport 스왑).
3. 프론트 무변경.

## 결론
**지금은 no-go(park).** mock-first 트레이스/평가 유지. 실 수요 확정 시 이 순서로.
