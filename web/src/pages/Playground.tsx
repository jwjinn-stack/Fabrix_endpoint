import { useCallback, useEffect, useRef, useState } from "react";
import { fetchModels, playgroundChat } from "../api/client";
import type { ChatMessage, ChatResponse, ModelInfo } from "../api/types";

// M-01 — 6상태(+idle) 머신. 메시지/요청 생애주기를 enum 으로 명시.
//   idle → queued → thinking → streaming → complete
//                                       ↘ stopped → (이어서) streaming / (다시 생성) queued
//   (queued|thinking|streaming 중 실패) → error → (다시 시도) queued
type ChatStatus = "idle" | "queued" | "thinking" | "streaming" | "complete" | "error" | "stopped";

interface Turn {
  role: "user" | "assistant";
  // 화면에 그려지는(타이프라이터로 누적된) 내용.
  content: string;
  // 어시스턴트 응답의 전체 본문(스트리밍 목표). 사용자 메시지는 content 와 동일.
  full?: string;
  metrics?: ChatResponse;
  // 응답에 쓰인 모델 표시명(라벨용).
  modelLabel?: string;
  blocked?: boolean;
  status?: ChatStatus;
  // 실측 TTFT(ms) — 첫 글자가 화면에 그려지는 순간까지.
  ttft?: number;
  // error 상태일 때 구체 사유.
  error?: string;
  // stopped 상태일 때 "이어서"용으로 보존되는, 응답 생성에 쓰인 history.
  reqHistory?: ChatMessage[];
}

function resolveModel(requested: string | undefined, models: ModelInfo[]): string {
  const reachable = models.filter((m) => m.status !== "unreachable");
  const candidates = reachable.length > 0 ? reachable : models;
  if (requested && candidates.some((m) => m.id === requested)) return requested;
  return candidates[0]?.id ?? "";
}

