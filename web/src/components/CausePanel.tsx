// CausePanel (IMP-95) — 온-객체 AI 원인 설명(무엇이/왜/영향/다음 조치) 자동 생성 패널.
//
// Datadog Bits AI SRE / Grafana Assistant / Dynatrace Davis 는 인시던트를 열면 별도 질문 없이
// '무엇이·왜·영향·다음 조치'를 근거 인용과 함께 요약한다. 이 패널은 AI Agent 화면으로 가서 질문하는
// 대신, 객체를 연 자리에서 그 구조화 서술을 만든다(채팅 비의존 PRIMARY 경로).
//
// - 단일 소스: IMP-99 seam(buildIncidentEvidence = get_incident_context) → IMP-95 seam(buildCauseNarrative).
//   재파생·새 데이터 모델 없음. k8s 는 buildK8sSnapshot(EvidencePanel 과 동일 mock-first 계약).
// - **OPT-IN(refinement 5)**: 기본은 '원인 설명 생성' 버튼만(매 mount 비용/지연·모델 의존 회피, non-blocking).
//   '열면 자동 생성' 토글(세션 로컬, 기본 OFF)을 켜면 mount 시 자동 트리거.
// - **staged 렌더(refinement 4)**: 생성 → hypothesis→evidence→conclusion 단계 진행. 단일 blocking spinner 아님 —
//   도착한 섹션은 즉시 렌더하고 다음 단계를 뒤이어 드러낸다. prefers-reduced-motion 이면 지연 없이 즉시 완료.
// - **HARD grounding(refinement 3)**: 인용 없는 claim 은 seam 단계에서 이미 드롭됨. 여기선 인용을 클릭형으로 —
//   objectId(type:id) 형태 + onCite 제공 시 버튼(navigate/highlight), 아니면 텍스트(escape).
// - **폴백 badge(refinement 6)**: mode==='rule-based'(mock/미연결)면 무채색 'rule-based (no model)' badge
//   (IMP-82 ModelStatusChip 의 mock state 와 동일 정직 톤). 실 모델(model)이면 표기 없음.
// - **ZERO auto-mutation(refinement 7)**: 이 패널엔 어떤 mutation 경로도 없다. '다음 조치' 는 서술(제안)일 뿐 —
//   실제 실행은 ObjectView 의 Actions 섹션(ActionForm confirm)으로만.
// - 보안: 모든 텍스트 React 기본 escape. dangerouslySetInnerHTML/외부 리소스 없음.
import { useEffect, useMemo, useRef, useState } from "react";
import type { OntologyLink, OntologyObject } from "../api/types";
import { buildIncidentEvidence } from "../api/incidentEvidence";
import { buildK8sSnapshot } from "../api/k8sSnapshot";
import { buildCauseNarrative, type NarrativeCitation, type NarrativeSection } from "../api/causeNarrative";
import { isMockMode } from "../api/modelConnection";
import Badge from "./Badge";

// staged 렌더 단계 — hypothesis(가설) → evidence(근거) → conclusion(결론). 결정적 순서.
type Stage = "idle" | "hypothesis" | "evidence" | "conclusion";
const STAGE_ORDER: Stage[] = ["hypothesis", "evidence", "conclusion"];
const STAGE_LABEL: Record<Exclude<Stage, "idle">, string> = {
  hypothesis: "가설 세우는 중…",
  evidence: "근거 수집 중…",
  conclusion: "결론 정리 중…",
};
// 단계 사이 지연(ms) — staged 체감용(단일 spinner 방지). 테스트/reduced-motion 은 0.
const STAGE_DELAY_MS = 260;

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export interface CausePanelProps {
  objectId: string;
  objects: OntologyObject[];
  links: OntologyLink[];
  // 인용(온톨로지 objectId) 클릭 → 참조 객체로 navigate/highlight(ObjectView=traverse).
  onCite?: (objectId: string) => void;
}

