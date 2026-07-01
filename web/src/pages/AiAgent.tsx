import { useCallback, useEffect, useState } from "react";
import { runAgent, runAgentInsights } from "../api/client";
import type { AgentInsightRun, AgentRun, AgentStep, ClusterInsight, InsightKind, ObjectType, RcaCandidate } from "../api/types";
import { getActionSpec } from "../actions/registry";
import Badge, { type BadgeTone } from "../components/Badge";
import { SkeletonCards } from "../components/Skeleton";
import DataFreshness from "../components/DataFreshness";
import InfoTip from "../components/InfoTip";
import ActionForm from "../components/ActionForm";
import ObjectView, { useObjectView } from "../components/ObjectView";
import ModelStatusChip from "../components/ModelStatusChip";
import { loadModelConfig, type ModelConnConfig } from "../api/modelConnection";
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
  Model: "◆", Endpoint: "▣", Service: "◈", GpuDevice: "▤", Node: "▥", Trace: "≣", Incident: "▲", App: "◉",
};
const TYPE_LABEL: Record<ObjectType, string> = {
  Model: "모델", Endpoint: "엔드포인트", Service: "서비스", GpuDevice: "GPU", Node: "노드", Trace: "트레이스", Incident: "인시던트", App: "앱",
};

// tool 이름 → 사람용 라벨.
const TOOL_LABEL: Record<string, string> = {
  queryObjects: "객체 조회",
  traverseLinks: "관계 추적",
  getIncidents: "인시던트 조회",
};

// IMP-78 — 인사이트 종류 라벨/글리프(무채색, 네온 금지). RCA(단일 원인)와 구분되는 패턴·군집 축.
const INSIGHT_LABEL: Record<InsightKind, string> = {
  "gpu-cluster": "GPU 군집",
  "hot-node": "Hot-node 패턴",
  "idle-alloc-gap": "유휴 할당갭",
  "recurring-pattern": "반복 패턴",
};
const INSIGHT_GLYPH: Record<InsightKind, string> = {
  "gpu-cluster": "▤", "hot-node": "▥", "idle-alloc-gap": "◌", "recurring-pattern": "≋",
};
// 인사이트 severity → 톤(임계 아님 — 표시 정보). crit>warn>info.
function sevTone(s: ClusterInsight["severity"]): BadgeTone {
  return s === "crit" ? "red" : s === "warn" ? "amber" : "neutral";
}

// confidence → 톤(높을수록 강조). 0.75+ 위험(빨강), 0.5+ 주의(주황), 그 외 중립.
function confTone(c: number): BadgeTone {
  return c >= 0.75 ? "red" : c >= 0.5 ? "amber" : "neutral";
}

// seed 시나리오 프리셋(자연어 의도) — 데모/온보딩용. 자유 입력도 가능.
const INTENT_PRESETS = [
  "가장 아픈 엔드포인트의 근본원인을 찾아줘",
  "지금 발생한 인시던트의 영향 경로를 분석해줘",
];

// 화면 모드 — 근본원인(RCA, 현행 기본) / 클러스터 인사이트(IMP-78 생성적 레이어).
type Mode = "rca" | "insights";

