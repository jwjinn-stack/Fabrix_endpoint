// Action(writeback) 공용 폼 (IMP-59) — 레지스트리 spec 을 읽어 어떤 verb 든 동일 UI/계약으로 실행.
//  - Parameters: useFieldValidation 이 폼 검증(FieldError 인라인).
//  - Submission Criteria: evaluateSubmission()로 can()+status 게이팅 → 불가면 submit disabled + 기계판독 사유.
//  - Side Effects: 성공/실패 toast(+audit 는 mock 이 기록). Notifications 등 후속 surface 가 audit 소비.
//  - 낙관적 반영: React 19 useOptimistic 로 PROVISIONAL 상태를 즉시 표시하고, mock 이 돌려준 canonical
//    object 로 RECONCILED 로 수렴. timer 를 source of truth 로 쓰지 않으므로 실백엔드 스왑이 no-op.
//  - stale-write(409)·denied(403) 는 outcome 으로 분기해 롤백 + 에러 토스트.
import { useCallback, useMemo, useOptimistic, useState, useTransition } from "react";
import { submitAction } from "../api/client";
import { useCap } from "../capabilities";
import { useToast } from "../toast";
import { useFieldValidation } from "../hooks/useFieldValidation";
import { evaluateSubmission, getActionSpec } from "../actions/registry";
import FieldError from "./FieldError";
import type { ActionResult, ObjectStatus } from "../api/types";

// 수렴 상태 — provisional=낙관적 표시(회색), reconciled=canonical 확정, error=롤백됨.
type Phase = "idle" | "provisional" | "reconciled" | "error";

export interface ActionFormProps {
  actionType: string;      // 레지스트리 verb 이름
  target: string;          // 대상 Object id (예: model:qwen25-vl-7b)
  targetStatus?: ObjectStatus; // 대상 현재 status(게이팅 predicate)
  revision?: number;       // 대상 현재 revision(409 stale-write 방어)
  onDone?: (result: ActionResult) => void; // reconcile 후 상위 갱신 훅
}

export default function ActionForm({ actionType, target, targetStatus, revision, onDone }: ActionFormProps) {
  const spec = getActionSpec(actionType);
  const { can } = useCap();
  const toast = useToast();
  const fv = useFieldValidation(spec?.params ?? []);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pending, startTransition] = useTransition();
  // 낙관적 status — 제출 즉시 전이를 보여주고, 서버 canonical 로 덮어쓴다.
  const [optimisticStatus, applyOptimistic] = useOptimistic<ObjectStatus | undefined, ObjectStatus>(
    targetStatus,
    (_prev, next) => next,
  );

  const submission = useMemo(
    () => (spec ? evaluateSubmission(spec, { can, targetStatus }) : { ok: false, reason: "알 수 없는 action" }),
    [spec, can, targetStatus],
  );

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!spec) return;
      if (!fv.validateAll()) return;           // bad-input — 폼 에러 표시하고 중단
      if (!submission.ok) return;              // 게이팅 실패 — 버튼도 disabled 지만 이중 방어

      // 파라미터 정규화(number 는 Number 로).
      const params: Record<string, unknown> = {};
      for (const p of spec.params) {
        const raw = fv.values[p.name] ?? "";
        params[p.name] = p.kind === "number" ? Number(raw) : raw;
      }

      startTransition(async () => {
        // 낙관적 전이 즉시 표시(useOptimistic 는 transition 안에서만 유효).
        applyOptimistic("warn");
        setPhase("provisional");
        try {
          const res = await submitAction(spec.name, { target, params, revision });
          if (res.outcome === "ok") {
            setPhase("reconciled");
            toast.success(`${spec.label} 반영됨`);
          } else {
            // denied(403)·conflict(409)·error — 롤백(낙관적 상태는 transition 종료로 자동 복귀).
            setPhase("error");
            toast.error(res.reason || `${spec.label} 실패`);
          }
          onDone?.(res);
        } catch (err) {
          setPhase("error");
          toast.error(err instanceof Error ? err.message : `${spec.label} 실패`);
        }
      });
    },
    [spec, fv, submission, applyOptimistic, target, revision, toast, onDone],
  );

  if (!spec) return <div className="empty">알 수 없는 action: {actionType}</div>;

  const disabled = !submission.ok || pending;

  return (
    <form className="action-form" onSubmit={onSubmit} aria-label={`${spec.label} 실행`}>
      <div className="action-form-head">
        <strong>{spec.label}</strong>
        <span className="action-target" title={target}>{target}</span>
        {/* 낙관적/확정 상태 배지 — provisional 은 회색(미확정), reconciled 은 확정 톤 */}
        {phase !== "idle" && (
          <span className={`badge action-phase phase-${phase}`} aria-live="polite">
            {phase === "provisional" && `적용 중… (rev ${optimisticStatus ?? "?"})`}
            {phase === "reconciled" && "확정됨"}
            {phase === "error" && "실패 · 롤백됨"}
          </span>
        )}
      </div>

      {spec.params.map((p) => {
        const errId = `af-err-${spec.name}-${p.name}`;
        const err = fv.touched[p.name] ? fv.errors[p.name] : undefined;
        return (
          <div className="action-field" key={p.name}>
            <label htmlFor={`af-${spec.name}-${p.name}`}>
              {p.name}{p.required && <span aria-hidden="true"> *</span>}
            </label>
            {p.kind === "enum" && p.options ? (
              <select
                id={`af-${spec.name}-${p.name}`}
                value={fv.values[p.name] ?? ""}
                onChange={(e) => fv.setValue(p.name, e.target.value)}
                onBlur={() => fv.touch(p.name)}
                aria-invalid={!!err}
                aria-describedby={err ? errId : undefined}
              >
                {p.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                id={`af-${spec.name}-${p.name}`}
                type={p.kind === "number" ? "number" : "text"}
                value={fv.values[p.name] ?? ""}
                onChange={(e) => fv.setValue(p.name, e.target.value)}
                onBlur={() => fv.touch(p.name)}
                aria-invalid={!!err}
                aria-describedby={err ? errId : undefined}
              />
            )}
            <FieldError id={errId} message={err} />
          </div>
        );
      })}

      {/* Side Effects 안내 — 실행이 무엇을 유발하는지 사전 고지(투명성). */}
      <div className="action-sideeffects">부수효과: {spec.sideEffects.join(" · ")}</div>

      <button type="submit" className="btn-primary" disabled={disabled}>
        {pending ? "실행 중…" : spec.label}
      </button>

      {/* 게이팅 실패 사유 — observe 프로파일에서 "disabled + why" 를 무료로 획득(기계판독 reason). */}
      {!submission.ok && submission.reason && (
        <p className="action-denied-reason" role="note">{submission.reason}</p>
      )}
    </form>
  );
}
