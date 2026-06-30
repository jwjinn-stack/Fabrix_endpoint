// 표 데이터 내보내기(IMP-23) — CSV/JSON 공용 유틸. 이전엔 Usage 한 화면에만 CSV 가 있었다.
// 트레이스·세션·가드 증적·키 등 조사 표 어디서나 동일하게 반출.

export interface Column<T> {
  key: string;
  header: string;
  get: (r: T) => string | number | boolean | null | undefined;
}

function csvCell(v: string | number | boolean | null | undefined): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV<T>(rows: T[], cols: Column<T>[]): string {
  const head = cols.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => cols.map((c) => csvCell(c.get(r))).join(",")).join("\n");
  return body ? `${head}\n${body}` : head;
}

function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const BOM = "\uFEFF"; // Excel 한글 인코딩 힌트

export function downloadCSV<T>(filename: string, rows: T[], cols: Column<T>[]): void {
  // BOM(U+FEFF) 선두 — Excel 에서 한글 깨짐 방지.
  download(`${filename}.csv`, BOM + toCSV(rows, cols), "text/csv;charset=utf-8");
}

export function downloadJSON(filename: string, data: unknown): void {
  download(`${filename}.json`, JSON.stringify(data, null, 2), "application/json");
}
