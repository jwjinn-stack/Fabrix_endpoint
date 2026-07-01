// IMP-69 — Action Inbox (PROCESS 레이어 진입점).
// docs/ontology-usecase-comparison.md §1B·§4 (Palantir operational-process-coordination).
// 실사례가 만장일치로 취하는 과업-앵커 진입점: "내게 할당된 운영 과업 큐" → 컨텍스트에서 온톨로지(디지털트윈)
// 탐색 → 조치 → **process 층 + subject-matter 층 양쪽에 writeback**. 우리 subject-matter 그래프(IMP-56) 위에
// Task(assignee·priority·status·workflow, IMP-69)를 얹어 "오퍼레이터가 오늘 무엇을 해야 하나"에 답한다.
//
//   LEFT  : Task 큐(assignee/priority/status 필터). 행 = priority chip + status badge + title + 연결 수.
//   CENTER: 선택 Task — workflow 스텝퍼(순차 단계) + 담당자 + 연결 subject-matter 객체(클릭→ObjectView) + Task Action.
//   RIGHT : ObjectView(IMP-57) 슬라이드 — 연결 객체 in-context 탐색 + 그 객체의 인라인 Action(IMP-59, subject-matter writeback).
//
// mock-first · Backend.AI 라이트+스틸블루 토큰 · ObjectView/ActionForm/registry 게이팅 재사용(재작성 없음).
import { useCallback, useMemo } from "react";
import { fetchOntologyObjects } from "../api/client";
import type { OntologyObject, TaskProps, TaskPriority, TaskStatus } from "../api/types";
import { ACTION_REGISTRY } from "../actions/registry";
import { typeVisual } from "../api/objectTypeVisual";
import { usePolling } from "../utils/usePolling";
import { inboxSchema, useUrlState } from "../urlState";
import Badge, { type BadgeTone } from "../components/Badge";
import { SkeletonCards } from "../components/Skeleton";
import DataFreshness from "../components/DataFreshness";
import ActionForm from "../components/ActionForm";
import ObjectView, { useObjectView } from "../components/ObjectView";
import type { NavFn } from "../router";

const REFRESH_MS = 15_000;

// PROCESS 층 워크플로 단계(순차) — mock INCIDENT_WORKFLOW 와 동일 순서(표시용 단일 출처).
const WORKFLOW_STEPS: { key: TaskStatus; label: string }[] = [
  { key: "triaged", label: "분류" },
  { key: "assigned", label: "배정" },
  { key: "in-progress", label: "조치 중" },
  { key: "resolved", label: "해소" },
];

const PRIORITY_LABEL: Record<TaskPriority, string> = { urgent: "긴급", high: "높음", med: "보통", low: "낮음" };
const PRIORITY_TONE: Record<TaskPriority, BadgeTone> = { urgent: "red", high: "amber", med: "blue", low: "neutral" };
// priority 정렬 가중치(큐는 급한 것부터). urgent=0 이 맨 위.
const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, med: 2, low: 3 };

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "미분류", triaged: "분류됨", assigned: "배정됨", "in-progress": "조치 중", resolved: "해소됨",
};
const STATUS_TONE: Record<TaskStatus, BadgeTone> = {
  open: "neutral", triaged: "blue", assigned: "amber", "in-progress": "amber", resolved: "green",
};

// OntologyObject → TaskProps 안전 추출(Task 타입만; 그 외/형식불일치는 null).
function taskProps(o: OntologyObject): TaskProps | null {
  if (o.type !== "Task") return null;
  const p = o.props as Partial<TaskProps>;
  if (typeof p.status !== "string" || typeof p.priority !== "string") return null;
  return o.props as TaskProps;
}

