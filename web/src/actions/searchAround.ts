// IMP-75 — Search Around 런처의 **순수 seam**.
//
// ⌘K CommandPalette(정확한 WAI-ARIA combobox — CommandPalette.tsx)를 Palantir Object Explorer의
// 'Search Around'(링크 순회로 객체 집합 도달) + Raycast/Linear식 contextual Action Panel로 확장한다.
// 여기서는 UI/DOM 없이 **모드별 Command[] 생성 + 이웃 집합 계산 + 게이팅 판정**만 순수 함수로 둔다
// (단위 테스트 용이 + a11y shell 회귀 격리). 새 데이터 모델·mutation 경로를 만들지 않는다:
//
//   - 객체 검색 = toolQueryObjects(agent.ts, title/id 부분일치) 재사용.
//   - 링크 순회 = OntologyGraph.neighbors(id, kind)(ontologyGraph.ts, 방향 무관·결정적 id 정렬) 재사용.
//   - 게이팅 = evaluateSubmission(registry.ts, capability+status) 재사용 — 자체 규칙 없음.
//
// **핵심 안전장치(trust boundary 불변)**: 이 파일은 어떤 mutating client(submitAction 등)도 import 하지
// 않는다. Action command 의 run() 은 "ObjectView 를 열어 그 안의 <ActionForm> 으로 유도"할 뿐이며,
// 실제 writeback 은 오직 ActionForm + evaluateSubmission(403 audit) 경로로만 일어난다. 팔레트는 mutate 하지 않는다.

import type { LinkKind, ObjectStatus, ObjectType, OntologyObject } from "../api/types";
import type { OntologyGraph } from "../api/ontologyGraph";
import { toolQueryObjects } from "../api/agent";
import { typeVisual } from "../api/objectTypeVisual";
import { ACTION_REGISTRY, evaluateSubmission } from "./registry";
import type { Command } from "../components/CommandPalette";

// Foundry 는 선택 집합이 1000 초과면 action 을 막는다 — 그 상한을 경량 가드로 미러(문서화된 패턴).
export const MAX_SET = 1000;

// 런처에 노출할 Search Around 관계 순서(ObjectView LINK_META 위계와 정합: 상류 소비 → 하류 자원 → 영향/프로세스).
export const SEARCH_AROUND_KINDS: LinkKind[] = [
  "serves", "consumes", "routedTo", "runsOn", "executedOn", "hostedBy", "affects", "spawns", "tracks",
];

// linkKind → 사람이 읽는 Search Around 라벨(ObjectView LINK_META 라벨과 동일 어휘 — 단일 어휘집).
export const AROUND_LABEL: Record<LinkKind, string> = {
  serves: "서빙 모델", runsOn: "실행 GPU", hostedBy: "호스트 노드", routedTo: "라우팅 엔드포인트",
  executedOn: "실행 GPU", consumes: "소비 Service", affects: "영향 대상",
  spawns: "생성 과업", tracks: "대상 객체",
};

// object-context 서브페이지를 만들 때 필요한 실행 콜백(팔레트 shell 로부터 주입).
export interface SearchAroundActions {
  can: (cap: string) => boolean;      // useCap().can — 게이팅 단일 출처
  openObject: (id: string) => void;   // useObjectView().open — 안전(항상 가용) primary
  pushContext: (id: string) => void;  // object-context 페이지 push
  pushAround: (id: string, kind: LinkKind) => void; // search-around(집합) 페이지 push
}

// ── 1) object-search 모드 — 타이핑한 쿼리로 객체를 찾아 Command[] 로. ────────────────────────────
// query_objects(toolQueryObjects) 로 title/id 부분일치 필터 → 각 결과를 "Enter=context push" command 로.
// 그룹 = 객체 타입 라벨(팔레트 group header 재사용). keepOpen=true 라 Enter 는 팔레트를 닫지 않고 push 한다.
export function objectSearchCommands(
  objects: OntologyObject[],
  query: string,
  onPick: (id: string) => void,
): Command[] {
  const res = toolQueryObjects(objects, { filter: query });
  const byId = new Map(objects.map((o) => [o.id, o]));
  const cmds: Command[] = [];
  for (const id of res.objectIds) {
    const o = byId.get(id);
    if (!o) continue;
    const v = typeVisual(o.type);
    cmds.push({
      id: `sa-obj-${o.id}`,
      label: o.title,
      hint: `${v.label} 열기 →`,
      group: `객체 · ${v.label}`,
      glyph: v.glyph,
      keywords: `${o.title} ${o.id} ${o.type}`,
      keepOpen: true, // Enter → object-context push(팔레트 유지)
      run: () => onPick(o.id),
    });
  }
  return cmds;
}

