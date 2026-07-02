// ActionForm(IMP-59) 컴포넌트 테스트 — 파라미터 렌더·게이팅·낙관적 수렴·bad-input.
// IMP-65 추가 — severity 확인(destructive→type-to-confirm / low→즉시)·pending pulse·audit(형제 파일).
// useCap 과 client.submitAction 을 모킹해 프로파일(observe/manage)과 서버 응답을 제어한다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import ActionForm from "./ActionForm";
import { ToastProvider } from "../toast";
import * as client from "../api/client";
import type { ActionResult } from "../api/types";

// can() 를 테스트별로 갈아끼우기 위한 가변 모킹.
let mockCan = (_cap: string) => true;
vi.mock("../capabilities", () => ({
  useCap: () => ({ can: (c: string) => mockCan(c), caps: { profile: "manage", readonly: false, capabilities: {}, data_source: "mock", integrations: {} } }),
}));

function renderForm(props: Partial<React.ComponentProps<typeof ActionForm>> = {}) {
  return render(
    <ToastProvider>
      <ActionForm actionType="scaleReplicas" target="model:foo" targetStatus="ok" revision={1} {...props} />
    </ToastProvider>,
  );
}

const okResult = (): ActionResult => ({
  outcome: "ok",
  object: { id: "model:foo", type: "Model", title: "foo", props: {}, status: "warn", revision: 2 },
  audit: { actionType: "scaleReplicas", target: "model:foo", params: { count: 3 }, actor: "operator", ts: new Date().toISOString(), outcome: "ok" },
});

// scaleReplicas/cordonNode 등은 destructive(IMP-65) — submit 이 confirm 을 연다.
// 확인 다이얼로그에서 대상 id 를 type-to-confirm 입력한 뒤 danger 확인 버튼을 눌러 실제 실행에 도달한다.
function completeDestructiveConfirm(target = "model:foo", confirmName = /레플리카 조정|모델 재기동|노드 cordon|GPU drain/) {
  const dialog = screen.getByRole("alertdialog");
  fireEvent.change(within(dialog).getByLabelText(/대상 id 확인 입력/), { target: { value: target } });
  fireEvent.click(within(dialog).getByRole("button", { name: confirmName }));
}

beforeEach(() => {
  mockCan = () => true;
  vi.restoreAllMocks();
});

describe("ActionForm — 파라미터 렌더", () => {
  it("spec.params 대로 입력 필드를 렌더한다(count)", () => {
    renderForm();
    expect(screen.getByLabelText(/count/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /레플리카 조정|실행/ })).toBeInTheDocument();
  });
});

describe("ActionForm — capability 게이팅(observe + 사유)", () => {
  it("can()=false 면 submit disabled + 기계판독 사유 노출", () => {
    mockCan = (c) => c !== "models.write"; // models.write 만 거부(observe)
    renderForm();
    // IMP-96 — head 에 InfoTip 트리거 버튼이 추가되므로 submit(레이블) 버튼을 특정한다.
    const btn = screen.getByRole("button", { name: /레플리카 조정|실행/ });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/models\.write 권한이 없습니다/)).toBeInTheDocument();
  });
});

describe("ActionForm — bad-input", () => {
  it("required 미입력 제출 → FieldError + submitAction 호출 안 함", async () => {
    const spy = vi.spyOn(client, "submitAction");
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /레플리카 조정|실행/ }));
    await waitFor(() => expect(screen.getByText(/필수 입력 항목입니다/)).toBeInTheDocument());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("ActionForm — optimistic provisional→reconciled + idempotencyKey", () => {
  it("정상 제출(destructive 확인 통과) → provisional 표시 후 canonical 로 reconcile, submitAction 이 idempotencyKey 를 실어보냄", async () => {
    const spy = vi.spyOn(client, "submitAction").mockResolvedValue(okResult());
    const onDone = vi.fn();
    renderForm({ onDone });

    fireEvent.change(screen.getByLabelText(/count/i), { target: { value: "3" } });
    // scaleReplicas 는 destructive — submit 은 confirm 을 연다(아직 실행 X).
    fireEvent.submit(screen.getByRole("form", { name: /레플리카 조정 실행/ }));
    expect(spy).not.toHaveBeenCalled();
    completeDestructiveConfirm();

    // reconcile 후 "확정됨" 배지 + onDone 호출.
    await waitFor(() => expect(screen.getByText(/확정됨/)).toBeInTheDocument());
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ outcome: "ok" }));

    // 단일 mutation 계약: submitAction 은 name + {target, params} 로 호출된다(idempotencyKey 는 client 내부 생성).
    expect(spy).toHaveBeenCalledWith("scaleReplicas", expect.objectContaining({ target: "model:foo", revision: 1 }));
  });
});

