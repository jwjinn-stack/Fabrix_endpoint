// IMP-75 — Search Around 중첩 팔레트의 **모드 state machine** 훅.
//
// searchAround.ts(순수 seam)의 Command[] 생성기 + OntologyGraph.neighbors 를 조합해
// ⌘K CommandPalette shell 에 주입할 { commands, breadcrumb, onBack, liveMessage, placeholder,
// onQueryChange, modeKey } 를 계산한다. 모드/컨텍스트 스택은 **urlState(sactx/saround)** 를 단일
// 출처로 삼아 deep-link + 브라우저 back 을 일관되게 만든다(휘발 상태는 query 뿐).
//
// 모드 결정: saround(id|kind) 있으면 search-around → sactx 있으면 object-context →
//            query 비어있지 않으면 object-search → 아니면 root(상위가 준 flat Command[]).
// 팔레트는 mutate 하지 않는다 — Action command 는 ObjectView(+ActionForm) 진입만(searchAround.ts 참조).
//
// 데이터: 객체 목록은 fetchOntologyObjects() 1회(object-search + 이웃 title/type 해석). 이웃 순회 링크는
//   "포커스된 객체"(sactx/around.id)만 fetchOntologyLinks(id) 로 로드해 작은 그래프를 만든다
//   (전량 링크 endpoint 가 없으므로 — ObjectView 와 동일 접근). 미존재 id → 빈 집합(throw 없음).

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchOntologyLinks, fetchOntologyObjects } from "../api/client";
import { buildGraph, type OntologyGraph } from "../api/ontologyGraph";
import type { LinkKind, OntologyLink, OntologyObject } from "../api/types";
import { searchAroundSchema, useUrlState } from "../urlState";
import { useCap } from "../capabilities";
import {
  AROUND_LABEL,
  liveAnnounce,
  objectContextCommands,
  objectSearchCommands,
  searchAroundCommands,
} from "../actions/searchAround";
import type { Command } from "./CommandPalette";

export type PaletteMode = "root" | "object-search" | "object-context" | "search-around";

// saround "id|kind" 파싱 — 형식 불일치/미지 kind 는 null(방어, root 로 폴백).
const KIND_SET = new Set<LinkKind>(Object.keys(AROUND_LABEL) as LinkKind[]);
function parseAround(raw: string): { id: string; kind: LinkKind } | null {
  const i = raw.indexOf("|");
  if (i <= 0) return null;
  const id = raw.slice(0, i);
  const kind = raw.slice(i + 1) as LinkKind;
  if (!id || !KIND_SET.has(kind)) return null;
  return { id, kind };
}

export interface UseSearchAroundArgs {
  open: boolean;                    // 팔레트 열림(닫히면 query 리셋)
  rootCommands: Command[];          // root 모드 flat Command[](Layout 의 nav+globals, 기존 그대로)
  openObject: (id: string) => void; // useObjectView().open — 안전 primary(ObjectView 진입)
}

export interface SearchAroundView {
  mode: PaletteMode;
  commands: Command[];
  breadcrumb: string[];
  onBack: (() => void) | undefined;
  liveMessage: string;
  placeholder: string;
  onQueryChange: (q: string) => void;
  modeKey: string;
}