// ── 2) object-context 모드 — 한 객체의 Action Panel(Raycast contextual actions). ─────────────────
//  primary = [객체 열기](ObjectView, 안전·항상) → Enter 는 팔레트 닫고 ObjectView 오픈.
//  Search Around → <관계> — 그 객체가 **실제로 가진** 관계만(neighbors 비어있지 않은 kind). keepOpen push.
//  Actions — ACTION_REGISTRY 중 대상 type 매칭 + evaluateSubmission(capability+status) 통과분만 노출
//            (observe 숨김 — nav 동일). Enter 는 ObjectView 를 열어 거기 ActionForm 으로 유도(팔레트 mutate 금지).
export function objectContextCommands(
  graph: OntologyGraph,
  objectId: string,
  actions: SearchAroundActions,
): Command[] {
  const obj = graph.object(objectId);
  const title = obj?.title ?? objectId;
  const cmds: Command[] = [];

  // primary — 항상 노출(안전). 팔레트 닫고 ObjectView 오픈(keepOpen 미지정 = 기존 close+run).
  cmds.push({
    id: `sa-open-${objectId}`,
    label: `${title} 열기`,
    hint: "Object View",
    group: "객체",
    glyph: obj ? typeVisual(obj.type).glyph : "○",
    keywords: `open objectview 열기 상세 ${title} ${objectId}`,
    run: () => actions.openObject(objectId),
  });

  // Search Around — 실재 관계만(neighbors 있는 kind). keepOpen → 집합 서브페이지 push.
  for (const kind of SEARCH_AROUND_KINDS) {
    const n = graph.neighbors(objectId, kind);
    if (n.length === 0) continue;
    cmds.push({
      id: `sa-around-${objectId}-${kind}`,
      label: `Search Around → ${AROUND_LABEL[kind]}`,
      hint: `${n.length}개`,
      group: "이웃 순회 (Search Around)",
      glyph: "⇄",
      keywords: `search around ${kind} ${AROUND_LABEL[kind]} 이웃 순회`,
      keepOpen: true,
      run: () => actions.pushAround(objectId, kind),
    });
  }

  // Actions — capability 통과분만(게이팅 단일 출처). 실행은 ObjectView 안 ActionForm 으로(팔레트 mutate 금지).
  const status: ObjectStatus | undefined = obj?.status;
  for (const spec of Object.values(ACTION_REGISTRY)) {
    if (!obj || spec.target !== obj.type) continue;
    const check = evaluateSubmission(spec, { can: actions.can, targetStatus: status });
    if (!check.ok) continue; // observe/부적격 상태 → 숨김(nav 동일). 실행 게이팅은 ActionForm 이 재판정.
    cmds.push({
      id: `sa-act-${objectId}-${spec.name}`,
      label: spec.label,
      hint: "액션 폼 열기 →",
      group: "액션",
      glyph: "❯",
      keywords: `action ${spec.name} ${spec.label} 조치`,
      // secondary — 팔레트 닫고 ObjectView 오픈(그 안에서 확인/파라미터 → ActionForm 실행). 직접 mutate 아님.
      run: () => actions.openObject(objectId),
    });
  }

  return cmds;
}

// ── 3) search-around 모드 — 이웃 **집합(SET)** 을 Command[] 로. Enter=ObjectView(안전). ──────────
//  집합의 각 이웃은 openObject(안전, 항상). manage 의 bulk action 은 컴포넌트가 별도로 붙인다
//  (여기서는 순수 집합 나열만 — 팔레트 mutate 금지 규범).
export function searchAroundCommands(
  graph: OntologyGraph,
  objectId: string,
  kind: LinkKind,
  onOpen: (id: string) => void,
): Command[] {
  const set = searchAroundSet(graph, objectId, kind);
  return set.map((o) => {
    const v = typeVisual(o.type);
    return {
      id: `sa-set-${o.id}`,
      label: o.title,
      hint: `${v.label} 열기 →`,
      group: `${AROUND_LABEL[kind]} (${set.length})`,
      glyph: v.glyph,
      keywords: `${o.title} ${o.id} ${o.type}`,
      run: () => onOpen(o.id), // Enter = ObjectView(안전). set→jump 아님(집합에서 하나 선택).
    } satisfies Command;
  });
}

// 이웃 집합 — neighbors(id, kind) 그대로(방향 무관·dedup·id 사전순 정렬, 결정적). 미존재 → [].
export function searchAroundSet(graph: OntologyGraph, objectId: string, kind: LinkKind): OntologyObject[] {
  return graph.neighbors(objectId, kind);
}

// set-size 가드(Foundry >1000 cap 미러) — bulk action 가부 + 사유. 순수 판정(UI 가 소비).
export function bulkActionGuard(setSize: number): { ok: boolean; reason?: string } {
  if (setSize > MAX_SET) {
    return { ok: false, reason: `선택 집합이 ${MAX_SET}개를 초과해 일괄 조치를 실행할 수 없습니다 (${setSize}개)` };
  }
  if (setSize === 0) return { ok: false, reason: "대상 집합이 비어 있습니다" };
  return { ok: true };
}

// aria-live 안내 문구(유일한 a11y 갭 닫기) — 모드별 결과 수/컨텍스트를 스크린리더에 알린다.
export function liveAnnounce(
  mode: "root" | "object-search" | "object-context" | "search-around",
  count: number,
  contextTitle?: string,
): string {
  switch (mode) {
    case "object-search":
      return count === 0 ? "일치하는 객체가 없습니다" : `${count}개 객체`;
    case "object-context":
      return `${contextTitle ?? "객체"} 컨텍스트, ${count}개 항목`;
    case "search-around":
      return count === 0
        ? `${contextTitle ?? "객체"} 주변에 이웃이 없습니다`
        : `${contextTitle ?? "객체"} 주변 이웃 ${count}개`;
    default:
      return `${count}개 명령`;
  }
}

// 사람이 읽는 객체 타입 라벨(breadcrumb·live 안내 보조). typeVisual 단일 출처.
export function typeLabel(type: ObjectType): string {
  return typeVisual(type).label;
}
