// Go API(internal/domain) 응답과 1:1 대응하는 타입.

// Capabilities 는 GET /api/v1/capabilities 응답 — 배포 프로파일과 활성 기능 집합.
// 프론트는 부팅 시 이를 받아 NAV·버튼·페이지 접근을 토글한다(backend 의 capability.Set 과 대응).
export interface Capabilities {
  profile: string; // "observe" | "manage"
  readonly: boolean; // mutating cap 이 전무하면 true (관제 전용)
  capabilities: Record<string, boolean>; // 예: { "endpoints.write": false, "traces": true, ... }
  data_source: string; // "mock" | "live"
  integrations: Record<string, boolean>; // k8s/store/langfuse/guard/audit/harbor 연동 여부
}

// 연동 진단 — GET /api/v1/diagnostics. 외부 의존성 능동 프로브 결과(실사이트 연동·디버깅용).

// 실패 원인 분류 — 조치가 종류마다 다름(백엔드 diag.Kind* 와 1:1).
export type FailKind =
  | "ok" | "dns_fail" | "conn_refused" | "tls_fail"
  | "auth_fail" | "timeout" | "bad_status" | "unreachable";

// 단계별 타이밍(HTTP 프로브) — DNS→TCP→TLS→TTFB 분해(ms). 비-HTTP 프로브는 없음.
export interface DiagTiming {
  dns_ms: number;
  connect_ms: number;
  tls_ms: number;
  ttfb_ms: number;
  server_ms: number; // TTFB - (dns+connect+tls) ≈ 서버 처리
  total_ms: number;
  reused: boolean; // keep-alive 재사용
}

// TLS 인증서/세션 정보(https) — 사내 인증서 만료·CA 디버깅.
export interface DiagTLS {
  version: string;
  cipher: string;
  subject: string;
  issuer: string;
  not_after: string;
  days_left: number;
}

// 추세(sparkline)용 1회 측정.
export interface DiagSample {
  at: string;
  reachable: boolean;
  latency_ms: number;
  fail_kind?: FailKind;
}

// 이 프로브가 API 에 실제로 보내는 요청 명세(코드와 1:1) — 클릭 시 "무슨 요청인지" 확인.
export interface ProbeRequest {
  method: string; // GET|POST|SQL|TCP|EXEC|S3
  target: string; // /api/v2.0/projects?page_size=1 또는 SELECT 1
  auth?: string; // Basic|Bearer|none|...
  body?: string; // POST 본문 미리보기
  expect?: string; // 기대 응답
}

// 단일 라이브 재프로브("지금 테스트")의 실제 요청/응답 캡처(마스킹). HTTP 프로브에만.
export interface ProbeTrace {
  req_method?: string;
  req_url?: string;
  req_headers?: Record<string, string>;
  req_body?: string;
  status_code?: number;
  http_version?: string;
  resp_headers?: Record<string, string>;
  resp_body?: string;
}

export interface DiagStatus {
  name: string;
  title: string;
  category: string;
  endpoint: string;
  configured: boolean;
  reachable: boolean;
  latency_ms: number;
  error?: string;
  optional: boolean;
  required_by: string[];
  fallback_note?: string;
  // 통신 디버깅 상세(능동 프로브 시)
  request?: ProbeRequest;
  probe?: ProbeTrace; // 실제 요청/응답 캡처(단일 재프로브)
  fail_kind?: FailKind;
  remote_addr?: string; // 실제 연결된 IP:port
  timing?: DiagTiming;
  tls?: DiagTLS;
  details?: Record<string, unknown>; // verbose 심층 진단
  history?: DiagSample[];
}
export interface DiagSummary {
  total: number;
  configured: number;
  reachable: number;
  degraded: number; // configured 인데 unreachable (실제 문제)
}

