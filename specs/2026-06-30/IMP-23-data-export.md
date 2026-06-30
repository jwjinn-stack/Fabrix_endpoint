# 기능: 데이터 내보내기(CSV/JSON) 확장

## 목적
내보내기가 Usage 한 화면에만(CSV). 트레이스·가드 증적·키 등 조사 표는 반출 경로가 없어 외부 분석/증적 제출이 불편.

## 요구사항
- `utils/export.ts` 공용: `toCSV(rows,cols)`(쉼표/따옴표/개행 이스케이프), `downloadCSV`(BOM 선두 — Excel 한글), `downloadJSON`.
- `components/ExportButton.tsx`: 네이티브 `<details>` 디스클로저(접근성 무료) → CSV/JSON. rows 0 이면 비활성.
- 적용: Traces(트레이스), Guard 증적(audit), Keys(키). 컬럼 스펙은 화면별 정의.
- CSS `.export-menu*`.

## 테스트 케이스
- toCSV: 헤더+행 / 특수문자 인용 / 무행 헤더만(3건).
- visual: 메뉴 열림·CSV/JSON 2항목 렌더.
- gate: tsc·lint·test(20)·build green.

## 출력 위치
- web/src/utils/export.ts(+test), web/src/components/ExportButton.tsx, Traces/Guard/Keys, index.css.

## 의존성
- 없음(브라우저 Blob/URL).
