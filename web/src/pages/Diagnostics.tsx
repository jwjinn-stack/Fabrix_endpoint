import { useCallback, useEffect, useState } from "react";
import { fetchDiagnostics, probeOne, mcpListTools, mcpListResources, type McpTool, type McpResource } from "../api/client";
import type { DiagNetwork, DiagReport, DiagSample, DiagStatus, DiagTiming, FailKind } from "../api/types";
import type { Page } from "../components/Layout";
import Badge, { type BadgeTone } from "../components/Badge";
import { SkeletonRows } from "../components/Skeleton";
import InspectDrawer from "../components/InspectDrawer";
import InfoTip from "../components/InfoTip";
import { humanizeError } from "../utils/errors";
import { useCap } from "../capabilities";
import { useToast } from "../toast";

// 지연경고 임계 — 도달은 하지만 느린 경우 warn 으로 강조(O-07).
const SLOW_MS = 400;

type TileState = "ok" | "warn" | "fail" | "idle";

// 타일 상태 판정: 미구성=idle / 도달실패=fail / 지연=warn / 정상=ok.
function tileState(c: DiagStatus): TileState {
  if (!c.configured) return "idle";
  if (!c.reachable) return "fail";
  if (c.latency_ms >= SLOW_MS) return "warn";
  return "ok";
}

// 상태 배지: 미구성(중립) / 정상(녹색) / 지연(주의) / 실패(빨강).
function statusBadge(state: TileState) {
  const map: Record<TileState, { tone: BadgeTone; label: string }> = {
    idle: { tone: "neutral", label: "미구성" },
    ok: { tone: "green", label: "정상" },
    warn: { tone: "amber", label: "지연 경고" },
    fail: { tone: "red", label: "실패" },
  };
  const m = map[state];
  return <Badge tone={m.tone} dot>{m.label}</Badge>;
}

// 실패 원인 분류 → 사람이 읽는 라벨 + 조치 힌트(조치가 종류마다 다름 — 디버깅의 핵심).
const KIND_INFO: Record<FailKind, { label: string; hint: string }> = {
  ok: { label: "정상", hint: "" },
  dns_fail: { label: "이름 해석 실패", hint: "서비스명·네임스페이스(search domain)·CoreDNS 를 확인하세요." },
  conn_refused: { label: "연결 거부", hint: "포트·NetworkPolicy egress·대상 Pod 기동 여부를 확인하세요." },
  tls_fail: { label: "TLS/인증서 오류", hint: "CA·SNI·인증서 만료·프록시 MITM 을 확인하세요." },
  auth_fail: { label: "인증 실패", hint: "키·시크릿·RBAC 권한을 확인하세요." },
  timeout: { label: "시간 초과", hint: "방화벽 drop·과부하·잘못된 IP 를 확인하세요." },
  bad_status: { label: "비정상 응답", hint: "업스트림 서비스 자체 상태(4xx/5xx)를 확인하세요." },
  unreachable: { label: "도달 불가", hint: "네트워크 경로 전반을 확인하세요." },
};

// 단계 타이밍 막대 — DNS→TCP→TLS→서버 누적(어디서 느린지 한눈에).
const TIMING_SEGS: { key: keyof DiagTiming; label: string; cls: string }[] = [
  { key: "dns_ms", label: "DNS", cls: "seg-dns" },
  { key: "connect_ms", label: "TCP", cls: "seg-tcp" },
  { key: "tls_ms", label: "TLS", cls: "seg-tls" },
  { key: "server_ms", label: "서버", cls: "seg-srv" },
];
function TimingBar({ t }: { t: DiagTiming }) {
  const total = Math.max(t.dns_ms + t.connect_ms + t.tls_ms + t.server_ms, 1);
  return (
    <div className="diag-timing">
      <div className="diag-timing-bar" role="img" aria-label="단계별 지연">
        {TIMING_SEGS.map((s) => {
          const v = t[s.key] as number;
          if (v <= 0) return null;
          return <span key={s.label} className={`tseg ${s.cls}`} style={{ width: `${(v / total) * 100}%` }} title={`${s.label} ${v}ms`} />;
        })}
      </div>
      <div className="diag-timing-legend">
        {TIMING_SEGS.map((s) => {
          const v = t[s.key] as number;
          return <span key={s.label} className="tleg"><i className={`tdot ${s.cls}`} />{s.label} {v}ms</span>;
        })}
        {t.reused && <span className="tleg muted">· keep-alive 재사용</span>}
      </div>
    </div>
  );
}