// 파드 레벨 네트워크/설정 점검 — env→호스트 해석 + 이름 해석(CoreDNS).
export interface DiagHostCheck {
  name: string;
  env_key: string;
  scheme?: string;
  host?: string;
  port?: string;
  resolved?: string[]; // 해석된 IP
  latency_ms: number;
  error?: string;
  proxy_via?: string; // 프록시 경유 위험 경고
}
export interface DiagNetwork {
  in_cluster: boolean;
  api_server?: string;
  kube_dns: string[];
  search_domains: string[];
  http_proxy?: string;
  https_proxy?: string;
  no_proxy?: string;
  proxy_warnings?: string[];
  hosts: DiagHostCheck[];
}

export interface DiagReport {
  generated_at: string;
  profile: string;
  verbose: boolean;
  summary: DiagSummary;
  network?: DiagNetwork;
  checks: DiagStatus[];
}

// 셀프-reconfigure (A1) — 화면에서 연동 설정 편집 → ConfigMap patch + rollout restart.
export interface ConfigField {
  key: string;
  env_key: string;
  label: string;
  value: string;
  kind: "url" | "enum" | "text";
  options?: string[];
  warnings?: string[]; // 린트 경고(저장은 가능, 안내만)
}
export interface ConfigView {
  editable: boolean; // 재구성 가능(kubectl + self-identity 구성됨)
  reason?: string; // 불가 사유
  namespace: string;
  config_map: string;
  deployment: string;
  fields: ConfigField[];
}
export interface ConfigStatus {
  phase: "idle" | "reconfiguring" | "ready" | "failed";
  message: string;
  replicas?: number;
  ready?: number;
  updated?: number;
}

// 마스킹 정책 — 게이트웨이 글루가 Langfuse ingestion 전 캡처/마스킹에 적용(고객사별 편집).
export type CaptureMode = "none" | "masked" | "full";
export type MaskAction = "keep" | "mask" | "hash" | "remove";
export interface MaskRule {
  type: string; // rrn|phone|email|account|card|name|address|...
  label: string;
  action: MaskAction;
}
export interface MaskingPolicy {
  version: string;
  enabled: boolean;
  capture_input: CaptureMode;
  capture_output: CaptureMode;
  blocked_capture: CaptureMode; // 차단건 보존(빈값이면 input/output 따름)
  rules: MaskRule[];
  updated_at?: string;
}

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
  est_cost_krw?: number; // 추정 비용(토큰×모델 단가) — 비용 투명성
}

export interface UsageReport {
  range: TimeRange;
  generated_at: string;
  group_by: string;
  rows: UsageRow[];
}

// 메트릭 차원 groupby(L2) — GET /api/v1/metrics/dimensions / breakdown.
export interface MetricDimension {
  key: string; // model | endpoint | namespace
  label: string; // 실제 Prometheus 라벨
  title: string; // 화면 표시명
}

// 메트릭 카탈로그(C2) — AI grounding + UI 툴팁/이상강조 공용 메타데이터.
export interface MetricMeta {
  key: string; // MetricsBreakdownRow 필드 키
  title: string;
  unit: string; // ms | req/s | ratio | tokens | count
  lower_better: boolean; // 낮을수록 좋음(latency 류)
  desc: string;
  related?: string[];
  warn_above?: number;
  warn_below?: number;
}

export interface MetricsBreakdownRow {
  key: string; // 차원 값
  requests: number;
  qps: number;
  ttft_p95_ms: number;
  itl_avg_ms: number;
  e2e_p95_ms: number;
  cache_hit_rate: number;
  prompt_tokens: number;
  completion_tokens: number;
  // 이상 판정(C6) — 백엔드 domain.AnnotateWarnings 단일 출처. UI 셀 강조에 사용.
  warn?: boolean;
  warn_keys?: string[];
  warn_reasons?: string[];
}

