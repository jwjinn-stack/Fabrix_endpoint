# 기능: L2→L3 드릴다운 false affordance 제거 — 미지원 차원 무필터 점프 차단 (IMP-1)

> 출처: evolve/IMPROVEMENTS.md IMP-1 (ux · high · M · high)

## 목적
성능 차원 분해(L2)에서 dim=endpoint/namespace 행 클릭 시 onDrill 이 `model` 만 시드 → 나머지는
**무필터 전체 트레이스로 조용히 점프(데이터 손실)**. 행엔 여전히 clickable + 드릴 툴팁이 붙어 오인을 유발.
백엔드 트레이스 필터도 model/app 만 있고 endpoint/namespace 없음(특히 **namespace 는 트레이스 데이터에 없음**).

## 요구사항 (안전 우선 — 백로그 2순위 채택)
- DimensionBreakdown 에 `drillableDims` 프롭 추가. 현재 dim 이 drillable 일 때만 clickable/드릴 툴팁/onClick 부여.
  미지원 dim 은 **false affordance 제거 + "이 차원은 트레이스 드릴다운 미지원" 명시**(negative affordance).
- 호출부(Usage·Endpoints): `drillableDims={["model"]}`, onDrill 매핑 일반화(model 만 필터 시드).
- **(후속) 정공법**: endpoint 트레이스 필터(langfuse.Filters.Endpoint + traces.go + Traces 페이지 endpoint 필터 +
  trace 데이터에 endpoint 노출). namespace 는 트레이스 데이터 모델 확장이 필요 → 별도 항목.

## 변경 위치
- `web/src/components/DimensionBreakdown.tsx`, `web/src/pages/Usage.tsx`, `web/src/pages/Endpoints.tsx`

## 테스트 케이스
- tsc 타입체크 통과.
- 시각 QA(앱 구동 시): 미지원 차원에서 행 커서/드릴 툴팁 없음 + 안내문 표시, model 차원에선 드릴 정상 동작.

## 의존성
- 없음.

## 비고
- **데이터 손실 버그(무필터 점프) 즉시 차단이 핵심 가치.** endpoint 필터 정공법은 백엔드 trace 모델 작업을
  동반하므로 follow-up 으로 분리(이 스펙은 안전한 차단 + 확장 가능한 일반화에 집중).
