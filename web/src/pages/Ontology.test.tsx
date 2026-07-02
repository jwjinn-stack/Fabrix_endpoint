// IMP-68 — /ontology 운영 준비도 스코어카드 화면 테스트(IMP-63 카탈로그를 보조 탭으로 전환).
// client(온톨로지 fetch) + capabilities 를 모킹해 결정적으로 구동한다(백엔드 0개). 케이스:
//   primary=스코어카드(주의 요약·인스턴스 pass/fail·그룹) / 실패 항목 딥링크(ObjectView·COP) /
//   스키마 그래프는 "스키마 참조" 보조 탭(still reachable) / route·nav / failure / all-pass·empty.
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
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

// §5.2 척추 픽스처: Service→Endpoint→Model→GpuDevice→Node + 오너/메트릭 props(스코어 판정용).
//  endpoint:ep-a 는 crit + ready=false + 오너 없음 → at-risk(status-healthy·deployed·has-owner fail).
const OBJECTS: OntologyObject[] = [
  { id: "service:svc-a", type: "Service", title: "Svc A", props: { name: "svc-a", qps: 12, error_rate: 0.01 }, status: "ok", revision: 1 },
  { id: "endpoint:ep-a", type: "Endpoint", title: "EP A", props: { replicas: 2, backend: "vllm", ready: false }, status: "crit", revision: 1 },
  { id: "model:m-a", type: "Model", title: "Model A", props: { provider: "Google", context_window: 4096, pattern: "agg", gpu: 1, replicas: 2 }, status: "ok", revision: 1 },
  { id: "gpu:g0", type: "GpuDevice", title: "GPU 0", props: { device: "n0/g0", util_perc: 0.5, temp_c: 70, xid_recent: 0 }, status: "crit", revision: 1 },
  { id: "node:n0", type: "Node", title: "Node 0", props: { hostname: "n0", cpu_util: 0.4 }, status: "ok", revision: 1 },
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
  // KineticStrip(내부)이 호출 — IMP-77 폴링 승격 후에도 빈 알림으로 조용히(스트립 미렌더).
  fetchKineticAlerts: () => Promise.resolve({ generated_at: "t", alerts: [], source: "mock" }),
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
  // ObjectView 가 인스턴스 클릭 시 호출 — canonical + 인덱스.
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

describe("Ontology — 기본 탭 = 운영 준비도 스코어카드", () => {
  it("기본 진입 시 '운영 준비도' 탭이 활성이고 '주의 요약'(주의 대상 수)이 보인다", async () => {
    render(<Ontology />);
    await waitFor(() => expect(fetchOntologyObjects).toHaveBeenCalled());
    // 정문 헤드라인 — 과업-앵커("지금 무엇이 주의를 요하나").
    await waitFor(() => expect(screen.getByText("지금 주의를 요하는 것")).toBeInTheDocument());
    const scorecardTab = screen.getByRole("tab", { name: "운영 준비도" });
    expect(scorecardTab).toHaveAttribute("aria-selected", "true");
    // at-risk 2건(crit Endpoint + crit GPU) — 요약 카운트.
    await waitFor(() => expect(screen.getByText(/주의 대상/)).toBeInTheDocument());
  });

  it("per-instance pass/fail + 그룹(Production Readiness/Observability/Ownership)을 렌더한다", async () => {
    const { container } = render(<Ontology />);
    await waitFor(() => expect(container.querySelectorAll(".onto-scorerow").length).toBeGreaterThan(0));
    // 5개 SCORABLE 인스턴스(Service/Endpoint/Model/GpuDevice/Node) 채점.
    const rows = Array.from(container.querySelectorAll<HTMLElement>(".onto-scorerow"));
    expect(rows.length).toBe(5);
    // 3그룹 라벨(요약 + 각 행 셀에 등장).
    expect(screen.getAllByText("운영 준비").length).toBeGreaterThan(0);
    expect(screen.getAllByText("관측성").length).toBeGreaterThan(0);
    expect(screen.getAllByText("오너십").length).toBeGreaterThan(0);
    // 위험 Endpoint 행은 at-risk 강조 + 실패 규칙(상태 정상/배포·활성/오너 지정) 명시.
    const epRow = rows.find((r) => r.querySelector(".onto-scorerow-title")?.textContent === "EP A")!;
    expect(epRow).toBeTruthy();
    expect(epRow.className).toContain("onto-scorerow-risk");
    expect(epRow.textContent).toContain("상태 정상");
    expect(epRow.textContent).toContain("오너 지정");
  });

  it("'주의 요약' 에 at-risk 수·실패 규칙 수가 텍스트로 표시된다", async () => {
    const { container } = render(<Ontology />);
    await waitFor(() => expect(container.querySelector(".onto-attn")).toBeInTheDocument());
    // 실패 규칙 카운트 문구.
    expect(screen.getByText(/실패 규칙/)).toBeInTheDocument();
    // 그룹별 pass/total 미니 바(3개).
    expect(container.querySelectorAll(".onto-group-stat").length).toBe(3);
  });
});

describe("Ontology — 실패 항목 딥링크(과업 연결)", () => {
  it("인스턴스 [상세] 클릭 → ObjectView 드로어(속성) + fetchOntologyObject 호출", async () => {
    const { container } = render(<Ontology />);
    await waitFor(() => expect(container.querySelectorAll(".onto-scorerow").length).toBe(5));
    const epRow = Array.from(container.querySelectorAll<HTMLElement>(".onto-scorerow"))
      .find((r) => r.querySelector(".onto-scorerow-title")?.textContent === "EP A")!;
    const detailBtn = Array.from(epRow.querySelectorAll("button")).find((b) => /상세/.test(b.textContent ?? ""))!;
    fireEvent.click(detailBtn);
    await waitFor(() => {
      const dlg = document.querySelector("dialog");
      expect(dlg).not.toBeNull();
    });
    await waitFor(() => expect(screen.getByText("속성")).toBeInTheDocument());
    expect(fetchOntologyObject).toHaveBeenCalledWith("endpoint:ep-a", expect.anything());
  });

  it("인스턴스 [조사] 클릭 → onNavigate('investigate', { entity })", async () => {
    const onNavigate = vi.fn();
    const { container } = render(<Ontology onNavigate={onNavigate} />);
    await waitFor(() => expect(container.querySelectorAll(".onto-scorerow").length).toBe(5));
    const epRow = Array.from(container.querySelectorAll<HTMLElement>(".onto-scorerow"))
      .find((r) => r.querySelector(".onto-scorerow-title")?.textContent === "EP A")!;
    const investigateBtn = Array.from(epRow.querySelectorAll("button")).find((b) => /조사/.test(b.textContent ?? ""))!;
    fireEvent.click(investigateBtn);
    expect(onNavigate).toHaveBeenCalledWith("investigate", { entity: "endpoint:ep-a" });
  });
});

describe("Ontology — 스키마 그래프 = 보조 탭(still reachable)", () => {
  it("기본 탭엔 스키마 그래프 없음 → '스키마 참조' 탭 클릭 후 그래프·관계표·Action 표 등장", async () => {
    const { container } = render(<Ontology />);
    await waitFor(() => expect(screen.getByText("지금 주의를 요하는 것")).toBeInTheDocument());
    // 기본(스코어카드) 탭에는 스키마 그래프(topo-svg)가 없다.
    expect(container.querySelector(".topo-svg")).toBeNull();
    // IMP-83 — 개념 헤더는 이제 상단 disclosure(양 탭 공통) 로 승격됐다.
    //   개념 카피는 disclosure 본문(.onto-onboard-body)에만 존재하고, 스키마 탭 섹션엔 없다(중복 제거).
    expect(container.querySelectorAll(".onto-concept").length).toBe(0);

    // '스키마 참조' 탭으로 전환.
    fireEvent.click(screen.getByRole("tab", { name: "스키마 참조" }));

    // 스키마 그래프(TopologyView) + 관계 정의 표(link kind) + Action 표가 나타난다.
    await waitFor(() => expect(container.querySelector(".topo-svg")).toBeInTheDocument());
    expect(screen.getByText(/serves \(서빙\)/)).toBeInTheDocument();
    // IMP-83 — 개념 헤더 카피는 스키마 탭에서 제거됨(중복 없음, disclosure 로 단일화).
    expect(container.querySelectorAll(".onto-concept").length).toBe(0);
    // Object Type 카탈로그(타입당 1장, count 0 타입 포함) — 8장(IMP-89 App 추가).
    expect(container.querySelectorAll(".onto-card").length).toBe(8);
    // Action Type 목록.
    expect(screen.getByText("restartModel")).toBeInTheDocument();
    expect(screen.getAllByText(/models\.write/).length).toBeGreaterThan(0);
  });

  it("스키마 참조 탭: 대표 인스턴스 칩 클릭 → ObjectView 드로어", async () => {
    render(<Ontology />);
    await waitFor(() => expect(screen.getByText("지금 주의를 요하는 것")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "스키마 참조" }));
    await waitFor(() => expect(screen.getByText("EP A")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /EP A/ }));
    await waitFor(() => expect(screen.getByText("속성")).toBeInTheDocument());
  });
});

