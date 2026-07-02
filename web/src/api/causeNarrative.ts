// IMP-95 — 온-객체 AI 원인 설명(무엇이/왜/영향/다음 조치) 조립 seam(순수·결정적·의존성 0).
//
// Datadog Bits AI SRE / Grafana Assistant / Dynatrace Davis 는 인시던트를 열면 별도 질문 없이
// '무엇이·왜·영향·다음 조치'를 근거 인용과 함께 자동 요약한다. 이 seam 은 그 구조화 서술을
// **IMP-99 seam(buildIncidentEvidence = get_incident_context)** 하나만 근거로 조립한다.
//
// - 단일 출처: 입력은 오직 IncidentEvidence(신호→추정원인→영향 + 인용 refs). 새 파생 규칙을 발명하지 않는다.
//   detection/investigate/K8s 상관은 이미 IMP-99 가 조립했고, 여기선 그것을 4 섹션 자연어로 재배치할 뿐.
// - **HARD grounding(핵심 안전장치)**: 인용(citation)이 하나도 없는 claim 은 여기서 **드롭**한다 →
//   지어낸 단정이 화면에 못 샌다(Datadog "citations to the exact points" 동형). empty evidence → claim 0.
// - 결정적: 동일 evidence + mock → 동일 출력. 시각 라벨(when)은 seam 값 그대로(Date.now 미의존).
// - 정직성(direction 8): mock/미연결이면 mode='rule-based' + source 에 'rule-based' 표기(모델 위장 금지).
//   실 Dynamo 연결(VITE_MOCK=off + 프로브 online)이면 mode='model' — transport 만 스왑, 이 계약은 고정.
// - read-only: '다음 조치' 는 **서술(제안)** 일 뿐 verb 실행이 아니다. 실제 mutation 은 오직 ActionForm confirm.

import type { EvidenceLine, IncidentEvidence } from "./incidentEvidence";

// 인용 한 개 — 근거 ref + (온톨로지 objectId면) 클릭 대상. EvidenceTimeline objectIdFromRef 규약과 동형.
export interface NarrativeCitation {
  ref: string;              // 화면에 표기할 근거 문자열(objectId · pod/<name> · deployment/<name> 등)
  objectId: string | null;  // 온톨로지 objectId(type:id)면 클릭 가능, 아니면 null(텍스트)
}

// 서술 주장 한 줄 — 반드시 1개 이상의 인용을 갖는다(HARD grounding — 인용 0 은 seam 이 드롭).
export interface NarrativeClaim {
  id: string;
  text: string;                    // 사람용 서술(escape 렌더 — "추정" hedging 은 근거 문구에 이미 포함)
  citations: NarrativeCitation[];  // 근거 인용(비면 이 claim 은 애초에 생성되지 않음)
}

export type NarrativeSectionKey = "what" | "why" | "impact" | "next";

export interface NarrativeSection {
  key: NarrativeSectionKey;
  title: string;
  claims: NarrativeClaim[];
}

// 생성 모드 — 실 모델(Dynamo online) vs 룰기반 템플릿(mock/미연결). IMP-82 ConnState 와 정합.
export type NarrativeMode = "model" | "rule-based";

export interface CauseNarrative {
  objectId: string;
  found: boolean;
  title?: string;
  sections: NarrativeSection[];   // 항상 4개(what/why/impact/next) — 근거 없으면 각 claims=[].
  mode: NarrativeMode;
  source: string;                 // 정직 표기("AI 원인 설명 (mock · rule-based)" 등)
  empty: boolean;                 // 상관 근거 0 → 지어내지 않음(seam.empty 계승)
  emptyReason?: string;
  droppedCount: number;           // 인용 없어 드롭한 claim 수(HARD grounding 회귀 가드용)
}

// 4 섹션 제목(고정 카피).
const SECTION_TITLE: Record<NarrativeSectionKey, string> = {
  what: "무엇이",
  why: "왜 (추정 근본원인)",
  impact: "영향",
  next: "다음 조치",
};

// EvidenceLine → 인용 배열. sourceRefs(objectId/podRef 등)를 그대로 계승 — 온톨로지 objectId면 클릭 가능.
//   objectId 판별은 EvidenceTimeline objectIdFromRef 와 동일 규약(type:id, '/' 포함이면 비클릭).
function citationsFromLine(line: EvidenceLine): NarrativeCitation[] {
  const seen = new Set<string>();
  const out: NarrativeCitation[] = [];
  for (const ref of line.sourceRefs) {
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    out.push({ ref, objectId: /^[A-Za-z]+:[^\s/]+$/.test(ref) ? ref : null });
  }
  return out;
}

