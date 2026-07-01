// IMP-81 — 온톨로지 스냅샷 요청단위 메모이즈 + writeback ↔ 재구성 정합(revision 병합) 가드.
// buildOntology 는 export 되지 않으므로(내부 팩토리) fetch 인터셉터 + client 로 실제 라우터를 통과시킨다
// (프로젝트 ethos: 백엔드 0개로 동작). 동작 보존 리팩터라 기존 스위트는 무수정 통과하고,
// 여기서는 "직접 조회 == 재구성 그래프" 정합과 결정성·409·agent 불변을 추가로 잠근다.
import { describe, it, expect, beforeAll } from "vitest";
import { installMockFetch } from "./mock";
import {
  fetchOntologyObjects, fetchOntologyLinks, fetchOntologyObject, submitAction, runAgent,
} from "./client";

beforeAll(() => {
  installMockFetch();
});

describe("요청단위 메모이즈 — 응답 내부 정합", () => {
  it("한 요청의 objects 와 그 이웃 links 가 dangling 없이 정합(메모이즈가 응답을 깨지 않음)", async () => {
    const objs = await fetchOntologyObjects();
    const ids = new Set(objs.objects.map((o) => o.id));
    // 각 object 의 링크를 병렬 수집(각 요청은 자체 스냅샷을 공유). 링크 양끝이 실재 object 여야 한다.
    const results = await Promise.all(objs.objects.slice(0, 12).map((o) => fetchOntologyLinks(o.id)));
    results.forEach((lr, i) => {
      const oid = objs.objects[i].id;
      for (const l of lr.links) {
        expect(ids.has(l.from)).toBe(true);
        expect(ids.has(l.to)).toBe(true);
        expect(l.from === oid || l.to === oid).toBe(true);
      }
    });
  }, 20000);
});

describe("writeback ↔ 재구성 정합 — direct-fetch == rebuilt-graph (revision 병합)", () => {
  it("action 후 직접 조회·재구성 그래프·action 응답 object 가 완전히 동일(status/revision/last_action)", async () => {
    // 대상 = 첫 Model. 결정적 전이(scaleReplicas → warn) 로 override 를 얹는다.
    const before = await fetchOntologyObjects("Model");
    const target = before.objects[0];
    const res = await submitAction("scaleReplicas", {
      target: target.id, params: { count: 3 }, revision: target.revision,
      idempotencyKey: "imp81_merge_" + target.id,
    });
    expect(res.outcome).toBe("ok");
    const acted = res.object!;

    // (a) 직접 조회(GET /ontology/objects/:id) — 단일 canonical 경로.
    const direct = await fetchOntologyObject(target.id);
    // (b) 재구성 그래프 안의 같은 id(GET /ontology/objects) — 전체 rebuild 경로.
    const rebuilt = (await fetchOntologyObjects("Model")).objects.find((o) => o.id === target.id)!;

    // 세 경로가 mergeOverride 하나에서 나오므로 status·revision·last_action 이 어긋날 수 없다.
    for (const view of [direct, rebuilt]) {
      expect(view.status).toBe(acted.status);
      expect(view.revision).toBe(acted.revision);
      expect((view.props as Record<string, unknown>).last_action).toBe("scaleReplicas");
    }
    // revision 은 실제로 증가했다(override 반영 확인).
    expect(rebuilt.revision).toBe(target.revision + 1);
  });
});

describe("409 stale-write — 정합 병합 후에도 그대로", () => {
  it("현재보다 낮은 revision 재시도 → conflict + 사유", async () => {
    const m = (await fetchOntologyObjects("Model")).objects[0];
    // 먼저 한 번 실행해 revision 을 올려둔다(idempotencyKey 로 중복 방지).
    await submitAction("restartModel", {
      target: m.id, params: { reason: "bump" }, revision: m.revision,
      idempotencyKey: "imp81_stale_bump_" + m.id,
    });
    // rev=0(과거)으로 재시도 → 충돌.
    const res = await submitAction("scaleReplicas", { target: m.id, params: { count: 2 }, revision: 0 });
    expect(res.outcome).toBe("conflict");
    expect(res.reason).toMatch(/stale/i);
  });
});

describe("결정성(요청 간) — 같은 id·링크 집합", () => {
  it("반복 호출에도 objects id 집합과 links 집합이 동일(seed 고정)", async () => {
    const a = await fetchOntologyObjects();
    const b = await fetchOntologyObjects();
    expect(new Set(a.objects.map((o) => o.id))).toEqual(new Set(b.objects.map((o) => o.id)));

    // 대표 Endpoint 의 링크도 요청 간 동일해야 한다(요청단위 메모이즈가 결정성을 해치지 않음).
    const ep = a.objects.find((o) => o.type === "Endpoint")!;
    const la = await fetchOntologyLinks(ep.id);
    const lb = await fetchOntologyLinks(ep.id);
    const key = (l: { from: string; to: string; linkKind: string }) => `${l.from}|${l.to}|${l.linkKind}`;
    expect(new Set(la.links.map(key))).toEqual(new Set(lb.links.map(key)));
  });
});

describe("agent 루프 불변 — 공유 스냅샷으로도 결정성 유지", () => {
  it("같은 intent → 동일 step 종류 순서·동일 후보 objectId 집합", async () => {
    const a = await runAgent({ intent: "imp81 same", entity: "" });
    const b = await runAgent({ intent: "imp81 same", entity: "" });
    expect(a.steps.map((s) => s.kind)).toEqual(b.steps.map((s) => s.kind));
    expect(new Set(a.candidates.map((c) => c.objectId))).toEqual(new Set(b.candidates.map((c) => c.objectId)));
  });
});
