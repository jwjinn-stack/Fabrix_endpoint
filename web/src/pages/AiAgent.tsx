import { useCallback, useEffect, useState } from "react";
import { runAgent } from "../api/client";
import type { AgentRun, AgentStep, ObjectType, RcaCandidate } from "../api/types";
import { getActionSpec } from "../actions/registry";
import Badge, { type BadgeTone } from "../components/Badge";
import { SkeletonCards } from "../components/Skeleton";
import DataFreshness from "../components/DataFreshness";
import InfoTip from "../components/InfoTip";
import ActionForm from "../components/ActionForm";
import ObjectView, { useObjectView } from "../components/ObjectView";
import { agentSchema, useUrlState } from "../urlState";
import { humanizeError } from "../utils/errors";
import type { Page } from "../components/Layout";
import type { NavParams } from "../router";

// IMP-60 — 온톨로지 접지 AI Agent 패널(운영 에이전트, NOT 챗봇).
//   로컬 모델이 온톨로지를 tool 로 조회(read-only 자동 실행)하고, 근본원인 후보 + 실행 가능 Action 을 제안한다.
//   화면 3부: (1) intent 입력, (2) 가시적 ReAct 타임라인(reasoning→tool call(name+args)→result(objectIds)),
//   (3) confidence 순위 RCA 후보 카드(objectId 인용). 카드 클릭 → ObjectView / COP 링크.
//   **안전(two-tier)**: read tool 은 자동, mutating 은 카드의 <ActionForm> confirm + capability 게이팅으로만.
//   grounding 없으면 정적 runbook fallback(모델이 지어내지 않음). docs §3·§5.4, AWS grounded-agent Pattern 5.

// Object type 별 글리프/라벨 — ObjectView TYPE_META 와 통일(무채색, 네온 금지).
const TYPE_GLYPH: Record<ObjectType, string> = {
  Model: "◆", Endpoint: "▣", Service: "◈", GpuDevice: "▤", Node: "▥", Trace: "≣", Incident: "▲",
};
const TYPE_LABEL: Record<ObjectType, string> = {
  Model: "모델", Endpoint: "엔드포인트", Service: "서비스", GpuDevice: "GPU", Node: "노드", Trace: "트레이스", Incident: "인시던트",
};

// tool 이름 → 사람용 라벨.
const TOOL_LABEL: Record<string, string> = {
  queryObjects: "객체 조회",
  traverseLinks: "관계 추적",
  getIncidents: "인시던트 조회",
};

// confidence → 톤(높을수록 강조). 0.75+ 위험(빨강), 0.5+ 주의(주황), 그 외 중립.
function confTone(c: number): BadgeTone {
  return c >= 0.75 ? "red" : c >= 0.5 ? "amber" : "neutral";
}

// seed 시나리오 프리셋(자연어 의도) — 데모/온보딩용. 자유 입력도 가능.
const INTENT_PRESETS = [
  "가장 아픈 엔드포인트의 근본원인을 찾아줘",
  "지금 발생한 인시던트의 영향 경로를 분석해줘",
];

