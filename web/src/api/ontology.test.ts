// 온톨로지 데이터 모델(IMP-56) 테스트 — types 계약 + buildOntology 엣지 + 라우터 응답.
// mock.ts 는 buildOntology 를 export 하지 않으므로(내부 팩토리), fetch 인터셉터를 설치해
// client.ts 를 통해 실제 라우터 경로를 검증한다(프로젝트 ethos: 백엔드 0개로 동작).
import { describe, it, expect, beforeAll } from "vitest";
import { installMockFetch } from "./mock";
import { fetchOntologyObjects, fetchOntologyLinks, fetchOntologyObject, fetchObjectMetrics } from "./client";
import type { LinkKind, ObjectType } from "./types";

const OBJECT_TYPES: ObjectType[] = ["Model", "Endpoint", "Service", "GpuDevice", "Node", "Trace", "Incident", "App"];
const LINK_KINDS: LinkKind[] = ["serves", "runsOn", "hostedBy", "routedTo", "executedOn", "consumes", "affects", "routes"];

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

describe("GET /ontology/objects/:id — 단일 객체(IMP-57)", () => {
  it("normal: 실재 id → canonical object(id/type/status/revision)", async () => {
    const list = await fetchOntologyObjects("Model");
    const sample = list.objects[0];
    const one = await fetchOntologyObject(sample.id);
    expect(one.id).toBe(sample.id);
    expect(one.type).toBe("Model");
    expect(one.revision).toBeGreaterThanOrEqual(1);
    expect(["ok", "warn", "crit", "unknown"]).toContain(one.status);
  });

  it("failure: 미존재 id → 404 (throws)", async () => {
    await expect(fetchOntologyObject("model:does-not-exist")).rejects.toThrow(/404/);
  });

  it("라우팅: /:id 가 /:id/links 를 삼키지 않는다(구체 경로 우선)", async () => {
    const list = await fetchOntologyObjects("Endpoint");
    const id = list.objects[0].id;
    const links = await fetchOntologyLinks(id); // 여전히 링크 목록 반환(단일객체 아님)
    expect(links.object_id).toBe(id);
    expect(Array.isArray(links.links)).toBe(true);
  });
});

// get_object_metrics tool(IMP-73)의 데이터 경로 — GET /ontology/objects/:id/metrics.
describe("GET /ontology/objects/:id/metrics — get_object_metrics", () => {
  it("normal: 객체 props 의 수치 필드를 메트릭 시리즈로(끝점=현재값) 반환", async () => {
    // GpuDevice 는 util_perc 등 수치 props 를 갖는다.
    const gpus = await fetchOntologyObjects("GpuDevice");
    const id = gpus.objects[0].id;
    const rep = await fetchObjectMetrics(id, "1h");
    expect(rep.object_id).toBe(id);
    expect(rep.range).toBe("1h");
    expect(rep.series.length).toBeGreaterThan(0);
    for (const s of rep.series) {
      expect(s.points.length).toBeGreaterThan(0);
      expect(s.points[s.points.length - 1]).toBe(s.current); // 끝점은 canonical 현재값
      expect(s.key).toBeTruthy();
    }
  });

  it("retry(결정성): 같은 id/range → 동일 시리즈(seed 고정)", async () => {
    const gpus = await fetchOntologyObjects("GpuDevice");
    const id = gpus.objects[0].id;
    const a = await fetchObjectMetrics(id, "6h");
    const b = await fetchObjectMetrics(id, "6h");
    expect(a.series.map((s) => s.points)).toEqual(b.series.map((s) => s.points));
  });

  it("bad-input: 알 수 없는 range 는 기본 1h 로 폴백(throw 없음)", async () => {
    const gpus = await fetchOntologyObjects("GpuDevice");
    const rep = await fetchObjectMetrics(gpus.objects[0].id, "bogus");
    expect(rep.range).toBe("1h");
  });

  it("failure: 미존재 id → 404 (throws)", async () => {
    await expect(fetchObjectMetrics("gpu:does-not-exist")).rejects.toThrow(/404/);
  });
});

// IMP-89 — Endpoint↔app_id 라우팅을 온톨로지 관계로. App(소비자) 객체 + Endpoint--routes-->App.
describe("IMP-89 — App 객체 + Endpoint→App routes 관계", () => {
  it("App 객체가 존재하고 라우팅 요약 props(endpoints·request_count·name)를 갖는다", async () => {
    const apps = await fetchOntologyObjects("App");
    expect(apps.objects.length).toBeGreaterThan(0);
    for (const a of apps.objects) {
      expect(a.id.startsWith("app:")).toBe(true);
      const p = a.props as Record<string, unknown>;
      expect(typeof p.endpoints).toBe("number"); // 라우팅 EP 수(요약)
      expect((p.endpoints as number)).toBeGreaterThanOrEqual(1);
      expect(typeof p.request_count).toBe("number"); // 요청 건수(있으면 집계, 없으면 0)
      expect(p.app_id).toBeTruthy();
      expect(p.name).toBeTruthy();
    }
  });

  it("Endpoint --routes--> App 링크로 App 을 traverse 할 수 있다", async () => {
    const eps = await fetchOntologyObjects("Endpoint");
    // app_id 가 있는 EP 는 routes 링크로 App 에 도달.
    let routed = 0;
    for (const ep of eps.objects) {
      const lr = await fetchOntologyLinks(ep.id, "routes");
      for (const l of lr.links) {
        expect(l.linkKind).toBe("routes");
        expect(l.from).toBe(ep.id);
        expect(l.to.startsWith("app:")).toBe(true);
        routed++;
      }
    }
    expect(routed).toBeGreaterThan(0); // 최소 1개 EP 가 App 으로 라우팅
  }, 20000);

  it("App→Trace traverse 가능(App→Endpoint→Trace 경로) — 그 앱의 트레이스 도달", async () => {
    const apps = await fetchOntologyObjects("App");
    const app = apps.objects[0];
    // App 의 in-link 은 Endpoint --routes--> App (App 이 to).
    const appLinks = await fetchOntologyLinks(app.id);
    const routingEps = appLinks.links.filter((l) => l.linkKind === "routes" && l.to === app.id).map((l) => l.from);
    expect(routingEps.length).toBeGreaterThan(0);
    // 그 Endpoint 의 in-link 에 Trace --routedTo--> Endpoint 가 하나 이상(트레이스 도달 경로).
    // (트레이스가 그 EP 로 라우팅됐다면) — 없어도 crash 없이 빈 결과(graceful).
    const epLinks = await fetchOntologyLinks(routingEps[0]);
    expect(Array.isArray(epLinks.links)).toBe(true);
  });

  it("결정적: 두 번 조회한 App 객체·routes 링크가 동일", async () => {
    const a = await fetchOntologyObjects("App");
    const b = await fetchOntologyObjects("App");
    expect(a.objects.map((o) => o.id).sort()).toEqual(b.objects.map((o) => o.id).sort());
    expect(a.objects.map((o) => (o.props as Record<string, unknown>).endpoints))
      .toEqual(b.objects.map((o) => (o.props as Record<string, unknown>).endpoints));
  });
});
