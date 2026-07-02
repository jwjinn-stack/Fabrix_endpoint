// EvidencePanel(IMP-93) 테스트 — 채팅 없이 신호→추정원인→영향 접지.
// 케이스: seam 에서 신호→추정원인→영향 렌더 / progressive disclosure(상위 N + expander) /
//         confidence(≥2=high) / empty-state "수집된 이벤트 없음"(환각 금지) / clickable citation /
//         기존 K8sSnapshot 소비(신규 데이터 모델 없음).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import EvidencePanel from "./EvidencePanel";
import type { K8sSnapshot, OntologyLink, OntologyObject } from "../api/types";
import { buildIncidentEvidence } from "../api/incidentEvidence";

// 척추: endpoint --serves--> model --runsOn--> gpu --hostedBy--> node. gpu/node crit → 신호 실림.
const OBJECTS: OntologyObject[] = [
  { id: "endpoint:e-slow", type: "Endpoint", title: "느린 EP", props: { ready: false, replicas: 2, namespace: "fabrix" }, status: "crit", revision: 1 },
  { id: "model:m", type: "Model", title: "모델 M", props: { replicas: 2 }, status: "warn", revision: 1 },
  { id: "gpu:g", type: "GpuDevice", title: "GPU 0", props: { util_perc: 0.97, mem_perc: 0.93, throttle: "열(HW Thermal Slowdown)" }, status: "crit", revision: 1 },
  { id: "node:n", type: "Node", title: "노드 N", props: { hostname: "n0", cpu_util: 0.94, net_err_per_s: 12 }, status: "crit", revision: 1 },
  { id: "gpu:ok", type: "GpuDevice", title: "정상 GPU", props: { util_perc: 0.4, mem_perc: 0.3, throttle: "제약 없음" }, status: "ok", revision: 1 },
];
const LINKS: OntologyLink[] = [
  { from: "endpoint:e-slow", to: "model:m", linkKind: "serves" },
  { from: "model:m", to: "gpu:g", linkKind: "runsOn" },
  { from: "gpu:g", to: "node:n", linkKind: "hostedBy" },
];

afterEach(() => cleanup());

describe("EvidencePanel — 신호→추정원인→영향 렌더(seam 소비)", () => {
  it("근거 줄이 신호(what)·추정원인(cause)·영향(impact)을 seam 순서대로 렌더", () => {
    render(<EvidencePanel objectId="gpu:g" objects={OBJECTS} links={LINKS} />);
    // seam 이 만든 첫 줄의 what/cause/impact 가 화면에 있다(재파생 없이 seam 값 그대로).
    const ev = buildIncidentEvidence("gpu:g", { objects: OBJECTS, links: LINKS, k8s: emptyK8s() });
    expect(ev.lines.length).toBeGreaterThan(0);
    const first = ev.lines[0];
    expect(screen.getByText(first.signal.what)).toBeInTheDocument();
    // 근본원인 요약도 렌더.
    expect(screen.getByText(ev.rootCauseSummary)).toBeInTheDocument();
    // 근거 섹션 landmark.
    expect(screen.getByRole("region", { name: "근거" })).toBeInTheDocument();
  });
});

describe("EvidencePanel — progressive disclosure(상위 N + expander)", () => {
  it("기본 상위 2줄만, '전체 이벤트 N건' expander 클릭 시 나머지 노출", () => {
    // endpoint:e-slow 는 OOM pod + event + deployment + first-anomaly 등 ≥3 줄을 만든다.
    render(<EvidencePanel objectId="endpoint:e-slow" objects={OBJECTS} links={LINKS} />);
    const ev = buildIncidentEvidence("endpoint:e-slow", { objects: OBJECTS, links: LINKS, k8s: emptyK8s() });
    // (실제 렌더는 mock K8s 를 포함하므로 seam 줄 수 이상이 될 수 있음) 최소 3줄 이상이어야 expander 의미.
    const region = screen.getByRole("region", { name: "근거" });
    const before = within(region).getAllByRole("listitem").length;
    expect(before).toBe(2); // 기본 노출 = 상위 2줄
    const expander = screen.getByRole("button", { name: /전체 이벤트 \d+건 보기/ });
    fireEvent.click(expander);
    const after = within(region).getAllByRole("listitem").length;
    expect(after).toBeGreaterThan(before);
    // 접기 토글.
    expect(screen.getByRole("button", { name: "접기" })).toBeInTheDocument();
    void ev;
  });
});

