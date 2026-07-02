// IMP-72 — Kinetic 알림 스트립 컴포넌트 테스트.
// client.fetchKineticAlerts 와 useCap 을 모킹해 4-슬롯 렌더·3단 사다리·게이팅·딥링크를 검증한다.
// 케이스: 4 슬롯 존재 / confidence 배지 / 조사→/agent prefill / observe 실행 rung 만 비활성(조사·ack 활성)
//         / 실행 rung 은 ActionForm confirm(type-to-confirm) 경유 / 알림 0건 → 미렌더.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import KineticStrip from "./KineticStrip";
import { ToastProvider } from "../toast";
import * as client from "../api/client";
import type { KineticAlert, KineticAlertList } from "../api/types";

// useCap — 프로파일 게이팅. mockCan 을 테스트마다 바꿔 observe/manage 를 흉내.
let mockCan: (c: string) => boolean = () => true;
vi.mock("../capabilities", () => ({
  useCap: () => ({ can: (c: string) => mockCan(c), caps: { profile: "manage", readonly: false, capabilities: {}, data_source: "mock", integrations: {} } }),
}));

// 컨트롤 픽스처 — crit GPU(신호 3 → high, drainGpu) + warn Model(신호 1 → med, scaleReplicas).
const ALERTS: KineticAlert[] = [
  {
    objectId: "gpu:g1", title: "GPU 1", objectType: "GpuDevice", status: "crit",
    signals: [
      { kind: "firstAnomaly", label: "최초 이상 관측", detail: "가장 이른 이상 — 12분 전", observedAt: "12분 전", citation: "gpu:g1" },
      { kind: "throttle", label: "클럭 스로틀(하드웨어)", detail: "throttle 사유: 열(HW Thermal Slowdown)", observedAt: "12분 전", citation: "gpu:g1" },
      { kind: "saturation", label: "GPU 포화", detail: "사용률 97% ≥ 임계 90%", observedAt: "12분 전", citation: "gpu:g1" },
    ],
    confidence: "high",
    probableCause: "GPU 1에서 가장 이른 이상이 12분 전 관측됨. GPU 하드웨어/포화가 상류 지연을 유발하는 것으로 추정됩니다(신호 3건).",
    hypothesis: "GPU 1(gpu:g1)의 이상 근본원인을 관계 그래프로 확인해줘",
    suggestedAction: { actionType: "drainGpu", target: "gpu:g1" },
    breachCount: 2,
  },
  {
    objectId: "model:m", title: "모델 M", objectType: "Model", status: "warn",
    signals: [
      { kind: "alertrule", label: "TTFT p95 급증", detail: "820ms > 임계 800ms (baseline 300ms 대비 ×2.7)", observedAt: "최근 5분", citation: "rule_a1b2 · model:m" },
    ],
    confidence: "med",
    probableCause: "모델 M에서 이상이 관측됨(신호 1건).",
    hypothesis: "모델 M(model:m)의 이상 근본원인을 관계 그래프로 확인해줘",
    suggestedAction: { actionType: "scaleReplicas", target: "model:m" },
    breachCount: 1,
  },
];

function list(alerts: KineticAlert[]): KineticAlertList {
  return { generated_at: "t", alerts, source: "ontology detection (mock)" };
}

function renderStrip(props: Partial<Parameters<typeof KineticStrip>[0]> = {}) {
  return render(
    <ToastProvider>
      <KineticStrip intervalMs={0} {...props} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockCan = () => true;
  vi.spyOn(client, "fetchKineticAlerts").mockResolvedValue(list(ALERTS));
});
afterEach(() => cleanup());

