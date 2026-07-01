// ObjectView(IMP-57) 컴포넌트 테스트 — header/properties/related 렌더, in-place traverse+breadcrumb,
// back pop, Action 게이팅(observe disabled+사유 / manage enabled), deep-link 복원, 미존재 id 빈 상태.
// client 온톨로지 fetch 와 capabilities 를 모킹해 결정적으로 구동한다(백엔드 0개).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import ObjectView from "./ObjectView";
import { ToastProvider } from "../toast";
import * as client from "../api/client";
import type { OntologyObject, OntologyLink, OntologyObjectList, OntologyLinkList } from "../api/types";

// can() 를 테스트별로 갈아끼운다(observe/manage).
let mockCan = (_cap: string) => true;
vi.mock("../capabilities", () => ({
  useCap: () => ({ can: (c: string) => mockCan(c), caps: { profile: "manage", readonly: false, capabilities: {}, data_source: "mock", integrations: {} } }),
}));

// ── 픽스처: model:foo --serves 역방향-- endpoint:e1, --runsOn--> gpu:g1, --affects← incident:i1 ──
const OBJS: Record<string, OntologyObject> = {
  "model:foo": { id: "model:foo", type: "Model", title: "Foo 7B", props: { replicas: 3, context_window: 8192, provider: "acme" }, status: "ok", revision: 2 },
  "endpoint:e1": { id: "endpoint:e1", type: "Endpoint", title: "e1", props: { namespace: "prod", replicas: 3 }, status: "ok", revision: 1 },
  "gpu:g1": { id: "gpu:g1", type: "GpuDevice", title: "host/gpu0", props: { gpu_util: 0.7 }, status: "warn", revision: 1 },
  "incident:i1": { id: "incident:i1", type: "Incident", title: "지연 급증", props: { severity: "high", count: 4 }, status: "crit", revision: 1 },
};
const LINKS: OntologyLink[] = [
  { from: "endpoint:e1", to: "model:foo", linkKind: "serves" },
  { from: "model:foo", to: "gpu:g1", linkKind: "runsOn" },
  { from: "incident:i1", to: "model:foo", linkKind: "affects" },
];

function objList(): OntologyObjectList {
  return { generated_at: "t", objects: Object.values(OBJS), source: "ontology (mock)" };
}
function linkListFor(id: string): OntologyLinkList {
  return { generated_at: "t", object_id: id, links: LINKS.filter((l) => l.from === id || l.to === id), source: "ontology (mock)" };
}

function stubClient() {
  vi.spyOn(client, "fetchOntologyObjects").mockResolvedValue(objList());
  vi.spyOn(client, "fetchOntologyObject").mockImplementation((id: string) => {
    const o = OBJS[id];
    return o ? Promise.resolve(o) : Promise.reject(new Error("API 404"));
  });
  vi.spyOn(client, "fetchOntologyLinks").mockImplementation((id: string) => {
    if (!OBJS[id]) return Promise.reject(new Error("API 404"));
    return Promise.resolve(linkListFor(id));
  });
}

function renderView(objectId: string | null = "model:foo") {
  const onClose = vi.fn();
  const utils = render(
    <ToastProvider>
      <ObjectView objectId={objectId} onClose={onClose} />
    </ToastProvider>,
  );
  return { onClose, ...utils };
}

beforeEach(() => {
  mockCan = () => true;
  vi.restoreAllMocks();
  stubClient();
});
afterEach(() => cleanup());

describe("ObjectView — normal 렌더", () => {
  it("header(title+상태 Badge+metric) / properties / related 그룹을 렌더한다", async () => {
    renderView();
    // title
    await waitFor(() => expect(screen.getByText("Foo 7B")).toBeInTheDocument());
    // 상태 Badge
    expect(screen.getByText("정상")).toBeInTheDocument();
    // 두드러진 metric(header 카드 — ov-metric-v 에 값 표시)
    expect(document.querySelector(".ov-metric-v")?.textContent).toBe("3");
    // properties(DetailRow — provider)
    expect(screen.getByText("provider")).toBeInTheDocument();
    // related 그룹(runsOn=실행 GPU, serves=서빙 모델, affects=영향 대상)
    expect(screen.getByText("실행 GPU")).toBeInTheDocument();
    expect(screen.getByText("host/gpu0")).toBeInTheDocument();
    // Actions(대상 Model 의 verb — 재기동)
    expect(screen.getByRole("button", { name: /모델 재기동/ })).toBeInTheDocument();
  });
});

