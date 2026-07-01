import type {
  APIKeyView,
  Capabilities,
  ConfigStatus,
  ConfigView,
  DiagReport,
  DiagStatus,
  ChatMessage,
  ChatResponse,
  DashboardOverview,
  Endpoint,
  EndpointPreview,
  EndpointSpec,
  EnginePipeline,
  EvalResult,
  EvalDataset,
  EvalDatasetItem,
  Experiment,
  ExperimentConfig,
  GPUReport,
  GPUTimeseries,
  GuardAuditReport,
  GuardContent,
  GuardPolicy,
  GuardVerdict,
  MaskingPolicy,
  MetricDimension,
  MetricMeta,
  MetricsBreakdown,
  HarborModel,
  HarborStatus,
  ImportResult,
  IssuedKey,
  AlertConfig,
  Incident,
  IncidentList,
  AlertRule,
  AlertRulesResponse,
  AlertRulePreview,
  AlertMetric,
  AlertWindow,
  ModelCatalog,
  ModelMetricsReport,
  NetworkReport,
  NodeMetrics,
  ObjectType,
  LinkKind,
  OntologyObjectList,
  OntologyLinkList,
  OrgTree,
  TopologyGraph,
  ProxyStats,
  ThirdPartyCred,
  TimeRange,
  Timeseries,
  Score,
  SessionDetail,
  SessionListReport,
  TraceDetail,
  TraceListReport,
  UsageReport,
  UsageTrend,
  User,
} from "./types";

// 개발: vite 프록시가 /api → :8080 으로 전달. 배포: 동일 오리진 가정.
const BASE = "/api/v1";

function apiPath(path: string): string {
  if (typeof window === "undefined") return `${BASE}${path}`;
  const origin = window.location.origin && window.location.origin !== "null"
    ? window.location.origin
    : "http://localhost:8080";
  return new URL(`${BASE}${path}`, origin).toString();
}

// GET 전송 계층 견고성(IMP-16). 폴링형 관제 콘솔이 느린/플랩 백엔드에 무한 대기·단발 실패하지
// 않도록 타임아웃 + 멱등 재시도를 둔다. SWR/TanStack(IMP-8) 도입 시 재시도 책임은 그쪽으로 이관.
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RETRY = 2; // 총 3시도. 폴링 다음 틱과 겹치지 않게 작게.
const BASE_BACKOFF_MS = 300;

function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    // 외부 취소 신호 + 시도별 타임아웃을 합성(둘 중 먼저 발화하면 abort). 외부 signal 의 취소 의미 보존.
    const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const res = await fetch(apiPath(path), { signal: composed });
      if (!res.ok) {
        let detail = "";
        try {
          const body = (await res.json()) as { error?: string };
          detail = body.error ? `: ${body.error}` : "";
        } catch {
          /* 본문 파싱 실패는 무시 */
        }
        // 5xx·429 만 일시 오류로 재시도. 4xx 클라이언트 오류는 즉시 throw.
        if (isRetriableStatus(res.status) && attempt < MAX_RETRY) {
          lastErr = new Error(`API ${res.status}${detail}`);
          await sleep(BASE_BACKOFF_MS * 3 ** attempt + Math.floor(Math.random() * 100));
          continue;
        }
        throw new Error(`API ${res.status}${detail}`);
      }
      return (await res.json()) as T;
    } catch (e) {
      // 호출부가 명시적으로 취소한 경우(외부 signal abort)는 재시도 없이 즉시 중단.
      if (signal?.aborted) throw e;
      // 네트워크 오류·타임아웃 abort 는 일시 오류로 간주해 재시도(여유 있으면).
      lastErr = e;
      if (attempt < MAX_RETRY) {
        await sleep(BASE_BACKOFF_MS * 3 ** attempt + Math.floor(Math.random() * 100));
        continue;
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("API 요청 실패");
}

// 배포 프로파일·기능 집합. 부팅 시 1회 받아 NAV·버튼·접근을 토글한다.
export function fetchCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  return getJSON<Capabilities>(`/capabilities`, signal);
}

