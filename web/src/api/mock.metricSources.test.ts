// IMP-74 — 메트릭 소스 / 익스포터 커버리지 매트릭스: mock 파생·3단 상태·NVML 규칙·GAP 셀.
// installMockFetch + client.fetchMetricSourceCoverage 로 실제 mock 라우터(GET /api/v1/metric-sources)를 통과시킨다.
import { describe, it, expect, beforeAll } from "vitest";
import { installMockFetch, deriveSourceStatus, SCRAPE_STALE_SEC } from "./mock";
import { fetchMetricSourceCoverage } from "./client";
import type { ObjectType } from "./types";

beforeAll(() => {
  installMockFetch();
});

describe("deriveSourceStatus — 3단 상태(up 단독 금지)", () => {
  it("up=0 → NOT_CONFIGURED", () => {
    expect(deriveSourceStatus({ job: "j", up: 0, scrape_samples_scraped: 0, last_scrape_age_sec: 0 })).toBe("NOT_CONFIGURED");
    // up=0 이면 샘플/age 와 무관하게 미구성.
    expect(deriveSourceStatus({ job: "j", up: 0, scrape_samples_scraped: 999, last_scrape_age_sec: 1 })).toBe("NOT_CONFIGURED");
  });

  it("up=1 & samples=0 → CONFIGURED_NO_DATA (타깃 살아있어도 계열 빔)", () => {
    expect(deriveSourceStatus({ job: "j", up: 1, scrape_samples_scraped: 0, last_scrape_age_sec: 5 })).toBe("CONFIGURED_NO_DATA");
  });

  it("up=1 & age 초과 → CONFIGURED_NO_DATA (신선도 정체)", () => {
    expect(deriveSourceStatus({ job: "j", up: 1, scrape_samples_scraped: 100, last_scrape_age_sec: SCRAPE_STALE_SEC + 1 })).toBe("CONFIGURED_NO_DATA");
  });

  it("up=1 & samples>0 & 신선 → HEALTHY", () => {
    expect(deriveSourceStatus({ job: "j", up: 1, scrape_samples_scraped: 100, last_scrape_age_sec: 5 })).toBe("HEALTHY");
  });

  it("**핵심**: up=1 단독으로는 HEALTHY 가 아니다(계열 없으면 무데이터)", () => {
    // up 만 보고 HEALTHY 로 판정하면 "타깃 살아있는데 메트릭 빔"을 놓친다 — 이 회귀 가드.
    expect(deriveSourceStatus({ job: "j", up: 1, scrape_samples_scraped: 0, last_scrape_age_sec: 0 })).not.toBe("HEALTHY");
  });
});

describe("GET /metric-sources — 소스 축(익스포터 카드)", () => {
  it("6개 익스포터 소스를 반환(node/ksm/cAdvisor/DCGM/process/blackbox)", async () => {
    const cov = await fetchMetricSourceCoverage();
    const ids = new Set(cov.sources.map((s) => s.id));
    for (const id of ["node_exporter", "kube-state-metrics", "cadvisor", "dcgm-exporter", "process-exporter", "blackbox-exporter"]) {
      expect(ids.has(id)).toBe(true);
    }
    expect(cov.sources).toHaveLength(6);
  });

  it("각 소스에 대상 온톨로지 객체 타입 + protocol + 메트릭 계열", async () => {
    const cov = await fetchMetricSourceCoverage();
    const VALID: ObjectType[] = ["Model", "Endpoint", "Service", "GpuDevice", "Node", "Trace", "Incident"];
    for (const s of cov.sources) {
      expect(s.targetTypes.length).toBeGreaterThan(0);
      for (const t of s.targetTypes) expect(VALID).toContain(t);
      expect(["prometheus", "otlp"]).toContain(s.protocol); // (4) OTel 정합
      expect(s.families.length).toBeGreaterThan(0);
    }
  });

  it("카드 status 가 deriveSourceStatus(scrape) 와 일치(단일 출처 — 실 스왑 정합)", async () => {
    const cov = await fetchMetricSourceCoverage();
    for (const s of cov.sources) {
      expect(s.status).toBe(deriveSourceStatus(s.scrape));
    }
  });

  it("3단 상태가 모두 표현된다(NOT_CONFIGURED·CONFIGURED_NO_DATA·HEALTHY 각 ≥1)", async () => {
    const cov = await fetchMetricSourceCoverage();
    const statuses = new Set(cov.sources.map((s) => s.status));
    expect(statuses.has("HEALTHY")).toBe(true);
    expect(statuses.has("CONFIGURED_NO_DATA")).toBe(true);
    expect(statuses.has("NOT_CONFIGURED")).toBe(true);
  });
});

