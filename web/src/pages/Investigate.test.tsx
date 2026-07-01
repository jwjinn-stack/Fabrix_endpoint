// IMP-58 — Troubleshooting COP 화면 테스트.
// client 온톨로지 fetch 를 모킹해 결정적으로 구동한다(백엔드 0개). capabilities 는 manage 로 주입.
// 케이스: normal(진입+자동확장 경로+골든시그널) / 임계 hop 라벨 / blast-radius / hop 클릭→드로어(ObjectView)
//         / ?entity= deep-link 복원 / 미지 entity graceful / env-missing(fetch reject).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within, act } from "@testing-library/react";
import Investigate from "./Investigate";
import { ToastProvider } from "../toast";
import * as client from "../api/client";
import type { OntologyObject, OntologyLink, OntologyObjectList, OntologyLinkList } from "../api/types";

// capabilities — ObjectView(Action 게이팅)가 소비. manage(전부 허용).
vi.mock("../capabilities", () => ({
  useCap: () => ({ can: () => true, caps: { profile: "manage", readonly: false, capabilities: {}, data_source: "mock", integrations: {} } }),
}));

// 척추 픽스처: endpoint:e-slow --serves--> model:m --runsOn--> gpu:g --hostedBy--> node:n (+ 다른 서비스).
const OBJS: Record<string, OntologyObject> = {
  "endpoint:e-slow": { id: "endpoint:e-slow", type: "Endpoint", title: "느린 엔드포인트", props: { ready: false, namespace: "prod" }, status: "crit", revision: 1 },
  "endpoint:e-ok": { id: "endpoint:e-ok", type: "Endpoint", title: "정상 엔드포인트", props: { ready: true }, status: "ok", revision: 1 },
  "model:m": { id: "model:m", type: "Model", title: "모델 M", props: { replicas: 2, provider: "acme" }, status: "warn", revision: 1 },
  "gpu:g": { id: "gpu:g", type: "GpuDevice", title: "GPU 디바이스 0", props: { util_perc: 0.95 }, status: "crit", revision: 1 },
  "node:n": { id: "node:n", type: "Node", title: "노드 N", props: { cpu_util: 0.8 }, status: "warn", revision: 1 },
  "service:other": { id: "service:other", type: "Service", title: "다른 서비스", props: { qps: 12, error_rate: 0.03 }, status: "warn", revision: 1 },
};
const LINKS: OntologyLink[] = [
  { from: "endpoint:e-slow", to: "model:m", linkKind: "serves" },
  { from: "model:m", to: "gpu:g", linkKind: "runsOn" },
  { from: "gpu:g", to: "node:n", linkKind: "hostedBy" },
  { from: "service:other", to: "node:n", linkKind: "hostedBy" },
];

function objList(): OntologyObjectList {
  return { generated_at: "t", objects: Object.values(OBJS), source: "ontology (mock)" };
}
function linkListFor(id: string): OntologyLinkList {
  return { generated_at: "t", object_id: id, links: LINKS.filter((l) => l.from === id || l.to === id), source: "ontology (mock)" };
}

function stubClient() {
  vi.spyOn(client, "fetchOntologyObjects").mockResolvedValue(objList());
  vi.spyOn(client, "fetchOntologyLinks").mockImplementation((id: string) => {
    if (!OBJS[id]) return Promise.reject(new Error("API 404"));
    return Promise.resolve(linkListFor(id));
  });
  // ObjectView 가 드로어에서 canonical 을 다시 부른다.
  vi.spyOn(client, "fetchOntologyObject").mockImplementation((id: string) => {
    const o = OBJS[id];
    return o ? Promise.resolve(o) : Promise.reject(new Error("API 404"));
  });
}

function renderPage() {
  return render(
    <ToastProvider>
      <Investigate />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  // 각 테스트 독립 — URL 초기화(deep-link 오염 방지).
  window.history.replaceState(null, "", "/investigate");
  stubClient();
});
afterEach(() => cleanup());