// 신호 계열(kind) → '다음 조치' 제안 문구(정적 runbook — 모델이 지어내지 않는다. 제안일 뿐 실행 아님).
//   ActionForm confirm 이 실제 실행을 게이팅하므로 여기선 "무엇을 확인/검토할지"만 서술한다.
const NEXT_STEP: Record<string, string> = {
  k8sEvent: "관련 K8s 이벤트의 reason 을 확인하고 파드 리밋/이미지/설정을 점검하세요(제안).",
  k8sPod: "재시작·OOM 파드의 리소스 리밋과 최근 배포 이력을 확인하세요(제안).",
  k8sDeployment: "rollout 이 정체된 배포의 레플리카 기동 실패 원인을 확인하세요(제안).",
  alertrule: "임계를 초과한 알림 룰의 지연/오류 급증 구간을 트레이스로 확인하세요(제안).",
  throttle: "GPU 열·전력 제약(throttle)이면 냉각·배치를 점검하세요(제안).",
  saturation: "자원 포화 대상의 스케줄·용량을 확인하고 리밸런싱을 검토하세요(제안).",
  backpressure: "유입>수용력이면 concurrency cap·레플리카 상향을 검토하세요(제안).",
  idleAlloc: "유휴 할당 GPU 를 회수·재배치해 용량을 확보하는 방안을 검토하세요(제안).",
  firstAnomaly: "가장 이른 이상 시각을 기준으로 상류/하류 홉 전파를 확인하세요(제안).",
};
function nextStepFor(kind: string): string {
  return NEXT_STEP[kind] ?? "관계 그래프를 따라 상류/하류 홉의 이상 전파를 확인하세요(제안).";
}

// buildCauseNarrative — IncidentEvidence(=get_incident_context 결과) → 4 섹션 자연어 서술.
//   opts.mock: mock/미연결이면 true → mode='rule-based'(정직). 실 Dynamo online 이면 false → 'model'.
//   opts.maxPerSection: 섹션당 최대 claim 수(progressive disclosure — 기본 3, 상위 신호 우선).
export function buildCauseNarrative(
  evidence: IncidentEvidence,
  opts: { mock: boolean; maxPerSection?: number },
): CauseNarrative {
  const mock = opts.mock;
  const mode: NarrativeMode = mock ? "rule-based" : "model";
  const source = mock
    ? "AI 원인 설명 (mock · rule-based, no model)"
    : "AI 원인 설명 (local model)";
  const cap = opts.maxPerSection ?? 3;

  // 빈 섹션 4개(항상 4 섹션 반환 — 근거 없어도 shape 고정).
  const empties = (): NarrativeSection[] =>
    (["what", "why", "impact", "next"] as NarrativeSectionKey[]).map((key) => ({
      key,
      title: SECTION_TITLE[key],
      claims: [],
    }));

  // 미지 객체/근거 0 — 지어내지 않는다(환각 금지). seam 의 empty/emptyReason 계승.
  if (!evidence.found || evidence.empty) {
    return {
      objectId: evidence.objectId,
      found: evidence.found,
      title: evidence.title,
      sections: empties(),
      mode,
      source,
      empty: true,
      emptyReason: evidence.emptyReason ?? "수집된 이벤트 없음",
      droppedCount: 0,
    };
  }

  const lines = evidence.lines.slice(0, cap); // 상위 신호 우선(seam 이 이미 severity/first-anomaly 순 정렬).
  let dropped = 0;
  let seq = 0;
  const nextId = () => `nc-${seq++}`;

  // claim 조립기 — 인용이 하나도 없으면 **드롭**(HARD grounding). 반환 null 은 상위에서 필터.
  const claim = (text: string, citations: NarrativeCitation[]): NarrativeClaim | null => {
    if (citations.length === 0) { dropped++; return null; }
    return { id: nextId(), text, citations };
  };

  const whatClaims: NarrativeClaim[] = [];
  const whyClaims: NarrativeClaim[] = [];
  const impactClaims: NarrativeClaim[] = [];
  const nextClaims: NarrativeClaim[] = [];

  for (const line of lines) {
    const cites = citationsFromLine(line);
    // 무엇이 — 신호 서술(무엇이 언제 관측됐나).
    const what = claim(`${line.signal.what} (${line.signal.when})`, cites);
    if (what) whatClaims.push(what);
    // 왜 — 이 신호의 추정 원인.
    const why = claim(line.probableCause, cites);
    if (why) whyClaims.push(why);
    // 영향 — 추정 영향.
    const impact = claim(line.impact, cites);
    if (impact) impactClaims.push(impact);
    // 다음 조치 — 신호 계열별 정적 runbook 제안(실행 아님).
    const next = claim(nextStepFor(line.kind), cites);
    if (next) nextClaims.push(next);
  }

  // 왜 섹션 상단에 근본원인 요약(rootCauseSummary)을 최상위 claim 으로 — 인용은 대상 객체 자신(objectId).
  //   rootCauseSummary 는 probableCauseText(대상 객체 기반)라 objectId 인용이 항상 성립(grounding 유지).
  const summaryCites: NarrativeCitation[] = [{ ref: evidence.objectId, objectId: evidence.objectId }];
  const summaryClaim = claim(evidence.rootCauseSummary, summaryCites);
  if (summaryClaim) whyClaims.unshift(summaryClaim);

  const sections: NarrativeSection[] = [
    { key: "what", title: SECTION_TITLE.what, claims: whatClaims },
    { key: "why", title: SECTION_TITLE.why, claims: whyClaims.slice(0, cap) },
    { key: "impact", title: SECTION_TITLE.impact, claims: impactClaims },
    { key: "next", title: SECTION_TITLE.next, claims: nextClaims },
  ];

  return {
    objectId: evidence.objectId,
    found: true,
    title: evidence.title,
    sections,
    mode,
    source,
    empty: false,
    droppedCount: dropped,
  };
}
