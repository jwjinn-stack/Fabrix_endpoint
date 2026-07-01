// IMP-72 — 감지→객체 귀속 파생 레이어(순수) 테스트.
// attributeDetections 를 결정적 픽스처로 가드한다(백엔드 0개, Date.now 미의존 경로).
// 케이스: attribution 결정성·정확 객체 / confidence(신호수) / dedupe·state-transition 억제 / sustained breach / SUGGESTED_ACTION 매핑.
import { describe, it, expect } from "vitest";
import { attributeDetections, SUGGESTED_ACTION } from "./detection";
import type { OntologyLink, OntologyObject } from "./types";

// 척추: endpoint:e-slow --serves--> model:m --runsOn--> gpu:g --hostedBy--> node:n. + 정상 GPU(gpu:ok).
// 상류(GPU/Node)를 crit 으로 두어 감지 신호가 실린다. gpu:ok 는 정상 → 승격되지 않아야 한다(state transition).
const OBJECTS: OntologyObject[] = [
  { id: "endpoint:e-slow", type: "Endpoint", title: "느린 EP", props: { ready: false }, status: "crit", revision: 1 },
  { id: "model:m", type: "Model", title: "모델 M", props: { replicas: 2 }, status: "warn", revision: 1 },
  { id: "gpu:g", type: "GpuDevice", title: "GPU 0", props: { util_perc: 0.97, mem_perc: 0.93, throttle: "열(HW Thermal Slowdown), SW 열 제동(SW Thermal)" }, status: "crit", revision: 1 },
  { id: "node:n", type: "Node", title: "노드 N", props: { cpu_util: 0.94, net_err_per_s: 12 }, status: "crit", revision: 1 },
  { id: "gpu:ok", type: "GpuDevice", title: "정상 GPU", props: { util_perc: 0.4, mem_perc: 0.3, throttle: "제약 없음" }, status: "ok", revision: 1 },
];
const LINKS: OntologyLink[] = [
  { from: "endpoint:e-slow", to: "model:m", linkKind: "serves" },
  { from: "model:m", to: "gpu:g", linkKind: "runsOn" },
  { from: "gpu:g", to: "node:n", linkKind: "hostedBy" },
];

describe("attributeDetections — attribution(정확 객체 + 결정성)", () => {
  it("crit/warn 객체를 감지 알림으로 귀속하고, 정상(ok) 객체는 승격하지 않는다", () => {
    const alerts = attributeDetections(OBJECTS, LINKS);
    const ids = alerts.map((a) => a.objectId);
    expect(ids).toContain("gpu:g");
    expect(ids).toContain("node:n");
    expect(ids).toContain("model:m");
    // state-transition 억제 — 정상 GPU 는 스트립에 오르지 않는다.
    expect(ids).not.toContain("gpu:ok");
    // Endpoint 는 진입점 근거로만 쓰고 카드는 자원/모델에 귀속(카드 대상 타입 = Model/GpuDevice/Node).
    expect(ids).not.toContain("endpoint:e-slow");
  });

  it("같은 입력 → 동일 출력(결정적, Date.now 미의존)", () => {
    const a = attributeDetections(OBJECTS, LINKS);
    const b = attributeDetections(OBJECTS, LINKS);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("정렬은 통증(crit→warn) 우선 — crit GPU/Node 가 warn Model 보다 앞", () => {
    const alerts = attributeDetections(OBJECTS, LINKS);
    const gpuIdx = alerts.findIndex((a) => a.objectId === "gpu:g");
    const modelIdx = alerts.findIndex((a) => a.objectId === "model:m");
    expect(gpuIdx).toBeLessThan(modelIdx);
  });
});

describe("attributeDetections — confidence(신호 수 기반)", () => {
  it("신호 ≥2 → high, 1 → med", () => {
    const alerts = attributeDetections(OBJECTS, LINKS);
    const gpu = alerts.find((a) => a.objectId === "gpu:g")!;
    // GPU: firstAnomaly + throttle + saturation → 신호 ≥2 → high.
    expect(gpu.signals.length).toBeGreaterThanOrEqual(2);
    expect(gpu.confidence).toBe("high");
  });

  it("고립된 단일 신호 warn Model → med(신호 1건)", () => {
    const solo: OntologyObject[] = [
      { id: "model:solo", type: "Model", title: "고립 모델", props: {}, status: "warn", revision: 1 },
    ];
    const alerts = attributeDetections(solo, []);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].signals).toHaveLength(1);
    expect(alerts[0].confidence).toBe("med");
  });
});