export interface MetricsBreakdown {
  range: TimeRange;
  generated_at: string;
  dimension: string;
  label: string;
  rows: MetricsBreakdownRow[];
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
  errors?: Record<string, number>; // HTTP 에러 코드별 건수 (400/401/404/429/500) — Analytics Errors 매핑
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
  // P4-6+ 카탈로그 메타 표준화 (Together AI 모델 카드 매핑)
  features: string[]; // Chat | JSON | Tool | Vision | Embedding | Rerank
  price_in: number; // 입력 1M 토큰당 원
  price_out: number; // 출력 1M 토큰당 원
  price_cached: number; // 캐시 적중 입력 1M 토큰당 원
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

// 차단/표시된 프롬프트 원문 — Langfuse GUARDRAIL observation 의 input/output 에서 조회.
// FABRIX 자체 증적(ClickHouse)은 비식별·마스킹이라 원문이 없으므로, 원문은 Langfuse 에서 lazy 로 가져온다.
export interface GuardContent {
  trace_id: string;
  captured: boolean; // 앱/프록시가 Langfuse observation.input 에 원문을 계측했는지.
                     // Semantic Router 는 원문을 보존하지 않으므로(구현가능성-검증 §2-3),
                     // 미계측이면 원문 없음 → graceful 안내.
  input: string; // 차단된 프롬프트 원문 (GUARDRAIL observation input). captured=false 면 빈 문자열.
  output: { blocked: boolean; reason: string; category: string }; // 차단 결정(메타데이터는 SR 헤더/OTel 로 항상 확보)
  masked: boolean; // Langfuse 마스킹 정책 적용 여부
  source: string; // langfuse
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

// 아웃바운드 알림 채널 설정(IMP-15). webhook URL 원문은 응답에 노출하지 않음(configured 불리언만).
export interface AlertConfig {
  enabled: boolean; // profile 게이트(manage=true, observe=false)
  webhook_configured: boolean;
  audit: AlertSendRecord[];
}

export interface AlertSendRecord {
  ts: string;
  channel: string;
  event: string;
  token: string; // 해시(평문 키 아님)
  ok: boolean;
  reason?: string;
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
  auto_shutdown?: string; // off | 15m | 30m | 1h | 3h | 6h | 12h | 24h (유휴 자동 종료 → 비용 절감)
  speculative?: boolean; // speculative decoding(초안 모델) 사용 — TTFT/throughput 개선
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

// ───────────── 분산 트레이스 (Langfuse 정합 / 하이브리드) ─────────────
// 방식 B: LLM 토큰·비용·프롬프트·가드레일/검색은 Langfuse, 서빙 내부(prefill/decode 등)는 victoria-traces.
// span kind 는 type 기반 색코딩(Langfuse/Phoenix 패턴). 자세한 설계: docs/langfuse-trace-정합-설계.md
//
// Langfuse observation type 10종 (2025-08 확장) — langfuse-source 스팬.
export type LangfuseObsType =
  | "generation" | "span" | "event" | "agent" | "tool"
  | "chain" | "retriever" | "embedding" | "evaluator" | "guardrail";
// 서빙 내부 스팬 (victoria-traces / OTel) — Langfuse 에는 없는 vLLM/Dynamo 내부 구간.
export type ServingSpanKind = "proxy" | "router" | "queue" | "prefill" | "decode" | "network";
export type SpanKind = LangfuseObsType | ServingSpanKind;
// 스팬 출처: langfuse=토큰/비용/프롬프트/가드레일, otel=victoria-traces 서빙 내부.
export type SpanSource = "langfuse" | "otel";

// ── 평가 점수 (Langfuse Scores 정합) — backend domain.Score 와 1:1 ──
// 개별 trace/observation/session 에 '부착'되는 품질 점수. numeric|categorical|boolean.
export type ScoreDataType = "numeric" | "categorical" | "boolean";
export type ScoreSource = "human" | "llm-judge" | "api";
export interface Score {
  name: string;
  value: number; // numeric=점수, boolean=0|1, categorical=string_value 사용
  string_value?: string; // categorical 라벨
  data_type: ScoreDataType;
  comment?: string; // 채점 근거(사람/LLM 텍스트 — escape 렌더)
  source: ScoreSource;
  trace_id: string;
  observation_id?: string; // observation-level(특정 span)
  session_id?: string;
  ts: string;
}

export interface TraceSpan {
  span_id: string;
  parent_id?: string;
  name: string;
  kind: SpanKind;
  source: SpanSource;
  start_ms: number; // 트레이스 시작 기준 offset
  duration_ms: number;
  status: "ok" | "error";
  level?: "DEFAULT" | "WARNING" | "ERROR"; // Langfuse observation level
  model?: string; // generation 스팬의 providedModelName
  cost_krw?: number; // generation 스팬의 서버측 비용(Langfuse totalCost)
  // 파생 구간 표시: vLLM 은 요청당 단일 llm_request span 만 emit 하고 prefill/decode/queue 는
  // 그 span 의 속성(gen_ai.latency.time_in_model_prefill 등)이다. 별도 span 이 아니라
  // worker span 속성을 구간 분해해 표시하는 것이므로 derived=true 로 구분(구현가능성-검증 §2-1).
  derived?: boolean;
  // OTel GenAI 속성명 그대로 (gen_ai.*) + Langfuse usageDetails/costDetails. 표시는 key/value 그대로.
  attributes: Record<string, string | number | boolean>;
  scores?: Score[]; // observation-level 평가 점수(특정 span 에 부착)
}

export interface TraceSummary {
  trace_id: string;
  ts: string;
  model: string;
  endpoint: string;
  app_id: string;
  dept_id: string;
  api_key_id: string;
  total_ms: number;
  ttft_ms: number; // gen_ai.response.time_to_first_chunk
  queue_ms: number;
  decode_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  tokens_per_sec: number;
  // 비용: Langfuse Worker 서버측 계산값 (costDetails/totalCost). 클라 계산 아님.
  total_cost_krw: number;
  input_cost_krw: number;
  output_cost_krw: number;
  // Langfuse 귀속 차원
  user_id?: string;
  session_id?: string;
  route?: string; // metadata.route
  status: "ok" | "error";
  decision: GuardDecision;
  finish_reason: string; // stop | length | content_filter
  http_status: number;
  stream: boolean;
  scores?: Score[]; // trace 에 부착된 평가 점수(품질 시계열)
}

export interface TraceListReport {
  range: TimeRange;
  generated_at: string;
  traces: TraceSummary[];
  source: string;
}

export interface TraceDetail {
  summary: TraceSummary;
  spans: TraceSpan[];
  input_preview: string;
  output_preview: string;
}

// ───────────── 세션 (Langfuse Sessions — sessionId 로 묶인 멀티턴 대화) ─────────────
export interface SessionTurn {
  trace_id: string;
  ts: string;
  model: string;
  ttft_ms: number;
  total_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_krw: number;
  decision: GuardDecision;
  status: "ok" | "error";
  user_preview: string; // 사용자 발화 미리보기
}
export interface SessionSummary {
  session_id: string;
  started_at: string;
  last_at: string;
  turns: number;
  app_id: string;
  dept_id: string;
  user_id: string;
  models: string[];
  total_tokens: number;
  total_cost_krw: number;
  blocked: number;
  duration_ms: number; // 세션 시작~끝 경과
  // 세션-레벨 지연 롤업(Helicone/Datadog 패턴) — 비용·토큰은 위 기존 필드.
  ttft_p50_ms: number; // 턴 TTFT 중앙값
  ttft_avg_ms: number; // 턴 TTFT 평균
  latency_p50_ms: number; // 턴 E2E(total_ms) 중앙값
}
export interface SessionListReport {
  range: TimeRange;
  generated_at: string;
  sessions: SessionSummary[];
  source: string;
}
export interface SessionDetail {
  summary: SessionSummary;
  turns: SessionTurn[];
  scores?: Score[]; // 세션 단위 평가 점수
}
