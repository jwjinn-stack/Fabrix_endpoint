// Go API(internal/domain) 응답과 1:1 대응하는 타입.

export type TimeRange = "1h" | "6h" | "24h" | "7d";

export interface TrafficCard {
  qps: number;
  running: number;
  waiting: number;
  success_rate: number; // 0..1
}

export interface QualityCard {
  ttft_p50_ms: number;
  ttft_p95_ms: number;
  itl_avg_ms: number;
  cache_hit_rate: number; // 0..1
}

export interface GuardrailCard {
  blocked: number;
  pii: number;
  jailbreak: number;
  flagged: number;
}

export interface GPUCard {
  usage_perc: number; // 0..1
  kv_cache_perc: number; // 0..1
  mig_efficiency: number; // 0..1
}

export interface DeptUsage {
  dept_id: string;
  name: string;
  percent: number; // 0..1
}

export interface AppUsage {
  app_id: string;
  percent: number; // 0..1
}

export type AlarmSeverity = "info" | "warning" | "critical";

export interface Alarm {
  severity: AlarmSeverity;
  message: string;
}

// 추론 지연 3분할 (P4-1, Grafana vLLM): TTFT/TPOT/E2E 각 p50/p95/p99.
export interface LatencyBreakdown {
  ttft_p50_ms: number; ttft_p95_ms: number; ttft_p99_ms: number;
  tpot_p50_ms: number; tpot_p95_ms: number; tpot_p99_ms: number;
  e2e_p50_ms: number; e2e_p95_ms: number; e2e_p99_ms: number;
}

export interface SchedulerState {
  running: number;
  waiting: number;
  queue_p95_ms: number;
  kv_cache_perc: number; // 0..1
}

export interface TokenBreakdown {
  prompt_tokens: number;
  cached_tokens: number; // prompt 중 prefix 캐시 적중분
  completion_tokens: number;
}

export interface RankRow {
  key: string;
  label: string;
  requests: number;
  tokens: number;
}

export interface DashboardOverview {
  range: TimeRange;
  generated_at: string;
  traffic: TrafficCard;
  quality: QualityCard;
  guardrail: GuardrailCard;
  gpu: GPUCard;
  latency: LatencyBreakdown;
  scheduler: SchedulerState;
  tokens: TokenBreakdown;
  dept_usage: DeptUsage[];
  app_usage: AppUsage[];
  top_endpoints: RankRow[];
  top_keys: RankRow[];
  alarms: Alarm[];
}

export interface TimePoint {
  ts: string;
  qps: number;
  ttft_p95_ms: number;
  tpot_p95_ms: number;
  e2e_p95_ms: number;
  running: number;
  waiting: number;
  blocked: number;
}

export interface Timeseries {
  range: TimeRange;
  points: TimePoint[];
}

export interface UsageRow {
  dept_id?: string;
  app_id?: string;
  api_key_id?: string;
  model: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  ttft_p95_ms: number;
  itl_avg_ms: number;
}

export interface UsageReport {
  range: TimeRange;
  generated_at: string;
  group_by: string;
  rows: UsageRow[];
}

export interface UsageTrendPoint {
  ts: string;
  requests: number;
  tokens: number;
}
export interface UsageTrend {
  range: TimeRange;
  generated_at: string;
  bucket_sec: number;
  points: UsageTrendPoint[];
}

export interface GPUDevice {
  hostname: string;
  gpu: string;
  uuid: string;
  model: string;
  util_perc: number;
  mem_used_mb: number;
  mem_total_mb: number;
  mem_perc: number;
  temp_c: number;
  power_w: number;
  sm_active: number;
  tensor_active: number;
  mig_efficiency: number;
}

export interface GPUReport {
  generated_at: string;
  summary: {
    total_gpus: number;
    avg_util: number;
    avg_mem: number;
    total_power_w: number;
    avg_mig_eff: number;
    hosts: number;
    idle_alloc_gap: number; // VRAM 점유인데 util<10% = 유휴 할당 갭 GPU 수
    mig_enabled: boolean;
  };
  devices: GPUDevice[];
  source: string;
}

export interface GPUPoint {
  ts: string;
  util: number; // 0..1
  mem: number; // 0..1
  temp_c: number;
  power_w: number;
}

export interface GPUTimeseries {
  uuid: string;
  hostname: string;
  points: GPUPoint[];
  mig_partitioned: boolean;
  source: string;
}

export interface ProxyStats {
  window_sec: number;
  total: number;
  blocked: number;
  allowed: number;
  block_rate: number;
  avg_guard_ms: number;
  avg_upstream_ms: number;
  p95_upstream_ms: number;
  overhead_perc: number;
  by_model: Record<string, number>;
  qpm: number;
}

// P4-3 엔진 파이프라인 분해 (queue→prefill→decode 색분할)
export interface PipelineStage {
  name: string;
  avg_ms: number;
  kind: string; // proxy | route | queue | prefill | decode | network
}
export interface EnginePipeline {
  stages: PipelineStage[];
  queue_ms: number;
  prefill_ms: number;
  decode_ms: number;
  total_ms: number;
  has_traces: boolean;
  source: string;
}

export interface HarborModel {
  name: string;
  project: string;
  full_ref: string;
  tags: string[];
  artifacts: number;
  pulls: number;
  size_bytes: number;
  updated_at: string;
}

