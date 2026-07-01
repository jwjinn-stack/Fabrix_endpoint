# IMP-49 — 네트워크 모니터링 화면 (대역폭·지연·연결·에러) — mock-first

## 목적
네트워크 관측이 Traffic.tsx(앱층 프록시 지연)·Diagnostics(도달성 스냅샷)에 파편화되어
'네트워크 그 자체'(링크 대역폭 rx/tx, 지연 p50/p95/p99, 패킷손실, 인터페이스 에러/드롭)의
시계열 화면이 부재하다. 온콜 triage 에서 인프라 층 네트워크를 단일 화면으로 관측하고,
상관된 앱층(Traffic) 뷰로 pivot 할 수 있게 한다. mock-first(IMP-55 fetchNetwork).

## 요구사항 (증거 기반)
- USE method(id 13977)·node_exporter netdev·network monitoring best practices 참조.
1. **지연은 p50/p95/p99**(단일 avg 아님). KPI 'avg latency' 카드는 **p95** 표시(꼬리 지연 우선).
2. **색 임계는 statusFromThresholds 단일출처**(기존 토큰 var(--amber)/var(--red)):
   - utilization warn=75%(0.75) / crit=90%(0.9)  ← rx/tx ÷ capacity
   - latency_p95 warn=6ms / crit=12ms (mock buildNetwork status 파생과 동일 계열)
   - loss warn=0.5%(0.005) / crit=2%(0.02)
   - errs/retransmit warn/crit (에러율 강조)
3. **network=인프라 층 배너** + **cross-layer pivot**: hot link SlidePanel 상세에서
   상관된 Traffic(앱층) 뷰로 onNavigate("traffic") 링크(triage = 분리 아닌 상관).
4. **기본 시간창 = 단기 인시던트 뷰**(range 셀렉터, 짧은 창 우선: 1h/6h/24h/7d, 기본 1h).
5. 링크를 **error+retransmit(=loss/errs) 급증 우선 정렬** + 상태(crit>warn>ok) 정렬.
6. **인터페이스/링크 셀렉터**(모두/개별 링크 필터).
7. 상단 배지 'mock — 실 수집 node_exporter netdev+blackbox(IMP-52 spike)'.
   상태 6종·다중 링크 오버플로. WCAG 색-only 금지(텍스트/아이콘 병기). observe read-only 정합.

## 함수 시그니처 (Network.tsx)
- `export default function Network({ onNavigate }: { onNavigate: NavFn })` — cross-layer pivot 위해 NavFn 수신.
- `fetchNetwork(range, signal) → NetworkReport` (IMP-55, 그대로 사용).
- `utilOf(p: NetworkPoint, capacity: number): number` — max(rx,tx)/capacity (0..1).
- `linkStatus(l: NetworkLink): NodeStatus` — worstStatus([util, p95, loss] 임계) 단일출처 로컬 파생.
- `sortLinks(links): NetworkLink[]` — errs+loss 급증(crit>warn) → 상태 → id 순 상단 정렬.
- KPI 카드: p95 latency(worst link), 총 rx/tx, 최대 util, 손실률.

## 테스트 케이스 (RTL, Network.test.tsx)
- [T1] 로딩 → 링크 카드 렌더 + mock 배지 표시.
- [T2] KPI 'avg latency' 카드가 **p95** 값 표시(avg/p50 아님).
- [T3] error/retransmit(loss·errs) 급증 링크가 상단 정렬.
- [T4] 링크 카드 클릭 → SlidePanel 상세 → 'Traffic(앱층)으로 이동' pivot 버튼 클릭 시 onNavigate("traffic") 호출.
- [T5] 범위 셀렉터 변경 → fetchNetwork 가 새 range 로 재호출.
- [T6] 색-only 금지: 상태 텍스트(위험/주의/정상) 병기.
- [T7] states: 로딩(skeleton)/빈(0링크)/에러(role=alert, humanizeError).

## 출력 위치
- `web/src/pages/Network.tsx` (신규)
- `web/src/pages/Network.test.tsx` (신규)
- `web/src/router.ts` (network 라우트, cap=dashboard)
- `web/src/components/Layout.tsx` (Page 유니온 + NAV 항목)
- `web/src/App.tsx` (Network 마운트, onNavigate 전달)
- `web/src/index.css` (net-* 최소 스타일; node-* 패턴 재사용)

## 의존성
none (ZERO new deps). IMP-55 fetchNetwork·mockFactory·기존 컴포넌트(SlidePanel/StatMini/Sparkline/DataFreshness/InfoTip) 재사용.
IMP-46 NodeMetrics 구조·CSS(node-*) 미러. Traffic pivot = 기존 라우팅(onNavigate/router).
