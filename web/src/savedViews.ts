// IMP-24 — 저장된 뷰: 이름→querystring 스냅샷을 localStorage 에 보존(의존성 0).
//
// 우선 localStorage 로 의존성 0 을 유지한다. manage 프로파일의 백엔드 저장 승격(공유·동기화)은
// 차기 과제 — UI 게이팅(canSave)만 이번에 마련한다. 민감 데이터(키/토큰)는 querystring 에 담지
// 않으므로(필터/기간만) localStorage 보존은 안전.
export interface SavedView {
  name: string;
  query: string; // 선행 "?" 없는 querystring 스냅샷 (예: "decision=blocked&range=1h")
  savedAt: number;
}

const PREFIX = "fabrix.savedViews.";
const MAX_VIEWS = 50; // 폭주 방지 상한.

function keyFor(page: string): string {
  return PREFIX + page;
}

function read(page: string): SavedView[] {
  try {
    const raw = localStorage.getItem(keyFor(page));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is SavedView =>
        v && typeof v.name === "string" && typeof v.query === "string" && typeof v.savedAt === "number",
    );
  } catch {
    return [];
  }
}

function write(page: string, views: SavedView[]): SavedView[] {
  try {
    localStorage.setItem(keyFor(page), JSON.stringify(views.slice(0, MAX_VIEWS)));
  } catch {
    /* localStorage 불가(프라이빗 모드 등) — 조용히 무시 */
  }
  return views;
}

// 화면별 저장된 뷰 목록 — 최근 저장 순.
export function listSavedViews(page: string): SavedView[] {
  return read(page).sort((a, b) => b.savedAt - a.savedAt);
}

// 저장 — 동일 이름은 덮어쓴다(querystring 의 선행 "?" 는 제거해 보관).
export function saveView(page: string, name: string, query: string): SavedView[] {
  const trimmed = name.trim();
  if (!trimmed) return listSavedViews(page);
  const q = query.startsWith("?") ? query.slice(1) : query;
  const existing = read(page).filter((v) => v.name !== trimmed);
  const next = [...existing, { name: trimmed, query: q, savedAt: Date.now() }];
  write(page, next);
  return listSavedViews(page);
}

// 삭제.
export function deleteView(page: string, name: string): SavedView[] {
  const next = read(page).filter((v) => v.name !== name);
  write(page, next);
  return listSavedViews(page);
}
