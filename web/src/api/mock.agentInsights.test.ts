// IMP-78 — 클러스터 인사이트 mock 계약 테스트. runAgentInsightsMock 은 export 되지 않으므로 fetch 인터셉터 +
// client.runAgentInsights 로 실제 라우터(POST /agent/insights)를 통과시킨다(프로젝트 ethos: 백엔드 0개로 동작).
// 핵심: 응답은 HARD grounding 통과분만(모든 insight 가 objectId 인용), 어디에도 mutating tool/action 흔적이 없다.
import { describe, it, expect, beforeAll } from "vitest";
import { installMockFetch } from "./mock";
import { runAgentInsights } from "./client";

beforeAll(() => {
  installMockFetch();
});

describe("POST /agent/insights — 온톨로지 접지 클러스터 인사이트", () => {
  it("결정적 mock 응답을 반환하고, 모든 인사이트가 objectId 를 인용한다(HARD grounding)", async () => {
    const r = await runAgentInsights();
    expect(r.source).toContain("mock");
    expect(r.mode).toBe("insights");
    expect(r.traceId).toBeTruthy();
    // 실제 mock 온톨로지엔 GPU/노드가 있어 grounded 가 된다.
    expect(r.grounded).toBe(true);
    expect(r.insights.length).toBeGreaterThan(0);
    for (const ins of r.insights) {
      // 표시되는 모든 insight 는 반드시 인용을 가진다(인용 없는 건 서버가 드롭).
      expect(ins.citations.length).toBeGreaterThan(0);
    }
    // hallucination(인용 없음/가짜 id)은 드롭 카운트로 투명하게 노출된다.
    expect(r.droppedCount).toBeGreaterThanOrEqual(1);
    expect(r.groundingSummary).toBeTruthy();
  });

  it("결정성 — 같은 호출 2회 → 동일 insight id 집합", async () => {
    const a = await runAgentInsights();
    const b = await runAgentInsights();
    expect(new Set(a.insights.map((i) => i.id))).toEqual(new Set(b.insights.map((i) => i.id)));
  });

  it("audit transcript 가 응답 traceId 로 키잉되고 prompt/reasoning 을 포함", async () => {
    const r = await runAgentInsights();
    expect(r.audit.length).toBeGreaterThan(0);
    expect(r.audit.every((a) => a.traceId === r.traceId)).toBe(true);
    const kinds = new Set(r.audit.map((a) => a.kind));
    expect(kinds.has("prompt")).toBe(true);
    expect(kinds.has("reasoning")).toBe(true);
  });

  it("**read-only** — 인사이트 응답 어디에도 mutation/action 필드가 없다(two-tier 안전)", async () => {
    const r = await runAgentInsights();
    // AgentInsightRun 은 suggestedAction/steps(tool call) 을 갖지 않는다 — 표면에 mutation 유발 경로가 없음.
    for (const ins of r.insights) {
      expect(ins).not.toHaveProperty("suggestedAction");
    }
    expect(r).not.toHaveProperty("steps");
  });
});
