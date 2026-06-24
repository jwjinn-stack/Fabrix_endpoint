import type {
  APIKeyView,
  ChatMessage,
  ChatResponse,
  DashboardOverview,
  Endpoint,
  EndpointPreview,
  EndpointSpec,
  EnginePipeline,
  EvalResult,
  GPUReport,
  GPUTimeseries,
  GuardAuditReport,
  GuardPolicy,
  GuardVerdict,
  HarborModel,
  HarborStatus,
  ImportResult,
  IssuedKey,
  ModelCatalog,
  ModelMetricsReport,
  OrgTree,
  ProxyStats,
  ThirdPartyCred,
  TimeRange,
  Timeseries,
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

async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(apiPath(path), { signal });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      detail = body.error ? `: ${body.error}` : "";
    } catch {
      /* 본문 파싱 실패는 무시 */
    }
    throw new Error(`API ${res.status}${detail}`);
  }
  return (await res.json()) as T;
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
