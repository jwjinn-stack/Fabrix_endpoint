import { useMemo, useState } from "react";
import { fetchOntologyLinks, fetchOntologyObjects } from "../api/client";
import type { LinkKind, ObjectStatus, ObjectType, OntologyLink, OntologyObject } from "../api/types";
import {
  buildObjectTypeCatalog,
  buildSchemaGraph,
  type ObjectTypeCard,
  type SchemaEdge,
} from "../api/ontologySchema";
import {
  buildScorecard,
  GROUP_LABEL,
  SCORE_GROUPS,
  type InstanceScore,
  type Scorecard,
  type ScoreGroup,
} from "../api/ontologyScorecard";
import { typeVisual } from "../api/objectTypeVisual";
import { ACTION_REGISTRY } from "../actions/registry";
import { TopologyView, worseStatus } from "../components/topology";
import { SkeletonCards } from "../components/Skeleton";
import DataFreshness from "../components/DataFreshness";
import PauseToggle from "../components/PauseToggle";
import InfoTip from "../components/InfoTip";
import Badge, { type BadgeTone } from "../components/Badge";
import ObjectView, { useObjectView } from "../components/ObjectView";
import KineticStrip from "../components/KineticStrip";
import { usePolling } from "../utils/usePolling";
import type { NavFn } from "../router";

// IMP-77 — 스코어카드 자동 갱신 주기(감지 신선도 vs 비용 균형, IMP-51 규약과 동일 15s).
const REFRESH_MS = 15_000;

// IMP-68 — /ontology 재설계: 추상 타입 카탈로그 → **운영 준비도 스코어카드**.
//   docs/ontology-usecase-comparison.md §3·§4 + Datadog Software Catalog Scorecards 패턴.
//   실사례(Netflix·Datadog·ServiceNow·Palantir)가 만장일치로 피하는 "browsable 타입 카탈로그" 를
//   과업-앵커 진입("지금 무엇이 주의를 요하나")으로 바꾼다.
//
//   [기본 탭 "운영 준비도"] — 각 인스턴스(Endpoint/Model/GpuDevice/Node/Service)를 pass/fail 규칙으로
//     채점(Production Readiness/Observability/Ownership 3그룹). 상단 "주의 요약"(at-risk·실패 규칙 수).
//     실패 항목 클릭 → ObjectView(IMP-57) 상세 또는 /investigate COP(IMP-58) 딥링크(과업으로 연결).
//   [보조 탭 "스키마 참조"] — 기존 개념헤더 + Object Type 카탈로그 + Link Type 스키마 그래프 +
//     Action Type 목록(IMP-63)을 여기로 접어 둔다(reachable 하되 정문 아님 — IMP-70 재배치와 정합).
//
// 스코어는 온톨로지 인스턴스 props 에서 결정적으로 파생(mock-first, IMP-81 스냅샷 재사용, 순수 ontologyScorecard.ts).

// 타입별 한 줄 설명(§5.1 표). 글리프/라벨/색은 objectTypeVisual(단일 출처, IMP-64) 에서 온다.
const TYPE_DESC: Record<ObjectType, string> = {
  Model: "서빙 중인 추론 모델(양자화·컨텍스트·레플리카)",
  Endpoint: "외부 노출 추론 엔드포인트(모델·QPS·p95)",
  Service: "모델을 소비하는 논리 서비스(소유자·티어)",
  GpuDevice: "물리 GPU 디바이스(util·mem·온도·호스트)",
  Node: "GPU 를 담은 물리 노드(CPU·mem·GPU 수)",
  Trace: "추론 요청 1건의 실행 궤적(지연·토큰·판정)",
  Incident: "장애/이상 이벤트(심각도·영향 대상)",
  App: "엔드포인트를 소비하는 앱(app_id·라우팅 EP·요청 수)", // IMP-89
};

