// IMP-75 — Search Around 순수 seam 테스트(searchAround.ts).
//  객체 검색 command(query_objects 필터) / object-context Action Panel(Open ObjectView + Search Around
//  + 게이팅 Action) / search-around 이웃 집합 / set-size 가드 / aria-live 안내 / mutation 없음.
import { describe, it, expect, vi } from "vitest";
// Vite ?raw — 소스 텍스트를 문자열로 로드(trust boundary 정적 불변식 검사용, Node API 불필요).
import searchAroundSrc from "./searchAround.ts?raw";
import { buildGraph } from "../api/ontologyGraph";
import type { OntologyLink, OntologyObject } from "../api/types";
import {
  MAX_SET,
  bulkActionGuard,
  liveAnnounce,
  objectContextCommands,
  objectSearchCommands,
  searchAroundCommands,
  searchAroundSet,
  type SearchAroundActions,
} from "./searchAround";

// ── 픽스처: Model qwen --serves-- endpoint:e1, --runsOn--> gpu:g1/gpu:g2, --affects← incident:i1 ──
const OBJS: OntologyObject[] = [
  { id: "model:qwen", type: "Model", title: "Qwen 7B", props: { replicas: 3 }, status: "ok", revision: 2 },
  { id: "endpoint:e1", type: "Endpoint", title: "prod-endpoint", props: {}, status: "ok", revision: 1 },
  { id: "gpu:g1", type: "GpuDevice", title: "host/gpu0", props: {}, status: "warn", revision: 1 },
  { id: "gpu:g2", type: "GpuDevice", title: "host/gpu1", props: {}, status: "ok", revision: 1 },
  { id: "incident:i1", type: "Incident", title: "지연 급증", props: {}, status: "crit", revision: 1 },
];
const LINKS: OntologyLink[] = [
  { from: "endpoint:e1", to: "model:qwen", linkKind: "serves" },
  { from: "model:qwen", to: "gpu:g1", linkKind: "runsOn" },
  { from: "model:qwen", to: "gpu:g2", linkKind: "runsOn" },
  { from: "incident:i1", to: "model:qwen", linkKind: "affects" },
];

function graph() { return buildGraph(OBJS, LINKS); }
function noopActions(over: Partial<SearchAroundActions> = {}): SearchAroundActions {
  return { can: () => true, openObject: vi.fn(), pushContext: vi.fn(), pushAround: vi.fn(), ...over };
}

describe("searchAround — object-search 모드(query_objects 재사용)", () => {
  it("쿼리로 title/id 부분일치 필터 → 매치 객체만 command 로(무관 객체 제외)", () => {
    const cmds = objectSearchCommands(OBJS, "qwen", () => {});
    expect(cmds.map((c) => c.label)).toContain("Qwen 7B");
    expect(cmds.every((c) => c.keepOpen)).toBe(true); // Enter=context push(팔레트 유지)
    // "qwen" 은 gpu/endpoint/incident 를 매치하지 않는다.
    expect(cmds.some((c) => c.label === "host/gpu0")).toBe(false);
  });

  it("객체 command Enter → onPick(objectId) 호출(context push)", () => {
    const onPick = vi.fn();
    const cmds = objectSearchCommands(OBJS, "qwen", onPick);
    cmds[0].run();
    expect(onPick).toHaveBeenCalledWith("model:qwen");
  });

  it("무매치 쿼리 → 빈 command", () => {
    expect(objectSearchCommands(OBJS, "zzzznope", () => {})).toHaveLength(0);
  });
});

