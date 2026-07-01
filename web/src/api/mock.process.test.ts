// IMP-69 — PROCESS 레이어(Task/Workflow) + Action Inbox mock 계약 테스트.
// buildOntology 는 export 되지 않으므로(내부 팩토리) fetch 인터셉터 + client 로 실제 라우터를 통과시킨다
// (프로젝트 ethos: 백엔드 0개). 여기서 잠그는 것:
//  - Incident 마다 결정적 Task 생성(assignee/priority/status/linkedObjectIds) + spawns/tracks 링크
//  - 결정성(두 번 조회 → 동일)
//  - assign/resolveTask 양 계층 writeback + direct-fetch == 재구성 정합(mergeOverride)
//  - observe(incident.write=false) 서버 등가 거부(403 denied)
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { installMockFetch } from "./mock";
import { fetchOntologyObjects, fetchOntologyLinks, fetchOntologyObject, submitAction } from "./client";
import type { OntologyObject, TaskProps } from "./types";

beforeAll(() => {
  installMockFetch();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function props(o: OntologyObject): TaskProps {
  return o.props as TaskProps;
}

describe("PROCESS 층 Task 생성(IMP-69) — Incident → Task 승격", () => {
  it("Task 큐가 비어있지 않고, 각 Task 가 assignee·priority·status·workflow 필드를 갖는다", async () => {
    const res = await fetchOntologyObjects("Task");
    expect(res.objects.length).toBeGreaterThan(0);
    for (const t of res.objects) {
      expect(t.type).toBe("Task");
      const p = props(t);
      expect(["low", "med", "high", "urgent"]).toContain(p.priority);
      expect(["open", "triaged", "assigned", "in-progress", "resolved"]).toContain(p.status);
      expect(p.workflowId).toBe("wf-incident");
      expect(typeof p.workflowStepIndex).toBe("number");
      expect(Array.isArray(p.linkedObjectIds)).toBe(true);
      // Task 는 process 객체 — 온톨로지 status 는 중립(unknown).
      expect(t.status).toBe("unknown");
    }
  });

  it("incident→task 링크: 각 Task 는 spawns 로 Incident 에, tracks 로 subject-matter 객체에 연결된다", async () => {
    const tasks = await fetchOntologyObjects("Task");
    const t = tasks.objects[0];
    const p = props(t);
    // spawns — Incident --spawns--> Task.
    const incLinks = await fetchOntologyLinks(`incident:${p.spawnedByIncidentId}`, "spawns");
    expect(incLinks.links.some((l) => l.to === t.id && l.linkKind === "spawns")).toBe(true);
    // tracks — Task --tracks--> {subject-matter}. linkedObjectIds 와 일치.
    const taskLinks = await fetchOntologyLinks(t.id, "tracks");
    const trackedTo = taskLinks.links.filter((l) => l.from === t.id && l.linkKind === "tracks").map((l) => l.to).sort();
    expect(trackedTo).toEqual([...p.linkedObjectIds].sort());
  });

  it("결정적 — 두 번 조회해도 동일한 Task id/assignee/priority/linkedObjectIds", async () => {
    const a = await fetchOntologyObjects("Task");
    const b = await fetchOntologyObjects("Task");
    const norm = (r: typeof a) => r.objects.map((o) => ({ id: o.id, ...props(o) })).sort((x, y) => (x.id < y.id ? -1 : 1));
    const na = norm(a).map((x) => ({ id: x.id, assignee: x.assignee, priority: x.priority, linked: [...x.linkedObjectIds].sort() }));
    const nb = norm(b).map((x) => ({ id: x.id, assignee: x.assignee, priority: x.priority, linked: [...x.linkedObjectIds].sort() }));
    expect(na).toEqual(nb);
  });
});

describe("Task writeback — process 층 전진 + workflow step 동기화", () => {
  it("assign → status=assigned, workflowStepIndex 전진, assignee 반영 (process 층)", async () => {
    const tasks = await fetchOntologyObjects("Task");
    // triaged(미배정) 과업을 고른다(없으면 첫 과업).
    const target = tasks.objects.find((t) => props(t).status === "triaged") ?? tasks.objects[0];
    const res = await submitAction("assign", {
      target: target.id, params: { assignee: "테스트담당" }, revision: target.revision,
      idempotencyKey: "imp69_assign_" + target.id,
    });
    expect(res.outcome).toBe("ok");
    const p = props(res.object!);
    expect(p.status).toBe("assigned");
    expect(p.assignee).toBe("테스트담당");
    expect(p.workflowStepIndex).toBe(1); // triaged(0) → assigned(1)
    // 재구성 정합 — 직접 조회도 동일 status/assignee.
    const refetched = await fetchOntologyObject(target.id);
    expect(props(refetched).status).toBe("assigned");
    expect(props(refetched).assignee).toBe("테스트담당");
  });

  it("resolveTask → status=resolved(terminal) + tracks 대상 subject-matter 객체가 ok 로 수렴 (양 계층)", async () => {
    const tasks = await fetchOntologyObjects("Task");
    // linkedObjectIds 가 있는 과업(수렴 검증 가능)을 고른다.
    const target = tasks.objects.find((t) => props(t).linkedObjectIds.length > 0)!;
    expect(target).toBeTruthy();
    const linked = props(target).linkedObjectIds;
    const res = await submitAction("resolveTask", {
      target: target.id, params: { note: "완료" }, revision: target.revision,
      idempotencyKey: "imp69_resolve_" + target.id,
    });
    expect(res.outcome).toBe("ok");
    // (1) process 층 — Task 해소.
    expect(props(res.object!).status).toBe("resolved");
    // (2) subject-matter 층 — tracks 하던 디지털트윈 객체가 ok 로 수렴(디지털트윈 반영).
    for (const objId of linked) {
      const o = await fetchOntologyObject(objId);
      expect(o.status).toBe("ok");
      expect((o.props as Record<string, unknown>).resolved_by_task).toBe(target.id);
    }
  });
});

describe("Task Action 게이팅 — observe 서버 등가 거부(trust boundary)", () => {
  it("observe(incident.write 없음) 프로파일에서 assign → 403 denied + 사유", async () => {
    vi.stubEnv("VITE_PROFILE", "observe");
    const tasks = await fetchOntologyObjects("Task");
    const target = tasks.objects[0];
    const res = await submitAction("assign", {
      target: target.id, params: { assignee: "x" }, revision: target.revision,
      idempotencyKey: "imp69_denied_" + target.id + "_" + Date.now(),
    });
    expect(res.outcome).toBe("denied");
    expect(res.reason).toMatch(/incident\.write|읽기 전용/);
  });
});
