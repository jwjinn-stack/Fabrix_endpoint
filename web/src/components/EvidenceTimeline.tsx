// EvidenceTimeline (IMP-100) — 근거를 세로 evidence timeline 시각언어로 렌더하는 단일 재사용 컴포넌트.
//
// "무엇이 먼저 무너졌나" 를 한눈에: first-anomaly(시간축 앵커)부터 현재까지 세로 rail 위에 신호 마커를
// severity 색·경과시간으로 배치하고, "추정 원인(probable cause)" 노드를 강조 + 영향으로 잇는 연결선을 그린다
// (Datadog Watchdog / incident.io / Grafana OnCall evidence timeline 동형).
//
// - 재파생 금지: 마커 배열은 IMP-99 seam(EvidenceLine[]) / IMP-72 KineticAlert.signals(DetectionSignal[]) 이
//   이미 정렬한 순서 그대로 받는다. 이 컴포넌트는 정렬/임계 계산을 하지 않는다(형태만 그린다).
// - IMP-97 first-anomaly 타임라인과 중복 회피: 근거 시간축은 이 단일 컴포넌트 하나로 통일한다.
// - severity 색은 텍스트 배지 병기(색-only 금지, WCAG). Backend.AI 라이트 + 스틸블루 토큰(NO neon).
// - IMP-93 인용 보존: citation.objectId 가 있고 onCite 제공 시 클릭 버튼(ev-cite-link), 아니면 텍스트.
// - motion-reduce: 신규 무한 애니메이션 도입 없음(전역 @media prefers-reduced-motion 규칙이 transition 을 죽임).
// - 보안: 모든 텍스트는 React 기본 escape. dangerouslySetInnerHTML / 외부 리소스 없음.
import type { DetectionSignal } from "../api/types";
import type { EvidenceLine } from "../api/incidentEvidence";

// 근거 계열(kind) → severity(마커 색). 결정적 매핑 — 임계 재계산 아님(표시 톤 결정만).
//   crit: 임계 초과 감지/치명 K8s event, warn: 자원/큐/파드/배포 정황, info: 시간축 앵커·유휴 갭.
type Severity = "crit" | "warn" | "info";
const KIND_SEVERITY: Record<string, Severity> = {
  alertrule: "crit",
  k8sEvent: "crit",
  throttle: "warn",
  saturation: "warn",
  backpressure: "warn",
  k8sPod: "warn",
  k8sDeployment: "warn",
  idleAlloc: "info",
  firstAnomaly: "info",
};
function severityOf(kind: string): Severity {
  return KIND_SEVERITY[kind] ?? "warn";
}

// 근거 계열 → 사람용 접두 라벨(마커 계열 배지). KineticStrip 의 SIGNAL_KIND_LABEL 과 동형 + K8s 계열 확장.
const KIND_LABEL: Record<string, string> = {
  alertrule: "알림 룰",
  throttle: "하드웨어",
  idleAlloc: "유휴 갭",
  saturation: "포화",
  backpressure: "큐 적체",
  firstAnomaly: "시간축",
  k8sEvent: "K8s 이벤트",
  k8sPod: "파드",
  k8sDeployment: "배포",
};
function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

// severity → 사람용 텍스트(색-only 금지 병기).
const SEV_TEXT: Record<Severity, string> = { crit: "위험", warn: "주의", info: "정보" };

// 정규화된 타임라인 마커 — 데이터 소스(EvidenceLine/DetectionSignal) 무관. rail 위 한 점.
export interface TimelineMarker {
  id: string;
  kind: string;                                  // 근거 계열(색/라벨 판별)
  severity: Severity;                            // 마커 색(텍스트 병기)
  when: string;                                  // 경과시간 라벨("12분 전") — seam 값 그대로(Date.now 미의존)
  title: string;                                 // 신호 서술(what/label)
  detail?: string;                               // 신호 상세(값 서술) — 있으면 title 아래 부제로 렌더
  cause?: string;                                // 추정 원인(강조 노드) — 있으면 인과 연결선
  impact?: string;                               // 추정 영향(연결선 끝)
  citation?: { ref: string; objectId: string | null }; // IMP-93 인용(objectId면 클릭 가능)
  isAnchor?: boolean;                            // first-anomaly = 시간축 앵커(rail 시작점 강조)
}

// 온톨로지 objectId 형태(type:id)인지 — 인용 클릭 대상 판별(EvidencePanel 과 동일 규약).
//   pod/… node/… deployment/… 는 '/' 라 매칭 안 됨(비클릭 텍스트).
function objectIdFromRef(ref: string): string | null {
  const tokens = ref.split(/[\s·]+/).filter(Boolean);
  for (const t of tokens) {
    if (/^[A-Za-z]+:[^\s/]+$/.test(t)) return t;
  }
  return null;
}

