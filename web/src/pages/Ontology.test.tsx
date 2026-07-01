// IMP-63 — Ontology 개요 화면 테스트.
// client(온톨로지 fetch) + capabilities 를 모킹해 결정적으로 구동한다(백엔드 0개). 케이스:
//   normal(카탈로그 타입당 1장 + 라이브 count / 스키마 그래프 타입 노드+링크 엣지 / Action 표 target·cap·side-effect
//          / 개념 헤더 느낌 3가지) / 카드 클릭 → ObjectView / route·nav 등록 / failure(fetch reject) /
//   bad-input(빈 objects) / env-missing(링크 fetch reject → 그래프는 얻은 것만, 페이지 생존).
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { OntologyLink, OntologyObject } from "../api/types";

// jsdom SVG/dialog shim(TopologyView · SlidePanel/ObjectView).
beforeAll(() => {
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, top: 0, width: 800, height: 360, right: 800, bottom: 360, x: 0, y: 0, toJSON: () => {} }) as DOMRect,
  });
  if (!("setPointerCapture" in Element.prototype)) {
    // @ts-expect-error test shim
    Element.prototype.setPointerCapture = () => {};
  }
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
  }
});

// §5.2 척추 픽스처: Service→Endpoint→Model→GpuDevice→Node + Incident.
const OBJECTS: OntologyObject[] = [
  { id: "service:svc-a", type: "Service", title: "Svc A", props: {}, status: "ok", revision: 1 },
  { id: "endpoint:ep-a", type: "Endpoint", title: "EP A", props: { replicas: 2 }, status: "crit", revision: 1 },
  { id: "model:m-a", type: "Model", title: "Model A", props: {}, status: "ok", revision: 1 },
  { id: "gpu:g0", type: "GpuDevice", title: "GPU 0", props: {}, status: "crit", revision: 1 },
  { id: "node:n0", type: "Node", title: "Node 0", props: {}, status: "ok", revision: 1 },
];
const LINKS_BY_ID: Record<string, OntologyLink[]> = {
  "service:svc-a": [{ from: "service:svc-a", to: "endpoint:ep-a", linkKind: "consumes" }],
  "endpoint:ep-a": [
    { from: "service:svc-a", to: "endpoint:ep-a", linkKind: "consumes" },
    { from: "endpoint:ep-a", to: "model:m-a", linkKind: "serves" },
  ],
  "model:m-a": [
    { from: "endpoint:ep-a", to: "model:m-a", linkKind: "serves" },
    { from: "model:m-a", to: "gpu:g0", linkKind: "runsOn" },
  ],
  "gpu:g0": [{ from: "model:m-a", to: "gpu:g0", linkKind: "runsOn" }],
  "node:n0": [],
};

const fetchOntologyObjects = vi.fn();
const fetchOntologyLinks = vi.fn();
const fetchOntologyObject = vi.fn();

vi.mock("../api/client", () => ({
  fetchOntologyObjects: (...a: unknown[]) => fetchOntologyObjects(...a),
  fetchOntologyLinks: (id: string, ...a: unknown[]) => fetchOntologyLinks(id, ...a),
  fetchOntologyObject: (id: string, ...a: unknown[]) => fetchOntologyObject(id, ...a),
}));

vi.mock("../capabilities", () => ({
  useCap: () => ({ can: () => true, caps: { profile: "manage", readonly: false, capabilities: {}, data_source: "mock", integrations: {} } }),
}));

import Ontology from "./Ontology";
import { ROUTES, PAGE_CAP } from "../router";

