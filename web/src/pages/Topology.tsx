import { useMemo, useState } from "react";
import { fetchTopology } from "../api/client";
import type { TopologyGraph, TopologyNode } from "../api/types";
import { TopologyView } from "../components/topology";
import { SkeletonCards } from "../components/Skeleton";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import DataFreshness from "../components/DataFreshness";
import PauseToggle from "../components/PauseToggle";
import { useCap } from "../capabilities";
import { usePolling } from "../utils/usePolling";
import type { NavFn } from "../router";
import { nodeNavTarget } from "../api/correlation";

const REFRESH_MS = 15_000;
const KIND_LABEL: Record<TopologyNode["kind"], string> = { server: "서버", service: "서비스", gpu: "GPU" };
const STATUS_LABEL: Record<TopologyNode["status"], string> = { ok: "정상", warn: "주의", crit: "위험" };

// 병목 엣지 판정: 에러율 ≥ 5%(위험) 인 링크. 요약·표에 공유.
const BOTTLENECK_ERR = 0.05;

function fmtMetric(key: string, v: number): string {
  const isRatio = key.endsWith("_perc") || key.endsWith("_util") || key === "error_rate";
  return isRatio ? `${Math.round(v * 100)}%` : String(v);
}

// 운영 토폴로지/의존성 그래프 화면 (IMP-45) + Datadog/Grafana 시각 완성도(IMP-48).
// 서버·서비스·GPU 의존성을 계층 SVG(TopologyView)로 그리고, 노드 클릭 → SlidePanel 드릴다운,
// '표로 보기' 토글 + 상단 텍스트 요약으로 complex-image 동등 대안(접근성)을 제공한다.
export default function Topology({ onNavigate }: { onNavigate?: NavFn }) {
  const { caps } = useCap();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  const {
    data: graph,
    error,
    loading,
    lastLoaded,
    paused,
    isStale,
    reload,
    setPaused,
  } = usePolling<TopologyGraph>(fetchTopology, { intervalMs: REFRESH_MS });

  const nodes = useMemo(() => graph?.nodes ?? [], [graph]);
  const edges = useMemo(() => graph?.edges ?? [], [graph]);

  // 상단 텍스트 요약(complex-image 동등 대안): 위험 노드 N · 병목 엣지 M.
  const riskNodes = useMemo(() => nodes.filter((n) => n.status !== "ok").length, [nodes]);
  const bottleneckEdges = useMemo(
    () => edges.filter((e) => typeof e.error_rate === "number" && e.error_rate >= BOTTLENECK_ERR).length,
    [edges],
  );

  // 선택 노드 상세(드릴다운) — 연결수 in/out 산출.
  const selectedNode = selectedId ? nodes.find((n) => n.id === selectedId) : undefined;
  const inCount = selectedId ? edges.filter((e) => e.to === selectedId).length : 0;
  const outCount = selectedId ? edges.filter((e) => e.from === selectedId).length : 0;

  // observe(readonly) 프로파일은 읽기 전용 → 노드 drag 비활성(pan/zoom/hover 유지).
  const interactive = !caps.readonly;

  const isEmpty = !!graph && nodes.length === 0;

  return (
    <>
      <div className="page-head">
        <h1>운영 토폴로지</h1>
        <span className="crumb">인프라 / 의존성 그래프</span>
        <div className="spacer" />
        <DataFreshness updatedAt={lastLoaded} intervalMs={REFRESH_MS} />
        <button
          type="button"
          className="refresh-btn"
          onClick={() => setShowTable((v) => !v)}
          aria-pressed={showTable}
        >
          {showTable ? "그래프로 보기" : "표로 보기"}
        </button>
        <PauseToggle paused={paused} onToggle={() => setPaused(!paused)} />
        <button type="button" className="refresh-btn" onClick={() => reload()} aria-label="토폴로지 새로고침">
          <span className="spin" aria-hidden="true">⟳</span>
          새로고침
        </button>
      </div>

      {/* IMP-50: LLM-aware 인프라 관측 포지셔닝 — inference(trace) ↔ infra(GPU/호스트/네트워크) 상관.
          경쟁사(Datadog/Kiali/Grafana)는 service edge 를 host/GPU saturation 과 native 융합하지 않는다. */}
      <p className="topo-positioning" role="note">
        <b>LLM-aware 인프라 관측</b> — LLM이 느린 게 앱인가, GPU인가, 네트워크인가?를 한 콘솔에서.
        노드를 클릭하면 트레이스·GPU·노드 메트릭 화면으로 바로 드릴다운해 <b>추론 ↔ 인프라 상관</b>을 추적합니다.
      </p>

      {error && (
        <div className="state error" role="alert">
          토폴로지를 불러오지 못했습니다. ({error})
          {isStale && <span className="state-stale"> · 마지막으로 받은 데이터를 표시 중입니다.</span>}
        </div>
      )}
      {!error && loading && !graph && <SkeletonCards count={3} />}

      {graph && (
        <>
          {/* 텍스트 요약 — 그래프의 complex-image 동등 대안(W3C). 색-only 아님. */}
          <p className="topo-summary" aria-live="polite">
            노드 <b>{nodes.length}</b>개 · 링크 <b>{edges.length}</b>개 —
            {" "}위험 노드 <b className={riskNodes > 0 ? "topo-summary-risk" : ""}>{riskNodes}</b>개 ·
            {" "}병목 엣지 <b className={bottleneckEdges > 0 ? "topo-summary-risk" : ""}>{bottleneckEdges}</b>개
            {selectedNode && <> · 선택: <b>{selectedNode.label}</b> (연결 in {inCount} / out {outCount})</>}
          </p>

          {isEmpty ? (
            <div className="card"><div className="empty">관측된 토폴로지 노드가 없습니다.</div></div>
          ) : showTable ? (
            <TopologyTables nodes={nodes} edges={edges} onSelect={setSelectedId} />
          ) : (
            <TopologyView
              graph={graph}
              interactive={interactive}
              onSelect={setSelectedId}
              selectedId={selectedId}
              height={480}
            />
          )}
        </>
      )}

      <SlidePanel
        open={!!selectedNode}
        title={selectedNode ? selectedNode.label : ""}
        subtitle={selectedNode ? `${KIND_LABEL[selectedNode.kind]} · ${STATUS_LABEL[selectedNode.status]}` : ""}
        onClose={() => setSelectedId(null)}
      >
        {selectedNode && (
          <>
            <DetailRow label="종류">{KIND_LABEL[selectedNode.kind]}</DetailRow>
            <DetailRow label="상태">
              <span className={`tag tag-${selectedNode.status === "ok" ? "green" : selectedNode.status === "warn" ? "amber" : "red"}`}>
                {STATUS_LABEL[selectedNode.status]}
              </span>
            </DetailRow>
            <DetailRow label="연결 (수신 / 발신)">{inCount} / {outCount}</DetailRow>
            {Object.entries(selectedNode.metrics ?? {}).map(([k, v]) => (
              <DetailRow key={k} label={k}>{fmtMetric(k, v)}</DetailRow>
            ))}
            {/* IMP-50: 노드 kind별 기존 화면 드릴다운(correlation moat). 필터 컨텍스트를 onNavigate 로 운반. */}
            {(() => {
              const target = nodeNavTarget(selectedNode);
              if (!target || !onNavigate) return null;
              return (
                <button
                  type="button"
                  className="btn-primary topo-drill-btn"
                  onClick={() => onNavigate(target.page, target.params)}
                >
                  {target.label} →
                </button>
              );
            })()}
            <p className="topo-dd-hint">
              그래프에서 이 노드를 선택하면 upstream/downstream 인접 노드가 강조되고 나머지는 흐려집니다.
              {onNavigate && " 위 버튼으로 이 엔티티의 트레이스·GPU·노드 메트릭 화면으로 이동해 추론 ↔ 인프라 상관을 추적하세요."}
            </p>
          </>
        )}
      </SlidePanel>
    </>
  );
}