describe("Investigate — normal(진입 + 자동확장 경로)", () => {
  it("진입 후보(느린 EP)와 자동확장 hop 경로(모델/GPU/노드)를 렌더한다", async () => {
    renderPage();
    // LEFT — 진입 후보(느린 엔드포인트)가 후보 리스트에 등장.
    await waitFor(() => expect(screen.getByText("진입 대상")).toBeInTheDocument());
    // CENTER — 경로 헤더 + hop 들(척추). 기본 진입 = 가장 아픈 후보(느린 엔드포인트).
    await waitFor(() => expect(screen.getByText("모델 M")).toBeInTheDocument());
    expect(screen.getByText("GPU 디바이스 0")).toBeInTheDocument();
    expect(screen.getByText("노드 N")).toBeInTheDocument();
    // edge-type badge(serves/runsOn/hostedBy) 노출. hostedBy 는 척추+blast-radius 로 2회 나올 수 있어 getAll.
    expect(screen.getByText("serves")).toBeInTheDocument();
    expect(screen.getByText("runsOn")).toBeInTheDocument();
    expect(screen.getAllByText("hostedBy").length).toBeGreaterThan(0);
  });

  it("hop 카드가 골든시그널(Gauge+Sparkline)을 표시한다", async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText("모델 M")).toBeInTheDocument());
    // Gauge(role=img) + Sparkline(svg.sparkline) 최소 1개 이상.
    expect(container.querySelectorAll("svg.gauge").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("svg.sparkline").length).toBeGreaterThan(0);
    // 골든시그널 라벨(지연/사용률 등) 존재.
    expect(screen.getAllByText(/지연|사용률|오류/).length).toBeGreaterThan(0);
  });

  it("[b] 임계 hop 이 '추정 근본원인' 으로 라벨된다", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("추정 근본원인")).toBeInTheDocument());
  });

  it("[c] blast-radius hop(영향 확산)이 존재한다", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/영향 확산/)).toBeInTheDocument());
    // 같은 노드의 다른 서비스가 경로에 붙는다.
    expect(screen.getByText("다른 서비스")).toBeInTheDocument();
  });

  it("[a] 시간축 — 각 hop 에 '첫 이상' 라벨이 붙는다", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("모델 M")).toBeInTheDocument());
    expect(screen.getAllByText(/첫 이상/).length).toBeGreaterThan(0);
  });
});

describe("Investigate — hop 클릭 → KPI 드로어(ObjectView)", () => {
  it("hop 클릭 시 ObjectView 드로어가 열리고 해당 객체 상세를 보여준다", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("모델 M")).toBeInTheDocument());
    // model hop 카드 클릭.
    fireEvent.click(screen.getByRole("button", { name: /모델 M/ }));
    // ObjectView(SlidePanel=dialog) 가 열리고 속성/관계 섹션 등장.
    await waitFor(() => {
      const dlg = document.querySelector("dialog");
      expect(dlg).not.toBeNull();
    });
    // 드로어 안에 '속성' 섹션(ObjectView) 표시.
    await waitFor(() => expect(screen.getByText("속성")).toBeInTheDocument());
  });
});

