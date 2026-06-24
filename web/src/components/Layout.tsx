import { useEffect, useState, type ReactNode } from "react";
import NotificationsDrawer from "./Notifications";

export type Page =
  | "dashboard"
  | "usage"
  | "guard"
  | "models"
  | "model-import"
  | "playground"
  | "eval"
  | "endpoints"
  | "gpu"
  | "keys"
  | "traffic"
  | "settings"
  | "credentials";

type NavChild = { label: string; page: Page };
type NavItem = { glyph: string; label: string; page?: Page; soon?: boolean; children?: NavChild[] };

// 증권사 인퍼런스 관제 콘솔 — 의미가 또렷한 단색 글리프(이모지 배제로 톤 통일).
// 모델/설정은 하위 메뉴(서브)를 가진다(Nutanix Enterprise AI 패턴).
const NAV: NavItem[] = [
  { glyph: "▦", label: "관제", page: "dashboard" },
  { glyph: "▤", label: "사용량", page: "usage" },
  { glyph: "▣", label: "가드레일", page: "guard" },
  { glyph: "◆", label: "모델", page: "models", children: [{ label: "모델 임포트", page: "model-import" }] },
  { glyph: "❯", label: "플레이그라운드", page: "playground" },
  { glyph: "◎", label: "평가", page: "eval" },
  { glyph: "⬡", label: "엔드포인트", page: "endpoints" },
  { glyph: "▥", label: "GPU/MIG", page: "gpu" },
  { glyph: "▢", label: "키·앱", page: "keys" },
  { glyph: "↯", label: "트래픽", page: "traffic" },
  { glyph: "⚙", label: "설정", page: "settings", children: [{ label: "서드파티 자격증명", page: "credentials" }] },
];

// 전역 레이아웃 (Backend.AI 패턴): 오렌지 상단 바 + 라이트 사이드바 + 콘텐츠.
export default function Layout({
  children,
  page,
  onNavigate,
}: {
  children: ReactNode;
  page: Page;
  onNavigate: (p: Page) => void;
}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("fabrix.theme") === "dark"; } catch { return false; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    try { localStorage.setItem("fabrix.theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          FABRIX<sup>AI</sup>
        </div>
        <div className="project-pill">
          프로젝트 <b>default ▾</b>
        </div>
        <div className="spacer" />
        <button type="button" className="icon" aria-label="검색" title="검색">
          🔍
        </button>
        <button type="button" className="icon" aria-label="알림" title="알림" onClick={() => setNotifOpen((v) => !v)}>
          🔔
        </button>
        <button type="button" className="icon" aria-label="테마 전환" title={dark ? "라이트 모드" : "다크 모드"} aria-pressed={dark} onClick={() => setDark((v) => !v)}>
          {dark ? "☀" : "☾"}
        </button>
        <button type="button" className="icon" aria-label="정보" title="정보">
          ⓘ
        </button>
        <div className="user">
          <span className="avatar" aria-hidden="true">
            관
          </span>
          관리자 ▾
        </div>
      </header>

      <nav className="sidebar" aria-label="주 메뉴">
        {NAV.map((n) => {
          const active = !!n.page && n.page === page;
          const childActive = n.children?.some((c) => c.page === page) ?? false;
          const expanded = active || childActive;
          return (
            <div key={n.label} className="nav-group">
              <button
                type="button"
                className={`nav-item ${active ? "active" : ""} ${n.soon ? "disabled" : ""}`}
                aria-current={active ? "page" : undefined}
                aria-disabled={n.soon ? true : undefined}
                disabled={n.soon}
                title={n.soon ? `${n.label} — 준비 중` : n.label}
                onClick={() => n.page && onNavigate(n.page)}
              >
                <span className="glyph" aria-hidden="true">
                  {n.glyph}
                </span>
                <span>{n.label}</span>
                {n.children && <span className={`nav-caret ${expanded ? "open" : ""}`} aria-hidden="true">›</span>}
                {n.soon && <span className="soon">준비 중</span>}
              </button>
              {n.children && expanded && (
                <div className="nav-children">
                  {n.children.map((c) => (
                    <button
                      type="button"
                      key={c.page}
                      className={`nav-subitem ${c.page === page ? "active" : ""}`}
                      aria-current={c.page === page ? "page" : undefined}
                      onClick={() => onNavigate(c.page)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <main className="content">{children}</main>
      <NotificationsDrawer open={notifOpen} onClose={() => setNotifOpen(false)} />
    </div>
  );
}
