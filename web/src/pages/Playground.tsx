import { useCallback, useEffect, useRef, useState } from "react";
import { fetchModels, playgroundChat } from "../api/client";
import type { ChatMessage, ChatResponse, ModelInfo } from "../api/types";

interface Turn {
  role: "user" | "assistant";
  content: string;
  metrics?: ChatResponse;
  blocked?: boolean;
}

function resolveModel(requested: string | undefined, models: ModelInfo[]): string {
  const reachable = models.filter((m) => m.status !== "unreachable");
  const candidates = reachable.length > 0 ? reachable : models;
  if (requested && candidates.some((m) => m.id === requested)) return requested;
  return candidates[0]?.id ?? "";
}

// 플레이그라운드 — 카탈로그에서 고른 모델을 즉시 채팅으로 검증 (TPS·토큰·지연 표시).
export default function Playground({ initialModel }: { initialModel?: string }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState(initialModel ?? "");
  const [maxTokens, setMaxTokens] = useState(256);
  const [temperature, setTemperature] = useState(0.7);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareRows, setCompareRows] = useState<{ model: string; content: string; latency: number; tps: number; ptoks: number; ctoks: number; blocked: boolean; error?: string }[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchModels(ctrl.signal)
      .then((c) => {
        const chat = c.models.filter((m) => m.playground);
        setModels(chat);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (models.length === 0) return;
    const next = resolveModel(initialModel ?? model, models);
    if (next !== model) setModel(next);
  }, [initialModel, model, models]);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [turns, busy]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !model || busy) return;
    const history: ChatMessage[] = [
      ...turns.map((t) => ({ role: t.role, content: t.content })),
      { role: "user", content: text },
    ];
    setTurns((t) => [...t, { role: "user", content: text }]);
    setInput("");
    setBusy(true);
    setErr(null);
    try {
      const r = await playgroundChat(model, history, { maxTokens, temperature });
      const blocked = r.guard?.decision === "blocked";
      setTurns((t) => [...t, { role: "assistant", content: r.content, metrics: r, blocked }]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [input, model, busy, turns, maxTokens, temperature]);

  // 멀티모델 비교(#11) — 현재 입력을 채팅 가능한 모든 모델에 동시에 보내 결과를 표로 비교.
  const compare = useCallback(async () => {
    const text = input.trim();
    if (!text || comparing) return;
    const targets = models.filter((m) => m.status !== "unreachable");
    if (targets.length === 0) return;
    setComparing(true);
    setErr(null);
    setCompareRows(targets.map((m) => ({ model: m.display_name, content: "", latency: 0, tps: 0, ptoks: 0, ctoks: 0, blocked: false })));
    const msgs: ChatMessage[] = [{ role: "user", content: text }];
    const results = await Promise.all(
      targets.map(async (m) => {
        try {
          const r = await playgroundChat(m.id, msgs, { maxTokens, temperature });
          return { model: m.display_name, content: r.content, latency: r.latency_ms, tps: r.tokens_per_sec, ptoks: r.prompt_tokens, ctoks: r.completion_tokens, blocked: r.guard?.decision === "blocked" };
        } catch (e) {
          return { model: m.display_name, content: "", latency: 0, tps: 0, ptoks: 0, ctoks: 0, blocked: false, error: (e as Error).message };
        }
      }),
    );
    setCompareRows(results);
    setComparing(false);
  }, [input, comparing, models, maxTokens, temperature]);

  // View code(#11) — 선택 모델 호출 스니펫(curl/python/js). 엔드포인트는 동일 오리진 프록시.
  const codeSnippets = (): { lang: string; code: string }[] => {
    const body = JSON.stringify({ model, messages: [{ role: "user", content: "안녕하세요" }], max_tokens: maxTokens, temperature }, null, 2);
    // 자사 엔드포인트 URL 자동 주입(현재 접속 오리진) — 복붙 즉시 동작.
    const url = `${window.location.origin}/api/v1/playground/chat`;
    return [
      { lang: "curl", code: `curl -X POST ${url} \\\n  -H 'Content-Type: application/json' \\\n  -H 'x-api-key-id: <YOUR_KEY_ID>' \\\n  -d '${JSON.stringify({ model, messages: [{ role: "user", content: "안녕하세요" }], max_tokens: maxTokens, temperature })}'` },
      { lang: "python", code: `import requests\n\nr = requests.post(\n    "${url}",\n    headers={"x-api-key-id": "<YOUR_KEY_ID>"},\n    json=${body.replace(/\n/g, "\n    ")},\n)\nprint(r.json()["content"])` },
      { lang: "javascript", code: `const r = await fetch("${url}", {\n  method: "POST",\n  headers: { "Content-Type": "application/json", "x-api-key-id": "<YOUR_KEY_ID>" },\n  body: JSON.stringify(${body.replace(/\n/g, "\n  ")}),\n});\nconsole.log((await r.json()).content);` },
    ];
  };

  return (
    <>
      <div className="page-head">
        <h1>플레이그라운드</h1>
        <span className="crumb">모델 / 플레이그라운드</span>
        <div className="spacer" />
        <button type="button" className="btn-ghost" onClick={() => setTurns([])} disabled={turns.length === 0}>
          대화 초기화
        </button>
      </div>

      <div className="pg-layout">
        {/* 좌: 파라미터 */}
        <div className="card pg-params">
          <div className="card-head"><h3>설정</h3></div>
          <label className="pg-field">
            <span>모델</span>
            <select className="range-select" value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m.id} value={m.id} disabled={m.status === "unreachable"}>
                  {m.display_name}{m.status === "unreachable" ? " (미도달)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="pg-field">
            <span>max_tokens · {maxTokens}</span>
            <input type="range" min={16} max={1024} step={16} value={maxTokens} onChange={(e) => setMaxTokens(+e.target.value)} />
          </label>
          <label className="pg-field">
            <span>temperature · {temperature.toFixed(1)}</span>
            <input type="range" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(+e.target.value)} />
          </label>
          <button type="button" className="btn-ghost" onClick={() => setShowCode(true)} disabled={!model}>
            {"</> 코드 보기"}
          </button>
        </div>

        {/* 우: 대화 */}
        <div className="card pg-chat">
          <div className="pg-messages" ref={scrollRef}>
            {turns.length === 0 && <div className="empty">메시지를 입력해 모델을 시험해 보세요.</div>}
            {turns.map((t, i) => (
              <div key={i} className={`pg-msg ${t.role}`}>
                <div className={`pg-bubble ${t.blocked ? "pg-blocked" : ""}`}>
                  {t.blocked && <span className="tag tag-red" style={{ marginBottom: 6 }}>가드레일 차단</span>}
                  {t.content}
                </div>
                {t.metrics?.guard && (t.metrics.guard.guard_types?.length ?? 0) > 0 && (
                  <div className="pg-guard">
                    {t.metrics.guard.guard_types.map((g) => (
                      <span key={g} className={`tag ${g === "jailbreak" ? "tag-red" : "tag-pink"}`}>
                        {g === "pii" ? "PII 탐지" : g === "jailbreak" ? "Jailbreak 탐지" : g}
                      </span>
                    ))}
                    {t.metrics.guard.pii_entities?.length ? (
                      <span className="muted">{t.metrics.guard.pii_entities.map((e) => e.type).join(", ")}</span>
                    ) : null}
                  </div>
                )}
                {t.metrics && !t.blocked && (
                  <div className="pg-metrics" title="비스트리밍 응답이라 TTFT(첫 토큰 지연)는 표시할 수 없습니다 — 스트리밍 도입 후 추가됩니다.">
                    <span className="pg-mchip"><b>{t.metrics.latency_ms}</b>ms</span>
                    <span className="pg-mchip"><b>{t.metrics.tokens_per_sec}</b> tok/s</span>
                    <span className="pg-mchip">입력 <b>{t.metrics.prompt_tokens}</b></span>
                    <span className="pg-mchip">출력 <b>{t.metrics.completion_tokens}</b></span>
                    <span className="pg-mchip pg-mchip-muted">TTFT —</span>
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="pg-msg assistant"><div className="pg-bubble pg-typing">생성 중…</div></div>}
          </div>
          {err && <div className="state error" role="alert">{err}</div>}
          <div className="pg-input">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"
              rows={2}
            />
            <button type="button" className="btn-ghost" onClick={compare} disabled={comparing || !input.trim()} title="모든 모델에 동시 전송 비교">
              {comparing ? "비교 중…" : "모델 비교"}
            </button>
            <button type="button" className="btn-primary" onClick={send} disabled={busy || !input.trim() || !model}>
              전송
            </button>
          </div>
        </div>
      </div>

      {/* 멀티모델 비교 결과 */}
      {compareRows && (
        <div className="modal-overlay" onClick={() => setCompareRows(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>모델 비교 결과</h3>
              <button type="button" className="icon" aria-label="닫기" onClick={() => setCompareRows(null)}>✕</button>
            </div>
            <table className="usage-table">
              <thead>
                <tr><th>모델</th><th>응답</th><th className="num">지연</th><th className="num">tok/s</th><th className="num">입력</th><th className="num">출력</th></tr>
              </thead>
              <tbody>
                {compareRows.map((r) => (
                  <tr key={r.model}>
                    <td>{r.model}</td>
                    <td>{r.error ? <span className="muted">미도달: {r.error}</span> : r.blocked ? <span className="tag tag-red">차단</span> : (r.content || "…")}</td>
                    <td className="num">{r.latency ? `${r.latency}ms` : "—"}</td>
                    <td className="num">{r.tps || "—"}</td>
                    <td className="num">{r.ptoks || "—"}</td>
                    <td className="num">{r.ctoks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="modal-note">동일 프롬프트를 모든 도달 가능 모델에 동시 전송한 비교(Bedrock Compare 패턴). TTFT(첫 토큰 지연)는 스트리밍 도입 후 추가됩니다.</div>
          </div>
        </div>
      )}

      {/* View code 스니펫 */}
      {showCode && (
        <div className="modal-overlay" onClick={() => setShowCode(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>코드로 호출 — {model}</h3>
              <button type="button" className="icon" aria-label="닫기" onClick={() => setShowCode(false)}>✕</button>
            </div>
            {codeSnippets().map((s) => (
              <div key={s.lang} className="code-block">
                <div className="code-lang">{s.lang}</div>
                <pre className="manifest">{s.code}</pre>
              </div>
            ))}
            <div className="modal-note">x-api-key-id 헤더로 키 쿼터·귀속이 적용됩니다. 엔드포인트는 환경에 맞게 교체하세요.</div>
          </div>
        </div>
      )}
    </>
  );
}