describe("KineticStrip — 4-슬롯 카드 렌더", () => {
  it("영향 객체 chip + 근거(신호·인용) + 추정 원인 + 추천 조치 4-슬롯이 모두 렌더된다", async () => {
    renderStrip({ onNavigate: vi.fn() });
    await waitFor(() => expect(screen.getByRole("region", { name: "Kinetic 알림" })).toBeInTheDocument());
    // [1] 영향 객체
    expect(screen.getByText("GPU 1")).toBeInTheDocument();
    // [2] 근거 — 신호 라벨 + 인용(citation)
    expect(screen.getByText("클럭 스로틀(하드웨어)")).toBeInTheDocument();
    expect(screen.getAllByText(/gpu:g1/).length).toBeGreaterThan(0);
    // [3] 추정 원인 + 고정 카피
    expect(screen.getByText(/GPU 하드웨어\/포화가 상류 지연을 유발/)).toBeInTheDocument();
    expect(screen.getByText(/상관≠인과, 근거로 확인/)).toBeInTheDocument();
    // [4] 추천 조치 — 3단 사다리 rung(카드가 여럿이므로 getAll).
    expect(screen.getAllByRole("button", { name: /조사 열기/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /확인·배정/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GPU drain/).length).toBeGreaterThan(0);
  });

  it("confidence(신뢰도) 배지가 신호 수 기반으로 표시된다(high/med)", async () => {
    renderStrip({ onNavigate: vi.fn() });
    await waitFor(() => expect(screen.getByText("GPU 1")).toBeInTheDocument());
    expect(screen.getByText(/신뢰도 높음/)).toBeInTheDocument(); // GPU(high)
    expect(screen.getByText(/신뢰도 보통/)).toBeInTheDocument(); // Model(med)
  });

  it("지속 임계초과(breachCount>1)는 카운트 배지로 접힌다", async () => {
    renderStrip({ onNavigate: vi.fn() });
    await waitFor(() => expect(screen.getByText("GPU 1")).toBeInTheDocument());
    expect(screen.getByText(/지속 ×2/)).toBeInTheDocument();
  });
});

describe("KineticStrip — 3단 조치 사다리(조사/ack/실행)", () => {
  it("'조사 열기' → onNavigate('agent', {entity, intent}) 로 objectId + 가설을 pre-fill", async () => {
    const onNavigate = vi.fn();
    renderStrip({ onNavigate });
    await waitFor(() => expect(screen.getByText("GPU 1")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /조사 열기/ })[0]);
    expect(onNavigate).toHaveBeenCalledWith("agent", {
      entity: "gpu:g1",
      intent: "GPU 1(gpu:g1)의 이상 근본원인을 관계 그래프로 확인해줘",
    });
  });

  it("'확인·배정' → onNavigate('investigate', {entity}) 로 COP 진입점 지정", async () => {
    const onNavigate = vi.fn();
    renderStrip({ onNavigate });
    await waitFor(() => expect(screen.getByText("GPU 1")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /확인·배정/ })[0]);
    expect(onNavigate).toHaveBeenCalledWith("investigate", { entity: "gpu:g1" });
  });

  it("영향 객체 chip 클릭 → onOpenObject(objectId)", async () => {
    const onOpenObject = vi.fn();
    renderStrip({ onNavigate: vi.fn(), onOpenObject });
    await waitFor(() => expect(screen.getByText("GPU 1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /GPU 1/ }));
    expect(onOpenObject).toHaveBeenCalledWith("gpu:g1");
  });
});

describe("KineticStrip — 실행 rung 은 ActionForm confirm 경유(자동 mutation 없음)", () => {
  it("실행 rung 펼침 → ActionForm(destructive=type-to-confirm) — 즉시 실행 안 함", async () => {
    const spy = vi.spyOn(client, "submitAction");
    renderStrip({ onNavigate: vi.fn() });
    await waitFor(() => expect(screen.getByText("GPU 1")).toBeInTheDocument());
    // 실행 rung 펼침(GPU drain).
    fireEvent.click(screen.getByRole("button", { name: /GPU drain — 확인 후 실행/ }));
    // ActionForm 이 나타난다(파라미터 폼 + submit). 아직 submitAction 호출 없음.
    await waitFor(() => expect(screen.getByRole("form", { name: /GPU drain 실행/ })).toBeInTheDocument());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("KineticStrip — observe 프로파일 게이팅(실행만 비활성, 조사·ack 활성)", () => {
  beforeEach(() => {
    // observe — endpoints.write(=drainGpu requiredCap) 불가. 나머지 읽기 권한은 허용.
    mockCan = (c: string) => c !== "endpoints.write" && c !== "models.write";
  });

  it("실행 rung 이 '권한 없음' 으로 비활성되지만 조사/ack rung 은 활성", async () => {
    renderStrip({ onNavigate: vi.fn() });
    await waitFor(() => expect(screen.getByText("GPU 1")).toBeInTheDocument());
    // 실행 rung(확인 후 실행 버튼)이 사라지고 '권한 없음' 안내가 뜬다.
    expect(screen.queryByRole("button", { name: /GPU drain — 확인 후 실행/ })).toBeNull();
    expect(screen.getAllByText(/권한 없음/).length).toBeGreaterThan(0);
    // 조사/ack rung 은 여전히 활성(읽기전용에서도 가치).
    expect(screen.getAllByRole("button", { name: /조사 열기/ })[0]).toBeEnabled();
    expect(screen.getAllByRole("button", { name: /확인·배정/ })[0]).toBeEnabled();
  });
});

describe("KineticStrip — 빈 상태 / 실패", () => {
  it("알림 0건 → 스트립 자체가 렌더되지 않는다(관제 노이즈 억제)", async () => {
    vi.spyOn(client, "fetchKineticAlerts").mockResolvedValue(list([]));
    renderStrip({ onNavigate: vi.fn() });
    await waitFor(() => {
      // fetch 는 됐지만 알림이 없으므로 region 미표시.
      expect(screen.queryByRole("region", { name: "Kinetic 알림" })).toBeNull();
    });
  });

  it("fetch 실패 → 페이지를 죽이지 않고 조용히 미렌더", async () => {
    vi.spyOn(client, "fetchKineticAlerts").mockRejectedValue(new Error("API 503"));
    renderStrip({ onNavigate: vi.fn() });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Kinetic 알림" })).toBeNull());
  });
});

// IMP-77 — 신선도/폴링 규약 승격(IMP-51 재사용): intervalMs>0 이면 신선도 라벨+정지/재개, tick 재조회.
//  intervalMs=0(정적 사용, 기존 테스트 기본)이면 컨트롤 미렌더 + 폴링 없음(회귀 없음).
describe("KineticStrip — IMP-77 신선도·폴링 정합", () => {
  it("intervalMs=0 → 신선도/정지 컨트롤 미렌더 + 폴링 없음(초기 1회만)", async () => {
    const spy = vi.spyOn(client, "fetchKineticAlerts").mockResolvedValue(list(ALERTS));
    renderStrip({ onNavigate: vi.fn(), intervalMs: 0 });
    await waitFor(() => expect(screen.getByText("GPU 1")).toBeInTheDocument());
    expect(screen.queryByText(/자동/)).toBeNull(); // DataFreshness "자동 Ns" 없음
    expect(screen.queryByRole("button", { name: /일시정지|재개/ })).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("intervalMs>0 → 신선도 라벨 + 정지/재개 렌더 + interval tick 마다 재조회", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = vi.spyOn(client, "fetchKineticAlerts").mockResolvedValue(list(ALERTS));
    renderStrip({ onNavigate: vi.fn(), intervalMs: 1000 });
    await waitFor(() => expect(screen.getByText("GPU 1")).toBeInTheDocument());
    // 신선도 라벨("자동 1s") + 정지 토글.
    expect(screen.getByText(/자동/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /일시정지/ })).toBeInTheDocument();
    // interval tick → 재조회.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await act(async () => { vi.advanceTimersByTime(1000); });
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2));
    vi.useRealTimers();
  });

  it("정지 → interval tick 이 추가 호출하지 않음 / 재개 → 즉시 1회", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = vi.spyOn(client, "fetchKineticAlerts").mockResolvedValue(list(ALERTS));
    renderStrip({ onNavigate: vi.fn(), intervalMs: 1000 });
    await waitFor(() => expect(screen.getByText("GPU 1")).toBeInTheDocument());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: /일시정지/ })); // pause
    const atPause = spy.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(spy).toHaveBeenCalledTimes(atPause); // 정지 중 tick 무시

    fireEvent.click(screen.getByRole("button", { name: /재개/ })); // resume → 즉시 1회
    await waitFor(() => expect(spy.mock.calls.length).toBe(atPause + 1));
    vi.useRealTimers();
  });
});

