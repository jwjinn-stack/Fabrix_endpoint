import { describe, it, expect } from "vitest";
import { toCSV, type Column } from "./export";

interface Row {
  id: string;
  qty: number;
  note: string;
}
const cols: Column<Row>[] = [
  { key: "id", header: "id", get: (r) => r.id },
  { key: "qty", header: "qty", get: (r) => r.qty },
  { key: "note", header: "note", get: (r) => r.note },
];

describe("toCSV", () => {
  it("renders header + rows", () => {
    const csv = toCSV([{ id: "a", qty: 2, note: "ok" }], cols);
    expect(csv).toBe("id,qty,note\na,2,ok");
  });
  it("quotes cells containing comma / quote / newline", () => {
    const csv = toCSV([{ id: "x", qty: 1, note: 'a,b"c\nd' }], cols);
    expect(csv).toBe('id,qty,note\nx,1,"a,b""c\nd"');
  });
  it("header-only when no rows", () => {
    expect(toCSV([], cols)).toBe("id,qty,note");
  });
});
