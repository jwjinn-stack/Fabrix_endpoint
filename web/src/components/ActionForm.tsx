// Action(writeback) 공용 폼 (IMP-59) — 레지스트리 spec 을 읽어 어떤 verb 든 동일 UI/계약으로 실행.
//  - Parameters: useFieldValidation 이 폼 검증(FieldError 인라인).
//  - Submission Criteria: evaluateSubmission()로 can()+status 게이팅 → 불가면 submit disabled + 기계판독 사유.
//  - Side Effects: 성공/실패 toast(+audit 는 mock 이 기록). Notifications 등 후속 surface 가 audit 소비.
//  - 낙관적 반영: React 19 useOptimistic 로 PROVISIONAL 상태를 즉시 표시하고, mock 이 돌려준 canonical
//    object 로 RECONCILED 로 수렴. timer 를 source of truth 로 쓰지 않으므로 실백엔드 스왑이 no-op.
//  - stale-write(409)·denied(403) 는 outcome 으로 분기해 롤백 + 에러 토스트.
//
// IMP-65(시각 완성도 — 계약 불변, 레이어만 추가):
//  - Severity-aware confirm: destructive 동사(cordon/drain/scale/restart)는 submit 이 바로 실행하지 않고
//    danger ConfirmDialog(영향 요약 + type-to-confirm 대상 id 입력)를 거친다. low 동사(ack/snooze)는 즉시.
//  - Optimistic 배지에 pending pulse(dot) — provisional 국면. reconciled=스틸블루 확정, error=danger.
//    pulse 는 prefers-reduced-motion 존중(전역 규칙 + @media 가드로 정지).
import { useCallback, useMemo, useOptimistic, useState, useTransition } from "react";
import { submitAction } from "../api/client";
import { useCap } from "../capabilities";
import { useToast } from "../toast";
import { useFieldValidation } from "../hooks/useFieldValidation";
import { actionSeverity, evaluateSubmission, getActionSpec } from "../actions/registry";
import FieldError from "./FieldError";
import ConfirmDialog from "./ConfirmDialog";
import { ActionInfoTip, ReversibleChip } from "./ActionInfoTip";
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
  // IMP-65 — destructive 확인 게이트. confirmOpen=다이얼로그 표시, confirmText=type-to-confirm 입력값.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const severity = spec ? actionSeverity(spec) : "low";
  // 낙관적 status — 제출 즉시 전이를 보여주고, 서버 canonical 로 덮어쓴다.
  const [optimisticStatus, applyOptimistic] = useOptimistic<ObjectStatus | undefined, ObjectStatus>(
    targetStatus,
    (_prev, next) => next,
  );

  const submission = useMemo(
    () => (spec ? evaluateSubmission(spec, { can, targetStatus }) : { ok: false, reason: "알 수 없는 action" }),
    [spec, can, targetStatus],
  );

  // 실제 실행 — 낙관적 전이 → submitAction → reconcile/rollback. IMP-59 계약/로직 그대로(추출만).
  // low 는 submit 에서 바로, destructive 는 confirm 확인 후 이 함수를 호출한다(경로만 다르고 계약 동일).
  const runAction = useCallback(() => {
    if (!spec) return;
    // 파라미터 정규화(number 는 Number 로).
    const params: Record<string, unknown> = {};
    for (const p of spec.params) {
      const raw = fv.values[p.name] ?? "";
      params[p.name] = p.kind === "number" ? Number(raw) : raw;
    }

    // provisional 배지·pulse 는 클릭 즉시 커밋(transition 밖) — pending transition 이 settle 될 때까지
    // 기다리지 않고 "지금 반영 중" 신호를 바로 보여준다(IMP-65 시각 레이어). 계약은 불변.
    setPhase("provisional");
    startTransition(async () => {
      // 낙관적 status 전이(useOptimistic 는 transition 안에서만 유효).
      applyOptimistic("warn");
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
  }, [spec, fv, applyOptimistic, target, revision, toast, onDone]);

  // submit 게이트 — 검증·게이팅 통과 후 severity 로 분기: destructive→confirm, low→즉시 실행.
  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!spec) return;
      if (!fv.validateAll()) return;           // bad-input — 폼 에러 표시하고 중단
      if (!submission.ok) return;              // 게이팅 실패 — 버튼도 disabled 지만 이중 방어
      if (severity === "destructive") {
        // blast radius 가 있는 동사 — 명시적 확인(type-to-confirm)을 요구. 아직 실행 안 함.
        setConfirmText("");
        setConfirmOpen(true);
        return;
      }
      runAction();
    },
    [spec, fv, submission, severity, runAction],
  );

  // confirm 확인 — type-to-confirm 통과 시 실행. 닫고 실행(runAction 은 별도 transition).
  const onConfirm = useCallback(() => {
    setConfirmOpen(false);
    runAction();
  }, [runAction]);

  if (!spec) return <div className="empty">알 수 없는 action: {actionType}</div>;

  const disabled = !submission.ok || pending;
  // type-to-confirm — 대상 id 를 정확히 입력해야 확인 버튼 enable(Vercel/Stripe 오조작 방지 패턴).
  const confirmReady = confirmText.trim() === target;

  return (
    <form className="action-form" onSubmit={onSubmit} aria-label={`${spec.label} 실행`}>
      <div className="action-form-head">
        <strong>{spec.label}</strong>
        {/* IMP-96 — 버튼 앞 인라인 설명(접근가능 InfoTip) + 되돌리기 칩. registry 단일 출처. */}
        <ActionInfoTip spec={spec} />
        <ReversibleChip spec={spec} />
        <span className="action-target" title={target}>{target}</span>
        {/* 낙관적/확정 상태 배지 — provisional 은 회색(미확정)+pending pulse, reconciled 은 확정 톤.
            IMP-65: provisional 국면에 pulse dot(reduce-motion 정지). 색-only 금지 — 텍스트 병기 유지. */}
        {phase !== "idle" && (
          <span className={`badge action-phase phase-${phase}`} aria-live="polite">
            {phase === "provisional" && <span className="phase-dot" aria-hidden="true" />}
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

      {/* IMP-65 — destructive 확인. danger 톤 + 영향 요약(sideEffects·rulesNote·대상) + type-to-confirm.
          low 동사는 confirmOpen 이 true 가 되지 않으므로 이 다이얼로그를 전혀 거치지 않는다. */}
      {severity === "destructive" && (
        <ConfirmDialog
          open={confirmOpen}
          danger
          busy={pending}
          confirmDisabled={!confirmReady}
          title={`${spec.label} 실행 확인`}
          confirmLabel={spec.label}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={onConfirm}
          message={
            <div className="action-confirm">
              <p className="action-confirm-lead">
                이 작업은 되돌리기 어려운 영향이 있습니다. 실행하면 다음이 발생합니다:
              </p>
              {/* 영향 요약 — 상태 전이(rulesNote) + 부수효과(sideEffects). 사전 고지(투명성). */}
              <ul className="action-impact">
                <li><span className="action-impact-k">상태 전이</span>{spec.rulesNote}</li>
                {spec.sideEffects.map((s) => (
                  <li key={s}><span className="action-impact-k">부수효과</span>{s}</li>
                ))}
              </ul>
              {/* type-to-confirm — 대상 id 를 정확히 입력해야 확인 활성(오조작 방지). */}
              <label className="action-confirm-field" htmlFor={`af-confirm-${spec.name}`}>
                확인을 위해 대상 id <code>{target}</code> 를 입력하세요
              </label>
              <input
                id={`af-confirm-${spec.name}`}
                className="action-confirm-input"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={target}
                autoComplete="off"
                aria-label={`대상 id 확인 입력 (${target})`}
              />
              {!confirmReady && confirmText.length > 0 && (
                <p className="action-confirm-mismatch" role="alert">대상 id 가 일치하지 않습니다.</p>
              )}
            </div>
          }
        />
      )}
    </form>
  );
}
