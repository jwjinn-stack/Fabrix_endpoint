// ActionForm(IMP-59) 컴포넌트 테스트 — 파라미터 렌더·게이팅·낙관적 수렴·bad-input.
// useCap 과 client.submitAction 을 모킹해 프로파일(observe/manage)과 서버 응답을 제어한다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(screen.getByText(/models\.write 권한이 없습니다/)).toBeInTheDocument();
  });
});

describe("ActionForm — bad-input", () => {
  it("required 미입력 제출 → FieldError + submitAction 호출 안 함", async () => {
    const spy = vi.spyOn(client, "submitAction");
    renderForm();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText(/필수 입력 항목입니다/)).toBeInTheDocument());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("ActionForm — optimistic provisional→reconciled + idempotencyKey", () => {
  it("정상 제출 → provisional 표시 후 canonical 로 reconcile, submitAction 이 idempotencyKey 를 실어보냄", async () => {
    const spy = vi.spyOn(client, "submitAction").mockResolvedValue(okResult());
    const onDone = vi.fn();
    renderForm({ onDone });

    fireEvent.change(screen.getByLabelText(/count/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button"));

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
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText(/실패 · 롤백됨/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/stale revision/)).toBeInTheDocument());
  });
});
