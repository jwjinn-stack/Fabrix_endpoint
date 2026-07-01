// IMP-82 — 로컬 추론 모델(Dynamo) 연결 상태.
//
// AiAgent·클러스터 인사이트는 "로컬 모델(Dynamo)"을 근거로 결과를 낸다고 표기하지만, 사용자는
// 어떤 엔드포인트/모델에 붙었는지·살아있는지(health)·느린지(TTFT/지연)를 알 방법이 없었다.
// 이 모듈은 그 표면을 정직하게 만든다:
//   - **정직 최우선**: 기본(mock)은 절대 "연결됨"으로 위장하지 않는다 — 무채색 "mock 모델"로 표기.
//   - 실경로(VITE_MOCK=off)면 GET {endpoint}/health(200 기대) + GET {endpoint}/v1/models 로
//     구성 모델 id 를 실제로 확인한다("연결됐으나 다른 모델" 가드). read-only·저비용.
//   - 상태 판정은 순수 함수(resolveConnState)로 분리해 단위 테스트로 가드(하드코딩 아님).
//   - 새 의존성 0개(fetch/AbortSignal.timeout·localStorage 만). 응답 본문은 로깅하지 않는다.
//
// vLLM/Dynamo 의 OpenAI-호환 층이 노출하는 canonical 표면(/health 200 → /v1/models 열거)에 정합.

// ── 설정(localStorage 영속) — theme.tsx loadBrand/saveBrand 패턴 미러 ──────────
export interface ModelConnConfig {
  endpoint: string; // 로컬 추론 서버 base URL(예: http://localhost:8000). 시크릿 아님(config).
  model: string;    // 구성 모델 식별자(/v1/models 의 id 와 대조). 비면 첫 모델 수용.
  timeoutMs: number; // 프로브 타임아웃(느린 모델 서버 대비).
}

const STORE_KEY = "fabrix.modelConn";

// 기본값 — 정직히 "미구성"(빈 endpoint). mock 이 기본이므로 실 연결 대상이 없음을 그대로 둔다.
export const DEFAULT_MODEL_CONFIG: ModelConnConfig = { endpoint: "", model: "", timeoutMs: 8000 };

// Dynamo OpenAI-호환 추론 서비스 프리셋(harbor 배포 관례상 별도 :8000 서비스).
export const DYNAMO_PRESET: ModelConnConfig = { endpoint: "http://localhost:8000", model: "", timeoutMs: 8000 };

export function loadModelConfig(): ModelConnConfig {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_MODEL_CONFIG };
    const s = JSON.parse(raw) as Partial<ModelConnConfig>;
    return {
      endpoint: typeof s.endpoint === "string" ? s.endpoint : "",
      model: typeof s.model === "string" ? s.model : "",
      timeoutMs: typeof s.timeoutMs === "number" && Number.isFinite(s.timeoutMs) && s.timeoutMs > 0 ? s.timeoutMs : 8000,
    };
  } catch {
    return { ...DEFAULT_MODEL_CONFIG }; // 파싱 실패 graceful — 기본값.
  }
}

export function saveModelConfig(cfg: ModelConnConfig): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
  } catch { /* ignore(사파리 프라이빗 등) */ }
}

// mock 모드 여부 — main.tsx 의 mock 설치 규약과 동형(VITE_MOCK !== "off" 면 mock).
// import.meta.env 는 vite 전용이라 방어적으로 접근(테스트/SSR 안전).
export function isMockMode(): boolean {
  try {
    return (import.meta as { env?: { VITE_MOCK?: string } }).env?.VITE_MOCK !== "off";
  } catch {
    return true; // 알 수 없으면 정직하게 mock 로 간주(실연결로 위장 금지).
  }
}