export default function AiAgent({ onNavigate }: { onNavigate?: (p: Page, params?: NavParams) => void }) {
  const [urlSt, patchUrl] = useUrlState(agentSchema);
  const [intent, setIntent] = useState<string>(() => urlSt.intent || INTENT_PRESETS[0]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  const view = useObjectView(); // 카드/인용 클릭 → ObjectView(IMP-57) + inline Action(IMP-59)

  // 에이전트 실행 — read tool 은 서버(mock)가 자동 실행, 응답에 mutating 없음(two-tier).
  const analyze = useCallback(
    async (intentText: string, entity?: string, signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const r = await runAgent({ intent: intentText, entity }, signal);
        setRun(r);
        setLastLoaded(Date.now());
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(humanizeError((e as Error).message));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // 최초 마운트 — URL(intent/entity)로 시드해 한 번 실행(관제 콘솔이 바로 결과를 보여준다).
  useEffect(() => {
    const ctrl = new AbortController();
    analyze(urlSt.intent || INTENT_PRESETS[0], urlSt.entity || undefined, ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = intent.trim();
      patchUrl({ intent: trimmed });
      analyze(trimmed, urlSt.entity || undefined);
    },
    [intent, urlSt.entity, patchUrl, analyze],
  );

  return (
    <>
      <div className="page-head">
        <h1>AI Agent</h1>
        <span className="crumb">인프라 · 관측 / AI Agent</span>
        <InfoTip>
          로컬 추론 모델이 온톨로지를 <b>tool 로 조회</b>(자동)해 근본원인 후보와 실행 가능한 Action 을 제안하는 <b>운영 에이전트</b>입니다.
          조회는 자동이지만 <b>변경(Action)은 반드시 확인(confirm)</b>이 필요하며, 표시는 <b>추정 근본원인</b> — 상관이 곧 인과는 아닙니다.
        </InfoTip>
        <div className="spacer" />
        <DataFreshness updatedAt={lastLoaded} intervalMs={0} />
      </div>

      {/* intent 입력 — 자연어 의도(프리셋 + 자유 입력). 제출 시 read tool 자동 실행. */}
      <form className="agent-intent" onSubmit={submit} aria-label="분석 의도">
        <label htmlFor="agent-intent-input" className="sr-only">분석 의도</label>
        <input
          id="agent-intent-input"
          type="text"
          className="agent-intent-input"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="예: 가장 아픈 엔드포인트의 근본원인을 찾아줘"
          aria-label="분석 의도 입력"
        />
        <button type="submit" className="btn-primary" disabled={loading || !intent.trim()}>
          {loading ? "분석 중…" : "분석 실행"}
        </button>
      </form>
      <div className="agent-presets" role="group" aria-label="예시 의도">
        {INTENT_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`pill ${intent === p ? "active" : ""}`}
            onClick={() => { setIntent(p); patchUrl({ intent: p }); analyze(p, urlSt.entity || undefined); }}
          >
            {p}
          </button>
        ))}
      </div>

      {error && <div className="state error" role="alert">에이전트 실행에 실패했습니다. ({error})</div>}
      {!error && loading && !run && <SkeletonCards count={3} />}

      {!error && run && (
        <div className="agent-grid">
          {/* LEFT — 가시적 ReAct 타임라인 */}
          <section className="agent-trace card" aria-label="에이전트 추론 타임라인">
            <div className="card-head">
              <h3>추론 타임라인 (ReAct)</h3>
              {run.grounded
                ? <Badge tone="green" dot>온톨로지 접지됨</Badge>
                : <Badge tone="amber" dot>grounding 없음</Badge>}
              <InfoTip>Reasoning → Tool call(name·args) → Tool result(근거 objectId) 순서로, 에이전트가 무엇을 근거로 판단했는지 그대로 보여줍니다.</InfoTip>
            </div>
            <div className="agent-trace-meta muted">
              trace <code>{run.traceId}</code> · {run.steps.length} step · 의도 “{run.intent}”
            </div>
            <ol className="agent-steps">
              {run.steps.map((s, i) => <StepRow key={i} step={s} index={i} onOpen={(id) => view.open(id)} />)}
            </ol>
          </section>

          {/* RIGHT — RCA 후보 카드 (또는 grounding 없음 → runbook fallback) */}
          <section className="agent-output" aria-label="근본원인 후보">
            <div className="cop-panel-h">
              추정 근본원인 · 권장 조치
              {run.grounded && run.candidates.length > 0 && <span className="cop-count">{run.candidates.length} 후보</span>}
            </div>

            {run.grounded && run.candidates.length > 0 ? (
              <div className="agent-cards">
                {run.candidates.map((c) => (
                  <RcaCard
                    key={c.objectId}
                    cand={c}
                    active={view.objectId === c.objectId}
                    onOpen={() => view.open(c.objectId)}
                    onCite={(id) => view.open(id)}
                    onReconcile={() => analyze(run.intent, urlSt.entity || undefined)}
                  />
                ))}
              </div>
            ) : (
              // grounding 없음 → 정적 runbook(모델이 지어내지 않음).
              <div className="agent-fallback" role="note">
                <div className="agent-fallback-h">
                  <Badge tone="neutral" dot>grounding 없음</Badge>
                  <span>접지할 근거를 찾지 못해 정적 runbook 으로 안내합니다.</span>
                </div>
                <ol className="agent-runbook">
                  {(run.fallbackRunbook ?? []).map((line, i) => <li key={i}>{line}</li>)}
                </ol>
                {onNavigate && (
                  <button type="button" className="link-btn" onClick={() => onNavigate("investigate")}>
                    근본원인 추적(COP)에서 진입점 지정 →
                  </button>
                )}
              </div>
            )}

            {onNavigate && run.grounded && (
              <button type="button" className="link-btn agent-cop-link" onClick={() => onNavigate("investigate", { model: undefined })}>
                근본원인 추적(COP)에서 경로 전체 보기 →
              </button>
            )}
          </section>
        </div>
      )}

      {/* 카드/인용 클릭 KPI 드로어 — ObjectView(속성·관계 traverse) + inline Action(confirm). */}
      <ObjectView {...view.props} onNavigateFull={onNavigate ? () => onNavigate("investigate") : undefined} />
    </>
  );
}

// ReAct 타임라인 한 줄 — reasoning(생각) 또는 tool(name+args+result). result 는 근거 objectId 칩.
function StepRow({ step, index, onOpen }: { step: AgentStep; index: number; onOpen: (id: string) => void }) {
  if (step.kind === "reasoning") {
    return (
      <li className="agent-step agent-step-reason">
        <span className="agent-step-badge" aria-hidden="true">생각</span>
        <span className="agent-step-text">{step.text}</span>
      </li>
    );
  }
  const { call, result } = step;
  return (
    <li className={`agent-step agent-step-tool ${result.found ? "" : "empty"}`}>
      <span className="agent-step-badge tool" aria-hidden="true">도구</span>
      <div className="agent-step-body">
        <div className="agent-tool-call">
          <code className="agent-tool-name">{TOOL_LABEL[call.tool] ?? call.tool}</code>
          <code className="agent-tool-args">{JSON.stringify(call.args)}</code>
          <span className="agent-tool-auto" title="조회 tool 은 자동 실행됩니다(변경 아님)">자동</span>
        </div>
        <div className="agent-tool-result">
          <span className="agent-tool-summary">{result.summary}</span>
          {result.objectIds.length > 0 && (
            <span className="agent-cites">
              {result.objectIds.slice(0, 6).map((id) => (
                <button key={id} type="button" className="agent-cite" onClick={() => onOpen(id)} title={`${id} 열기`}>
                  {id}
                </button>
              ))}
              {result.objectIds.length > 6 && <span className="agent-cite-more">+{result.objectIds.length - 6}</span>}
            </span>
          )}
        </div>
      </div>
      <span className="sr-only">step {index + 1}</span>
    </li>
  );
}

// RCA 후보 카드 — confidence bar + claim + 인용 칩 + [상세 열기] + suggestedAction(있으면 ActionForm confirm).
function RcaCard({
  cand,
  active,
  onOpen,
  onCite,
  onReconcile,
}: {
  cand: RcaCandidate;
  active: boolean;
  onOpen: () => void;
  onCite: (id: string) => void;
  onReconcile: () => void;
}) {
  const [showAction, setShowAction] = useState(false);
  const spec = cand.suggestedAction ? getActionSpec(cand.suggestedAction.actionType) : undefined;
  const pct = Math.round(cand.confidence * 100);
  return (
    <div className={`agent-card ${active ? "active" : ""}`}>
      <div className="agent-card-top">
        <span className="agent-card-glyph" aria-hidden="true">{TYPE_GLYPH[cand.objectType]}</span>
        <button type="button" className="agent-card-title" onClick={onOpen} title={`${cand.title} 상세/조치 열기`}>
          {cand.title}
        </button>
        <span className="agent-card-type">{TYPE_LABEL[cand.objectType]}</span>
        <Badge tone={confTone(cand.confidence)}>{pct}% 신뢰</Badge>
      </div>

      {/* confidence bar */}
      <div className="agent-conf" role="img" aria-label={`신뢰도 ${pct}%`}>
        <span className={`agent-conf-fill tone-${confTone(cand.confidence)}`} style={{ width: `${pct}%` }} />
      </div>

      <p className="agent-card-claim">{cand.claim}</p>

      {/* 인용 — 근거 objectId(grounding 강제). 클릭 → ObjectView. */}
      <div className="agent-card-cites">
        <span className="agent-card-cites-h">근거</span>
        {cand.citations.length === 0 ? (
          <span className="muted">근거 없음</span>
        ) : (
          cand.citations.map((id) => (
            <button key={id} type="button" className="agent-cite" onClick={() => onCite(id)} title={`${id} 열기`}>
              {id}
            </button>
          ))
        )}
      </div>

      {/* 권장 조치 — 제안일 뿐. 실행은 ActionForm confirm + capability 게이팅(observe 는 disabled+사유). */}
      {spec && cand.suggestedAction && (
        <div className="agent-card-action">
          {!showAction ? (
            <button type="button" className="btn-ghost btn-sm" onClick={() => setShowAction(true)}>
              권장 조치: {spec.label} — 확인 후 실행 →
            </button>
          ) : (
            <>
              <div className="agent-action-note" role="note">
                이 조치는 변경 작업입니다 — 아래에서 파라미터를 입력하고 <b>직접 실행</b>해야 반영됩니다(권한 없으면 비활성).
              </div>
              <ActionForm
                actionType={cand.suggestedAction.actionType}
                target={cand.suggestedAction.target}
                onDone={(res) => { if (res.outcome === "ok") onReconcile(); }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