// ── FABRIX MCP(읽기 전용 AI 연동) — JSON-RPC 2.0 over POST /api/v1/mcp ──
// UI(IMP-5)가 백엔드 mcp.go 와 드리프트하지 않도록 tool/resource 카탈로그를 LIVE 로 받는다.
export interface McpTool { name: string; description?: string; inputSchema?: unknown }
export interface McpResource { uri: string; name?: string; description?: string; mimeType?: string }

interface RpcResponse<T> { jsonrpc?: string; id?: unknown; result?: T; error?: { code: number; message: string } }

// JSON-RPC 한 번 호출. cap-off(라우트 미등록 → 404/405)·네트워크·rpc 오류는 throw → 호출부 fallback.
async function mcpRpc<T>(method: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(apiPath(`/mcp`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }),
    signal,
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const body = (await res.json()) as RpcResponse<T>;
  if (body.error) throw new Error(`MCP ${body.error.code}: ${body.error.message}`);
  if (body.result === undefined) throw new Error("MCP: 빈 응답");
  return body.result;
}

export async function mcpListTools(signal?: AbortSignal): Promise<McpTool[]> {
  const r = await mcpRpc<{ tools?: McpTool[] }>("tools/list", signal);
  return r.tools ?? [];
}

export async function mcpListResources(signal?: AbortSignal): Promise<McpResource[]> {
  const r = await mcpRpc<{ resources?: McpResource[] }>("resources/list", signal);
  return r.resources ?? [];
}

// 외부 의존성 능동 프로브 결과(연동 상태). 실사이트 연동·디버깅용.
// verbose=true 면 클라이언트별 심층 진단(Details, 추가 왕복)까지 수집한다.
export function fetchDiagnostics(signal?: AbortSignal, verbose = false): Promise<DiagReport> {
  return getJSON<DiagReport>(verbose ? `/diagnostics?verbose=1` : `/diagnostics`, signal);
}

// 셀프-reconfigure(A1) — 편집 가능 연동 설정 조회.
export function fetchConfig(signal?: AbortSignal): Promise<ConfigView> {
  return getJSON<ConfigView>(`/config`, signal);
}

// 재구성 진행 상태(롤아웃) 폴링.
export function fetchConfigStatus(signal?: AbortSignal): Promise<ConfigStatus> {
  return getJSON<ConfigStatus>(`/config/status`, signal);
}

// 단일 의존성 라이브 재프로브("지금 테스트") — read-only, 양 프로파일 공통.
export function probeOne(name: string, signal?: AbortSignal): Promise<DiagStatus> {
  return getJSON<DiagStatus>(`/diagnostics/${encodeURIComponent(name)}`, signal);
}