// IMP-94 — backpressure Incident 카드가 큐 신호(큐 적체)를 4-슬롯에 렌더하는지.
describe("KineticStrip — backpressure 카드(IMP-94)", () => {
  const BP: KineticAlert = {
    objectId: "incident:inc_seed_q", title: "대기 큐 적체 — 스케줄러 backpressure",
    objectType: "Incident", status: "warn",
    signals: [
      { kind: "backpressure", label: "대기 큐 깊이 상승", detail: "대기 12건 (추이 0→2→4→7→9→12) — vllm:num_requests_waiting(mock)", observedAt: "3분 전", citation: "incident:inc_seed_q" },
      { kind: "backpressure", label: "유입 > 수용력", detail: "유입 28/s > 수용 16/s — 초과 12/s 적체(mock)", observedAt: "3분 전", citation: "incident:inc_seed_q" },
      { kind: "backpressure", label: "대기 p95 SLO 초과", detail: "대기 p95 3s > SLO 2s · TTFT 동반 상승(mock)", observedAt: "3분 전", citation: "incident:inc_seed_q" },
    ],
    confidence: "high",
    probableCause: "유입이 수용력·동시성 한도를 넘어 큐가 적체(유입>수용력·concurrency cap·대형 prefill 정황)하는 것으로 추정됩니다(신호 3건).",
    hypothesis: "대기 큐 적체(incident:inc_seed_q)의 이상 근본원인을 관계 그래프로 확인해줘",
    suggestedAction: { actionType: "ack", target: "incident:inc_seed_q" },
    breachCount: 2,
  };

  it("큐 적체 신호 라벨 + 큐깊이/대기 p95 근거가 렌더된다", async () => {
    vi.spyOn(client, "fetchKineticAlerts").mockResolvedValue(list([BP]));
    renderStrip({ onNavigate: vi.fn() });
    await waitFor(() => expect(screen.getByText("대기 큐 적체 — 스케줄러 backpressure")).toBeInTheDocument());
    // 신호 계열 라벨(큐 적체) — backpressure kind.
    expect(screen.getAllByText("큐 적체").length).toBeGreaterThan(0);
    // 큐 깊이 + 대기 p95 근거.
    expect(screen.getByText("대기 큐 깊이 상승")).toBeInTheDocument();
    expect(screen.getByText("대기 p95 SLO 초과")).toBeInTheDocument();
    // 추정 원인(슬롯3 probableCause) — 유입>수용력·concurrency cap·대형 prefill.
    expect(screen.getByText(/유입>수용력·concurrency cap·대형 prefill/)).toBeInTheDocument();
  });
});
