// IMP-97 — 인시던트 화면 '이 화면 읽는 법' 온보딩(default-collapsed progressive disclosure).
//
// IMP-83(Ontology '읽는 법' disclosure) 패턴 재사용 + 인시던트 맥락. '가장 경험 적은 온콜' 기준으로
// 신호→추정원인→영향→조치 3단 + inline 마이크로 런북을 쓴다(incident.io 'written for the least
// experienced on-call' · NN/g progressive disclosure).
//
// 정보폭탄 금지:
//  - default-collapsed. 작은 persistent '?' 트리거만 상시 표시(intrusive auto-firing coach mark 아님).
//  - per-user 1회 dismiss 를 localStorage 로 기억 → 복귀 사용자는 auto-expand 안 함(여전히 접힘).
//    dismiss 해도 '?' 트리거는 남아 필요할 때 다시 펼칠 수 있다(재확인 경로 보존).
//  - first-anomaly '무엇이 먼저 무너졌나' 타임라인은 여기(collapsed 헤더)에 렌더하지 않는다 —
//    health-at-a-glance 이후 drill-down 층(hop/ObjectView 의 EvidencePanel→EvidenceTimeline, IMP-100)에만.
//
// 핵심 용어(triggered/NotReady/backpressure…)는 StatusInfoTip(단일 glossary, IMP-4 InfoTip) 로 인라인 정의.
import { useCallback, useState } from "react";
import StatusInfoTip from "./StatusInfoTip";

// per-user 1회 dismiss 플래그 키. localStorage 불가(프라이빗 모드) 시 조용히 무시(savedViews.ts 관례).
const DISMISS_KEY = "fabrix.incidentGuide.dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}
function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* localStorage 불가 — 조용히 무시 */
  }
}

export default function IncidentReadingGuide() {
  // default-collapsed. dismiss 여부와 무관하게 초기엔 접혀 있다(auto-expand 없음 — 정보폭탄 방지).
  const [open, setOpen] = useState(false);
  // dismiss 상태(마운트 시 localStorage 에서 1회 읽음). true 여도 '?' 트리거는 남는다.
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const dismiss = useCallback(() => {
    writeDismissed();
    setDismissed(true);
    setOpen(false);
  }, []);

  return (
    <section className="incident-guide" aria-label="이 화면 읽는 법">
      {/* persistent '?' 트리거 — 작고 상시. 자동 발화 아님(사용자가 눌러야 펼침). */}
      <div className="incident-guide-head">
        <button
          type="button"
          className="incident-guide-trigger"
          aria-expanded={open}
          aria-controls="incident-guide-body"
          onClick={toggle}
        >
          <span className="incident-guide-q" aria-hidden="true">?</span>
          이 화면 읽는 법
          {!dismissed && <span className="incident-guide-new" aria-hidden="true">처음이면 열어보기</span>}
        </button>
      </div>

      {open && (
        <div className="incident-guide-body" id="incident-guide-body">
          <p className="incident-guide-lead">
            처음 당직이어도 괜찮습니다. 이 화면은 <b>신호 → 추정 원인 → 영향 → 조치</b> 순서로 읽으면 됩니다.
          </p>

          {/* 신호→추정원인→영향→조치 3(+1)단 마이크로 런북 — 각 단계 1~2줄, 가장 경험 적은 온콜 기준. */}
          <ol className="incident-guide-steps">
            <li className="incident-guide-step">
              <span className="incident-guide-num" aria-hidden="true">1</span>
              <div>
                <div className="incident-guide-step-h">신호(무엇이 울렸나)</div>
                <div className="incident-guide-step-d">
                  상태 배지를 먼저 봅니다 — <StatusInfoTip termKey="crit" />위험(crit)/
                  <StatusInfoTip termKey="warn" />주의(warn), 그리고 방금 뜬{" "}
                  <StatusInfoTip termKey="triggered" />발생·미확인 알림. 용어가 낯설면 옆의 ⓘ 를 누르세요.
                </div>
              </div>
            </li>
            <li className="incident-guide-step">
              <span className="incident-guide-num" aria-hidden="true">2</span>
              <div>
                <div className="incident-guide-step-h">추정 원인(왜 그런가)</div>
                <div className="incident-guide-step-d">
                  근거(신호가 언제 임계를 넘었나)를 보고 원인을 좁힙니다. 파드가 안 뜨거나(
                  <StatusInfoTip termKey="notready" />NotReady) 큐가 쌓이는(
                  <StatusInfoTip termKey="backpressure" />backpressure) 경우가 흔합니다.
                  <b> 상관은 곧 인과가 아닙니다</b> — 근거로 확인하세요.
                </div>
              </div>
            </li>
            <li className="incident-guide-step">
              <span className="incident-guide-num" aria-hidden="true">3</span>
              <div>
                <div className="incident-guide-step-h">영향(무엇이 번지나)</div>
                <div className="incident-guide-step-d">
                  같은 노드/GPU 를 쓰는 다른 대상까지 번졌는지(
                  <StatusInfoTip termKey="blast" />영향 확산) 확인합니다. 자세한 시간축(무엇이 먼저 무너졌나)은
                  카드를 <b>열면</b> 근거 타임라인에서 볼 수 있습니다.
                </div>
              </div>
            </li>
            <li className="incident-guide-step">
              <span className="incident-guide-num" aria-hidden="true">4</span>
              <div>
                <div className="incident-guide-step-h">조치(무엇을 하나)</div>
                <div className="incident-guide-step-d">
                  먼저 <b>확인·배정</b>(<StatusInfoTip termKey="acked" />acked)으로 담당을 잡고, 추천 조치는
                  <b> 확인(confirm) 후 직접 실행</b>됩니다(자동 아님). 권한이 없으면 조사·확인만 하면 됩니다.
                </div>
              </div>
            </li>
          </ol>

          <div className="incident-guide-foot">
            <button type="button" className="btn-ghost btn-sm" onClick={dismiss}>
              알겠습니다 (다시 자동 안내 안 함)
            </button>
            <span className="incident-guide-foot-hint muted">
              닫아도 상단 <b>?</b> 로 언제든 다시 볼 수 있습니다.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
