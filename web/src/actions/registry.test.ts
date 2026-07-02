// IMP-96 — registry 단일 출처 계약: whenToUse·reversible 완비 + consequence-tier + 되돌리기 라벨.
import { describe, it, expect } from "vitest";
import {
  ACTION_REGISTRY,
  actionTier,
  reversibilityLabel,
  type ActionSpec,
} from "./registry";

const specs = Object.values(ACTION_REGISTRY);

describe("ActionSpec — whenToUse/reversible 완비(IMP-96 단일 출처)", () => {
  it("모든 verb 가 비어있지 않은 whenToUse 를 갖는다", () => {
    for (const s of specs) {
      expect(s.whenToUse, `${s.name}.whenToUse`).toBeTruthy();
      expect(s.whenToUse.length).toBeGreaterThan(4);
    }
  });

  it("모든 verb 가 reversible.value ∈ {yes,no,partial} 를 갖는다", () => {
    for (const s of specs) {
      expect(["yes", "no", "partial"], `${s.name}.reversible.value`).toContain(s.reversible.value);
    }
  });
});

describe("actionTier — severity 기반 consequence-tier(과설명 회피)", () => {
  it("destructive 동사는 consequential", () => {
    for (const n of ["restartModel", "scaleReplicas", "cordonNode", "drainGpu"]) {
      expect(actionTier(ACTION_REGISTRY[n]), n).toBe("consequential");
    }
  });
  it("lifecycle 동사(ack/resolve/snooze)는 lifecycle", () => {
    for (const n of ["ack", "resolve", "snooze"]) {
      expect(actionTier(ACTION_REGISTRY[n]), n).toBe("lifecycle");
    }
  });
});

describe("reversibilityLabel — 칩 라벨/톤 단일 출처(색-only 금지, 텍스트 병기)", () => {
  it("yes/partial/no 각각 텍스트 라벨 + 톤을 반환한다", () => {
    expect(reversibilityLabel({ value: "yes" })).toEqual({ chip: "되돌리기 가능", tone: "green" });
    expect(reversibilityLabel({ value: "partial" })).toEqual({ chip: "부분 가역", tone: "amber" });
    expect(reversibilityLabel({ value: "no" })).toEqual({ chip: "되돌릴 수 없음", tone: "red" });
  });

  it("consequential 동사는 되돌리기 세부(how)를 제공한다", () => {
    const s: ActionSpec = ACTION_REGISTRY.drainGpu;
    expect(s.reversible.how).toBeTruthy();
  });
});