describe("searchAround — object-context 모드(Action Panel)", () => {
  it("primary=Open ObjectView 는 항상 노출(안전) + 실재 관계만 Search Around 로", () => {
    const cmds = objectContextCommands(graph(), "model:qwen", noopActions());
    // Open ObjectView(primary)
    expect(cmds.some((c) => c.id === "sa-open-model:qwen")).toBe(true);
    // 실재 관계: serves(1)·runsOn(2)·affects(1) → Search Around 3개. 관계 없는 kind 는 없음.
    const around = cmds.filter((c) => c.id.startsWith("sa-around-"));
    expect(around.map((c) => c.label).sort()).toEqual(
      ["Search Around → 서빙 모델", "Search Around → 실행 GPU", "Search Around → 영향 대상"].sort(),
    );
    // runsOn 이웃 수(2)가 hint 로.
    expect(around.find((c) => c.id.endsWith("runsOn"))?.hint).toBe("2개");
  });

  it("Search Around command 는 keepOpen(집합 서브페이지 push) — pushAround 호출", () => {
    const pushAround = vi.fn();
    const cmds = objectContextCommands(graph(), "model:qwen", noopActions({ pushAround }));
    const runsOn = cmds.find((c) => c.id === "sa-around-model:qwen-runsOn")!;
    expect(runsOn.keepOpen).toBe(true);
    runsOn.run();
    expect(pushAround).toHaveBeenCalledWith("model:qwen", "runsOn");
  });

  it("게이팅: manage(can=true) → mutating Action(모델 재기동/레플리카) command 노출", () => {
    const cmds = objectContextCommands(graph(), "model:qwen", noopActions({ can: () => true }));
    const acts = cmds.filter((c) => c.id.startsWith("sa-act-"));
    expect(acts.map((c) => c.label)).toEqual(expect.arrayContaining(["모델 재기동", "레플리카 조정"]));
  });

  it("게이팅: observe(models.write=false) → mutating Action command **미노출**(Open ObjectView 는 남음)", () => {
    const can = (c: string) => c !== "models.write";
    const cmds = objectContextCommands(graph(), "model:qwen", noopActions({ can }));
    expect(cmds.some((c) => c.id.startsWith("sa-act-"))).toBe(false); // 액션 숨김
    expect(cmds.some((c) => c.id === "sa-open-model:qwen")).toBe(true); // primary 안전 노출
  });

  it("mutation 없음: Action command run() 은 openObject 로 유도(팔레트 직접 mutate 아님)", () => {
    const openObject = vi.fn();
    const cmds = objectContextCommands(graph(), "model:qwen", noopActions({ openObject }));
    const act = cmds.find((c) => c.id.startsWith("sa-act-"))!;
    act.run();
    expect(openObject).toHaveBeenCalledWith("model:qwen"); // ObjectView(+ActionForm) 진입만
  });
});

describe("searchAround — search-around 모드(이웃 집합=SET)", () => {
  it("neighbors(id,'runsOn') 를 집합으로 나열(결정적 id 정렬) — jump 아님", () => {
    const set = searchAroundSet(graph(), "model:qwen", "runsOn");
    expect(set.map((o) => o.id)).toEqual(["gpu:g1", "gpu:g2"]); // 사전순(결정적)
    const cmds = searchAroundCommands(graph(), "model:qwen", "runsOn", () => {});
    expect(cmds).toHaveLength(2);
    expect(cmds[0].group).toBe("실행 GPU (2)"); // 그룹 라벨에 집합 크기
  });

  it("집합의 이웃 Enter = onOpen(ObjectView) 호출(안전)", () => {
    const onOpen = vi.fn();
    const cmds = searchAroundCommands(graph(), "model:qwen", "runsOn", onOpen);
    cmds[0].run();
    expect(onOpen).toHaveBeenCalledWith("gpu:g1");
  });

  it("이웃 없는 kind → 빈 집합", () => {
    expect(searchAroundSet(graph(), "model:qwen", "hostedBy")).toHaveLength(0);
  });
});

describe("searchAround — set-size 가드(Foundry >1000 미러) + aria-live", () => {
  it("MAX_SET 초과 → bulk action 불가 + 사유", () => {
    const g = bulkActionGuard(MAX_SET + 1);
    expect(g.ok).toBe(false);
    expect(g.reason).toMatch(/1000/);
  });
  it("빈 집합 → 불가, 정상 범위 → 가능", () => {
    expect(bulkActionGuard(0).ok).toBe(false);
    expect(bulkActionGuard(5).ok).toBe(true);
  });
  it("aria-live 안내: object-search=N개 객체 / search-around=주변 이웃 N개 / empty 문구", () => {
    expect(liveAnnounce("object-search", 3)).toBe("3개 객체");
    expect(liveAnnounce("object-search", 0)).toMatch(/없습니다/);
    expect(liveAnnounce("search-around", 2, "Qwen 7B")).toBe("Qwen 7B 주변 이웃 2개");
    expect(liveAnnounce("search-around", 0, "Qwen 7B")).toMatch(/이웃이 없습니다/);
  });
});

describe("searchAround — trust boundary(정적 불변식)", () => {
  it("모듈이 mutating 전송(submitAction 등이 있는 api/client)이나 mutating 심볼을 import 하지 않는다", () => {
    // 팔레트 seam 은 조회/게이팅만. mutation 은 ActionForm 경로에만(trust boundary).
    // import 문(라인 선두 import)만 검사 — 주석/문자열의 단어 언급은 무시.
    const importLines = searchAroundSrc.split("\n").filter((l: string) => /^\s*import\b/.test(l));
    const joined = importLines.join("\n");
    expect(joined).not.toMatch(/api\/client/);              // mutating 전송 모듈 자체를 안 씀
    expect(joined).not.toMatch(/submitAction|applyAction/); // mutating 심볼 import 없음
  });
});
