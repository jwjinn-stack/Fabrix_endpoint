// Action(writeback) 레지스트리 (IMP-59) — Palantir Foundry Action Type 4요소를 그대로 미러링.
// docs/palantir-ontology-analysis.md §2·§5.3. verb 별로 Parameters / Rules / Submission Criteria /
// Side Effects 를 선언하고, <ActionForm> 과 mock(applyAction)이 이 **단일 출처**를 함께 읽는다.
//
// 중요: 이 파일은 프론트/mock 공용 계약이다. capability·상태 게이팅은 UI 숨김이 아니라
// evaluateSubmission()로 판정하고, mock 도 동일 규칙으로 서버 등가 거부(403)를 낸다(trust boundary).
import type { ActionParam, ObjectStatus, ObjectType, SubmissionCheck } from "../api/types";

// Action 위험 위계(IMP-65) — 시각 레이어 전용(마찰 강도 결정). 계약/게이팅과 무관한 가산 필드.
//  destructive: 실제 blast radius(상태 전이·워크로드 이전) → 명시적 확인 + type-to-confirm.
//  low: 온톨로지 status 불변 또는 해소(ack/snooze/resolve) → 확인 없이 즉시.
export type ActionSeverity = "low" | "destructive";

// IMP-96 — 되돌리기(reversibility) 선언. value=가역성, how=되돌리는 방법(사람용, 있으면).
//  yes: 완전 가역(예: uncordon, 재조정) — 저 blast-radius면 heavy confirm 대신 Undo affordance 우선(NNG).
//  partial: 부분 가역(예: 재기동의 순간 중단·drain 재배치처럼 일부는 복원 불가) — heavy confirm 유지.
//  no: 불가역 — heavy confirm 필수(destructive-confirm trust boundary).
export type Reversibility = { value: "yes" | "no" | "partial"; how?: string };

export interface ActionSpec {
  name: string;             // verb 식별자(라우트 /ontology/actions/:name 과 동일)
  target: ObjectType;       // 대상 Object Type
  label: string;            // 화면 표기(버튼/제목)
  params: ActionParam[];    // Parameters — 사용자 입력 폼 스키마
  requiredCap?: string;     // Submission Criteria — capability(없으면 기본 허용)
  allowedStatus?: ObjectStatus[]; // Submission Criteria — 이 상태에서만 실행(없으면 무제한)
  sideEffects: string[];    // Side Effects — audit·알림 라벨(실행은 프레임워크가 담당)
  rulesNote: string;        // Rules — 상태 전이 설명(사람용). 실제 전이는 STATE_TRANSITION.
  severity?: ActionSeverity; // IMP-65 — 확인 마찰 강도(가산). 미지정 시 actionSeverity()가 "low" fallback.
  // IMP-96 — 버튼 앞 인라인 설명의 단일 출처. 폼·KineticStrip 사다리·ObjectView 3면이 함께 읽는다.
  whenToUse: string;        // 언제 쓰는가(사람용 가이드). 초심자가 버튼 앞에서 판단하도록.
  reversible: Reversibility; // 되돌리기 가능 여부(+방법). reversible chip·InfoTip 단일 출처.
}

// Rules — verb 실행 시 대상 Object 의 canonical status 전이(mock 이 반영, 실백엔드도 동일 규약).
// undefined 면 상태 불변(예: ack/snooze 는 온톨로지 status 를 바꾸지 않고 audit 만).
export const STATE_TRANSITION: Record<string, ObjectStatus | undefined> = {
  restartModel: "ok",     // 재기동 → 정상 수렴
  scaleReplicas: "warn",  // 스케일 → 일시 pending(warn) → (후속 tick 에서 ok, 여기선 provisional 표현)
  cordonNode: "warn",     // cordon → 스케줄 차단(warn)
  drainGpu: "warn",       // drain → 워크로드 이전 중(warn)
  ack: undefined,
  resolve: "ok",
  snooze: undefined,
};

