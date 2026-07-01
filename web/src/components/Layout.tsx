import { useEffect, useMemo, useState, type ReactNode } from "react";
import NotificationsDrawer from "./Notifications";
import CommandPalette, { type Command } from "./CommandPalette";
import { useCap } from "../capabilities";
import { capForPage } from "../router";

export type Page =
  | "dashboard"
  | "usage"
  | "guard"
  | "traces"
  | "sessions"
  | "models"
  | "model-import"
  | "playground"
  | "eval"
  | "endpoints"
  | "gpu"
  | "nodes"
  | "network"
  | "topology"
  | "keys"
  | "traffic"
  | "settings"
  | "credentials"
  | "diagnostics";

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
  { glyph: "◱", label: "노드", page: "nodes" },
  { glyph: "≈", label: "네트워크", page: "network" },
  { glyph: "⧉", label: "토폴로지", page: "topology" },
  { glyph: "▢", label: "키·앱", page: "keys" },
  { glyph: "↯", label: "트래픽", page: "traffic" },
  { glyph: "≣", label: "트레이스", page: "traces" },
  { glyph: "❑", label: "세션", page: "sessions" },
  { glyph: "⇄", label: "연동 상태", page: "diagnostics" },
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
  const { can, caps } = useCap();
  // 배포 프로파일에 따라 보이는 NAV — 화면별 cap 이 꺼져 있으면 메뉴·하위메뉴를 숨긴다.
  const allow = (p?: Page) => {
    const c = p ? capForPage(p) : undefined;
    return !c || can(c);
  };
  const visibleNav = useMemo<NavItem[]>(
    () => NAV.filter((n) => allow(n.page)).map((n) => ({ ...n, children: n.children?.filter((c) => allow(c.page)) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can],
  );

  const [notifOpen, setNotifOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("fabrix.theme") === "dark"; } catch { return false; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    try { localStorage.setItem("fabrix.theme", dark ? "dark" : "light"); } catch { /* ignore */ }
  }, [dark]);

  // ⌘K / Ctrl+K 전역 단축키로 명령 팔레트 열기.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 명령 = 네비게이션(보이는 화면) + 전역 작업(가능한 것만). observe 에선 쓰기 작업이 빠진다.
  const commands = useMemo<Command[]>(() => {
    const navCmds: Command[] = visibleNav.flatMap((n) => {
      const items: Command[] = n.page
        ? [{ id: `nav-${n.page}`, label: n.label, hint: "이동", group: "이동", glyph: n.glyph, keywords: `${n.label} ${n.page}`, run: () => onNavigate(n.page!) }]
        : [];
      const childCmds = (n.children ?? []).map((c) => ({
        id: `nav-${c.page}`, label: `${n.label} › ${c.label}`, hint: "이동", group: "이동", glyph: n.glyph,
        keywords: `${c.label} ${c.page}`, run: () => onNavigate(c.page),
      }));
      return [...items, ...childCmds];
    });
    const actions: Command[] = [
      ...(can("endpoints.write") ? [{ id: "act-new-endpoint", label: "새 엔드포인트 배포", hint: "작업", group: "작업", glyph: "⬡", keywords: "endpoint deploy 배포 생성", run: () => onNavigate("endpoints") }] : []),
      ...(can("keys.write") ? [{ id: "act-issue-key", label: "API 키 발급", hint: "작업", group: "작업", glyph: "▢", keywords: "key issue 키 발급 apikey", run: () => onNavigate("keys") }] : []),
      ...(can("models.write") ? [{ id: "act-import-model", label: "모델 임포트", hint: "작업", group: "작업", glyph: "◆", keywords: "model import harbor 모델 가져오기", run: () => onNavigate("model-import") }] : []),
      { id: "act-theme", label: dark ? "라이트 모드로 전환" : "다크 모드로 전환", hint: "설정", group: "설정", glyph: dark ? "☀" : "☾", keywords: "theme dark light 테마 다크 라이트", run: () => setDark((v) => !v) },
      { id: "act-notif", label: "알림 열기", hint: "설정", group: "설정", glyph: "🔔", keywords: "notification 알림", run: () => setNotifOpen(true) },
    ];
    return [...navCmds, ...actions];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNavigate, dark, visibleNav]);
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          FABRIX<sup>AI</sup>
        </div>
        <div className="project-pill">
          프로젝트 <b>default ▾</b>
        </div>
        {caps.readonly && (
          <span
            title="읽기 전용 관제 모드 — 생성·변경·삭제 기능이 비활성화되어 있습니다"
            style={{ marginLeft: "var(--sp-2)", fontSize: "var(--fs-xs)", fontWeight: 700, color: "#fff", background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.5)", borderRadius: 999, padding: "2px 9px", letterSpacing: ".02em", whiteSpace: "nowrap" }}
          >
            관제 전용
          </span>
        )}
        <div className="spacer" />
        <button type="button" className="cmdk-trigger" aria-label="명령 팔레트 열기" title="명령 팔레트 (⌘K)" onClick={() => setCmdOpen(true)}>
          <span aria-hidden="true">⌕</span>
          <span className="cmdk-trigger-label">검색·이동</span>
          <kbd>⌘K</kbd>
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
        {visibleNav.map((n) => {
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
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} commands={commands} />
    </div>
  );
}