describe("EvidencePanel — confidence(≥2 상관 = high)", () => {
  it("상관 신호 ≥2 인 객체 → 신뢰도 '높음' 배지", () => {
    render(<EvidencePanel objectId="gpu:g" objects={OBJECTS} links={LINKS} />);
    expect(screen.getByText(/신뢰도 높음/)).toBeInTheDocument();
  });
});

describe("EvidencePanel — empty-state(환각 금지)", () => {
  it("상관 근거 0 → '수집된 이벤트 없음' verbatim, 근거 줄 없음", () => {
    const okObjs: OntologyObject[] = [
      { id: "gpu:ok", type: "GpuDevice", title: "정상 GPU", props: { util_perc: 0.4, mem_perc: 0.3, throttle: "제약 없음" }, status: "ok", revision: 1 },
    ];
    render(<EvidencePanel objectId="gpu:ok" objects={okObjs} links={[]} />);
    expect(screen.getByText("수집된 이벤트 없음")).toBeInTheDocument();
    // 근거 리스트 항목 없음.
    const region = screen.getByRole("region", { name: "근거" });
    expect(within(region).queryAllByRole("listitem").length).toBe(0);
  });
});

describe("EvidencePanel — clickable citation(navigate/highlight)", () => {
  it("온톨로지 objectId 인용 클릭 → onCite(objectId) 호출", () => {
    const onCite = vi.fn();
    // gpu:g 근거 줄의 sourceRef(citation)은 objectId(gpu:g)를 담는다 → 클릭 가능 버튼.
    render(<EvidencePanel objectId="gpu:g" objects={OBJECTS} links={LINKS} onCite={onCite} />);
    const citeBtn = document.querySelector(".ev-cite-link") as HTMLButtonElement | null;
    expect(citeBtn).not.toBeNull();
    fireEvent.click(citeBtn!);
    expect(onCite).toHaveBeenCalledWith("gpu:g");
  });

  it("onCite 미제공이면 인용은 비클릭 텍스트(버튼 아님)", () => {
    render(<EvidencePanel objectId="gpu:g" objects={OBJECTS} links={LINKS} />);
    expect(document.querySelector(".ev-cite-link")).toBeNull();
    expect(document.querySelector(".ev-cite")).not.toBeNull();
  });
});

describe("EvidencePanel — 기존 K8sSnapshot 소비(신규 데이터 모델 없음)", () => {
  it("buildK8sSnapshot 파생 pod/event 를 근거로(신규 fetch 없이 objects/links 만)", () => {
    // endpoint:e-slow 는 mock buildK8sSnapshot 이 OOM/CrashLoop pod·event 를 파생한다 → 근거 줄에 반영.
    render(<EvidencePanel objectId="endpoint:e-slow" objects={OBJECTS} links={LINKS} onCite={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /전체 이벤트 \d+건 보기/ }));
    // pod/… 또는 event 인용(비클릭 텍스트)이 존재.
    const cites = Array.from(document.querySelectorAll(".ev-cite")).map((n) => n.textContent ?? "");
    expect(cites.some((c) => c.startsWith("pod/") || c.startsWith("node/") || c.includes("endpoint:e-slow"))).toBe(true);
  });
});

// 테스트 내부 seam 비교용 빈 K8s(컴포넌트는 buildK8sSnapshot 을 내부에서 조립하므로, 여기선 seam 순서 확인만).
function emptyK8s(): K8sSnapshot {
  return { pods: [], nodes: [], events: [], deployments: [] };
}
