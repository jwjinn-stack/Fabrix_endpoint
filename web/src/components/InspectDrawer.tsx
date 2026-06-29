import { useCallback, useEffect, useState } from "react";
import { probeOne } from "../api/client";
import type { DiagStatus } from "../api/types";
import SlidePanel from "./SlidePanel";
import Badge from "./Badge";

// 통신 검사 드로어 — Chrome DevTools Network 패널 스타일(개요/요청/응답/타이밍/이력).
// 열릴 때 해당 의존성을 라이브 재프로브(probeOne)해 실제 요청/응답(캡처)을 가져온다.
// "보고 → 설정 고치기 → 재검사" 루프를 한 패널에서 닫는다.

const KIND: Record<string, string> = {
  ok: "정상", dns_fail: "이름 해석 실패", conn_refused: "연결 거부", tls_fail: "TLS/인증서 오류",
  auth_fail: "인증 실패", timeout: "시간 초과", bad_status: "비정상 응답", unreachable: "도달 불가",
};
const HINT: Record<string, string> = {
  dns_fail: "서비스명·네임스페이스(search domain)·CoreDNS 확인", conn_refused: "포트·NetworkPolicy egress·Pod 기동 확인",
  tls_fail: "CA·SNI·인증서 만료·프록시 MITM 확인", auth_fail: "키·시크릿·RBAC 확인",
  timeout: "방화벽 drop·과부하·잘못된 IP 확인", bad_status: "업스트림 서비스 상태(4xx/5xx) 확인", unreachable: "네트워크 경로 확인",
};

type Tab = "overview" | "request" | "response" | "timing" | "history";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "개요" }, { key: "request", label: "요청" }, { key: "response", label: "응답" },
  { key: "timing", label: "타이밍" }, { key: "history", label: "이력" },
];

function contract(d: DiagStatus): { sym: string; cls: string; text: string } {
  if (d.reachable) return { sym: "✓", cls: "ok", text: "기대 형태와 일치" };
  if (d.fail_kind === "bad_status" || d.fail_kind === "auth_fail") return { sym: "✗", cls: "fail", text: "응답은 왔으나 불일치" };
  return { sym: "—", cls: "", text: "도달 못 해 확인 불가" };
}

function Headers({ h }: { h?: Record<string, string> }) {
  if (!h || Object.keys(h).length === 0) return <span className="muted">—</span>;
  return <div className="ins-headers">{Object.entries(h).map(([k, v]) => <div key={k}><span className="ins-hk">{k}:</span> {v}</div>)}</div>;
}

