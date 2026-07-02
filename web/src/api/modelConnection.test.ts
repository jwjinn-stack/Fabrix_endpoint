import { describe, it, expect, beforeEach } from "vitest";
import {
  loadModelConfig, saveModelConfig, resolveConnState, perceivedLatencyLabel,
  DEFAULT_MODEL_CONFIG, DYNAMO_PRESET, TTFT_DEGRADED_MS, LATENCY_DEGRADED_MS,
  type ModelConnConfig, type ProbeResult,
} from "./modelConnection";

// IMP-82 — 로컬 모델 연결 상태 판정(순수)·설정 영속 가드.
//   핵심 불변식: **mock 은 절대 "연결됨"으로 위장하지 않는다**(정직성 direction 8).

const CFG = (over: Partial<ModelConnConfig> = {}): ModelConnConfig => ({
  endpoint: "http://localhost:8000", model: "", timeoutMs: 8000, ...over,
});
const PROBE = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  healthOk: true, models: ["m-a"], resolvedModel: "m-a", modelMatch: true, latencyMs: 120, ttftMs: null, ...over,
});

describe("IMP-82 — resolveConnState 정직성 불변식", () => {
  it("mock 이면 probe 유무와 무관하게 'mock' 상태·무채색·라벨에 'mock'(NOT '연결됨')", () => {
    const r = resolveConnState(PROBE(), CFG(), /* mock */ true);
    expect(r.state).toBe("mock");
    expect(r.tone).toBe("neutral");
    expect(r.label).toContain("mock");
    expect(r.label).not.toContain("연결됨");
    // 심지어 health 200 + 모델 일치인 probe 를 넘겨도 mock 은 green 이 되지 않는다.
    expect(r.tone).not.toBe("green");
  });

  it("endpoint 미구성(실경로) → offline/'미구성'(무채색, 위장 없음)", () => {
    const r = resolveConnState(null, CFG({ endpoint: "" }), false);
    expect(r.state).toBe("offline");
    expect(r.label).toBe("미구성");
  });

  it("probe 이전(실경로) → 확인 중(무채색)", () => {
    const r = resolveConnState(null, CFG(), false);
    expect(r.label).toBe("확인 중…");
  });
});

describe("IMP-82 — resolveConnState 상태 판정", () => {
  it("health 실패 → offline(red)", () => {
    const r = resolveConnState(PROBE({ healthOk: false, error: "health 503" }), CFG(), false);
    expect(r.state).toBe("offline");
    expect(r.tone).toBe("red");
  });

  it("health 200 + 구성 모델 존재 → online(green), 라벨에 모델명", () => {
    const r = resolveConnState(PROBE({ models: ["m-a"], resolvedModel: "m-a", modelMatch: true }), CFG({ model: "m-a" }), false);
    expect(r.state).toBe("online");
    expect(r.tone).toBe("green");
    expect(r.label).toContain("m-a");
    expect(r.label).toContain("연결됨");
  });

  it("health 200 + 구성 모델이 목록에 없음 → degraded(amber, '모델 불일치')", () => {
    const r = resolveConnState(PROBE({ models: ["other"], resolvedModel: "other", modelMatch: false }), CFG({ model: "m-wanted" }), false);
    expect(r.state).toBe("degraded");
    expect(r.tone).toBe("amber");
    expect(r.label).toBe("모델 불일치");
  });

  it(`health 200 + TTFT ≥ ${TTFT_DEGRADED_MS}ms → degraded(지연)`, () => {
    const r = resolveConnState(PROBE({ ttftMs: TTFT_DEGRADED_MS + 50 }), CFG(), false);
    expect(r.state).toBe("degraded");
    expect(r.label).toBe("지연");
  });

  it(`health 200 + 왕복 ≥ ${LATENCY_DEGRADED_MS}ms(TTFT 없음) → degraded(지연)`, () => {
    const r = resolveConnState(PROBE({ latencyMs: LATENCY_DEGRADED_MS + 100, ttftMs: null }), CFG(), false);
    expect(r.state).toBe("degraded");
  });

  it("모델명 비우면 첫 로드 모델 수용 → online", () => {
    const r = resolveConnState(PROBE({ models: ["first"], resolvedModel: "first", modelMatch: true }), CFG({ model: "" }), false);
    expect(r.state).toBe("online");
  });
});

describe("IMP-82 — 지연 노출(TTFT 우선)", () => {
  it("ttftMs 있으면 TTFT 우선 노출", () => {
    const r = resolveConnState(PROBE({ ttftMs: 300, latencyMs: 500 }), CFG({ model: "m-a" }), false);
    expect(r.perceivedMs).toBe(300);
    expect(perceivedLatencyLabel(r)).toContain("TTFT");
  });
  it("ttftMs 없으면 왕복(latency) 노출", () => {
    const r = resolveConnState(PROBE({ ttftMs: null, latencyMs: 480 }), CFG({ model: "m-a" }), false);
    expect(r.perceivedMs).toBe(480);
    expect(perceivedLatencyLabel(r)).toContain("480");
  });
});

describe("IMP-82 — 설정 영속(localStorage)", () => {
  beforeEach(() => localStorage.clear());

  it("저장 없으면 기본값(빈 endpoint — 정직히 미구성)", () => {
    expect(loadModelConfig()).toEqual(DEFAULT_MODEL_CONFIG);
    expect(loadModelConfig().endpoint).toBe("");
  });

  it("save → load round-trip", () => {
    const cfg = CFG({ endpoint: "http://x:8000", model: "m-1", timeoutMs: 5000 });
    saveModelConfig(cfg);
    expect(loadModelConfig()).toEqual(cfg);
  });

  it("깨진 JSON → 기본값 graceful", () => {
    localStorage.setItem("fabrix.modelConn", "{not json");
    expect(loadModelConfig()).toEqual(DEFAULT_MODEL_CONFIG);
  });

  it("Dynamo 프리셋은 :8000 endpoint", () => {
    expect(DYNAMO_PRESET.endpoint).toContain(":8000");
  });
});