// 지연 추세 sparkline — 언제부터 느려졌나/끊겼나.
function Sparkline({ samples }: { samples: DiagSample[] }) {
  if (!samples || samples.length < 2) return null;
  const w = 88, h = 20, max = Math.max(...samples.map((s) => s.latency_ms), 1);
  const pts = samples.map((s, i) => `${(i / (samples.length - 1)) * w},${h - (s.latency_ms / max) * (h - 3) - 1.5}`).join(" ");
  const hasFail = samples.some((s) => !s.reachable);
  return (
    <svg className="diag-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-label="지연 추세">
      <polyline points={pts} fill="none" stroke={hasFail ? "var(--red)" : "var(--green)"} strokeWidth="1.5" />
    </svg>
  );
}

// 응답 한 줄 요약(상태 + 지연).
function respLine(d: DiagStatus): string {
  if (d.reachable) return `✓ 응답 정상 · ${d.latency_ms}ms`;
  if (d.fail_kind && d.fail_kind !== "ok") return `✗ ${KIND_INFO[d.fail_kind].label} · ${d.latency_ms || 0}ms`;
  return "응답 없음";
}
// 계약 매칭 — 프로브가 기대한 응답을 받았나(Datadog validatesJSONSchema / Optic diff 축소판).
function contractMark(d: DiagStatus): { sym: string; cls: string; text: string } {
  if (d.reachable) return { sym: "✓", cls: "ok", text: "기대 형태와 일치" };
  if (d.fail_kind === "bad_status" || d.fail_kind === "auth_fail") return { sym: "✗", cls: "fail", text: "응답은 왔으나 불일치" };
  return { sym: "—", cls: "", text: "도달 못 해 확인 불가" };
}