// P4-6 모델 카드 운영 메트릭
export interface ModelMetric {
  model: string;
  display_name: string;
  serving: string;
  pattern: string; // agg | disagg | vllm
  context_window: number;
  gpu: number;
  tok_s: number;
  ttft_p95_ms: number;
  e2e_p95_ms: number;
  requests: number;
  deployed: boolean;
  status: string;
}
export interface ModelMetricsReport {
  generated_at: string;
  models: ModelMetric[];
  source: string;
}

export interface HarborStatus {
  enabled: boolean;
  reachable?: boolean;
  registry?: string;
  projects?: string[];
  model_count?: number;
}

export interface ImportResult {
  manifest: string;
  job_name: string;
  applied: boolean;
  cli_hint: string;
}

export interface EvalResult {
  model: string;
  judge_model: string;
  prompt: string;
  response: string;
  score: number; // 0..5 (0=차단)
  rationale: string;
  latency_ms: number;
  guard?: GuardVerdict;
}

export interface User {
  user_id: string;
  email: string;
  name: string;
  role: string; // admin | user | super
  dept_id: string;
  status: string; // active | disabled
  created_at: string;
}

export type ModelType = "chat" | "vision" | "embedding" | "rerank";

export interface ModelInfo {
  id: string;
  display_name: string;
  provider: string;
  type: ModelType;
  context_window: number;
  serving: string;
  namespace: string;
  status: string; // ready | unreachable | unknown
  playground: boolean;
}

export interface ModelCatalog {
  generated_at: string;
  models: ModelInfo[];
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export type GuardDecision = "allowed" | "blocked" | "flagged";

export interface PIIEntity {
  type: string;
  confidence: number;
}

export interface GuardVerdict {
  decision: GuardDecision;
  guard_types: string[];
  pii_entities?: PIIEntity[];
  jb_confidence: number;
  category?: string;
  reason?: string;
  latency_ms: number;
  policy_version: string;
}

export interface ChatResponse {
  model: string;
  content: string;
  prompt_tokens: number;
  completion_tokens: number;
  latency_ms: number;
  tokens_per_sec: number;
  guard?: GuardVerdict;
}

export interface GuardAuditRow {
  event_id: string;
  ts: string;
  trace_id: string;
  user_ref: string;
  dept_id: string;
  app_id: string;
  api_key_id: string;
  model: string;
  decision: GuardDecision;
  guard_types: string[];
  pii_subtypes: string[];
  jb_confidence: number;
  policy_version: string;
  masked_sample: string;
  http_status: number; // P4-9 SIEM 표준 컬럼(403=차단/200=통과)
  latency_ms: number; // P4-9 가드레일 판정 지연
}

export interface GuardSummary {
  checked: number;
  blocked: number;
  pii: number;
  jailbreak: number;
  flagged: number;
}

export interface GuardAuditReport {
  range: TimeRange;
  generated_at: string;
  summary: GuardSummary;
  rows: GuardAuditRow[];
  source: string; // clickhouse | unavailable
}

export interface PolicyRule {
  enabled: boolean;
  action: "block" | "flag";
}

export interface GuardPolicy {
  pii: PolicyRule;
  jailbreak: PolicyRule;
  secrets: PolicyRule;
}

export interface APIKeyView {
  api_key_id: string;
  app_id: string;
  app_name: string;
  dept_id?: string;
  name: string;
  model_scope: string;
  key_prefix: string;
  quota_rpm?: number;
  quota_tpd?: number;
  alert_threshold?: number; // 0..1 (예산의 N%에서 경고)
  enabled: boolean;
  created_at: string;
  revoked_at?: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  tokens_today: number; // 오늘 누적(예산 하드캡 기준)
  est_cost_krw: number; // 추정 비용(범위 기간)
}

export interface IssuedKey {
  api_key_id: string;
  app_id: string;
  plaintext: string;
  key_prefix: string;
}

export interface Endpoint {
  name: string;
  namespace: string;
  model?: string;
  ready: boolean;
  backend: string;
  replicas: number;
  app_id?: string;
  dept_id?: string;
  managed: boolean;
  age?: string;
}

export interface EndpointSpec {
  name: string;
  namespace?: string;
  model: string;
  served_name?: string;
  pattern: string; // agg | agg_router | disagg
  replicas: number;
  gpu: number;
  max_model_len?: number;
  app_id?: string;
  dept_id?: string;
  harbor_ref?: string; // 있으면 Harbor 에서 모델 pull(initContainer)
  access?: string; // cluster(기본·ClusterIP) | nodeport(외부 노드포트)
}

export interface ThirdPartyCred {
  kind: string; // hf | ngc
  name: string; // 토큰/키 이름
  masked: string; // 값 마스킹(예: hf_****vQF)
  set: boolean; // 값 설정 여부
}

export interface EndpointPreview {
  manifest: string;
  dry_run_ok: boolean;
  dry_run_result?: string;
  dry_run_error?: string;
}

// 조직·귀속 트리 (부서 → 앱 → 키 + 부서별 사용자)
export interface OrgKey {
  api_key_id: string;
  name: string;
  key_prefix: string;
  enabled: boolean;
}
export interface OrgApp {
  app_id: string;
  name: string;
  dept_id: string;
  keys: OrgKey[];
}
export interface OrgMember {
  user_id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}
export interface OrgDept {
  dept_id: string; // "" = 미귀속
  apps: OrgApp[];
  members: OrgMember[];
}
export interface OrgTree {
  depts: OrgDept[];
  known_depts: string[];
}
