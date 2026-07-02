import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../toast";

// client 모듈 모킹 — Diagnostics 가 부르는 fetchDiagnostics/mcpList* 를 제어한다.
vi.mock("../api/client", () => ({
  fetchDiagnostics: vi.fn().mockResolvedValue({ summary: { total: 0, configured: 0, reachable: 0, degraded: 0 }, checks: [], network: undefined }),
  probeOne: vi.fn(),
  mcpListTools: vi.fn().mockResolvedValue([
    { name: "list_dimensions", description: "차원 카탈로그" },
    { name: "groupby_metric", description: "차원 분해" },
    { name: "top_outliers", description: "이상치" },
    { name: "summarize_endpoint_health", description: "건강도 요약" },
  ]),
  mcpListResources: vi.fn().mockResolvedValue([
    { uri: "fabrix://metric-catalog", name: "메트릭 카탈로그" },
  ]),
}));

// capabilities — can() 을 테스트별로 바꿔 cap-off 경로를 검증한다.
const canMock = vi.fn((_cap: string) => true);
vi.mock("../capabilities", () => ({
  useCap: () => ({ caps: { profile: "manage", readonly: false, capabilities: {}, data_source: "", integrations: {} }, can: canMock }),
}));

import Diagnostics from "./Diagnostics";

function renderPage() {
  return render(
    <ToastProvider>
      <Diagnostics onNavigate={() => {}} />
    </ToastProvider>,
  );
}

describe("Diagnostics — AI 연동(MCP) 패널 (IMP-5)", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  beforeEach(() => {
    canMock.mockImplementation(() => true);
    writeText.mockClear();
  });

  // userEvent.setup() 이 navigator.clipboard 를 자체 stub 으로 덮으므로, setup 이후에 우리 spy 를 건다.
  const installClipboard = () =>
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  it("라이브 tools/list·resources/list 에서 카탈로그를 렌더한다", async () => {
    const user = userEvent.setup();
    renderPage();
    // IMP-86: Tools 탭(기본)에 tool 카드가 라이브 전용으로 노출된다.
    expect(await screen.findByText("list_dimensions")).toBeInTheDocument();
    expect(screen.getByText("groupby_metric")).toBeInTheDocument();
    expect(screen.getByText("top_outliers")).toBeInTheDocument();
    expect(screen.getByText("summarize_endpoint_health")).toBeInTheDocument();
    // resource 는 Resources 탭에서 확인.
    await user.click(screen.getByRole("tab", { name: /Resources/ }));
    expect(screen.getByText("메트릭 카탈로그")).toBeInTheDocument();
  });

  it("엔드포인트 URL 을 /api/v1/mcp 로 표시하고 복사한다", async () => {
    const user = userEvent.setup();
    installClipboard();
    renderPage();
    await screen.findByText("list_dimensions");
    expect(screen.getAllByText(/\/api\/v1\/mcp/).length).toBeGreaterThan(0);
    // "엔드포인트" 섹션의 복사 버튼(첫 번째)
    const copyBtns = screen.getAllByRole("button", { name: "복사" });
    await user.click(copyBtns[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/api/v1/mcp")));
  });

  it("transport 노트: mcp-remote 가 1순위, 네이티브는 coming soon(IMP-9)", async () => {
    renderPage();
    // 패널이 로드될 때까지 대기
    await screen.findByText("list_dimensions");
    expect(screen.getAllByText(/mcp-remote/).length).toBeGreaterThan(0);
    expect(screen.getByText(/coming soon \(IMP-9\)/)).toBeInTheDocument();
    // 1순위 스니펫에 mcp-remote + 엔드포인트가 들어있다(claude 탭 기본)
    expect(screen.getByText(/claude mcp add fabrix/)).toBeInTheDocument();
  });

  it("연결 스니펫을 복사한다", async () => {
    const user = userEvent.setup();
    installClipboard();
    renderPage();
    await screen.findByText("list_dimensions");
    const copyBtns = screen.getAllByRole("button", { name: "복사" });
    expect(copyBtns.length).toBeGreaterThanOrEqual(2);
    // 마지막 복사 버튼 = 스니펫
    await user.click(copyBtns[copyBtns.length - 1]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("mcp-remote")));
  });

  it("cap-off(dashboard 권한 없음) 이면 비활성 안내, 카탈로그·스니펫 미표시", async () => {
    canMock.mockImplementation((cap: string) => cap !== "dashboard");
    renderPage();
    expect(await screen.findByText(/비활성/)).toBeInTheDocument();
    expect(screen.queryByText("list_dimensions")).not.toBeInTheDocument();
    expect(screen.queryByText(/mcp-remote/)).not.toBeInTheDocument();
  });
});
