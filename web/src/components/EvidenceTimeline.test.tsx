// EvidenceTimeline(IMP-100) 테스트 — 근거 세로 evidence timeline 시각언어.
// 케이스: first-anomaly→now 순서 마커 렌더 / severity 색 + 경과시간(색-only 아님) /
//         추정 원인 강조 + 인과 연결선 + 영향 / IMP-93 인용 보존(클릭/비클릭) /
//         first-anomaly 앵커 강조 / 어댑터 재사용(evidence·signals) / reduce-motion(무한 애니메이션 없음).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import EvidenceTimeline, { markersFromEvidence, markersFromSignals } from "./EvidenceTimeline";
import type { EvidenceLine } from "../api/incidentEvidence";
import type { DetectionSignal } from "../api/types";

afterEach(() => cleanup());

// 근거 줄 픽스처 — first-anomaly(앵커) → alertrule(crit) 순. cause/impact 포함.
const LINES: EvidenceLine[] = [
  {
    id: "firstAnomaly:0", kind: "firstAnomaly",
    signal: { what: "가장 이른 이상 관측", when: "12분 전", sourceRef: "gpu:g" },
    probableCause: "가장 이른 이상 관측 시각(추정 원인 시간축)",
    impact: "이후 홉으로 전파(추정)",
    confidence: "high", sourceRefs: ["gpu:g"],
  },
  {
    id: "alertrule:1", kind: "alertrule",
    signal: { what: "TTFT p95 급증 — 820ms > 임계 800ms", when: "5분 전", sourceRef: "rule_a1b2 · model:m" },
    probableCause: "임계 초과(alertrules) — 지연/오류 급증 정황(추정)",
    impact: "엔드포인트 지연/오류가 소비 앱으로 전파(추정)",
    confidence: "high", sourceRefs: ["rule_a1b2 · model:m", "model:m"],
  },
  {
    id: "k8sPod:2", kind: "k8sPod",
    signal: { what: "파드 Running · 재시작 3회", when: "최근", sourceRef: "pod/foo-abc" },
    probableCause: "컨테이너 기동 실패/크래시 루프 정황(추정)",
    impact: "가용 레플리카 감소 → 요청 실패·지연",
    confidence: "high", sourceRefs: ["pod/foo-abc", "endpoint:e"],
  },
];

describe("EvidenceTimeline — 마커 순서 + severity 색 + 경과시간", () => {
  it("T1 입력 순서(first-anomaly→now) 그대로 마커를 렌더한다(재정렬 없음)", () => {
    render(<EvidenceTimeline markers={markersFromEvidence(LINES)} />);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(3);
    // 첫 마커 = first-anomaly, 마지막 = k8sPod(파드).
    expect(within(items[0]).getByText("가장 이른 이상 관측")).toBeInTheDocument();
    expect(within(items[2]).getByText(/파드 Running/)).toBeInTheDocument();
  });

  it("T2 각 마커에 severity 클래스 + severity 텍스트(색-only 아님) + 경과시간이 있다", () => {
    render(<EvidenceTimeline markers={markersFromEvidence(LINES)} />);
    const items = screen.getAllByRole("listitem");
    // alertrule = crit(severity 클래스 + 텍스트 "위험").
    expect(items[1].className).toContain("ev-tl-sev-crit");
    expect(within(items[1]).getByText("위험")).toBeInTheDocument();
    // k8sPod = warn.
    expect(items[2].className).toContain("ev-tl-sev-warn");
    expect(within(items[2]).getByText("주의")).toBeInTheDocument();
    // 경과시간 라벨.
    expect(within(items[1]).getByText("5분 전")).toBeInTheDocument();
  });
});

describe("EvidenceTimeline — 추정 원인 강조 + 인과 연결선 + 영향", () => {
  it("T3 cause 있는 마커는 ev-tl-cause + 연결선(ev-tl-connector) + impact 를 렌더한다", () => {
    const { container } = render(<EvidenceTimeline markers={markersFromEvidence(LINES)} />);
    const items = screen.getAllByRole("listitem");
    expect(items[1].className).toContain("ev-tl-has-cause");
    // 추정 원인 라벨 + 텍스트.
    expect(within(items[1]).getByText("추정 원인")).toBeInTheDocument();
    expect(within(items[1]).getByText(/임계 초과\(alertrules\)/)).toBeInTheDocument();
    // 영향 텍스트.
    expect(within(items[1]).getByText(/소비 앱으로 전파/)).toBeInTheDocument();
    // 인과 연결선.
    expect(container.querySelectorAll(".ev-tl-connector").length).toBeGreaterThan(0);
  });
});