describe("ObjectView — in-place traverse + breadcrumb", () => {
  it("이웃 클릭 → 같은 패널에서 이동 + breadcrumb push, back → pop", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("host/gpu0")).toBeInTheDocument());

    // gpu 이웃 클릭 → gpu:g1 로 traverse.
    fireEvent.click(screen.getByRole("button", { name: /host\/gpu0/ }));
    await waitFor(() => expect(screen.getByText("GPU · rev 1")).toBeInTheDocument());
    // breadcrumb 에 이전(Foo 7B) + 현재(host/gpu0) 존재 + 뒤로 버튼.
    expect(screen.getByRole("button", { name: /이전 객체로/ })).toBeInTheDocument();

    // back → model:foo 로 복귀.
    fireEvent.click(screen.getByRole("button", { name: /이전 객체로/ }));
    await waitFor(() => expect(screen.getByText("모델 · rev 2")).toBeInTheDocument());
  });

  it("retry/deterministic: 같은 objectId 재렌더 시 동일 관계 그룹", async () => {
    const { unmount } = renderView();
    await waitFor(() => expect(screen.getByText("실행 GPU")).toBeInTheDocument());
    unmount();
    renderView();
    await waitFor(() => expect(screen.getByText("실행 GPU")).toBeInTheDocument());
  });
});

describe("ObjectView — Action 게이팅(observe/manage)", () => {
  it("observe(can=false) → Action 버튼 disabled + 기계판독 사유", async () => {
    mockCan = (c) => c !== "models.write";
    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: /모델 재기동/ })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /모델 재기동/ })).toBeDisabled();
    // Model 대상 verb 가 여러 개(restartModel/scaleReplicas) → 사유도 여러 개.
    expect(screen.getAllByText(/models\.write 권한이 없습니다/).length).toBeGreaterThan(0);
  });

  it("manage(can=true) → Action 버튼 enabled", async () => {
    mockCan = () => true;
    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: /모델 재기동/ })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /모델 재기동/ })).not.toBeDisabled();
  });
});

describe("ObjectView — 시각 언어(IMP-64: 타입 칩·상태 밴드·방향 지시자)", () => {
  it("header 에 타입 칩(글리프+색 className)을 대상 타입으로 렌더한다", async () => {
    renderView(); // model:foo → Model
    await waitFor(() => expect(screen.getByText("Foo 7B")).toBeInTheDocument());
    const chip = document.querySelector(".otype-chip");
    expect(chip).not.toBeNull();
    expect(chip?.classList.contains("otype-model")).toBe(true);
    // 타입 색 CSS 변수가 인라인으로 주입됐다(무채색 아님).
    expect((chip as HTMLElement).style.getPropertyValue("--otype-color")).toContain("--primary");
  });

  it("상태 밴드: crit 객체 → header Gauge fill = var(--red)(위험)", async () => {
    renderView("incident:i1"); // status crit
    await waitFor(() => expect(screen.getByText("지연 급증")).toBeInTheDocument());
    const gauge = document.querySelector(".ov-header-card .gauge-fill");
    expect(gauge?.getAttribute("fill")).toBe("var(--red)");
  });

  it("상태 밴드: warn 객체 → header Gauge fill = var(--amber)(주의)", async () => {
    renderView("gpu:g1"); // status warn
    await waitFor(() => expect(screen.getByText("host/gpu0")).toBeInTheDocument());
    const gauge = document.querySelector(".ov-header-card .gauge-fill");
    expect(gauge?.getAttribute("fill")).toBe("var(--amber)");
  });

  it("상태 밴드: ok 객체 → header Gauge fill = var(--primary)(정상)", async () => {
    renderView(); // model:foo ok
    await waitFor(() => expect(screen.getByText("Foo 7B")).toBeInTheDocument());
    const gauge = document.querySelector(".ov-header-card .gauge-fill");
    expect(gauge?.getAttribute("fill")).toBe("var(--primary)");
  });

  it("관계 그룹마다 방향 지시자(의미 화살표)를 렌더한다", async () => {
    renderView(); // serves(↑)/runsOn(⇊)/affects(⇢)
    await waitFor(() => expect(screen.getByText("실행 GPU")).toBeInTheDocument());
    const dirs = Array.from(document.querySelectorAll(".ov-link-arrow")).map((n) => n.textContent);
    expect(dirs.length).toBeGreaterThanOrEqual(3);
    expect(dirs).toContain("⇊"); // runsOn(하류)
    expect(dirs).toContain("↑"); // serves(상류)
    expect(dirs).toContain("⇢"); // affects(영향)
  });

  it("이웃 글리프 색이 이웃 타입 색으로 주입된다(무채색 아님)", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("host/gpu0")).toBeInTheDocument());
    // GPU 이웃 글리프 → otype-gpu className
    const gpuGlyph = document.querySelector(".ov-neighbor-glyph.otype-gpu");
    expect(gpuGlyph).not.toBeNull();
  });
});

describe("ObjectView — deep-link / 미존재 id", () => {
  it("deep-link: objectId 로 마운트 시 해당 객체 복원", async () => {
    renderView("gpu:g1");
    await waitFor(() => expect(screen.getByText("host/gpu0")).toBeInTheDocument());
    expect(screen.getByText("GPU · rev 1")).toBeInTheDocument();
  });

  it("failure: 알 수 없는 id → '객체를 찾을 수 없음' 빈 상태(throw 안 함)", async () => {
    renderView("model:nope");
    await waitFor(() => expect(screen.getByText(/객체를 찾을 수 없습니다/)).toBeInTheDocument());
  });

  it("objectId=null → 렌더 안 함(패널 닫힘)", () => {
    const { container } = renderView(null);
    expect(container.querySelector("dialog")).toBeNull();
  });
});
