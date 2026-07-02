// IMP-86 — MCP 상세 화면(3-탭·스키마·예시·drift·read-only·prompts 정직).
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import McpDetail from "./McpDetail";
import { ONTOLOGY_TOOL_REGISTRY, K8S_TOOL_REGISTRY } from "../../actions/ontologyTools";
import type { McpTool, McpResource } from "../../api/client";

// 라이브 tools/list — aggregate(레지스트리 밖) + 온톨로지/K8s 레지스트리 tool 전부.
const REG_NAMES = [...Object.keys(ONTOLOGY_TOOL_REGISTRY), ...Object.keys(K8S_TOOL_REGISTRY)];
const LIVE_TOOLS: McpTool[] = [
  { name: "list_dimensions", description: "차원 카탈로그" }, // aggregate = live-only
  ...REG_NAMES.map((n) => ({ name: n, description: "reg" })),
];
const LIVE_RESOURCES: McpResource[] = [
  { uri: "fabrix://ontology/schema", name: "온톨로지 스키마", description: "타입 카탈로그", mimeType: "application/json" },
];

function renderDetail(tools = LIVE_TOOLS, resources = LIVE_RESOURCES) {
  return render(<McpDetail tools={tools} resources={resources} />);
}

describe("McpDetail — 3-탭·스키마·예시·drift (IMP-86)", () => {
  it("Tools/Resources/Prompts 3-탭이 렌더된다", () => {
    renderDetail();
    expect(screen.getByRole("tab", { name: /Tools/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Resources/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Prompts/ })).toBeInTheDocument();
  });

  it("레지스트리 tool 마다 snake_case 카드가 있다(query_objects·list_pods 등)", () => {
    renderDetail();
    expect(screen.getByText("query_objects")).toBeInTheDocument();
    expect(screen.getByText("list_pods")).toBeInTheDocument();
  });

  it("카드 확장 시 SchemaTable + 예시 요청/응답 코드블록이 보인다", async () => {
    const user = userEvent.setup();
    renderDetail();
    // get_object_metrics 는 id(필수)+range(enum) 스키마를 가진다.
    const head = screen.getByText("get_object_metrics").closest("button")!;
    await user.click(head);
    // 스키마 표 헤더 + 예시 req/res 라벨
    expect(screen.getAllByText("입력 스키마").length).toBeGreaterThan(0);
    expect(screen.getByText(/예시 요청/)).toBeInTheDocument();
    expect(screen.getByText("예시 응답")).toBeInTheDocument();
    // range enum 값(1h) 노출
    expect(screen.getAllByText("1h").length).toBeGreaterThan(0);
  });

  it("drift diff: 라이브 전용(aggregate)·연결됨을 배지로 시각화", () => {
    renderDetail();
    // list_dimensions 는 레지스트리 밖 → 라이브 전용 카드.
    expect(screen.getByText("list_dimensions")).toBeInTheDocument();
    expect(screen.getAllByText("라이브 전용").length).toBeGreaterThan(0);
    // 레지스트리∩라이브 → 연결됨 배지 존재.
    expect(screen.getAllByText("연결됨").length).toBeGreaterThan(0);
  });

  it("라이브에서 빠진 레지스트리 tool 은 '라이브 미노출' 경고 배지", () => {
    // list_pods 를 라이브 목록에서 제외 → registry-only.
    const tools = LIVE_TOOLS.filter((t) => t.name !== "list_pods");
    renderDetail(tools);
    expect(screen.getAllByText("라이브 미노출").length).toBeGreaterThan(0);
  });

  it("read-only: mutating Run 버튼이 없고 조회 전용 노트만 있다", async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByText("query_objects").closest("button")!);
    // "실행"/"Run" 같은 mutating 버튼 없음
    expect(screen.queryByRole("button", { name: /실행|Run/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/조회 전용/).length).toBeGreaterThan(0);
  });

  it("Resources 탭: 라이브 resource 카드", async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole("tab", { name: /Resources/ }));
    expect(screen.getByText("온톨로지 스키마")).toBeInTheDocument();
    expect(screen.getByText("fabrix://ontology/schema")).toBeInTheDocument();
  });

  it("Prompts 탭: 서버 미노출 → 정직한 coming soon 카드", async () => {
    const user = userEvent.setup();
    renderDetail();
    await user.click(screen.getByRole("tab", { name: /Prompts/ }));
    expect(screen.getByText(/해당 없음 \(coming soon\)/)).toBeInTheDocument();
  });

  it("CodeBlock 은 dangerouslySetInnerHTML 없이 토큰 span 으로만 렌더(실행 없음)", async () => {
    const user = userEvent.setup();
    const { container } = renderDetail();
    await user.click(screen.getByText("query_objects").closest("button")!);
    const pre = container.querySelector(".mcp-code-pre");
    expect(pre).toBeTruthy();
    // 코드블록 안에 script 태그가 없다(텍스트만).
    expect(within(pre as HTMLElement).queryByText("<script>")).not.toBeInTheDocument();
    expect((pre as HTMLElement).querySelector("script")).toBeNull();
    // JSON-RPC 봉투 토큰이 텍스트로 존재.
    expect(pre!.textContent).toContain("tools/call");
  });
});
