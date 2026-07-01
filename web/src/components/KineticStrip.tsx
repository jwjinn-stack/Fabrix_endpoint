// IMP-72 — 'Kinetic 알림' 스트립 — 이상 감지 → 온톨로지 객체 위 즉시 Action.
//
// 대시보드/COP/ObjectView 상단에 얹는 능동 브리지. 감지(alertrules·first-anomaly·GPU throttle·node 포화)를
// 온톨로지 객체에 귀속시킨 KineticAlert(파생 레이어, api/detection.ts)를 4-슬롯 카드로 낸다:
//   [1 영향 객체 chip] · [2 근거(어느 신호가 언제 임계 초과 + objectId/시각 인용)] ·
//   [3 추정 원인 경로(Probable Cause + confidence)] · [4 추천 Action(3단 조치 사다리)]
// (Grafana Assistant findings→evidence→recommended next steps 순서, IBM Probable Root Cause 명명.)
//
// 3단 조치 사다리(recommendation = 1급 상태): (a) 조사 열기(/agent objectId+가설 pre-fill) ·
//   (b) ack/assign(COP 진입점 지정) · (c) 추천 Action 실행(ActionForm confirm). observe 프로파일은
//   실행 rung 만 비활성(사유 표시), 조사/ack 는 활성(읽기전용에서도 가치).
//
// **안전(two-tier 게이팅)**: 실행은 오직 <ActionForm>(IMP-59) + evaluateSubmission(capability+status)
//   confirm 게이팅으로만. 이 컴포넌트에 자동 mutation 경로 없음(추천은 "제안"일 뿐). 고정 카피 "상관≠인과, 근거로 확인".
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchKineticAlerts } from "../api/client";
import type { KineticAlert, DetectionSignal, ObjectStatus } from "../api/types";
import { typeVisual } from "../api/objectTypeVisual";
import { getActionSpec } from "../actions/registry";
import { useCap } from "../capabilities";
import Badge, { type BadgeTone } from "./Badge";
import ActionForm from "./ActionForm";
import type { NavFn } from "../router";

const STATUS_TONE: Record<ObjectStatus, BadgeTone> = { ok: "green", warn: "amber", crit: "red", unknown: "neutral" };
const STATUS_LABEL: Record<ObjectStatus, string> = { ok: "정상", warn: "주의", crit: "위험", unknown: "미측정" };
const CONF_LABEL: Record<KineticAlert["confidence"], string> = { high: "높음", med: "보통" };
const CONF_TONE: Record<KineticAlert["confidence"], BadgeTone> = { high: "red", med: "amber" };

// 감지 신호 계열 → 근거 슬롯 접두 라벨(사람용).
const SIGNAL_KIND_LABEL: Record<DetectionSignal["kind"], string> = {
  alertrule: "알림 룰",
  throttle: "하드웨어",
  idleAlloc: "유휴 갭",
  saturation: "포화",
  firstAnomaly: "시간축",
};

export interface KineticStripProps {
  onNavigate?: NavFn;               // 조사/ack rung — /agent·/investigate 딥링크(없으면 rung 숨김)
  onOpenObject?: (id: string) => void; // 영향 객체 chip 클릭 → ObjectView(있으면)
  intervalMs?: number;              // 자체 폴링 주기(기본 15s). 0 이면 폴링 없음.
}

