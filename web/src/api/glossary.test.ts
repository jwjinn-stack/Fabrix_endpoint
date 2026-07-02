// IMP-108 — 전역 glossary-as-data 테스트.
// 케이스: 스키마(category/short+why 규약) / 도메인 term 등재 / lookupTerm key+alias 대소문자 무시 /
//         미지→null(환각 금지) / relatedKeys 정합성 / STATUS_GLOSSARY 하위셋 회귀 0.
import { describe, it, expect } from "vitest";
import { GLOSSARY, lookupTerm, glossaryTerm, STATUS_TERM_KEYS } from "./glossary";
import { STATUS_GLOSSARY } from "./statusGlossary";

describe("glossary schema", () => {
  it("모든 term 에 category·term·short 이 있다", () => {
    for (const [key, t] of Object.entries(GLOSSARY)) {
      expect(t.term, key).toBeTruthy();
      expect(t.short, key).toBeTruthy();
      expect(t.category, key).toBeTruthy();
    }
  });

  it("short+why 는 1줄 규약(정보폭탄 금지 — 길이 상한·개행 없음)", () => {
    for (const [key, t] of Object.entries(GLOSSARY)) {
      expect(t.short.includes("\n"), key).toBe(false);
      expect(t.short.length, key).toBeLessThanOrEqual(120);
      if (t.why) {
        expect(t.why.includes("\n"), key).toBe(false);
        expect(t.why.length, key).toBeLessThanOrEqual(120);
      }
    }
  });
});

describe("도메인 용어 등재", () => {
  it("관측 도메인 핵심 term 이 데이터로 존재한다", () => {
    const expected = [
      "ttft", "p95", "p99", "prefill", "decode", "slo",
      "xid", "nvlink", "pcie", "ecc", "replica", "cordon", "drain",
      "throttle", "throttle-reason", "error-rate", "block-rate",
      "qps", "token-cost", "queue-depth", "concurrency", "backpressure",
    ];
    for (const k of expected) expect(GLOSSARY[k], k).toBeDefined();
  });

  it("카테고리 값이 유효 집합 안에 있다", () => {
    const valid = new Set(["incident-status", "latency", "gpu", "traffic"]);
    for (const [key, t] of Object.entries(GLOSSARY)) {
      expect(valid.has(t.category), `${key}:${t.category}`).toBe(true);
    }
  });
});

describe("lookupTerm", () => {
  it("key 로 조회(대소문자 무시)", () => {
    expect(lookupTerm("ttft")).toBe(GLOSSARY.ttft);
    expect(lookupTerm("TTFT")).toBe(GLOSSARY.ttft);
    expect(lookupTerm("  P95  ")).toBe(GLOSSARY.p95);
  });

  it("alias 로 조회(대소문자 무시)", () => {
    expect(lookupTerm("time to first token")).toBe(GLOSSARY.ttft);
    expect(lookupTerm("Time To First Token")).toBe(GLOSSARY.ttft);
    expect(lookupTerm("rate limit")).toBe(GLOSSARY.throttle);
    expect(lookupTerm("queries per second")).toBe(GLOSSARY.qps);
  });

  it("미지 용어는 null(환각 금지)", () => {
    expect(lookupTerm("nonexistent-term")).toBeNull();
    expect(lookupTerm("")).toBeNull();
    expect(lookupTerm("   ")).toBeNull();
  });
});

describe("relatedKeys 정합성", () => {
  it("relatedKeys 는 실제 존재하는 key 만 가리킨다", () => {
    for (const [key, t] of Object.entries(GLOSSARY)) {
      for (const rk of t.relatedKeys ?? []) {
        expect(GLOSSARY[rk], `${key}→${rk}`).toBeDefined();
      }
    }
  });
});

describe("StatusInfoTip 하위셋 회귀 0", () => {
  it("STATUS_GLOSSARY 는 상태 7개 key 그대로 노출한다", () => {
    expect(Object.keys(STATUS_GLOSSARY).sort()).toEqual([...STATUS_TERM_KEYS].sort());
  });

  it("glossaryTerm 문구는 IMP-97 원본과 동일하다", () => {
    expect(glossaryTerm("acked")?.term).toBe("확인·배정됨");
    expect(glossaryTerm("acked")?.short).toBe("누군가 이미 확인(ack)하고 담당으로 잡은 상태입니다.");
    expect(glossaryTerm("crit")?.term).toBe("위험(crit)");
    expect(glossaryTerm("unknown-status")).toBeUndefined();
  });
});