// ── 프로브 결과 & 상태 판정 ───────────────────────────────────────────────────
export interface ProbeResult {
  healthOk: boolean;       // GET /health 200?
  models: string[];        // /v1/models 의 id 목록(본문은 저장하지 않음 — id 만)
  resolvedModel: string | null; // 구성 model 이 목록에 있으면 그것, 없고 목록이 있으면 첫 id
  modelMatch: boolean;     // 구성 model 이 실제 목록에 존재하는가("다른 모델" 가드)
  latencyMs: number;       // 프로브 왕복 지연(perceived-latency proxy)
  ttftMs: number | null;   // TTFT(있으면 우선 노출) — 프로브는 스트리밍이 아니라 보통 null
  error?: string;          // 실패 사유(사용자 메시지용, 원문 본문 아님)
}

export type ConnState = "mock" | "online" | "degraded" | "offline";
export type ConnTone = "neutral" | "green" | "amber" | "red";

export interface ResolvedConn {
  state: ConnState;
  tone: ConnTone;         // Badge 톤(색 비의존 — dot+텍스트와 함께 사용)
  label: string;          // 칩 본문(정직 표기)
  detail: string;         // hover/보조 설명
  model: string | null;   // 해석된 모델명
  latencyMs: number | null;
  ttftMs: number | null;
  perceivedMs: number | null; // 노출용 — ttft 우선, 없으면 latency
}

// TTFT 목표 <1s(스트리밍 지각-반응). 프로브 왕복은 그보다 관대(모델 서버 콜드/큐 대비).
export const TTFT_DEGRADED_MS = 1000;
export const LATENCY_DEGRADED_MS = 2000;

// 순수 판정 — probe(있으면)와 config 로 상태/톤/라벨을 결정한다. mock 이면 probe 무시(정직).
// **정직성 불변식**: mock 은 절대 green/"연결됨"이 될 수 없다.
export function resolveConnState(
  probe: ProbeResult | null,
  config: ModelConnConfig,
  mock = isMockMode(),
): ResolvedConn {
  // (0) mock — 최우선. 실제 모델에 연결되지 않음을 정직히 표기.
  if (mock) {
    return {
      state: "mock",
      tone: "neutral",
      label: "mock 모델",
      detail: "mock 모드 — 실제 추론 모델에 연결되지 않았습니다. (VITE_MOCK=off 로 실 연결)",
      model: null,
      latencyMs: null,
      ttftMs: null,
      perceivedMs: null,
    };
  }

  // (1) 프로브 이전(로딩) 또는 endpoint 미구성 — 아직 판정 불가(offline 로 위장하지 않음).
  if (!config.endpoint.trim()) {
    return {
      state: "offline",
      tone: "neutral",
      label: "미구성",
      detail: "로컬 모델 엔드포인트가 설정되지 않았습니다. 설정 · 관리에서 등록하세요.",
      model: null, latencyMs: null, ttftMs: null, perceivedMs: null,
    };
  }
  if (!probe) {
    return {
      state: "offline",
      tone: "neutral",
      label: "확인 중…",
      detail: "연결 상태를 확인하는 중입니다.",
      model: null, latencyMs: null, ttftMs: null, perceivedMs: null,
    };
  }

  const perceived = probe.ttftMs != null ? probe.ttftMs : probe.latencyMs;

  // (2) offline — health 실패.
  if (!probe.healthOk) {
    return {
      state: "offline",
      tone: "red",
      label: "오프라인",
      detail: probe.error ? `health 프로브 실패: ${probe.error}` : "health 프로브가 200 을 반환하지 않았습니다.",
      model: probe.resolvedModel, latencyMs: probe.latencyMs, ttftMs: probe.ttftMs, perceivedMs: perceived,
    };
  }

  // (3) degraded — "연결됐으나 다른 모델"(구성 model 이 목록에 없음) 가드.
  if (config.model.trim() && !probe.modelMatch) {
    return {
      state: "degraded",
      tone: "amber",
      label: "모델 불일치",
      detail: `연결은 됐으나 구성 모델(${config.model})이 /v1/models 목록에 없습니다. 서버 로드 모델: ${probe.models.join(", ") || "(없음)"}`,
      model: probe.resolvedModel, latencyMs: probe.latencyMs, ttftMs: probe.ttftMs, perceivedMs: perceived,
    };
  }

  // (4) degraded — 지연 임계(TTFT 우선). 목표 <1s.
  const slow = (probe.ttftMs != null && probe.ttftMs >= TTFT_DEGRADED_MS)
    || (probe.ttftMs == null && probe.latencyMs >= LATENCY_DEGRADED_MS);
  if (slow) {
    return {
      state: "degraded",
      tone: "amber",
      label: "지연",
      detail: `연결됨이나 응답이 느립니다(${probe.ttftMs != null ? `TTFT ${probe.ttftMs}ms` : `왕복 ${probe.latencyMs}ms`}). 목표 TTFT <1s.`,
      model: probe.resolvedModel, latencyMs: probe.latencyMs, ttftMs: probe.ttftMs, perceivedMs: perceived,
    };
  }

  // (5) online — health 200 + 모델 확인 + 지연 정상.
  return {
    state: "online",
    tone: "green",
    label: probe.resolvedModel ? `연결됨 · ${probe.resolvedModel}` : "연결됨",
    detail: `엔드포인트 ${config.endpoint} · health 200 · 모델 ${probe.resolvedModel ?? "(미해석)"}`,
    model: probe.resolvedModel, latencyMs: probe.latencyMs, ttftMs: probe.ttftMs, perceivedMs: perceived,
  };
}

