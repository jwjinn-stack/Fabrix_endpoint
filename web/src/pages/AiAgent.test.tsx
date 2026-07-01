// IMP-60 — AI Agent 패널 테스트.
// client.runAgent 와 capabilities 를 모킹해 결정적으로 구동한다(백엔드 0개). 케이스:
//   normal(ReAct 타임라인 순서 + tool name/args/result) / RCA 카드 objectId 인용 / read tool 자동 실행 /
//   mutating 은 ActionForm confirm 필요 + capability 게이팅(observe → not invokable) /
//   grounding-empty → runbook fallback(hallucination 없음) / env-missing(reject).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import AiAgent from "./AiAgent";
import { ToastProvider } from "../toast";
import * as client from "../api/client";
import type { AgentRun, OntologyObject } from "../api/types";

// capabilities — 테스트별로 can() 을 갈아끼운다(observe 게이팅 검증). 기본 manage(전부 허용).
let mockCan = (_cap: string) => true;
vi.mock("../capabilities", () => ({
  useCap: () => ({ can: (c: string) => mockCan(c), caps: { profile: "manage", readonly: false, capabilities: {}, data_source: "mock", integrations: {} } }),
}));

// ObjectView(드로어)가 부르는 온톨로지 fetch 를 stub — 카드 클릭 시 canonical 해석.
const OBJ: OntologyObject = { id: "gpu:g", type: "GpuDevice", title: "GPU 0", props: { util_perc: 0.96 }, status: "crit", revision: 1 };

// grounded AgentRun 픽스처 — ReAct 타임라인(reasoning→tool→…) + GpuDevice 후보(suggestedAction=drainGpu).
function groundedRun(): AgentRun {
  return {
    traceId: "agtr_test_1",
    intent: "가장 아픈 엔드포인트 원인 찾아줘",
    steps: [
      { kind: "reasoning", text: "접지 대상을 찾는다" },
      { kind: "tool", call: { tool: "getIncidents", args: {} }, result: { objectIds: ["incident:i1"], summary: "인시던트 1건", found: true } },
      { kind: "reasoning", text: "그래프를 따라간다" },
      { kind: "tool", call: { tool: "queryObjects", args: { type: "Endpoint" } }, result: { objectIds: ["endpoint:e-slow"], summary: "엔드포인트 1건", found: true } },
      { kind: "tool", call: { tool: "traverseLinks", args: { objectId: "endpoint:e-slow" } }, result: { objectIds: ["model:m", "gpu:g"], summary: "이웃 2건", found: true } },
    ],
    candidates: [
      { objectId: "gpu:g", title: "GPU 0", objectType: "GpuDevice", confidence: 0.9, claim: "추정 근본원인: GPU 0 포화", citations: ["gpu:g", "trace:tr_1"], suggestedAction: { actionType: "drainGpu", target: "gpu:g" } },
    ],
    grounded: true,
    audit: [{ traceId: "agtr_test_1", kind: "prompt", detail: "intent: x", ts: "t" }],
    generated_at: "2026-07-01T00:00:00Z",
    source: "agent (mock)",
  };
}

// grounding 없음 픽스처 — 후보 없음 + 정적 runbook.
function emptyRun(): AgentRun {
  return {
    traceId: "agtr_empty",
    intent: "원인 찾아줘",
    steps: [
      { kind: "reasoning", text: "접지 대상을 찾는다" },
      { kind: "tool", call: { tool: "getIncidents", args: {} }, result: { objectIds: [], summary: "인시던트 없음", found: false } },
      { kind: "reasoning", text: "접지 실패 — 지어내지 않고 runbook 안내" },
    ],
    candidates: [],
    grounded: false,
    fallbackRunbook: ["접지할 대상을 찾지 못했습니다.", "연동 상태를 확인하세요."],
    audit: [],
    generated_at: "t",
    source: "agent (mock)",
  };
}