describe("attributeDetections — dedupe / 근거 슬롯", () => {
  it("한 객체의 다중 신호는 카드 1장으로 dedupe 되고 signals[] 로 집계된다", () => {
    const alerts = attributeDetections(OBJECTS, LINKS);
    const gpuCards = alerts.filter((a) => a.objectId === "gpu:g");
    // 같은 객체 = 카드 1장(중복 카드 없음).
    expect(gpuCards).toHaveLength(1);
    // 여러 신호가 한 카드 안에 집계.
    expect(gpuCards[0].signals.length).toBeGreaterThan(1);
  });

  it("근거 신호는 인용(citation)과 관측 시각(observedAt)을 갖는다(grounding 강제)", () => {
    const alerts = attributeDetections(OBJECTS, LINKS);
    for (const a of alerts) {
      for (const s of a.signals) {
        expect(s.citation).toBeTruthy();
        expect(s.observedAt).toBeTruthy();
      }
    }
  });
});

describe("attributeDetections — sustained collapse(breachCount)", () => {
  it("직전 스냅샷에 이미 있던 객체는 breachCount=2(지속), 신규는 1", () => {
    const fresh = attributeDetections(OBJECTS, LINKS);
    expect(fresh.every((a) => a.breachCount === 1)).toBe(true);
    const prev = new Set(fresh.map((a) => a.objectId));
    const sustained = attributeDetections(OBJECTS, LINKS, { previousObjectIds: prev });
    expect(sustained.every((a) => a.breachCount === 2)).toBe(true);
  });
});

describe("attributeDetections — SUGGESTED_ACTION 매핑(GPU→drainGpu / Node→cordonNode / Model→scale·restart)", () => {
  it("타입별 추천 verb 가 정확히 매핑된다", () => {
    const alerts = attributeDetections(OBJECTS, LINKS);
    expect(alerts.find((a) => a.objectId === "gpu:g")!.suggestedAction?.actionType).toBe("drainGpu");
    expect(alerts.find((a) => a.objectId === "node:n")!.suggestedAction?.actionType).toBe("cordonNode");
    // warn Model → scaleReplicas(용량), crit Model → restartModel(기동 실패). 여기 model:m 은 warn.
    expect(alerts.find((a) => a.objectId === "model:m")!.suggestedAction?.actionType).toBe("scaleReplicas");
    // 정적 매핑 상수도 계약 유지.
    expect(SUGGESTED_ACTION.GpuDevice).toBe("drainGpu");
    expect(SUGGESTED_ACTION.Node).toBe("cordonNode");
  });

  it("crit Model → restartModel(상태 분기)", () => {
    const critModel: OntologyObject[] = [
      { id: "model:down", type: "Model", title: "죽은 모델", props: {}, status: "crit", revision: 1 },
    ];
    const alerts = attributeDetections(critModel, []);
    expect(alerts[0].suggestedAction?.actionType).toBe("restartModel");
  });

  it("추천 Action 은 target=objectId 로 바인딩(제안일 뿐 — 실행은 ActionForm)", () => {
    const alerts = attributeDetections(OBJECTS, LINKS);
    const gpu = alerts.find((a) => a.objectId === "gpu:g")!;
    expect(gpu.suggestedAction?.target).toBe("gpu:g");
  });
});

describe("attributeDetections — 추정 원인/가설 슬롯", () => {
  it("probableCause 는 '추정' 서술 + hypothesis 는 objectId 를 포함(/agent pre-fill)", () => {
    const alerts = attributeDetections(OBJECTS, LINKS);
    const gpu = alerts.find((a) => a.objectId === "gpu:g")!;
    expect(gpu.probableCause).toMatch(/추정/);
    expect(gpu.hypothesis).toContain("gpu:g");
  });
});