// 설정 저장 → ConfigMap patch + rollout restart(비동기 202). 검증 실패 시 e.fields 에 항목별 사유.
export async function saveConfig(
  fields: Record<string, string>,
): Promise<{ phase: string; message: string; changed?: string[] }> {
  const res = await fetch(apiPath(`/config`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    let detail = "";
    let fieldErrs: Record<string, string> | undefined;
    try {
      const b = (await res.json()) as { error?: string; fields?: Record<string, string> };
      detail = b.error ? `: ${b.error}` : "";
      fieldErrs = b.fields;
    } catch {
      /* ignore */
    }
    const e = new Error(`API ${res.status}${detail}`) as Error & { fields?: Record<string, string> };
    if (fieldErrs) e.fields = fieldErrs;
    throw e;
  }
  return (await res.json()) as { phase: string; message: string; changed?: string[] };
}

export function fetchOverview(range: TimeRange, signal?: AbortSignal): Promise<DashboardOverview> {
  return getJSON<DashboardOverview>(`/dashboard/overview?range=${range}`, signal);
}

export function fetchTimeseries(range: TimeRange, signal?: AbortSignal): Promise<Timeseries> {
  return getJSON<Timeseries>(`/dashboard/timeseries?range=${range}`, signal);
}

export function fetchUsage(range: TimeRange, groupBy = "model", signal?: AbortSignal): Promise<UsageReport> {
  const q = new URLSearchParams({ range, group_by: groupBy });
  return getJSON<UsageReport>(`/usage?${q.toString()}`, signal);
}

// 메트릭 차원 groupby(L2). dim ∈ /metrics/dimensions 의 key(model|endpoint|namespace).
export function fetchMetricsBreakdown(range: TimeRange, dim = "model", signal?: AbortSignal): Promise<MetricsBreakdown> {
  const q = new URLSearchParams({ range, dim });
  return getJSON<MetricsBreakdown>(`/metrics/breakdown?${q.toString()}`, signal);
}

// 메트릭 차원/카탈로그는 거의 정적 → 모듈 레벨 캐시로 마운트마다 재요청 방지(IMP-8).
let _dimsCache: Promise<{ dimensions: MetricDimension[]; metrics: MetricMeta[] }> | null = null;
export function fetchMetricDimensions(_signal?: AbortSignal): Promise<{ dimensions: MetricDimension[]; metrics: MetricMeta[] }> {
  if (!_dimsCache) {
    // 정적 카탈로그라 1회만 받아 캐시. 실패 시 캐시 비워 재시도 허용(abort 는 불필요).
    _dimsCache = getJSON<{ dimensions: MetricDimension[]; metrics: MetricMeta[] }>(`/metrics/dimensions`).catch((e) => {
      _dimsCache = null;
      throw e;
    });
  }
  return _dimsCache;
}

export function fetchUsageTrend(range: TimeRange, signal?: AbortSignal): Promise<UsageTrend> {
  return getJSON<UsageTrend>(`/usage/trend?range=${range}`, signal);
}

export function fetchModels(signal?: AbortSignal): Promise<ModelCatalog> {
  return getJSON<ModelCatalog>(`/models`, signal);
}

export function fetchModelMetrics(signal?: AbortSignal): Promise<ModelMetricsReport> {
  return getJSON<ModelMetricsReport>(`/models/metrics`, signal);
}

export function fetchGuardAudit(
  range: TimeRange,
  filters?: { decision?: string; type?: string },
  signal?: AbortSignal,
): Promise<GuardAuditReport> {
  const q = new URLSearchParams({ range });
  if (filters?.decision && filters.decision !== "all") q.set("decision", filters.decision);
  if (filters?.type && filters.type !== "all") q.set("type", filters.type);
  return getJSON<GuardAuditReport>(`/guard/audit?${q.toString()}`, signal);
}

export interface GuardStatus {
  enforcing: boolean;
  audit_enabled: boolean;
  policy_version: string;
  worm_enabled: boolean;
  worm_count: number;
  worm_bucket: string;
}

export function fetchGuardStatus(signal?: AbortSignal): Promise<GuardStatus> {
  return getJSON<GuardStatus>(`/guard/status`, signal);
}

export function fetchGuardPolicy(signal?: AbortSignal): Promise<GuardPolicy> {
  return getJSON<GuardPolicy>(`/guard/policy`, signal);
}

// 차단 프롬프트 원문 — Langfuse GUARDRAIL observation 에서 lazy 조회(민감 데이터라 명시적 호출).
export function fetchGuardContent(traceId: string, signal?: AbortSignal): Promise<GuardContent> {
  return getJSON<GuardContent>(`/guard/content?trace_id=${encodeURIComponent(traceId)}`, signal);
}

// 마스킹 정책 — 게이트웨이 글루가 폴링해 ingestion 전 적용. 설정 화면에서 편집.
export function fetchMaskingPolicy(signal?: AbortSignal): Promise<MaskingPolicy> {
  return getJSON<MaskingPolicy>(`/masking/policy`, signal);
}

export async function setMaskingPolicy(policy: MaskingPolicy): Promise<MaskingPolicy> {
  const res = await fetch(`${BASE}/masking/policy`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(policy),
  });
  if (!res.ok) {
    let detail = "";
    try { const b = (await res.json()) as { error?: string }; detail = b.error ? `: ${b.error}` : ""; } catch { /* ignore */ }
    throw new Error(`API ${res.status}${detail}`);
  }
  return (await res.json()) as MaskingPolicy;
}