function renderPage(nav = vi.fn()) {
  return render(
    <ToastProvider>
      <AiAgent onNavigate={nav} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockCan = () => true;
  window.history.replaceState(null, "", "/agent");
  // 기본: grounded run. ObjectView fetch stub.
  vi.spyOn(client, "runAgent").mockResolvedValue(groundedRun());
  vi.spyOn(client, "fetchOntologyObject").mockResolvedValue(OBJ);
  vi.spyOn(client, "fetchOntologyLinks").mockResolvedValue({ generated_at: "t", object_id: "gpu:g", links: [], source: "mock" });
  vi.spyOn(client, "fetchOntologyObjects").mockResolvedValue({ generated_at: "t", objects: [OBJ], source: "mock" });
  vi.spyOn(client, "submitAction").mockResolvedValue({
    outcome: "ok",
    object: { ...OBJ, status: "warn", revision: 2 },
    audit: { actionType: "drainGpu", target: "gpu:g", params: {}, actor: "operator", ts: "t", outcome: "ok" },
  });
});
afterEach(() => cleanup());

describe("AiAgent — normal(ReAct 타임라인)", () => {
  it("read tool 이 자동 실행되어(사용자 개입 없이) 타임라인이 순서대로 렌더된다", async () => {
    renderPage();
    // 자동 실행 — 마운트만으로 runAgent 가 불리고 타임라인이 채워진다.
    await waitFor(() => expect(client.runAgent).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("추론 타임라인 (ReAct)")).toBeInTheDocument());
    // reasoning + tool 스텝이 모두 렌더(생각/도구 배지).
    expect(screen.getAllByText("생각").length).toBeGreaterThan(0);
    expect(screen.getAllByText("도구").length).toBeGreaterThan(0);
    // tool name(라벨) + args 노출.
    expect(screen.getByText("인시던트 조회")).toBeInTheDocument();
    expect(screen.getByText("객체 조회")).toBeInTheDocument();
    expect(screen.getByText("관계 추적")).toBeInTheDocument();
    // args(JSON) 노출.
    expect(screen.getByText(/"type":"Endpoint"/)).toBeInTheDocument();
    // read tool 은 '자동' 배지.
    expect(screen.getAllByText("자동").length).toBeGreaterThan(0);
  });

  it("타임라인이 실제 순서(reasoning→getIncidents→reasoning→queryObjects→traverseLinks)로 나온다", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText("객체 조회")).toBeInTheDocument());
    const items = Array.from(container.querySelectorAll(".agent-steps > li"));
    expect(items.length).toBe(5);
    expect(items[0].className).toContain("agent-step-reason");
    expect(items[1].textContent).toContain("인시던트 조회");
    expect(items[3].textContent).toContain("객체 조회");
    expect(items[4].textContent).toContain("관계 추적");
  });

  it("RCA 후보 카드가 objectId 를 인용(citation)한다", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/추정 근본원인: GPU 0 포화/)).toBeInTheDocument());
    // 근거 칩에 objectId/trace id.
    expect(screen.getAllByText("gpu:g").length).toBeGreaterThan(0);
    expect(screen.getByText("trace:tr_1")).toBeInTheDocument();
    // 신뢰도 배지.
    expect(screen.getByText(/90% 신뢰/)).toBeInTheDocument();
  });
});

