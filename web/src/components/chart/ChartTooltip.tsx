// Grafana 식 readout 박스 — foreignObject 오버레이 div(IMP-25).
// 모든 값은 React 텍스트 노드(이스케이프)로만 렌더. dangerouslySetInnerHTML 절대 금지.
// 크로스헤어 x 기준으로 좌/우 자동 플립하여 차트 밖으로 넘치지 않게 한다.
export function ChartTooltip({
  x,
  viewW,
  top,
  title,
  rows,
}: {
  x: number;
  viewW: number;
  top: number;
  innerH?: number;
  title: string;
  rows: { label: string; value: string; color?: string }[];
}) {
  // 박스 폭은 viewBox px 기준 근사. 우측 절반이면 왼쪽으로 플립.
  const boxW = 150;
  const flipLeft = x > viewW / 2;
  const fx = flipLeft ? Math.max(x - boxW - 10, 0) : Math.min(x + 10, viewW - boxW);
  const fy = top;
  return (
    <foreignObject x={fx} y={fy} width={boxW} height={120} pointerEvents="none" style={{ overflow: "visible" }}>
      <div className="chart-tooltip" role="presentation">
        <div className="chart-tooltip-title">{title}</div>
        {rows.map((r, i) => (
          <div className="chart-tooltip-row" key={i}>
            <span className="chart-tooltip-key">
              {r.color && <span className="dot" style={{ background: r.color }} />}
              {r.label}
            </span>
            <span className="chart-tooltip-val">{r.value}</span>
          </div>
        ))}
      </div>
    </foreignObject>
  );
}
