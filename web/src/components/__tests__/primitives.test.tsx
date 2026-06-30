import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Row, Muted } from "../primitives";

describe("primitives (IMP-19)", () => {
  it("Row renders children and includes the .row class", () => {
    render(<Row data-testid="r">안녕</Row>);
    const el = screen.getByTestId("r");
    expect(el).toHaveTextContent("안녕");
    expect(el.className).toContain("row");
  });

  it("Row merges an extra className", () => {
    render(<Row data-testid="r" className="extra">x</Row>);
    const el = screen.getByTestId("r");
    expect(el.className).toContain("row");
    expect(el.className).toContain("extra");
  });

  it("Muted renders children and includes the .muted class", () => {
    render(<Muted data-testid="m">보조</Muted>);
    const el = screen.getByTestId("m");
    expect(el).toHaveTextContent("보조");
    expect(el.className).toContain("muted");
  });
});
