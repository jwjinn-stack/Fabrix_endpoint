// CausePanel(IMP-95) 테스트 — 온-객체 AI 원인 설명(무엇이/왜/영향/다음 조치).
// 케이스: OPT-IN 기본(생성 버튼만) / 생성 클릭 → 4 섹션 렌더(staged, 단일 spinner 아님) /
//         클릭형 인용 navigate / 룰기반 폴백 badge(mock) / zero mutation(패널에 submit/confirm 없음) /
//         empty(환각 금지).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import CausePanel from "./CausePanel";
import type { OntologyLink, OntologyObject } from "../api/types";

// isMockMode 를 제어(mock/실 모델 경로 분기). prefers-reduced-motion 은 jsdom 기본 false → staged 진행.
let mockMode = true;
vi.mock("../api/modelConnection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/modelConnection")>();
  return { ...actual, isMockMode: () => mockMode };
});

const OBJECTS: OntologyObject[] = [
  { id: "endpoint:e-slow", type: "Endpoint", title: "느린 EP", props: { ready: false, replicas: 2, namespace: "fabrix" }, status: "crit", revision: 1 },
  { id: "model:m", type: "Model", title: "모델 M", props: { replicas: 2 }, status: "warn", revision: 1 },
  { id: "gpu:g", type: "GpuDevice", title: "GPU 0", props: { util_perc: 0.97, mem_perc: 0.93, throttle: "열(HW Thermal Slowdown)" }, status: "crit", revision: 1 },
  { id: "node:n", type: "Node", title: "노드 N", props: { hostname: "n0", cpu_util: 0.94, net_err_per_s: 12 }, status: "crit", revision: 1 },
  { id: "gpu:ok", type: "GpuDevice", title: "정상 GPU", props: { util_perc: 0.4, mem_perc: 0.3, throttle: "제약 없음" }, status: "ok", revision: 1 },
];
const LINKS: OntologyLink[] = [
  { from: "endpoint:e-slow", to: "model:m", linkKind: "serves" },
  { from: "model:m", to: "gpu:g", linkKind: "runsOn" },
  { from: "gpu:g", to: "node:n", linkKind: "hostedBy" },
];

beforeEach(() => { mockMode = true; vi.useRealTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("CausePanel — OPT-IN 기본(explicit-click)", () => {
  it("초기에는 4 섹션 미표시, '원인 설명 생성' 버튼만 노출", () => {
    render(<CausePanel objectId="endpoint:e-slow" objects={OBJECTS} links={LINKS} />);
    expect(screen.getByRole("button", { name: "원인 설명 생성" })).toBeInTheDocument();
    // 생성 전에는 섹션 제목이 없다(자동 생성 안 함 — non-blocking).
    expect(screen.queryByText("무엇이")).not.toBeInTheDocument();
    expect(screen.queryByText("왜 (추정 근본원인)")).not.toBeInTheDocument();
    // '열면 자동 생성' 토글은 기본 OFF.
    const toggle = screen.getByRole("checkbox", { name: /자동 생성/ });
    expect(toggle).not.toBeChecked();
  });
});

describe("CausePanel — 생성 → 4 섹션 staged 렌더", () => {
  it("생성 클릭 시 단계 진행 후 4 섹션 모두 렌더(단일 blocking spinner 아님)", () => {
    vi.useFakeTimers();
    render(<CausePanel objectId="endpoint:e-slow" objects={OBJECTS} links={LINKS} />);
    fireEvent.click(screen.getByRole("button", { name: "원인 설명 생성" }));
    // 첫 단계(hypothesis) — '왜' 섹션이 즉시 보인다(도착 섹션 즉시 렌더 = 단일 spinner 아님).
    expect(screen.getByText("왜 (추정 근본원인)")).toBeInTheDocument();
    // 단계 진행 표시(role=status) — blocking spinner 가 아닌 staged 진행 신호.
    expect(screen.getByRole("status")).toBeInTheDocument();
    // 타이머를 끝까지 밀면 conclusion 도달 → 4 섹션 전부.
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("무엇이")).toBeInTheDocument();
    expect(screen.getByText("영향")).toBeInTheDocument();
    expect(screen.getByText("다음 조치")).toBeInTheDocument();
  });
});

describe("CausePanel — 클릭형 인용(navigate)", () => {
  it("objectId 인용 클릭 시 onCite(objectId) 호출", () => {
    vi.useFakeTimers();
    const onCite = vi.fn();
    render(<CausePanel objectId="endpoint:e-slow" objects={OBJECTS} links={LINKS} onCite={onCite} />);
    fireEvent.click(screen.getByRole("button", { name: "원인 설명 생성" }));
    act(() => vi.advanceTimersByTime(1000));
    // endpoint:e-slow 자체 objectId 인용은 클릭 가능 버튼으로 렌더된다.
    const citeBtn = screen.getAllByRole("button", { name: "endpoint:e-slow" })[0];
    fireEvent.click(citeBtn);
    expect(onCite).toHaveBeenCalledWith("endpoint:e-slow");
  });
});

describe("CausePanel — 룰기반 폴백 badge(mock)", () => {
  it("mock 모드면 'rule-based (no model)' badge 표시", () => {
    mockMode = true;
    render(<CausePanel objectId="endpoint:e-slow" objects={OBJECTS} links={LINKS} />);
    expect(screen.getByText("rule-based (no model)")).toBeInTheDocument();
  });

  it("실 모델(mock=false)이면 룰기반 badge 미표시", () => {
    mockMode = false;
    render(<CausePanel objectId="endpoint:e-slow" objects={OBJECTS} links={LINKS} />);
    expect(screen.queryByText("rule-based (no model)")).not.toBeInTheDocument();
  });
});

describe("CausePanel — zero auto-mutation", () => {
  it("패널에 submit/confirm/실행 버튼이 없다(추천은 제안일 뿐)", () => {
    vi.useFakeTimers();
    // onCite 를 주어 인용이 클릭 버튼으로 렌더되게 함 — 그럼에도 mutation(실행/확인)류 버튼은 없어야 한다.
    render(<CausePanel objectId="endpoint:e-slow" objects={OBJECTS} links={LINKS} onCite={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "원인 설명 생성" }));
    act(() => vi.advanceTimersByTime(1000));
    const region = screen.getByRole("region", { name: "AI 원인 설명" });
    const buttons = within(region).queryAllByRole("button");
    // 인용 클릭 버튼(navigate)만 허용 — 실행/확인/전송류 버튼은 없어야 한다.
    for (const b of buttons) {
      expect(b.textContent ?? "").not.toMatch(/실행|확인|전송|적용|submit|apply/i);
    }
  });
});

describe("CausePanel — empty(환각 금지)", () => {
  it("근거 없는 객체 생성 시 emptyReason 표시, 섹션 claim 없음", () => {
    render(<CausePanel objectId="gpu:ok" objects={OBJECTS} links={LINKS} />);
    fireEvent.click(screen.getByRole("button", { name: "원인 설명 생성" }));
    // gpu:ok 는 정상 → 근거 0 → empty 메시지(지어내지 않음).
    expect(screen.getByText(/수집된 이벤트 없음|상관된 근거가 없습니다/)).toBeInTheDocument();
  });
});