describe("Investigate — deep-link / 미지 entity / env-missing", () => {
  it("?entity= deep-link 로 진입 대상을 복원한다", async () => {
    window.history.replaceState(null, "", "/investigate?entity=endpoint%3Ae-ok");
    renderPage();
    // 진입 후보 리스트(LEFT aside)에서 URL 로 지정한 정상 EP 후보가 active(복원).
    const aside = await screen.findByRole("complementary", { name: "진입 대상" });
    await waitFor(() => {
      const cand = within(aside).getByRole("button", { name: /정상 엔드포인트/ });
      expect(cand.getAttribute("aria-current")).toBe("true");
    });
    // 느린 EP(기본 진입)가 아니라 정상 EP 로 진입 → 느린 EP 후보는 active 아님.
    const slow = within(aside).getByRole("button", { name: /느린 엔드포인트/ });
    expect(slow.getAttribute("aria-current")).toBeNull();
  });

  it("미지 entity → graceful 빈 경로 안내(throw 없음)", async () => {
    window.history.replaceState(null, "", "/investigate?entity=endpoint%3Anope");
    renderPage();
    await waitFor(() => expect(screen.getByText(/대상을 찾을 수 없습니다/)).toBeInTheDocument());
  });

  it("env-missing: 온톨로지 fetch reject → 에러 상태(페이지 죽지 않음)", async () => {
    vi.spyOn(client, "fetchOntologyObjects").mockRejectedValue(new Error("API 503"));
    renderPage();
    await waitFor(() => expect(screen.getByText(/온톨로지 그래프를 불러오지 못했습니다/)).toBeInTheDocument());
  });
});

describe("Investigate — 진입 전환", () => {
  it("다른 후보 클릭 시 경로가 그 대상 기준으로 다시 그려진다", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("모델 M")).toBeInTheDocument());
    // 진입 후보 리스트(LEFT aside)에서 정상 엔드포인트 후보로 전환.
    const aside = screen.getByRole("complementary", { name: "진입 대상" });
    fireEvent.click(within(aside).getByRole("button", { name: /정상 엔드포인트/ }));
    // 진입 후보 active 가 전환됨.
    await waitFor(() => {
      const cand = within(aside).getByRole("button", { name: /정상 엔드포인트/ });
      expect(cand.getAttribute("aria-current")).toBe("true");
    });
  });
});

