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
import type { LinkKind, ObjectStatus, ObjectType, OntologyLink, OntologyObject } from "../api/types";
import { ACTION_REGISTRY } from "../actions/registry";
import { objectViewSchema, useUrlState } from "../urlState";
import SlidePanel, { DetailRow } from "./SlidePanel";
import Badge, { type BadgeTone } from "./Badge";
import ActionForm from "./ActionForm";

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

// 타입별 표시 — 글리프(무채색 이모지, 네온 금지)·라벨·두드러진 metric prop 키(있으면 header 카드에).
const TYPE_META: Record<ObjectType, { glyph: string; label: string; metrics: string[] }> = {
  Model: { glyph: "◆", label: "모델", metrics: ["replicas", "context_window"] },
  Endpoint: { glyph: "▣", label: "엔드포인트", metrics: ["replicas", "namespace"] },
  Service: { glyph: "◈", label: "서비스", metrics: ["qps", "error_rate"] },
  GpuDevice: { glyph: "▤", label: "GPU", metrics: ["gpu_util", "mem_perc"] },
  Node: { glyph: "▥", label: "노드", metrics: ["cpu_perc", "mem_perc"] },
  Trace: { glyph: "≣", label: "트레이스", metrics: ["total_ms", "ttft_ms"] },
  Incident: { glyph: "▲", label: "인시던트", metrics: ["severity", "count"] },
};

// linkKind → Related 섹션 라벨. 방향은 mock 기준(가장 흔한 인접) — 표시는 관계 이름만.
const LINK_LABEL: Record<LinkKind, string> = {
  serves: "서빙 모델",
  runsOn: "실행 GPU",
  hostedBy: "호스트 노드",
  routedTo: "라우팅 엔드포인트",
  executedOn: "실행 GPU",
  consumes: "소비 Service",
  affects: "영향 대상",
};

// Related 그룹 표시 순서(Replicas/Endpoint → GPU → Service → Trace → Incident 우선순).
const KIND_ORDER: LinkKind[] = ["serves", "consumes", "routedTo", "runsOn", "executedOn", "hostedBy", "affects"];

const STATUS_TONE: Record<ObjectStatus, BadgeTone> = { ok: "green", warn: "amber", crit: "red", unknown: "neutral" };
const STATUS_LABEL: Record<ObjectStatus, string> = { ok: "정상", warn: "주의", crit: "위험", unknown: "미측정" };

function fmtVal(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
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

  const [obj, setObj] = useState<OntologyObject | null>(null);
  const [index, setIndex] = useState<Record<string, OntologyObject>>({});
  const [links, setLinks] = useState<OntologyLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);

  // head 변경 시 canonical + 관계 + 이웃 해석 인덱스 로드.
  useEffect(() => {
    if (!head) return;
    const ac = new AbortController();
    setLoading(true);
    setMissing(false);
    Promise.all([
      fetchOntologyObject(head, ac.signal),
      fetchOntologyLinks(head, undefined, ac.signal),
      fetchOntologyObjects(undefined, undefined, ac.signal),
    ])
      .then(([o, lr, list]) => {
        if (ac.signal.aborted) return;
        setObj(o);
        setLinks(lr.links);
        const idx: Record<string, OntologyObject> = {};
        for (const it of list.objects) idx[it.id] = it;
        setIndex(idx);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        // 미존재 id(404) 등 — 빈 상태로 소비(throw 안 함).
        setObj(null);
        setLinks([]);
        setMissing(true);
        if (!(e instanceof Error) || !/404/.test(e.message)) console.warn("[ObjectView] 로드 실패", e);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [head]);

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

  // Action 반영 후 canonical 갱신 → 현재 head 재로딩(리렌더).
  const reloadHead = useCallback(() => {
    if (!head) return;
    fetchOntologyObject(head).then(setObj).catch(() => { /* keep */ });
  }, [head]);

  if (!objectId) return null;

  const meta = obj ? TYPE_META[obj.type] : null;
  const crumbs = stack.map((id) => index[id]?.title ?? id);

  return (
    <SlidePanel
      open={!!objectId}
      width={560}
      title={
        <span className="ov-title">
          {meta && <span className="ov-glyph" aria-hidden="true">{meta.glyph}</span>}
          <span>{obj ? obj.title : head}</span>
        </span>
      }
      subtitle={obj ? `${TYPE_META[obj.type].label} · rev ${obj.revision}` : undefined}
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

      {loading && !obj && <div className="empty" role="status">불러오는 중…</div>}

      {missing && !obj && (
        <div className="empty" role="alert">객체를 찾을 수 없습니다: <code>{head}</code></div>
      )}

      {obj && meta && (
        <>
          {/* (1) Header — elevated 카드: 상태 Badge + 두드러진 metric(있는 것만). */}
          <div className="ov-header-card">
            <Badge tone={STATUS_TONE[obj.status]} dot>{STATUS_LABEL[obj.status]}</Badge>
            <div className="ov-metrics">
              {meta.metrics
                .filter((k) => obj.props[k] != null && obj.props[k] !== "")
                .map((k) => (
                  <div className="ov-metric" key={k}>
                    <span className="ov-metric-v">{fmtVal(obj.props[k])}</span>
                    <span className="ov-metric-k">{k}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* (2) Properties — props 전부를 DetailRow 로. */}
          <section className="ov-section" aria-label="속성">
            <h4 className="ov-h">속성</h4>
            <DetailRow label="id">{obj.id}</DetailRow>
            <DetailRow label="종류">{meta.label}</DetailRow>
            {Object.entries(obj.props).map(([k, v]) => (
              <DetailRow key={k} label={k}>{fmtVal(v)}</DetailRow>
            ))}
          </section>

          {/* (3) Related — linkKind 그룹. 이웃 클릭 → in-place traverse. */}
          <section className="ov-section" aria-label="관계">
            <h4 className="ov-h">관계</h4>
            {groups.length === 0 ? (
              <div className="empty">인접 객체가 없습니다.</div>
            ) : (
              groups.map((g) => (
                <div className="ov-group" key={g.kind}>
                  <div className="ov-group-h">{LINK_LABEL[g.kind]} <span className="ov-count">{g.neighbors.length}</span></div>
                  <ul className="ov-neighbors">
                    {g.neighbors.map(({ obj: n, direction }) => {
                      const nm = TYPE_META[n.type];
                      return (
                        <li key={n.id}>
                          <button
                            type="button"
                            className="ov-neighbor"
                            onClick={() => traverse(n.id)}
                            title={`${nm.label} · ${n.id}`}
                          >
                            <span className="ov-neighbor-glyph" aria-hidden="true">{nm.glyph}</span>
                            <span className="ov-neighbor-title">{n.title}</span>
                            <span className={`ov-dot ov-dot-${n.status}`} aria-hidden="true" />
                            <span className="ov-neighbor-type">{nm.label}</span>
                            {/* auto/manual 구분 — 현 mock 은 전부 파생(auto). */}
                            <span className="ov-rel-src" title="파생 관계(auto)">auto</span>
                            <span className="ov-neighbor-dir" aria-hidden="true">{direction === "out" ? "→" : "←"}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
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
                    onDone={(res) => { if (res.outcome === "ok") reloadHead(); }}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </SlidePanel>
  );
}