describe("NVML 규칙 — 독립 카드 금지, DCGM 카드 안 갭 배지", () => {
  it("소스 목록에 NVML 독립 카드가 없다(DCGM 하위 라이브러리)", async () => {
    const cov = await fetchMetricSourceCoverage();
    for (const s of cov.sources) {
      expect(s.id.toLowerCase()).not.toContain("nvml");
      expect(s.label.toLowerCase()).not.toContain("nvml");
    }
  });

  it("DCGM 카드 안 per-process 미지원 갭 배지(이슈 #521) — 잘못된 신뢰 방지", async () => {
    const cov = await fetchMetricSourceCoverage();
    const dcgm = cov.sources.find((s) => s.id === "dcgm-exporter");
    expect(dcgm).toBeDefined();
    const note = dcgm!.notes.find((n) => n.label.includes("per-process"));
    expect(note).toBeDefined();
    expect(note!.tone).toBe("warn");
    expect(note!.issue).toBe("#521");
    // 근거 카피에 원천 한계·귀속 불가가 담겨야 함(과신 방지).
    expect(note!.detail).toMatch(/NVML|per-device|귀속/);
  });
});

describe("커버리지 갭 — 신호×객체 셀(1급)", () => {
  it("3개 GAP 셀이 존재(GpuDevice×per-process / Model×container-memory / Endpoint×TCP-retransmit)", async () => {
    const cov = await fetchMetricSourceCoverage();
    const gaps = cov.coverage.filter((c) => !c.covered);
    expect(gaps.length).toBeGreaterThanOrEqual(3);

    const gpuGap = gaps.find((c) => c.objectType === "GpuDevice" && /per-process/i.test(c.signal));
    expect(gpuGap).toBeDefined();
    expect(gpuGap!.reason).toMatch(/DCGM\/NVML|time-slicing|귀속/);
    expect(gpuGap!.issue).toBe("#521");

    const podGap = gaps.find((c) => c.objectType === "Model" && /container/i.test(c.signal));
    expect(podGap).toBeDefined();
    expect(podGap!.reason).toMatch(/cAdvisor/);
    expect(podGap!.recommended).toBe("cadvisor");

    const epGap = gaps.find((c) => c.objectType === "Endpoint" && /retransmit|TCP/i.test(c.signal));
    expect(epGap).toBeDefined();
    expect(epGap!.reason).toMatch(/node|process-exporter|blackbox/);
  });

  it("각 GAP 셀은 드릴다운 또는 추천 익스포터(스파이크/근거 grounding) 링크를 가진다", async () => {
    const cov = await fetchMetricSourceCoverage();
    const gaps = cov.coverage.filter((c) => !c.covered);
    for (const g of gaps) {
      // 클릭 시 갈 곳이 반드시 있어야 함(드릴다운 화면 또는 추천 익스포터).
      expect(!!g.drilldown || !!g.recommended).toBe(true);
    }
  });

  it("커버된 셀(대비군)도 함께 제공 — 매트릭스가 '무엇이 되고 무엇이 갭인지'를 보여준다", async () => {
    const cov = await fetchMetricSourceCoverage();
    const covered = cov.coverage.filter((c) => c.covered);
    expect(covered.length).toBeGreaterThan(0);
    for (const c of covered) expect(c.sourceId).toBeTruthy();
  });

  it("결정적 — 두 번 호출해도 소스·커버리지 구조가 동일", async () => {
    const a = await fetchMetricSourceCoverage();
    const b = await fetchMetricSourceCoverage();
    expect(a.sources.map((s) => `${s.id}:${s.status}`)).toEqual(b.sources.map((s) => `${s.id}:${s.status}`));
    expect(a.coverage.map((c) => `${c.objectType}:${c.signal}:${c.covered}`)).toEqual(b.coverage.map((c) => `${c.objectType}:${c.signal}:${c.covered}`));
  });
});
