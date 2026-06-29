import { useEffect, useMemo, useRef, useState } from "react";

// 전역 명령 팔레트(⌘K / Ctrl+K) — 무라이브러리 자체 구현.
// 패턴(uxpatterns.dev): 입력 + fuzzy 검색 + ↑↓/Enter 키보드 탐색 + 푸터 단축키 + empty state.
export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  glyph?: string;
  keywords?: string; // 검색 보조어(영문/별칭)
  run: () => void;
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
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) { setQuery(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

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

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const cmd = filtered[active]; if (cmd) { onClose(); cmd.run(); } }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  // 그룹 헤더를 끼워넣기 위한 순회용 — 직전 그룹과 다르면 헤더 출력.
  let lastGroup = "";

  return (
    <div className="cmdk-overlay" role="presentation" onClick={onClose}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="명령 팔레트" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input-wrap">
          <span className="cmdk-search" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="페이지 이동·작업 검색… (예: 트레이스, 키 발급, 다크)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
          {filtered.length === 0 && <div className="cmdk-empty">“{query}” 에 맞는 명령이 없습니다.</div>}
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
                  onClick={() => { onClose(); c.run(); }}
                >
                  <span className="cmdk-glyph" aria-hidden="true">{c.glyph ?? "›"}</span>
                  <span className="cmdk-label">{c.label}</span>
                  {c.hint && <span className="cmdk-hint">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="cmdk-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
          <span><kbd>↵</kbd> 실행</span>
          <span><kbd>esc</kbd> 닫기</span>
          <span className="cmdk-foot-right">{filtered.length}개 결과</span>
        </div>
      </div>
    </div>
  );
}
