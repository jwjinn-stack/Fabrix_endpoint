// IMP-22 — 필드 인라인 에러 노드. role="alert" 로 SR 이 즉시 announce.
// 빨간 색만으로 표시하지 않고 ⚠ 아이콘 + 텍스트를 동반(WCAG 1.4.1 색상단독 금지).
// 에러가 없으면 아무것도 렌더하지 않는다(aria-describedby 는 노출 시에만 연결됨).
export default function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} className="field-error" role="alert">
      <span aria-hidden="true">⚠</span> {message}
    </span>
  );
}
