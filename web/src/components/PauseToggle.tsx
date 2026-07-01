// PauseToggle(IMP-51) — 실시간 폴링 화면의 '일시정지/재개' 토글.
// 온콜 조사 중 값 급변으로 화면이 흔들리는 것을 멈추기 위한 프리즈 버튼.
// aria-pressed 로 상태 고지, refresh-btn 과 동일 target-size 관례(page-head 우측 배치).
export default function PauseToggle({
  paused,
  onToggle,
  label = "자동 갱신",
}: {
  paused: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`pause-toggle ${paused ? "is-paused" : ""}`}
      aria-pressed={paused}
      title={paused ? `${label} 재개` : `${label} 일시정지`}
      onClick={onToggle}
    >
      <span aria-hidden="true">{paused ? "▶" : "⏸"}</span>
      {paused ? "재개" : "일시정지"}
    </button>
  );
}