describe("Ontology — route·nav / failure", () => {
  it("route·nav 가 등록되어 있다(/ontology → ontology, PAGE_CAP=dashboard)", () => {
    expect(ROUTES.ontology).toBe("/ontology");
    expect(PAGE_CAP.ontology).toBe("dashboard");
  });

  it("failure: fetchOntologyObjects reject → 에러 상태(페이지 죽지 않음)", async () => {
    fetchOntologyObjects.mockRejectedValue(new Error("API 503"));
    render(<Ontology />);
    await waitFor(() => expect(screen.getByText(/온톨로지를 불러오지 못했습니다/)).toBeInTheDocument());
  });
});

describe("Ontology — all-pass / empty / env-missing", () => {
  it("all-pass: 전부 정상+오너 있는 인스턴스 → '모든 인스턴스 통과' 요약", async () => {
    const ALL_OK: OntologyObject[] = [
      { id: "endpoint:ok", type: "Endpoint", title: "EP OK", props: { replicas: 2, backend: "vllm", ready: true, app_id: "a", dept_id: "d" }, status: "ok", revision: 1 },
      { id: "model:ok", type: "Model", title: "Model OK", props: { provider: "G", context_window: 4096, pattern: "agg", gpu: 1, replicas: 1 }, status: "ok", revision: 1 },
    ];
    fetchOntologyObjects.mockResolvedValue({ generated_at: "t", objects: ALL_OK, source: "mock" });
    fetchOntologyLinks.mockResolvedValue({ generated_at: "t", object_id: "x", links: [], source: "mock" });
    render(<Ontology />);
    await waitFor(() => expect(screen.getByText(/모든 인스턴스가 규칙을 통과/)).toBeInTheDocument());
  });

  it("empty: 빈 objects → 스코어카드 empty 안내 + 스키마 참조 탭 여전히 카드 8장", async () => {
    fetchOntologyObjects.mockResolvedValue({ generated_at: "t", objects: [], source: "mock" });
    fetchOntologyLinks.mockResolvedValue({ generated_at: "t", object_id: "x", links: [], source: "mock" });
    const { container } = render(<Ontology />);
    await waitFor(() => expect(screen.getByText(/채점할 인스턴스가 없습니다/)).toBeInTheDocument());
    // 스키마 참조 탭 — 카탈로그 카드는 그대로 8장(그리드 유지, IMP-89 App 포함) + 스키마 빈 상태 graceful.
    fireEvent.click(screen.getByRole("tab", { name: "스키마 참조" }));
    await waitFor(() => expect(container.querySelectorAll(".onto-card").length).toBe(8));
    expect(screen.getByText(/관측된 관계가 없습니다/)).toBeInTheDocument();
  });

  it("env-missing: 링크 fetch 일부 reject 되어도 페이지는 생존(스코어카드 렌더)", async () => {
    fetchOntologyLinks.mockRejectedValue(new Error("API 503"));
    const { container } = render(<Ontology />);
    // objects 는 성공 → 스코어카드는 렌더(링크 실패는 allSettled 로 흡수).
    await waitFor(() => expect(container.querySelectorAll(".onto-scorerow").length).toBe(5));
    // 스키마 참조 탭 — 링크 없으니 그래프 빈 상태 graceful.
    fireEvent.click(screen.getByRole("tab", { name: "스키마 참조" }));
    await waitFor(() => expect(screen.getByText(/관측된 관계가 없습니다/)).toBeInTheDocument());
  });
});