// 가드레일 판정을 평문 신뢰도 큐로 변환(M-04). 예: "가드레일: PII 탐지(높음)".
function guardCue(g: NonNullable<ChatResponse["guard"]>): string | null {
  const types = g.guard_types ?? [];
  if (types.length === 0 && g.decision === "allowed") return null;
  const label = (t: string) => (t === "pii" ? "PII 탐지" : t === "jailbreak" ? "Jailbreak 탐지" : t);
  const level = (c: number) => (c >= 0.8 ? "높음" : c >= 0.5 ? "중간" : "낮음");
  const parts: string[] = [];
  for (const t of types) {
    if (t === "jailbreak") parts.push(`${label(t)}(${level(g.jb_confidence)})`);
    else if (t === "pii") {
      const top = (g.pii_entities ?? []).reduce((m, e) => Math.max(m, e.confidence), 0);
      parts.push(top > 0 ? `${label(t)}(${level(top)})` : label(t));
    } else parts.push(label(t));
  }
  const decision = g.decision === "blocked" ? "차단" : g.decision === "flagged" ? "주의" : null;
  const head = decision ? `${decision} · ` : "";
  return parts.length ? `가드레일: ${head}${parts.join(", ")}` : (decision ? `가드레일: ${head.replace(" · ", "")}` : null);
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// 플레이그라운드 — 카탈로그에서 고른 모델을 즉시 채팅으로 검증 (TPS·토큰·지연·TTFT 표시).
export default function Playground({ initialModel }: { initialModel?: string }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState(initialModel ?? "");
  const [maxTokens, setMaxTokens] = useState(256);
  const [temperature, setTemperature] = useState(0.7);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  // 진행 중 요청의 상태(전송 버튼/입력 잠금 판단). idle 이면 입력 가능.
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [showCode, setShowCode] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareRows, setCompareRows] = useState<{ model: string; content: string; latency: number; tps: number; ptoks: number; ctoks: number; blocked: boolean; error?: string }[] | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  // 오토스크롤 추종 여부(사용자가 위로 스크롤하면 false). 하단 100px 이내면 true.
  const [following, setFollowing] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 응답 생성이 끝나(idle 복귀) 입력으로 포커스 이동 — 키보드/스크린리더 흐름 개선.
  const prevStatusRef = useRef<ChatStatus>("idle");
  useEffect(() => {
    if (prevStatusRef.current !== "idle" && status === "idle") inputRef.current?.focus();
    prevStatusRef.current = status;
  }, [status]);

  // 타이프라이터 RAF/타이머 핸들 — cleanup 용.
  const rafRef = useRef<number | null>(null);
  // stop 요청 플래그(stale closure 회피용 ref). 타이프라이터 루프가 참조.
  const stopRef = useRef(false);
  // 추종 여부 ref(스크롤 핸들러·타이프라이터 양쪽에서 최신값 필요).
  const followingRef = useRef(true);
  useEffect(() => { followingRef.current = following; }, [following]);

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

  // 언마운트 시 RAF 정리.
  useEffect(() => () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); }, []);

  const atBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  // 추종 중일 때만 하단으로. (M-02 오토스크롤)
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el && followingRef.current) el.scrollTo(0, el.scrollHeight);
  }, []);

  // 새 메시지 추가 시(추종 중) 하단으로.
  useEffect(() => { scrollToBottom(); }, [turns.length, scrollToBottom]);

  // 사용자 스크롤 → 하단 100px 이내면 추종 재개, 아니면 중단 + "최신으로" 노출.
  const onScroll = useCallback(() => {
    setFollowing(atBottom());
  }, [atBottom]);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setFollowing(true);
  }, []);

  // 타이프라이터 — full 의 [from] 부터 한 프레임에 2~4자씩 누적. 첫 글자 그릴 때 TTFT 확정.
  // idx: turns 내 어시스턴트 메시지 인덱스. sendStart: 전송 직전 timestamp(TTFT 기준).
  const runTypewriter = useCallback((idx: number, full: string, from: number, sendStart: number) => {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    stopRef.current = false;

    // reduced-motion: 즉시 전체 표시 + complete.
    if (prefersReducedMotion()) {
      const ttft = Math.max(1, Math.round(performance.now() - sendStart));
      setTurns((t) => t.map((tn, i) => (i === idx ? { ...tn, content: full, status: "complete", ttft: tn.ttft ?? ttft } : tn)));
      scrollToBottom();
      setStatus("idle");
      return;
    }

    let pos = from;
    let firstDrawn = from > 0; // 이어서면 이미 첫 글자는 그려진 상태.
    let last = 0;
    const STEP_MS = 16; // 프레임 간 최소 간격.

    const tick = (now: number) => {
      if (stopRef.current) { rafRef.current = null; return; }
      if (now - last >= STEP_MS) {
        last = now;
        const chunk = 2 + Math.floor(Math.random() * 3); // 2~4자
        pos = Math.min(full.length, pos + chunk);
        const slice = full.slice(0, pos);
        if (!firstDrawn && slice.length > 0) {
          firstDrawn = true;
          const ttft = Math.max(1, Math.round(performance.now() - sendStart));
          setTurns((t) => t.map((tn, i) => (i === idx ? { ...tn, content: slice, ttft } : tn)));
        } else {
          setTurns((t) => t.map((tn, i) => (i === idx ? { ...tn, content: slice } : tn)));
        }
        scrollToBottom();
        if (pos >= full.length) {
          setTurns((t) => t.map((tn, i) => (i === idx ? { ...tn, content: full, status: "complete" } : tn)));
          setStatus("idle");
          rafRef.current = null;
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [scrollToBottom]);

  // 응답을 받아 어시스턴트 turn 을 streaming 으로 만들고 타이프라이터 시작.
  const beginStream = useCallback((idx: number, r: ChatResponse, history: ChatMessage[], sendStart: number, modelLabel: string) => {
    const blocked = r.guard?.decision === "blocked";
    setTurns((t) =>
      t.map((tn, i) =>
        i === idx ? { ...tn, full: r.content, content: "", metrics: r, blocked, modelLabel, status: blocked ? "complete" : "streaming", reqHistory: history } : tn,
      ),
    );
    setFollowing(true);
    // 차단 응답은 짧고 타이핑 의미가 옅으므로 즉시 전체 표시 + complete.
    if (blocked) {
      const ttft = Math.max(1, Math.round(performance.now() - sendStart));
      setTurns((t) => t.map((tn, i) => (i === idx ? { ...tn, content: r.content, ttft } : tn)));
      setStatus("idle");
      scrollToBottom();
      return;
    }
    setStatus("streaming");
    runTypewriter(idx, r.content, 0, sendStart);
  }, [runTypewriter, scrollToBottom]);

  // 공통 요청 실행: queued → thinking → (응답) streaming. assistantIdx 위치에 플레이스홀더가 이미 있어야 함.
  const runRequest = useCallback(async (assistantIdx: number, history: ChatMessage[]) => {
    const sendStart = performance.now();
    setStatus("queued");
    setTurns((t) => t.map((tn, i) => (i === assistantIdx ? { ...tn, status: "queued", error: undefined } : tn)));
    // queued 는 아주 짧게 보여주고 thinking 으로.
    await new Promise((res) => setTimeout(res, 280));
    setStatus("thinking");
    setTurns((t) => t.map((tn, i) => (i === assistantIdx ? { ...tn, status: "thinking" } : tn)));
    const targetModel = model;
    const label = models.find((m) => m.id === targetModel)?.display_name ?? targetModel;
    try {
      const r = await playgroundChat(targetModel, history, { maxTokens, temperature });
      beginStream(assistantIdx, r, history, sendStart, label);
    } catch (e) {
      const msg = (e as Error).message;
      setTurns((t) => t.map((tn, i) => (i === assistantIdx ? { ...tn, status: "error", error: msg, modelLabel: label } : tn)));
      setStatus("idle");
    }
  }, [model, models, maxTokens, temperature, beginStream]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !model || status !== "idle") return;
    const history: ChatMessage[] = [
      ...turns.map((t) => ({ role: t.role, content: t.content })),
      { role: "user", content: text },
    ];
    // 인덱스는 turns 길이로 결정론적으로 계산한다. setTurns 업데이터 부수효과로
    // 잡으면 업데이터가 비동기 실행돼 runRequest 호출 시점엔 아직 미설정(-1)이라
    // 이후 모든 turn 갱신이 무시돼 "대기 중"에 고착된다.
    const assistantIdx = turns.length + 1; // [..., user(turns.length), assistant(+1)]
    setTurns((t) => [
      ...t,
      { role: "user" as const, content: text, status: "complete" as const },
      { role: "assistant" as const, content: "", status: "queued" as const },
    ]);
    setInput("");
    await runRequest(assistantIdx, history);
  }, [input, model, status, turns, runRequest]);

  // M-02 — 중지: 타이프라이터 멈춤 + 부분 출력 보존 + stopped.
  const stop = useCallback(() => {
    stopRef.current = true;
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setTurns((t) => t.map((tn) => (tn.status === "streaming" || tn.status === "queued" || tn.status === "thinking" ? { ...tn, status: "stopped" } : tn)));
    setStatus("idle");
  }, []);

  // stopped → 이어서: 보존된 full 의 현재 위치부터 계속.
  const resume = useCallback((idx: number) => {
    const tn = turns[idx];
    if (!tn || tn.full == null) return;
    setStatus("streaming");
    setFollowing(true);
    setTurns((t) => t.map((x, i) => (i === idx ? { ...x, status: "streaming" } : x)));
    // sendStart 를 현재로 두면 이어서의 TTFT 는 의미 없으므로 기존 ttft 유지(첫 글자 이미 그려짐).
    runTypewriter(idx, tn.full, tn.content.length, performance.now());
  }, [turns, runTypewriter]);

  // stopped/complete → 다시 생성: 같은 history 로 재요청(부분 출력 폐기).
  const regenerate = useCallback((idx: number) => {
    const tn = turns[idx];
    const history = tn?.reqHistory;
    if (!history || status !== "idle") return;
    setTurns((t) => t.map((x, i) => (i === idx ? { ...x, content: "", full: undefined, metrics: undefined, blocked: false, status: "queued", ttft: undefined, error: undefined } : x)));
    void runRequest(idx, history);
  }, [turns, status, runRequest]);

  // error → 다시 시도: 직전 사용자 메시지까지의 history 로 재요청.
  const retry = useCallback((idx: number) => {
    if (status !== "idle") return;
    const history: ChatMessage[] = turns.slice(0, idx).map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => t.map((x, i) => (i === idx ? { ...x, status: "queued", error: undefined } : x)));
    void runRequest(idx, history);
  }, [turns, status, runRequest]);

  const copyMsg = useCallback((idx: number, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(idx);
      setTimeout(() => setCopied((c) => (c === idx ? null : c)), 1400);
    }).catch(() => {});
  }, []);

  // 멀티모델 비교(#11) — 현재 입력을 채팅 가능한 모든 모델에 동시에 보내 결과를 표로 비교.
  const compare = useCallback(async () => {
    const text = input.trim();
    if (!text || comparing) return;
    const targets = models.filter((m) => m.status !== "unreachable");
    if (targets.length === 0) return;
    setComparing(true);
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

  const streamingNow = status === "queued" || status === "thinking" || status === "streaming";

  return (
    <>
      <div className="page-head">
        <h1>플레이그라운드</h1>
        <span className="crumb">모델 / 플레이그라운드</span>
        <div className="spacer" />
        <button type="button" className="btn-ghost" onClick={() => { stop(); setTurns([]); }} disabled={turns.length === 0}>
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
        <div className="card pg-chat" style={{ position: "relative" }}>
          <div className="pg-messages" ref={scrollRef} onScroll={onScroll} role="log" aria-live="polite" aria-relevant="additions text" aria-label="대화 내용">
            {turns.length === 0 && (
              <div className="pg-empty">
                <p className="empty" style={{ margin: 0 }}>메시지를 입력해 모델을 시험해 보세요.</p>
                <div className="pg-suggest">
                  {["한 문장으로 요약해줘", "이 코드의 버그를 찾아줘", "표로 정리해줘", "쉬운 말로 설명해줘"].map((sug) => (
                    <button key={sug} type="button" className="pg-suggest-chip" onClick={() => { setInput(sug); inputRef.current?.focus(); }}>{sug}</button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((t, i) => {
              if (t.role === "user") {
                return (
                  <div key={i} className="pg-msg user">
                    <div className="pg-bubble">{t.content}</div>
                  </div>
                );
              }
              // 어시스턴트 메시지 — 상태별 렌더.
              const st = t.status ?? "complete";
              const cue = t.metrics?.guard ? guardCue(t.metrics.guard) : null;
              return (
                <div key={i} className="pg-msg assistant">
                  {/* 모델 라벨(M-04) */}
                  {t.modelLabel && (
                    <span className="muted" style={{ fontSize: "var(--fs-xs)", marginBottom: 2 }}>{t.modelLabel}</span>
                  )}

                  {st === "queued" && (
                    <div className="pg-bubble pg-typing" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="pulse-dot" /> 대기 중
                    </div>
                  )}

                  {st === "thinking" && (
                    <div className="pg-bubble pg-typing">생성 준비 중…</div>
                  )}

                  {st === "error" && (
                    <div className="pg-bubble" style={{ background: "var(--red-weak)", border: "1px solid var(--red-border)", color: "var(--red)" }}>
                      <div style={{ marginBottom: 6 }}>응답 생성에 실패했습니다 — {t.error}</div>
                      <button type="button" className="btn-ghost" onClick={() => retry(i)} disabled={status !== "idle"}>
                        다시 시도
                      </button>
                    </div>
                  )}

                  {(st === "streaming" || st === "complete" || st === "stopped") && (
                    <>
                      <div className={`pg-bubble ${t.blocked ? "pg-blocked" : ""}`}>
                        {t.blocked && <span className="tag tag-red" style={{ marginBottom: 6 }}>가드레일 차단</span>}
                        {t.content}
                        {st === "streaming" && <span className="stream-caret" />}
                      </div>
                      {/* 차단 가이드 — 왜 막혔고 어디서 정책을 보는지 */}
                      {t.blocked && (
                        <div className="pg-guard-hint">
                          입력에서 위험·민감 표현이 감지되어 정책에 따라 차단되었습니다. 발동 규칙·통과 조건은 <b>가드레일</b> 화면의 해당 증적에서 확인할 수 있습니다.
                        </div>
                      )}

                      {/* 평문 신뢰도/판정 큐(M-04) */}
                      {cue && (
                        <div className="pg-guard">
                          <span className={`tag ${t.metrics?.guard?.decision === "blocked" || (t.metrics?.guard?.guard_types ?? []).includes("jailbreak") ? "tag-red" : "tag-pink"}`}>
                            {cue}
                          </span>
                        </div>
                      )}

                      {/* stopped 복구 액션 */}
                      {st === "stopped" && (
                        <div className="pg-guard" style={{ marginTop: 6 }}>
                          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>중지됨 · 부분 응답 보존</span>
                          {t.full != null && t.content.length < t.full.length && (
                            <button type="button" className="btn-ghost" onClick={() => resume(i)} disabled={status !== "idle"}>이어서</button>
                          )}
                          {t.reqHistory && (
                            <button type="button" className="btn-ghost" onClick={() => regenerate(i)} disabled={status !== "idle"}>다시 생성</button>
                          )}
                        </div>
                      )}

                      {/* complete: 메트릭 칩 + 복사 (M-03 TTFT 실측) */}
                      {st === "complete" && t.metrics && !t.blocked && (
                        <div className="pg-metrics">
                          <span className="pg-mchip"><b>{t.metrics.latency_ms}</b>ms</span>
                          <span className="pg-mchip"><b>{t.metrics.tokens_per_sec}</b> tok/s</span>
                          <span className="pg-mchip">입력 <b>{t.metrics.prompt_tokens}</b></span>
                          <span className="pg-mchip">출력 <b>{t.metrics.completion_tokens}</b></span>
                          <span className="pg-mchip" title="첫 토큰이 화면에 그려지기까지의 실측 지연(타이프라이터 첫 프레임 기준).">
                            TTFT <b>{t.ttft != null ? t.ttft : "—"}</b>{t.ttft != null ? "ms" : ""}
                          </span>
                          <button
                            type="button"
                            className="pg-mchip"
                            style={{ cursor: "pointer", background: "transparent" }}
                            onClick={() => copyMsg(i, t.content)}
                            title="응답 복사"
                          >
                            {copied === i ? "복사됨 ✓" : "복사"}
                          </button>
                        </div>
                      )}

                      {/* complete 인데 차단(메트릭 없을 수도) — 복사만 */}
                      {st === "complete" && t.blocked && (
                        <div className="pg-metrics">
                          <button type="button" className="pg-mchip" style={{ cursor: "pointer", background: "transparent" }} onClick={() => copyMsg(i, t.content)} title="응답 복사">
                            {copied === i ? "복사됨 ✓" : "복사"}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* "최신으로" — 추종 중단 상태에서만 (M-02) */}
          {!following && turns.length > 0 && (
            <button
              type="button"
              className="btn-ghost"
              onClick={jumpToLatest}
              style={{ position: "absolute", bottom: 96, left: "50%", transform: "translateX(-50%)", zIndex: 2, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}
            >
              ↓ 최신으로
            </button>
          )}

          <div className="pg-input">
            <textarea
              ref={inputRef}
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
            <button type="button" className="btn-ghost" onClick={compare} disabled={comparing || streamingNow || !input.trim()} title="모든 모델에 동시 전송 비교">
              {comparing ? "비교 중…" : "모델 비교"}
            </button>
            {streamingNow ? (
              <button type="button" className="btn-primary" onClick={stop} title="생성 중지 — 부분 출력은 보존됩니다">
                중지
              </button>
            ) : (
              <button type="button" className="btn-primary" onClick={send} disabled={!input.trim() || !model}>
                전송
              </button>
            )}
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
            <div className="modal-note">동일 프롬프트를 모든 도달 가능 모델에 동시 전송한 비교(Bedrock Compare 패턴). 단발 비교는 비스트리밍 호출이라 TTFT 는 채팅 응답에서만 표기됩니다.</div>
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
