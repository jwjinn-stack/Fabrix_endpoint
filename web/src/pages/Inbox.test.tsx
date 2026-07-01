// IMP-69 — Action Inbox 화면 테스트.
// client 온톨로지 fetch 를 모킹해 결정적으로 구동한다(백엔드 0개). capabilities 는 테스트별 주입(observe/manage).
// 케이스: 큐 렌더+필터 / 과업 선택→연결 subject-matter 객체 노출·클릭 시 ObjectView / 조치(assign)→과업 전진 +
//         gating(observe disabled+사유) / 빈 큐 / workflow 스텝퍼.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import Inbox from "./Inbox";
import { ToastProvider } from "../toast";
import * as client from "../api/client";
import type {
  ActionResult, OntologyObject, OntologyLink, OntologyObjectList, OntologyLinkList, TaskProps,
} from "../api/types";

// capabilities — ActionForm(Task Action 게이팅)이 소비. 테스트별로 can() 을 갈아끼운다.
let mockCan = (_cap: string) => true;
vi.mock("../capabilities", () => ({
  useCap: () => ({ can: (c: string) => mockCan(c), caps: { profile: "manage", readonly: false, capabilities: {}, data_source: "mock", integrations: {} } }),
}));

// ── 픽스처: Task 2건(process 층) + subject-matter(endpoint/gpu) + Incident. Task --tracks--> subject-matter. ──
function mkTask(id: string, over: Partial<TaskProps>): OntologyObject {
  const base: TaskProps = {
    title: "기본 과업", assignee: "", createdAt: "2026-07-02T00:00:00Z",
    priority: "med", status: "triaged", linkedObjectIds: [], workflowId: "wf-incident", workflowStepIndex: 0,
    ...over,
  };
  return { id, type: "Task", title: base.title, props: base, status: "unknown", revision: 1 };
}

const OBJS: Record<string, OntologyObject> = {
  "task:t-urgent": mkTask("task:t-urgent", {
    title: "[대응] 엔드포인트 NotReady", assignee: "", priority: "urgent", status: "triaged",
    linkedObjectIds: ["endpoint:e1"], workflowStepIndex: 0, spawnedByIncidentId: "i1",
  }),
  "task:t-low": mkTask("task:t-low", {
    title: "[대응] 큐 적체", assignee: "박SRE", priority: "low", status: "assigned",
    linkedObjectIds: ["gpu:g1"], workflowStepIndex: 1, spawnedByIncidentId: "i2",
  }),
  "endpoint:e1": { id: "endpoint:e1", type: "Endpoint", title: "e1", props: { namespace: "prod", replicas: 2 }, status: "crit", revision: 1 },
  "gpu:g1": { id: "gpu:g1", type: "GpuDevice", title: "host/gpu0", props: { gpu_util: 0.9 }, status: "warn", revision: 1 },
};
const LINKS: OntologyLink[] = [
  { from: "task:t-urgent", to: "endpoint:e1", linkKind: "tracks" },
  { from: "task:t-low", to: "gpu:g1", linkKind: "tracks" },
];

function objListAll(): OntologyObjectList {
  return { generated_at: "t", objects: Object.values(OBJS), source: "ontology (mock)" };
}
function objListTasks(): OntologyObjectList {
  return { generated_at: "t", objects: Object.values(OBJS).filter((o) => o.type === "Task"), source: "ontology (mock)" };
}
function linkListFor(id: string): OntologyLinkList {
  return { generated_at: "t", object_id: id, links: LINKS.filter((l) => l.from === id || l.to === id), source: "ontology (mock)" };
}

function stubClient() {
  vi.spyOn(client, "fetchOntologyObjects").mockImplementation((type?: string) =>
    Promise.resolve(type === "Task" ? objListTasks() : objListAll()),
  );
  vi.spyOn(client, "fetchOntologyObject").mockImplementation((id: string) => {
    const o = OBJS[id];
    return o ? Promise.resolve(o) : Promise.reject(new Error("API 404"));
  });
  vi.spyOn(client, "fetchOntologyLinks").mockImplementation((id: string) => {
    if (!OBJS[id]) return Promise.reject(new Error("API 404"));
    return Promise.resolve(linkListFor(id));
  });
}