export function useSearchAround({ open, rootCommands, openObject }: UseSearchAroundArgs): SearchAroundView {
  const { can } = useCap();
  const [ctx, patchCtx] = useUrlState(searchAroundSchema);
  const [query, setQuery] = useState("");
  const [objects, setObjects] = useState<OntologyObject[]>([]);
  // 포커스된 객체(sactx/around.id)의 링크 — 이웃 순회용. focusId 로 캐시(전량 링크 endpoint 부재).
  const [focusLinks, setFocusLinks] = useState<{ id: string; links: OntologyLink[] }>({ id: "", links: [] });

  // ── 모드 해석(urlState + query) ──────────────────────────────────────────────
  const around = ctx.saround ? parseAround(ctx.saround) : null;
  const sactx = ctx.sactx || "";
  // 이웃이 필요한 "포커스 객체" — search-around 면 around.id, object-context 면 sactx.
  const focusId = around ? around.id : sactx;
  const mode: PaletteMode = around
    ? "search-around"
    : sactx
      ? "object-context"
      : query.trim()
        ? "object-search"
        : "root";

  // 팔레트가 열릴 때 온톨로지 스냅샷 1회 로드(mock/실백엔드 동일 계약). 닫히면 query 리셋.
  useEffect(() => {
    if (!open) { setQuery(""); return; }
    const ac = new AbortController();
    fetchOntologyObjects(undefined, undefined, ac.signal)
      .then((r) => { if (!ac.signal.aborted) setObjects(r.objects); })
      .catch(() => { /* 조회 실패 → 빈 스냅샷(런처는 nav 로만 동작). */ });
    return () => ac.abort();
  }, [open]);

  // 포커스 객체가 바뀌면 그 객체의 링크를 로드(이웃 순회용). focusId 없으면 초기화.
  useEffect(() => {
    if (!open || !focusId) { setFocusLinks({ id: "", links: [] }); return; }
    if (focusLinks.id === focusId) return; // 이미 로드됨(재요청 방지)
    const ac = new AbortController();
    fetchOntologyLinks(focusId, undefined, ac.signal)
      .then((r) => { if (!ac.signal.aborted) setFocusLinks({ id: focusId, links: r.links }); })
      .catch(() => { if (!ac.signal.aborted) setFocusLinks({ id: focusId, links: [] }); }); // 미존재 → 빈 이웃
    return () => ac.abort();
    // focusLinks.id 는 캐시 비교용(무한 루프 방지) — deps 에서 제외.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focusId]);

  // 이웃 순회용 그래프 — objects(노드 해석) + focusId 의 링크. focusId 링크가 아직이면 빈 링크(빈 집합).
  const graph: OntologyGraph = useMemo(
    () => buildGraph(objects, focusLinks.id === focusId ? focusLinks.links : []),
    [objects, focusLinks, focusId],
  );

  // ── push/pop 콜백(urlState 갱신 = 단일 출처) ─────────────────────────────────
  const pushContext = useCallback((id: string) => { patchCtx({ sactx: id, saround: "" }); setQuery(""); }, [patchCtx]);
  const pushAround = useCallback((id: string, kind: LinkKind) => { patchCtx({ saround: `${id}|${kind}` }); setQuery(""); }, [patchCtx]);
  const openAndClose = useCallback((id: string) => { openObject(id); }, [openObject]);

  // 뒤로 — search-around → object-context(saround 제거) / object-context → root(sactx 제거).
  //  root/object-search 에서는 pop 대상 없음(undefined → shell 이 Backspace 를 기본 편집으로).
  const onBack = useMemo(() => {
    if (around) return () => { patchCtx({ saround: "" }); setQuery(""); };
    if (sactx) return () => { patchCtx({ sactx: "", saround: "" }); setQuery(""); };
    return undefined;
  }, [around, sactx, patchCtx]);

  // ── 모드별 commands ──────────────────────────────────────────────────────────
  const commands = useMemo<Command[]>(() => {
    if (mode === "search-around" && around) {
      return searchAroundCommands(graph, around.id, around.kind, openAndClose);
    }
    if (mode === "object-context" && sactx) {
      return objectContextCommands(graph, sactx, { can, openObject: openAndClose, pushContext, pushAround });
    }
    if (mode === "object-search") {
      return objectSearchCommands(objects, query, pushContext);
    }
    return rootCommands;
  }, [mode, around, sactx, graph, objects, query, can, openAndClose, pushContext, pushAround, rootCommands]);

  // ── breadcrumb / live / placeholder ──────────────────────────────────────────
  const ctxObj = focusId ? graph.object(focusId) : undefined;
  const ctxTitle = ctxObj?.title ?? focusId;
  const breadcrumb = useMemo<string[]>(() => {
    const crumbs: string[] = [];
    if (sactx) crumbs.push(graph.object(sactx)?.title ?? sactx);
    if (around) crumbs.push(`Search Around → ${AROUND_LABEL[around.kind]}`);
    return crumbs;
  }, [sactx, around, graph]);

  const liveMessage = liveAnnounce(mode, commands.length, ctxTitle);

  const placeholder = mode === "object-context"
    ? `${ctxTitle} — 작업/이웃 순회 검색…`
    : mode === "search-around"
      ? `${AROUND_LABEL[around!.kind]} 집합에서 검색…`
      : mode === "object-search"
        ? "객체 검색 중… (title/id 부분일치)"
        : "페이지 이동·객체 검색… (예: 트레이스, qwen, gpu, 키 발급)";

  // modeKey — 전환 시 shell 의 query/active 리셋 트리거(전환 간 a11y 회귀 금지).
  const modeKey = `${mode}|${sactx}|${ctx.saround}`;

  const onQueryChange = useCallback((q: string) => setQuery(q), []);

  return { mode, commands, breadcrumb, onBack, liveMessage, placeholder, onQueryChange, modeKey };
}
