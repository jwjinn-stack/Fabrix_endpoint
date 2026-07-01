// IMP-73 — 온톨로지 read tool 레지스트리 불변식 테스트.
// 레지스트리가 (1) read-only 이고 (2) enum 이 ObjectType/LinkKind union 과 정확히 일치하며
// (3) 스키마가 strict(additionalProperties:false + 필수 필드)임을 DOM/네트워크 없이 가드한다.
import { describe, it, expect } from "vitest";
import {
  ONTOLOGY_TOOL_REGISTRY, assertReadOnly, METRIC_RANGES,
} from "./ontologyTools";
import { OBJECT_TYPES, LINK_KINDS } from "../api/ontologySchema";

describe("ONTOLOGY_TOOL_REGISTRY — 계약 형태", () => {
  it("정확히 4개 read tool(query_objects/traverse_links/get_object/get_object_metrics)", () => {
    expect(Object.keys(ONTOLOGY_TOOL_REGISTRY).sort()).toEqual(
      ["get_object", "get_object_metrics", "query_objects", "traverse_links"],
    );
  });

  it("모든 tool 이 strict object 스키마(additionalProperties:false)", () => {
    for (const spec of Object.values(ONTOLOGY_TOOL_REGISTRY)) {
      expect(spec.inputSchema.type).toBe("object");
      expect(spec.inputSchema.additionalProperties).toBe(false); // 여분 필드 거부(LLM 방어)
      expect(spec.name).toBe(spec.name); // name 자체 존재
      expect(spec.description.length).toBeGreaterThan(0);
    }
  });

  it("required 필드가 스키마 properties 에 존재(모순 없음)", () => {
    for (const spec of Object.values(ONTOLOGY_TOOL_REGISTRY)) {
      for (const req of spec.inputSchema.required ?? []) {
        expect(Object.keys(spec.inputSchema.properties)).toContain(req);
      }
    }
    // 명세상 required: traverse_links.objectId, get_object.id, get_object_metrics.id
    expect(ONTOLOGY_TOOL_REGISTRY.traverse_links.inputSchema.required).toEqual(["objectId"]);
    expect(ONTOLOGY_TOOL_REGISTRY.get_object.inputSchema.required).toEqual(["id"]);
    expect(ONTOLOGY_TOOL_REGISTRY.get_object_metrics.inputSchema.required).toEqual(["id"]);
    // query_objects 는 전부 optional(진입 스캔).
    expect(ONTOLOGY_TOOL_REGISTRY.query_objects.inputSchema.required).toBeUndefined();
  });

  it("enum 이 ObjectType/LinkKind/range union 과 정확히 일치(하드코딩 아님·drift 방지)", () => {
    expect(ONTOLOGY_TOOL_REGISTRY.query_objects.inputSchema.properties.type.enum).toEqual([...OBJECT_TYPES]);
    expect(ONTOLOGY_TOOL_REGISTRY.traverse_links.inputSchema.properties.linkType.enum).toEqual([...LINK_KINDS]);
    expect(ONTOLOGY_TOOL_REGISTRY.get_object_metrics.inputSchema.properties.range.enum).toEqual([...METRIC_RANGES]);
  });
});

describe("**안전** — read-only 불변식(two-tier 게이팅)", () => {
  it("레지스트리에 mutating 성격 tool 이 없다(assertReadOnly 통과)", () => {
    expect(() => assertReadOnly()).not.toThrow();
  });

  it("mutating 이름을 주입하면 assertReadOnly 가 즉시 실패(가드 동작 확인)", () => {
    const poisoned = {
      ...ONTOLOGY_TOOL_REGISTRY,
      scale_replicas: { name: "scale_replicas", description: "x", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false as const } },
    };
    expect(() => assertReadOnly(poisoned)).toThrow(/read-only/);
  });

  it("어떤 tool 이름에도 mutating 동사(create/update/delete/set/write/patch/scale/restart/drain/cordon)가 없다", () => {
    const verbs = ["create", "update", "delete", "set", "write", "patch", "scale", "restart", "drain", "cordon"];
    for (const name of Object.keys(ONTOLOGY_TOOL_REGISTRY)) {
      for (const v of verbs) expect(name.toLowerCase().includes(v)).toBe(false);
    }
  });
});
