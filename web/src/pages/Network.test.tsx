import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import type { NetworkLink, NetworkPoint, NetworkReport } from "../api/types";

// <dialog>.showModal jsdom 미구현 shim(SlidePanel).
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
  }
});

function makeLink(id: string, from: string, to: string, overrides: Partial<NetworkPoint>): NetworkLink {
  const base: NetworkPoint = {
    ts: "2026-07-01T00:00:00Z",
    rx_mbps: 4000, tx_mbps: 3000,
    latency_p50_ms: 1.2, latency_p95_ms: 2.6, latency_p99_ms: 4.2,
    loss_perc: 0.0005, errs_per_s: 0.4,
  };
  const p0 = { ...base };
  const p1 = { ...base, ...overrides, ts: "2026-07-01T00:01:00Z" };
  return { id, from, to, status: "ok", capacity_mbps: 100000, points: [p0, p1] };
}

const fetchNetwork = vi.fn();
vi.mock("../api/client", () => ({ fetchNetwork: (...a: unknown[]) => fetchNetwork(...a) }));

// link-a: 정상, link-b: 위험(에러 급증), link-c: 주의(손실 warn 대역)
function report(): NetworkReport {
  return {
    generated_at: "2026-07-01T00:01:00Z",
    source: "network (mock)",
    links: [
      makeLink("link-a", "gpu-node-01", "spine-switch", {}), // ok
      makeLink("link-b", "gpu-node-02", "spine-switch", { errs_per_s: 40, loss_perc: 0.03 }), // crit (에러/손실 급증)
      makeLink("link-c", "gpu-node-03", "spine-switch", { loss_perc: 0.008 }), // warn (손실 0.8%)
    ],
  };
}

import NetworkPage from "./Network";

describe("Network 화면 (IMP-49 · 대역폭·p95 지연·손실·에러)", () => {
  const onNavigate = vi.fn();

  beforeEach(() => {
    fetchNetwork.mockReset();
    onNavigate.mockReset();
    fetchNetwork.mockResolvedValue(report());
  });

  it("[T1] 로딩 → 링크 카드 렌더 + mock 배지 표시", async () => {
    render(<NetworkPage onNavigate={onNavigate} />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "gpu-node-01 → spine-switch" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "gpu-node-02 → spine-switch" })).toBeInTheDocument();
    expect(screen.getByText("mock 데이터")).toBeInTheDocument();
    // network=인프라 층 배너.
    expect(screen.getByText(/인프라 층/)).toBeInTheDocument();
  });

  it("[T2] 'avg latency' KPI 는 p95 를 표시(worst p95)", async () => {
    render(<NetworkPage onNavigate={onNavigate} />);
    const kpiLabel = await screen.findByText("지연 (worst p95)");
    // KPI 카드 스코프 안에서 p95 값(2.6ms) — p50(1.2)·p99(4.2) 이 아니다.
    const kpiCard = kpiLabel.closest(".stat-mini") as HTMLElement;
    expect(within(kpiCard).getByText("2.6ms")).toBeInTheDocument();
    expect(within(kpiCard).getByText("p50/p95/p99 중 p95")).toBeInTheDocument();
  });

  it("[T3] error/retransmit 급증 링크가 상단 정렬", async () => {
    render(<NetworkPage onNavigate={onNavigate} />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "gpu-node-01 → spine-switch" })).toBeInTheDocument(),
    );
    const cards = document.querySelectorAll(".node-card h3");
    const order = Array.from(cards).map((el) => el.textContent);
    // link-b(에러/손실 crit) 먼저, link-c(warn) 다음, link-a(ok) 마지막.
    expect(order).toEqual([
      "gpu-node-02 → spine-switch",
      "gpu-node-03 → spine-switch",
      "gpu-node-01 → spine-switch",
    ]);
  });

  it("[T4] 링크 상세 → 'Traffic(앱층)으로 pivot' 클릭 시 onNavigate('traffic')", async () => {
    render(<NetworkPage onNavigate={onNavigate} />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "gpu-node-02 → spine-switch" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /gpu-node-02 → spine-switch 링크 상세/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/지연 \(Latency p50\/p95\/p99\)/)).toBeInTheDocument();
    const pivot = within(dialog).getByRole("button", { name: /앱층 트래픽/ });
    fireEvent.click(pivot);
    expect(onNavigate).toHaveBeenCalledWith("traffic");
  });

  it("[T5] 범위 셀렉터 변경 → fetchNetwork 가 새 range 로 재호출", async () => {
    render(<NetworkPage onNavigate={onNavigate} />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "gpu-node-01 → spine-switch" })).toBeInTheDocument(),
    );
    expect(fetchNetwork).toHaveBeenCalledWith("1h", expect.anything());
    fireEvent.change(screen.getByLabelText("시간 범위"), { target: { value: "24h" } });
    await waitFor(() => expect(fetchNetwork).toHaveBeenCalledWith("24h", expect.anything()));
  });

  it("[T6] 색-only 금지: 상태 텍스트(위험/주의/정상) 병기", async () => {
    render(<NetworkPage onNavigate={onNavigate} />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "gpu-node-01 → spine-switch" })).toBeInTheDocument(),
    );
    expect(screen.getAllByText("위험").length).toBeGreaterThan(0);
    expect(screen.getAllByText("주의").length).toBeGreaterThan(0);
    expect(screen.getAllByText("정상").length).toBeGreaterThan(0);
  });

  it("[T7a] 에러 → humanizeError 메시지(role=alert)", async () => {
    fetchNetwork.mockRejectedValue(new Error("Failed to fetch"));
    render(<NetworkPage onNavigate={onNavigate} />);
    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/서버에 연결할 수 없습니다/);
    });
  });

  it("[T7b] 빈(0 링크) → empty 안내", async () => {
    fetchNetwork.mockResolvedValue({ generated_at: "x", source: "network (mock)", links: [] });
    render(<NetworkPage onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText(/관측된 네트워크 링크가 없습니다/)).toBeInTheDocument());
  });
});
