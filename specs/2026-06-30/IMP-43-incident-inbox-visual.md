# IMP-43 — 인시던트 인박스 시각 위계 (severity 색·상대시각·호버 액션)

## 목적
IMP-38 인시던트 인박스의 행이 `note note-{severity}` div 나열이라 시각 위계가 평면적이다.
Datadog event stream / Grafana OnCall / Linear inbox 처럼 한눈에 트리아지가 되도록
**시각 위계만** 끌어올린다 — 상태/액션/데이터 로직은 IMP-38 그대로(비회귀).

## 요구사항
1. 인시던트 행을 카드형으로:
   - severity별 **4px 좌측 컬러바** (critical=`--red`, warning=`--amber`, info=`--text-dim`).
   - severity **아이콘** (critical/warning/info 구분).
   - 제목(강) + **메타 라인**(상대시각·발생횟수 배지·상태 칩).
   - **상대시각** (예: "3분 전") — 신규 util `relativeTime()` (format.ts). 절대시각은 title 로 보존.
   - 타임스탬프는 **모노 폰트**(`--mono`) 로 정렬감.
2. **미처리(triggered) 강조**: 좌측 미읽음 도트 + 약한 배경 틴트.
3. **호버 액션**: ack/snooze/resolve 버튼(IMP-38)은 기본 흐릿/숨김, 행 호버·포커스 시 드러남
   (단 키보드/터치 접근성 위해 `focus-within` 에서도 노출, 미처리 행은 항상 노출).
4. 토큰만 사용 — 동적값(상대시각 문자열) 외 raw-px/하드코딩 색 금지. ZERO new deps.
5. IMP-27/34 elevation·토큰 정합. IMP-29 toast / IMP-31 비-모달 dialog 비회귀.

## 출력 위치
- `web/src/components/Notifications.tsx` — 인시던트 행 마크업(카드·컬러바·아이콘·메타라인·호버 액션).
- `web/src/index.css` — `.inc-*` 클래스 확장(컬러바·severity 토큰 매핑·호버 reveal·미읽음 강조).
- `web/src/utils/format.ts` — `relativeTime(ts)` util 추가.
- `web/src/components/Notifications.test.tsx` — RTL 케이스 보강.

## 테스트
- severity별 컬러바/클래스(`inc-sev-critical` 등) 적용.
- 상대시각 렌더("전" 포함) + 절대시각 title 보존.
- 미처리(triggered) 행 강조 클래스(`inc-unhandled`).
- 호버 액션 버튼 존재(처리중/해소).
- 기존 IMP-38 케이스 전부 유지(비회귀).

## 의존성
none (순수 styling/markup + util). 백엔드 변경 없음.