export async function setGuardPolicy(policy: GuardPolicy): Promise<GuardPolicy> {
  const res = await fetch(`${BASE}/guard/policy`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(policy),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as GuardPolicy;
}

export async function classifyGuard(text: string): Promise<GuardVerdict> {
  const res = await fetch(`${BASE}/guard/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as GuardVerdict;
}

export function fetchKeys(range = "24h", signal?: AbortSignal): Promise<{ keys: APIKeyView[] }> {
  return getJSON<{ keys: APIKeyView[] }>(`/keys?range=${range}`, signal);
}

export async function issueKey(body: {
  app_id?: string;
  app_name: string;
  dept_id?: string;
  key_name: string;
  model_scope?: string;
  quota_rpm?: number;
  quota_tpd?: number;
  alert_threshold?: number;
  notify_on_alert?: boolean;
}): Promise<IssuedKey> {
  const res = await fetch(`${BASE}/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as IssuedKey;
}

export async function revokeKey(id: string): Promise<void> {
  const res = await fetch(`${BASE}/keys/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API ${res.status}`);
}

// 아웃바운드 알림(IMP-15) — 채널 구성 상태/발송 이력 조회 + Webhook URL 등록.
export async function fetchAlertConfig(signal?: AbortSignal): Promise<AlertConfig> {
  const res = await fetch(`${BASE}/alerts/config`, { signal });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as AlertConfig;
}

export async function setAlertWebhook(url: string): Promise<{ webhook_configured: boolean; warnings?: string[] }> {
  const res = await fetch(`${BASE}/alerts/webhook`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    let msg = `API ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return (await res.json()) as { webhook_configured: boolean; warnings?: string[] };
}

// 알림 인시던트 라이프사이클(IMP-38) — 인박스 조회 + ack/resolve/snooze.
export function fetchIncidents(
  filter?: { state?: string; severity?: string },
  signal?: AbortSignal,
): Promise<IncidentList> {
  const qs = new URLSearchParams();
  if (filter?.state) qs.set("state", filter.state);
  if (filter?.severity) qs.set("severity", filter.severity);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return getJSON<IncidentList>(`/incidents${suffix}`, signal);
}

async function incidentAction(id: string, action: string, body?: unknown): Promise<Incident> {
  const res = await fetch(`${BASE}/incidents/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `API ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  const j = (await res.json()) as { incident: Incident };
  return j.incident;
}

export function ackIncident(id: string): Promise<Incident> {
  return incidentAction(id, "ack");
}

export function resolveIncident(id: string): Promise<Incident> {
  return incidentAction(id, "resolve");
}

export function snoozeIncident(id: string, minutes: number): Promise<Incident> {
  return incidentAction(id, "snooze", { minutes });
}

// 지표 기반 알림 룰(IMP-36) — 목록·preview 는 읽기, CRUD 는 manage. 발송은 IMP-15 디스패처 재사용.
export async function fetchAlertRules(signal?: AbortSignal): Promise<AlertRulesResponse> {
  const res = await fetch(`${BASE}/alerts/rules`, { signal });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as AlertRulesResponse;
}

export async function fetchAlertRulePreview(metric: AlertMetric, window: AlertWindow, signal?: AbortSignal): Promise<AlertRulePreview> {
  const res = await fetch(`${BASE}/alerts/rules/preview?metric=${encodeURIComponent(metric)}&window=${encodeURIComponent(window)}`, { signal });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as AlertRulePreview;
}

function alertRuleError(res: Response): Promise<never> {
  return res.json().then(
    (j: { error?: string }) => { throw new Error(j.error || `API ${res.status}`); },
    () => { throw new Error(`API ${res.status}`); },
  );
}

export async function createAlertRule(rule: Partial<AlertRule>): Promise<AlertRule> {
  const res = await fetch(`${BASE}/alerts/rules`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rule),
  });
  if (!res.ok) return alertRuleError(res);
  return (await res.json()) as AlertRule;
}

export async function updateAlertRule(id: string, rule: Partial<AlertRule>): Promise<AlertRule> {
  const res = await fetch(`${BASE}/alerts/rules/${encodeURIComponent(id)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rule),
  });
  if (!res.ok) return alertRuleError(res);
  return (await res.json()) as AlertRule;
}

export async function deleteAlertRule(id: string): Promise<void> {
  const res = await fetch(`${BASE}/alerts/rules/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw new Error(`API ${res.status}`);
}

export async function playgroundChat(
  model: string,
  messages: ChatMessage[],
  opts?: { maxTokens?: number; temperature?: number },
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/playground/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: opts?.maxTokens ?? 256,
      temperature: opts?.temperature,
    }),
    signal,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const b = (await res.json()) as { error?: string };
      detail = b.error ? `: ${b.error}` : "";
    } catch {
      /* ignore */
    }
    throw new Error(`API ${res.status}${detail}`);
  }
  return (await res.json()) as ChatResponse;
}

export function fetchEndpoints(signal?: AbortSignal): Promise<{ endpoints: Endpoint[]; available: boolean }> {
  return getJSON<{ endpoints: Endpoint[]; available: boolean }>(`/endpoints`, signal);
}

export function fetchGPU(signal?: AbortSignal): Promise<GPUReport> {
  return getJSON<GPUReport>(`/gpu`, signal);
}

export function fetchGPUTimeseries(uuid: string, signal?: AbortSignal): Promise<GPUTimeseries> {
  return getJSON<GPUTimeseries>(`/gpu/timeseries?uuid=${encodeURIComponent(uuid)}`, signal);
}

// 토폴로지·노드·네트워크(IMP-55 데이터 계층) — 후속 화면(IMP-45/46/49)이 소비.
export function fetchTopology(signal?: AbortSignal): Promise<TopologyGraph> {
  return getJSON<TopologyGraph>(`/topology`, signal);
}

export function fetchNodeMetrics(host: string, range: TimeRange = "1h", signal?: AbortSignal): Promise<NodeMetrics> {
  const q = new URLSearchParams({ host, range });
  return getJSON<NodeMetrics>(`/nodes/metrics?${q.toString()}`, signal);
}

export function fetchNetwork(range: TimeRange = "1h", signal?: AbortSignal): Promise<NetworkReport> {
  return getJSON<NetworkReport>(`/network?range=${range}`, signal);
}

// 온톨로지(IMP-56) — Object/Link 그래프. type/filter 로 명사를 추리고, id 로 관계를 traverse.
export function fetchOntologyObjects(type?: ObjectType, filter?: string, signal?: AbortSignal): Promise<OntologyObjectList> {
  const q = new URLSearchParams();
  if (type) q.set("type", type);
  if (filter && filter.trim()) q.set("filter", filter.trim());
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return getJSON<OntologyObjectList>(`/ontology/objects${suffix}`, signal);
}

export function fetchOntologyLinks(id: string, kind?: LinkKind, signal?: AbortSignal): Promise<OntologyLinkList> {
  const q = new URLSearchParams();
  if (kind) q.set("kind", kind);
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return getJSON<OntologyLinkList>(`/ontology/objects/${encodeURIComponent(id)}/links${suffix}`, signal);
}

export function fetchHarborModels(signal?: AbortSignal): Promise<{ models: HarborModel[]; available: boolean }> {
  return getJSON<{ models: HarborModel[]; available: boolean }>(`/harbor/models`, signal);
}

export function fetchHarborStatus(signal?: AbortSignal): Promise<HarborStatus> {
  return getJSON<HarborStatus>(`/harbor/status`, signal);
}

export async function harborImport(body: { source: string; model_id: string; project?: string; apply: boolean }): Promise<ImportResult> {
  const res = await fetch(`${BASE}/harbor/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = "";
    try { const b = (await res.json()) as { error?: string }; detail = b.error ? `: ${b.error}` : ""; } catch { /* ignore */ }
    throw new Error(`API ${res.status}${detail}`);
  }
  return (await res.json()) as ImportResult;
}

export function fetchProxyStats(window = 300, signal?: AbortSignal): Promise<ProxyStats> {
  return getJSON<ProxyStats>(`/proxy/stats?window=${window}`, signal);
}

export function fetchEnginePipeline(signal?: AbortSignal): Promise<EnginePipeline> {
  return getJSON<EnginePipeline>(`/proxy/pipeline`, signal);
}

export function fetchTraces(
  range: TimeRange,
  filters?: { decision?: string; status?: string; model?: string; app?: string; q?: string },
  signal?: AbortSignal,
): Promise<TraceListReport> {
  const sp = new URLSearchParams({ range });
  for (const k of ["decision", "status", "model", "app"] as const) {
    const v = filters?.[k];
    if (v && v !== "all") sp.set(k, v);
  }
  // IMP-32: q 는 가산적 전문검색(빈 문자열은 생략 = 기존 동작). 서버가 화이트리스트 필드만 검색.
  const qv = filters?.q?.trim();
  if (qv) sp.set("q", qv);
  return getJSON<TraceListReport>(`/traces?${sp.toString()}`, signal);
}

export function fetchTrace(traceId: string, signal?: AbortSignal): Promise<TraceDetail> {
  return getJSON<TraceDetail>(`/traces/${encodeURIComponent(traceId)}`, signal);
}

export function fetchSessions(range: TimeRange, app?: string, signal?: AbortSignal): Promise<SessionListReport> {
  const q = new URLSearchParams({ range });
  if (app && app !== "all") q.set("app", app);
  return getJSON<SessionListReport>(`/sessions?${q.toString()}`, signal);
}

export function fetchSession(sessionId: string, signal?: AbortSignal): Promise<SessionDetail> {
  return getJSON<SessionDetail>(`/sessions/${encodeURIComponent(sessionId)}`, signal);
}

// IMP-18: 라이브 trace 에 평가 점수를 부착(Langfuse scores). source=llm-judge|human|api.
export async function recordScore(
  traceId: string,
  body: { name: string; value: number; data_type: Score["data_type"]; comment?: string; source: Score["source"]; string_value?: string; observation_id?: string; session_id?: string },
): Promise<Score> {
  const res = await fetch(`${BASE}/traces/${encodeURIComponent(traceId)}/scores`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try { const b = (await res.json()) as { error?: string }; detail = b.error ? `: ${b.error}` : ""; } catch { /* ignore */ }
    throw new Error(`API ${res.status}${detail}`);
  }
  return (await res.json()) as Score;
}

export function fetchCredentials(signal?: AbortSignal): Promise<{ credentials: ThirdPartyCred[]; available: boolean }> {
  return getJSON<{ credentials: ThirdPartyCred[]; available: boolean }>(`/credentials`, signal);
}

export async function setCredential(body: { kind: string; name: string; value: string }): Promise<void> {
  const res = await fetch(`${BASE}/credentials`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = "";
    try { const b = (await res.json()) as { error?: string }; detail = b.error ? `: ${b.error}` : ""; } catch { /* ignore */ }
    throw new Error(`API ${res.status}${detail}`);
  }
}

export async function runEval(body: { model: string; judge_model?: string; prompt: string; criteria?: string }): Promise<EvalResult> {
  const res = await fetch(`${BASE}/eval/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as EvalResult;
}

// ── eval suite (IMP-39) — 데이터셋·실험·회귀 비교 ──
export function fetchDatasets(signal?: AbortSignal): Promise<{ datasets: EvalDataset[] }> {
  return getJSON<{ datasets: EvalDataset[] }>(`/eval/datasets`, signal);
}

export async function createDataset(body: { name: string; items: EvalDatasetItem[] }): Promise<EvalDataset> {
  const res = await fetch(`${BASE}/eval/datasets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = "";
    try { const b = (await res.json()) as { error?: string }; detail = b.error ? `: ${b.error}` : ""; } catch { /* ignore */ }
    throw new Error(`API ${res.status}${detail}`);
  }
  return (await res.json()) as EvalDataset;
}

export function fetchExperiments(signal?: AbortSignal): Promise<{ experiments: Experiment[] }> {
  return getJSON<{ experiments: Experiment[] }>(`/eval/experiments`, signal);
}

export async function runExperiment(body: { dataset_id: string; config: ExperimentConfig }): Promise<Experiment> {
  const res = await fetch(`${BASE}/eval/experiments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = "";
    try { const b = (await res.json()) as { error?: string }; detail = b.error ? `: ${b.error}` : ""; } catch { /* ignore */ }
    throw new Error(`API ${res.status}${detail}`);
  }
  return (await res.json()) as Experiment;
}

export function fetchUsers(signal?: AbortSignal): Promise<{ users: User[]; roles: string[] }> {
  return getJSON<{ users: User[]; roles: string[] }>(`/users`, signal);
}

export function fetchOrg(signal?: AbortSignal): Promise<OrgTree> {
  return getJSON<OrgTree>(`/org`, signal);
}

export async function setAppDept(appId: string, deptId: string): Promise<void> {
  const res = await fetch(`${BASE}/apps/${encodeURIComponent(appId)}/dept`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dept_id: deptId }),
  });
  if (!res.ok) {
    let detail = "";
    try { const b = (await res.json()) as { error?: string }; detail = b.error ? `: ${b.error}` : ""; } catch { /* ignore */ }
    throw new Error(`API ${res.status}${detail}`);
  }
}

export async function createUser(body: { email: string; name: string; role: string; dept_id: string }): Promise<User> {
  const res = await fetch(`${BASE}/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as User;
}

export async function updateUser(id: string, body: { role: string; dept_id: string; status: string }): Promise<void> {
  const res = await fetch(`${BASE}/users/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`API ${res.status}`);
}

export async function deleteUser(id: string): Promise<void> {
  const res = await fetch(`${BASE}/users/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API ${res.status}`);
}

export async function previewEndpoint(spec: EndpointSpec): Promise<EndpointPreview> {
  const res = await fetch(`${BASE}/endpoints/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as EndpointPreview;
}

export async function createEndpoint(spec: EndpointSpec, apply: boolean): Promise<{ result: string; applied: boolean }> {
  const res = await fetch(`${BASE}/endpoints?apply=${apply}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const b = (await res.json()) as { error?: string };
      detail = b.error ? `: ${b.error}` : "";
    } catch {
      /* ignore */
    }
    throw new Error(`API ${res.status}${detail}`);
  }
  return (await res.json()) as { result: string; applied: boolean };
}

export interface EndpointLogs {
  logs: string;
  components: string[];
  ok: boolean;
  error?: string;
}

export function fetchEndpointLogs(ns: string, name: string, component = "", tail = 200, signal?: AbortSignal): Promise<EndpointLogs> {
  const q = new URLSearchParams({ tail: String(tail) });
  if (component) q.set("component", component);
  return getJSON<EndpointLogs>(`/endpoints/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/logs?${q.toString()}`, signal);
}

export async function deleteEndpoint(ns: string, name: string): Promise<void> {
  const res = await fetch(`${BASE}/endpoints/${ns}/${name}`, { method: "DELETE" });
  if (!res.ok) {
    let detail = "";
    try {
      const b = (await res.json()) as { error?: string };
      detail = b.error ? `: ${b.error}` : "";
    } catch {
      /* ignore */
    }
    throw new Error(`API ${res.status}${detail}`);
  }
}