// linkKind → 사람용 라벨(스키마 엣지 표 병기). ObjectView LINK_LABEL 과 통일.
const LINK_LABEL: Record<LinkKind, string> = {
  consumes: "consumes (소비)",
  serves: "serves (서빙)",
  runsOn: "runsOn (실행)",
  hostedBy: "hostedBy (호스트)",
  routedTo: "routedTo (라우팅)",
  executedOn: "executedOn (실행)",
  affects: "affects (영향)",
  routes: "routes (app 라우팅)", // IMP-89 — Endpoint→App
};

const STATUS_TONE: Record<ObjectStatus, BadgeTone> = { ok: "green", warn: "amber", crit: "red", unknown: "neutral" };
const STATUS_LABEL: Record<ObjectStatus, string> = { ok: "정상", warn: "주의", crit: "위험", unknown: "미측정" };

// 카탈로그·스키마·Action·스코어카드를 함께 담는 라이브 파생 결과.
interface OntologyModel {
  catalog: ObjectTypeCard[];
  objects: OntologyObject[];
  schemaGraph: ReturnType<typeof buildSchemaGraph>["graph"];
  schemaEdges: SchemaEdge[];
  scorecard: Scorecard;
}

type OntoTab = "scorecard" | "schema";

// onNavigate 는 배선 일관성을 위해 받되(App.tsx 가 navigate 전달). 스코어카드는 ObjectView 드로어로
// 상세 진입하고, 실패 항목의 '조사' 딥링크는 onNavigate 로 /investigate COP(IMP-58)로 넘긴다.
export default function Ontology({ onNavigate }: { onNavigate?: NavFn } = {}) {
  // 기본 탭 = 운영 준비도 스코어카드(정문). 스키마 참조는 보조(IMP-70 정합). URL 동기화는 IMP-70 범위.
  const [tab, setTab] = useState<OntoTab>("scorecard");
  const view = useObjectView(); // 인스턴스/카드 클릭 → ObjectView(IMP-57) 속성·관계·inline Action.

  // 라이브 로드 — (a) 전체 Object, (b) 각 Object 의 링크를 병렬 수집해 union+dedup → 타입쌍 스키마 엣지.
  // 링크 fetch 일부 실패(env-missing)는 allSettled 로 흡수해 얻은 것만으로 그래프를 그린다.
  // IMP-77 — IMP-51 폴링 규약으로 승격: 자동 새로고침 + 정지/재개 + stale 시 마지막 데이터 유지.
  const poll = usePolling<OntologyModel>(
    async (signal) => {
      const list = await fetchOntologyObjects(undefined, undefined, signal);
      const objects = list.objects;
      // 각 객체의 링크를 병렬로. link 는 양 끝점에서 각각 나오므로 (from|to|kind) 로 dedup.
      const results = await Promise.allSettled(
        objects.map((o) => fetchOntologyLinks(o.id, undefined, signal)),
      );
      const seen = new Set<string>();
      const links: OntologyLink[] = [];
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        for (const l of r.value.links) {
          const key = `${l.from} ${l.to} ${l.linkKind}`;
          if (seen.has(key)) continue;
          seen.add(key);
          links.push(l);
        }
      }
      const catalog = buildObjectTypeCatalog(objects);
      const { graph, edges } = buildSchemaGraph(objects, links);
      const scorecard = buildScorecard(objects); // 순수·결정적(props/status 파생).
      return { catalog, objects, schemaGraph: graph, schemaEdges: edges, scorecard };
    },
    { intervalMs: REFRESH_MS },
  );

  const model = poll.data;
  const loading = poll.loading;
  const error = poll.error;

  // 타입별 첫 객체 id(카탈로그 카드 클릭 진입점) — 인스턴스가 있으면 그 첫 인스턴스를 ObjectView 로.
  const firstIdByType = useMemo(() => {
    const m = new Map<ObjectType, string>();
    for (const o of model?.objects ?? []) if (!m.has(o.type)) m.set(o.type, o.id);
    return m;
  }, [model]);

  const openType = (t: ObjectType) => {
    const id = firstIdByType.get(t);
    if (id) view.open(id);
  };

  const actions = useMemo(() => Object.values(ACTION_REGISTRY), []);
  const schemaEmpty = !!model && model.schemaGraph.nodes.length === 0;

  return (
    <>
      <div className="page-head">
        <h1>Ontology 운영 준비도</h1>
        <span className="crumb">탐색 / 온톨로지 렌즈</span>
        <InfoTip>
          FABRIX 를 메트릭 나열이 아니라 <b>명사(Object)·관계(Link)·동사(Action)</b> 의 온톨로지로 봅니다.
          이 화면은 "무슨 타입이 있나" 가 아니라 <b>"지금 무엇이 주의를 요하나"</b> 를
          운영 준비도 pass/fail 로 채점합니다(Datadog Scorecards 패턴). 스키마 정의는 <b>스키마 참조</b> 탭에.
        </InfoTip>
        <div className="spacer" />
        {/* IMP-77 — IMP-51 신선도 규약 승격: 자동 갱신 표기 + 정지/재개. */}
        <DataFreshness updatedAt={poll.lastLoaded} intervalMs={REFRESH_MS} />
        <PauseToggle paused={poll.paused} onToggle={() => poll.setPaused(!poll.paused)} />
        <button type="button" className="refresh-btn" onClick={() => poll.reload()} aria-label="온톨로지 새로고침">
          <span className="spin" aria-hidden="true">⟳</span>
          새로고침
        </button>
      </div>

      {/* IMP-72 — Kinetic 알림 스트립. 감지→객체 귀속을 4-슬롯 카드로. 객체 chip → ObjectView 드로어. */}
      <KineticStrip
        onNavigate={onNavigate}
        onOpenObject={(id) => view.open(id)}
      />

      {/* 탭 — 운영 준비도(정문) / 스키마 참조(보조). SlidePanel me-tabs/modality-tab 관례 재사용. */}
      <div className="me-tabs modality-tabs onto-tabs" role="tablist" aria-label="온톨로지 보기">
        <button
          type="button" role="tab" aria-selected={tab === "scorecard"}
          className={`modality-tab ${tab === "scorecard" ? "active" : ""}`}
          onClick={() => setTab("scorecard")}
        >운영 준비도</button>
        <button
          type="button" role="tab" aria-selected={tab === "schema"}
          className={`modality-tab ${tab === "schema" ? "active" : ""}`}
          onClick={() => setTab("schema")}
        >스키마 참조</button>
      </div>

      {error && (
        <div className="state error" role="alert">
          온톨로지를 불러오지 못했습니다. ({error})
          {poll.isStale && <span className="state-stale"> · 마지막으로 받은 데이터를 표시 중입니다.</span>}
        </div>
      )}
      {!error && loading && !model && <SkeletonCards count={3} />}

      {/* ── 기본 탭: 운영 준비도 스코어카드 ── */}
      {!error && model && tab === "scorecard" && (
        <ScorecardView
          scorecard={model.scorecard}
          onOpenObject={(id) => view.open(id)}
          onInvestigate={onNavigate ? (id) => onNavigate("investigate", { entity: id }) : undefined}
        />
      )}

      {/* ── 보조 탭: 스키마 참조(개념헤더 + 카탈로그 + 스키마 그래프 + Action 목록) ── */}
      {!error && model && tab === "schema" && (
        <>
          {/* (0) 개념 헤더 — semantic↔kinetic(§1) + 카피하는 "느낌" 3가지(§8). 문서 출처 그대로의 제품 카피. */}
          <section className="onto-concept card" aria-label="온톨로지 개념">
            <p className="onto-axes">
              <b>Semantic(의미)</b> — Object–Link 그래프로 "무엇이 무엇과 어떻게 연결되는가" 를 본다.
              {" · "}
              <b>Kinetic(동역학)</b> — Action(동사)이 결정을 온톨로지에 직접 기록(writeback)하고 전 화면에 즉시 반영된다.
            </p>
            <div className="onto-feels">
              <div className="onto-feel">
                <span className="onto-feel-glyph" aria-hidden="true">◈</span>
                <div>
                  <div className="onto-feel-h">온톨로지 렌즈</div>
                  <div className="onto-feel-d">메트릭 나열이 아니라 명사·관계·동사로 세계를 본다.</div>
                </div>
              </div>
              <div className="onto-feel">
                <span className="onto-feel-glyph" aria-hidden="true">⚡</span>
                <div>
                  <div className="onto-feel-h">Kinetic 제어</div>
                  <div className="onto-feel-d">화면에서 Action(동사)을 눌러 세계를 바꾼다 — 읽기 전용의 종말.</div>
                </div>
              </div>
              <div className="onto-feel">
                <span className="onto-feel-glyph" aria-hidden="true">◆</span>
                <div>
                  <div className="onto-feel-h">접지된 AI</div>
                  <div className="onto-feel-d">로컬 모델이 온톨로지를 tool 로 읽고 Action 을 호출 — 챗봇이 아닌 운영 에이전트.</div>
                </div>
              </div>
            </div>
          </section>

          {/* (1) Object Type 카탈로그 — 타입당 1장, 라이브 인스턴스 수/상태 분포/대표 인스턴스. */}
          <section aria-label="Object Type 카탈로그">
            <div className="onto-section-h">
              <h2>Object Types <span className="muted">명사 · §5.1</span></h2>
              <span className="muted onto-section-sub">현실 엔티티를 디지털로 매핑. 카드를 누르면 실제 인스턴스 상세로 들어갑니다.</span>
            </div>
            <div className="onto-catalog">
              {model.catalog.map((c) => (
                <TypeCard
                  key={c.type}
                  card={c}
                  onOpenType={() => openType(c.type)}
                  onOpenInstance={(id) => view.open(id)}
                />
              ))}
            </div>
          </section>

          {/* (2) Link Type 스키마 그래프 — TopologyView 재사용, 타입 노드 + 관계 엣지(§5.2). */}
          <section aria-label="Link Type 스키마 그래프">
            <div className="onto-section-h">
              <h2>Link Types <span className="muted">관계 그래프 · §5.2</span></h2>
              <span className="muted onto-section-sub">
                장애 원인을 따라가는 척추: Service → Endpoint → Model → GpuDevice → Node. 두께 = 실제 인스턴스 관계 수.
              </span>
            </div>
            {schemaEmpty ? (
              <div className="card"><div className="empty">관측된 관계가 없습니다.</div></div>
            ) : (
              <>
                <TopologyView
                  graph={model.schemaGraph}
                  interactive={false}
                  height={360}
                  // IMP-64(가법적): 스키마 엣지는 error_rate 가 없으므로 끝점 타입의 worst 상태로 색을 인코딩한다.
                  //  정상은 무채(회색) 유지 — 주의(amber)/위험(red)만 강조(색 과잉 방지). geometry 불변.
                  edgeStatusColor={(_e, from, to) => {
                    const w = worseStatus(from, to);
                    return w === "crit" ? "var(--red)" : w === "warn" ? "var(--amber)" : null;
                  }}
                />
                {/* complex-image 동등 대안(접근성) + 관계 kind 병기 — 색/그래프-only 아님(WCAG 1.4.1). */}
                <div className="card onto-edge-card">
                  <div className="card-head"><h3>관계 정의 ({model.schemaEdges.length})</h3></div>
                  <div className="table-scroll" tabIndex={0} role="region" aria-label="관계 정의 표 — 좌우 스크롤 가능">
                    <table className="usage-table">
                      <thead>
                        <tr><th>from</th><th>관계(kind)</th><th>to</th><th className="num">인스턴스 링크</th></tr>
                      </thead>
                      <tbody>
                        {model.schemaEdges.map((e) => (
                          <tr key={`${e.fromType}-${e.kind}-${e.toType}`}>
                            <td><span className="otype-mark" style={{ color: typeVisual(e.fromType).color }} aria-hidden="true">{typeVisual(e.fromType).glyph}</span> {e.fromType}</td>
                            <td><code>{LINK_LABEL[e.kind]}</code></td>
                            <td><span className="otype-mark" style={{ color: typeVisual(e.toType).color }} aria-hidden="true">{typeVisual(e.toType).glyph}</span> {e.toType}</td>
                            <td className="num">{e.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </section>

          {/* (3) Action Type 목록 — ACTION_REGISTRY: 대상 type·필요 capability·side effects. */}
          <section aria-label="Action Type 목록">
            <div className="onto-section-h">
              <h2>Action Types <span className="muted">동사(writeback) · §5.3</span></h2>
              <span className="muted onto-section-sub">
                온톨로지 객체 위에 얹는 제어 동사. 실행은 대상 화면의 확인(confirm) + capability 게이팅을 통과해야 합니다.
              </span>
            </div>
            <div className="card">
              <div className="table-scroll" tabIndex={0} role="region" aria-label="Action Type 표 — 좌우 스크롤 가능">
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>대상 Object</th>
                      <th>필요 권한(capability)</th>
                      <th>Side Effects</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions.map((a) => (
                      <tr key={a.name}>
                        <td>
                          <b>{a.label}</b> <code className="muted">{a.name}</code>
                        </td>
                        <td><span className="otype-mark" style={{ color: typeVisual(a.target).color }} aria-hidden="true">{typeVisual(a.target).glyph}</span> {a.target}</td>
                        <td>
                          {a.requiredCap
                            ? <code>{a.requiredCap}</code>
                            : <span className="muted">기본 허용</span>}
                        </td>
                        <td>
                          {a.sideEffects.map((s) => (
                            <span key={s} className="tag onto-side">{s}</span>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}

      {/* 인스턴스/카드 클릭 → Object View(속성·관계 in-place traverse·inline Action). 양 탭 공통. */}
      <ObjectView {...view.props} />
    </>
  );
}

// ── 운영 준비도 스코어카드 뷰(IMP-68) ─────────────────────────────────────
// 상단 "주의 요약"(at-risk·실패 규칙 수·그룹별 pass) + 인스턴스 스코어 목록(at-risk 우선 정렬).
function ScorecardView({
  scorecard,
  onOpenObject,
  onInvestigate,
}: {
  scorecard: Scorecard;
  onOpenObject: (id: string) => void;
  onInvestigate?: (id: string) => void;
}) {
  const { instances, summary } = scorecard;

  return (
    <>
      {/* (1) "지금 주의를 요하는 것" 요약 — 타입 나열이 아니라 과업-앵커 답. */}
      <section aria-label="운영 준비도 요약">
        <div className="onto-section-h">
          <h2>지금 주의를 요하는 것 <span className="muted">운영 준비도 · Datadog Scorecards</span></h2>
          <span className="muted onto-section-sub">
            각 인스턴스를 pass/fail 규칙으로 채점 — 위험/실패 항목을 눌러 상세(ObjectView) 또는 조사(COP)로 진입.
          </span>
        </div>
        <div className={`onto-attn card${summary.atRiskCount > 0 ? " onto-attn-risk" : summary.allPass ? " onto-attn-ok" : ""}`}>
          {summary.scored === 0 ? (
            <div className="empty">채점할 인스턴스가 없습니다.</div>
          ) : summary.allPass ? (
            <div className="onto-attn-headline onto-attn-headline-ok">
              <span className="onto-attn-glyph" aria-hidden="true">✓</span>
              <div>
                <div className="onto-attn-title">모든 인스턴스가 규칙을 통과했습니다</div>
                <div className="onto-attn-sub">{summary.scored}개 인스턴스 · 실패 규칙 0건 · 주의 대상 0건</div>
              </div>
            </div>
          ) : (
            <div className="onto-attn-headline">
              <span className="onto-attn-glyph onto-attn-glyph-risk" aria-hidden="true">▲</span>
              <div>
                <div className="onto-attn-title">
                  주의 대상 <b className="onto-attn-num">{summary.atRiskCount}</b>건 ·
                  실패 규칙 <b className="onto-attn-num">{summary.failingRuleCount}</b>건
                </div>
                <div className="onto-attn-sub">채점 인스턴스 {summary.scored}개 중</div>
              </div>
            </div>
          )}
          {/* 그룹별 pass/total 미니 바 — Production Readiness/Observability/Ownership. */}
          {summary.scored > 0 && (
            <div className="onto-groups" role="list" aria-label="규칙 그룹 요약">
              {summary.byGroup.map((g) => {
                const failed = g.total - g.pass;
                return (
                  <div className="onto-group-stat" role="listitem" key={g.group}>
                    <span className="onto-group-label">{GROUP_LABEL[g.group]}</span>
                    <span className={`onto-group-nums${failed > 0 ? " onto-group-nums-fail" : ""}`}>
                      {g.pass}/{g.total}
                    </span>
                    <span className="onto-group-bar" aria-hidden="true">
                      <span
                        className={`onto-group-bar-fill${failed > 0 ? " onto-group-bar-fill-fail" : ""}`}
                        style={{ width: g.total > 0 ? `${(g.pass / g.total) * 100}%` : "0%" }}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* (2) 인스턴스 스코어 목록 — at-risk 우선(주의 요하는 것이 위로). */}
      {summary.scored > 0 && (
        <section aria-label="인스턴스 스코어 목록">
          <ul className="onto-scorelist">
            {instances.map((ins) => (
              <ScoreRow
                key={ins.object.id}
                score={ins}
                onOpenObject={onOpenObject}
                onInvestigate={onInvestigate}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// 인스턴스 1건 스코어 행 — 타입 글리프 + title + 상태 Badge + 3그룹 pass/fail 셀 + 딥링크(상세/조사).
function ScoreRow({
  score,
  onOpenObject,
  onInvestigate,
}: {
  score: InstanceScore;
  onOpenObject: (id: string) => void;
  onInvestigate?: (id: string) => void;
}) {
  const { object: obj, results, failCount, total, atRisk } = score;
  const vis = typeVisual(obj.type);
  // 실패한 규칙 라벨(과업 연결 — 어느 규칙이 fail 인지 명시).
  const failed = results.filter((r) => !r.pass);
  // 그룹별 pass/total(행 셀).
  const groupCell = (group: ScoreGroup) => {
    const rs = results.filter((r) => r.group === group);
    const pass = rs.filter((r) => r.pass).length;
    const allPass = pass === rs.length;
    return (
      <div className={`onto-cell${allPass ? " onto-cell-ok" : " onto-cell-fail"}`} key={group}>
        <span className="onto-cell-label">{GROUP_LABEL[group]}</span>
        <span className="onto-cell-nums">
          {/* 색-only 금지(WCAG 1.4.1): 텍스트 pass/total + 상태 글리프 병기. */}
          <span className="onto-cell-mark" aria-hidden="true">{allPass ? "✓" : "✕"}</span>
          {pass}/{rs.length}
        </span>
      </div>
    );
  };

  return (
    <li className={`onto-scorerow card${atRisk ? " onto-scorerow-risk" : ""}`}>
      <div className="onto-scorerow-main">
        {/* 타입 글리프 + title + 상태 + fail 요약. */}
        <span
          className={`otype-chip ${vis.className} onto-scorerow-chip`}
          style={{ ["--otype-color" as string]: vis.color, ["--otype-tint" as string]: vis.tint }}
        >
          <span className="otype-chip-glyph" aria-hidden="true">{vis.glyph}</span>
          {vis.label}
        </span>
        <span className="onto-scorerow-title" title={obj.id}>{obj.title}</span>
        <Badge tone={STATUS_TONE[obj.status]} dot>{STATUS_LABEL[obj.status]}</Badge>
        <span className={`onto-scorerow-fails${failCount > 0 ? " onto-scorerow-fails-bad" : ""}`}>
          {failCount > 0 ? `${failCount}/${total} 실패` : `${total}/${total} 통과`}
        </span>
        <div className="spacer" />
        {/* 딥링크 — 상세(ObjectView) + 조사(COP). 실패 항목을 과업으로 연결. */}
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => onOpenObject(obj.id)}
          title={`${obj.title} 상세(속성·관계·Action)`}
        >상세 →</button>
        {onInvestigate && (
          <button
            type="button"
            className={`btn-sm ${atRisk ? "btn-primary" : "btn-ghost"}`}
            onClick={() => onInvestigate(obj.id)}
            title="근본원인 추적(COP)에서 이 객체를 진입점으로"
          >조사 →</button>
        )}
      </div>

      {/* 3그룹 pass/fail 셀. */}
      <div className="onto-cells">
        {SCORE_GROUPS.map((g) => groupCell(g))}
      </div>

      {/* 실패 규칙 명시(있을 때만) — 어느 규칙이 왜 fail 인지(과업 연결 카피). */}
      {failed.length > 0 && (
        <ul className="onto-fail-list">
          {failed.map((r) => (
            <li className="onto-fail-item" key={r.id}>
              <span className="onto-fail-mark" aria-hidden="true">✕</span>
              <span className="onto-fail-label">{r.label}</span>
              <span className="onto-fail-hint">{r.failHint}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// Object Type 카탈로그 카드 — 글리프+라벨+설명 + 라이브 count + 상태 분포 배지 + 대표 인스턴스 칩.
function TypeCard({
  card,
  onOpenType,
  onOpenInstance,
}: {
  card: ObjectTypeCard;
  onOpenType: () => void;
  onOpenInstance: (id: string) => void;
}) {
  const vis = typeVisual(card.type);
  const empty = card.count === 0;
  // 상태 분포 — 0 이 아닌 상태만 배지로(위험→주의→정상→미측정 순).
  const dist = (["crit", "warn", "ok", "unknown"] as ObjectStatus[]).filter((s) => card.statusCounts[s] > 0);
  return (
    <div className={`card onto-card ${vis.className}${empty ? " onto-card-empty" : ""}`} style={{ ["--otype-color" as string]: vis.color, ["--otype-tint" as string]: vis.tint }}>
      <button
        type="button"
        className="onto-card-head"
        onClick={onOpenType}
        disabled={empty}
        title={empty ? `${vis.label} — 인스턴스 없음` : `${vis.label} 인스턴스 열기`}
      >
        {/* 타입 글리프 — 색으로 noun-type 위계(IMP-64). 약한 tint 배경 칩. */}
        <span className="onto-card-glyph" aria-hidden="true">{vis.glyph}</span>
        <span className="onto-card-titles">
          <span className="onto-card-type">{card.type}</span>
          <span className="onto-card-label">{vis.label}</span>
        </span>
        <span className="onto-card-count" aria-label={`인스턴스 ${card.count}개`}>{card.count}</span>
      </button>
      <p className="onto-card-desc">{TYPE_DESC[card.type]}</p>
      <div className="onto-card-dist">
        {empty ? (
          <span className="muted">인스턴스 없음</span>
        ) : (
          dist.map((s) => (
            <Badge key={s} tone={STATUS_TONE[s]} dot>{STATUS_LABEL[s]} {card.statusCounts[s]}</Badge>
          ))
        )}
      </div>
      {card.samples.length > 0 && (
        <div className="onto-card-samples">
          {card.samples.map((o) => (
            <button
              key={o.id}
              type="button"
              className="onto-sample"
              onClick={() => onOpenInstance(o.id)}
              title={`${o.title} 열기`}
            >
              <span className={`ov-dot ov-dot-${o.status}`} aria-hidden="true" />
              <span className="onto-sample-title">{o.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
