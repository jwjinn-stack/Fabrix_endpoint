// Object View 패널 (IMP-57) — Palantir Workshop 스타일 단일 엔티티 상세.
//  - SlidePanel 위에 (1)Header(글리프+title+상태 Badge+두드러진 metric) → (2)Properties(DetailRow)
//    → (3)Related(linkKind 그룹, 이웃 클릭 시 같은 패널에서 in-place traverse + breadcrumb)
//    → (4)Actions(대상 type 에 유효한 ActionType 을 <ActionForm> 으로; 게이팅은 evaluateSubmission).
//  - traverse 는 컴포넌트 내부 back 스택으로 관리하고, 현재 head 를 urlState(obj/objstack)에 보존해
//    deep-link + 브라우저 back 을 일관되게 만든다. 페이지 무관하게 obj 가 있으면 열린다.
//  - 데이터: fetchOntologyObjects()(이웃 해석 인덱스) + fetchOntologyObject(id)(canonical) +
//    fetchOntologyLinks(id)(관계). 전부 mock/실백엔드 동일 계약. 미존재 id → 빈 상태(throw 소비).
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchOntologyLinks, fetchOntologyObject, fetchOntologyObjects } from "../api/client";
import { usePolling } from "../utils/usePolling";
import DataFreshness from "./DataFreshness";
import PauseToggle from "./PauseToggle";
import type { ActionAuditEntry, ActionOutcome, LinkKind, ObjectStatus, OntologyLink, OntologyObject } from "../api/types";
import { typeVisual } from "../api/objectTypeVisual";
import { ACTION_REGISTRY, getActionSpec } from "../actions/registry";
import { objectViewSchema, useUrlState } from "../urlState";
import SlidePanel, { DetailRow } from "./SlidePanel";
import Badge, { type BadgeTone } from "./Badge";
import Gauge from "./Gauge";
import ActionForm from "./ActionForm";
import GpuHardwareSection from "./GpuHardwareSection";
import MetricExplorer from "./MetricExplorer";
import type { GpuHardware } from "../api/types";

// Metric Explorer(IMP-71)를 탭으로 제공하는 엔티티 앵커 타입 — GpuDevice/Node 만 전량 메트릭을 emit.
const METRIC_ENTITY_TYPES: OntologyObject["type"][] = ["GpuDevice", "Node"];

// IMP-77 — 드로어가 '열려 있을 때만' 폴링(감지 신선도 vs 비용 균형, IMP-51 규약과 동일 15s). 닫히면 폴링 정지.
const REFRESH_MS = 15_000;

// head 로드 결과(canonical + 관계 + 이웃 해석 인덱스). 미존재 id(404)는 throw 대신 obj=null 로 소비(빈 상태).
interface HeadData {
  obj: OntologyObject | null;
  links: OntologyLink[];
  index: Record<string, OntologyObject>;
}

// 어느 페이지든 붙이는 ObjectView URL 배선 훅(IMP-57) — obj/objstack 를 단일 출처로.
//  open(id): 진입점에서 특정 객체를 연다. close(): 닫는다. <ObjectView {...props}/> 로 스프레드.
export function useObjectView() {
  const [state, patch] = useUrlState(objectViewSchema);
  const objectId = state.obj || null;
  const open = useCallback((id: string) => patch({ obj: id, objstack: [] }), [patch]);
  const onClose = useCallback(() => patch({ obj: "", objstack: [] }), [patch]);
  const onStackChange = useCallback((stack: string[], head: string) => patch({ obj: head, objstack: stack }), [patch]);
  return {
    objectId,
    open,
    props: { objectId, stack: state.objstack, onClose, onStackChange } as Pick<ObjectViewProps, "objectId" | "stack" | "onClose" | "onStackChange">,
  };
}

// 타입별 두드러진 metric prop 키(있으면 header 카드에). 글리프/라벨/색은 objectTypeVisual(단일 출처, IMP-64).
const TYPE_METRICS: Record<OntologyObject["type"], string[]> = {
  Model: ["replicas", "context_window"],
  Endpoint: ["replicas", "namespace"],
  Service: ["qps", "error_rate"],
  GpuDevice: ["gpu_util", "mem_perc"],
  Node: ["cpu_perc", "mem_perc"],
  Trace: ["total_ms", "ttft_ms"],
  Incident: ["severity", "count"],
  App: ["endpoints", "request_count"], // IMP-89 — 라우팅 EP 수 · 요청 건수(라우팅 요약)
};