export const ACTION_REGISTRY: Record<string, ActionSpec> = {
  restartModel: {
    name: "restartModel", target: "Model", label: "모델 재기동",
    params: [{ name: "reason", kind: "text", required: true }],
    requiredCap: "models.write",
    sideEffects: ["audit", "알림"],
    rulesNote: "파드 롤링 재기동 → status=ok 로 수렴",
    severity: "destructive", // 파드 재기동 = 순간 서빙 중단(blast radius) → 확인
    whenToUse: "설정 반영·행(hang)·메모리 누수 등으로 서빙이 불안정할 때 파드를 롤링 재기동해 정상 상태로 수렴시킵니다.",
    reversible: { value: "partial", how: "롤링 재기동은 자동 수렴하지만, 재기동 중 진행하던 요청·순간 서빙 중단은 되돌릴 수 없습니다." },
  },
  scaleReplicas: {
    name: "scaleReplicas", target: "Model", label: "레플리카 조정",
    params: [{ name: "count", kind: "number", required: true }],
    requiredCap: "models.write",
    sideEffects: ["audit", "상태전이 pending→running"],
    rulesNote: "replica 수 변경 → pending(warn) 후 running(ok)",
    severity: "destructive", // 용량 변경 = 트래픽 영향 → 확인
    whenToUse: "트래픽·큐 적체로 용량이 부족하거나(증설), 비용 절감을 위해 유휴 용량을 줄일 때(축소) 레플리카 수를 조정합니다.",
    reversible: { value: "yes", how: "레플리카 수를 다시 조정하면 이전 용량으로 복구됩니다." },
  },
  cordonNode: {
    name: "cordonNode", target: "Node", label: "노드 cordon",
    params: [{ name: "reason", kind: "text", required: true }],
    requiredCap: "endpoints.write", // manage 프로파일에서만(observe 는 endpoints.write=false)
    sideEffects: ["audit", "trace 재라우팅 표시"],
    rulesNote: "스케줄 차단 → status=warn",
    severity: "destructive", // 스케줄 차단 = 재라우팅 유발 → 확인
    whenToUse: "노드 점검·하드웨어 이상으로 새 워크로드가 이 노드에 배치되지 않도록 스케줄을 막을 때 사용합니다.",
    reversible: { value: "yes", how: "uncordon 하면 다시 스케줄 대상이 됩니다(기존 파드는 그대로 유지)." },
  },
  drainGpu: {
    name: "drainGpu", target: "GpuDevice", label: "GPU drain",
    params: [{ name: "graceSec", kind: "number", required: true }],
    requiredCap: "endpoints.write",
    sideEffects: ["audit", "영향 Service 경고"],
    rulesNote: "워크로드 이전(graceSec) → status=warn",
    severity: "destructive", // 워크로드 강제 이전 = 가장 큰 blast radius → 확인
    whenToUse: "GPU 하드웨어 이상(XID·throttle)·교체·점검으로 해당 GPU의 워크로드를 다른 자원으로 안전하게 이전해야 할 때 사용합니다.",
    reversible: { value: "partial", how: "GPU 자체는 다시 편입할 수 있으나, 이전된 워크로드는 자동으로 되돌아오지 않아 재배치가 필요합니다." },
  },
  // 기존 인시던트 동사 — 일반화된 계약으로 흡수(비회귀).
  ack: {
    name: "ack", target: "Incident", label: "처리중",
    params: [], sideEffects: ["audit"],
    rulesNote: "triggered/snoozed → acked(온톨로지 status 불변)",
    whenToUse: "담당자가 인시던트를 인지하고 조사에 착수했음을 알릴 때 사용합니다.",
    reversible: { value: "yes", how: "온톨로지 status 를 바꾸지 않으며(audit 만), 이후 해소/스누즈로 자유롭게 전이할 수 있습니다." },
  },
  resolve: {
    name: "resolve", target: "Incident", label: "해소",
    params: [], requiredCap: "incident.write",
    allowedStatus: ["ok", "warn", "crit"],
    sideEffects: ["audit", "알림"],
    rulesNote: "해소 처리 → status=ok",
    whenToUse: "근본 원인이 해소되어 인시던트를 종료 처리할 때 사용합니다.",
    reversible: { value: "partial", how: "종료로 표시되지만, 동일 조건이 재발하면 인시던트가 다시 열립니다(재오픈)." },
  },
  snooze: {
    name: "snooze", target: "Incident", label: "스누즈",
    params: [{ name: "minutes", kind: "number", required: true }],
    requiredCap: "incident.write",
    sideEffects: ["audit"],
    rulesNote: "silenced_until 설정(온톨로지 status 불변)",
    whenToUse: "야간·유지보수 창처럼 일시적으로 알림을 묵음(silence)하고 싶을 때 사용합니다.",
    reversible: { value: "yes", how: "지정 시간이 만료되거나 스누즈를 해제하면 다시 알림이 활성화됩니다(status 불변)." },
  },
  // (IMP-90: PROCESS 층 Task verb(assign/reassign/resolveTask)는 제거 — /inbox 및 과업 할당 레이어 폐기.)
};

export function getActionSpec(name: string): ActionSpec | undefined {
  return ACTION_REGISTRY[name];
}

// IMP-65 — 확인 마찰 강도. 미지정 spec 은 "low"(가벼운 동사) 로 안전 fallback.
// destructive 만 명시적 확인 + type-to-confirm 을 요구한다(ActionForm 시각 레이어).
export function actionSeverity(spec: ActionSpec): ActionSeverity {
  return spec.severity ?? "low";
}

// IMP-96 — consequence-tier(과설명 회피). severity 를 재사용해 새 축을 발명하지 않는다:
//  consequential(destructive): 풀 사다리(무엇·언제·상태전이·부수효과·되돌리기) InfoTip.
//  lifecycle(low): 전이 부제만(triggered→acked) — ack/resolve/snooze 는 한 줄이면 충분.
export type ActionTier = "consequential" | "lifecycle";
export function actionTier(spec: ActionSpec): ActionTier {
  return actionSeverity(spec) === "destructive" ? "consequential" : "lifecycle";
}

// IMP-96 — 되돌리기 칩 라벨/톤 단일 출처(색-only 금지 — 텍스트 병기). tone 은 Badge 톤 어휘와 정합.
export function reversibilityLabel(r: Reversibility): { chip: string; tone: "green" | "amber" | "red" } {
  switch (r.value) {
    case "yes": return { chip: "되돌리기 가능", tone: "green" };
    case "partial": return { chip: "부분 가역", tone: "amber" };
    case "no": return { chip: "되돌릴 수 없음", tone: "red" };
  }
}

// §2 Submission Criteria — capability + 대상 status predicate 판정. 불가면 기계판독 reason 을 준다.
// UI(disabled+사유)와 mock(403+reason)이 같은 함수를 쓰므로 게이팅이 어긋나지 않는다(단일 출처).
export function evaluateSubmission(
  spec: ActionSpec,
  ctx: { can: (cap: string) => boolean; targetStatus?: ObjectStatus },
): SubmissionCheck {
  if (spec.requiredCap && !ctx.can(spec.requiredCap)) {
    return { ok: false, reason: `${spec.requiredCap} 권한이 없습니다 (읽기 전용 프로파일)` };
  }
  if (spec.allowedStatus && ctx.targetStatus && !spec.allowedStatus.includes(ctx.targetStatus)) {
    return { ok: false, reason: `현재 상태(${ctx.targetStatus})에서는 실행할 수 없습니다` };
  }
  return { ok: true };
}
