import { describe, it, expect } from "vitest";
import { capForPage, PAGE_CAP } from "./router";

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
});
