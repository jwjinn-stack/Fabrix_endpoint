// EvidencePanel (IMP-93) — 객체·인시던트 상시 근거(Evidence) 패널.
//
// "채팅 없이 접지": 시니어가 아닌 온콜이 객체/인시던트를 열자마자 "무엇(신호)→왜(추정원인)→영향" 을
// 바로 읽게 한다. AI 채팅 ReAct 루프에 원인 이해를 의존하지 않는 PRIMARY 경로(Datadog Watchdog
// inline correlation / IBM Instana Probable Root Cause 의 evidence-backed per-entity 서술과 동형).
//
// - 단일 소스: IMP-99 seam buildIncidentEvidence(objectId, snapshot) 하나만 소비한다(재파생·새 데이터 모델 금지).
//   스냅샷의 k8s 는 buildK8sSnapshot(objects, links)(mock-first 데이터 계약)로 조립 — 상관은 objectId 결정적.
// - progressive disclosure(NNG): 상위 1–2 고신호 줄만 기본, "전체 이벤트 N건" expander 로 나머지.
// - confidence 규약 재사용: seam 이 준 값 그대로(상관 ≥2=high) — 재계산 없음.
// - 환각 금지: 상관 근거 0 → seam 의 emptyReason("수집된 이벤트 없음") verbatim.
// - interactive citation: 온톨로지 objectId(type:id) 형태 인용은 클릭 → onCite(navigate/highlight).
//   pod/node/deployment ref 는 온톨로지 객체가 아니므로 텍스트 인용(escape 렌더, 비클릭).
// - 보안: 모든 seam 텍스트는 React 기본 escape 텍스트. dangerouslySetInnerHTML 없음.
import { useMemo, useState } from "react";
import type { OntologyLink, OntologyObject } from "../api/types";
import { buildIncidentEvidence, type EvidenceLine } from "../api/incidentEvidence";
import { buildK8sSnapshot } from "../api/k8sSnapshot";

// 기본 노출 줄 수(상위 고신호) — 나머지는 expander. NNG progressive disclosure.
const DEFAULT_VISIBLE = 2;

// 온톨로지 objectId 형태(type:id)인지 — 인용 클릭 대상 판별. pod/node/deployment ref 는 제외.
//  detection citation 은 "rule_a1b2 · endpoint:e1" 처럼 접미로 objectId 를 담기도 하므로 토큰 분해로 탐색.
function objectIdFromRef(ref: string): string | null {
  // 공백/·(middle dot) 로 나눠 type:id 토큰을 찾는다. pod/… node/… deployment/… 는 '/' 라 매칭 안 됨.
  const tokens = ref.split(/[\s·]+/).filter(Boolean);
  for (const t of tokens) {
    // type:id — 콜론 하나, '/' 없음(k8s ref 배제).
    if (/^[A-Za-z]+:[^\s/]+$/.test(t)) return t;
  }
  return null;
}

// confidence 배지 텍스트(색-only 금지 — 텍스트 병기). high=상관 근거 충분, med=보강 필요.
const CONF_LABEL: Record<EvidenceLine["confidence"], string> = { high: "높음", med: "보통" };

export interface EvidencePanelProps {
  objectId: string;
  objects: OntologyObject[];
  links: OntologyLink[];
  // 인용(온톨로지 objectId) 클릭 → 참조 객체로 navigate/highlight. ObjectView=traverse, COP=view.open.
  onCite?: (objectId: string) => void;
  // COP hop 카드용 조밀 변형(헤더 h4 대신 인라인 라벨, 여백 축소).
  dense?: boolean;
}

export default function EvidencePanel({ objectId, objects, links, onCite, dense = false }: EvidencePanelProps) {
  const [expanded, setExpanded] = useState(false);

  // IMP-99 seam 소비 — 순수·결정적. k8s 는 mock-first 데이터 계약(buildK8sSnapshot)에서 파생(신규 fetch 없음).
  const evidence = useMemo(() => {
    const k8s = buildK8sSnapshot(objects, links);
    return buildIncidentEvidence(objectId, { objects, links, k8s });
  }, [objectId, objects, links]);

  // 조립할 근거가 아무것도 없으면(있지도 않은 객체 등) 렌더 자체를 접는다 — 단, empty(수집된 이벤트 없음)는
  // 명시적으로 보여준다(환각 금지 폴백은 정보이지, 노이즈가 아니다).
  if (!evidence.found && !objectId) return null;

  const lines = evidence.lines;
  const visible = expanded ? lines : lines.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = lines.length - visible.length;

  const Header = dense ? "span" : "h4";

  return (
    <section className={`ev-panel ${dense ? "ev-dense" : "ov-section"}`} aria-label="근거">
      <div className="ev-head">
        <Header className={dense ? "ev-h-dense" : "ov-h"}>근거</Header>
        {!evidence.empty && (
          <span className={`ev-conf ev-conf-${evidence.confidence}`} title="상관 신호 ≥2 = 높음(detection 규약)">
            신뢰도 {CONF_LABEL[evidence.confidence]}
          </span>
        )}
      </div>

      {/* 추정 근본원인 요약(probableCauseText 재사용). 상관≠인과 hedging 은 seam 문구에 이미 포함. */}
      {!evidence.empty && <p className="ev-summary">{evidence.rootCauseSummary}</p>}

      {/* 환각 금지 — 상관 근거 0 이면 seam 의 emptyReason verbatim. 지어내지 않는다. */}
      {evidence.empty ? (
        <p className="ev-empty" role="status">{evidence.emptyReason ?? "수집된 이벤트 없음"}</p>
      ) : (
        <>
          <ol className="ev-lines">
            {visible.map((l) => (
              <li key={l.id} className={`ev-line ev-line-${l.kind}`}>
                {/* 신호 → 추정원인 → 영향 (한 줄 인과 체인). 각 조각은 escape 텍스트. */}
                <div className="ev-signal">
                  <span className="ev-what">{l.signal.what}</span>
                  <span className="ev-when" aria-label="관측 시각">{l.signal.when}</span>
                  <Citation ref={l.signal.sourceRef} onCite={onCite} />
                </div>
                <div className="ev-chain">
                  <span className="ev-arrow" aria-hidden="true">→</span>
                  <span className="ev-cause">{l.probableCause}</span>
                  <span className="ev-arrow" aria-hidden="true">→</span>
                  <span className="ev-impact">{l.impact}</span>
                </div>
              </li>
            ))}
          </ol>

          {/* progressive disclosure — 상위 N 개 외 나머지는 expander. ≤N 줄이면 미표시. */}
          {lines.length > DEFAULT_VISIBLE && (
            <button
              type="button"
              className="ev-expander"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "접기" : `전체 이벤트 ${lines.length}건 보기`}
              {!expanded && hiddenCount > 0 && <span className="ev-expander-more"> (+{hiddenCount})</span>}
            </button>
          )}
        </>
      )}
    </section>
  );
}

// 인용 — 온톨로지 objectId 형태면 클릭 가능 버튼(navigate/highlight), 아니면 텍스트(escape).
function Citation({ ref, onCite }: { ref: string; onCite?: (objectId: string) => void }) {
  const objId = objectIdFromRef(ref);
  if (objId && onCite) {
    return (
      <button
        type="button"
        className="ev-cite ev-cite-link"
        onClick={() => onCite(objId)}
        title={`${objId} 로 이동`}
      >
        {ref}
      </button>
    );
  }
  return <span className="ev-cite" title="근거 출처">{ref}</span>;
}