function stubOk() {
  fetchOntologyObjects.mockResolvedValue({ generated_at: "t", objects: OBJECTS, source: "mock" });
  fetchOntologyLinks.mockImplementation((id: string) =>
    Promise.resolve({ generated_at: "t", object_id: id, links: LINKS_BY_ID[id] ?? [], source: "mock" }),
  );
  // ObjectView 가 카드 클릭 시 호출 — canonical + 인덱스.
  fetchOntologyObject.mockImplementation((id: string) =>
    Promise.resolve(OBJECTS.find((o) => o.id === id) ?? OBJECTS[0]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/ontology");
  stubOk();
});
afterEach(() => cleanup());

describe("Ontology — normal", () => {
  it("개념 헤더의 '느낌' 3가지를 렌더한다(§8)", async () => {
    render(<Ontology />);
    await waitFor(() => expect(screen.getByText("온톨로지 렌즈")).toBeInTheDocument());
    expect(screen.getByText("Kinetic 제어")).toBeInTheDocument();
    expect(screen.getByText("접지된 AI")).toBeInTheDocument();
    // semantic↔kinetic 두 축(§1) 문구.
    expect(screen.getByText(/Semantic\(의미\)/)).toBeInTheDocument();
  });

  it("Object Type 카탈로그를 타입당 1장 + 라이브 인스턴스 수로 렌더한다", async () => {
    const { container } = render(<Ontology />);
    await waitFor(() => expect(fetchOntologyObjects).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelectorAll(".onto-card").length).toBeGreaterThan(0));
    // 7개 Object Type 카드(§5.1) — count 0 타입 포함.
    const cards = Array.from(container.querySelectorAll<HTMLElement>(".onto-card"));
    expect(cards.length).toBe(7);
    // Endpoint 카드를 타입명으로 찾아 라이브 count(1) 확인.
    const epCard = cards.find((c) => c.querySelector(".onto-card-type")?.textContent === "Endpoint")!;
    expect(epCard).toBeTruthy();
    expect(epCard.querySelector(".onto-card-count")?.textContent).toBe("1");
    // Trace 카드는 인스턴스 0 → count 0.
    const traceCard = cards.find((c) => c.querySelector(".onto-card-type")?.textContent === "Trace")!;
    expect(traceCard.querySelector(".onto-card-count")?.textContent).toBe("0");
    // 대표 인스턴스 title 칩.
    expect(screen.getByText("EP A")).toBeInTheDocument();
  });

  it("Link Type 스키마 그래프가 타입 노드 + 라벨 링크 엣지를 렌더한다(§5.2)", async () => {
    const { container } = render(<Ontology />);
    await waitFor(() => expect(fetchOntologyLinks).toHaveBeenCalled());
    // TopologyView 노드에 타입 라벨(Model/Endpoint/GpuDevice/…).
    await waitFor(() => expect(container.querySelector(".topo-svg")).toBeInTheDocument());
    expect(container.querySelectorAll(".topo-node").length).toBeGreaterThan(0);
    // 관계 정의 표(complex-image 동등 대안)에 link kind 라벨.
    expect(screen.getByText(/serves \(서빙\)/)).toBeInTheDocument();
    expect(screen.getByText(/runsOn \(실행\)/)).toBeInTheDocument();
    // 노드 라벨(SVG text)에 타입명.
    expect(screen.getAllByText("Model").length).toBeGreaterThan(0);
  });

  it("Action Type 목록에 대상 type·필요 capability·side effects 를 표시한다(§5.3)", async () => {
    render(<Ontology />);
    await waitFor(() => expect(screen.getByText("모델 재기동")).toBeInTheDocument());
    // restartModel: target=Model, requiredCap=models.write, sideEffects 에 audit/알림.
    expect(screen.getAllByText(/models\.write/).length).toBeGreaterThan(0);
    expect(screen.getByText("restartModel")).toBeInTheDocument();
    expect(screen.getAllByText("audit").length).toBeGreaterThan(0);
    // requiredCap 없는 verb(ack)는 '기본 허용'.
    expect(screen.getAllByText("기본 허용").length).toBeGreaterThan(0);
  });
});

describe("Ontology — 상호작용 / 배선", () => {
  it("대표 인스턴스 칩 클릭 → ObjectView 드로어(속성 섹션)", async () => {
    render(<Ontology />);
    await waitFor(() => expect(screen.getByText("EP A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /EP A/ }));
    await waitFor(() => {
      const dlg = document.querySelector("dialog");
      expect(dlg).not.toBeNull();
    });
    await waitFor(() => expect(screen.getByText("속성")).toBeInTheDocument());
    expect(fetchOntologyObject).toHaveBeenCalledWith("endpoint:ep-a", expect.anything());
  });

  it("route·nav 가 등록되어 있다(/ontology → ontology, PAGE_CAP=dashboard)", () => {
    expect(ROUTES.ontology).toBe("/ontology");
    expect(PAGE_CAP.ontology).toBe("dashboard");
  });
});

describe("Ontology — failure / bad-input / env-missing", () => {
  it("failure: fetchOntologyObjects reject → 에러 상태(페이지 죽지 않음)", async () => {
    fetchOntologyObjects.mockRejectedValue(new Error("API 503"));
    render(<Ontology />);
    await waitFor(() => expect(screen.getByText(/온톨로지를 불러오지 못했습니다/)).toBeInTheDocument());
  });

  it("bad-input: 빈 objects → 카탈로그 카드는 유지(카운트 0) + 스키마 빈 상태 graceful", async () => {
    fetchOntologyObjects.mockResolvedValue({ generated_at: "t", objects: [], source: "mock" });
    fetchOntologyLinks.mockResolvedValue({ generated_at: "t", object_id: "x", links: [], source: "mock" });
    const { container } = render(<Ontology />);
    await waitFor(() => expect(container.querySelectorAll(".onto-card").length).toBe(7));
    // 스키마 빈 상태 안내(throw 없음).
    expect(screen.getByText(/관측된 관계가 없습니다/)).toBeInTheDocument();
  });

  it("env-missing: 링크 fetch 일부 reject 되어도 페이지는 생존(카탈로그 렌더)", async () => {
    fetchOntologyLinks.mockRejectedValue(new Error("API 503"));
    const { container } = render(<Ontology />);
    // objects 는 성공했으므로 카탈로그는 렌더, 링크 실패는 흡수(allSettled).
    await waitFor(() => expect(container.querySelectorAll(".onto-card").length).toBe(7));
    // 링크가 하나도 없으니 스키마는 빈 상태로 graceful.
    expect(screen.getByText(/관측된 관계가 없습니다/)).toBeInTheDocument();
  });
});
