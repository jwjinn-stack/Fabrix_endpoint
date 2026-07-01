import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createDataset, fetchDatasets, fetchExperiments, fetchModels, runEval, runExperiment,
} from "../api/client";
import type {
  EvalDataset, EvalDatasetItem, EvalResult, Experiment, ModelInfo,
} from "../api/types";
import Sparkline from "../components/Sparkline";
import InfoTip from "../components/InfoTip";
import { scoreColor, scoreCue } from "../components/ScoreBadge";
import { humanizeError } from "../utils/errors";

// 프롬프트/평가 관리 (#17 → IMP-39 eval suite) — Single(단건 LLM-as-judge) ·
// Datasets(고정 케이스 집합) · Experiments(데이터셋×고정 config 배치 채점 + 회귀 비교).
// Langfuse Datasets+Experiments / Phoenix experiments 패턴.

type Tab = "single" | "datasets" | "experiments";

export default function Eval() {
  const [tab, setTab] = useState<Tab>("single");
  const [models, setModels] = useState<ModelInfo[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchModels(ctrl.signal)
      .then((c) => setModels(c.models.filter((m) => m.playground)))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  return (
    <>
      <div className="page-head">
        <h1>프롬프트 · 평가</h1>
        <span className="crumb">모델 / 평가 (LLM-as-judge)</span>
      </div>

      <div className="modality-tabs" role="tablist" aria-label="평가 보기">
        <button type="button" role="tab" aria-selected={tab === "single"} className={`modality-tab ${tab === "single" ? "active" : ""}`} onClick={() => setTab("single")}>단건</button>
        <button type="button" role="tab" aria-selected={tab === "datasets"} className={`modality-tab ${tab === "datasets" ? "active" : ""}`} onClick={() => setTab("datasets")}>데이터셋</button>
        <button type="button" role="tab" aria-selected={tab === "experiments"} className={`modality-tab ${tab === "experiments" ? "active" : ""}`} onClick={() => setTab("experiments")}>실험 · 회귀 비교</button>
      </div>

      {tab === "single" && <SingleEval models={models} />}
      {tab === "datasets" && <Datasets />}
      {tab === "experiments" && <Experiments models={models} />}
    </>
  );
}

// ───────────── 단건 (기존 동작 보존) ─────────────
function SingleEval({ models }: { models: ModelInfo[] }) {
  const [model, setModel] = useState("");
  const [judge, setJudge] = useState("");
  const [prompt, setPrompt] = useState("대한민국의 수도와 인구를 한 문장으로 알려줘");
  const [criteria, setCriteria] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<EvalResult[]>([]);

  useEffect(() => {
    if (models.length && !model) { setModel(models[0].id); setJudge(models[0].id); }
  }, [models, model]);

  const run = useCallback(async () => {
    if (!model || !prompt.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await runEval({ model, judge_model: judge, prompt, criteria });
      setResults((prev) => [r, ...prev]);
    } catch (e) {
      setErr(humanizeError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }, [model, judge, prompt, criteria, busy]);

  const avg = results.length ? results.reduce((a, r) => a + r.score, 0) / results.length : 0;
  const trend = [...results].reverse().map((r) => r.score);
  const latestDelta = results.length >= 2 ? results[0].score - results[1].score : null;

  return (
    <>
      {results.length >= 2 && (
        <div className="card eval-trend">
          <div className="card-head"><h3>평가 추이 (세션 내 회귀 비교)</h3><span className="spacer" /><span className="updated">평균 {avg.toFixed(1)} / 5</span></div>
          <div className="eval-trend-body">
            <Sparkline values={trend} color={scoreColor(results[0].score)} width={180} height={40} />
            <div className="eval-trend-meta">
              <span className="eval-trend-latest" style={{ color: scoreColor(results[0].score) }}>최신 {results[0].score} / 5</span>
              {latestDelta !== null && (
                <span className={`delta ${latestDelta > 0 ? "good" : latestDelta < 0 ? "bad" : "flat"}`}>
                  {latestDelta > 0 ? `▲ +${latestDelta}` : latestDelta < 0 ? `▼ ${latestDelta}` : "＝ 0"} (직전 대비)
                </span>
              )}
            </div>
          </div>
          <div className="policy-hint">고정 케이스 집합으로 회귀를 추적하려면 데이터셋·실험 탭을 사용하세요.</div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h3>평가 실행</h3><InfoTip>대상 모델의 응답을 심판 모델이 기준에 따라 1~5점으로 채점합니다(Langfuse/Databricks 패턴).</InfoTip></div>
        <div className="pg-field-row">
          <label className="pg-field"><span>대상 모델</span>
            <select className="range-select" value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => <option key={m.id} value={m.id} disabled={m.status === "unreachable"}>{m.display_name}</option>)}
            </select></label>
          <label className="pg-field"><span>심판 모델</span>
            <select className="range-select" value={judge} onChange={(e) => setJudge(e.target.value)}>
              {models.map((m) => <option key={m.id} value={m.id} disabled={m.status === "unreachable"}>{m.display_name}</option>)}
            </select></label>
        </div>
        <label className="pg-field"><span>프롬프트</span>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} style={{ font: "inherit", padding: "var(--sp-2)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)", resize: "vertical" }} /></label>
        <label className="pg-field"><span>채점 기준(선택)</span>
          <input value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder="예: 정확성·간결성·근거 제시" /></label>
        {err && <div className="state error" role="alert">{err}</div>}
        <button type="button" className="btn-primary" onClick={run} disabled={busy || !model || !prompt.trim()} style={{ alignSelf: "flex-start" }}>
          {busy ? "평가 중…" : "평가 실행"}
        </button>
      </div>

      {results.length === 0 && !busy && (
        <div className="card eval-guide">
          <div className="empty" style={{ textAlign: "left", lineHeight: 1.6 }}>
            <b>LLM-as-judge 평가</b><br />
            대상 모델의 응답을 심판 모델이 1~5점으로 채점합니다. 고정 케이스 집합·배치 회귀 비교는 데이터셋·실험 탭을 사용하세요.
          </div>
        </div>
      )}

      {results.map((r, i) => {
        const blocked = r.guard?.decision === "blocked";
        return (
        <div className="card" key={i}>
          <div className="card-head">
            <h3>{r.model} {r.judge_model !== r.model && <span className="muted">· 심판 {r.judge_model}</span>}</h3>
            <span className="tag" title="LLM-as-judge 채점 — 결정론적 측정이 아닌 확률적 판정(참고치)">AI 심판</span>
            <span className="spacer" />
            {blocked ? (
              <span className="tag tag-red">평가 불가 · 응답 차단</span>
            ) : (
              <>
                <span className="eval-score" style={{ color: scoreColor(r.score) }}>{r.score} / 5</span>
                <span style={{ marginLeft: "var(--sp-2)", fontSize: "var(--fs-xs)", color: scoreColor(r.score), border: `1px solid ${scoreColor(r.score)}`, borderRadius: "var(--radius-sm)", padding: "1px 6px" }}>{scoreCue(r.score)}</span>
              </>
            )}
          </div>
          <dl className="detail-grid">
            <div className="detail-pair"><dt>프롬프트</dt><dd>{r.prompt}</dd></div>
            <div className="detail-pair"><dt>응답</dt><dd>{blocked ? <span className="tag tag-red">가드레일 차단</span> : r.response}</dd></div>
            <div className="detail-pair"><dt>채점 근거</dt><dd>{r.rationale}</dd></div>
            <div className="detail-pair"><dt>지연</dt><dd>{r.latency_ms}ms</dd></div>
          </dl>
        </div>
        );
      })}
    </>
  );
}

// ───────────── 데이터셋 ─────────────
type DraftItem = { input: string; expected_output: string; criteria: string };
const emptyItem = (): DraftItem => ({ input: "", expected_output: "", criteria: "" });

function Datasets() {
  const [datasets, setDatasets] = useState<EvalDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [busy, setBusy] = useState(false);

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    fetchDatasets(signal)
      .then((d) => { setDatasets(d.datasets); setErr(null); })
      .catch((e) => setErr(humanizeError((e as Error).message)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const canSave = name.trim() !== "" && items.some((it) => it.input.trim() !== "");

  const save = useCallback(async () => {
    if (!canSave || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const payload: EvalDatasetItem[] = items
        .filter((it) => it.input.trim() !== "")
        .map((it, i) => ({
          id: `c${i + 1}`,
          input: it.input.trim(),
          expected_output: it.expected_output.trim() || undefined,
          criteria: it.criteria.trim() || undefined,
        }));
      await createDataset({ name: name.trim(), items: payload });
      setName("");
      setItems([emptyItem()]);
      load();
    } catch (e) {
      setErr(humanizeError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }, [canSave, busy, name, items, load]);

  return (
    <>
      <div className="card">
        <div className="card-head"><h3>새 데이터셋</h3><InfoTip>고정 테스트 케이스 집합입니다. 기대답변(expected)은 선택 — 없으면 reference-free 로 채점합니다(golden answer 강제 없음).</InfoTip></div>
        <label className="pg-field"><span>이름</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 한국어 사실 QA" /></label>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          {items.map((it, i) => (
            <div key={i} className="card" style={{ padding: "var(--sp-2)", margin: 0, background: "var(--surface-2, transparent)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-1)" }}>
                <b style={{ fontSize: "var(--fs-sm)" }}>케이스 {i + 1}</b>
                <span className="spacer" />
                {items.length > 1 && (
                  <button type="button" className="btn-ghost" aria-label={`케이스 ${i + 1} 삭제`} onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}>삭제</button>
                )}
              </div>
              <label className="pg-field"><span>입력(input)</span>
                <input value={it.input} onChange={(e) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, input: e.target.value } : x)))} placeholder="질문/프롬프트" /></label>
              <div className="pg-field-row">
                <label className="pg-field"><span>기대답변(선택)</span>
                  <input value={it.expected_output} onChange={(e) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, expected_output: e.target.value } : x)))} placeholder="reference-based 시" /></label>
                <label className="pg-field"><span>채점 기준(선택)</span>
                  <input value={it.criteria} onChange={(e) => setItems((prev) => prev.map((x, j) => (j === i ? { ...x, criteria: e.target.value } : x)))} placeholder="케이스별 기준" /></label>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          <button type="button" className="btn-ghost" onClick={() => setItems((prev) => [...prev, emptyItem()])}>+ 케이스 추가</button>
          <button type="button" className="btn-primary" onClick={save} disabled={!canSave || busy}>{busy ? "저장 중…" : "데이터셋 저장"}</button>
        </div>
        {err && <div className="state error" role="alert">{err}</div>}
      </div>

      <div className="card">
        <div className="card-head"><h3>데이터셋 ({datasets.length})</h3></div>
        {loading ? (
          <div className="state">로딩 중…</div>
        ) : datasets.length === 0 ? (
          <div className="empty">아직 데이터셋이 없습니다. 위에서 케이스를 추가해 만드세요.</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            {datasets.map((d) => (
              <li key={d.id} style={{ borderLeft: "3px solid var(--primary)", paddingLeft: "var(--sp-2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                  <b>{d.name}</b>
                  <span className="tag">v{d.version}</span>
                  <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{d.items.length}개 케이스</span>
                </div>
                <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>{d.id}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

// ───────────── 실험 · 회귀 비교 ─────────────
function Experiments({ models }: { models: ModelInfo[] }) {
  const [datasets, setDatasets] = useState<EvalDataset[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [datasetId, setDatasetId] = useState("");
  const [model, setModel] = useState("");
  const [judge, setJudge] = useState("");
  const [promptVersion, setPromptVersion] = useState("");
  const [criteria, setCriteria] = useState("");
  const [busy, setBusy] = useState(false);

  // 비교용 run 선택(좌=baseline, 우=비교 대상).
  const [baseId, setBaseId] = useState("");
  const [compId, setCompId] = useState("");

  const load = useCallback((signal?: AbortSignal) => {
    setLoading(true);
    Promise.all([fetchDatasets(signal), fetchExperiments(signal)])
      .then(([d, e]) => {
        setDatasets(d.datasets);
        setExperiments(e.experiments);
        setErr(null);
        if (!datasetId && d.datasets.length) setDatasetId(d.datasets[0].id);
      })
      .catch((ex) => setErr(humanizeError((ex as Error).message)))
      .finally(() => setLoading(false));
  }, [datasetId]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  useEffect(() => {
    if (models.length && !model) { setModel(models[0].id); setJudge(models[0].id); }
  }, [models, model]);

  const run = useCallback(async () => {
    if (!datasetId || !model || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await runExperiment({
        dataset_id: datasetId,
        config: { model, judge_model: judge || model, prompt_version: promptVersion.trim() || undefined, criteria: criteria.trim() || "정확성·완결성·한국어 표현의 자연스러움" },
      });
      load();
    } catch (e) {
      setErr(humanizeError((e as Error).message));
    } finally {
      setBusy(false);
    }
  }, [datasetId, model, judge, promptVersion, criteria, busy, load]);

  // 선택된 두 run(없으면 최신 2개).
  const base = useMemo(() => experiments.find((e) => e.id === baseId) ?? experiments[1], [experiments, baseId]);
  const comp = useMemo(() => experiments.find((e) => e.id === compId) ?? experiments[0], [experiments, compId]);

  return (
    <>
      <div className="card">
        <div className="card-head"><h3>실험 실행</h3><InfoTip>데이터셋의 모든 케이스를 고정 config(모델·프롬프트 버전·심판 기준)로 배치 채점합니다. config 는 run 에 스냅샷되어 회귀 비교에 쓰입니다.</InfoTip></div>
        <div className="pg-field-row">
          <label className="pg-field"><span>데이터셋</span>
            <select className="range-select" value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              {datasets.length === 0 && <option value="">— 데이터셋 없음 —</option>}
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name} (v{d.version} · {d.items.length})</option>)}
            </select></label>
          <label className="pg-field"><span>대상 모델</span>
            <select className="range-select" value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => <option key={m.id} value={m.id} disabled={m.status === "unreachable"}>{m.display_name}</option>)}
            </select></label>
          <label className="pg-field"><span>심판 모델</span>
            <select className="range-select" value={judge} onChange={(e) => setJudge(e.target.value)}>
              {models.map((m) => <option key={m.id} value={m.id} disabled={m.status === "unreachable"}>{m.display_name}</option>)}
            </select></label>
        </div>
        <div className="pg-field-row">
          <label className="pg-field"><span>프롬프트 버전(선택)</span>
            <input value={promptVersion} onChange={(e) => setPromptVersion(e.target.value)} placeholder="예: v2-cot" /></label>
          <label className="pg-field"><span>심판 기준(선택)</span>
            <input value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder="예: 정확성·근거 제시" /></label>
        </div>
        {err && <div className="state error" role="alert">{err}</div>}
        <button type="button" className="btn-primary" onClick={run} disabled={busy || !datasetId || !model} style={{ alignSelf: "flex-start" }}>
          {busy ? "배치 채점 중…" : "실험 실행"}
        </button>
      </div>

      {loading ? (
        <div className="card"><div className="state">로딩 중…</div></div>
      ) : experiments.length === 0 ? (
        <div className="card"><div className="empty">아직 실험 실행이 없습니다. 데이터셋을 선택해 첫 실험을 실행하세요.</div></div>
      ) : (
        <ComparePanel experiments={experiments} base={base} comp={comp} baseId={baseId} compId={compId} setBaseId={setBaseId} setCompId={setCompId} />
      )}
    </>
  );
}

function runLabel(e: Experiment): string {
  const v = e.config.prompt_version ? ` · ${e.config.prompt_version}` : "";
  return `${e.config.model}${v} · ${e.created_at.slice(5, 16).replace("T", " ")}`;
}

function ComparePanel({
  experiments, base, comp, baseId, compId, setBaseId, setCompId,
}: {
  experiments: Experiment[];
  base?: Experiment;
  comp?: Experiment;
  baseId: string; compId: string;
  setBaseId: (v: string) => void; setCompId: (v: string) => void;
}) {
  // 매트릭스 행: 두 run 의 케이스 합집합(item_id 기준). 케이스 입력은 comp 우선.
  const rows = useMemo(() => {
    const map = new Map<string, { input: string; baseScore?: number; compScore?: number; baseBlocked?: boolean; compBlocked?: boolean }>();
    for (const c of base?.cases ?? []) map.set(c.item_id, { input: c.input, baseScore: c.score, baseBlocked: c.blocked });
    for (const c of comp?.cases ?? []) {
      const e = map.get(c.item_id) ?? { input: c.input };
      e.input = c.input || e.input;
      e.compScore = c.score; e.compBlocked = c.blocked;
      map.set(c.item_id, e);
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v }));
  }, [base, comp]);

  const sameJudge = base && comp && base.config.judge_model === comp.config.judge_model && base.config.criteria === comp.config.criteria;

  const delta = (a?: number, b?: number) => (a === undefined || b === undefined ? null : b - a);

  return (
    <div className="card">
      <div className="card-head"><h3>회귀 비교 (run × case 매트릭스)</h3>
        <span className="tag" title="LLM-as-judge — 확률적 판정(참고치)">AI 심판</span>
      </div>

      <div className="pg-field-row">
        <label className="pg-field"><span>기준 run (A)</span>
          <select className="range-select" value={baseId || (base?.id ?? "")} onChange={(e) => setBaseId(e.target.value)}>
            {experiments.map((e) => <option key={e.id} value={e.id}>{runLabel(e)}</option>)}
          </select></label>
        <label className="pg-field"><span>비교 run (B)</span>
          <select className="range-select" value={compId || (comp?.id ?? "")} onChange={(e) => setCompId(e.target.value)}>
            {experiments.map((e) => <option key={e.id} value={e.id}>{runLabel(e)}</option>)}
          </select></label>
      </div>

      {base && comp && (
        <>
          <div className="policy-hint" style={{ marginBottom: "var(--sp-2)" }}>
            심판: A={base.config.judge_model} ({base.config.criteria}) · B={comp.config.judge_model} ({comp.config.criteria}).
            {!sameJudge && <b style={{ color: "var(--amber)" }}> ⚠ 심판 config 가 달라 점수 비교의 정합성에 주의하세요.</b>}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="usage-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>케이스</th>
                  <th>A</th>
                  <th>B</th>
                  <th>Δ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = r.baseBlocked || r.compBlocked ? null : delta(r.baseScore, r.compScore);
                  return (
                    <tr key={r.id}>
                      <td style={{ textAlign: "left", maxWidth: 360, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.input}>{r.input}</td>
                      <td><Cell score={r.baseScore} blocked={r.baseBlocked} /></td>
                      <td><Cell score={r.compScore} blocked={r.compBlocked} /></td>
                      <td>{d === null ? <span className="muted">—</span> : <DeltaBadge d={d} />}</td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: "2px solid var(--border-strong)", fontWeight: 600 }}>
                  <td style={{ textAlign: "left" }}>평균(mean)</td>
                  <td style={{ color: scoreColor(base.mean_score) }}>{base.mean_score.toFixed(2)}</td>
                  <td style={{ color: scoreColor(comp.mean_score) }}>{comp.mean_score.toFixed(2)}</td>
                  <td><DeltaBadge d={+(comp.mean_score - base.mean_score).toFixed(2)} /></td>
                </tr>
                <tr style={{ fontWeight: 600 }}>
                  <td style={{ textAlign: "left" }}>pass-rate (≥4)</td>
                  <td>{(base.pass_rate * 100).toFixed(0)}%</td>
                  <td>{(comp.pass_rate * 100).toFixed(0)}%</td>
                  <td><DeltaBadge d={+(comp.pass_rate - base.pass_rate).toFixed(2)} pct /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ score, blocked }: { score?: number; blocked?: boolean }) {
  if (blocked) return <span className="tag tag-red">차단</span>;
  if (score === undefined) return <span className="muted">—</span>;
  return <span style={{ color: scoreColor(score), fontWeight: 600 }}>{score}</span>;
}

// run-vs-run 점수 델타 — 양수=개선(▲), 음수=회귀(▼). error/success 토큰 재사용(neon 금지).
function DeltaBadge({ d, pct }: { d: number; pct?: boolean }) {
  const val = pct ? `${(d * 100).toFixed(0)}%p` : d.toFixed(2);
  if (d > 0) return <span className="delta good" style={{ color: "var(--green)" }} aria-label={`개선 ${val}`}>▲ +{val}</span>;
  if (d < 0) return <span className="delta bad" style={{ color: "var(--red)" }} aria-label={`회귀 ${val}`}>▼ {val}</span>;
  return <span className="delta flat muted" aria-label="변화 없음">＝ 0</span>;
}
