// IMP-66 — 온톨로지 관계 그래프 traverse helper (zero-dep, typed adjacency·BFS).
//
// IMP-56 온톨로지(OntologyObject/OntologyLink)를 traverse 하는 코드가 여러 seam(investigate.ts·
// ontologySchema.ts·ObjectView·agent)에 손코드로 흩어져 있었다. 방향/visited/linkKind 필터 규약이
// 파일마다 갈리지 않도록, **타입 있는 인접 primitive 하나**로 통합한다(단일 출처).
//
// - 의존성 0개(프로젝트 ethos). graphology 는 이 규모(수십 노드)에 과하고 저속도라 채택하지 않음 — 손코드가 더 낮은 리스크.
// - 결정성: neighbors/bfs 의 이웃 확장은 id 사전순 정렬(mock/테스트 재현성). 알 수 없는/미존재 id → 빈 결과(throw 없음).
// - 방향 규약: 링크는 from→to. out(id)=id 가 from 인 링크, in(id)=id 가 to 인 링크, any=둘 다.

import type { LinkKind, ObjectType, OntologyLink, OntologyObject } from "./types";

// BFS/traverse 방향. out=하류(from→to), in=상류(to→from), any=무방향.
export type Direction = "out" | "in" | "any";

// linkKind 필터 — 단일 또는 여러 kind. 미지정이면 모든 관계.
export type LinkKindFilter = LinkKind | LinkKind[];

export interface BfsOptions {
  direction?: Direction;    // 기본 any(무방향 traverse)
  linkKind?: LinkKindFilter; // 특정 관계만 따라감(미지정=전부)
  maxDepth?: number;         // 시작=depth 0. 이 깊이까지만 방문(미지정=무제한)
}

// linkKind 필터를 述어(predicate)로. 미지정=항상 통과.
function kindMatcher(filter?: LinkKindFilter): (k: LinkKind) => boolean {
  if (filter == null) return () => true;
  if (Array.isArray(filter)) {
    const set = new Set<LinkKind>(filter);
    return (k) => set.has(k);
  }
  return (k) => k === filter;
}

// 온톨로지 인접 그래프 — 생성자에서 1회 인덱싱(byId/out/in), 조회는 O(1)~O(deg).
// 순수: 어떤 메서드도 원본 objects/links 를 변형하지 않는다. subgraph 는 새 인스턴스를 만든다.
export class OntologyGraph {
  private readonly byId: Map<string, OntologyObject>;
  private readonly outMap: Map<string, OntologyLink[]>;
  private readonly inMap: Map<string, OntologyLink[]>;
  private readonly links: OntologyLink[];

  constructor(objects: OntologyObject[], links: OntologyLink[]) {
    this.byId = new Map(objects.map((o) => [o.id, o]));
    this.outMap = new Map();
    this.inMap = new Map();
    this.links = links;
    for (const l of links) {
      (this.outMap.get(l.from) ?? this.outMap.set(l.from, []).get(l.from)!).push(l);
      (this.inMap.get(l.to) ?? this.inMap.set(l.to, []).get(l.to)!).push(l);
    }
  }

  // ── 투영(projection) ─────────────────────────────────────────────
  has(id: string): boolean {
    return this.byId.has(id);
  }
  object(id: string): OntologyObject | undefined {
    return this.byId.get(id);
  }
  type(id: string): ObjectType | undefined {
    return this.byId.get(id)?.type;
  }
  // 인덱싱된 전체 객체(삽입 순). 카탈로그 등 caller 의 반복용.
  objects(): OntologyObject[] {
    return [...this.byId.values()];
  }

  // ── 링크 조회(방향별) ────────────────────────────────────────────
  // id 가 from 인 링크(하류). kind 로 필터. 미존재 id → [].
  outLinks(id: string, kind?: LinkKindFilter): OntologyLink[] {
    const ls = this.outMap.get(id) ?? [];
    const match = kindMatcher(kind);
    return ls.filter((l) => match(l.linkKind));
  }
  // id 가 to 인 링크(상류). kind 로 필터. 미존재 id → [].
  inLinks(id: string, kind?: LinkKindFilter): OntologyLink[] {
    const ls = this.inMap.get(id) ?? [];
    const match = kindMatcher(kind);
    return ls.filter((l) => match(l.linkKind));
  }

  // ── 이웃(방향 무관) ──────────────────────────────────────────────
  // id 의 이웃 객체(out+in). kind 필터·dedup·id 사전순 정렬(결정적). 인덱스에 실재하는 객체만.
  neighbors(id: string, kind?: LinkKindFilter): OntologyObject[] {
    const match = kindMatcher(kind);
    const ids = new Set<string>();
    for (const l of this.outMap.get(id) ?? []) if (match(l.linkKind)) ids.add(l.to);
    for (const l of this.inMap.get(id) ?? []) if (match(l.linkKind)) ids.add(l.from);
    return [...ids]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((nid) => this.byId.get(nid))
      .filter((o): o is OntologyObject => o != null);
  }

