import { describe, it, expect } from "vitest";
import { buildAssistAnswer, describeScreen, buildScreenCtx, chunkAnswer, screenTitle } from "./assist";

// IMP-103 — 전역 Assist 답변 seam(순수·결정적·환각 금지)의 회귀 가드.

describe("IMP-103 assist seam — screenTitle", () => {
  it("route 를 사람이 읽는 화면명으로(NAV 라벨 정합)", () => {
    expect(screenTitle("dashboard")).toBe("관제");
    expect(screenTitle("agent")).toBe("AI Agent");
    expect(screenTitle("investigate")).toContain("근본원인");
  });
});

describe("IMP-103 assist seam — buildAssistAnswer(용어/폴백)", () => {
  it("등록 용어 완전일치 → 큐레이션 정의(short + why)", () => {
    const a = buildAssistAnswer("ttft", "dashboard");
    expect(a.kind).toBe("term");
    expect(a.grounded).toBe(true);
    expect(a.text).toContain("TTFT");
    expect(a.text).toContain("첫 토큰"); // glossary short 인용
  });

  it("한국어 질문형 접미사(‘란?’)를 벗겨 완전일치 재시도", () => {
    const a = buildAssistAnswer("TTFT란?", "dashboard");
    expect(a.kind).toBe("term");
    expect(a.grounded).toBe(true);
  });

  it("alias(예: ‘time to first token’)로도 해석", () => {
    const a = buildAssistAnswer("time to first token", "dashboard");
    expect(a.kind).toBe("term");
    expect(a.grounded).toBe(true);
  });

  it("미등록 용어 → 지어내지 않고 정직 폴백(실 모델 미연결 명시)", () => {
    const a = buildAssistAnswer("존재하지않는용어xyz", "dashboard");
    expect(a.kind).toBe("fallback");
    expect(a.grounded).toBe(false);
    expect(a.text).toContain("찾지 못했습니다");
    expect(a.text).toContain("mock"); // 정직 라벨
  });

  it("빈 질문 → 안내(폴백)", () => {
    const a = buildAssistAnswer("   ", "dashboard");
    expect(a.kind).toBe("fallback");
  });

  it("결정적 — 같은 입력은 같은 답(부작용 없음)", () => {
    expect(buildAssistAnswer("p95", "gpu")).toEqual(buildAssistAnswer("p95", "gpu"));
  });
});

describe("IMP-103 assist seam — describeScreen(자동 화면 컨텍스트)", () => {
  it("위젯 메타가 있는 화면(dashboard) → 위젯 whatItShows 인용 설명(grounded)", () => {
    const a = describeScreen("dashboard");
    expect(a.kind).toBe("screen");
    expect(a.grounded).toBe(true);
    expect(a.text).toContain("관제");
    // dashboard 마운트 위젯 제목 중 하나 인용(IMP-105 WIDGET_META).
    expect(a.text).toContain("실시간 트래픽");
  });

  it("위젯 메타가 없는 화면 → 지어내지 않고 정직히 알림(환각 금지)", () => {
    const a = describeScreen("settings");
    expect(a.kind).toBe("screen");
    expect(a.grounded).toBe(false);
    expect(a.text).toContain("등록된 위젯 메타가 없습니다");
  });
});

describe("IMP-103 assist seam — buildScreenCtx / chunkAnswer", () => {
  it("buildScreenCtx — route/title/위젯 제목(정보폭탄 금지: 선언된 것만)", () => {
    const ctx = buildScreenCtx("dashboard");
    expect(ctx.route).toBe("dashboard");
    expect(ctx.title).toBe("관제");
    expect(ctx.widgetTitles.length).toBeGreaterThan(0);
    // 위젯 없는 화면은 빈 배열(덤프 없음).
    expect(buildScreenCtx("settings").widgetTitles).toEqual([]);
  });

  it("chunkAnswer — 재결합하면 원문 보존(스트리밍 seam, IMP-110 스왑 지점)", () => {
    const text = "TTFT\n\n첫 토큰까지 걸린 시간입니다.";
    expect(chunkAnswer(text).join("")).toBe(text);
    expect(chunkAnswer("").length).toBe(0);
  });
});