// linkKind → Related 섹션 라벨 + 방향 지시자(IMP-64). dir 는 head 기준 "대표" 방향의 의미 화살표:
//  serves(↑ 상류 소비)·routedTo(↑)·consumes(↑) / runsOn(⇊ 하류 자원)·executedOn(⇊)·hostedBy(⇊) / affects(⇢ 영향).
//  실제 엣지 방향(out/in)은 이웃 행별로 계산해 함께 표시(→/←) — 여기 dir 은 관계 의미의 위계 방향.
const LINK_META: Record<LinkKind, { label: string; dir: string; hint: string }> = {
  serves: { label: "서빙 모델", dir: "↑", hint: "상류" },
  runsOn: { label: "실행 GPU", dir: "⇊", hint: "하류" },
  hostedBy: { label: "호스트 노드", dir: "⇊", hint: "하류" },
  routedTo: { label: "라우팅 엔드포인트", dir: "↑", hint: "상류" },
  executedOn: { label: "실행 GPU", dir: "⇊", hint: "하류" },
  consumes: { label: "소비 Service", dir: "↑", hint: "상류" },
  affects: { label: "영향 대상", dir: "⇢", hint: "영향" },
  routes: { label: "app_id 라우팅", dir: "↑", hint: "상류(소비자 앱)" }, // IMP-89 — Endpoint→App
};

// ObjectStatus → 상태 게이지 밴드 위치(IMP-64). Gauge(warn=0.75/crit=0.9/max=1) 밴드에 안착하도록:
//  ok=0.3(primary 채움) · warn=0.8(amber) · crit=1.0(red) · unknown=0(빈 트랙).
const STATUS_GAUGE_VALUE: Record<ObjectStatus, number> = { ok: 0.3, warn: 0.8, crit: 1.0, unknown: 0 };

// Related 그룹 표시 순서(Replicas/Endpoint → GPU → Service → Trace → Incident 우선순).
const KIND_ORDER: LinkKind[] = ["serves", "routes", "consumes", "routedTo", "runsOn", "executedOn", "hostedBy", "affects"];

const STATUS_TONE: Record<ObjectStatus, BadgeTone> = { ok: "green", warn: "amber", crit: "red", unknown: "neutral" };
const STATUS_LABEL: Record<ObjectStatus, string> = { ok: "정상", warn: "주의", crit: "위험", unknown: "미측정" };

// Action outcome → 감사 타임라인 배지 톤/라벨(IMP-65). ok=반영, conflict/denied=주의, error=위험.
const OUTCOME_TONE: Record<ActionOutcome, BadgeTone> = { ok: "green", conflict: "amber", denied: "amber", error: "red" };
const OUTCOME_LABEL: Record<ActionOutcome, string> = { ok: "반영됨", conflict: "충돌", denied: "거부", error: "실패" };

// 감사 시각 — 로케일 시분초(hour12=false). ISO 파싱 실패 시 원문 그대로(방어).
function fmtAuditTs(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString("ko-KR", { hour12: false });
}

