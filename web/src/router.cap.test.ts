import { describe, it, expect } from "vitest";
import { capForPage, PAGE_CAP, ROUTES, pageFromPath, pathForPage } from "./router";

// IMP-53 회귀 가드 — 3개 인프라 화면(토폴로지·노드·네트워크)의 cap 매핑을 고정한다.
// cap 이 누락되면 observe 게이팅이 우회될 수 있으므로(IMP-2 교훈) 상수로 못박는다.
describe("PAGE_CAP — 인프라 화면 cap 정합 (IMP-53)", () => {
  it("topology/nodes/network 는 모두 dashboard cap", () => {
    expect(capForPage("topology")).toBe("dashboard");
    expect(capForPage("nodes")).toBe("dashboard");
    expect(capForPage("network")).toBe("dashboard");
  });

  it("gpu/traffic 도 dashboard cap(인프라 그룹 정합)", () => {
    expect(PAGE_CAP.gpu).toBe("dashboard");
    expect(PAGE_CAP.traffic).toBe("dashboard");
  });

  // IMP-58 — Troubleshooting COP 화면 라우트/cap 등록 고정.
  it("investigate 는 /investigate 라우트 + dashboard cap 로 등록된다", () => {
    expect(ROUTES.investigate).toBe("/investigate");
    expect(capForPage("investigate")).toBe("dashboard");
    // 경로 ↔ 페이지 왕복(round-trip).
    expect(pageFromPath("/investigate")).toBe("investigate");
    expect(pathForPage("investigate", { entity: "endpoint:e1" })).toBe("/investigate?entity=endpoint%3Ae1");
  });

  // IMP-60 — AI Agent 화면 라우트/cap 등록 고정. mutating 은 카드 ActionForm 이 별도 게이팅(two-tier).
  it("agent 는 /agent 라우트 + dashboard cap 로 등록된다", () => {
    expect(ROUTES.agent).toBe("/agent");
    expect(capForPage("agent")).toBe("dashboard");
    expect(pageFromPath("/agent")).toBe("agent");
  });
});

// IMP-70 — 진입점 재배치: 기본 랜딩은 과업/상황/객체형 actionable surface(관제), 온톨로지 개요 아님.
// 별도 "home" 개념이 없으므로 기본 라우트(pageFromPath 루트/미지 폴백)가 곧 랜딩 — 이를 못박아 박물관 정문 회귀 방지.
describe("기본 랜딩 — actionable surface, 온톨로지 정문 아님 (IMP-70)", () => {
  it("루트/미지 경로는 dashboard(관제)로 폴백 — 온톨로지 개요가 아니다", () => {
    // 루트 '/' → dashboard.
    expect(pageFromPath("/")).toBe("dashboard");
    expect(pageFromPath("/")).not.toBe("ontology");
    // 미지 경로(박물관 정문 딥링크 등) → dashboard 폴백, 온톨로지 아님.
    expect(pageFromPath("/museum-front-door")).toBe("dashboard");
    expect(pageFromPath("/museum-front-door")).not.toBe("ontology");
    // 빈 경로도 dashboard.
    expect(pageFromPath("")).toBe("dashboard");
  });

  it("dashboard 는 항상-허용에 준하는 dashboard cap — 양 프로파일 공통 랜딩 가능", () => {
    // 랜딩 화면 cap 이 켜져 있어야 observe/manage 양쪽에서 첫 화면이 폴백되지 않는다.
    expect(capForPage("dashboard")).toBe("dashboard");
  });
});