// 노출용 지연 문자열(TTFT 우선). 없으면 빈 문자열.
export function perceivedLatencyLabel(r: ResolvedConn): string {
  if (r.perceivedMs == null) return "";
  return r.ttftMs != null ? `TTFT ${r.ttftMs}ms` : `${r.latencyMs}ms`;
}

// ── 실 프로브(VITE_MOCK=off 실경로) ──────────────────────────────────────────
// GET {endpoint}/health(200 기대) + GET {endpoint}/v1/models(로드 모델 열거). read-only·저비용.
// 실패(non-200/네트워크/타임아웃)는 throw 하지 않고 healthOk=false 로 정직 리포트한다(칩이 죽지 않음).
// 응답 **본문은 저장/로깅하지 않는다** — /v1/models 에서 id 문자열만 추출.
function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  return `${b}${path}`;
}

export async function probeModel(config: ModelConnConfig, signal?: AbortSignal): Promise<ProbeResult> {
  const timeoutMs = config.timeoutMs > 0 ? config.timeoutMs : 8000;
  const t0 = Date.now();
  // 외부 취소 + 타임아웃 합성(client.ts getJSON 견고성 패턴과 동형).
  const withTimeout = () => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  };

  // (1) /health — 200 이면 healthOk.
  let healthOk = false;
  let error: string | undefined;
  try {
    const res = await fetch(joinUrl(config.endpoint, "/health"), { signal: withTimeout() });
    healthOk = res.ok; // 200~299
    if (!healthOk) error = `health ${res.status}`;
  } catch (e) {
    error = (e as Error).name === "TimeoutError" ? "타임아웃" : "네트워크 오류";
    return { healthOk: false, models: [], resolvedModel: null, modelMatch: false, latencyMs: Date.now() - t0, ttftMs: null, error };
  }

  // (2) /v1/models — 로드 모델 열거(id 만 추출, 본문 미저장). health 실패해도 참고로 시도하지 않음.
  let models: string[] = [];
  if (healthOk) {
    try {
      const res = await fetch(joinUrl(config.endpoint, "/v1/models"), { signal: withTimeout() });
      if (res.ok) {
        const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
        models = Array.isArray(body.data)
          ? body.data.map((m) => (typeof m.id === "string" ? m.id : "")).filter((id): id is string => !!id)
          : [];
      } else {
        error = `models ${res.status}`;
      }
    } catch (e) {
      error = (e as Error).name === "TimeoutError" ? "타임아웃(models)" : "네트워크 오류(models)";
    }
  }

  const latencyMs = Date.now() - t0;
  const wanted = config.model.trim();
  const modelMatch = wanted ? models.includes(wanted) : models.length > 0;
  const resolvedModel = wanted && models.includes(wanted) ? wanted : (models[0] ?? null);

  return { healthOk, models, resolvedModel, modelMatch, latencyMs, ttftMs: null, error };
}