export default function AiAgent({ onNavigate }: { onNavigate?: (p: Page, params?: NavParams) => void }) {
  const [urlSt, patchUrl] = useUrlState(agentSchema);
  const [mode, setMode] = useState<Mode>(() => (urlSt.mode === "insights" ? "insights" : "rca"));
  const [intent, setIntent] = useState<string>(() => urlSt.intent || INTENT_PRESETS[0]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);
  // IMP-78 — 클러스터 인사이트 상태(RCA 와 독립). insights 탭에서만 로드.
  const [insightRun, setInsightRun] = useState<AgentInsightRun | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const view = useObjectView(); // 카드/인용 클릭 → ObjectView(IMP-57) + inline Action(IMP-59)
  // IMP-82 — 로컬 모델 연결 설정(설정·관리에서 localStorage 저장). 마운트 1회 로드 → 상태 칩에 전달.
  //   기본은 mock(정직) — 실 연결 여부/모델/지연을 칩이 정직하게 드러낸다("연결됨" 위장 금지).
  const [modelConfig] = useState(() => loadModelConfig());

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

  // IMP-78 — 클러스터 인사이트 로드. HARD grounding 은 서버가 강제(인용 없는 claim 은 응답에 없음) → 표시만.
  //   mutation 을 유발하지 않는 read-only 호출. VITE_MOCK=off 면 transport 만 스왑되어 실 Dynamo 로 나간다.
  const loadInsights = useCallback(async (signal?: AbortSignal) => {
    setInsightLoading(true);
    setInsightError(null);
    try {
      const r = await runAgentInsights(signal);
      setInsightRun(r);
      setLastLoaded(Date.now());
    } catch (e) {
      if ((e as Error).name !== "AbortError") setInsightError(humanizeError((e as Error).message));
    } finally {
      setInsightLoading(false);
    }
  }, []);

  // 최초 마운트 — URL(intent/entity)로 시드해 RCA 를 한 번 실행(관제 콘솔이 바로 결과를 보여준다).
  useEffect(() => {
    const ctrl = new AbortController();
    analyze(urlSt.intent || INTENT_PRESETS[0], urlSt.entity || undefined, ctrl.signal);
    // insights 모드로 진입(deep-link)한 경우 인사이트도 초기 로드.
    if (urlSt.mode === "insights") loadInsights(ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 모드 전환 — insights 첫 진입 시 lazy 로드(재진입은 캐시 유지, 새로고침 버튼 제공).
  const switchMode = useCallback((next: Mode) => {
    setMode(next);
    patchUrl({ mode: next });
    if (next === "insights" && !insightRun && !insightLoading) loadInsights();
  }, [patchUrl, insightRun, insightLoading, loadInsights]);

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
        {/* IMP-82 — 로컬 모델 연결 상태 칩(정직: mock 기본, 실경로면 /health·/v1/models 프로브·TTFT). */}
        <ModelStatusChip config={modelConfig} />
        <DataFreshness updatedAt={lastLoaded} intervalMs={0} />
      </div>

      {/* IMP-78 — 모드 탭: 근본원인(결정적 RCA, 현행) / 클러스터 인사이트(생성적, 로컬 모델). */}
      <div className="agent-modes" role="tablist" aria-label="분석 모드">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "rca"}
          className={`pill ${mode === "rca" ? "active" : ""}`}
          onClick={() => switchMode("rca")}
        >
          근본원인 (RCA)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "insights"}
          className={`pill ${mode === "insights" ? "active" : ""}`}
          onClick={() => switchMode("insights")}
        >
          클러스터 인사이트
        </button>
      </div>

      {mode === "rca" ? (
      <>
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
      </>
      ) : (
        // IMP-78 — 클러스터 인사이트 모드(생성적). 로컬 모델이 온톨로지 근거로 군집·패턴 도출.
        <InsightsPanel
          run={insightRun}
          loading={insightLoading}
          error={insightError}
          onReload={() => loadInsights()}
          onCite={(id) => view.open(id)}
          modelConfig={modelConfig}
        />
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

// IMP-78 — 클러스터 인사이트 패널. 로컬 모델(Dynamo) 출력을 HARD grounding(인용 강제) 후 표시.
//   서버가 인용 없는 claim 을 드롭하므로 표시분은 전부 objectId 를 인용한다(방어적으로 UI 도 재확인).
//   인사이트는 read-only — 어떤 Action/ActionForm 도 없다(모든 mutation 은 RCA 카드 경로로만).
function InsightsPanel({
  run,
  loading,
  error,
  onReload,
  onCite,
  modelConfig,
}: {
  run: AgentInsightRun | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onCite: (id: string) => void;
  modelConfig: ModelConnConfig;
}) {
  // 방어적 필터 — HARD grounding: 인용 없는 claim 은 표시하지 않는다(서버가 이미 드롭했더라도 UI 에서 재확인).
  const shown = (run?.insights ?? []).filter((i) => i.citations.length > 0);

  return (
    <section className="agent-insights" aria-label="클러스터 인사이트">
      <div className="cop-panel-h">
        클러스터 인사이트 · 로컬 모델(온톨로지 접지)
        {run?.grounded && shown.length > 0 && <span className="cop-count">{shown.length} 인사이트</span>}
        {/* IMP-82 — 이 패널이 "로컬 모델(Dynamo) 근거"를 주장하므로, 바로 여기 연결 상태 칩을 붙여 정직성 확보. */}
        <ModelStatusChip config={modelConfig} />
        <div className="spacer" />
        <button type="button" className="btn-ghost btn-sm" onClick={onReload} disabled={loading}>
          {loading ? "분석 중…" : "다시 분석"}
        </button>
      </div>

      <InfoTip>
        로컬 추론 모델(Dynamo)이 온톨로지 스냅샷(객체·관계·메트릭 요약)을 근거로 <b>유사 상태 GPU 군집·반복 hot-node 패턴·유휴 할당갭</b> 같은
        생성적 인사이트를 도출합니다. <b>모든 인사이트는 근거 objectId 를 인용</b>하며, 인용이 없는 서술은 표시하지 않습니다(hallucination 금지, 표시는 <b>추정</b>).
      </InfoTip>

      {error && <div className="state error" role="alert">클러스터 인사이트 도출에 실패했습니다. ({error})</div>}
      {!error && loading && !run && <SkeletonCards count={3} />}

      {!error && run && (
        <>
          <div className="agent-insights-meta muted">
            trace <code>{run.traceId}</code> · {run.groundingSummary}
          </div>

          {run.grounded && shown.length > 0 ? (
            <div className="agent-cards">
              {shown.map((ins) => (
                <InsightCard key={ins.id} insight={ins} onCite={onCite} />
              ))}
            </div>
          ) : (
            // grounded 없음 → 지어내지 않는다(인용 가능한 군집 근거를 못 찾음).
            <div className="agent-fallback" role="note">
              <div className="agent-fallback-h">
                <Badge tone="neutral" dot>근거 없음</Badge>
                <span>인용 가능한 군집 근거를 찾지 못해 인사이트를 표시하지 않습니다(지어내지 않음).</span>
              </div>
            </div>
          )}

          {/* 투명성 — 인용 없어 드롭된 claim 수(HARD grounding 이 걸러낸 hallucination). */}
          {run.droppedCount > 0 && (
            <div className="agent-insights-dropped muted" role="note">
              인용이 없어 표시하지 않은 서술 {run.droppedCount}건 — 근거(objectId) 없는 주장은 노출하지 않습니다.
            </div>
          )}
        </>
      )}
    </section>
  );
}

// 인사이트 카드 — kind 라벨 + 제목 + claim + 근거 objectId 칩(클릭 → ObjectView). read-only(Action 없음).
function InsightCard({ insight, onCite }: { insight: ClusterInsight; onCite: (id: string) => void }) {
  return (
    <div className="agent-card insight-card">
      <div className="agent-card-top">
        <span className="agent-card-glyph" aria-hidden="true">{INSIGHT_GLYPH[insight.kind]}</span>
        <span className="agent-card-title as-text">{insight.title}</span>
        <span className="agent-card-type">{INSIGHT_LABEL[insight.kind]}</span>
        <Badge tone={sevTone(insight.severity)}>{insight.severity === "crit" ? "위험" : insight.severity === "warn" ? "주의" : "정보"}</Badge>
      </div>

      <p className="agent-card-claim">{insight.claim}</p>

      {/* 인용 — 근거 objectId(HARD grounding). 클릭 → ObjectView. 최소 1개 보장(빈 건 표시 안 됨). */}
      <div className="agent-card-cites">
        <span className="agent-card-cites-h">근거</span>
        {insight.citations.map((id) => (
          <button key={id} type="button" className="agent-cite" onClick={() => onCite(id)} title={`${id} 열기`}>
            {id}
          </button>
        ))}
      </div>
    </div>
  );
}
