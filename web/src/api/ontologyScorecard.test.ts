// IMP-68 — 운영 준비도 스코어카드 순수 파생 테스트.
// buildScorecard 는 순수(DOM 무관·결정적) → props/status 만으로 채점·요약·정렬을 가드한다.
import { describe, it, expect } from "vitest";
import { buildScorecard, SCORE_GROUPS, SCORABLE_TYPES } from "./ontologyScorecard";
import type { OntologyObject } from "./types";

// 정상 Endpoint(ready + app_id) — 전 규칙 pass 예상.
const okEndpoint: OntologyObject = {
  id: "endpoint:ep-ok", type: "Endpoint", title: "EP OK", status: "ok", revision: 1,
  props: { namespace: "fabrix", model: "m", backend: "vllm", replicas: 2, app_id: "app-a", dept_id: "d-a", ready: true },
};
// 위험 Endpoint(ready=false, 오너 없음) — status-healthy·deployed·has-owner fail 예상.
const critEndpoint: OntologyObject = {
  id: "endpoint:ep-crit", type: "Endpoint", title: "EP CRIT", status: "crit", revision: 1,
  props: { namespace: "fabrix", model: "m", backend: "vllm", replicas: 1, ready: false },
};
// 정상 Model(provider + replicas>0).
const okModel: OntologyObject = {
  id: "model:m-ok", type: "Model", title: "Model OK", status: "ok", revision: 1,
  props: { name: "m", provider: "Google", type: "chat", context_window: 131072, pattern: "disagg", gpu: 2, replicas: 2 },
};
// 정상 GpuDevice.
const okGpu: OntologyObject = {
  id: "gpu:g0", type: "GpuDevice", title: "GPU 0", status: "ok", revision: 1,
  props: { device: "gpu-node-01/gpu0", util_perc: 0.5, temp_c: 70, xid_recent: 0, throttle: "제약 없음" },
};
// 채점 제외 타입 — Trace/Incident.
const someTrace: OntologyObject = {
  id: "trace:t0", type: "Trace", title: "t0", status: "ok", revision: 1,
  props: { model: "m", endpoint: "ep", total_ms: 100, ttft_ms: 20, decision: "allowed" },
};
const someIncident: OntologyObject = {
  id: "incident:i0", type: "Incident", title: "inc", status: "crit", revision: 1,
  props: { dedup_key: "endpoint:x:not-ready", severity: "critical", state: "triggered", count: 1 },
};

describe("buildScorecard — per-instance 채점", () => {
  it("위험 Endpoint(ready=false, 오너 없음) → status-healthy·deployed·has-owner fail, atRisk=true", () => {
    const { instances } = buildScorecard([critEndpoint]);
    const ins = instances.find((i) => i.object.id === "endpoint:ep-crit")!;
    expect(ins).toBeTruthy();
    const byId = Object.fromEntries(ins.results.map((r) => [r.id, r.pass]));
    expect(byId["status-healthy"]).toBe(false); // crit
    expect(byId["deployed"]).toBe(false);        // ready=false
    expect(byId["has-owner"]).toBe(false);        // app_id/dept_id 없음
    expect(ins.atRisk).toBe(true);
  });

  it("정상 Endpoint(ready + app_id) → 전 규칙 pass, atRisk=false", () => {
    const { instances } = buildScorecard([okEndpoint]);
    const ins = instances[0];
    expect(ins.failCount).toBe(0);
    expect(ins.passCount).toBe(ins.total);
    expect(ins.atRisk).toBe(false);
  });
});

describe("buildScorecard — rule groups", () => {
  it("결과가 Production Readiness/Observability/Ownership 3그룹으로 묶인다", () => {
    const { instances, summary } = buildScorecard([okEndpoint, okModel, okGpu]);
    // 각 인스턴스 결과에 3그룹이 모두 존재.
    for (const ins of instances) {
      const groups = new Set(ins.results.map((r) => r.group));
      for (const g of SCORE_GROUPS) expect(groups.has(g)).toBe(true);
    }
    // 요약 byGroup 도 3그룹 고정 순서.
    expect(summary.byGroup.map((g) => g.group)).toEqual(SCORE_GROUPS);
  });
});

