// IMP-24 — filter-bar 우측 컨트롤: "뷰 링크 복사"(항상) + "저장된 뷰"(manage 한정 저장).
//
// 링크 복사는 읽기 동작이라 observe(읽기전용) 포함 항상 허용. 뷰 저장(쓰기)만 canSave 게이팅.
// 의존성 0: 네이티브 <details> 기반 드롭다운 + navigator.clipboard(+execCommand 폴백).
import { useEffect, useRef, useState } from "react";
import { useToast } from "../toast";
import { listSavedViews, saveView, deleteView, type SavedView } from "../savedViews";

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to execCommand */
  }
  // 폴백 — clipboard API 미지원/거부(http 등) 시 textarea + execCommand.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function ViewBar({
  page,
  canSave,
  onApply,
}: {
  page: string;
  canSave: boolean; // manage 프로파일만 true — 저장 버튼 노출
  onApply: (query: string) => void; // 저장된 뷰 선택 → state 복원
}) {
  const toast = useToast();
  const [views, setViews] = useState<SavedView[]>(() => listSavedViews(page));
  const [name, setName] = useState("");
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  // 다른 화면으로 바뀌면 그 화면의 뷰 목록으로 갱신.
  useEffect(() => {
    setViews(listSavedViews(page));
  }, [page]);

  // 바깥 클릭 시 드롭다운 닫기.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const el = detailsRef.current;
      if (el && el.open && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const copyLink = async () => {
    const ok = await copyText(window.location.href);
    if (ok) toast.success("링크 복사됨 — 같은 필터·기간 뷰를 공유할 수 있습니다.");
    else toast.error("링크를 복사하지 못했습니다. 주소창의 URL 을 직접 복사해 주세요.");
  };

  const onSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const query = window.location.search.replace(/^\?/, "");
    setViews(saveView(page, trimmed, query));
    setName("");
    toast.success(`뷰 “${trimmed}” 저장됨`);
  };

  const onDelete = (n: string) => setViews(deleteView(page, n));

  const apply = (v: SavedView) => {
    onApply(v.query);
    if (detailsRef.current) detailsRef.current.open = false;
  };

  return (
    <div className="view-bar" style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}>
      <button type="button" className="btn-ghost btn-sm" onClick={copyLink} title="현재 필터·기간을 담은 링크 복사">
        🔗 뷰 링크 복사
      </button>

      <details ref={detailsRef} className="view-menu" style={{ position: "relative" }}>
        <summary
          className="btn-ghost btn-sm"
          style={{ listStyle: "none", cursor: "pointer", userSelect: "none" }}
          aria-label="저장된 뷰"
        >
          ★ 저장된 뷰{views.length ? ` (${views.length})` : ""}
        </summary>
        <div
          className="view-menu-pop"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 20,
            minWidth: 260,
            background: "var(--surface, #fff)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm, 8px)",
            boxShadow: "0 6px 24px rgba(0,0,0,.12)",
            padding: "var(--sp-2, 8px)",
            display: "grid",
            gap: "var(--sp-2, 8px)",
          }}
        >
          {canSave && (
            <div style={{ display: "flex", gap: "var(--sp-1, 4px)" }}>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onSave(); }}
                placeholder="현재 뷰 이름…"
                aria-label="저장할 뷰 이름"
                style={{ flex: 1, minWidth: 0 }}
              />
              <button type="button" className="btn-primary btn-sm" onClick={onSave} disabled={!name.trim()}>저장</button>
            </div>
          )}
          {!canSave && (
            <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: 0 }}>
              뷰 저장은 manage 프로파일에서만 가능합니다. 링크 복사는 언제나 가능합니다.
            </p>
          )}

          {views.length === 0 ? (
            <p className="muted" style={{ fontSize: "var(--fs-xs)", margin: 0 }}>저장된 뷰가 없습니다.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
              {views.map((v) => (
                <li key={v.name} style={{ display: "flex", alignItems: "center", gap: "var(--sp-1, 4px)" }}>
                  <button
                    type="button"
                    className="link"
                    onClick={() => apply(v)}
                    style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={v.query || "(기본 뷰)"}
                  >
                    {v.name}
                  </button>
                  {canSave && (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => onDelete(v.name)} aria-label={`뷰 ${v.name} 삭제`}>×</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}