export default function Inbox({ onNavigate: _onNavigate }: { onNavigate?: NavFn }) {
  const [url, patchUrl] = useUrlState(inboxSchema);
  const view = useObjectView(); // RIGHT: 연결 객체 클릭 → ObjectView(IMP-57) + inline Action(IMP-59)

  // Task 큐 + 전체 객체(연결 subject-matter 해석 인덱스)를 한 번에 로드(IMP-51 폴링 관례).
  const poll = usePolling(
    async (signal) => {
      const [tasks, all] = await Promise.all([
        fetchOntologyObjects("Task", undefined, signal),
        fetchOntologyObjects(undefined, undefined, signal),
      ]);
      return { tasks: tasks.objects, all: all.objects };
    },
    { intervalMs: REFRESH_MS },
  );

  const tasks = poll.data?.tasks ?? [];
  const objIndex = useMemo(() => {
    const idx: Record<string, OntologyObject> = {};
    for (const o of poll.data?.all ?? []) idx[o.id] = o;
    return idx;
  }, [poll.data]);

  // 담당자 필터 후보(큐에 등장하는 assignee) — "all" + 실재 담당자.
  const assignees = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      const p = taskProps(t);
      if (p?.assignee) set.add(p.assignee);
    }
    return Array.from(set).sort();
  }, [tasks]);

  // 필터 + 정렬(급한 것 먼저, 그다음 미해소 우선). 결정적.
  const filtered = useMemo(() => {
    const rows = tasks
      .map((t) => ({ obj: t, p: taskProps(t) }))
      .filter((r): r is { obj: OntologyObject; p: TaskProps } => r.p != null)
      .filter((r) => url.assignee === "all" || r.p.assignee === url.assignee)
      .filter((r) => url.priority === "all" || r.p.priority === url.priority)
      .filter((r) => url.status === "all" || r.p.status === url.status);
    rows.sort((a, b) => {
      // 해소된 과업은 아래로.
      const ar = a.p.status === "resolved" ? 1 : 0;
      const br = b.p.status === "resolved" ? 1 : 0;
      if (ar !== br) return ar - br;
      const pr = PRIORITY_RANK[a.p.priority] - PRIORITY_RANK[b.p.priority];
      if (pr !== 0) return pr;
      return a.obj.id < b.obj.id ? -1 : 1; // 안정 정렬(id tie-break)
    });
    return rows;
  }, [tasks, url.assignee, url.priority, url.status]);

  // 선택 Task — URL(task) 단일 출처. 빈 값/미존재면 필터 목록의 첫 과업(가장 급한 미해소).
  const selectedId = url.task || filtered[0]?.obj.id || null;
  const selected = selectedId ? tasks.find((t) => t.id === selectedId) ?? null : null;
  const selProps = selected ? taskProps(selected) : null;

  const selectTask = useCallback((id: string) => patchUrl({ task: id }), [patchUrl]);

  // 선택 Task 에 유효한 Action(레지스트리 target=Task). 게이팅은 ActionForm 이 담당(observe disabled+사유).
  const taskActions = useMemo(() => Object.values(ACTION_REGISTRY).filter((s) => s.target === "Task"), []);

  // 연결 subject-matter 객체(linkedObjectIds → 인덱스 해석). 미해석 id 는 표시에서 생략(무결성).
  const linkedObjects = useMemo(() => {
    if (!selProps) return [];
    return selProps.linkedObjectIds.map((id) => objIndex[id]).filter((o): o is OntologyObject => !!o);
  }, [selProps, objIndex]);

  // 큐 카운트(요약) — 미해소 / 긴급.
  const openCount = filtered.filter((r) => r.p.status !== "resolved").length;
  const urgentCount = filtered.filter((r) => r.p.priority === "urgent" && r.p.status !== "resolved").length;

  return (
    <>
      <div className="page-head">
        <h1>과업 인박스</h1>
        <span className="crumb">추적 / 할당된 운영 과업 (PROCESS 레이어)</span>
        <div className="spacer" />
        <DataFreshness updatedAt={poll.lastLoaded} intervalMs={REFRESH_MS} />
        <button type="button" className="btn-ghost" onClick={() => poll.reload()} disabled={poll.loading}>
          {poll.loading ? "불러오는 중…" : "새로고침"}
        </button>
      </div>

      <p className="muted" style={{ marginTop: -4, fontSize: "var(--fs-body)" }}>
        내게 할당된 과업을 골라 연결된 객체(디지털트윈)를 탐색하고 조치하면 <b>과업(PROCESS) 층</b>과
        <b> 대상 객체(SUBJECT-MATTER) 층</b> 양쪽에 반영됩니다. Palantir Action Inbox 패턴.
      </p>

      {poll.error && !poll.data && (
        <div className="empty" role="alert">과업을 불러오지 못했습니다: {poll.error}</div>
      )}
      {poll.loading && !poll.data && <SkeletonCards count={3} />}

      {poll.data && (
        <div className="inbox-grid">
          {/* LEFT — 과업 큐 + 필터 */}
          <section className="inbox-queue" aria-label="과업 큐">
            <div className="inbox-summary">
              <span className="inbox-summary-n">{openCount}</span>
              <span className="inbox-summary-l">미해소 과업</span>
              {urgentCount > 0 && <Badge tone="red" dot>긴급 {urgentCount}</Badge>}
            </div>

            <div className="inbox-filters" role="group" aria-label="과업 필터">
              <label className="inbox-filter">
                <span>담당자</span>
                <select value={url.assignee} onChange={(e) => patchUrl({ assignee: e.target.value })}>
                  <option value="all">전체</option>
                  {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
              <label className="inbox-filter">
                <span>우선순위</span>
                <select value={url.priority} onChange={(e) => patchUrl({ priority: e.target.value as TaskPriority | "all" })}>
                  <option value="all">전체</option>
                  <option value="urgent">긴급</option>
                  <option value="high">높음</option>
                  <option value="med">보통</option>
                  <option value="low">낮음</option>
                </select>
              </label>
              <label className="inbox-filter">
                <span>상태</span>
                <select value={url.status} onChange={(e) => patchUrl({ status: e.target.value as TaskStatus | "all" })}>
                  <option value="all">전체</option>
                  <option value="triaged">분류됨</option>
                  <option value="assigned">배정됨</option>
                  <option value="in-progress">조치 중</option>
                  <option value="resolved">해소됨</option>
                </select>
              </label>
            </div>

            {filtered.length === 0 ? (
              <div className="empty" role="status">조건에 맞는 과업이 없습니다.</div>
            ) : (
              <ul className="inbox-list">
                {filtered.map(({ obj, p }) => (
                  <li key={obj.id}>
                    <button
                      type="button"
                      className={`inbox-item ${obj.id === selectedId ? "active" : ""}`}
                      aria-current={obj.id === selectedId ? "true" : undefined}
                      onClick={() => selectTask(obj.id)}
                    >
                      <div className="inbox-item-top">
                        <Badge tone={PRIORITY_TONE[p.priority]} dot>{PRIORITY_LABEL[p.priority]}</Badge>
                        <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                      </div>
                      <div className="inbox-item-title">{p.title}</div>
                      <div className="inbox-item-meta">
                        <span className="inbox-assignee">{p.assignee || "미배정"}</span>
                        <span className="inbox-sep" aria-hidden="true">·</span>
                        <span>{p.linkedObjectIds.length}개 대상</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* CENTER — 선택 과업 상세: workflow 스텝퍼 + 연결 객체 + Task Action */}
          <section className="inbox-detail" aria-label="과업 상세">
            {!selected || !selProps ? (
              <div className="empty">좌측에서 과업을 선택하세요.</div>
            ) : (
              <>
                <div className="inbox-detail-head">
                  <span className={`otype-chip ${typeVisual("Task").className}`}
                    style={{ ["--otype-color" as string]: typeVisual("Task").color, ["--otype-tint" as string]: typeVisual("Task").tint }}>
                    <span className="otype-chip-glyph" aria-hidden="true">{typeVisual("Task").glyph}</span>
                    과업
                  </span>
                  <Badge tone={PRIORITY_TONE[selProps.priority]} dot>{PRIORITY_LABEL[selProps.priority]}</Badge>
                  <Badge tone={STATUS_TONE[selProps.status]}>{STATUS_LABEL[selProps.status]}</Badge>
                </div>
                <h2 className="inbox-detail-title">{selProps.title}</h2>
                <div className="inbox-detail-meta">
                  담당자 <b>{selProps.assignee || "미배정"}</b>
                  <span className="inbox-sep" aria-hidden="true">·</span>
                  생성 <time dateTime={selProps.createdAt}>{fmtTs(selProps.createdAt)}</time>
                </div>

                {/* Workflow 스텝퍼 — 순차 단계. 현재(=workflowStepIndex) 이하 done, 현재 강조. */}
                <ol className="inbox-steps" aria-label="워크플로 단계">
                  {WORKFLOW_STEPS.map((s, i) => {
                    const cur = i === selProps.workflowStepIndex;
                    const done = i < selProps.workflowStepIndex;
                    return (
                      <li key={s.key} className={`inbox-step ${cur ? "current" : ""} ${done ? "done" : ""}`}
                        aria-current={cur ? "step" : undefined}>
                        <span className="inbox-step-dot" aria-hidden="true">{done ? "✓" : i + 1}</span>
                        <span className="inbox-step-label">{s.label}</span>
                      </li>
                    );
                  })}
                </ol>

                {/* 연결 subject-matter 객체(디지털트윈) — 클릭 시 ObjectView 로 in-context 탐색. */}
                <section className="inbox-linked" aria-label="연결 객체">
                  <h3 className="inbox-h">연결 객체 <span className="inbox-count">{linkedObjects.length}</span></h3>
                  {linkedObjects.length === 0 ? (
                    <div className="empty">연결된 대상 객체가 없습니다.</div>
                  ) : (
                    <ul className="inbox-linked-list">
                      {linkedObjects.map((o) => {
                        const nv = typeVisual(o.type);
                        return (
                          <li key={o.id}>
                            <button type="button" className="inbox-linked-item" onClick={() => view.open(o.id)}
                              title={`${nv.label} · ${o.id}`}>
                              <span className={`inbox-linked-glyph ${nv.className}`} style={{ color: nv.color }} aria-hidden="true">{nv.glyph}</span>
                              <span className="inbox-linked-title">{o.title}</span>
                              <span className={`ov-dot ov-dot-${o.status}`} aria-hidden="true" />
                              <span className="inbox-linked-type">{nv.label}</span>
                              <span className="inbox-linked-go" aria-hidden="true">→</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                {/* Task Action(process 층 writeback) — assign/reassign/resolveTask. 게이팅은 ActionForm 담당. */}
                <section className="inbox-actions" aria-label="과업 조치">
                  <h3 className="inbox-h">조치</h3>
                  <div className="ov-actions">
                    {taskActions.map((a) => (
                      <ActionForm
                        key={a.name}
                        actionType={a.name}
                        target={selected.id}
                        targetStatus={selected.status}
                        revision={selected.revision}
                        onDone={(res) => { if (res.outcome === "ok") poll.reload(); }}
                      />
                    ))}
                  </div>
                </section>
              </>
            )}
          </section>
        </div>
      )}

      {/* RIGHT — 연결 객체 in-context 탐색(ObjectView). 그 객체의 인라인 Action = subject-matter writeback. */}
      <ObjectView {...view.props} />
    </>
  );
}

// 생성/할당 시각 — 로케일 날짜+시분(ISO 파싱 실패 시 원문 방어).
function fmtTs(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