describe("buildScorecard — '주의 요약' 카운트", () => {
  it("failingRuleCount = 인스턴스별 fail 합, atRiskCount = crit/PR-fail 인스턴스 수", () => {
    const { instances, summary } = buildScorecard([okEndpoint, critEndpoint, okModel]);
    const totalFail = instances.reduce((s, i) => s + i.failCount, 0);
    expect(summary.failingRuleCount).toBe(totalFail);
    expect(summary.failingRuleCount).toBeGreaterThan(0); // critEndpoint 가 fail 을 만든다
    // atRisk 은 critEndpoint 1건.
    expect(summary.atRiskCount).toBe(1);
    expect(summary.scored).toBe(3);
  });
});

describe("buildScorecard — 정렬(결정적)", () => {
  it("at-risk 인스턴스가 상단, 그다음 failCount 내림차순, 그다음 id 사전순", () => {
    // ok 2건 + crit 1건 → crit 이 맨 위.
    const { instances } = buildScorecard([okEndpoint, okModel, critEndpoint]);
    expect(instances[0].object.id).toBe("endpoint:ep-crit");
    expect(instances[0].atRisk).toBe(true);
    // 나머지는 at-risk 아님.
    expect(instances.slice(1).every((i) => !i.atRisk)).toBe(true);
  });

  it("retry(결정성): 같은 입력 재호출 → 동일 순서·동일 카운트", () => {
    const a = buildScorecard([okModel, critEndpoint, okEndpoint, okGpu]);
    const b = buildScorecard([okModel, critEndpoint, okEndpoint, okGpu]);
    expect(a.instances.map((i) => i.object.id)).toEqual(b.instances.map((i) => i.object.id));
    expect(a.summary.failingRuleCount).toBe(b.summary.failingRuleCount);
    expect(a.summary.atRiskCount).toBe(b.summary.atRiskCount);
  });
});

describe("buildScorecard — 채점 대상 필터", () => {
  it("Trace/Incident 는 instances 에서 제외(SCORABLE 만)", () => {
    const { instances } = buildScorecard([okEndpoint, someTrace, someIncident, okModel]);
    const types = new Set(instances.map((i) => i.object.type));
    expect(types.has("Trace")).toBe(false);
    expect(types.has("Incident")).toBe(false);
    // SCORABLE 만 남는다.
    expect(instances.every((i) => SCORABLE_TYPES.includes(i.object.type))).toBe(true);
    expect(instances).toHaveLength(2);
  });
});

describe("buildScorecard — all-pass / empty", () => {
  it("all-pass: 전부 정상+오너 있는 입력 → allPass=true, atRiskCount=0", () => {
    const { summary } = buildScorecard([okEndpoint, okModel, okGpu]);
    expect(summary.failingRuleCount).toBe(0);
    expect(summary.allPass).toBe(true);
    expect(summary.atRiskCount).toBe(0);
  });

  it("empty: 빈 입력 → scored=0, allPass=false(throw 없음)", () => {
    const { instances, summary } = buildScorecard([]);
    expect(instances).toHaveLength(0);
    expect(summary.scored).toBe(0);
    expect(summary.allPass).toBe(false);
  });
});

describe("buildScorecard — ownership fail", () => {
  it("app_id/dept_id 둘 다 없는 Endpoint → has-owner fail", () => {
    const orphan: OntologyObject = {
      id: "endpoint:orphan", type: "Endpoint", title: "Orphan", status: "ok", revision: 1,
      props: { namespace: "fabrix", model: "m", backend: "vllm", replicas: 1, ready: true },
    };
    const { instances } = buildScorecard([orphan]);
    const owner = instances[0].results.find((r) => r.id === "has-owner")!;
    expect(owner.pass).toBe(false);
    // 하지만 상태 정상·배포됨이라 at-risk 는 아니다(오너십 fail 은 PR 그룹이 아님).
    expect(instances[0].atRisk).toBe(false);
  });
});