// ── 어댑터(형태 변환만 — 재파생 아님) ──────────────────────────────────────
// IMP-99 seam EvidenceLine[] → 마커. 순서·severity 는 seam 정렬/kind 그대로 계승.
export function markersFromEvidence(lines: EvidenceLine[]): TimelineMarker[] {
  return lines.map((l) => ({
    id: l.id,
    kind: l.kind,
    severity: severityOf(l.kind),
    when: l.signal.when,
    title: l.signal.what,
    cause: l.probableCause,
    impact: l.impact,
    citation: { ref: l.signal.sourceRef, objectId: objectIdFromRef(l.signal.sourceRef) },
    isAnchor: l.kind === "firstAnomaly",
  }));
}

// IMP-72 KineticAlert.signals(DetectionSignal[]) → 마커. cause/impact 는 슬롯3(probableCause)에 이미 있어 생략(중복 회피).
export function markersFromSignals(signals: DetectionSignal[]): TimelineMarker[] {
  return signals.map((s, i) => ({
    id: `${s.kind}-${i}`,
    kind: s.kind,
    severity: severityOf(s.kind),
    when: s.observedAt,
    title: s.label,
    detail: s.detail,
    citation: { ref: s.citation, objectId: objectIdFromRef(s.citation) },
    isAnchor: s.kind === "firstAnomaly",
  }));
}

export interface EvidenceTimelineProps {
  markers: TimelineMarker[];
  // 인용(온톨로지 objectId) 클릭 → navigate/highlight. 미제공이면 인용은 비클릭 텍스트.
  onCite?: (objectId: string) => void;
  // compact 변형(KineticStrip 슬롯2 등 조밀 배치) — 여백 축소·cause/impact 은행 어차피 없음.
  compact?: boolean;
}

// 세로 evidence timeline — rail + 마커. 마커 순서는 입력 그대로(first-anomaly→now, 재정렬 없음).
export default function EvidenceTimeline({ markers, onCite, compact = false }: EvidenceTimelineProps) {
  if (markers.length === 0) return null;
  return (
    <ol className={`ev-tl ${compact ? "ev-tl-compact" : ""}`} aria-label="근거 타임라인">
      {markers.map((m) => (
        <li
          key={m.id}
          className={`ev-tl-item ev-tl-sev-${m.severity} ${m.isAnchor ? "ev-tl-anchor" : ""} ${m.cause ? "ev-tl-has-cause" : ""}`}
        >
          {/* rail 마커 dot(severity 색) — 색-only 금지: severity 텍스트를 sr/배지로 병기. */}
          <span className="ev-tl-marker" aria-hidden="true" />
          <div className="ev-tl-body">
            <div className="ev-tl-head">
              <span className={`ev-tl-kind ev-tl-kind-${m.severity}`}>{kindLabel(m.kind)}</span>
              {/* severity 텍스트(색-only 금지 병기, 스크린리더에도 노출). */}
              <span className="ev-tl-sev-text">{SEV_TEXT[m.severity]}</span>
              <time className="ev-tl-when" aria-label="경과 시간">{m.when}</time>
              {m.isAnchor && <span className="ev-tl-anchor-tag">가장 이른 이상</span>}
            </div>
            <p className="ev-tl-title">{m.title}</p>
            {m.detail && <p className="ev-tl-detail">{m.detail}</p>}

            {/* 추정 원인(강조 노드) → 영향. cause 있으면 인과 연결선(ev-tl-connector)으로 잇는다. */}
            {m.cause && (
              <div className="ev-tl-cause">
                <span className="ev-tl-connector" aria-hidden="true" />
                <div className="ev-tl-cause-body">
                  <span className="ev-tl-cause-label">추정 원인</span>
                  <span className="ev-tl-cause-text">{m.cause}</span>
                  {m.impact && (
                    <span className="ev-tl-impact">
                      <span className="ev-tl-arrow" aria-hidden="true">→</span>
                      {m.impact}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* IMP-93 인용 보존 — objectId 형태 + onCite 제공 시 클릭 버튼, 아니면 텍스트. */}
            {m.citation && <Citation citation={m.citation} onCite={onCite} />}
          </div>
        </li>
      ))}
    </ol>
  );
}

// 인용 — 온톨로지 objectId 형태면 클릭 가능 버튼(navigate/highlight), 아니면 텍스트(escape). IMP-93 규약 재사용.
function Citation({
  citation,
  onCite,
}: {
  citation: { ref: string; objectId: string | null };
  onCite?: (objectId: string) => void;
}) {
  if (citation.objectId && onCite) {
    const objId = citation.objectId;
    return (
      <button
        type="button"
        className="ev-cite ev-cite-link ev-tl-cite"
        onClick={() => onCite(objId)}
        title={`${objId} 로 이동`}
      >
        {citation.ref}
      </button>
    );
  }
  return <span className="ev-cite ev-tl-cite" title="근거 출처">{citation.ref}</span>;
}
