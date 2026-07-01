// IMP-73 — mock MCP tools/list 가 ONTOLOGY_TOOL_REGISTRY 단일 출처에서 파생되는지(프론트/백엔드 통일).
// installMockFetch + client.mcpListTools 로 실제 mock 라우터(POST /api/v1/mcp)를 통과시킨다.
// McpPanel(Diagnostics)이 이 경로로 라이브 목록을 받으므로, 여기 통과 = 패널이 통일 목록을 보여줌.
import { describe, it, expect, beforeAll } from "vitest";
import { installMockFetch } from "./mock";
import { mcpListTools, mcpListResources } from "./client";
import { ONTOLOGY_TOOL_REGISTRY, assertReadOnly } from "../actions/ontologyTools";

beforeAll(() => {
  installMockFetch();
});

describe("mock MCP tools/list — 레지스트리 파생·read-only", () => {
  it("aggregate 4종 + 온톨로지 read tool 4종(레지스트리)을 모두 노출", async () => {
    const tools = await mcpListTools();
    const names = new Set(tools.map((t) => t.name));
    // aggregate(mcp.go 고유).
    for (const n of ["list_dimensions", "groupby_metric", "top_outliers", "summarize_endpoint_health"]) {
      expect(names.has(n)).toBe(true);
    }
    // 온톨로지 read tool — 레지스트리 키가 그대로 목록에 존재(수기 미러 아님).
    for (const n of Object.keys(ONTOLOGY_TOOL_REGISTRY)) {
      expect(names.has(n)).toBe(true);
    }
  });

  it("**안전**: mock tools/list 에 mutating 동사 tool 이 없다(auto-callable mutation 없음)", async () => {
    const tools = await mcpListTools();
    const verbs = ["create", "update", "delete", "set", "write", "patch", "scale", "restart", "drain", "cordon", "resolve", "invoke", "apply"];
    for (const t of tools) {
      for (const v of verbs) expect(t.name.toLowerCase().includes(v)).toBe(false);
    }
    // 레지스트리 자체도 read-only 불변식 통과.
    expect(() => assertReadOnly()).not.toThrow();
  });

  it("resources/list 에 fabrix://ontology/schema + 기존 2종", async () => {
    const res = await mcpListResources();
    const uris = new Set(res.map((r) => r.uri));
    expect(uris.has("fabrix://ontology/schema")).toBe(true);
    expect(uris.has("fabrix://metric-catalog")).toBe(true);
    expect(uris.has("fabrix://dimensions")).toBe(true);
  });
});