function fmtVal(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// props.hw 를 GpuHardware 로 안전 추출(IMP-76). 최소 구조 검증 — 미제공/형식불일치면 null(섹션 skip).
function extractGpuHw(v: unknown): GpuHardware | null {
  if (!v || typeof v !== "object") return null;
  const hw = v as Partial<GpuHardware>;
  if (!hw.nvlink || !hw.pcie || !hw.ecc || !Array.isArray(hw.processes)) return null;
  if (typeof hw.clocks_event_reasons !== "number" || typeof hw.xid_recent !== "number") return null;
  return hw as GpuHardware;
}

interface GroupedNeighbor {
  kind: LinkKind;
  neighbors: { obj: OntologyObject; direction: "out" | "in" }[];
}

export interface ObjectViewProps {
  objectId: string | null;          // 현재 head. null 이면 패널 닫힘.
  onClose: () => void;              // 닫기(urlState obj/objstack 제거)
  onNavigateFull?: () => void;      // '전체 페이지 열기' escape hatch(선택)
  stack?: string[];                 // breadcrumb 이전 스택(deep-link 복원용, 옵션)
  onStackChange?: (stack: string[], head: string) => void; // traverse 시 상위(URL) 동기화
}

export default function ObjectView({ objectId, onClose, onNavigateFull, stack: initialStack, onStackChange }: ObjectViewProps) {
  // back 스택 — 마지막이 현재 head. 상위가 준 objectId/stack 로 시드.
  const [stack, setStack] = useState<string[]>(() => (objectId ? [...(initialStack ?? []), objectId] : []));

  // 상위에서 objectId 가 바뀌면(다른 진입점에서 새로 열기) 스택 리셋.
  useEffect(() => {
    if (objectId) setStack([...(initialStack ?? []), objectId]);
    else setStack([]);
    // initialStack 은 진입 시점 스냅샷 — objectId 변화에만 반응(무한 루프 방지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId]);

  const head = stack[stack.length - 1] ?? null;

  // IMP-65 — 이 객체에서 실행한 Action 감사 로그(세션-로컬). ActionForm.onDone 이 돌려준 res.audit 을
  // 최근 순으로 누적. head 가 바뀌면 리셋(객체별 컨텍스트). 신규 fetch endpoint 없이 기존 계약만 소비.
  const [auditLog, setAuditLog] = useState<ActionAuditEntry[]>([]);
  // IMP-71 — GpuDevice/Node 는 '요약'(기본, 큐레이션 KNOWNS)과 '전체 메트릭'(explorer, UNKNOWNS) 탭을 갖는다.
  // 요약이 DEFAULT — '전체 메트릭'은 명시적 탈출구(IMP-46 회귀 없음). head 바뀌면 요약으로 리셋.
  const [tab, setTab] = useState<"summary" | "metrics">("summary");

  // head 변경 시 객체별 로컬 컨텍스트 리셋(감사 로그·탭) — 데이터 폴링과 독립.
  useEffect(() => {
    setAuditLog([]); // 새 객체(traverse/재진입) — 감사 로그는 객체별 컨텍스트.
    setTab("summary"); // 새 객체는 큐레이션 요약이 기본(IMP-71 — explorer 는 명시적 탈출구).
  }, [head]);

  // head 의 canonical + 관계 + 이웃 해석 인덱스 로드를 IMP-51 폴링 규약으로 승격(IMP-77).
  //  - deps:[head] → traverse/재진입 시 즉시 재로드. enabled:!!head → 드로어 닫히면 폴링 정지(hammering 방지).
  //  - 미존재 id(404)는 throw 대신 obj=null 로 소비(빈 상태) — usePolling 의 error 로 올리지 않는다.
  const poll = usePolling<HeadData>(
    async (signal) => {
      if (!head) return { obj: null, links: [], index: {} };
      try {
        const [o, lr, list] = await Promise.all([
          fetchOntologyObject(head, signal),
          fetchOntologyLinks(head, undefined, signal),
          fetchOntologyObjects(undefined, undefined, signal),
        ]);
        const idx: Record<string, OntologyObject> = {};
        for (const it of list.objects) idx[it.id] = it;
        return { obj: o, links: lr.links, index: idx };
      } catch (e) {
        if ((e as Error)?.name === "AbortError" || signal.aborted) throw e;
        // 미존재 id(404) 등 — 빈 상태로 소비(throw 안 함 → error 배지 대신 '찾을 수 없음').
        if (!(e instanceof Error) || !/404/.test(e.message)) console.warn("[ObjectView] 로드 실패", e);
        return { obj: null, links: [], index: {} };
      }
    },
    { intervalMs: REFRESH_MS, deps: [head], enabled: !!head },
  );

  const obj = poll.data?.obj ?? null;
  const links = useMemo(() => poll.data?.links ?? [], [poll.data]);
  const index = useMemo(() => poll.data?.index ?? {}, [poll.data]);
  const loading = poll.loading;
  // 미존재 — 로드가 끝났는데(데이터 도착) obj 가 null. head 없거나 로딩 중엔 미표시.
  const missing = !!head && poll.data != null && poll.data.obj == null;

  // 이웃을 linkKind 로 그룹화(head 기준 방향 유지). 인덱스에 있는 실재 객체만.
  const groups = useMemo<GroupedNeighbor[]>(() => {
    if (!head) return [];
    const byKind = new Map<LinkKind, { obj: OntologyObject; direction: "out" | "in" }[]>();
    for (const l of links) {
      const otherId = l.from === head ? l.to : l.from;
      const other = index[otherId];
      if (!other) continue;
      const direction: "out" | "in" = l.from === head ? "out" : "in";
      const arr = byKind.get(l.linkKind) ?? [];
      arr.push({ obj: other, direction });
      byKind.set(l.linkKind, arr);
    }
    return KIND_ORDER.filter((k) => byKind.has(k)).map((k) => ({ kind: k, neighbors: byKind.get(k)! }));
  }, [links, index, head]);

  // 대상 type 에 유효한 Action 목록(레지스트리 target 매칭). 게이팅은 ActionForm 이 담당.
  const actions = useMemo(
    () => (obj ? Object.values(ACTION_REGISTRY).filter((s) => s.target === obj.type) : []),
    [obj],
  );

  // traverse — 이웃 push. URL 동기화.
  const traverse = useCallback(
    (id: string) => {
      setStack((prev) => {
        const next = [...prev, id];
        onStackChange?.(next.slice(0, -1), id);
        return next;
      });
    },
    [onStackChange],
  );

  // back — pop(스택에 이전이 있을 때만).
  const back = useCallback(() => {
    setStack((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      onStackChange?.(next.slice(0, -1), next[next.length - 1]);
      return next;
    });
  }, [onStackChange]);

  // Action 반영 후 canonical 갱신 → 현재 head 재로딩(리렌더). 폴링 규약의 reload 재사용(IMP-77).
  const reloadHead = useCallback(() => {
    if (!head) return;
    poll.reload();
  }, [head, poll]);

  if (!objectId) return null;

  const vis = obj ? typeVisual(obj.type) : null;
  const metricKeys = obj ? TYPE_METRICS[obj.type] : null;
  const crumbs = stack.map((id) => index[id]?.title ?? id);
  // GpuDevice props 에 mock 이 얹은 중첩 GpuHardware(IMP-76). 구조 최소검증(nvlink 유무)으로 실백엔드/레거시 방어.
  const gpuHw = extractGpuHw(obj?.props.hw);
  // IMP-71 — 이 객체가 전량 메트릭을 emit 하는 엔티티 앵커(GpuDevice/Node)인지. 아니면 탭 미표시.
  const supportsMetrics = !!obj && METRIC_ENTITY_TYPES.includes(obj.type);

  return (
    <SlidePanel
      open={!!objectId}
      width={560}
      title={
        <span className="ov-title">
          {vis && (
            <span
              className={`ov-glyph ${vis.className}`}
              style={{ color: vis.color }}
              aria-hidden="true"
            >
              {vis.glyph}
            </span>
          )}
          <span>{obj ? obj.title : head}</span>
        </span>
      }
      subtitle={obj ? `${vis!.label} · rev ${obj.revision}` : undefined}
      onClose={onClose}
      footer={
        <div className="ov-foot">
          {onNavigateFull && (
            <button type="button" className="btn-ghost btn-sm" onClick={onNavigateFull}>전체 페이지 열기 →</button>
          )}
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>ontology object · in-place traverse</span>
        </div>
      }
    >
      {/* breadcrumb — traverse 경로. 마지막(현재)은 강조, 이전은 back 으로. */}
      {stack.length > 1 && (
        <nav className="ov-crumbs" aria-label="탐색 경로">
          <button type="button" className="btn-ghost btn-sm ov-back" onClick={back} aria-label="이전 객체로">← 뒤로</button>
          <ol>
            {crumbs.map((c, i) => (
              <li key={`${c}-${i}`} aria-current={i === crumbs.length - 1 ? "true" : undefined}>
                {i > 0 && <span className="ov-crumb-sep" aria-hidden="true">/</span>}
                <span className={i === crumbs.length - 1 ? "ov-crumb-cur" : "ov-crumb"}>{c}</span>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {/* IMP-77 — 드로어도 IMP-51 신선도 규약: 최종 갱신 + 자동 갱신 표기 + 정지/재개(열려 있을 때만 폴링).
          객체가 로드됐을 때만 표기(빈/로딩 상태에서는 잡음 억제). stale 시 마지막 데이터 유지. */}
      {obj && (
        <div className="ov-freshness">
          <DataFreshness updatedAt={poll.lastLoaded} intervalMs={REFRESH_MS} />
          <PauseToggle paused={poll.paused} onToggle={() => poll.setPaused(!poll.paused)} />
          {poll.isStale && <span className="state-stale" role="status"> · 마지막 데이터 표시 중</span>}
        </div>
      )}

      {loading && !obj && <div className="empty" role="status">불러오는 중…</div>}

      {missing && !obj && (
        <div className="empty" role="alert">객체를 찾을 수 없습니다: <code>{head}</code></div>
      )}

      {obj && vis && metricKeys && (
        <>
          {/* (1) Header — elevated 카드(IMP-64): 타입 칩(글리프+색 위계) + 상태 게이지 밴드 + 두드러진 metric. */}
          <div className="ov-header-card">
            <div className="ov-type-row">
              {/* 타입 칩 — 색으로 noun-type 위계(objectTypeVisual 단일 출처). */}
              <span
                className={`otype-chip ${vis.className}`}
                style={{ ["--otype-color" as string]: vis.color, ["--otype-tint" as string]: vis.tint }}
              >
                <span className="otype-chip-glyph" aria-hidden="true">{vis.glyph}</span>
                {vis.label}
              </span>
              {/* 상태 밴드 — 게이지(IMP-54)로 강도 인코딩 + 텍스트 Badge 병기(색-only 금지, WCAG 1.4.1). */}
              <div className="ov-status-band">
                <Badge tone={STATUS_TONE[obj.status]} dot>{STATUS_LABEL[obj.status]}</Badge>
                {obj.status !== "unknown" && (
                  <Gauge
                    value={STATUS_GAUGE_VALUE[obj.status]}
                    warn={0.75}
                    crit={0.9}
                    max={1}
                    valueText={STATUS_LABEL[obj.status]}
                    label="상태"
                    height={6}
                  />
                )}
              </div>
            </div>
            <div className="ov-metrics">
              {metricKeys
                .filter((k) => obj.props[k] != null && obj.props[k] !== "")
                .map((k) => (
                  <div className="ov-metric" key={k}>
                    <span className="ov-metric-v">{fmtVal(obj.props[k])}</span>
                    <span className="ov-metric-k">{k}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* IMP-71 — GpuDevice/Node 는 '요약'(기본 KNOWNS)·'전체 메트릭'(explorer UNKNOWNS) 탭. 그 외 타입은 탭 없이 요약만. */}
          {supportsMetrics && (
            <div className="me-tabs modality-tabs" role="tablist" aria-label="객체 보기">
              <button
                type="button" role="tab" aria-selected={tab === "summary"}
                className={`modality-tab ${tab === "summary" ? "active" : ""}`}
                onClick={() => setTab("summary")}
              >요약</button>
              <button
                type="button" role="tab" aria-selected={tab === "metrics"}
                className={`modality-tab ${tab === "metrics" ? "active" : ""}`}
                onClick={() => setTab("metrics")}
              >전체 메트릭</button>
            </div>
          )}

          {/* '전체 메트릭' 탭 — 엔티티 앵커 Metric Explorer(전량 드릴다운). 요약은 아래에서 tab==summary 일 때만. */}
          {supportsMetrics && tab === "metrics" && <MetricExplorer entityId={obj.id} />}

          {(!supportsMetrics || tab === "summary") && (
          <>
          {/* (2) Properties — props 를 DetailRow 로. 중첩 hw(하드웨어 상세)는 아래 전용 섹션이 렌더하므로 제외. */}
          <section className="ov-section" aria-label="속성">
            <h4 className="ov-h">속성</h4>
            <DetailRow label="id">{obj.id}</DetailRow>
            <DetailRow label="종류">{vis.label}</DetailRow>
            {Object.entries(obj.props)
              .filter(([k]) => k !== "hw")
              .map(([k, v]) => (
                <DetailRow key={k} label={k}>{fmtVal(v)}</DetailRow>
              ))}
          </section>

          {/* (2b) GPU 하드웨어(IMP-76) — GpuDevice 이고 props.hw(GpuHardware)가 있으면 전용 섹션.
              XID·throttle reason·NVLink·PCIe·ECC·clock 을 그룹+단위+뱃지로. 없으면(레거시/실백엔드) skip. */}
          {obj.type === "GpuDevice" && gpuHw && <GpuHardwareSection hw={gpuHw} />}

          {/* (3) Related — linkKind 그룹. 이웃 클릭 → in-place traverse. */}
          <section className="ov-section" aria-label="관계">
            <h4 className="ov-h">관계</h4>
            {groups.length === 0 ? (
              <div className="empty">인접 객체가 없습니다.</div>
            ) : (
              groups.map((g) => {
                const lm = LINK_META[g.kind];
                return (
                  <div className="ov-group" key={g.kind}>
                    {/* 그룹 헤더 — linkKind 방향 지시자(의미 화살표 + 관계 라벨). IMP-64. */}
                    <div className="ov-group-h">
                      <span className="ov-link-dir" title={`${g.kind} · ${lm.hint}`}>
                        <span className="ov-link-arrow" aria-hidden="true">{lm.dir}</span>
                        {lm.label}
                      </span>
                      <span className="ov-count">{g.neighbors.length}</span>
                    </div>
                    <ul className="ov-neighbors">
                      {g.neighbors.map(({ obj: n, direction }) => {
                        const nv = typeVisual(n.type);
                        return (
                          <li key={n.id}>
                            <button
                              type="button"
                              className="ov-neighbor"
                              onClick={() => traverse(n.id)}
                              title={`${nv.label} · ${n.id}`}
                            >
                              <span className={`ov-neighbor-glyph ${nv.className}`} style={{ color: nv.color }} aria-hidden="true">{nv.glyph}</span>
                              <span className="ov-neighbor-title">{n.title}</span>
                              <span className={`ov-dot ov-dot-${n.status}`} aria-hidden="true" />
                              <span className="ov-neighbor-type">{nv.label}</span>
                              {/* auto/manual 구분 — 현 mock 은 전부 파생(auto). */}
                              <span className="ov-rel-src" title="파생 관계(auto)">auto</span>
                              <span className="ov-neighbor-dir" aria-hidden="true">{direction === "out" ? "→" : "←"}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })
            )}
          </section>

          {/* (4) Actions — 대상 type 유효 verb. 게이팅(observe disabled+사유)은 ActionForm 담당. */}
          {actions.length > 0 && (
            <section className="ov-section" aria-label="액션">
              <h4 className="ov-h">액션</h4>
              <div className="ov-actions">
                {actions.map((a) => (
                  <ActionForm
                    key={a.name}
                    actionType={a.name}
                    target={obj.id}
                    targetStatus={obj.status}
                    revision={obj.revision}
                    onDone={(res) => {
                      // 감사 타임라인에 최근 순 누적(성공/실패 모두 — 시도 자체가 기록 대상).
                      setAuditLog((l) => [res.audit, ...l]);
                      if (res.outcome === "ok") reloadHead();
                    }}
                  />
                ))}
              </div>
            </section>
          )}

          {/* (5) 실행 이력 — IMP-65: IncidentAuditEntry(IMP-38) 시각 패턴을 세로 타임라인으로.
              누가·언제·무엇을. flat list 아님 — 좌측 rail + outcome 색 dot. 비어 있으면 미표시. */}
          {auditLog.length > 0 && (
            <section className="ov-section" aria-label="실행 이력">
              <h4 className="ov-h">실행 이력</h4>
              <ol className="audit-timeline">
                {auditLog.map((a, i) => {
                  const label = getActionSpec(a.actionType)?.label ?? a.actionType;
                  return (
                    <li className={`audit-item audit-${a.outcome}`} key={`${a.ts}-${i}`}>
                      <span className="audit-rail" aria-hidden="true">
                        <span className={`audit-dot audit-dot-${a.outcome}`} />
                      </span>
                      <div className="audit-body">
                        <div className="audit-line">
                          <span className="audit-verb">{label}</span>
                          <Badge tone={OUTCOME_TONE[a.outcome]} dot>{OUTCOME_LABEL[a.outcome]}</Badge>
                        </div>
                        <div className="audit-meta">
                          <span className="audit-actor">{a.actor}</span>
                          <span className="audit-sep" aria-hidden="true">·</span>
                          <time className="audit-ts" dateTime={a.ts}>{fmtAuditTs(a.ts)}</time>
                        </div>
                        {a.note && <div className="audit-note">{a.note}</div>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
          </>
          )}
        </>
      )}
    </SlidePanel>
  );
}
