import { describe, it, expect, beforeEach } from "vitest";
import {
  ALL_WIDGETS,
  DEFAULT_LAYOUT,
  loadLayout,
  saveLayout,
  normalizeLayout,
  moveWidget,
  toggleWidget,
  isVisible,
  type DashboardLayout,
} from "./dashboardLayout";

describe("dashboardLayout — 커스텀 대시보드 레이아웃 (IMP-40)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("기본 폴백: 빈 localStorage 면 DEFAULT_LAYOUT 정규화 결과", () => {
    const l = loadLayout();
    expect(l.order).toEqual([...ALL_WIDGETS]);
    expect(l.hidden).toEqual(["gpu"]);
    expect(l).toEqual(normalizeLayout(DEFAULT_LAYOUT));
  });

  it("localStorage roundtrip: save → load 동일 복원", () => {
    const custom: DashboardLayout = { order: ["alarms", "timeseries", "traffic", "quality", "guardrail", "gpu", "distribution"], hidden: ["distribution"] };
    saveLayout(custom);
    expect(loadLayout()).toEqual(normalizeLayout(custom));
  });

  it("toggleWidget: 표시 ↔ 숨김 반전", () => {
    let l = normalizeLayout(DEFAULT_LAYOUT);
    expect(isVisible(l, "traffic")).toBe(true);
    l = toggleWidget(l, "traffic");
    expect(isVisible(l, "traffic")).toBe(false);
    expect(l.hidden).toContain("traffic");
    l = toggleWidget(l, "traffic");
    expect(isVisible(l, "traffic")).toBe(true);
    expect(l.hidden).not.toContain("traffic");
  });

  it("toggleWidget 은 order 를 바꾸지 않는다", () => {
    const l = normalizeLayout(DEFAULT_LAYOUT);
    expect(toggleWidget(l, "quality").order).toEqual(l.order);
  });

  it("moveWidget down: 인접 위젯과 swap", () => {
    const l = normalizeLayout(DEFAULT_LAYOUT); // traffic, quality, ...
    const moved = moveWidget(l, "traffic", "down");
    expect(moved.order[0]).toBe("quality");
    expect(moved.order[1]).toBe("traffic");
  });

  it("moveWidget up: 인접 위젯과 swap", () => {
    const l = normalizeLayout(DEFAULT_LAYOUT);
    const moved = moveWidget(l, "quality", "up");
    expect(moved.order[0]).toBe("quality");
    expect(moved.order[1]).toBe("traffic");
  });

  it("경계: 맨위 up / 맨아래 down 은 무변", () => {
    const l = normalizeLayout(DEFAULT_LAYOUT);
    expect(moveWidget(l, "traffic", "up").order).toEqual(l.order);
    const last = l.order[l.order.length - 1];
    expect(moveWidget(l, last, "down").order).toEqual(l.order);
  });

  describe("normalizeLayout — 방어적 파싱(throw 없음)", () => {
    it("누락된 위젯은 canonical 순서로 append", () => {
      const l = normalizeLayout({ order: ["alarms", "traffic"], hidden: [] });
      expect(l.order).toHaveLength(ALL_WIDGETS.length);
      expect(l.order.slice(0, 2)).toEqual(["alarms", "traffic"]);
      // 나머지는 canonical 순서 유지
      expect(new Set(l.order)).toEqual(new Set(ALL_WIDGETS));
    });

    it("미지/잘못된 위젯 id 는 제거", () => {
      const l = normalizeLayout({ order: ["traffic", "bogus", 42, null, "quality"], hidden: ["nope"] });
      expect(l.order).not.toContain("bogus");
      expect(l.order).not.toContain(42);
      expect(new Set(l.order)).toEqual(new Set(ALL_WIDGETS));
      expect(l.hidden).toEqual([]);
    });

    it("중복 위젯은 1회만", () => {
      const l = normalizeLayout({ order: ["traffic", "traffic", "quality"], hidden: ["traffic", "traffic"] });
      expect(l.order.filter((w) => w === "traffic")).toHaveLength(1);
      expect(l.hidden).toEqual(["traffic"]);
    });

    it("hidden 은 ALL_WIDGETS 교집합만", () => {
      const l = normalizeLayout({ order: [...ALL_WIDGETS], hidden: ["gpu", "ghost"] });
      expect(l.hidden).toEqual(["gpu"]);
    });

    it("완전 쓰레기 값(배열아님/객체아님)도 유효 레이아웃", () => {
      expect(normalizeLayout(null).order).toEqual([...ALL_WIDGETS]);
      expect(normalizeLayout("nonsense").order).toEqual([...ALL_WIDGETS]);
      expect(normalizeLayout({ order: "x", hidden: 9 }).order).toEqual([...ALL_WIDGETS]);
    });
  });

  it("loadLayout: 비-JSON 저장값도 throw 없이 default", () => {
    localStorage.setItem("fabrix.dashboard.layout", "{not json");
    expect(loadLayout()).toEqual(normalizeLayout(DEFAULT_LAYOUT));
  });

  it("loadLayout: 잘못된 저장값(미지 위젯 포함)도 정규화", () => {
    localStorage.setItem("fabrix.dashboard.layout", JSON.stringify({ order: ["ghost", "alarms"], hidden: ["ghost"] }));
    const l = loadLayout();
    expect(new Set(l.order)).toEqual(new Set(ALL_WIDGETS));
    expect(l.order[0]).toBe("alarms");
    expect(l.hidden).toEqual([]);
  });
});