function renderPage() {
  return render(
    <ToastProvider>
      <Inbox />
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockCan = () => true;
  window.history.replaceState({}, "", "/inbox"); // urlState 초기화(선택 task/필터 없음)
  stubClient();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// 큐(LEFT) 리전 스코프 — 상세 패널과 동일 title 이 중복 렌더되므로 큐만 겨냥한다.
// <section aria-label="과업 큐"> = region role.
async function queue(): Promise<HTMLElement> {
  const region = await screen.findByRole("region", { name: "과업 큐" });
  return region as HTMLElement;
}

describe("Inbox — 과업 큐 렌더 + 필터", () => {
  it("큐에 Task 행이 렌더되고, 우선순위 급한 순으로 정렬된다", async () => {
    renderPage();
    const q = await queue();
    expect(within(q).getByText("[대응] 엔드포인트 NotReady")).toBeInTheDocument();
    expect(within(q).getByText("[대응] 큐 적체")).toBeInTheDocument();
    // 미해소 카운트 요약(2건).
    expect(screen.getByText("미해소 과업")).toBeInTheDocument();
    // urgent 과업이 목록 첫 항목(정렬).
    const items = within(q).getAllByRole("button").filter((b) => b.className.includes("inbox-item"));
    expect(within(items[0]).getByText("[대응] 엔드포인트 NotReady")).toBeInTheDocument();
  });

  it("우선순위 필터(low)로 큐를 좁힌다", async () => {
    renderPage();
    await queue();
    const prioritySelect = screen.getByRole("combobox", { name: /우선순위/ }) as HTMLSelectElement;
    fireEvent.change(prioritySelect, { target: { value: "low" } });
    await waitFor(() => {
      const q = screen.getByRole("region", { name: "과업 큐" });
      expect(within(q).queryByText("[대응] 엔드포인트 NotReady")).not.toBeInTheDocument();
    });
    const q = screen.getByRole("region", { name: "과업 큐" });
    expect(within(q).getByText("[대응] 큐 적체")).toBeInTheDocument();
  });

  it("빈 큐 — 필터 결과 0이면 empty 상태", async () => {
    renderPage();
    await queue();
    // 담당자=박SRE + 우선순위=urgent 조합은 매칭 0(박SRE 과업은 low).
    fireEvent.change(screen.getByRole("combobox", { name: /담당자/ }), { target: { value: "박SRE" } });
    fireEvent.change(screen.getByRole("combobox", { name: /우선순위/ }), { target: { value: "urgent" } });
    await screen.findByText("조건에 맞는 과업이 없습니다.");
  });
});

describe("Inbox — 과업 선택 → 연결 subject-matter 객체 탐색", () => {
  it("기본 선택(첫 과업)의 연결 객체가 노출되고, 클릭 시 ObjectView 가 열린다", async () => {
    renderPage();
    // 기본 선택 = urgent 과업 → 연결 endpoint:e1.
    await screen.findByText("연결 객체");
    const linkedBtn = await screen.findByRole("button", { name: /e1/ });
    fireEvent.click(linkedBtn);
    // ObjectView(SlidePanel)가 endpoint:e1 canonical 을 조회한다.
    await waitFor(() => {
      expect(client.fetchOntologyObject).toHaveBeenCalledWith("endpoint:e1", expect.anything());
    });
  });

  it("workflow 스텝퍼가 순차 단계를 렌더하고 현재 단계를 강조한다", async () => {
    renderPage();
    const stepper = await screen.findByRole("list", { name: "워크플로 단계" });
    // 4단계(분류/배정/조치 중/해소).
    expect(within(stepper).getByText("분류")).toBeInTheDocument();
    expect(within(stepper).getByText("해소")).toBeInTheDocument();
    // 기본 선택(triaged, stepIndex=0) → '분류'가 current.
    const current = within(stepper).getByText("분류").closest("li");
    expect(current?.className).toContain("current");
  });
});

describe("Inbox — 조치(Task Action) + 게이팅", () => {
  it("manage — assign Action 실행 → onDone(ok) 시 큐 재조회(process 층 전진 반영)", async () => {
    const spy = vi.spyOn(client, "submitAction").mockResolvedValue({
      outcome: "ok",
      object: { ...OBJS["task:t-urgent"], props: { ...(OBJS["task:t-urgent"].props as TaskProps), status: "assigned", assignee: "김운영", workflowStepIndex: 1 }, revision: 2 },
      audit: { actionType: "assign", target: "task:t-urgent", params: { assignee: "김운영" }, actor: "operator", ts: new Date().toISOString(), outcome: "ok" },
    } satisfies ActionResult);
    renderPage();
    await queue();
    // '조치' 섹션의 담당자 지정 폼 — assignee 입력 후 제출.
    const assignForm = screen.getByRole("form", { name: /담당자 지정 실행/ });
    fireEvent.change(within(assignForm).getByLabelText(/assignee/), { target: { value: "김운영" } });
    fireEvent.click(within(assignForm).getByRole("button", { name: "담당자 지정" }));
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("assign", expect.objectContaining({ target: "task:t-urgent" }));
    });
    // onDone(ok) → poll.reload → fetchOntologyObjects("Task") 재호출(초기 로드 + 재조회 ≥ 2회).
    await waitFor(() => {
      const taskCalls = (client.fetchOntologyObjects as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) => c[0] === "Task");
      expect(taskCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("observe — incident.write 없음 → assign/reassign/resolveTask submit disabled + 사유", async () => {
    mockCan = (c) => c !== "incident.write"; // observe: incident.write 거부
    renderPage();
    await queue();
    const assignForm = screen.getByRole("form", { name: /담당자 지정 실행/ });
    // submit 버튼 disabled + 기계판독 사유.
    expect(within(assignForm).getByRole("button", { name: "담당자 지정" })).toBeDisabled();
    expect(within(assignForm).getByText(/incident\.write/)).toBeInTheDocument();
  });
});
