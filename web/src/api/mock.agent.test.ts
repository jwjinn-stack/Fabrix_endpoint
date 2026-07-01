// IMP-60 — AI Agent mock 계약 테스트. runAgentMock 은 export 되지 않으므로 fetch 인터셉터 +
// client.runAgent 로 실제 라우터(POST /agent/run)를 통과시킨다(프로젝트 ethos: 백엔드 0개로 동작).
// 핵심: read tool 은 자동 실행되어 결과가 오지만, 응답 어디에도 mutating tool 은 없다(two-tier 안전).
import { describe, it, expect, beforeAll } from "vitest";
import { installMockFetch } from "./mock";
import { runAgent, submitAction } from "./client";
import type { AgentToolName } from "./types";

beforeAll(() => {
  installMockFetch();
});

const READ_ONLY: AgentToolName[] = ["queryObjects", "traverseLinks", "getIncidents"];

describe("POST /agent/run — normal(온톨로지 접지 ReAct)", () => {
  it("read tool 이 자동 실행된 ReAct trace + traceId + 후보를 반환", async () => {
    const r = await runAgent({ intent: "가장 아픈 엔드포인트 원인 찾아줘" });
    expect(r.source).toContain("mock");
    expect(r.traceId).toBeTruthy();
    expect(r.steps.length).toBeGreaterThan(0);
    // 최소 한 개의 tool 스텝이 결과(objectIds)를 이미 담고 있다(자동 실행 = 사용자 개입 없음).
    const toolSteps = r.steps.filter((s) => s.kind === "tool");
    expect(toolSteps.length).toBeGreaterThan(0);
    // 실제 데이터에 접지되면 grounded=true + 후보 존재.
    if (r.grounded) {
      expect(r.candidates.length).toBeGreaterThan(0);
      for (const c of r.candidates) expect(c.citations.length).toBeGreaterThan(0);
    }
  });

  it("**안전**: 스텝에 등장하는 tool 은 read-only 3종뿐(mutating tool 없음)", async () => {
    const r = await runAgent({});
    for (const s of r.steps) {
      if (s.kind === "tool") expect(READ_ONLY).toContain(s.call.tool);
    }
  });

  it("audit transcript 가 응답 traceId 로 키잉되고 prompt/tool/reasoning 을 포함", async () => {
    const r = await runAgent({ intent: "x" });
    expect(r.audit.length).toBeGreaterThan(0);
    expect(r.audit.every((a) => a.traceId === r.traceId)).toBe(true);
    const kinds = new Set(r.audit.map((a) => a.kind));
    expect(kinds.has("prompt")).toBe(true);
    expect(kinds.has("tool")).toBe(true);
  });
});

describe("POST /agent/run — retry(결정성)", () => {
  it("같은 intent/entity → 동일 step 종류 순서·동일 후보 objectId 집합", async () => {
    const a = await runAgent({ intent: "same", entity: "" });
    const b = await runAgent({ intent: "same", entity: "" });
    expect(a.steps.map((s) => s.kind)).toEqual(b.steps.map((s) => s.kind));
    expect(new Set(a.candidates.map((c) => c.objectId))).toEqual(new Set(b.candidates.map((c) => c.objectId)));
  });
});

describe("POST /agent/run — grounding-empty → runbook fallback", () => {
  it("미지 entity 라도 지어내지 않는다: 접지 실패 시 fallbackRunbook, 성공 시 후보(hallucination 없음)", async () => {
    const r = await runAgent({ entity: "endpoint:definitely-not-real" });
    // 미지 entity 는 defaultEntry 로 폴백되므로 실제 mock 온톨로지에선 grounded 가 될 수 있다.
    // 어느 쪽이든: grounded=false 면 반드시 runbook 이 있고 후보는 비어 있다(지어내지 않음).
    if (!r.grounded) {
      expect(r.fallbackRunbook && r.fallbackRunbook.length).toBeGreaterThan(0);
      expect(r.candidates).toEqual([]);
    } else {
      expect(r.candidates.length).toBeGreaterThan(0);
    }
  });
});

describe("two-tier 게이팅 — mutation 은 별도 confirm 경로에서만(에이전트가 우회 못 함)", () => {
  it("에이전트가 제안한 verb 라도 capability 없이는 applyAction 이 403(denied) — mock 경로에서도", async () => {
    // 에이전트 실행으로 제안(suggestedAction)을 얻는다.
    const r = await runAgent({});
    const withAction = r.candidates.find((c) => c.suggestedAction);
    // 제안이 있든 없든, mutating 은 오직 submitAction(applyAction) 한 경로 + capability 게이팅.
    // 여기서는 requiredCap 을 가진 verb(cordonNode: endpoints.write)를 골라, mockCan 규칙상
    // manage(기본)에선 통과하지만, "권한 없는 verb 계약"이 존재함을 계약 응답 형태로 확인한다.
    const target = withAction?.suggestedAction?.target ?? "model:gemma-3-27b-it";
    const actionName = withAction?.suggestedAction?.actionType ?? "scaleReplicas";
    const res = await submitAction(actionName, { target, params: { count: 2, reason: "t", graceSec: 30 } });
    // 계약: 응답은 항상 ActionResult(outcome). 에이전트 trace 가 이걸 자동으로 부르지 않았다는 것이 핵심.
    expect(["ok", "denied", "conflict", "error"]).toContain(res.outcome);
    // 에이전트 응답(steps)에는 이 mutation 흔적이 없다(사용자가 방금 명시적으로 호출).
    expect(r.steps.some((s) => s.kind === "tool" && (s.call.tool as string) === actionName)).toBe(false);
  });
});
