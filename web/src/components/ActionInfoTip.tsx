// IMP-96 — 액션 인라인 설명(무엇을·언제·상태전이·부수효과·되돌리기). 버튼 앞에서.
//  - 단일 출처: registry 의 ActionSpec(whenToUse·rulesNote·sideEffects·reversible)만 읽는다.
//  - 접근성: 네이티브 title 대신 InfoTip(focus+hover 트리거·Esc·hoverable·persistent; WCAG 1.4.13+2.1.1).
//  - consequence-tier(과설명 회피): consequential(drain/cordon/restart/scale)은 풀 사다리,
//    lifecycle(ack/resolve/snooze)은 전이 부제만.
//  - 인접에 ReversibleChip(되돌리기 가능/부분/불가) — redundant 시각 신호(색-only 금지, 텍스트 병기).
// ActionForm · KineticStrip 사다리 · ObjectView(폼 경유) 3면이 이 컴포넌트를 공유한다.
import { actionTier, reversibilityLabel, type ActionSpec } from "../actions/registry";
import Badge from "./Badge";
import InfoTip from "./InfoTip";

// 되돌리기 칩 — registry.reversibilityLabel 단일 출처. 버튼 인접 redundant 신호.
export function ReversibleChip({ spec }: { spec: ActionSpec }) {
  const r = reversibilityLabel(spec.reversible);
  return (
    <Badge tone={r.tone} title={spec.reversible.how}>
      {r.chip}
    </Badge>
  );
}

// 액션 설명 InfoTip — tier 에 맞춰 풀 사다리 / 전이 부제만.
export function ActionInfoTip({ spec }: { spec: ActionSpec }) {
  const tier = actionTier(spec);
  // 접근 이름은 verb 라벨을 포함하지 않는 고정 문구("액션 설명 보기")로 둔다 — 액션 실행 버튼의
  // 접근 이름(spec.label)과 충돌하지 않게(스크린리더는 인접 실행 버튼의 라벨로 어떤 액션인지 이미 파악).
  return (
    <InfoTip label="액션 설명 보기">
      <span className="action-tip">
        <b className="action-tip-title">{spec.label}</b>
        {tier === "consequential" ? (
          // 풀 사다리 — 무엇·언제·상태전이·부수효과·되돌리기.
          <dl className="action-tip-dl">
            <dt>언제</dt>
            <dd>{spec.whenToUse}</dd>
            <dt>상태 전이</dt>
            <dd>{spec.rulesNote}</dd>
            <dt>부수효과</dt>
            <dd>{spec.sideEffects.join(" · ")}</dd>
            <dt>되돌리기</dt>
            <dd>
              {reversibilityLabel(spec.reversible).chip}
              {spec.reversible.how ? ` — ${spec.reversible.how}` : ""}
            </dd>
          </dl>
        ) : (
          // lifecycle — 전이 부제 한 줄 + 언제(과설명 회피).
          <span className="action-tip-lite">
            <span className="action-tip-transition">{spec.rulesNote}</span>
            <span className="action-tip-when">{spec.whenToUse}</span>
          </span>
        )}
      </span>
    </InfoTip>
  );
}
