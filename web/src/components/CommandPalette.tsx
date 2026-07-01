import { useEffect, useMemo, useRef, useState } from "react";

// 전역 명령 팔레트(⌘K / Ctrl+K) — 무라이브러리 자체 구현.
// 패턴(uxpatterns.dev): 입력 + fuzzy 검색 + ↑↓/Enter 키보드 탐색 + 푸터 단축키 + empty state.
//
// IMP-75 — 중첩(nested)/상태(stateful) 팔레트로 확장(Linear/Raycast/Foundry Search Around).
//   root(navigate+globals, 기존 flat Command[])에서 타이핑 → object-search → 객체 Enter → object-context
//   → Search Around → 이웃 집합. shell(이 파일)은 **모드-aware** 이지만 combobox a11y 계약은 불변:
//   - role=combobox/listbox·aria-activedescendant·scrollIntoView·group header·focus-on-open 그대로.
//   - 매 전환마다 active=0 리셋(query 변화 + 모드 key 로 강제), DOM 포커스 input 유지.
//   - 추가: aria-live="polite" 노드(결과 수/"Searching around <object>" 안내 — 유일한 a11y 갭).
//   모드 state machine 은 상위(useSearchAround)가 관리하고 shell 에 commands/breadcrumb/onBack/liveMessage 를 주입한다.
export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  glyph?: string;
  keywords?: string; // 검색 보조어(영문/별칭)
  run: () => void;
  // IMP-75 — true 면 Enter/클릭이 run() 만 하고 팔레트를 **닫지 않는다**(하위 페이지 push).
  //  미지정(기존 command) = 종전대로 close + run(회귀 없음).
  keepOpen?: boolean;
}

// 부분 일치(subsequence) fuzzy: query 의 각 글자가 순서대로 등장하면 매치, 연속·선두 일치에 가산점.
function fuzzyScore(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0, score = 0, streak = 0, prevIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1;
      if (prevIdx === ti - 1) { streak += 1; score += streak * 2; } else streak = 0;
      if (ti === 0) score += 3;
      prevIdx = ti; qi++;
    }
  }
  return qi === q.length ? score : 0;
}

export default function CommandPalette({
  open,
  onClose,
  commands,
  // ── IMP-75 중첩 팔레트 확장 props(전부 옵션 — 미지정 시 기존 flat 동작 그대로) ──
  breadcrumb,        // 모드 스택 경로(root 는 빈/미지정 → 표시 안 함)
  onBack,            // 빈 쿼리 Backspace → 한 단계 pop(Raycast/Linear 관례)
  liveMessage,       // aria-live 안내 문구(결과 수/"Searching around <object>")
  placeholder,       // 모드별 입력 placeholder(미지정 시 기본)
  onQueryChange,     // 입력 변화 관찰(상위가 object-search 진입/debounce 판단)
  modeKey,           // 모드/컨텍스트 식별자 — 바뀌면 query/active 리셋(전환 간 회귀 금지)
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  breadcrumb?: string[];
  onBack?: () => void;
  liveMessage?: string;
  placeholder?: string;
  onQueryChange?: (q: string) => void;
  modeKey?: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setQuery(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  // IMP-75 — 모드/컨텍스트 전환(modeKey 변경) 시 query·active 리셋 + 포커스 유지.
  //  a11y 계약: 매 전환마다 active=0(첫 옵션 선택), DOM 포커스는 input 에 남긴다.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    // 포커스가 어떤 옵션 버튼으로 튀지 않도록 input 으로 되돌린다(전환 후에도 combobox 계약 유지).
    inputRef.current?.focus();
    // modeKey 만 의존(open 은 위 훅이 담당) — 전환 시 1회.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey]);

  const filtered = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, s: query ? Math.max(fuzzyScore(query, c.label), fuzzyScore(query, c.keywords ?? "") * 0.9) : 1 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    return scored.map((x) => x.c);
  }, [commands, query]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const runCommand = (cmd: Command) => {
    // keepOpen 이면 팔레트를 유지한 채 run(하위 페이지 push). 아니면 기존대로 닫고 실행.
    if (cmd.keepOpen) { cmd.run(); }
    else { onClose(); cmd.run(); }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const cmd = filtered[active]; if (cmd) runCommand(cmd); }
    // IMP-75 — 빈 쿼리에서 Backspace → 상위 모드로 pop(있을 때만). 쿼리가 있으면 기본 편집 동작.
    else if (e.key === "Backspace" && query === "" && onBack) { e.preventDefault(); onBack(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  // 그룹 헤더를 끼워넣기 위한 순회용 — 직전 그룹과 다르면 헤더 출력.
  let lastGroup = "";
  const crumbs = breadcrumb?.filter((c) => c && c.length > 0) ?? [];

  return (
    <div className="cmdk-overlay" role="presentation" onClick={onClose}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="명령 팔레트" onClick={(e) => e.stopPropagation()}>
        {/* IMP-75 — breadcrumb row(모드 스택 경로). root 에서는 렌더 안 함(기존 flat 모양 불변). */}
        {crumbs.length > 0 && (
          <nav className="cmdk-crumbs" aria-label="팔레트 탐색 경로">
            {onBack && (
              <button type="button" className="cmdk-crumb-back" onClick={onBack} aria-label="이전 단계로 (Backspace)" title="이전 단계로 (Backspace)">←</button>
            )}
            <ol>
              {crumbs.map((c, i) => (
                <li key={`${c}-${i}`} aria-current={i === crumbs.length - 1 ? "true" : undefined}>
                  {i > 0 && <span className="cmdk-crumb-sep" aria-hidden="true">/</span>}
                  <span className={i === crumbs.length - 1 ? "cmdk-crumb-cur" : "cmdk-crumb"}>{c}</span>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="cmdk-input-wrap">
          <span className="cmdk-search" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder={placeholder ?? "페이지 이동·객체 검색… (예: 트레이스, qwen, gpu, 키 발급)"}
            value={query}
            onChange={(e) => { setQuery(e.target.value); onQueryChange?.(e.target.value); }}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={filtered[active] ? `cmdk-opt-${filtered[active].id}` : undefined}
          />
          <button
            type="button"
            className="cmdk-close"
            aria-label="명령 팔레트 닫기"
            title="닫기 (Esc)"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
          {filtered.length === 0 && <div className="cmdk-empty">“{query}” 에 맞는 항목이 없습니다.</div>}
          {filtered.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="cmdk-group">{header}</div>}
                <button
                  type="button"
                  id={`cmdk-opt-${c.id}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  className={`cmdk-opt ${i === active ? "active" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => runCommand(c)}
                >
                  <span className="cmdk-glyph" aria-hidden="true">{c.glyph ?? "›"}</span>
                  <span className="cmdk-label">{c.label}</span>
                  {c.hint && <span className="cmdk-hint">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        {/* IMP-75 — aria-live(polite) 결과/컨텍스트 안내. 시각적으로는 숨김(.sr-only), 스크린리더만 읽음. */}
        <div className="sr-only" role="status" aria-live="polite">{liveMessage ?? `${filtered.length}개 결과`}</div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
          <span><kbd>↵</kbd> 실행</span>
          {onBack && <span><kbd>⌫</kbd> 뒤로</span>}
          <span><kbd>esc</kbd> 닫기</span>
          <span className="cmdk-foot-right">{filtered.length}개 결과</span>
        </div>
      </div>
    </div>
  );
}