// O-08+: 상태별 "구체 사유 + 조치 힌트" + 단계 타이밍 + 확장(요청 명세·응답/계약·지금 테스트).
function DiagTile({ c, onRetry, onInspect, onNavigate }: { c: DiagStatus; onRetry: () => void; onInspect: (s: DiagStatus) => void; onNavigate: (p: Page) => void }) {
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<DiagStatus | null>(null); // "지금 테스트" 결과(있으면 우선)
  const [tested, setTested] = useState(false);
  const [testing, setTesting] = useState(false);
  // 부모가 전체 재검사하면(c 교체) 단일 테스트 결과는 무효화.
  useEffect(() => { setLive(null); setTested(false); }, [c]);

  const data = live ?? c;
  const state = tileState(data);
  const showLatency = data.configured && data.reachable;
  const kind = data.fail_kind && data.fail_kind !== "ok" ? KIND_INFO[data.fail_kind] : null;
  const hasDetail = !!(data.request || data.timing || data.tls || data.remote_addr || data.details || (data.history && data.history.length > 1) || data.error);

  const reason =
    state === "fail" ? (kind?.hint || data.error || "도달하지 못했습니다(원인 미상).")
      : state === "idle" ? (data.fallback_note || "이 의존성은 구성되지 않았습니다(폴백 동작).")
        : state === "warn" ? `응답 지연 ${data.latency_ms}ms (임계 ${SLOW_MS}ms 초과) — 네트워크/부하를 점검하세요.`
          : null;

  const runTest = () => {
    setTesting(true);
    probeOne(c.name)
      .then((st) => { setLive(st); setTested(true); setOpen(true); })
      .catch((e) => { setLive({ ...data, reachable: false, fail_kind: "unreachable", error: humanizeError((e as Error).message) }); setTested(true); setOpen(true); })
      .finally(() => setTesting(false));
  };

  const cm = contractMark(data);

  return (
    <div className={`diag-tile ${state}`}>
      <div className="dt-head" style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
        {state === "idle" && <span className="pulse-dot" aria-hidden="true" />}
        <span style={{ fontWeight: 600 }}>{data.title}</span>
        <span className="spacer" style={{ flex: 1 }} />
        {kind && <Badge tone={state === "warn" ? "amber" : "red"}>{kind.label}</Badge>}
        {statusBadge(state)}
      </div>

      <div className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: 2 }}>{data.category}</div>

      {data.endpoint && (
        <code style={{ fontSize: "var(--fs-xs)", display: "block", marginTop: "var(--sp-1)", color: "var(--text-dim)", wordBreak: "break-all" }}>{data.endpoint}</code>
      )}

      {/* 단계 타이밍 — HTTP 프로브에서 자동 수집(DNS→TCP→TLS→서버) */}
      {data.timing && <TimingBar t={data.timing} />}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: "var(--sp-2)", alignItems: "center" }}>
        {data.required_by.map((r) => (
          <span key={r} className="pill">{r}</span>
        ))}
        {data.history && data.history.length > 1 && <Sparkline samples={data.history} />}
        {showLatency && (
          <span style={{ marginLeft: "auto", fontSize: "var(--fs-xs)", color: state === "warn" ? "var(--amber)" : "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
            {data.latency_ms}ms
          </span>
        )}
      </div>

      {reason && (
        <div className="fix">
          <div style={{ fontSize: "var(--fs-xs)", color: state === "fail" ? "var(--red)" : "var(--text-dim)", marginBottom: "var(--sp-2)" }}>
            {state === "fail" && <span aria-hidden="true">⚠ </span>}{reason}
          </div>
          {(state === "fail" || state === "warn") ? (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
              <button type="button" className="btn-ghost btn-sm" onClick={onRetry}>재시도</button>
              <button type="button" className="link-btn" onClick={() => onNavigate("credentials")}>설정 → 연동 고치기 →</button>
            </div>
          ) : (
            <button type="button" className="link-btn" onClick={() => onNavigate("credentials")}>설정 → 연동에서 구성하기 →</button>
          )}
        </div>
      )}

      {/* 확장 — 요청 명세 + 응답/계약 + 지금 테스트 + 통신 증거 */}
      {hasDetail && (
        <>
          <div className="diag-actions">
            <button type="button" className="diag-expand-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? "▾ 상세 닫기" : "▸ 통신 상세"}
            </button>
            {data.configured && (
              <button type="button" className="diag-expand-btn" onClick={() => onInspect(data)}>⤢ 통신 검사</button>
            )}
          </div>
          {open && (
            <div className="diag-detail-wrap">
              {/* 요청 — 이 프로브가 API 에 실제로 보내는 것 */}
              {data.request && (
                <>
                  <div className="diag-sec-h">요청 — 이 프로브가 API 에 보내는 것</div>
                  <dl className="diag-detail">
                    <dt>요청</dt><dd><code><b>{data.request.method}</b> {data.request.target}</code></dd>
                    {data.request.auth && (<><dt>인증</dt><dd>{data.request.auth}</dd></>)}
                    {data.request.body && (<><dt>본문</dt><dd><code>{data.request.body}</code></dd></>)}
                    {data.request.expect && (<><dt>기대</dt><dd>{data.request.expect}</dd></>)}
                  </dl>
                </>
              )}

              {/* 응답 — 마지막 프로브 / 방금 테스트 */}
              {data.configured && (
                <>
                  <div className="diag-sec-h">응답 — {tested ? "방금 테스트" : "마지막 프로브"}</div>
                  <dl className="diag-detail">
                    <dt>결과</dt>
                    <dd>{respLine(data)} · 계약 <span className={`diag-contract ${cm.cls}`}>{cm.sym} {cm.text}</span></dd>
                    {data.remote_addr && (<><dt>연결</dt><dd><code>{data.remote_addr}</code></dd></>)}
                    {data.timing && (<><dt>단계(ms)</dt><dd>DNS {data.timing.dns_ms} · TCP {data.timing.connect_ms} · TLS {data.timing.tls_ms} · 서버 {data.timing.server_ms} · TTFB {data.timing.ttfb_ms} · 합 {data.timing.total_ms}</dd></>)}
                    {data.tls && (<><dt>TLS</dt><dd>{data.tls.version} · {data.tls.cipher}<br />발급자 {data.tls.issuer} → {data.tls.subject}<br />만료 {data.tls.not_after?.slice(0, 10)} (<span className={data.tls.days_left < 30 ? "diag-warn-txt" : ""}>{data.tls.days_left}일 남음</span>)</dd></>)}
                    {data.details && Object.entries(data.details).map(([k, v]) => (
                      <span key={k} style={{ display: "contents" }}><dt>{k}</dt><dd><code>{typeof v === "object" ? JSON.stringify(v) : String(v)}</code></dd></span>
                    ))}
                    {data.error && (<><dt>원문 에러</dt><dd><code className="diag-warn-txt">{data.error}</code></dd></>)}
                  </dl>
                  <div className="diag-test-row">
                    <button type="button" className="btn-ghost btn-sm" onClick={runTest} disabled={testing}>
                      {testing ? "테스트 중…" : "▷ 지금 테스트"}
                    </button>
                    <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>설정 그대로 1회 재호출(read-only)</span>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// 파드 네트워크/설정 점검 — 쿠버 배포 시 "통신 설정이 제대로 됐나"를 프로브 전에 확인.
function NetworkPanel({ net }: { net: DiagNetwork }) {
  return (
    <div className="card diag-net">
      <div className="card-head">
        <h3>네트워크 · 설정 점검</h3>
        <InfoTip>이름 해석(CoreDNS)·resolv.conf·인클러스터·프록시·env→호스트 — 프로브 던지기 전 설정 검증</InfoTip>
      </div>

      <div className="diag-net-facts">
        <span className={`pill ${net.in_cluster ? "active" : "warn"}`}>{net.in_cluster ? "인클러스터" : "클러스터 외부"}</span>
        {net.api_server && <span className="diag-fact">API <code>{net.api_server}</code></span>}
        {net.kube_dns.length > 0 && <span className="diag-fact">DNS <code>{net.kube_dns.join(", ")}</code></span>}
        {net.search_domains.length > 0 && <span className="diag-fact">search <code>{net.search_domains.join(" ")}</code></span>}
        {net.http_proxy && <span className="diag-fact">proxy <code>{net.http_proxy}</code></span>}
        {net.no_proxy && <span className="diag-fact">NO_PROXY <code>{net.no_proxy}</code></span>}
      </div>

      {net.proxy_warnings && net.proxy_warnings.length > 0 && (
        <div className="state error" role="alert" style={{ marginTop: "var(--sp-2)" }}>
          {net.proxy_warnings.map((wmsg) => <div key={wmsg}>⚠ {wmsg}</div>)}
        </div>
      )}

      <div className="diag-net-table" role="table">
        <div className="dnt-row dnt-head" role="row">
          <span>의존성</span><span>env</span><span>해석 (scheme://host:port → IP)</span><span>DNS</span>
        </div>
        {net.hosts.map((h) => {
          const failed = !!h.error;
          const target = h.host ? `${h.scheme ? h.scheme + "://" : ""}${h.host}${h.port ? ":" + h.port : ""}` : "—";
          return (
            <div className={`dnt-row ${failed ? "dnt-fail" : ""}`} role="row" key={h.name + h.env_key}>
              <span>{h.name}</span>
              <span><code className="muted">{h.env_key}</code></span>
              <span>
                <code>{target}</code>
                {h.resolved && h.resolved.length > 0 && <span className="dnt-ips"> → {h.resolved.join(", ")}</span>}
                {h.error && <span className="diag-warn-txt"> · {h.error}</span>}
                {h.proxy_via && <span className="diag-warn-txt"> · ⚠ {h.proxy_via}</span>}
              </span>
              <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>{h.resolved ? `${h.latency_ms}ms` : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── AI 연동(MCP) ──────────────────────────────────────────────────────────
// 읽기 전용 FABRIX MCP 서버(POST /api/v1/mcp, JSON-RPC)의 발견·연결 진입점(IMP-5).
// dashboard cap 안에 등록(IMP-2 정합) — cap-off 면 "비활성"으로 표기.

// 엔드포인트 URL — 동일 오리진 가정(배포). SSR/null 오리진 폴백.
function mcpEndpointUrl(): string {
  const origin = typeof window !== "undefined" && window.location.origin && window.location.origin !== "null"
    ? window.location.origin
    : "http://localhost:8080";
  return `${origin}/api/v1/mcp`;
}

// per-client connect 스니펫. 1순위=npx mcp-remote stdio-bridge(이 브랜치에서 실제 동작),
// 네이티브 Streamable HTTP 커넥터는 IMP-9(coming soon)로만 표기.
function connectSnippet(client: McpClient, url: string): string {
  switch (client) {
    case "claude":
      return `claude mcp add fabrix -- npx -y mcp-remote ${url}`;
    case "cursor":
      // ~/.cursor/mcp.json (또는 프로젝트 .cursor/mcp.json)
      return JSON.stringify({ mcpServers: { fabrix: { command: "npx", args: ["-y", "mcp-remote", url] } } }, null, 2);
    case "generic":
    default:
      // 임의 MCP 클라이언트(JSON config) — stdio 로 mcp-remote 를 띄워 HTTP 백엔드에 브리지.
      return JSON.stringify({ mcpServers: { fabrix: { command: "npx", args: ["-y", "mcp-remote", url] } } }, null, 2);
  }
}

type McpClient = "claude" | "cursor" | "generic";
const MCP_CLIENTS: { id: McpClient; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "generic", label: "Vercel · 일반" },
];

function McpPanel({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const url = mcpEndpointUrl();
  const [tools, setTools] = useState<McpTool[] | null>(null);
  const [resources, setResources] = useState<McpResource[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [catErr, setCatErr] = useState<string | null>(null);
  const [client, setClient] = useState<McpClient>("claude");

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    setLoading(true);
    setCatErr(null);
    Promise.all([mcpListTools(ac.signal), mcpListResources(ac.signal)])
      .then(([t, r]) => { setTools(t); setResources(r); setLoading(false); })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setCatErr(humanizeError((e as Error).message));
        setLoading(false);
      });
    return () => ac.abort();
  }, [enabled]);

  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`${what} 복사됨`),
      () => toast.error("복사 실패 — 브라우저 권한을 확인하세요."),
    );
  };

  const snippet = connectSnippet(client, url);

  return (
    <div className="card">
      <div className="card-head">
        <h3>AI 연동 (MCP)</h3>
        <Badge tone="blue" dot>읽기 전용</Badge>
        <InfoTip>FABRIX 대시보드의 메트릭·차원·인사이트를 AI 에이전트(Claude·Cursor 등)에 읽기 전용 MCP 로 노출합니다. 자격증명은 노출되지 않으며, 조회만 가능합니다.</InfoTip>
      </div>

      {!enabled ? (
        <div className="state" role="status" style={{ marginTop: "var(--sp-2)" }}>
          이 프로파일에서는 AI 연동(MCP)이 <b>비활성</b>입니다(대시보드 조회 권한 필요).
        </div>
      ) : (
        <>
          {/* (a) 엔드포인트 URL + 복사 */}
          <div className="diag-sec-h">엔드포인트</div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
            <code style={{ fontSize: "var(--fs-xs)", wordBreak: "break-all", flex: 1, minWidth: 200 }}>{url}</code>
            <button type="button" className="btn-ghost btn-sm" onClick={() => copy(url, "엔드포인트 URL")}>복사</button>
          </div>
          <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-1)" }}>
            JSON-RPC 2.0 over HTTP POST. 읽기 전용 — 모든 tool 은 조회만 수행합니다.
          </p>

          {/* (b) LIVE 카탈로그 — 서버 tools/list + resources/list */}
          <div className="diag-sec-h" style={{ marginTop: "var(--sp-3)" }}>노출 tool · resource (라이브)</div>
          {loading ? (
            <SkeletonRows rows={4} cols={2} />
          ) : catErr ? (
            <div className="state error" role="alert">카탈로그를 불러오지 못했습니다 — {catErr}</div>
          ) : (
            <>
              <dl className="diag-detail">
                {(tools ?? []).map((t) => (
                  <span key={t.name} style={{ display: "contents" }}>
                    <dt><code>{t.name}</code></dt>
                    <dd>{t.description ?? "—"}</dd>
                  </span>
                ))}
                {(tools ?? []).length === 0 && <span style={{ display: "contents" }}><dt>—</dt><dd>노출된 tool 이 없습니다.</dd></span>}
              </dl>
              {(resources ?? []).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: "var(--sp-2)" }}>
                  {(resources ?? []).map((r) => (
                    <span key={r.uri} className="pill" title={r.description}>{r.name ?? r.uri}</span>
                  ))}
                </div>
              )}
            </>
          )}

          {/* (c) per-client connect 스니펫 */}
          <div className="diag-sec-h" style={{ marginTop: "var(--sp-3)" }}>연결 방법</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: "var(--sp-2)" }} role="tablist" aria-label="클라이언트">
            {MCP_CLIENTS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={client === c.id}
                className={`pill ${client === c.id ? "active" : ""}`}
                onClick={() => setClient(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-2)" }}>
            <pre style={{ flex: 1, margin: 0, padding: "var(--sp-2)", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: "var(--fs-xs)", overflowX: "auto", whiteSpace: "pre" }}>{snippet}</pre>
            <button type="button" className="btn-ghost btn-sm" onClick={() => copy(snippet, "연결 스니펫")}>복사</button>
          </div>
          <p className="muted" style={{ fontSize: "var(--fs-xs)", marginTop: "var(--sp-1)" }}>
            <code>npx mcp-remote</code> 가 로컬 stdio 를 이 HTTP 엔드포인트로 브리지합니다(권장). 네이티브 Streamable HTTP 커넥터(<code>claude mcp add --transport http</code>)는 <b>coming soon (IMP-9)</b> 입니다.
          </p>

          {/* (d) 보안/신뢰 노트 */}
          <div className="state" role="note" style={{ marginTop: "var(--sp-2)", fontSize: "var(--fs-xs)" }}>
            🔒 읽기 전용입니다 — tool 은 메트릭·인사이트를 조회만 합니다(쓰기·삭제 없음). 자격증명·시크릿은 노출되지 않습니다. 이 엔드포인트는 사내 네트워크에서만 접근 가능해야 합니다.
          </div>
        </>
      )}
    </div>
  );
}

// 연동 상태 — 외부 의존성 능동 프로브 + 통신 디버깅(실사이트 연동·디버깅용). GET /api/v1/diagnostics.
export default function Diagnostics({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { can } = useCap();
  const [report, setReport] = useState<DiagReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [verbose, setVerbose] = useState(false);
  const [inspect, setInspect] = useState<DiagStatus | null>(null); // 통신 검사 드로어 대상

  const load = useCallback((signal?: AbortSignal, vb = verbose) => {
    setLoading(true);
    setError(null);
    fetchDiagnostics(signal, vb)
      .then((r) => {
        setReport(r);
        setLoading(false);
      })
      .catch((e) => {
        if (signal?.aborted) return;
        setError(humanizeError((e as Error).message));
        setLoading(false);
      });
  }, [verbose]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const s = report?.summary;
  return (
    <>
      <div className="page-head">
        <h1>연동 상태</h1>
        <span className="crumb">시스템 / 외부 의존성 진단</span>
        <div className="spacer" />
        {s && (
          <span className="updated">
            도달 {s.reachable}/{s.configured} · 점검필요 {s.degraded} · 전체 {s.total}
          </span>
        )}
        <label className="diag-verbose-toggle" title="클라이언트별 심층 진단(추가 왕복) — 레지스트리 버전·프로젝트 등">
          <input type="checkbox" checked={verbose} onChange={(e) => { setVerbose(e.target.checked); load(undefined, e.target.checked); }} />
          심층 진단
        </label>
        <button type="button" className="btn-ghost" onClick={() => load()} disabled={loading}>
          {loading ? "검사 중…" : "재검사"}
        </button>
      </div>

      <p className="muted" style={{ marginTop: -4, fontSize: "var(--fs-body)" }}>
        이 Pod 에서 외부 의존성에 실제로 연결되는지 능동 프로브(read-only)로 확인합니다. 단계별 지연(DNS·TCP·TLS·서버)·실패 원인·네트워크 설정을 함께 보여줍니다. 자격증명(비밀번호)은 표시되지 않습니다.
      </p>

      {error && <div className="state error" role="alert">{error}</div>}

      {s && !error && (
        <div className={`state ${s.degraded > 0 ? "error" : ""}`} role="status">
          {s.degraded > 0
            ? `구성된 ${s.configured}개 중 ${s.degraded}개가 도달 불가입니다. 아래 타일의 사유·단계 타이밍·통신 상세를 확인하세요.`
            : `구성된 ${s.configured}개 의존성 모두 정상입니다. (전체 ${s.total}개 중 ${s.total - s.configured}개는 미구성 — 폴백 동작)`}
        </div>
      )}

      {report?.network && !error && <NetworkPanel net={report.network} />}

      <div className="card">
        <div className="card-head">
          <h3>외부 의존성</h3>
          <InfoTip>configured=env 구성됨 · reachable=실제 연결됨 · required_by=이 의존성이 받쳐주는 기능 · 단계바=DNS/TCP/TLS/서버 분해</InfoTip>
        </div>
        {loading && !report ? (
          <SkeletonRows rows={8} cols={5} />
        ) : (
          <div className="diag-tiles">
            {report?.checks.map((c) => (
              <DiagTile key={c.name} c={c} onRetry={() => load()} onInspect={setInspect} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>

      <McpPanel enabled={can("dashboard")} />

      <InspectDrawer status={inspect} onClose={() => setInspect(null)} />
    </>
  );
}