// IMP-83 — 무엇/왜 온보딩: action-first 유지 + 접힌 3단 disclosure(localStorage 없음) + 첫 at-risk 예시 + InfoTip.
describe("Ontology — IMP-83 무엇/왜 온보딩(진행형 disclosure)", () => {
  it("action-first: '주의 요약'이 온보딩 disclosure 위(먼저)에 온다", async () => {
    const { container } = render(<Ontology />);
    await waitFor(() => expect(screen.getByText("지금 주의를 요하는 것")).toBeInTheDocument());
    // 스코어카드 요약 카드가 존재(접힘 chrome 아래로 밀리지 않음).
    expect(container.querySelector(".onto-attn")).toBeInTheDocument();
    // disclosure 어포던스도 존재하되 기본 접힘.
    const details = container.querySelector<HTMLDetailsElement>("details.onto-onboard");
    expect(details).toBeTruthy();
    expect(details!.open).toBe(false);
  });

  it("disclosure는 기본 접힘(open=false) — 어포던스 라벨만 노출, 상단 chrome 아님", async () => {
    const { container } = render(<Ontology />);
    await waitFor(() => expect(screen.getByText("지금 주의를 요하는 것")).toBeInTheDocument());
    // 어포던스 텍스트는 항상 보인다.
    expect(screen.getByText(/온톨로지란\?/)).toBeInTheDocument();
    // 네이티브 <details> 는 기본 접힘(브라우저가 본문을 숨김; jsdom 은 DOM 유지하나 open=false 검증).
    const details = container.querySelector<HTMLDetailsElement>("details.onto-onboard")!;
    expect(details.open).toBe(false);
  });

  it("disclosure 본문에 과업→객체·관계→조치 3단 + 느낌 카드가 들어 있다(펼침 시 노출)", async () => {
    render(<Ontology />);
    await waitFor(() => expect(screen.getByText("지금 주의를 요하는 것")).toBeInTheDocument());
    // 3단 개념 콘텐츠(과업/객체·관계/조치) + semantic↔kinetic 느낌 카드가 disclosure 본문에 존재.
    expect(screen.getByText(/과업\(Task\) 으로 시작/)).toBeInTheDocument();
    // 3단 본문 설명 카피(객체·관계 / 조치 단계) 존재.
    expect(screen.getByText(/명사와 관계의 그래프/)).toBeInTheDocument();
    expect(screen.getByText(/kinetic 제어 — 읽기 전용의 종말/)).toBeInTheDocument();
    expect(screen.getByText("온톨로지 렌즈")).toBeInTheDocument();
    expect(screen.getByText("Kinetic 제어")).toBeInTheDocument();
    expect(screen.getByText("접지된 AI")).toBeInTheDocument();
  });

  it("disclosure는 양 탭에서 동일하게 하나만 존재한다(공유 설명)", async () => {
    const { container } = render(<Ontology />);
    await waitFor(() => expect(screen.getByText("지금 주의를 요하는 것")).toBeInTheDocument());
    expect(container.querySelectorAll("details.onto-onboard").length).toBe(1);
    fireEvent.click(screen.getByRole("tab", { name: "스키마 참조" }));
    await waitFor(() => expect(container.querySelector(".topo-svg")).toBeInTheDocument());
    // 스키마 탭에서도 동일 disclosure 하나만(중복 개념 헤더 없음).
    expect(container.querySelectorAll("details.onto-onboard").length).toBe(1);
  });

  it("첫 at-risk 행에만 1회성 구체 예시(Endpoint --serves--> Model) 힌트가 붙는다", async () => {
    const { container } = render(<Ontology />);
    await waitFor(() => expect(container.querySelectorAll(".onto-scorerow").length).toBe(5));
    const hints = container.querySelectorAll(".onto-example-hint");
    expect(hints.length).toBe(1); // 딱 첫 at-risk 행에만.
    // 첫 행(정렬상 at-risk 최상단)에 붙는다.
    const firstRow = container.querySelector(".onto-scorerow")!;
    expect(firstRow.querySelector(".onto-example-hint")).not.toBeNull();
    expect(hints[0].textContent).toMatch(/serves/);
  });

  it("그룹 라벨 + 용어(Object/Link/Action/kinetic)에 InfoTip(재사용) 이 붙는다", async () => {
    const { container } = render(<Ontology />);
    await waitFor(() => expect(container.querySelector(".onto-attn")).toBeInTheDocument());
    // 그룹 라벨 3개 InfoTip(요약 미니바) → infotip trigger 존재.
    expect(container.querySelectorAll(".onto-group-label .infotip").length).toBe(3);
    // disclosure 본문의 용어 InfoTip 4종(Object/Link/Action/kinetic).
    expect(container.querySelectorAll(".onto-onboard-body .infotip").length).toBe(4);
  });

  it("localStorage 상태 없음: 재마운트해도 disclosure 는 기본 접힘 유지", async () => {
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    const first = render(<Ontology />);
    await waitFor(() => expect(first.container.querySelector("details.onto-onboard")).toBeTruthy());
    first.unmount();
    const second = render(<Ontology />);
    await waitFor(() => expect(second.container.querySelector("details.onto-onboard")).toBeTruthy());
    const details = second.container.querySelector<HTMLDetailsElement>("details.onto-onboard")!;
    expect(details.open).toBe(false);
    // 온보딩 상태를 localStorage 에 쓰지 않는다.
    expect(setSpy).not.toHaveBeenCalledWith(expect.stringMatching(/onboard|onto/i), expect.anything());
    setSpy.mockRestore();
  });
});

// IMP-77 — 스코어카드 신선도·폴링 정합(IMP-51 규약 승격): 자동 갱신 표기 + 정지/재개 + tick 재조회.
describe("Ontology — IMP-77 신선도·폴링 정합", () => {
  it("신선도 라벨('자동 15s')과 정지/재개 토글을 렌더한다", async () => {
    render(<Ontology />);
    await waitFor(() => expect(screen.getAllByText(/자동 15s/).length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: /일시정지/ })).toBeInTheDocument();
  });

  it("interval tick 마다 스코어카드를 재조회한다(자동 갱신)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = render(<Ontology />);
    await waitFor(() => expect(container.querySelectorAll(".onto-scorerow").length).toBe(5));
    const before = fetchOntologyObjects.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(15_000); });
    await waitFor(() => expect(fetchOntologyObjects.mock.calls.length).toBeGreaterThan(before));
    vi.useRealTimers();
  });
});
