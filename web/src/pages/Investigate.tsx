import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchOntologyObjects, fetchOntologyLinks } from "../api/client";
import type { ObjectStatus, OntologyLink, OntologyObject } from "../api/types";
import {
  buildRootCausePath,
  pickEntryCandidates,
  defaultEntry,
  EDGE_BADGE,
  type EntryCandidate,
  type Hop,
  type RootCausePath,
} from "../api/investigate";
import { buildDemoScenario, type DemoStep } from "../api/demoScenario";
import Gauge from "../components/Gauge";
import Sparkline from "../components/Sparkline";
import Badge, { type BadgeTone } from "../components/Badge";
import { SkeletonCards } from "../components/Skeleton";
import DataFreshness from "../components/DataFreshness";
import InfoTip from "../components/InfoTip";
import ObjectView, { useObjectView } from "../components/ObjectView";
import { investigateSchema, useUrlState } from "../urlState";
import { humanizeError } from "../utils/errors";

// IMP-58 — Troubleshooting Flow(COP) 화면.
// 느린 Endpoint 하나에서 온톨로지 관계를 따라 원인 후보(Model/GPU/Node, 그 Node 의 다른 영향 Service)까지
// 한 화면에서 추적한다. Grafana RCA Workbench 패턴(assertion timeline + dependency graph + entity KPI drawer).
//   LEFT: 진입 Object 후보 → 선택. CENTER: 자동확장 근본원인 PATH(hop 카드+골든시그널). RIGHT: hop 클릭 → ObjectView.
// Copy 는 "추정 근본원인 / 영향 경로" — 상관을 인과로 과장하지 않는다(mock-first, IMP-56 온톨로지 재사용).

const REFRESH_MS = 15_000;

const STATUS_TONE: Record<ObjectStatus, BadgeTone> = { ok: "green", warn: "amber", crit: "red", unknown: "neutral" };
const STATUS_LABEL: Record<ObjectStatus, string> = { ok: "정상", warn: "주의", crit: "위험", unknown: "미측정" };

// Object type 별 글리프(무채색, ObjectView TYPE_META 와 통일).
const TYPE_GLYPH: Record<OntologyObject["type"], string> = {
  Model: "◆", Endpoint: "▣", Service: "◈", GpuDevice: "▤", Node: "▥", Trace: "≣", Incident: "▲",
};
const TYPE_LABEL: Record<OntologyObject["type"], string> = {
  Model: "모델", Endpoint: "엔드포인트", Service: "서비스", GpuDevice: "GPU", Node: "노드", Trace: "트레이스", Incident: "인시던트",
};

// 골든시그널 색(값 궤적) — util/latency=primary, error=amber(임계선은 컴포넌트가 담당).
function signalColor(key: string): string {
  return key === "error" ? "var(--amber)" : "var(--primary)";
}

