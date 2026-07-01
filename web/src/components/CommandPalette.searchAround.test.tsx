// IMP-75 — 중첩 Search Around 팔레트 통합 테스트(CommandPalette shell + useSearchAround 훅).
//  모드 전환(root→object-search→object-context→search-around) / breadcrumb pop(Backspace) /
//  a11y 비회귀(active 리셋·aria-activedescendant·aria-live) / object-search 필터 / search-around 집합 /
//  게이팅(observe 숨김·manage 노출) / 팔레트 직접 mutate 없음(openObject 로 유도) / 딥링크.
//  client 온톨로지 fetch + capabilities 를 모킹해 백엔드 0개로 결정적 구동.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { useState } from "react";
import CommandPalette, { type Command } from "./CommandPalette";
import { useSearchAround } from "./useSearchAround";
import * as client from "../api/client";
import type { OntologyObject, OntologyLink, OntologyObjectList, OntologyLinkList } from "../api/types";

// jsdom 은 Element.scrollIntoView 를 구현하지 않는다 — 활성 옵션 스크롤(scrollIntoView) 호출용 no-op 폴리필.
if (!(Element.prototype as { scrollIntoView?: unknown }).scrollIntoView) {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
}

// can() 를 테스트별로 갈아끼운다(observe/manage).
let mockCan = (_cap: string) => true;
vi.mock("../capabilities", () => ({
  useCap: () => ({ can: (c: string) => mockCan(c), caps: { profile: "manage", readonly: false, capabilities: {}, data_source: "mock", integrations: {} } }),
}));

// ── 픽스처: model:qwen --serves-- endpoint:e1, --runsOn--> gpu:g1/gpu:g2 ──
const OBJS: Record<string, OntologyObject> = {
  "model:qwen": { id: "model:qwen", type: "Model", title: "Qwen 7B", props: { replicas: 3 }, status: "ok", revision: 2 },
  "endpoint:e1": { id: "endpoint:e1", type: "Endpoint", title: "prod-endpoint", props: {}, status: "ok", revision: 1 },
  "gpu:g1": { id: "gpu:g1", type: "GpuDevice", title: "host/gpu0", props: {}, status: "warn", revision: 1 },
  "gpu:g2": { id: "gpu:g2", type: "GpuDevice", title: "host/gpu1", props: {}, status: "ok", revision: 1 },
};
const LINKS: OntologyLink[] = [
  { from: "endpoint:e1", to: "model:qwen", linkKind: "serves" },
  { from: "model:qwen", to: "gpu:g1", linkKind: "runsOn" },
  { from: "model:qwen", to: "gpu:g2", linkKind: "runsOn" },
];

function objList(): OntologyObjectList {
  return { generated_at: "t", objects: Object.values(OBJS), source: "ontology (mock)" };
}
function linkListFor(id: string): OntologyLinkList {
  return { generated_at: "t", object_id: id, links: LINKS.filter((l) => l.from === id || l.to === id), source: "ontology (mock)" };
}
function stubClient() {
  vi.spyOn(client, "fetchOntologyObjects").mockResolvedValue(objList());
  vi.spyOn(client, "fetchOntologyLinks").mockImplementation((id: string) =>
    OBJS[id] ? Promise.resolve(linkListFor(id)) : Promise.resolve({ generated_at: "t", object_id: id, links: [], source: "mock" }),
  );
}

// root flat 명령(nav/globals 대역) — 실제 Layout 과 동일 형태.
const ROOT: Command[] = [
  { id: "nav-dashboard", label: "관제", hint: "이동", group: "이동", glyph: "▦", keywords: "dashboard", run: () => {} },
  { id: "nav-traces", label: "트레이스", hint: "이동", group: "이동", glyph: "≣", keywords: "traces", run: () => {} },
];

