import { useCallback, useEffect, useState } from "react";
import { fetchModels, runEval } from "../api/client";
import type { EvalResult, ModelInfo } from "../api/types";
import Sparkline from "../components/Sparkline";
import InfoTip from "../components/InfoTip";
import { humanizeError } from "../utils/errors";

// 프롬프트/평가 관리 (#17) — LLM-as-judge. 대상 모델 응답을 심판 모델이 1~5점 채점.
export default function Eval() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [judge, setJudge] = useState("");
  const [prompt, setPrompt] = useState("대한민국의 수도와 인구를 한 문장으로 알려줘");
  const [criteria, setCriteria] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<EvalResult[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchModels(ctrl.signal)
      .then((c) => {
        const chat = c.models.filter((m) => m.playground);
        setModels(chat);
        if (chat.length) { setModel(chat[0].id); setJudge(chat[0].id); }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

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

  const scoreColor = (s: number) => (s >= 4 ? "var(--green)" : s >= 2 ? "var(--amber)" : "var(--red)");
  // O-12: 점수(1-5) → 평문 신뢰도 큐.
  const scoreCue = (s: number) => (s >= 4.5 ? "매우 일치" : s >= 3.5 ? "대체로 일치" : s >= 2.5 ? "부분 일치" : "근거 부족");
  const avg = results.length ? results.reduce((a, r) => a + r.score, 0) / results.length : 0;
  // 세션 내 평가 추이(회귀 비교) — results 는 최신순, 추이는 과거→현재.
  const trend = [...results].reverse().map((r) => r.score);
  const latestDelta = results.length >= 2 ? results[0].score - results[1].score : null;

  return (
    <>
      <div className="page-head">
        <h1>프롬프트 · 평가</h1>
        <span className="crumb">모델 / 평가 (LLM-as-judge)</span>
        <div className="spacer" />
        {results.length > 0 && <span className="updated">평균 {avg.toFixed(1)} / 5 · {results.length}건</span>}
      </div>

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
          <div className="policy-hint">모델 교체·양자화 전후 같은 프롬프트를 반복 평가해 점수 회귀를 확인하세요. 데이터셋·영구 회귀 배치는 후속(백엔드).</div>
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
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} style={{ font: "inherit", padding: 8, border: "1px solid var(--border-strong)", borderRadius: 6, resize: "vertical" }} /></label>
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
            대상 모델의 응답을 심판 모델이 1~5점으로 채점합니다. 모델 교체·양자화 전후 같은 프롬프트를 반복 실행해 점수 회귀를 확인하세요. 결과는 이 영역에 누적되고, 2건 이상이면 추이 차트가 나타납니다.
          </div>
        </div>
      )}

      {results.map((r, i) => {
        const blocked = r.guard?.decision === "blocked";
        return (
        <div className="card" key={i}>
          <div className="card-head">
            <h3>{r.model} {r.judge_model !== r.model && <span className="muted">· 심판 {r.judge_model}</span>}</h3>
            {/* 확정(메트릭) vs 확률(AI 심판) 구분 — 점수는 LLM 판정이라 참고치임을 명시 */}
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