export default function Investigate() {
  const [objects, setObjects] = useState<OntologyObject[]>([]);
  const [links, setLinks] = useState<OntologyLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<number | null>(null);

  // 진입 Object — URL(entity) 단일 출처. 빈 값이면 기본 진입(가장 아픈 후보).
  const [urlSt, patchUrl] = useUrlState(investigateSchema);
  const view = useObjectView(); // RIGHT: hop 클릭 → ObjectView(IMP-57) + inline Action(IMP-59)

  // IMP-61 — 내장 데모 시나리오 재생 모드. demo="1" 이면 mock seeded fixture 로 경로를 대체하고
  // 순서 있는 step 을 하이라이트한다(thin layer — traversal 재구현 없이 buildRootCausePath 재사용).
  const demoOn = urlSt.demo === "1";
  const demo = useMemo(() => (demoOn ? buildDemoScenario() : null), [demoOn]);
  const [stepIdx, setStepIdx] = useState(0);
  // 데모를 켜거나 끌 때 step 을 처음으로 되감는다(결정적 시작).
  useEffect(() => { setStepIdx(0); }, [demoOn]);

  // 온톨로지 그래프 로드(IMP-56 client). 링크는 전 객체의 links 를 모아 dedup(경로 traverse 용).
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const list = await fetchOntologyObjects(undefined, undefined, signal);
      const objs = list.objects;
      // 각 객체의 links 를 모아 방향 엣지 집합을 만든다(중복 제거).
      const linkResults = await Promise.all(objs.map((o) => fetchOntologyLinks(o.id, undefined, signal).catch(() => null)));
      const seen = new Set<string>();
      const all: OntologyLink[] = [];
      for (const lr of linkResults) {
        if (!lr) continue;
        for (const l of lr.links) {
          const k = `${l.from}|${l.to}|${l.linkKind}`;
          if (!seen.has(k)) { seen.add(k); all.push(l); }
        }
      }
      setObjects(objs);
      setLinks(all);
      setLastLoaded(Date.now());
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(humanizeError((e as Error).message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    load(ctrl.signal);
    const id = setInterval(() => load(), REFRESH_MS);
    return () => { ctrl.abort(); clearInterval(id); };
  }, [load]);

  const candidates = useMemo<EntryCandidate[]>(() => pickEntryCandidates(objects), [objects]);

  // 진입 id — URL entity 우선, 없으면 기본 진입(가장 아픈 후보). 데이터 로드 후에만 확정.
  const entryId = useMemo(() => {
    if (urlSt.entity) return urlSt.entity;
    return objects.length ? defaultEntry(objects) ?? "" : "";
  }, [urlSt.entity, objects]);

  // 근본원인 경로(순수 traverse). 데모 모드면 seeded fixture 의 경로를 그대로 쓴다(evidence surface 재사용).
  // objects/links 준비 전엔 빈 경로.
  const path = useMemo<RootCausePath>(
    () => (demo ? demo.path : buildRootCausePath(objects, links, entryId)),
    [demo, objects, links, entryId],
  );

  // 데모 step 배열 + 현재 step(경계 clamp). 데모 아닐 땐 빈 배열.
  const steps: DemoStep[] = demo ? demo.steps : [];
  const activeStep = steps.length ? steps[Math.min(stepIdx, steps.length - 1)] : null;
  const activeStepId = activeStep?.id ?? null;

  const selectEntry = useCallback((id: string) => patchUrl({ entity: id }), [patchUrl]);
  const toggleDemo = useCallback(() => patchUrl({ demo: demoOn ? "" : "1" }), [demoOn, patchUrl]);

  return (
    <>
      <div className="page-head">
        <h1>근본원인 추적 (COP)</h1>
        <span className="crumb">인프라 · 관측 / 근본원인 추적</span>
        <InfoTip>
          느린 Endpoint 에서 관계 그래프(serves→runsOn→hostedBy)를 따라 원인 후보와 blast-radius 를 한 화면에서 추적합니다.
          시간축은 "먼저 무너진 것" 기준이며, 표시는 <b>추정 근본원인 / 영향 경로</b> — 상관이 곧 인과는 아닙니다.
        </InfoTip>
        <div className="spacer" />
        {/* IMP-61 — 내장 데모 시나리오 재생 토글(mock seeded walkthrough). */}
        <button
          type="button"
          className={`refresh-btn demo-toggle ${demoOn ? "active" : ""}`}
          onClick={toggleDemo}
          aria-pressed={demoOn}
          title="느린 엔드포인트 → 포화 GPU/핫 노드 → cordon+scale 을 단계별로 재생(mock)"
        >
          <span aria-hidden="true">▶</span>
          {demoOn ? "데모 종료" : "데모 시나리오 재생"}
        </button>
        <DataFreshness updatedAt={lastLoaded} intervalMs={REFRESH_MS} />
        <button type="button" className="refresh-btn" onClick={() => load()} disabled={demoOn} aria-label="근본원인 경로 새로고침">
          <span className="spin" aria-hidden="true">⟳</span>
          새로고침
        </button>
      </div>

      {/* IMP-61 — 데모 컨트롤 바(재생 모드에서만). 순서 있는 step 을 이전/다음으로 이동. */}
      {demoOn && (
        <DemoBar
          steps={steps}
          stepIdx={Math.min(stepIdx, Math.max(0, steps.length - 1))}
          onStep={setStepIdx}
        />
      )}

      {error && !demoOn && <div className="state error" role="alert">온톨로지 그래프를 불러오지 못했습니다. ({error})</div>}
      {!error && !demoOn && loading && !objects.length && <SkeletonCards count={4} />}

      {/* 데모 모드는 seeded fixture 라 로딩/에러 게이트를 통과하지 않고 즉시 렌더한다. */}
      {(demoOn || (!error && !loading)) && (
        <div className="cop-grid">
          {/* LEFT — 데모: 순서 있는 step 목록 / 일반: 진입 Object 후보 */}
          {demoOn ? (
            <aside className="cop-entry" aria-label="데모 단계">
              <div className="cop-panel-h">데모 단계</div>
              <p className="cop-hint">느린 엔드포인트 → 포화 GPU/핫 노드 → 권장 조치(cordon+scale)를 단계별로 따라갑니다. <b>mock 데모</b>입니다.</p>
              {steps.length === 0 ? (
                <div className="empty">데모 시나리오를 불러오지 못했습니다.</div>
              ) : (
                <ol className="cop-steps">
                  {steps.map((st, i) => (
                    <li key={st.id}>
                      <button
                        type="button"
                        className={`cop-step ${i === stepIdx ? "active" : ""}`}
                        aria-current={i === stepIdx ? "true" : undefined}
                        onClick={() => setStepIdx(i)}
                      >
                        <span className="cop-step-n" aria-hidden="true">{i + 1}</span>
                        <span className="cop-step-body">
                          <span className="cop-step-title">{st.title}</span>
                          {st.action && <span className="cop-step-action">권장: {st.action.label}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </aside>
          ) : (
            <aside className="cop-entry" aria-label="진입 대상">
              <div className="cop-panel-h">진입 대상</div>
              <p className="cop-hint">문제 Endpoint 또는 발생 인시던트를 골라 경로를 추적합니다.</p>
              {candidates.length === 0 ? (
                <div className="empty">추적할 대상이 없습니다.</div>
              ) : (
                <ul className="cop-cands">
                  {candidates.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={`cop-cand ${c.id === entryId ? "active" : ""}`}
                        aria-current={c.id === entryId ? "true" : undefined}
                        onClick={() => selectEntry(c.id)}
                        title={c.reason}
                      >
                        <span className="cop-cand-glyph" aria-hidden="true">{TYPE_GLYPH[c.type]}</span>
                        <span className="cop-cand-body">
                          <span className="cop-cand-title">{c.title}</span>
                          <span className="cop-cand-reason">{c.reason}</span>
                        </span>
                        <span className={`ov-dot ov-dot-${c.status}`} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          )}

          {/* CENTER — 근본원인 PATH(자동확장 hop 스택). 데모면 현재 step 의 hop 을 하이라이트. */}
          <section className="cop-path" aria-label="근본원인 경로">
            <div className="cop-panel-h">
              추정 근본원인 · 영향 경로
              {path.hops.length > 0 && <span className="cop-count">{path.hops.length} hop</span>}
            </div>
            {!path.found ? (
              <div className="empty" role="status">
                {demoOn
                  ? <>데모 시나리오를 불러오지 못했습니다.</>
                  : <>대상을 찾을 수 없습니다{entryId ? <>: <code>{entryId}</code></> : null}. 좌측에서 진입 대상을 선택하세요.</>}
              </div>
            ) : (
              <ol className="cop-hops">
                {path.hops.map((h, i) => (
                  <HopCard
                    key={h.id}
                    hop={h}
                    index={i}
                    isLast={i === path.hops.length - 1}
                    onOpen={() => view.open(h.id)}
                    active={view.objectId === h.id}
                    demoActive={demoOn && h.id === activeStepId}
                    demoStep={demoOn && h.id === activeStepId ? activeStep : null}
                  />
                ))}
              </ol>
            )}
          </section>
        </div>
      )}

      {/* RIGHT — hop 클릭 KPI 드로어: ObjectView(속성/관계 traverse) + inline Action */}
      <ObjectView {...view.props} />
    </>
  );
}

// hop 카드 — edge-type badge + 글리프/title + 상태 + first-anomaly time + 골든시그널(Gauge+Sparkline).
// demoActive: 데모 재생 중 현재 step 의 hop 이면 강조 + narration/권장 조치 요약을 얹는다(IMP-61).
function HopCard({
  hop,
  index,
  isLast,
  onOpen,
  active,
  demoActive = false,
  demoStep = null,
}: {
  hop: Hop;
  index: number;
  isLast: boolean;
  onOpen: () => void;
  active: boolean;
  demoActive?: boolean;
  demoStep?: DemoStep | null;
}) {
  const meta = { glyph: TYPE_GLYPH[hop.object.type], label: TYPE_LABEL[hop.object.type] };
  return (
    <li className="cop-hop-wrap">
      {/* 진입이 아니면 위쪽에 edge-type badge(관계 종류) — 어떤 링크로 왔는지. */}
      {hop.fromKind && (
        <div className="cop-edge" aria-hidden="true">
          <span className="cop-edge-line" />
          <span className="cop-edge-badge">{EDGE_BADGE[hop.fromKind]}</span>
        </div>
      )}
      <button
        type="button"
        className={`cop-hop ${hop.critical ? "crit" : ""} ${hop.blastRadius ? "blast" : ""} ${active ? "active" : ""} ${demoActive ? "demo-active" : ""}`}
        onClick={onOpen}
        aria-current={active || demoActive ? "true" : undefined}
        title={`${meta.label} · ${hop.id} — 상세/조치 열기`}
      >
        <div className="cop-hop-top">
          <span className="cop-hop-glyph" aria-hidden="true">{meta.glyph}</span>
          <span className="cop-hop-title">{hop.object.title}</span>
          <span className="cop-hop-type">{meta.label}</span>
          <Badge tone={STATUS_TONE[hop.status]} dot>{STATUS_LABEL[hop.status]}</Badge>
        </div>

        {/* 라벨 줄 — 시간축(먼저 무너진 것) + 추정 근본원인 / blast-radius 배지. */}
        <div className="cop-hop-labels">
          <span className="cop-time" title="이 hop 에서 첫 이상이 관측된 시각(시간축 정렬)">
            첫 이상 {hop.firstAnomalyLabel}
          </span>
          {hop.critical && <span className="cop-tag cop-tag-crit">추정 근본원인</span>}
          {hop.blastRadius && <span className="cop-tag cop-tag-blast">영향 확산(blast-radius)</span>}
          {index === 0 && <span className="cop-tag cop-tag-entry">진입</span>}
        </div>

        {/* 골든시그널 — Gauge(현재값+임계밴드) + Sparkline(anomaly band=warn/crit 임계선). */}
        <div className="cop-signals">
          {hop.signals.map((s) => (
            <div className="cop-signal" key={s.key}>
              <div className="cop-signal-h">
                <span className="cop-signal-label">{s.label}</span>
                <span className="cop-signal-v">{s.valueText}</span>
              </div>
              <Gauge value={s.value} warn={s.warn} crit={s.crit} valueText={s.valueText} label={s.label} height={7} />
              <Sparkline
                values={s.series}
                color={signalColor(s.key)}
                width={180}
                height={26}
                warnValue={s.warn}
                critValue={s.crit}
              />
            </div>
          ))}
        </div>

        {/* 데모 재생 — 현재 step 의 narration + 권장 조치 요약(조치 실행은 카드를 열면 ObjectView 의 confirm 게이팅으로만). */}
        {demoActive && demoStep && (
          <div className="cop-demo-note" role="note">
            <p className="cop-demo-narration">{demoStep.narration}</p>
            {demoStep.action && (
              <p className="cop-demo-action">
                권장 조치: <b>{demoStep.action.label}</b> — {demoStep.action.reason}
                <span className="cop-demo-action-hint"> (카드를 열어 확인 후 실행 · 권한 없으면 비활성)</span>
              </p>
            )}
          </div>
        )}
      </button>

      {isLast && !demoActive && <p className="cop-foot-note">경로는 척추(serves→runsOn→hostedBy) 종점 이후 한 hop 을 더 펼쳐 조기 종결을 방지합니다.</p>}
    </li>
  );
}

// IMP-61 — 데모 컨트롤 바. 순서 있는 step 을 이전/다음/처음으로 이동(결정적 재생).
function DemoBar({
  steps,
  stepIdx,
  onStep,
}: {
  steps: DemoStep[];
  stepIdx: number;
  onStep: (i: number) => void;
}) {
  if (steps.length === 0) return null;
  const cur = steps[stepIdx];
  const atFirst = stepIdx <= 0;
  const atLast = stepIdx >= steps.length - 1;
  return (
    <div className="demo-bar" role="region" aria-label="데모 시나리오 컨트롤">
      <span className="demo-bar-tag">데모</span>
      <span className="demo-bar-title">느린 엔드포인트 → 포화 GPU/핫 노드 → cordon+scale</span>
      <span className="demo-bar-progress" aria-live="polite">
        단계 {stepIdx + 1}/{steps.length} · <b>{cur.title}</b>
      </span>
      <div className="spacer" />
      <div className="demo-bar-ctrls" role="group" aria-label="단계 이동">
        <button type="button" className="btn-ghost btn-sm" onClick={() => onStep(0)} disabled={atFirst} aria-label="처음으로">처음</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => onStep(Math.max(0, stepIdx - 1))} disabled={atFirst} aria-label="이전 단계">← 이전</button>
        <button type="button" className="btn-primary btn-sm" onClick={() => onStep(Math.min(steps.length - 1, stepIdx + 1))} disabled={atLast} aria-label="다음 단계">다음 →</button>
      </div>
    </div>
  );
}