export default function InspectDrawer({ status, onClose }: { status: DiagStatus | null; onClose: () => void }) {
  const [data, setData] = useState<DiagStatus | null>(status);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback((name: string) => {
    setBusy(true);
    probeOne(name).then(setData).catch(() => { /* keep prev */ }).finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    setData(status); setTab("overview");
    if (status) refresh(status.name);
  }, [status, refresh]);

  if (!status) return null;
  const d = data ?? status;
  const cm = contract(d);
  const t = d.timing;
  const total = t ? Math.max(t.dns_ms + t.connect_ms + t.tls_ms + t.server_ms, 1) : 1;
  const pct = (v: number) => `${(v / total) * 100}%`;

  return (
    <SlidePanel
      open={!!status}
      width={560}
      title={<>통신 검사 · {d.title}</>}
      subtitle={<code>{d.endpoint}</code>}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => refresh(d.name)} disabled={busy}>{busy ? "테스트 중…" : "▷ 지금 테스트"}</button>
          <a className="btn-ghost btn-sm" href="/settings">설정 고치기 →</a>
          <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>read-only 재프로브 · 자격증명 마스킹</span>
        </div>
      }
    >
      <div className="ins-tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={tab === x.key}
            className={`ins-tab ${tab === x.key ? "on" : ""}`} onClick={() => setTab(x.key)}>{x.label}</button>
        ))}
      </div>

      {tab === "overview" && (
        <dl className="diag-detail">
          <dt>상태</dt>
          <dd>
            <Badge tone={d.reachable ? "green" : d.configured ? "red" : "neutral"} dot>
              {d.configured ? (d.reachable ? "정상" : (d.fail_kind ? KIND[d.fail_kind] : "실패")) : "미구성"}
            </Badge>
            {d.configured && d.reachable && <span className="muted"> · {d.latency_ms}ms</span>}
            {busy && <span className="muted"> · 갱신 중…</span>}
          </dd>
          <dt>계약</dt><dd><span className={`diag-contract ${cm.cls}`}>{cm.sym} {cm.text}</span></dd>
          {!d.reachable && d.fail_kind && d.fail_kind !== "ok" && (<><dt>조치</dt><dd className="diag-warn-txt">{HINT[d.fail_kind]}</dd></>)}
          {d.remote_addr && (<><dt>연결</dt><dd><code>{d.remote_addr}</code></dd></>)}
          {t && (<><dt>지연</dt><dd>DNS {t.dns_ms} · TCP {t.connect_ms} · TLS {t.tls_ms} · 서버 {t.server_ms} · 합 {t.total_ms}ms</dd></>)}
          {d.tls && (<><dt>TLS</dt><dd>{d.tls.version} · 발급자 {d.tls.issuer} · 만료 {d.tls.not_after?.slice(0, 10)} (<span className={d.tls.days_left < 30 ? "diag-warn-txt" : ""}>{d.tls.days_left}일</span>)</dd></>)}
          {d.error && (<><dt>원문 에러</dt><dd><code className="diag-warn-txt">{d.error}</code></dd></>)}
          {d.details && Object.entries(d.details).map(([k, v]) => (<span key={k} style={{ display: "contents" }}><dt>{k}</dt><dd><code>{typeof v === "object" ? JSON.stringify(v) : String(v)}</code></dd></span>))}
        </dl>
      )}

      {tab === "request" && (
        <dl className="diag-detail">
          {d.request && (<><dt>명세</dt><dd><code><b>{d.request.method}</b> {d.request.target}</code></dd></>)}
          {d.request?.expect && (<><dt>기대</dt><dd>{d.request.expect}</dd></>)}
          {d.probe?.req_url ? (
            <>
              <dt>실제 URL</dt><dd><code>{d.probe.req_method} {d.probe.req_url}</code></dd>
              <dt>요청 헤더</dt><dd><Headers h={d.probe.req_headers} /></dd>
              <dt>요청 본문</dt><dd>{d.probe.req_body ? <pre className="ins-pre">{d.probe.req_body}</pre> : <span className="muted">(없음)</span>}</dd>
            </>
          ) : (
            <><dt>실제 캡처</dt><dd className="muted">HTTP 프로브가 아니거나(예: pgx·kubectl·S3) 아직 미실행 — "지금 테스트"로 캡처</dd></>
          )}
        </dl>
      )}

      {tab === "response" && (
        d.probe && (d.probe.status_code || d.probe.resp_body) ? (
          <dl className="diag-detail">
            <dt>상태</dt><dd><code>{d.probe.status_code} · {d.probe.http_version}</code></dd>
            <dt>응답 헤더</dt><dd><Headers h={d.probe.resp_headers} /></dd>
            <dt>응답 본문</dt><dd>{d.probe.resp_body ? <pre className="ins-pre">{d.probe.resp_body}</pre> : <span className="muted">(빈 본문)</span>}</dd>
          </dl>
        ) : (
          <div className="muted" style={{ fontSize: "var(--fs-sm)", padding: "8px 0" }}>
            HTTP 응답 본문이 없습니다(비-HTTP 프로브 또는 미도달). 개요 탭에서 결과·원인을 확인하세요.
          </div>
        )
      )}

      {tab === "timing" && (
        t ? (
          <div>
            <div className="ins-wf">
              {[{ k: "DNS", v: t.dns_ms, c: "seg-dns" }, { k: "TCP", v: t.connect_ms, c: "seg-tcp" }, { k: "TLS", v: t.tls_ms, c: "seg-tls" }, { k: "서버", v: t.server_ms, c: "seg-srv" }].map((s) => (
                s.v > 0 ? <div key={s.k} className="ins-wf-row"><span className="ins-wf-l">{s.k}</span><span className={`ins-wf-bar ${s.c}`} style={{ width: pct(s.v) }} /><span className="ins-wf-v">{s.v}ms</span></div> : null
              ))}
            </div>
            <dl className="diag-detail" style={{ marginTop: 10 }}>
              <dt>TTFB</dt><dd>{t.ttfb_ms}ms (첫 응답 바이트)</dd>
              <dt>합계</dt><dd>{t.total_ms}ms</dd>
              <dt>커넥션</dt><dd>{t.reused ? "keep-alive 재사용" : "신규 연결"}</dd>
            </dl>
          </div>
        ) : <div className="muted" style={{ fontSize: "var(--fs-sm)", padding: "8px 0" }}>단계 타이밍은 HTTP 프로브에서만 수집됩니다.</div>
      )}

      {tab === "history" && (
        d.history && d.history.length > 0 ? (
          <div className="ins-hist">
            {[...d.history].reverse().map((s, i) => (
              <div key={i} className={`ins-hist-row ${s.reachable ? "" : "fail"}`}>
                <span className="ins-hist-dot" />
                <span className="ins-hist-at">{s.at.slice(11, 19)}</span>
                <span>{s.reachable ? "정상" : (s.fail_kind ? KIND[s.fail_kind] : "실패")}</span>
                <span className="ins-hist-ms">{s.latency_ms}ms</span>
              </div>
            ))}
          </div>
        ) : <div className="muted" style={{ fontSize: "var(--fs-sm)", padding: "8px 0" }}>이력이 아직 없습니다.</div>
      )}
    </SlidePanel>
  );
}