describe("EvidenceTimeline — IMP-93 인용 보존", () => {
  it("T4a objectId 인용 + onCite → 클릭 버튼(ev-cite-link) → onCite(objectId)", () => {
    const onCite = vi.fn();
    render(<EvidenceTimeline markers={markersFromEvidence(LINES)} onCite={onCite} />);
    // 첫 줄 sourceRef=gpu:g(objectId) → 클릭 가능.
    const link = document.querySelector(".ev-cite-link") as HTMLButtonElement | null;
    expect(link).not.toBeNull();
    fireEvent.click(link!);
    expect(onCite).toHaveBeenCalledWith("gpu:g");
  });

  it("T4b onCite 미제공이면 인용은 비클릭 텍스트(버튼 아님)", () => {
    render(<EvidenceTimeline markers={markersFromEvidence(LINES)} />);
    expect(document.querySelector(".ev-cite-link")).toBeNull();
    expect(document.querySelector(".ev-cite")).not.toBeNull();
  });

  it("T4c pod/… 같은 비-objectId ref 는 onCite 있어도 비클릭 텍스트", () => {
    const onCite = vi.fn();
    render(<EvidenceTimeline markers={markersFromEvidence([LINES[2]])} onCite={onCite} />);
    // pod/foo-abc 는 objectId 형태가 아니므로 링크 아님.
    const cites = Array.from(document.querySelectorAll(".ev-cite")).map((n) => n.textContent);
    expect(cites).toContain("pod/foo-abc");
    expect(document.querySelector(".ev-cite-link")).toBeNull();
  });
});

describe("EvidenceTimeline — first-anomaly 앵커", () => {
  it("T5 isAnchor 마커는 ev-tl-anchor + '가장 이른 이상' 태그로 rail 시작점을 강조한다", () => {
    render(<EvidenceTimeline markers={markersFromEvidence(LINES)} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0].className).toContain("ev-tl-anchor");
    expect(within(items[0]).getByText("가장 이른 이상")).toBeInTheDocument();
  });
});

describe("EvidenceTimeline — 어댑터 재사용(evidence · signals 단일 형태)", () => {
  it("T6 markersFromSignals 도 동일 TimelineMarker 형태를 낸다(KineticStrip 소비)", () => {
    const signals: DetectionSignal[] = [
      { kind: "firstAnomaly", label: "최초 이상 관측", detail: "12분 전", observedAt: "12분 전", citation: "gpu:g1" },
      { kind: "throttle", label: "클럭 스로틀", detail: "열", observedAt: "12분 전", citation: "gpu:g1" },
    ];
    const markers = markersFromSignals(signals);
    expect(markers.length).toBe(2);
    // 앵커 판별 + severity 매핑 + when.
    expect(markers[0].isAnchor).toBe(true);
    expect(markers[0].severity).toBe("info"); // firstAnomaly
    expect(markers[1].severity).toBe("warn"); // throttle
    expect(markers[1].when).toBe("12분 전");
    // signals 어댑터는 cause/impact 를 싣지 않는다(슬롯3 중복 회피).
    expect(markers[1].cause).toBeUndefined();
    // 렌더 — compact 변형.
    const { container } = render(<EvidenceTimeline markers={markers} compact />);
    expect(container.querySelector(".ev-tl-compact")).not.toBeNull();
    expect(screen.getByText(/클럭 스로틀/)).toBeInTheDocument();
  });
});

describe("EvidenceTimeline — reduce-motion 안전 / 빈 입력", () => {
  it("T7 신규 무한 애니메이션 인라인 없음(전역 규칙 존중) + 빈 마커 미렌더", () => {
    const { container, rerender } = render(<EvidenceTimeline markers={markersFromEvidence(LINES)} />);
    // 컴포넌트가 인라인 style animation 을 붙이지 않는다.
    expect(container.querySelector("[style*='animation']")).toBeNull();
    // 빈 마커 → 미렌더.
    rerender(<EvidenceTimeline markers={[]} />);
    expect(container.querySelector(".ev-tl")).toBeNull();
  });
});