// 팔레트 + 훅 배선 하네스(Layout 이 하는 것과 동일). openObject 는 스파이.
function Harness({ openObject }: { openObject: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const sa = useSearchAround({ open, rootCommands: ROOT, openObject });
  return (
    <CommandPalette
      open={open}
      onClose={() => setOpen(false)}
      commands={sa.commands}
      breadcrumb={sa.breadcrumb}
      onBack={sa.onBack}
      liveMessage={sa.liveMessage}
      placeholder={sa.placeholder}
      onQueryChange={sa.onQueryChange}
      modeKey={sa.modeKey}
    />
  );
}

function renderPalette() {
  const openObject = vi.fn();
  const utils = render(<Harness openObject={openObject} />);
  return { openObject, ...utils };
}

function input() { return screen.getByRole("combobox") as HTMLInputElement; }
function type(v: string) { fireEvent.change(input(), { target: { value: v } }); }

beforeEach(() => {
  mockCan = () => true;
  window.history.replaceState({}, "", "/"); // urlState 초기화(딥링크 격리)
  vi.restoreAllMocks();
  stubClient();
});
afterEach(() => cleanup());

describe("Search Around 팔레트 — 모드 전환", () => {
  it("root → 타이핑 → object-search(query_objects 필터) → 객체 Enter → object-context → Search Around Enter → search-around 집합", async () => {
    const { openObject } = renderPalette();
    // root: flat nav 명령.
    expect(screen.getByRole("option", { name: /관제/ })).toBeInTheDocument();

    // 타이핑 → object-search: "qwen" 은 Model 만 매치.
    type("qwen");
    await waitFor(() => expect(screen.getByRole("option", { name: /Qwen 7B/ })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: /host\/gpu0/ })).not.toBeInTheDocument();

    // 객체 Enter → object-context push(팔레트 유지).
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("option", { name: /Qwen 7B 열기/ })).toBeInTheDocument());
    // Search Around → 실행 GPU / 서빙 모델 존재(실재 관계).
    expect(screen.getByRole("option", { name: /Search Around → 실행 GPU/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Search Around → 서빙 모델/ })).toBeInTheDocument();
    // breadcrumb 에 컨텍스트 객체 title.
    expect(within(screen.getByRole("dialog")).getByText("Qwen 7B")).toBeInTheDocument();

    // Search Around → 실행 GPU Enter → search-around(gpu 집합 2개).
    fireEvent.click(screen.getByRole("option", { name: /Search Around → 실행 GPU/ }));
    await waitFor(() => expect(screen.getByRole("option", { name: /host\/gpu0/ })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: /host\/gpu1/ })).toBeInTheDocument();

    // 집합 이웃 Enter = ObjectView(openObject) — 팔레트 직접 mutate 아님.
    fireEvent.click(screen.getByRole("option", { name: /host\/gpu0/ }));
    expect(openObject).toHaveBeenCalledWith("gpu:g1");
  });
});

describe("Search Around 팔레트 — breadcrumb pop(Backspace)", () => {
  it("빈 쿼리 Backspace → search-around → object-context → root 로 한 단계씩 pop", async () => {
    renderPalette();
    type("qwen");
    await waitFor(() => screen.getByRole("option", { name: /Qwen 7B/ }));
    fireEvent.keyDown(input(), { key: "Enter" }); // → object-context
    await waitFor(() => screen.getByRole("option", { name: /Qwen 7B 열기/ }));
    fireEvent.click(screen.getByRole("option", { name: /Search Around → 실행 GPU/ })); // → search-around
    await waitFor(() => screen.getByRole("option", { name: /host\/gpu0/ }));

    // 빈 쿼리에서 Backspace → object-context 로 pop.
    expect(input().value).toBe(""); // 전환 시 query 리셋
    fireEvent.keyDown(input(), { key: "Backspace" });
    await waitFor(() => expect(screen.getByRole("option", { name: /Qwen 7B 열기/ })).toBeInTheDocument());

    // 다시 Backspace → root 로 pop.
    fireEvent.keyDown(input(), { key: "Backspace" });
    await waitFor(() => expect(screen.getByRole("option", { name: /관제/ })).toBeInTheDocument());
  });
});

