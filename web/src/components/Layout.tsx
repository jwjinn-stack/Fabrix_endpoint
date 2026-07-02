import { useEffect, useMemo, useState, type ReactNode } from "react";
import NotificationsDrawer from "./Notifications";
import CommandPalette, { type Command } from "./CommandPalette";
import { useSearchAround } from "./useSearchAround";
import { useObjectView } from "./ObjectView";
import { useCap } from "../capabilities";
import { useBrand } from "../theme";
import { capForPage } from "../router";

export type Page =
  | "dashboard"
  | "ontology"
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
  | "investigate"
  | "agent"
  | "keys"
  | "traffic"
  | "settings"
  | "credentials"
  | "diagnostics"
  | "metric-sources";

type NavChild = { label: string; page: Page };
type NavItem = { glyph: string; label: string; page?: Page; soon?: boolean; children?: NavChild[] };

// 증권사 인퍼런스 관제 콘솔 — 의미가 또렷한 단색 글리프(이모지 배제로 톤 통일).
// IA(정보구조)를 팔란티어식 object-centric·흐름 중심으로 재편(IMP-62, doc §7).
// IMP-70 진입점 재배치(doc §2 패턴 1·5 / §4): 오퍼레이터는 과업/상황/객체(TASK·SITUATION·OBJECT)에
//   랜딩하고, 글로벌 스키마 개요는 "분리된 참조 아티팩트"로 둔다(박물관 정문 금지).
//   → 그룹 순서를 일상 흐름이 먼저 오도록 **관측→추적→제어→참조→연동** 으로 재배치하고,
//     온톨로지 개요 그룹은 정문(최상단 "탐색")에서 운영 흐름 뒤 **"참조"** 그룹으로 강등(여전히 도달 가능).
//   기본 랜딩 자체는 이미 actionable(pageFromPath 루트/미지 → dashboard, 온톨로지 아님) — router.cap.test 가 고정.
// 모든 그룹은 page 가 없는 groupless 그룹 — 부모 클릭 시 확장/접힘만(자식만 이동, IMP-53 패턴 재사용).
// 2단 서브였던 모델 임포트·서드파티 자격증명은 NavChild 가 플랫이라 연동 그룹의 형제 항목으로 평탄화
// (두 화면은 고유 라우트·App.tsx 렌더 스위치를 가져 nav shape 와 무관하게 도달 가능).
// capability 게이팅(PAGE_CAP)은 불변 — observe 프로파일에선 mutating 항목이 빠져 제어/연동 그룹이 자연히 줄어든다.
const NAV: NavItem[] = [
  // 관측(Observe) — 현상 보기(SITUATION 진입): 관제·사용량·트레이스·세션·인프라(GPU/노드/네트워크/토폴로지)·트래픽.
  // 흐름의 시작이자 기본 랜딩 그룹(dashboard) — 최상단으로 올려 오퍼레이터가 actionable surface 를 먼저 본다.
  {
    glyph: "▦",
    label: "관측",
    children: [
      { label: "관제", page: "dashboard" },
      { label: "사용량", page: "usage" },
      { label: "트레이스", page: "traces" },
      { label: "세션", page: "sessions" },
      { label: "GPU / MIG", page: "gpu" },
      { label: "노드", page: "nodes" },
      { label: "네트워크", page: "network" },
      { label: "토폴로지", page: "topology" },
      { label: "트래픽", page: "traffic" },
    ],
  },
  // 추적(Investigate) — 원인 추적을 1급 시민으로. 즉시대응은 KineticStrip(IMP-72, 알림→즉시 조치)이
  // 담당하고, 근본원인 추적(COP)이 심층 진입점이다(IMP-90: 관제는 할당보다 알림+즉시대응 — /inbox 제거).
  // Incidents 는 investigate 화면 내부 surface.
  {
    glyph: "◈",
    label: "추적",
    children: [
      { label: "근본원인 추적(COP)", page: "investigate" },
    ],
  },
  // 제어(Operate) — 행위: AI Agent(MCP)·플레이그라운드. Actions 는 ObjectView/Investigate 내부.
  {
    glyph: "❯",
    label: "제어",
    children: [
      { label: "AI Agent", page: "agent" },
      { label: "플레이그라운드", page: "playground" },
    ],
  },
  // 참조(Reference) — 온톨로지 스키마/개요 참조 surface. IMP-70: 정문("탐색")에서 강등 —
  //   운영 흐름(관측→추적→제어) 뒤에 두어 "분리된 참조 아티팩트"로 프레이밍(박물관 정문 아님, doc §2 패턴 5).
  //   일상 진입은 Object 이웃 drill-in(ObjectView, IMP-57). 화면 내부는 IMP-68 이 이미 스코어카드(정문)/스키마-참조(보조)로 분리.
  {
    glyph: "⬡",
    label: "참조",
    children: [{ label: "온톨로지", page: "ontology" }],
  },
  // 연동(Integrate) — 구성·거버넌스: 연동 상태·모델·엔드포인트·자격증명·키·가드레일·평가·설정.
  {
    glyph: "⇄",
    label: "연동",
    children: [
      { label: "연동 상태", page: "diagnostics" },
      { label: "메트릭 소스", page: "metric-sources" },
      { label: "모델", page: "models" },
      { label: "모델 임포트", page: "model-import" },
      { label: "엔드포인트", page: "endpoints" },
      { label: "서드파티 자격증명", page: "credentials" },
      { label: "키·앱", page: "keys" },
      { label: "가드레일", page: "guard" },
      { label: "평가", page: "eval" },
      { label: "설정", page: "settings" },
    ],
  },
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
  // IMP-87 — 화이트라벨: 워드마크/로고를 고객사 브랜드로 렌더(하드코딩 'FABRIX' 대체).
  const { tenant } = useBrand();
  // 배포 프로파일에 따라 보이는 NAV — 화면별 cap 이 꺼져 있으면 메뉴·하위메뉴를 숨긴다.
  const allow = (p?: Page) => {
    const c = p ? capForPage(p) : undefined;
    return !c || can(c);
  };
  const visibleNav = useMemo<NavItem[]>(
    () =>
      NAV.filter((n) => allow(n.page))
        .map((n) => ({ ...n, children: n.children?.filter((c) => allow(c.page)) }))
        // page 없는 그룹(예: 인프라·관측)은 보이는 자식이 하나도 없으면 그룹째 숨긴다.
        .filter((n) => n.page || (n.children && n.children.length > 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can],
  );

  const [notifOpen, setNotifOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  // page 없는 그룹(예: 인프라·관측)의 수동 확장/접힘 상태. label 키로 토글한다.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
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

  // IMP-57 — ObjectView 는 urlState(obj) 를 단일 출처로 페이지 무관하게 열린다. 팔레트의 Search Around
  //  런처가 객체를 열 때 이 open(id) 을 쓴다(팔레트는 mutate 하지 않고 ObjectView 로 유도 — trust boundary).
  const { open: openObjectView } = useObjectView();

  // root 모드 명령 = 네비게이션(보이는 화면) + 전역 작업(가능한 것만). observe 에선 쓰기 작업이 빠진다.
  //  IMP-75 — 이 flat Command[] 가 중첩 팔레트의 root 모드가 된다(회귀 없음). object-search/context/around 는
  //  useSearchAround 가 이 root 위에 얹는다.
  const rootCommands = useMemo<Command[]>(() => {
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

  // IMP-75 — 중첩 팔레트 모드 머신. root=위 flat rootCommands, 그 위에 object-search/context/around 를 얹는다.
  //  openObjectView(id) 로 ObjectView 진입(안전 primary). 팔레트가 닫힌 뒤 객체를 열도록 close 를 먼저.
  const sa = useSearchAround({
    open: cmdOpen,
    rootCommands,
    openObject: (id) => { setCmdOpen(false); openObjectView(id); },
  });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          {tenant.logoDataUri ? (
            // data-URI 는 theme.tsx 에서 이미지 MIME·크기 검증됨 — src 대입만(innerHTML 미사용).
            <img className="brand-logo" src={tenant.logoDataUri} alt={tenant.productName} />
          ) : (
            <>
              {tenant.productName}
              {tenant.productSuffix && <sup>{tenant.productSuffix}</sup>}
            </>
          )}
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
          // page 있는 부모: 활성/자식활성 시 확장. page 없는 그룹: 자식활성 또는 수동 토글 시 확장.
          const groupless = !n.page && !!n.children;
          const expanded = active || childActive || (groupless && !!openGroups[n.label]);
          return (
            <div key={n.label} className="nav-group">
              <button
                type="button"
                className={`nav-item ${active ? "active" : ""} ${n.soon ? "disabled" : ""}`}
                aria-current={active ? "page" : undefined}
                aria-expanded={n.children ? expanded : undefined}
                aria-disabled={n.soon ? true : undefined}
                disabled={n.soon}
                title={n.soon ? `${n.label} — 준비 중` : n.label}
                onClick={() => {
                  if (n.page) onNavigate(n.page);
                  else if (groupless) setOpenGroups((g) => ({ ...g, [n.label]: !expanded }));
                }}
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
      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        commands={sa.commands}
        breadcrumb={sa.breadcrumb}
        onBack={sa.onBack}
        liveMessage={sa.liveMessage}
        placeholder={sa.placeholder}
        onQueryChange={sa.onQueryChange}
        modeKey={sa.modeKey}
      />
    </div>
  );
}
