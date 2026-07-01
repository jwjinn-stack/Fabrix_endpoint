// IMP-64 — Object Type 시각 언어 단일 출처 테스트.
// 7개 ObjectType 전부 항목 존재 + 필드 비어있지 않음 + 타입별 색 구분(무채색 일변도 아님) + 방어 fallback.
import { describe, it, expect } from "vitest";
import { objectTypeVisual, typeVisual } from "./objectTypeVisual";
import type { ObjectType } from "./types";

const ALL_TYPES: ObjectType[] = ["Model", "Endpoint", "Service", "GpuDevice", "Node", "Trace", "Incident"];

describe("objectTypeVisual (IMP-64 타입 위계 단일 출처)", () => {
  it("7개 ObjectType 전부 항목이 있고 glyph/label/color/className 이 비어있지 않다", () => {
    for (const t of ALL_TYPES) {
      const v = objectTypeVisual[t];
      expect(v, `${t} 누락`).toBeDefined();
      expect(v.glyph.length).toBeGreaterThan(0);
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.color).toMatch(/var\(--|#/); // CSS 토큰(var) 또는 hex
      expect(v.className).toMatch(/^otype-/);
    }
  });

  it("색이 타입별로 구분된다(전부 동일 무채색이 아님) — 위계 인코딩", () => {
    const colors = new Set(ALL_TYPES.map((t) => objectTypeVisual[t].color));
    // 최소 4개 이상 서로 다른 색(blue/steel/teal/gray/red 계열).
    expect(colors.size).toBeGreaterThanOrEqual(4);
  });

  it("Incident 는 항상 경계색(red), Service 는 teal — 의미 색 고정", () => {
    expect(objectTypeVisual.Incident.color).toContain("--red");
    expect(objectTypeVisual.Service.color).toContain("--teal");
    expect(objectTypeVisual.Model.color).toContain("--primary");
  });

  it("typeVisual(): 알 수 없는 타입도 안전 fallback(throw 없음)", () => {
    const v = typeVisual("Nope" as ObjectType);
    expect(v.glyph.length).toBeGreaterThan(0);
    expect(v.color).toBeTruthy();
    expect(v.className).toBe("otype-unknown");
  });

  it("글리프는 기존 화면과 동일 유니코드(회귀 최소) — Model=◆", () => {
    expect(objectTypeVisual.Model.glyph).toBe("◆");
    expect(objectTypeVisual.Incident.glyph).toBe("▲");
  });
});
