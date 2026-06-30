import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreBadges, ScorePanel, scoreColor, scoreCue } from "./ScoreBadge";
import type { Score } from "../api/types";

const numericScore: Score = {
  name: "정확성", value: 4, data_type: "numeric", comment: "근거 명확",
  source: "llm-judge", trace_id: "tr_1", ts: "2026-06-30T00:00:00Z",
};
const catScore: Score = {
  name: "감성", value: 0, string_value: "긍정", data_type: "categorical",
  source: "llm-judge", trace_id: "tr_1", ts: "2026-06-30T00:00:00Z",
};
const boolScore: Score = {
  name: "안전", value: 1, data_type: "boolean", source: "human", trace_id: "tr_1", ts: "2026-06-30T00:00:00Z",
};

describe("scoreColor / scoreCue", () => {
  it("점수 구간별 색을 매핑한다", () => {
    expect(scoreColor(5)).toBe("var(--green)");
    expect(scoreColor(3)).toBe("var(--amber)");
    expect(scoreColor(1)).toBe("var(--red)");
  });
  it("점수 구간별 평문 큐를 반환한다", () => {
    expect(scoreCue(5)).toBe("매우 일치");
    expect(scoreCue(1)).toBe("근거 부족");
  });
});

describe("ScoreBadges (IMP-18 list 배지)", () => {
  it("numeric 점수를 '이름 n/5' 로 렌더한다", () => {
    render(<ScoreBadges scores={[numericScore]} />);
    expect(screen.getByText("정확성 4/5")).toBeInTheDocument();
  });
  it("categorical 은 'name: 라벨', boolean 은 체크로 렌더한다", () => {
    render(<ScoreBadges scores={[catScore, boolScore]} max={5} />);
    expect(screen.getByText("감성: 긍정")).toBeInTheDocument();
    expect(screen.getByText("안전 ✓")).toBeInTheDocument();
  });
  it("max 초과분은 '+N' 으로 접는다", () => {
    render(<ScoreBadges scores={[numericScore, catScore, boolScore]} max={1} />);
    expect(screen.getByText("정확성 4/5")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
  it("빈/undefined scores 면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<ScoreBadges scores={[]} />);
    expect(container).toBeEmptyDOMElement();
    const { container: c2 } = render(<ScoreBadges scores={undefined} />);
    expect(c2).toBeEmptyDOMElement();
  });
});

describe("ScorePanel (IMP-18 detail 패널)", () => {
  it("점수와 신뢰도 큐·출처·근거를 렌더한다", () => {
    render(<ScorePanel scores={[numericScore]} />);
    expect(screen.getByText("정확성 4/5")).toBeInTheDocument();
    expect(screen.getByText("대체로 일치")).toBeInTheDocument();
    expect(screen.getByText("LLM 심판")).toBeInTheDocument();
    expect(screen.getByText("근거 명확")).toBeInTheDocument();
  });
  it("빈 scores 면 안내 문구를 보인다", () => {
    render(<ScorePanel scores={[]} />);
    expect(screen.getByText("부착된 평가 점수가 없습니다.")).toBeInTheDocument();
  });
  it("comment 의 HTML 은 escape 되어 텍스트로 렌더된다(injection 방지)", () => {
    const evil: Score = { ...numericScore, comment: "<img src=x onerror=alert(1)>" };
    const { container } = render(<ScorePanel scores={[evil]} />);
    // <img> 태그가 DOM 노드로 생기지 않고 텍스트로만 존재해야 한다.
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
  });
});