// IMP-61 — 내장 데모 시나리오 재생(UI 어포던스). seeded fixture 라 fetch 결과와 무관하게 즉시 렌더.
describe("Investigate — 데모 시나리오 재생(IMP-61)", () => {
  it("토글을 켜면 데모 컨트롤 바 + 순서 있는 단계 목록이 나타난다", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("진입 대상")).toBeInTheDocument());
    // 데모 토글(page-head) 클릭.
    fireEvent.click(screen.getByRole("button", { name: /데모 시나리오 재생/ }));
    // 데모 컨트롤 바(region) + 단계 목록(aside "데모 단계").
    await waitFor(() => expect(screen.getByRole("region", { name: "데모 시나리오 컨트롤" })).toBeInTheDocument());
    expect(screen.getByRole("complementary", { name: "데모 단계" })).toBeInTheDocument();
    // 데모 fixture 의 hop(포화 GPU / 핫 노드)이 경로에 렌더된다(제목·narration 등 여러 곳에 등장).
    expect(screen.getAllByText(/demo-node-a/).length).toBeGreaterThan(0);
  });

  it("?demo=1 deep-link 로 바로 데모 모드로 진입한다", async () => {
    window.history.replaceState(null, "", "/investigate?demo=1");
    renderPage();
    await waitFor(() => expect(screen.getByRole("region", { name: "데모 시나리오 컨트롤" })).toBeInTheDocument());
    // 진행 표시 — 단계 1/N.
    expect(screen.getByText(/단계 1\//)).toBeInTheDocument();
  });

  it("다음 단계로 이동하면 진행 표시가 갱신되고 최종 단계에서 cordon+scale 권장이 노출된다", async () => {
    window.history.replaceState(null, "", "/investigate?demo=1");
    const { container } = renderPage();
    const region = await screen.findByRole("region", { name: "데모 시나리오 컨트롤" });
    expect(within(region).getByText(/단계 1\//)).toBeInTheDocument();
    // "다음 →" 을 여러 번 눌러 핫 노드(cordon 권장) 단계까지 이동(Endpoint→Model→GPU→Node = index 3).
    const nextBtn = within(region).getByRole("button", { name: "다음 단계" });
    for (let i = 0; i < 3; i++) fireEvent.click(nextBtn);
    // 진행 표시가 4단계로 갱신됨.
    await waitFor(() => expect(within(region).getByText(/단계 4\//)).toBeInTheDocument());
    // 현재 hop 카드(.cop-demo-action)에 권장 조치(cordon)가 노출.
    await waitFor(() => {
      const action = container.querySelector(".cop-demo-action");
      expect(action?.textContent).toMatch(/노드 cordon/);
    });
    // 좌측 단계 목록에 cordon/scale 권장 라벨이 모두 존재(시나리오가 두 조치를 담음).
    expect(screen.getByText(/권장: 노드 cordon/)).toBeInTheDocument();
    expect(screen.getByText(/권장: 레플리카 조정/)).toBeInTheDocument();
  });

  it("데모를 끄면 일반 진입 대상 목록으로 복귀한다", async () => {
    window.history.replaceState(null, "", "/investigate?demo=1");
    renderPage();
    await waitFor(() => expect(screen.getByRole("complementary", { name: "데모 단계" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /데모 종료/ }));
    // 일반 모드 — 진입 대상 aside 복귀, 데모 컨트롤 바 사라짐.
    await waitFor(() => expect(screen.getByRole("complementary", { name: "진입 대상" })).toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "데모 시나리오 컨트롤" })).toBeNull();
  });
});

// IMP-77 — COP 신선도·폴링 정합(IMP-51 규약 승격): 신선도 라벨 + 정지/재개 + stale 유지, 데모는 제외.
describe("Investigate — IMP-77 신선도·폴링 정합", () => {
  beforeEach(() => {
    // KineticStrip(내부)도 폴링하므로 fetchOntologyObjects 카운트 오염 방지 — 빈 알림으로 스텁.
    vi.spyOn(client, "fetchKineticAlerts").mockResolvedValue({ generated_at: "t", alerts: [], source: "mock" });
  });

  it("신선도 라벨('자동 15s')과 정지/재개 토글을 렌더한다", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("모델 M")).toBeInTheDocument());
    expect(screen.getByText(/자동 15s/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /일시정지/ })).toBeInTheDocument();
  });

  it("정지 → interval tick 이 fetchOntologyObjects 를 추가 호출하지 않음 / 재개 → 즉시 1회", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = vi.spyOn(client, "fetchOntologyObjects").mockResolvedValue(objList());
    renderPage();
    await waitFor(() => expect(screen.getByText("모델 M")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /일시정지/ })); // pause
    await waitFor(() => expect(screen.getByRole("button", { name: /재개/ })).toBeInTheDocument());
    const atPause = spy.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(spy.mock.calls.length).toBe(atPause); // 정지 중 tick 무시
    fireEvent.click(screen.getByRole("button", { name: /재개/ })); // resume → 즉시 1회
    await waitFor(() => expect(spy.mock.calls.length).toBe(atPause + 1));
    vi.useRealTimers();
  });

  it("fetch 실패(성공 후) → 마지막 경로 유지 + stale 배지", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = vi.spyOn(client, "fetchOntologyObjects");
    spy.mockResolvedValueOnce(objList()).mockRejectedValue(new Error("Failed to fetch"));
    renderPage();
    await waitFor(() => expect(screen.getByText("모델 M")).toBeInTheDocument());
    await act(async () => { vi.advanceTimersByTime(15_000); });
    // 에러 배너 + stale 배지 노출. 마지막 성공 경로(모델 M)는 그대로 유지.
    await waitFor(() => expect(screen.getByText(/마지막으로 받은 데이터를 표시 중입니다/)).toBeInTheDocument());
    expect(screen.getByText("모델 M")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("데모 모드에서는 정지/재개 토글이 뜨지 않는다(seeded fixture)", async () => {
    window.history.replaceState(null, "", "/investigate?demo=1");
    renderPage();
    await waitFor(() => expect(screen.getByRole("complementary", { name: "데모 단계" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /일시정지|재개/ })).toBeNull();
  });
});
