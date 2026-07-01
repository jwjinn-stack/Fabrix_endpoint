import { useMemo } from "react";
import Badge from "./Badge";
import InfoTip from "./InfoTip";
import { usePolling } from "../utils/usePolling";
import {
  isMockMode, probeModel, resolveConnState, perceivedLatencyLabel,
  type ModelConnConfig,
} from "../api/modelConnection";

// IMP-82 — 로컬 추론 모델(Dynamo) 연결 상태 칩.
//   AiAgent 헤더 + 클러스터 인사이트 패널에 표기해, "로컬 모델 근거" 주장에 실제 연결 근거를 붙인다.
//   **정직 최우선**: mock 기본은 무채색 "mock 모델"로만 표기하고 절대 green/"연결됨"으로 위장하지 않는다.
//   실경로(VITE_MOCK=off)면 /health+/v1/models 를 저비용 폴링(기존 usePolling 재사용, 새 의존성 0).
//   색 비의존(Badge dot + 텍스트) · TTFT 우선 지연 배지(스트리밍 지각-반응 신호).

const PROBE_INTERVAL_MS = 15_000; // read-only·저비용 — 폴링은 여유 있게.

export default function ModelStatusChip({ config }: { config: ModelConnConfig }) {
  const mock = isMockMode();

  // mock 이면 프로브 자체를 하지 않는다(실제 연결 대상 없음 — 정직). 실경로에서만 폴링.
  const { data: probe } = usePolling(
    (signal) => probeModel(config, signal),
    { intervalMs: PROBE_INTERVAL_MS, enabled: !mock, deps: [config.endpoint, config.model, config.timeoutMs] },
  );

  const conn = useMemo(
    () => resolveConnState(mock ? null : probe, config, mock),
    [mock, probe, config],
  );
  const latency = perceivedLatencyLabel(conn);

  return (
    <span className="model-conn-chip" role="status" aria-live="polite">
      <Badge tone={conn.tone} dot title={conn.detail}>{conn.label}</Badge>
      {latency && <span className="model-conn-latency" title="지각 반응 지표(TTFT 우선)">{latency}</span>}
      <InfoTip>
        {mock
          ? "현재 mock 모드입니다 — 실제 추론 모델에 연결되지 않았고, 결과는 결정적 mock 데이터입니다. 실 연결은 VITE_MOCK=off + 설정 · 관리의 로컬 모델 카드로 구성합니다."
          : "설정된 로컬 추론 엔드포인트의 /health(200) 와 /v1/models(로드 모델)를 주기적으로 확인합니다. green=연결·amber=지연/모델 불일치·red=오프라인. 지연은 TTFT(time-to-first-token) 우선 표기합니다."}
      </InfoTip>
    </span>
  );
}
