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
  },
  scaleReplicas: {
    name: "scaleReplicas", target: "Model", label: "레플리카 조정",
    params: [{ name: "count", kind: "number", required: true }],
    requiredCap: "models.write",
    sideEffects: ["audit", "상태전이 pending→running"],
    rulesNote: "replica 수 변경 → pending(warn) 후 running(ok)",
    severity: "destructive", // 용량 변경 = 트래픽 영향 → 확인
  },
  cordonNode: {
    name: "cordonNode", target: "Node", label: "노드 cordon",
    params: [{ name: "reason", kind: "text", required: true }],
    requiredCap: "endpoints.write", // manage 프로파일에서만(observe 는 endpoints.write=false)
    sideEffects: ["audit", "trace 재라우팅 표시"],
    rulesNote: "스케줄 차단 → status=warn",
    severity: "destructive", // 스케줄 차단 = 재라우팅 유발 → 확인
  },
  drainGpu: {
    name: "drainGpu", target: "GpuDevice", label: "GPU drain",
    params: [{ name: "graceSec", kind: "number", required: true }],
    requiredCap: "endpoints.write",
    sideEffects: ["audit", "영향 Service 경고"],
    rulesNote: "워크로드 이전(graceSec) → status=warn",
    severity: "destructive", // 워크로드 강제 이전 = 가장 큰 blast radius → 확인
  },
  // 기존 인시던트 동사 — 일반화된 계약으로 흡수(비회귀).
  ack: {
    name: "ack", target: "Incident", label: "처리중",
    params: [], sideEffects: ["audit"],
    rulesNote: "triggered/snoozed → acked(온톨로지 status 불변)",
  },
  resolve: {
    name: "resolve", target: "Incident", label: "해소",
    params: [], requiredCap: "incident.write",
    allowedStatus: ["ok", "warn", "crit"],
    sideEffects: ["audit", "알림"],
    rulesNote: "해소 처리 → status=ok",
  },
  snooze: {
    name: "snooze", target: "Incident", label: "스누즈",
    params: [{ name: "minutes", kind: "number", required: true }],
    requiredCap: "incident.write",
    sideEffects: ["audit"],
    rulesNote: "silenced_until 설정(온톨로지 status 불변)",
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