describe("AiAgent — mutating 은 ActionForm confirm + capability 게이팅(two-tier)", () => {
  it("카드에 권장 조치는 접혀 있고, 펼치기 전엔 ActionForm(제출 버튼)이 없다", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/권장 조치: GPU drain/)).toBeInTheDocument());
    // ActionForm 이 아직 렌더 안 됨(제출 버튼 없음).
    expect(screen.queryByRole("button", { name: /GPU drain$/ })).not.toBeInTheDocument();
  });

  it("펼치면 ActionForm 이 나오고, manage 에서는 submit 가능(confirm 클릭으로만 mutate)", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/권장 조치: GPU drain/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /권장 조치: GPU drain/ }));
    // ActionForm 등장(graceSec 파라미터 필드 + 실행 버튼). 아직 submitAction 은 호출되지 않음(자동 실행 아님).
    await waitFor(() => expect(screen.getByLabelText(/graceSec/i)).toBeInTheDocument());
    expect(client.submitAction).not.toHaveBeenCalled();
    // 사용자가 파라미터 입력 후 명시적 제출 → drainGpu 는 destructive(IMP-65)이므로 confirm 다이얼로그가 열린다.
    fireEvent.change(screen.getByLabelText(/graceSec/i), { target: { value: "30" } });
    fireEvent.submit(screen.getByRole("form", { name: /GPU drain 실행/ }));
    expect(client.submitAction).not.toHaveBeenCalled(); // confirm 전엔 아직 실행 안 함.
    // type-to-confirm(대상 id) 입력 후 danger 확인 버튼 → 그제서야 submitAction.
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/대상 id 확인 입력/), { target: { value: "gpu:g" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /GPU drain/ }));
    await waitFor(() => expect(client.submitAction).toHaveBeenCalledWith("drainGpu", expect.objectContaining({ target: "gpu:g" })));
  });

  it("observe(endpoints.write off): ActionForm 제출 비활성 + 사유 — mutation not invokable", async () => {
    mockCan = (c) => c !== "endpoints.write"; // drainGpu.requiredCap = endpoints.write
    renderPage();
    await waitFor(() => expect(screen.getByText(/권장 조치: GPU drain/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /권장 조치: GPU drain/ }));
    await waitFor(() => expect(screen.getByText(/endpoints\.write 권한이 없습니다/)).toBeInTheDocument());
    // 실행 버튼 disabled.
    const submit = screen.getByRole("button", { name: /GPU drain/ });
    expect(submit).toBeDisabled();
  });
});

describe("AiAgent — grounding-empty → runbook fallback(hallucination 금지)", () => {
  it("grounded=false 면 정적 runbook + 'grounding 없음' 배지, RCA 카드 없음", async () => {
    vi.spyOn(client, "runAgent").mockResolvedValue(emptyRun());
    renderPage();
    await waitFor(() => expect(screen.getByText(/접지할 대상을 찾지 못했습니다/)).toBeInTheDocument());
    expect(screen.getByText(/연동 상태를 확인하세요/)).toBeInTheDocument();
    // 'grounding 없음' 배지(타임라인 헤더 + fallback).
    expect(screen.getAllByText(/grounding 없음/).length).toBeGreaterThan(0);
    // 후보 카드(신뢰 배지)는 없다.
    expect(screen.queryByText(/신뢰/)).not.toBeInTheDocument();
  });
});

describe("AiAgent — 상호작용 / env-missing", () => {
  it("카드 제목 클릭 → ObjectView 드로어(속성 섹션)", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/GPU 0 포화/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /GPU 0/ }));
    await waitFor(() => {
      const dlg = document.querySelector("dialog");
      expect(dlg).not.toBeNull();
    });
    await waitFor(() => expect(screen.getByText("속성")).toBeInTheDocument());
  });

  it("intent 재제출 → runAgent 가 새 의도로 다시 호출된다", async () => {
    const spy = vi.spyOn(client, "runAgent").mockResolvedValue(groundedRun());
    renderPage();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const input = screen.getByLabelText("분석 의도 입력");
    fireEvent.change(input, { target: { value: "GPU 포화 원인" } });
    fireEvent.click(screen.getByRole("button", { name: "분석 실행" }));
    // 마지막 호출의 첫 인자(req)에 새 intent 가 담겼는지(2번째 인자 signal 유무는 무관).
    await waitFor(() => {
      const last = spy.mock.calls[spy.mock.calls.length - 1];
      expect(last[0]).toMatchObject({ intent: "GPU 포화 원인" });
    });
  });

  it("env-missing: runAgent reject → 에러 상태(페이지 죽지 않음)", async () => {
    vi.spyOn(client, "runAgent").mockRejectedValue(new Error("API 503"));
    renderPage();
    await waitFor(() => expect(screen.getByText(/에이전트 실행에 실패했습니다/)).toBeInTheDocument());
  });
});
