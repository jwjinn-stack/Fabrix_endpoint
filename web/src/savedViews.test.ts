import { describe, it, expect, beforeEach } from "vitest";
import { listSavedViews, saveView, deleteView } from "./savedViews";

describe("savedViews — localStorage 저장된 뷰 (IMP-24)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("roundtrip: 저장 → 목록에 포함", () => {
    saveView("traces", "차단 1시간", "decision=blocked&range=1h");
    const list = listSavedViews("traces");
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("차단 1시간");
    expect(list[0].query).toBe("decision=blocked&range=1h");
    expect(typeof list[0].savedAt).toBe("number");
  });

  it("선행 ? 는 제거해 보관한다", () => {
    saveView("traces", "v", "?decision=flagged");
    expect(listSavedViews("traces")[0].query).toBe("decision=flagged");
  });

  it("같은 이름 재저장 시 덮어쓴다(중복 없음)", () => {
    saveView("traces", "v", "a=1");
    saveView("traces", "v", "a=2");
    const list = listSavedViews("traces");
    expect(list).toHaveLength(1);
    expect(list[0].query).toBe("a=2");
  });

  it("화면별로 분리된다", () => {
    saveView("traces", "t", "a=1");
    saveView("sessions", "s", "b=2");
    expect(listSavedViews("traces")).toHaveLength(1);
    expect(listSavedViews("sessions")).toHaveLength(1);
    expect(listSavedViews("sessions")[0].name).toBe("s");
  });

  it("삭제 후 사라진다", () => {
    saveView("traces", "v", "a=1");
    deleteView("traces", "v");
    expect(listSavedViews("traces")).toHaveLength(0);
  });

  it("빈 이름은 저장하지 않는다", () => {
    saveView("traces", "   ", "a=1");
    expect(listSavedViews("traces")).toHaveLength(0);
  });
});