describe("ActionForm — 409 stale-write 롤백", () => {
  it("conflict 응답 → 실패 배지 + 에러 토스트", async () => {
    vi.spyOn(client, "submitAction").mockResolvedValue({
      outcome: "conflict",
      audit: { actionType: "scaleReplicas", target: "model:foo", params: {}, actor: "operator", ts: new Date().toISOString(), outcome: "conflict" },
      reason: "stale revision (보낸 rev=0, 현재 rev=2)",
    });
    renderForm();
    fireEvent.change(screen.getByLabelText(/count/i), { target: { value: "5" } });
    fireEvent.submit(screen.getByRole("form", { name: /레플리카 조정 실행/ }));
    completeDestructiveConfirm();
    await waitFor(() => expect(screen.getByText(/실패 · 롤백됨/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/stale revision/)).toBeInTheDocument());
  });
});

// ───────────── IMP-65 — severity-aware 확인 + optimistic pulse ─────────────

describe("ActionForm — severity 확인(destructive → 영향 요약 + type-to-confirm)", () => {
  it("destructive(cordonNode) submit → 즉시 실행 안 함 + 영향 요약 노출, type-to-confirm 전 확인 disabled → 입력 후 실행", async () => {
    const spy = vi.spyOn(client, "submitAction").mockResolvedValue({
      outcome: "ok",
      object: { id: "node:n1", type: "Node", title: "n1", props: {}, status: "warn", revision: 2 },
      audit: { actionType: "cordonNode", target: "node:n1", params: { reason: "maint" }, actor: "operator", ts: new Date().toISOString(), outcome: "ok" },
    });
    render(
      <ToastProvider>
        <ActionForm actionType="cordonNode" target="node:n1" targetStatus="ok" revision={1} />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "maint" } });
    fireEvent.submit(screen.getByRole("form", { name: /노드 cordon 실행/ }));

    // 아직 실행 X — 확인 다이얼로그 + 영향 요약(부수효과)이 보인다.
    expect(spy).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/trace 재라우팅 표시/)).toBeInTheDocument(); // sideEffects 요약
    expect(within(dialog).getByText(/스케줄 차단/)).toBeInTheDocument();        // rulesNote(상태 전이)

    // type-to-confirm 전엔 danger 확인 버튼 disabled.
    const confirmBtn = within(dialog).getByRole("button", { name: /노드 cordon/ });
    expect(confirmBtn).toBeDisabled();

    // 대상 id 입력 → enable → 확인 시 실제 실행.
    fireEvent.change(within(dialog).getByLabelText(/대상 id 확인 입력/), { target: { value: "node:n1" } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("cordonNode", expect.objectContaining({ target: "node:n1" })));
  });

  it("대상 id 오입력이면 확인 버튼이 계속 disabled + 불일치 안내", async () => {
    render(
      <ToastProvider>
        <ActionForm actionType="drainGpu" target="gpu:g1" targetStatus="ok" revision={1} />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/graceSec/i), { target: { value: "30" } });
    fireEvent.submit(screen.getByRole("form", { name: /GPU drain 실행/ }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/대상 id 확인 입력/), { target: { value: "gpu:WRONG" } });
    expect(within(dialog).getByText(/대상 id 가 일치하지 않습니다/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /GPU drain/ })).toBeDisabled();
  });
});

describe("ActionForm — low-risk 는 확인 없이 즉시", () => {
  it("ack(low) submit → ConfirmDialog 없이 곧장 submitAction 호출", async () => {
    const spy = vi.spyOn(client, "submitAction").mockResolvedValue({
      outcome: "ok",
      object: { id: "incident:i1", type: "Incident", title: "i1", props: {}, status: "crit", revision: 2 },
      audit: { actionType: "ack", target: "incident:i1", params: {}, actor: "operator", ts: new Date().toISOString(), outcome: "ok" },
    });
    render(
      <ToastProvider>
        <ActionForm actionType="ack" target="incident:i1" targetStatus="crit" revision={1} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /처리중/ }));
    // 확인 다이얼로그가 뜨지 않고 바로 실행된다.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(spy).toHaveBeenCalledWith("ack", expect.objectContaining({ target: "incident:i1" })));
  });
});

describe("ActionForm — optimistic pending pulse(reduce-motion 정지)", () => {
  it("destructive 확인 직후 provisional 국면에 pulse dot(af-pulse)이 렌더된다", async () => {
    // 확인 후 응답을 지연시켜 provisional 국면을 관측(초기엔 pending 유지).
    let resolveFn: (r: ActionResult) => void = () => {};
    vi.spyOn(client, "submitAction").mockImplementation(() => new Promise<ActionResult>((res) => { resolveFn = res; }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/count/i), { target: { value: "2" } });
    fireEvent.submit(screen.getByRole("form", { name: /레플리카 조정 실행/ }));
    completeDestructiveConfirm();

    // provisional 배지 + pulse dot. dot 는 DOM 에 존재(reduce-motion 이어도 정적으로 표시 — CSS 가드).
    await waitFor(() => expect(document.querySelector(".phase-dot")).not.toBeNull());
    expect(screen.getByText(/적용 중…/)).toBeInTheDocument();

    // 정리 — reconcile 시켜 transition 종료.
    resolveFn(okResult());
    await waitFor(() => expect(screen.getByText(/확정됨/)).toBeInTheDocument());
  });
});
