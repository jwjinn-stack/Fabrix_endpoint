# IMP-46 — 핵심 운용 메트릭 화면 (USE / 골든시그널 큐레이션)

Type: ux (sev=high, effort=L) · cap=dashboard · mock-first · ZERO new deps

## 목적
호스트 레벨 운용 메트릭 화면이 부재했다. node_exporter 는 수백 메트릭 — 전량 나열은
안티패턴("Node Exporter Full" id 1860 덤프). 온콜이 실제 보는 '핵심' USE/포화 신호만
큐레이션해 보여준다(Grafana "USE Method / Node" id 13977 참조 세트).

이 화면은 **원인(cause) USE 뷰**다. request-level RED 뷰(Traffic/Traces)와 구분한다.

## 요구사항
- **데이터**: IMP-55 `fetchNodeMetrics(host, range)` → `NodeMetrics`. 3개 호스트
  (gpu-node-01/02/03)를 병렬 조회. mock-first(실 수집은 node_exporter+Prometheus,
  IMP-41/52 연동 시 — 배지에서 spike 문서 참조).
- **USE 큐레이션 세트**(전량 아님):
  - utilization: cpu_util · mem_util · disk_util
  - saturation: load1 · swap_used_perc · disk_io_perc  ← **통증 먼저**, 최강 강조
  - errors + traffic: net_err_per_s · net_rx_mbps · net_tx_mbps
- **2단 계층**:
  - fleet overview = 호스트 카드(StatCard/StatMini) + 핵심 4~6 스파크라인.
    **임계 초과 호스트 상단 정렬**(worstStatus). 카드 클릭 → per-host 상세.
  - per-host 상세(SlidePanel 재사용) = 전체 USE 스파크라인 + 최신값 + 임계 톤.
- **임계 색**: GPU tempColor/utilCellColor 관례 재사용(ok=중립 → crit=red).
  단일 출처 = `statusFromThresholds(value,warn,crit)`. saturation 신호 최강 강조.
- **배지**: 상단 'mock 데이터 — 실 수집은 node_exporter+Prometheus(IMP-41/52) 연동 시'
  + 한 줄 'cause USE 뷰 · request-level RED 뷰와 구분'.
- **상태 6종**: 로딩 Skeleton · 빈 · 에러 humanizeError(role=alert) · 정상 · 다수 호스트
  오버플로(그리드 wrap) · 상세 미데이터.
- **WCAG**: 색-only 금지 — 임계는 텍스트(정상/주의/위험) 병기. observe read-only 정합
  (읽기 전용, mutating 없음).

## 함수 시그니처 (web/src/pages/NodeMetrics.tsx)
- `export default function NodeMetrics(): JSX.Element`
- `HOSTS = ["gpu-node-01","gpu-node-02","gpu-node-03"]` (mock 정합)
- `nodeStatus(m: NodeMetrics): NodeStatus` — 최신 point 로 worstStatus(단일 출처)
  실제로는 mock 이 반환한 m.status 를 신뢰(단일 출처), 정렬 키로 사용.
- `sevRank(s: NodeStatus): number` — crit=0 < warn=1 < ok=2 (상단 정렬)
- `useColor(v, warn, crit): string | undefined` — statusFromThresholds → var(--red/--amber)
- `pct(v)`, `fmt(n)` — 포맷 헬퍼
- 컴포넌트: `HostCard`(StatCard/StatMini + sparklines, onClick), 상세는 SlidePanel 인라인.

## 테스트 케이스 (web/src/pages/NodeMetrics.test.tsx)
1. 로딩 → USE 세트 카드(3 호스트) 렌더 + mock 배지 표시.
2. 임계 초과 호스트가 상단 정렬(crit > warn > ok).
3. 카드 클릭 → SlidePanel 상세(전체 USE 스파크라인 + 라벨) 노출.
4. 에러 → humanizeError 메시지(role=alert).
5. 빈(모든 호스트 fetch 실패/0포인트) → empty 안내.
6. 색-only 금지: 상태 텍스트(위험/주의/정상) 병기.

## 출력 위치
- web/src/pages/NodeMetrics.tsx (신규)
- web/src/pages/NodeMetrics.test.tsx (신규)
- web/src/components/Layout.tsx (Page 유니온 + NAV 항목 "노드")
- web/src/router.ts (ROUTES + PAGE_CAP cap=dashboard)
- web/src/App.tsx (page render + import)

## 의존성
none (ZERO new deps). IMP-55 데이터/팩토리 · StatCard/StatMini/Sparkline/SlidePanel
· Skeleton · humanizeError 재사용.

## 비회귀
실 수집(node_exporter/Prometheus)은 spike(evolve/plans/IMP-52-nodeexporter-spike.md).
라디얼 게이지 등 고급 폴리시는 IMP-54. 지금은 StatCard/StatMini/Sparkline baseline.
