// IMP-97 — 상태 배지 용어 InfoTip. 단일 glossary(statusGlossary.ts)를 IMP-4 InfoTip 으로 렌더.
//
// tooltip-on-demand: hover + keyboard/focus + tap 모두 접근(InfoTip 이 WCAG 1.4.13/2.1.1 담당),
// Esc·바깥 클릭 dismiss, hover-only 아님. 배지 옆 작은 persistent 'ⓘ' 트리거(자동 발화 아님).
// COP/KineticStrip/ObjectView 가 같은 termKey 로 호출 → 3면 동일 문구(중복 정의 금지).
import { glossaryTerm } from "../api/statusGlossary";
import InfoTip from "./InfoTip";

// termKey: statusGlossary 키(triggered/acked/notready/backpressure/warn/crit/blast).
// 미지 key 는 렌더하지 않는다(방어 — 배지가 glossary 밖 상태여도 깨지지 않게).
export default function StatusInfoTip({ termKey }: { termKey: string }) {
  const t = glossaryTerm(termKey);
  if (!t) return null;
  return (
    <span className="status-infotip">
      <InfoTip label={`${t.term} 설명`}>
        <b>{t.term}</b> — {t.short}
        {t.why && <span className="status-infotip-why"> {t.why}</span>}
      </InfoTip>
    </span>
  );
}