export default function CausePanel({ objectId, objects, links, onCite }: CausePanelProps) {
  // OPT-IN — 생성 여부. 기본 false(버튼만). '열면 자동 생성' 토글(세션 로컬, 기본 OFF).
  const [generated, setGenerated] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  // staged 렌더 진행 단계.
  const [stage, setStage] = useState<Stage>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const mock = isMockMode();

  // IMP-95 seam — IMP-99 seam(get_incident_context) 결과를 4 섹션 서술로. 순수·결정적(생성 여부와 무관하게 계산 가능).
  const narrative = useMemo(() => {
    const k8s = buildK8sSnapshot(objects, links);
    const evidence = buildIncidentEvidence(objectId, { objects, links, k8s });
    return buildCauseNarrative(evidence, { mock });
  }, [objectId, objects, links, mock]);

  // staged 진행 — 생성 시작 시 단계를 순차로 밀어올린다(도착한 섹션 즉시 렌더 → 다음 단계 뒤이어).
  const startStaged = () => {
    // 이전 타이머 정리(재생성/head 변경 대비).
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setGenerated(true);
    if (prefersReducedMotion()) { setStage("conclusion"); return; } // 모션 최소 — 즉시 완료.
    setStage("hypothesis");
    STAGE_ORDER.forEach((s, i) => {
      if (i === 0) return; // hypothesis 는 위에서 즉시.
      const t = setTimeout(() => setStage(s), STAGE_DELAY_MS * i);
      timers.current.push(t);
    });
  };

  // '열면 자동 생성' ON 이고 아직 생성 전이면 mount/head 변경 시 자동 트리거(비침습). OFF 면 아무것도 안 함.
  useEffect(() => {
    if (autoOpen && !generated) startStaged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, objectId]);

  // head(objectId) 변경 시 생성 상태 리셋(객체별 컨텍스트). autoOpen 토글은 세션 유지.
  useEffect(() => {
    setGenerated(false);
    setStage("idle");
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, [objectId]);

  // 언마운트 시 타이머 정리.
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  // 단계별 노출 섹션 — hypothesis: 왜(가설) / evidence: +무엇이·영향 / conclusion: +다음 조치.
  const visibleKeys = useMemo<Set<NarrativeSection["key"]>>(() => {
    if (stage === "hypothesis") return new Set(["why"]);
    if (stage === "evidence") return new Set(["why", "what", "impact"]);
    if (stage === "conclusion") return new Set(["why", "what", "impact", "next"]);
    return new Set();
  }, [stage]);

  const staging = generated && stage !== "conclusion" && !prefersReducedMotion();

  return (
    <section className="ov-section cause-panel" aria-label="AI 원인 설명">
      <div className="cause-head">
        <h4 className="ov-h">AI 원인 설명</h4>
        {/* 폴백 badge — mock/미연결이면 룰기반 명시(정직). 실 모델이면 미표기. */}
        {narrative.mode === "rule-based" && (
          <Badge tone="neutral" title="mock 모드 — 실제 추론 모델에 연결되지 않아 룰기반 템플릿으로 생성했습니다. (VITE_MOCK=off 로 실 모델)">
            rule-based (no model)
          </Badge>
        )}
      </div>
      <p className="cause-sub muted">채팅 없이 '무엇이 · 왜 · 영향 · 다음 조치'를 근거 인용과 함께 정리합니다. 상관≠인과 — 근거로 확인하세요.</p>

      {/* OPT-IN — 기본은 생성 버튼만(매 mount 비용/모델 의존 회피). '열면 자동 생성' 토글은 세션 로컬. */}
      {!generated ? (
        <div className="cause-optin">
          <button type="button" className="btn-primary btn-sm cause-generate" onClick={startStaged}>
            원인 설명 생성
          </button>
          <label className="cause-auto-toggle">
            <input
              type="checkbox"
              checked={autoOpen}
              onChange={(e) => setAutoOpen(e.target.checked)}
            />
            객체를 열면 자동 생성
          </label>
        </div>
      ) : narrative.empty ? (
        // 환각 금지 — 근거 0 이면 seam 의 emptyReason verbatim(지어내지 않음).
        <p className="cause-empty" role="status">{narrative.emptyReason ?? "수집된 이벤트 없음"}</p>
      ) : (
        <>
          {/* staged 진행 표시 — 단일 blocking spinner 아님. 이미 도착한 섹션은 아래에서 즉시 렌더된다. */}
          {staging && (
            <p className="cause-stage" role="status" aria-live="polite">
              {STAGE_LABEL[stage as Exclude<Stage, "idle">]}
            </p>
          )}

          <div className="cause-sections">
            {narrative.sections.map((sec) => {
              if (!visibleKeys.has(sec.key)) return null;
              return (
                <div className={`cause-sec cause-sec-${sec.key}`} key={sec.key}>
                  <span className="cause-sec-title">{sec.title}</span>
                  {sec.claims.length === 0 ? (
                    <p className="cause-sec-empty muted">이 섹션에 인용 가능한 근거가 없습니다.</p>
                  ) : (
                    <ul className="cause-claims">
                      {sec.claims.map((c) => (
                        <li className="cause-claim" key={c.id}>
                          <span className="cause-claim-text">{c.text}</span>
                          <span className="cause-claim-cites">
                            {c.citations.map((cite, i) => (
                              <Cite key={`${c.id}-${i}`} citation={cite} onCite={onCite} />
                            ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {/* 결론 도달 시 정직 출처 표기 + read-only 고지(추천은 제안일 뿐 — 실행은 ActionForm confirm). */}
          {stage === "conclusion" && (
            <p className="cause-source muted" role="note">
              {narrative.source} · '다음 조치' 는 제안입니다 — 실제 변경은 아래 액션에서 확인 후 실행됩니다.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// 인용 — 온톨로지 objectId 형태 + onCite 제공 시 클릭 버튼(navigate/highlight), 아니면 텍스트(escape).
//   EvidenceTimeline / IMP-93 인용 규약과 동형.
function Cite({ citation, onCite }: { citation: NarrativeCitation; onCite?: (objectId: string) => void }) {
  if (citation.objectId && onCite) {
    const objId = citation.objectId;
    return (
      <button
        type="button"
        className="cause-cite cause-cite-link"
        onClick={() => onCite(objId)}
        title={`${objId} 로 이동`}
      >
        {citation.ref}
      </button>
    );
  }
  return <span className="cause-cite" title="근거 출처">{citation.ref}</span>;
}
