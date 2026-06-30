import { type Column, downloadCSV, downloadJSON } from "../utils/export";

// 표 내보내기 버튼(IMP-23) — 네이티브 <details> 디스클로저(접근성 무료) 로 CSV/JSON 선택.
export default function ExportButton<T>({
  filename,
  rows,
  columns,
  disabled,
}: {
  filename: string;
  rows: T[];
  columns: Column<T>[];
  disabled?: boolean;
}) {
  const off = disabled || rows.length === 0;
  return (
    <details className="export-menu">
      <summary
        className="refresh-btn"
        aria-disabled={off}
        onClick={(e) => {
          if (off) e.preventDefault();
        }}
      >
        내보내기 ▾
      </summary>
      <div className="export-menu-pop" role="menu">
        <button type="button" role="menuitem" onClick={() => downloadCSV(filename, rows, columns)}>
          CSV
        </button>
        <button type="button" role="menuitem" onClick={() => downloadJSON(filename, rows)}>
          JSON
        </button>
      </div>
    </details>
  );
}
