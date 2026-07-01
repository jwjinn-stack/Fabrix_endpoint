// IMP-61 — 내장 데모 시나리오 드라이버 테스트(순수, 백엔드 0개).
// 케이스: 결정적 로드 / 순서 있는 step / cordon+scale 종결 / capability 게이팅 정합 /
//        bad·missing seed graceful / evidence surface(buildRootCausePath) 재사용.
import { describe, it, expect } from "vitest";
import { buildDemoScenario, buildScenarioFrom, DEMO_ENTRY_ID } from "./demoScenario";
import { buildRootCausePath } from "./investigate";
import { ACTION_REGISTRY } from "../actions/registry";
import type { OntologyLink, OntologyObject } from "./types";

describe("buildDemoScenario — 결정적 로드", () => {
  it("두 번 호출해도 동일 entryId·동일 hop id 순서·동일 step id 순서(재현 가능)", () => {
    const a = buildDemoScenario();
    const b = buildDemoScenario();
    expect(a.entryId).toBe(DEMO_ENTRY_ID);
    expect(b.entryId).toBe(DEMO_ENTRY_ID);
    expect(a.path.hops.map((h) => h.id)).toEqual(b.path.hops.map((h) => h.id));
    expect(a.steps.map((s) => s.id)).toEqual(b.steps.map((s) => s.id));
    // 추정 근본원인(criticalId)도 재현.
    expect(a.path.criticalId).toBe(b.path.criticalId);
  });

  it("진입점에서 척추가 자동 확장되어 Endpoint→Model→GpuDevice→Node 를 포함한다", () => {
    const s = buildDemoScenario();
    expect(s.path.found).toBe(true);
    const types = s.path.hops.map((h) => h.object.type);
    expect(types.slice(0, 4)).toEqual(["Endpoint", "Model", "GpuDevice", "Node"]);
  });
});

describe("buildDemoScenario — 순서 있는 step", () => {
  it("steps 는 path.hops 순서와 정확히 정합한다(각 step.id 가 같은 위치의 hop id)", () => {
    const s = buildDemoScenario();
    expect(s.steps.length).toBe(s.path.hops.length);
    expect(s.steps.map((st) => st.id)).toEqual(s.path.hops.map((h) => h.id));
  });

  it("모든 step 은 사람용 narration(비어있지 않은 문자열)을 가진다", () => {
    const s = buildDemoScenario();
    for (const st of s.steps) {
      expect(typeof st.narration).toBe("string");
      expect(st.narration.length).toBeGreaterThan(0);
    }
  });
});

describe("buildDemoScenario — cordon+scale 로 종결(권장 조치)", () => {
  it("추정 근본원인(criticalId)이 포화 상류(GpuDevice 또는 Node)로 수렴한다", () => {
    const s = buildDemoScenario();
    const crit = s.path.hops.find((h) => h.id === s.path.criticalId);
    expect(crit).toBeDefined();
    expect(["GpuDevice", "Node"]).toContain(crit!.object.type);
  });

  it("시나리오는 cordonNode(Node)와 scaleReplicas(Model) 권장 조치를 모두 담는다", () => {
    const s = buildDemoScenario();
    const actions = s.steps.filter((st) => st.action).map((st) => st.action!);
    const cordon = actions.find((a) => a.actionType === "cordonNode");
    const scale = actions.find((a) => a.actionType === "scaleReplicas");
    expect(cordon).toBeDefined();
    expect(scale).toBeDefined();
    // cordon 은 추정 근본원인 Node 를 대상으로 한다(그래프 위 조치).
    const critNode = s.path.hops.find((h) => h.id === s.path.criticalId && h.object.type === "Node");
    if (critNode) expect(cordon!.target).toBe(critNode.id);
    // 대상 Object 는 실제 fixture 에 존재한다(dangling 아님).
    const ids = new Set(s.objects.map((o) => o.id));
    expect(ids.has(cordon!.target)).toBe(true);
    expect(ids.has(scale!.target)).toBe(true);
  });
});

describe("buildDemoScenario — capability 게이팅 정합", () => {
  it("권장 조치 verb 는 ACTION_REGISTRY 에 존재하고 requiredCap 을 가진다(observe 프로파일에서 자연 비활성)", () => {
    const s = buildDemoScenario();
    for (const st of s.steps) {
      if (!st.action) continue;
      const spec = ACTION_REGISTRY[st.action.actionType];
      expect(spec).toBeDefined();
      // cordonNode/scaleReplicas 는 write capability 를 요구한다(mutating).
      expect(spec.requiredCap).toBeTruthy();
      // 대상 Object Type 이 verb 의 target 과 일치(계약 정합).
      const targetObj = s.objects.find((o) => o.id === st.action!.target);
      expect(targetObj?.type).toBe(spec.target);
    }
  });
});

describe("buildScenarioFrom — evidence surface 재사용(traversal 재구현 아님)", () => {
  it("path 는 buildRootCausePath 산출과 동일한 hop id 순서(단일 출처)", () => {
    const s = buildDemoScenario();
    const direct = buildRootCausePath(s.objects, s.links, s.entryId);
    expect(s.path.hops.map((h) => h.id)).toEqual(direct.hops.map((h) => h.id));
    expect(s.path.criticalId).toBe(direct.criticalId);
  });
});

describe("buildScenarioFrom — bad / missing seed graceful", () => {
  it("미지 entryId → path.found=false, steps 비어있음(throw 없음)", () => {
    const objs: OntologyObject[] = [
      { id: "endpoint:x", type: "Endpoint", title: "X", props: {}, status: "ok", revision: 1 },
    ];
    const s = buildScenarioFrom(objs, [], "endpoint:nope");
    expect(s.path.found).toBe(false);
    expect(s.steps).toEqual([]);
  });

  it("빈 fixture → steps 비어있음(throw 없음)", () => {
    const s = buildScenarioFrom([], [], "");
    expect(s.path.found).toBe(false);
    expect(s.steps).toEqual([]);
  });

  it("고립 Endpoint(링크 없음) → 단일 step(진입만), 권장 조치 없음", () => {
    const iso: OntologyObject = { id: "endpoint:iso", type: "Endpoint", title: "고립", props: { ready: true }, status: "ok", revision: 1 };
    const links: OntologyLink[] = [];
    const s = buildScenarioFrom([iso], links, "endpoint:iso");
    expect(s.path.found).toBe(true);
    expect(s.steps.length).toBe(1);
    expect(s.steps[0].id).toBe("endpoint:iso");
    expect(s.steps.some((st) => st.action)).toBe(false);
  });
});