  // 이웃 id 만(neighbors 의 경량판) — 자기 자신 제외, dedup·id 정렬.
  neighborIds(id: string, kind?: LinkKindFilter): string[] {
    return this.neighbors(id, kind).map((o) => o.id);
  }

  // ── BFS(무가중) ──────────────────────────────────────────────────
  // startId 에서 direction/linkKind/maxDepth 필터로 방문한 노드 id 를 방문 순서대로 반환.
  // 시작 노드는 depth 0 으로 항상 포함(존재할 때). cycle-safe(visited) — 무한 루프 없음.
  bfs(startId: string, opts: BfsOptions = {}): string[] {
    if (!this.byId.has(startId)) return [];
    const direction: Direction = opts.direction ?? "any";
    const match = kindMatcher(opts.linkKind);
    const maxDepth = opts.maxDepth ?? Infinity;

    const visited = new Set<string>([startId]);
    const order: string[] = [startId];
    let frontier: string[] = [startId];
    let depth = 0;

    while (frontier.length && depth < maxDepth) {
      const next = new Set<string>();
      for (const id of frontier) {
        for (const nid of this.step(id, direction, match)) {
          if (!visited.has(nid) && this.byId.has(nid)) next.add(nid);
        }
      }
      // 결정적 확장 순서(id 사전순).
      const layer = [...next].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (const nid of layer) {
        visited.add(nid);
        order.push(nid);
      }
      frontier = layer;
      depth++;
    }
    return order;
  }

  // ── 최단경로(무가중 BFS) ────────────────────────────────────────
  // fromId→toId 의 최단 node id 경로. 없으면 null. from===to 면 [from](존재할 때).
  // 방향/kind 필터는 traverse 규약과 동일(기본 any/전부).
  shortestPath(fromId: string, toId: string, opts: Omit<BfsOptions, "maxDepth"> = {}): string[] | null {
    if (!this.byId.has(fromId) || !this.byId.has(toId)) return null;
    if (fromId === toId) return [fromId];
    const direction: Direction = opts.direction ?? "any";
    const match = kindMatcher(opts.linkKind);

    const prev = new Map<string, string>(); // child → parent(경로 복원)
    const visited = new Set<string>([fromId]);
    let frontier: string[] = [fromId];

    while (frontier.length) {
      const next: string[] = [];
      // 결정적: frontier 를 id 순으로 확장.
      for (const id of [...frontier].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
        for (const nid of this.step(id, direction, match)) {
          if (visited.has(nid) || !this.byId.has(nid)) continue;
          visited.add(nid);
          prev.set(nid, id);
          if (nid === toId) return this.rebuild(prev, fromId, toId);
          next.push(nid);
        }
      }
      frontier = next;
    }
    return null;
  }

  // ── 부분그래프(유도) ────────────────────────────────────────────
  // 주어진 id 집합으로 유도된 부분그래프 — 양끝이 모두 집합에 있는 링크만. 새 인스턴스(순수).
  subgraph(ids: Iterable<string>): OntologyGraph {
    const keep = new Set<string>(ids);
    const objs = [...this.byId.values()].filter((o) => keep.has(o.id));
    const ls = this.links.filter((l) => keep.has(l.from) && keep.has(l.to));
    return new OntologyGraph(objs, ls);
  }

  // ── 내부 헬퍼 ────────────────────────────────────────────────────
  // 한 노드에서 direction/kind 로 갈 수 있는 이웃 id(중복 허용 — 호출부가 visited 로 걸러냄).
  private step(id: string, direction: Direction, match: (k: LinkKind) => boolean): string[] {
    const out: string[] = [];
    if (direction === "out" || direction === "any") {
      for (const l of this.outMap.get(id) ?? []) if (match(l.linkKind)) out.push(l.to);
    }
    if (direction === "in" || direction === "any") {
      for (const l of this.inMap.get(id) ?? []) if (match(l.linkKind)) out.push(l.from);
    }
    return out;
  }

  // prev 체인을 fromId→toId 순서 경로로 복원.
  private rebuild(prev: Map<string, string>, fromId: string, toId: string): string[] {
    const path: string[] = [toId];
    let cur = toId;
    while (cur !== fromId) {
      const p = prev.get(cur);
      if (p == null) break; // 방어(정상 경로면 도달)
      path.push(p);
      cur = p;
    }
    return path.reverse();
  }
}

// 팩토리 — 클래스 대신 함수 호출을 선호하는 caller 용(동일 인스턴스).
export function buildGraph(objects: OntologyObject[], links: OntologyLink[]): OntologyGraph {
  return new OntologyGraph(objects, links);
}