// Kinetic 알림 스트립 — 페이지 상단에 얹는다. 알림이 0건이면 렌더하지 않는다(관제 노이즈 억제).
export default function KineticStrip({ onNavigate, onOpenObject, intervalMs = 15_000 }: KineticStripProps) {
  const [alerts, setAlerts] = useState<KineticAlert[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetchKineticAlerts(signal);
      setAlerts(r.alerts);
      setLoaded(true);
    } catch {
      // 감지 파생은 관제 보조 표면 — 실패해도 페이지를 죽이지 않는다(조용히 빈 스트립).
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    if (intervalMs > 0) {
      timer.current = window.setInterval(() => load(), intervalMs);
    }
    return () => {
      ctrl.abort();
      if (timer.current != null) window.clearInterval(timer.current);
    };
  }, [load, intervalMs]);

  // 알림 0건 → 미렌더(스트립 자체가 사라짐 — 관제 화면 잡음 최소화). 로드 전에도 미렌더.
  if (!loaded || alerts.length === 0) return null;

  return (
    <section className="kinetic-strip" aria-label="Kinetic 알림">
      <div className="kinetic-strip-head">
        <span className="kinetic-strip-title">
          <span className="kinetic-strip-glyph" aria-hidden="true">◎</span>
          Kinetic 알림
          <span className="kinetic-strip-count">{alerts.length}</span>
        </span>
        {/* 고정 마이크로카피 — 상관을 인과로 과장하지 않음(IBM Probable Root Cause). */}
        <span className="kinetic-strip-caveat" role="note">추정 원인(Probable Cause) · 상관≠인과, 근거로 확인</span>
        <div className="spacer" />
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          {collapsed ? "펼치기" : "접기"}
        </button>
      </div>
      {!collapsed && (
        <ul className="kinetic-cards">
          {alerts.map((a) => (
            <KineticCard
              key={a.objectId}
              alert={a}
              onNavigate={onNavigate}
              onOpenObject={onOpenObject}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// 4-슬롯 카드 — 영향 객체 / 근거 / 추정 원인 경로 / 추천 Action(3단 사다리).
function KineticCard({
  alert,
  onNavigate,
  onOpenObject,
}: {
  alert: KineticAlert;
  onNavigate?: NavFn;
  onOpenObject?: (id: string) => void;
}) {
  const { can } = useCap();
  const [showAction, setShowAction] = useState(false);
  const vis = typeVisual(alert.objectType);
  const spec = alert.suggestedAction ? getActionSpec(alert.suggestedAction.actionType) : undefined;
  // observe 게이팅 — 추천 Action 의 requiredCap 이 없으면 실행 rung 만 비활성(조사/ack 는 활성).
  // (실제 실행 거부는 ActionForm 의 evaluateSubmission 이 이중으로 담당 — 여기선 rung 어포던스만.)
  const canExecute = spec ? (!spec.requiredCap || can(spec.requiredCap)) : false;

  return (
    <li className={`kinetic-card kinetic-${alert.status}`}>
      {/* ── [슬롯 1] 영향 객체 chip ── */}
      <div className="kinetic-slot kinetic-slot-object">
        <span className="kinetic-slot-h">영향 객체</span>
        <button
          type="button"
          className={`otype-chip ${vis.className} kinetic-object-chip`}
          style={{ ["--otype-color" as string]: vis.color, ["--otype-tint" as string]: vis.tint }}
          onClick={() => onOpenObject?.(alert.objectId)}
          disabled={!onOpenObject}
          title={`${vis.label} · ${alert.objectId}`}
        >
          <span className="otype-chip-glyph" aria-hidden="true">{vis.glyph}</span>
          {alert.title}
        </button>
        <div className="kinetic-object-meta">
          <Badge tone={STATUS_TONE[alert.status]} dot>{STATUS_LABEL[alert.status]}</Badge>
          {alert.breachCount > 1 && (
            <span className="kinetic-breach" title="지속 임계초과(누적)">지속 ×{alert.breachCount}</span>
          )}
        </div>
      </div>

      {/* ── [슬롯 2] 근거(evidence) — 어느 신호가 언제 임계 초과 + objectId/시각 인용 ── */}
      <div className="kinetic-slot kinetic-slot-evidence">
        <span className="kinetic-slot-h">근거</span>
        <ul className="kinetic-signals">
          {alert.signals.map((s, i) => (
            <li className="kinetic-signal" key={`${s.kind}-${i}`}>
              <span className={`kinetic-sig-kind kind-${s.kind}`}>{SIGNAL_KIND_LABEL[s.kind]}</span>
              <span className="kinetic-sig-body">
                <span className="kinetic-sig-label">{s.label}</span>
                <span className="kinetic-sig-detail">{s.detail}</span>
                <span className="kinetic-sig-cite">
                  <time className="kinetic-sig-when">{s.observedAt}</time>
                  <span className="kinetic-sig-sep" aria-hidden="true">·</span>
                  <code className="kinetic-sig-src" title="근거 인용(objectId/룰)">{s.citation}</code>
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── [슬롯 3] 추정 원인 경로(Probable Cause) + confidence ── */}
      <div className="kinetic-slot kinetic-slot-cause">
        <span className="kinetic-slot-h">
          추정 원인
          <Badge tone={CONF_TONE[alert.confidence]}>신뢰도 {CONF_LABEL[alert.confidence]}</Badge>
        </span>
        <p className="kinetic-cause">{alert.probableCause}</p>
      </div>

      {/* ── [슬롯 4] 추천 Action — 3단 조치 사다리 ── */}
      <div className="kinetic-slot kinetic-slot-action">
        <span className="kinetic-slot-h">추천 조치</span>
        <div className="kinetic-ladder" role="group" aria-label="조치 사다리">
          {/* (a) 조사 열기 — /agent 로 objectId+가설 pre-fill(항상 활성). */}
          {onNavigate && (
            <button
              type="button"
              className="btn-ghost btn-sm kinetic-rung"
              onClick={() => onNavigate("agent", { entity: alert.objectId, intent: alert.hypothesis })}
              title="AI Agent 로 이 객체 + 가설을 미리 채워 조사 시작"
            >
              <span className="kinetic-rung-n" aria-hidden="true">1</span>조사 열기
            </button>
          )}
          {/* (b) ack/assign — COP(근본원인 추적)로 진입점 지정(항상 활성). IMP-38 인시던트 연결 지점. */}
          {onNavigate && (
            <button
              type="button"
              className="btn-ghost btn-sm kinetic-rung"
              onClick={() => onNavigate("investigate", { entity: alert.objectId })}
              title="근본원인 추적(COP)에서 이 객체를 진입점으로 확인/배정"
            >
              <span className="kinetic-rung-n" aria-hidden="true">2</span>확인·배정
            </button>
          )}
          {/* (c) 추천 Action 실행 — ActionForm confirm(capability+status 게이팅). observe=비활성+사유. */}
          {spec && alert.suggestedAction && (
            !canExecute ? (
              <span className="kinetic-rung-denied" role="note" title="읽기 전용 프로파일 — 실행 권한 없음">
                <span className="kinetic-rung-n" aria-hidden="true">3</span>
                {spec.label} (권한 없음)
              </span>
            ) : !showAction ? (
              <button
                type="button"
                className="btn-primary btn-sm kinetic-rung kinetic-rung-exec"
                onClick={() => setShowAction(true)}
              >
                <span className="kinetic-rung-n" aria-hidden="true">3</span>
                {spec.label} — 확인 후 실행 →
              </button>
            ) : null
          )}
        </div>

        {/* 실행 rung 펼침 — ActionForm(confirm 게이팅). 변경은 반드시 여기서 직접 실행(자동 아님). */}
        {spec && alert.suggestedAction && canExecute && showAction && (
          <div className="kinetic-action-form">
            <p className="kinetic-action-note" role="note">
              이 조치는 <b>변경 작업</b>입니다 — 아래에서 확인(confirm) 후 <b>직접 실행</b>해야 반영됩니다.
            </p>
            <ActionForm
              actionType={alert.suggestedAction.actionType}
              target={alert.suggestedAction.target}
              targetStatus={alert.status}
            />
          </div>
        )}
      </div>
    </li>
  );
}
