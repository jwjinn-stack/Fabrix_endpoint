// IMP-72 — Kinetic 감지 mock 계약 테스트. GET /ontology/detections 를 client.fetchKineticAlerts 로
// 실제 라우터에 통과시킨다(프로젝트 ethos: 백엔드 0개). buildOntology() 스냅샷 재사용 + 결정적.
import { describe, it, expect, beforeAll } from "vitest";
import { installMockFetch } from "./mock";
import { fetchKineticAlerts } from "./client";

beforeAll(() => {
  installMockFetch();
});

describe("GET /ontology/detections — normal(감지→객체 귀속)", () => {
  it("KineticAlert[] 를 반환하고 각 알림이 4-슬롯 필드를 채운다", async () => {
    const r = await fetchKineticAlerts();
    expect(r.source).toContain("mock");
    expect(Array.isArray(r.alerts)).toBe(true);
    for (const a of r.alerts) {
      // [1] 영향 객체 — id/type/status. (IMP-94: backpressure Incident 도 승격 대상.)
      expect(a.objectId).toBeTruthy();
      expect(["Model", "GpuDevice", "Node", "Incident"]).toContain(a.objectType);
      // 승격된 알림은 정상(ok) 상태가 아니어야 한다(state transition 억제).
      expect(a.status).not.toBe("ok");
      // [2] 근거 — 신호 ≥1, 각 신호 인용/시각.
      expect(a.signals.length).toBeGreaterThan(0);
      for (const s of a.signals) {
        expect(s.citation).toBeTruthy();
        expect(s.label).toBeTruthy();
      }
      // [3] 추정 원인 + confidence(high/med).
      expect(a.probableCause).toBeTruthy();
      expect(["high", "med"]).toContain(a.confidence);
      // [4] 추천 Action(제안) + 가설.
      expect(a.hypothesis).toContain(a.objectId);
      if (a.suggestedAction) expect(a.suggestedAction.target).toBe(a.objectId);
    }
  });

  it("결정적 — 두 번 호출해도 같은 객체 집합을 귀속한다", async () => {
    const a = await fetchKineticAlerts();
    const b = await fetchKineticAlerts();
    expect(a.alerts.map((x) => x.objectId)).toEqual(b.alerts.map((x) => x.objectId));
  });

  it("응답에 mutating 액션 실행 흔적이 없다(제안만 — two-tier 안전)", async () => {
    const r = await fetchKineticAlerts();
    // suggestedAction 은 verb 이름 + target 만(실행 결과/상태 전이 없음).
    for (const a of r.alerts) {
      if (a.suggestedAction) {
        expect(Object.keys(a.suggestedAction).sort()).toEqual(["actionType", "target"]);
      }
    }
  });
});