describe("Search Around 팔레트 — a11y 비회귀", () => {
  it("모드 전환 시 active=0 리셋 + aria-activedescendant 가 첫 옵션 + aria-live 안내", async () => {
    renderPalette();
    type("qwen");
    await waitFor(() => screen.getByRole("option", { name: /Qwen 7B/ }));
    // aria-live: "N개 객체".
    const live = screen.getByRole("status");
    expect(live.textContent).toMatch(/개 객체/);

    fireEvent.keyDown(input(), { key: "Enter" }); // object-context 전환
    await waitFor(() => screen.getByRole("option", { name: /Qwen 7B 열기/ }));
    // 전환 후 active=0 → 첫 옵션이 aria-selected + activedescendant 가 그 옵션 id.
    const opts = screen.getAllByRole("option");
    expect(opts[0].getAttribute("aria-selected")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe(opts[0].id);
    // DOM 포커스 input 유지.
    expect(document.activeElement).toBe(input());
  });

  it("search-around 모드 aria-live 가 '주변 이웃 N개' 안내", async () => {
    renderPalette();
    type("qwen");
    await waitFor(() => screen.getByRole("option", { name: /Qwen 7B/ }));
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => screen.getByRole("option", { name: /Qwen 7B 열기/ }));
    fireEvent.click(screen.getByRole("option", { name: /Search Around → 실행 GPU/ }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/주변 이웃 2개/));
  });
});

describe("Search Around 팔레트 — capability 게이팅", () => {
  it("observe(models.write=false) → object-context 에 mutating Action 미노출, Open ObjectView 는 노출", async () => {
    mockCan = (c) => c !== "models.write";
    renderPalette();
    type("qwen");
    await waitFor(() => screen.getByRole("option", { name: /Qwen 7B/ }));
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => screen.getByRole("option", { name: /Qwen 7B 열기/ }));
    // 모델 재기동/레플리카 조정(models.write) 액션은 숨음.
    expect(screen.queryByRole("option", { name: /모델 재기동/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /레플리카 조정/ })).not.toBeInTheDocument();
    // Open ObjectView(안전)는 남는다.
    expect(screen.getByRole("option", { name: /Qwen 7B 열기/ })).toBeInTheDocument();
  });

  it("manage(can=true) → object-context 에 mutating Action 노출", async () => {
    mockCan = () => true;
    renderPalette();
    type("qwen");
    await waitFor(() => screen.getByRole("option", { name: /Qwen 7B/ }));
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("option", { name: /모델 재기동/ })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: /레플리카 조정/ })).toBeInTheDocument();
  });

  it("mutation 없음: 액션 선택 시 submitAction 을 호출하지 않고 ObjectView(openObject)로 유도", async () => {
    const submitSpy = vi.spyOn(client, "submitAction");
    const { openObject } = renderPalette();
    type("qwen");
    await waitFor(() => screen.getByRole("option", { name: /Qwen 7B/ }));
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => screen.getByRole("option", { name: /모델 재기동/ }));
    fireEvent.click(screen.getByRole("option", { name: /모델 재기동/ }));
    expect(submitSpy).not.toHaveBeenCalled();      // 팔레트가 직접 mutate 하지 않음
    expect(openObject).toHaveBeenCalledWith("model:qwen"); // ObjectView(+ActionForm) 진입만
  });
});

describe("Search Around 팔레트 — 딥링크", () => {
  it("?sactx=model:qwen 로 마운트 시 object-context 컨텍스트 복원", async () => {
    window.history.replaceState({}, "", "/?sactx=model:qwen");
    renderPalette();
    await waitFor(() => expect(screen.getByRole("option", { name: /Qwen 7B 열기/ })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: /Search Around → 실행 GPU/ })).toBeInTheDocument();
  });

  it("?saround=model:qwen|runsOn 로 마운트 시 search-around 집합 복원", async () => {
    window.history.replaceState({}, "", "/?saround=" + encodeURIComponent("model:qwen|runsOn"));
    renderPalette();
    await waitFor(() => expect(screen.getByRole("option", { name: /host\/gpu0/ })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: /host\/gpu1/ })).toBeInTheDocument();
  });
});

describe("Search Around 팔레트 — empty / no-results", () => {
  it("무매치 쿼리 → 빈 상태 + aria-live 0", async () => {
    renderPalette();
    type("zzzznope");
    await waitFor(() => expect(screen.getByText(/맞는 항목이 없습니다/)).toBeInTheDocument());
    expect(screen.getByRole("status").textContent).toMatch(/없습니다/);
  });
});
