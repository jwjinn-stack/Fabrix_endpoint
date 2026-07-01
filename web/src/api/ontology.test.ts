// 온톨로지 데이터 모델(IMP-56) 테스트 — types 계약 + buildOntology 엣지 + 라우터 응답.
// mock.ts 는 buildOntology 를 export 하지 않으므로(내부 팩토리), fetch 인터셉터를 설치해
// client.ts 를 통해 실제 라우터 경로를 검증한다(프로젝트 ethos: 백엔드 0개로 동작).
import { describe, it, expect, beforeAll } from "vitest";
import { installMockFetch } from "./mock";
import { fetchOntologyObjects, fetchOntologyLinks } from "./client";
import type { LinkKind, ObjectType } from "./types";

const OBJECT_TYPES: ObjectType[] = ["Model", "Endpoint", "Service", "GpuDevice", "Node", "Trace", "Incident"];
const LINK_KINDS: LinkKind[] = ["serves", "runsOn", "hostedBy", "routedTo", "executedOn", "consumes", "affects"];

beforeAll(() => {
  // jsdom 환경 가정(vitest 기본). window.fetch 를 mock 라우터로 가로챈다.
  installMockFetch();
});

describe("GET /ontology/objects — normal", () => {
  it("returns objects covering all 7 ObjectTypes with revision>=1", async () => {
    const res = await fetchOntologyObjects();
    expect(res.source).toContain("mock");
    expect(res.objects.length).toBeGreaterThan(0);
    const types = new Set(res.objects.map((o) => o.type));
    for (const t of OBJECT_TYPES) expect(types.has(t)).toBe(true);
    for (const o of res.objects) {
      expect(o.revision).toBeGreaterThanOrEqual(1);
      expect(o.id).toBeTruthy();
      expect(["ok", "warn", "crit", "unknown"]).toContain(o.status);
    }
  });

  it("filters by type", async () => {
    const res = await fetchOntologyObjects("Model");
    expect(res.objects.length).toBeGreaterThan(0);
    expect(res.objects.every((o) => o.type === "Model")).toBe(true);
  });

  it("filters by text (title/id substring)", async () => {
    const all = await fetchOntologyObjects("Model");
    const sample = all.objects[0];
    const needle = sample.id.slice(6, 12); // model: 접두 이후 일부
    const res = await fetchOntologyObjects(undefined, needle);
    expect(res.objects.length).toBeGreaterThan(0);
    expect(res.objects.every((o) => o.title.toLowerCase().includes(needle.toLowerCase()) || o.id.toLowerCase().includes(needle.toLowerCase()))).toBe(true);
  });

  it("bad-input: unknown type → empty array, schema preserved (200)", async () => {
    const res = await fetchOntologyObjects("Nope" as ObjectType);
    expect(res.objects).toEqual([]);
    expect(res.source).toContain("mock");
  });

  it("retry/deterministic: same id set on repeat calls", async () => {
    const a = await fetchOntologyObjects();
    const b = await fetchOntologyObjects();
    expect(new Set(a.objects.map((o) => o.id))).toEqual(new Set(b.objects.map((o) => o.id)));
  });
});

describe("ontology graph — edges (via links endpoint)", () => {
  it("generates all §5.2 link kinds and has no dangling edges", async () => {
    const objs = await fetchOntologyObjects();
    const ids = new Set(objs.objects.map((o) => o.id));
    // 각 mock 라우트가 80~220ms sleep → 병렬(Promise.all)로 전 object 링크를 한 번에 수집.
    const results = await Promise.all(objs.objects.map((o) => fetchOntologyLinks(o.id)));
    const seenKinds = new Set<LinkKind>();
    results.forEach((lr, i) => {
      const oid = objs.objects[i].id;
      for (const l of lr.links) {
        // 무결성: 링크의 양끝이 실재 object.
        expect(ids.has(l.from)).toBe(true);
        expect(ids.has(l.to)).toBe(true);
        expect(l.from === oid || l.to === oid).toBe(true);
        seenKinds.add(l.linkKind);
      }
    });
    for (const k of LINK_KINDS) expect(seenKinds.has(k)).toBe(true);
  }, 20000);

  it("filters links by kind", async () => {
    const eps = await fetchOntologyObjects("Endpoint");
    // serves 링크(Endpoint→Model)를 갖는 엔드포인트가 최소 1건.
    let found = false;
    for (const ep of eps.objects) {
      const lr = await fetchOntologyLinks(ep.id, "serves");
      expect(lr.links.every((l) => l.linkKind === "serves")).toBe(true);
      if (lr.links.length > 0) found = true;
    }
    expect(found).toBe(true);
  });

  it("bad-input: unknown kind → empty links (200)", async () => {
    const eps = await fetchOntologyObjects("Endpoint");
    const lr = await fetchOntologyLinks(eps.objects[0].id, "nope" as LinkKind);
    expect(lr.links).toEqual([]);
    expect(lr.object_id).toBe(eps.objects[0].id);
  });

  it("failure: unknown object id → 404 (throws)", async () => {
    await expect(fetchOntologyLinks("model:does-not-exist")).rejects.toThrow(/404/);
  });
});
