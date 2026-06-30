// IMP-22 — 위저드·긴 폼 submit 시 상단 에러 요약(NN/g Forms guidelines).
// role="alert" + tabindex=-1 로 submit 시 포커스를 받아 SR 이 전체 오류 개수를 announce,
// 각 항목은 해당 필드로 점프하는 링크(클릭 시 포커스 이동).
import { type Ref } from "react";

export interface SummaryItem {
  label: string;
  message: string;
  focus?: () => void; // 점프 링크 클릭 시 해당 필드로 포커스 이동
}

export default function FormErrorSummary({
  items,
  summaryRef,
  title = "입력을 확인해 주세요",
}: {
  items: SummaryItem[];
  summaryRef?: Ref<HTMLDivElement>;
  title?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="form-error-summary state error" role="alert" tabIndex={-1} ref={summaryRef}>
      <strong>{title} ({items.length}건)</strong>
      <ul>
        {items.map((it, i) => (
          <li key={i}>
            <button
              type="button"
              className="link"
              onClick={() => it.focus?.()}
            >
              {it.label}: {it.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
