import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useFieldValidation, required } from "./useFieldValidation";
import FieldError from "../components/FieldError";
import FormErrorSummary from "../components/FormErrorSummary";

// 테스트 하니스 — 이메일(형식)·이름(필수) 두 필드 폼.
function Harness({ onValid, summary = false }: { onValid: () => void; summary?: boolean }) {
  const [form, setForm] = useState({ email: "", name: "" });
  const fv = useFieldValidation(
    form,
    {
      email: (v) => {
        const s = String(v).trim();
        if (!s) return "이메일을 입력하세요.";
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? undefined : "올바른 이메일 형식이 아닙니다.";
      },
      name: required("이름을 입력하세요."),
    },
    { summary },
  );
  return (
    <div>
      {summary && (
        <FormErrorSummary
          summaryRef={fv.summaryRef}
          items={fv.visibleErrors.map((e) => ({
            label: e.name === "email" ? "이메일" : "이름",
            message: e.message,
            focus: () => fv.focusField(e.name),
          }))}
        />
      )}
      <label>
        이메일
        <input
          aria-label="이메일"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          {...fv.fieldProps("email")}
        />
      </label>
      <FieldError id={fv.errorId("email")} message={fv.showError("email")} />
      <label>
        이름
        <input
          aria-label="이름"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          {...fv.fieldProps("name")}
        />
      </label>
      <FieldError id={fv.errorId("name")} message={fv.showError("name")} />
      <button type="button" onClick={() => fv.handleSubmit(onValid)}>
        제출
      </button>
    </div>
  );
}

describe("useFieldValidation (IMP-22 접근가능 인라인 검증)", () => {
  it("normal: 모든 필수값이 유효하면 onValid 를 호출하고 에러가 없다", async () => {
    const user = userEvent.setup();
    const onValid = vi.fn();
    render(<Harness onValid={onValid} />);
    await user.type(screen.getByLabelText("이메일"), "a@b.com");
    await user.type(screen.getByLabelText("이름"), "홍길동");
    await user.click(screen.getByText("제출"));
    expect(onValid).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blur: pristine 타이핑 중엔 에러가 없고 blur 시에만 해당 필드 에러+aria-invalid+describedby 연결", async () => {
    const user = userEvent.setup();
    render(<Harness onValid={vi.fn()} />);
    const email = screen.getByLabelText("이메일");
    // 타이핑만으로는(아직 blur 안 함) 에러 없음
    expect(email).not.toHaveAttribute("aria-invalid");
    // 빈 채로 blur → 에러 노출
    await user.click(email);
    await user.tab();
    expect(email).toHaveAttribute("aria-invalid", "true");
    const desc = email.getAttribute("aria-describedby");
    expect(desc).toBeTruthy();
    const errNode = document.getElementById(desc as string);
    expect(errNode).toHaveAttribute("role", "alert");
    expect(errNode).toHaveTextContent("이메일을 입력하세요.");
    // 다른(name) 필드는 아직 touched 아님 → 에러 없음
    expect(screen.getByLabelText("이름")).not.toHaveAttribute("aria-invalid");
  });

  it("submit-with-errors: 빈 폼 제출 → 전체 에러 노출, onValid 미호출", async () => {
    const user = userEvent.setup();
    const onValid = vi.fn();
    render(<Harness onValid={onValid} />);
    await user.click(screen.getByText("제출"));
    expect(onValid).not.toHaveBeenCalled();
    expect(screen.getByLabelText("이메일")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("이름")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(2);
  });

  it("submit-with-errors(summary): 긴 폼은 상단 요약(role=alert, 점프링크)을 렌더한다", async () => {
    const user = userEvent.setup();
    render(<Harness onValid={vi.fn()} summary />);
    await user.click(screen.getByText("제출"));
    // 요약 컨테이너(role=alert, tabindex=-1)
    const summary = document.querySelector(".form-error-summary");
    expect(summary).toBeInTheDocument();
    expect(summary).toHaveAttribute("role", "alert");
    expect(summary).toHaveAttribute("tabindex", "-1");
    // 점프 링크가 필드 개수만큼
    expect(screen.getByText(/이메일:/)).toBeInTheDocument();
    expect(screen.getByText(/이름:/)).toBeInTheDocument();
  });

  it("bad-input: 형식 위반(@ 없는 이메일)은 형식 에러 메시지를 보인다", async () => {
    const user = userEvent.setup();
    render(<Harness onValid={vi.fn()} />);
    const email = screen.getByLabelText("이메일");
    await user.type(email, "not-an-email");
    await user.tab();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("올바른 이메일 형식이 아닙니다.")).toBeInTheDocument();
  });

  it("error-clears-on-fix: 에러 상태 필드에 유효값 입력 시 에러가 즉시 사라지고 aria-invalid 해제", async () => {
    const user = userEvent.setup();
    render(<Harness onValid={vi.fn()} />);
    const email = screen.getByLabelText("이메일");
    await user.click(email);
    await user.tab(); // blur → 에러
    expect(email).toHaveAttribute("aria-invalid", "true");
    // 이미 에러인 필드는 change 마다 재검증 → 유효값 입력 시 즉시 사라짐
    await user.type(email, "a@b.com");
    expect(email).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("이메일을 입력하세요.")).not.toBeInTheDocument();
  });
});
