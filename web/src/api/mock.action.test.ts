// Action(writeback) mock 계약(IMP-59) — 단일 mutation 경로 POST /ontology/actions/:name 검증.
// buildOntology 는 export 되지 않으므로 fetch 인터셉터 + submitAction 으로 실제 라우터를 통과시킨다.
import { describe, it, expect, beforeAll } from "vitest";
import { installMockFetch } from "./mock";
import { fetchOntologyObjects, submitAction } from "./client";

beforeAll(() => {
  installMockFetch();
});

async function firstModelId(): Promise<{ id: string; revision: number }> {
  const res = await fetchOntologyObjects("Model");
  const m = res.objects[0];
  return { id: m.id, revision: m.revision };
}

describe("applyAction — normal(상태 전이 + audit)", () => {
  it("scaleReplicas → outcome=ok, canonical object 반환, revision 증가, audit outcome=ok", async () => {
    const { id, revision } = await firstModelId();
    const res = await submitAction("scaleReplicas", { target: id, params: { count: 3 }, revision });
    expect(res.outcome).toBe("ok");
    expect(res.object?.id).toBe(id);
    expect(res.object?.revision).toBe(revision + 1); // Rules: revision++
    expect(res.object?.status).toBe("warn");          // pending 전이
    expect(res.audit.actionType).toBe("scaleReplicas");
    expect(res.audit.outcome).toBe("ok");
    expect(res.audit.actor).toBeTruthy();
  });

  it("반영 후 재조회 시 canonical status/revision 이 유지된다(override)", async () => {
    const before = await fetchOntologyObjects("Model");
    const target = before.objects[0];
    const res = await submitAction("restartModel", { target: target.id, params: { reason: "test" }, revision: target.revision });
    expect(res.outcome).toBe("ok");
    const after = await fetchOntologyObjects("Model");
    const updated = after.objects.find((o) => o.id === target.id)!;
    expect(updated.revision).toBe(res.object!.revision);
    expect(updated.status).toBe("ok"); // restartModel → ok
  });
});

describe("applyAction — retry(idempotency)", () => {
  it("동일 idempotencyKey 재전송 → 중복 전이 없이 같은 결과", async () => {
    const { id, revision } = await firstModelId();
    const key = "idem_test_fixed_1";
    const first = await submitAction("restartModel", { target: id, params: { reason: "x" }, revision, idempotencyKey: key });
    const firstRev = first.object!.revision;
    const second = await submitAction("restartModel", { target: id, params: { reason: "x" }, revision, idempotencyKey: key });
    expect(second.object!.revision).toBe(firstRev); // 증가하지 않음
    expect(second.outcome).toBe(first.outcome);
  });
});

describe("applyAction — failure(409 stale-write)", () => {
  it("현재보다 낮은 revision → outcome=conflict + 사유", async () => {
    const { id } = await firstModelId();
    // 먼저 한 번 실행해 revision 을 올려둔다.
    await submitAction("restartModel", { target: id, params: { reason: "bump" }, revision: 1, idempotencyKey: "bump_" + id });
    // rev=0(과거)으로 재시도 → 충돌.
    const res = await submitAction("scaleReplicas", { target: id, params: { count: 2 }, revision: 0 });
    expect(res.outcome).toBe("conflict");
    expect(res.reason).toMatch(/stale/i);
  });
});

describe("applyAction — bad-input(대상 없음)", () => {
  it("존재하지 않는 target → outcome=error", async () => {
    const res = await submitAction("restartModel", { target: "model:does-not-exist", params: { reason: "x" } });
    expect(res.outcome).toBe("error");
    expect(res.reason).toBeTruthy();
  });
});

describe("applyAction — Incident verb 흡수(비회귀)", () => {
  it("resolve → Incident status 전이 + audit", async () => {
    const incs = await fetchOntologyObjects("Incident");
    const inc = incs.objects[0];
    const res = await submitAction("resolve", { target: inc.id, params: {}, revision: inc.revision });
    expect(["ok", "conflict"]).toContain(res.outcome); // resolve 가능하거나(첫) 이미 처리됨
    if (res.outcome === "ok") expect(res.object?.status).toBe("ok");
  });
});
