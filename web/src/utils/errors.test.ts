import { describe, it, expect } from "vitest";
import { humanizeError } from "./errors";

describe("humanizeError", () => {
  it("maps network failures", () => {
    expect(humanizeError("Failed to fetch")).toContain("서버에 연결할 수 없습니다");
  });
  it("maps 5xx to server error", () => {
    expect(humanizeError("API 503")).toContain("서버 오류");
  });
  it("maps 403 to permission", () => {
    expect(humanizeError("API 403: forbidden")).toContain("권한이 없습니다");
  });
  it("maps 429 to rate limit", () => {
    expect(humanizeError("API 429")).toContain("요청이 많아");
  });
  it("maps invalid email", () => {
    expect(humanizeError("invalid email")).toContain("이메일 형식");
  });
  it("passes through unknown messages unchanged", () => {
    expect(humanizeError("뭔가 특이한 도메인 오류")).toBe("뭔가 특이한 도메인 오류");
  });
});
