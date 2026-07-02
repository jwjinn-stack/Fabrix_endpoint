// IMP-87 — 화이트라벨(제품명·로고·favicon) + onPrimary WCAG 대비 자동선택 테스트.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import {
  contrastRatio, pickOnPrimary, wcagAssess, deriveBrand, isImageDataUri, withinSizeCap,
  loadTenant, ThemeProvider, DEFAULT_TENANT, LOGO_MAX_BYTES,
} from "./theme";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("WCAG 대비", () => {
  it("흰-검 대비는 21:1, 동일색은 1:1", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 1);
  });
  it("pickOnPrimary — 밝은 배경은 검정, 어두운 배경은 흰색", () => {
    expect(pickOnPrimary("#e9f1f8")).toBe("#111111");
    expect(pickOnPrimary("#2f6690")).toBe("#ffffff");
  });
  it("wcagAssess — 저대비 조합은 passAA=false", () => {
    const bad = wcagAssess("#ffffff", "#cccccc");
    expect(bad.passAA).toBe(false);
    const good = wcagAssess("#2f6690", "#ffffff");
    expect(good.passAA).toBe(true);
  });
});

describe("deriveBrand onPrimary", () => {
  it("임의 HEX 에서 onPrimary 를 대비로 채운다", () => {
    expect(deriveBrand("#111111").onPrimary).toBe("#ffffff");
    expect(deriveBrand("#f5f5f5").onPrimary).toBe("#111111");
  });
});

describe("업로드 가드(보안)", () => {
  it("isImageDataUri — png data-URI true, javascript/텍스트 false", () => {
    expect(isImageDataUri(PNG)).toBe(true);
    expect(isImageDataUri("data:text/html,<b>x</b>")).toBe(false);
    expect(isImageDataUri("javascript:alert(1)")).toBe(false);
    expect(isImageDataUri("data:image/png")).toBe(false);
  });
  it("withinSizeCap — 초과분 거부", () => {
    const big = "data:image/png;base64," + "A".repeat(LOGO_MAX_BYTES * 2);
    expect(withinSizeCap(PNG, LOGO_MAX_BYTES)).toBe(true);
    expect(withinSizeCap(big, LOGO_MAX_BYTES)).toBe(false);
  });
});

describe("TenantBrand 영속", () => {
  it("저장 없으면 기본값(FABRIX/AI)", () => {
    expect(loadTenant()).toEqual(DEFAULT_TENANT);
  });
  it("저장/복원 왕복", () => {
    localStorage.setItem("fabrix.tenant", JSON.stringify({ productName: "삼성증권", productSuffix: "GPT", logoDataUri: PNG }));
    const t = loadTenant();
    expect(t.productName).toBe("삼성증권");
    expect(t.productSuffix).toBe("GPT");
    expect(t.logoDataUri).toBe(PNG);
  });
  it("비이미지 data-URI 는 로드 시 제거(injection 가드)", () => {
    localStorage.setItem("fabrix.tenant", JSON.stringify({ productName: "X", logoDataUri: "data:text/html,<script>1</script>" }));
    expect(loadTenant().logoDataUri).toBeUndefined();
  });
});

describe("문서 title 런타임 주입", () => {
  it("ThemeProvider 마운트 시 productName 이 document.title 에 반영", async () => {
    localStorage.setItem("fabrix.tenant", JSON.stringify({ productName: "미래에셋", productSuffix: "AI" }));
    render(<ThemeProvider><div>ok</div></ThemeProvider>);
    await waitFor(() => expect(document.title).toContain("미래에셋"));
  });
});