// '표로 보기' — 노드/엣지 데이터 테이블(complex-image 동등 대안). status 는 색+텍스트 병기(WCAG 1.4.1).
function TopologyTables({
  nodes,
  edges,
  onSelect,
}: {
  nodes: TopologyNode[];
  edges: TopologyGraph["edges"];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="topo-tables">
      <div className="card">
        <div className="card-head">
          <h3>노드 ({nodes.length})</h3>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="노드 표 — 좌우 스크롤 가능">
          <table className="usage-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>종류</th>
                <th>상태</th>
                <th>지표</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.id} className="clickable" onClick={() => onSelect(n.id)}>
                  <td>{n.label}</td>
                  <td>{KIND_LABEL[n.kind]}</td>
                  <td>
                    <span className={`tag tag-${n.status === "ok" ? "green" : n.status === "warn" ? "amber" : "red"}`}>
                      {STATUS_LABEL[n.status]}
                    </span>
                  </td>
                  <td>
                    {Object.entries(n.metrics ?? {}).map(([k, v]) => `${k} ${fmtMetric(k, v)}`).join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>링크 ({edges.length})</h3>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="링크 표 — 좌우 스크롤 가능">
          <table className="usage-table">
            <thead>
              <tr>
                <th>from</th>
                <th>to</th>
                <th className="num">QPS</th>
                <th className="num">에러율</th>
              </tr>
            </thead>
            <tbody>
              {edges.map((e, i) => {
                const isBottleneck = typeof e.error_rate === "number" && e.error_rate >= BOTTLENECK_ERR;
                return (
                  <tr key={`${e.from}->${e.to}-${i}`}>
                    <td>{e.from}</td>
                    <td>{e.to}</td>
                    <td className="num">{typeof e.qps === "number" ? e.qps : "—"}</td>
                    <td className="num" style={isBottleneck ? { color: "var(--red)", fontWeight: 600 } : undefined}>
                      {typeof e.error_rate === "number" ? `${(e.error_rate * 100).toFixed(2)}%${isBottleneck ? " (병목)" : ""}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
