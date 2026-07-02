// IMP-106 — 어시스트 컨텍스트 seam(glossary://·widget:// RESOURCE + get_screen_context TOOL) 단위 테스트.
import { describe, it, expect } from "vitest";
import {
  ASSIST_TOOL_REGISTRY,
  ASSIST_RESOURCE_TEMPLATES,
  SCREEN_ROUTES,
  assertReadOnly,
  buildAssistResourceContents,
} from "./ontologyTools";
import {
  parseAssistUri,
  resolveGlossaryResource,
  resolveWidgetResource,
  resolveAssistResource,
  getScreenContextResult,
} from "./assistContext";
import { installMockFetch } from "../api/mock";
import { mcpListTools, mcpListResourceTemplates, mcpReadResource } from "../api/client";

describe("IMP-106 get_screen_context — read-only TOOL(단일 레지스트리)", () => {
  it("ASSIST_TOOL_REGISTRY 에 get_screen_context 하나만·read-only·strict 스키마", () => {
    expect(Object.keys(ASSIST_TOOL_REGISTRY)).toEqual(["get_screen_context"]);
    const spec = ASSIST_TOOL_REGISTRY.get_screen_context;
    expect(spec.inputSchema.additionalProperties).toBe(false);
    expect(spec.inputSchema.required).toEqual(["route"]);
    // route enum 이 Page 파생 SCREEN_ROUTES 와 정합(하드코딩 아님).
    expect(spec.inputSchema.properties.route.enum).toEqual([...SCREEN_ROUTES]);
    expect(() => assertReadOnly(ASSIST_TOOL_REGISTRY)).not.toThrow();
    expect(spec.description).toContain("no mutation");
  });

  it("executor: route 의 on-screen widget 만 + 동적 컨텍스트 패스스루(앱 전체 덤프 금지)", () => {
    const r = getScreenContextResult({ route: "dashboard", objectId: "endpoint:ep-a", facet: "quality", selection: "dashboard.quality" });
    expect(r.route).toBe("dashboard");
    // dashboard 화면에 마운트된 위젯만(SCREEN_WIDGETS 스코프).
    expect(r.widgetIds.sort()).toEqual(["dashboard.gpu", "dashboard.guardrail", "dashboard.quality", "dashboard.traffic"]);
    expect(r.objectId).toBe("endpoint:ep-a");
    expect(r.facet).toBe("quality");
    expect(r.selection).toBe("dashboard.quality");
    expect(r.readOnly).toBe(true);
  });

  it("executor: 위젯 메타 없는 route → 빈 목록(지어내지 않음)", () => {
    const r = getScreenContextResult({ route: "settings" });
    expect(r.widgetIds).toEqual([]);
    expect(r.widgets).toEqual([]);
  });
});

describe("IMP-106 glossary://{term} RESOURCE 템플릿 resolver", () => {
  it("key 완전일치 해석", () => {
    const r = resolveGlossaryResource("ttft");
    expect(r.found).toBe(true);
    if (r.found) expect(r.term.term).toContain("TTFT");
  });
  it("alias 완전일치 해석(대소문자 무시)", () => {
    const r = resolveGlossaryResource("time to first token");
    expect(r.found).toBe(true);
  });
  it("미지 용어 → found:false(환각 금지)", () => {
    const r = resolveGlossaryResource("존재하지않는용어xyz");
    expect(r.found).toBe(false);
    if (!r.found) expect(r.message).toBe("선언된 용어 없음");
  });
});

describe("IMP-106 widget://{id} RESOURCE 템플릿 resolver", () => {
  it("describeWidget 위임 — 존재 위젯", () => {
    const r = resolveWidgetResource("dashboard.traffic");
    expect(r.result.found).toBe(true);
    if (r.result.found) expect(r.result.relatedTerms.length).toBeGreaterThan(0);
  });
  it("미지 id → 선언된 메타 없음", () => {
    const r = resolveWidgetResource("nope.widget");
    expect(r.result.found).toBe(false);
    if (!r.result.found) expect(r.result.message).toBe("선언된 메타 없음");
  });
});

describe("IMP-106 URI 파서 + 디스패치(injection-safe)", () => {
  it("parseAssistUri — 스킴/부분 추출, 잘못된 스킴 null", () => {
    expect(parseAssistUri("glossary://ttft")).toEqual({ scheme: "glossary", part: "ttft" });
    expect(parseAssistUri("widget://dashboard.gpu")).toEqual({ scheme: "widget", part: "dashboard.gpu" });
    expect(parseAssistUri("http://evil")).toBeNull();
    expect(parseAssistUri("glossary://")).toBeNull();
  });
  it("resolveAssistResource 디스패치", () => {
    expect(resolveAssistResource("glossary://p95").kind).toBe("glossary");
    expect(resolveAssistResource("widget://dashboard.gpu").kind).toBe("widget");
    expect(resolveAssistResource("fabrix://metric-catalog").kind).toBe("unknown");
  });
  it("**보안**: template/tool description 은 정적 문자열(사용자 보간 없음)", () => {
    // 리터럴 선언 — { } 보간 placeholder 나 사용자 입력 흔적이 없어야 한다.
    for (const t of ASSIST_RESOURCE_TEMPLATES) {
      expect(t.description).not.toMatch(/\$\{|<script|javascript:/i);
    }
    expect(ASSIST_TOOL_REGISTRY.get_screen_context.description).not.toMatch(/\$\{|<script/i);
  });
  it("resourceContents 는 라이브 숫자/verdict 를 담지 않는다(정적 메타만)", () => {
    const c = buildAssistResourceContents();
    for (const w of Object.values(c.widgets)) {
      expect(w).not.toHaveProperty("verdict");
      expect(w).not.toHaveProperty("liveValue");
    }
  });
});

describe("IMP-106 mock MCP — tools/list·resources/templates/list·resources/read", () => {
  it("tools/list 에 get_screen_context 노출 + mutating verb 0", async () => {
    installMockFetch();
    const tools = await mcpListTools();
    const names = new Set(tools.map((t) => t.name));
    expect(names.has("get_screen_context")).toBe(true);
    const verbs = ["create", "update", "delete", "set", "write", "patch", "scale", "restart", "drain", "cordon", "resolve", "invoke", "apply"];
    for (const t of tools) for (const v of verbs) expect(t.name.toLowerCase().includes(v)).toBe(false);
  });

  it("resources/templates/list 에 glossary://·widget:// template", async () => {
    installMockFetch();
    const tmpls = await mcpListResourceTemplates();
    const uris = new Set(tmpls.map((t) => t.uriTemplate));
    expect(uris.has("glossary://{term}")).toBe(true);
    expect(uris.has("widget://{id}")).toBe(true);
  });

  it("resources/read(glossary://ttft) 정의 텍스트 반환", async () => {
    installMockFetch();
    const contents = await mcpReadResource("glossary://ttft");
    expect(contents.length).toBe(1);
    const parsed = JSON.parse(contents[0].text ?? "{}");
    expect(parsed.term).toContain("TTFT");
  });

  it("resources/read(widget://dashboard.gpu) 메타 반환", async () => {
    installMockFetch();
    const contents = await mcpReadResource("widget://dashboard.gpu");
    const parsed = JSON.parse(contents[0].text ?? "{}");
    expect(parsed.found).toBe(true);
    expect(parsed.title).toBeTruthy();
  });

  it("resources/read 미지 term → not-found 텍스트(환각 금지)", async () => {
    installMockFetch();
    const contents = await mcpReadResource("glossary://없는용어xyz");
    const parsed = JSON.parse(contents[0].text ?? "{}");
    expect(parsed.found).toBe(false);
  });
});
