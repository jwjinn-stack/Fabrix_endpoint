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

// ── 풀-피델리티 GPU 하드웨어 필드 (IMP-76 track A) ──
// DCGM 확정 필드셋(deep-research 검증). 경쟁자(DCGM Exporter/Run:ai/Datadog)가 노출하는
// 하드웨어 근본원인 신호 — XID·throttle reason·NVLink/PCIe·ECC·clock — 를 온톨로지 GpuDevice 에 부착.
// 괄호 안은 실제 DCGM field id. 실 수집은 IMP-79 spike(일부 opt-in) — 지금은 mock 결정적 생성.

// NVLink 링크별/집계 throughput + 오류 카운터 (DCGM_FI_DEV_NVLINK_* 400–445).
export interface NvlinkStats {
  throughput_kibs: number[]; // 링크 L0–L5 throughput (KiB/s) — NVLINK_BANDWIDTH_L0..L5
  total_kibs: number;        // 합계(NVLINK_BANDWIDTH_TOTAL, default-on)
  crc_errors: number;        // CRC 오류 누적(count)
  replay_errors: number;     // replay 오류 누적(count)
  recovery_errors: number;   // recovery 오류 누적(count)
}

// PCIe throughput + replay (DCGM_FI_PROF_PCIE_TX/RX_BYTES 1009/1010, REPLAY_COUNTER 202).
export interface PcieStats {
  tx_bytes: number;      // 송신 누적 bytes
  rx_bytes: number;      // 수신 누적 bytes
  replay_counter: number; // PCIe replay(count, default-on)
}

// ECC 오류 (DCGM_FI_DEV_ECC_SBE/DBE_VOL/AGG_TOTAL 310–313). SBE=정정가능, DBE=정정불가.
export interface EccStats {
  sbe_volatile: number;  // single-bit, volatile(재부팅 리셋)
  dbe_volatile: number;  // double-bit, volatile
  sbe_aggregate: number; // single-bit, aggregate(영구 누적)
  dbe_aggregate: number; // double-bit, aggregate
}

// per-process GPU 사용 (DCGM_FI_DEV_PROCESS_ACCOUNTING_STATS 205 — accounting 활성 필요).
// DCGM 은 time-sharing/MIG 에서 per-process 귀속 제약이 있어 대표 프로세스만 표시(spec note).
export interface GpuProcess {
  pid: number;
  name: string;       // 프로세스 이름(escape 렌더)
  mem_used_mb: number; // 이 프로세스가 점유한 VRAM(MiB)
}

// GPU 하드웨어 상세 — GPUDevice.hw 로 옵션 부착(additive; 레거시/실백엔드 미제공 시 undefined).
export interface GpuHardware {
  sm_clock_mhz: number;   // DCGM_FI_DEV_SM_CLOCK (100)
  mem_clock_mhz: number;  // DCGM_FI_DEV_MEM_CLOCK (101)
  // 최근 XID 코드 1개 — DCGM_FI_DEV_XID_ERRORS(230)는 "가장 최근 코드"만 담는 gauge(카운터/스트림 아님).
  // 0 = 최근 XID 없음. 라벨은 xidLabel(code) 로. 전체 이력은 dmesg/kubelet 파싱 필요(out of scope).
  xid_recent: number;
  // clock-throttle 사유 비트마스크 — DCGM_FI_DEV_CLOCKS_EVENT_REASONS(112). 0 = 제약 없음.
  // decodeClocksEventReasons(mask) 로 사람이 읽는 reason 리스트로 디코드.
  clocks_event_reasons: number;
  nvlink: NvlinkStats;
  pcie: PcieStats;
  ecc: EccStats;
  processes: GpuProcess[];
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
  hw?: GpuHardware; // 풀-피델리티 하드웨어 상세(IMP-76). 옵션 — 미제공 시 하드웨어 섹션 미렌더.
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

// ── eval suite (IMP-39) — 데이터셋·실험·회귀 비교. backend server.Eval* 와 1:1 ──
export interface EvalDatasetItem {
  id: string;
  input: string;
  expected_output?: string; // OPTIONAL — reference-free 허용(golden answer 강제 금지)
  criteria?: string;        // 케이스별 채점 기준(선택)
  metadata?: string;
}
export interface EvalDataset {
  id: string;
  name: string;
  version: number;
  items: EvalDatasetItem[];
  created_at: string;
  updated_at: string;
}
export interface ExperimentConfig {
  model: string;
  judge_model: string;
  prompt_version?: string;
  criteria: string;
}
export interface ExperimentCaseResult {
  item_id: string;
  input: string;
  response: string;
  score: number; // 0..5 (0=차단/실패)
  rationale: string;
  blocked: boolean;
}
export interface Experiment {
  id: string;
  dataset_id: string;
  dataset_name: string;
  dataset_version: number;
  config: ExperimentConfig; // pinned config snapshot
  cases: ExperimentCaseResult[];
  mean_score: number;
  pass_rate: number;
  created_at: string;
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

// 알림 인시던트 라이프사이클(IMP-38) — OnCall/PagerDuty 모델.
export type IncidentState = "triggered" | "acked" | "resolved" | "snoozed";

export interface IncidentOccurrence {
  ts: string;
}

export interface IncidentAuditEntry {
  ts: string;
  from: IncidentState;
  to: IncidentState;
  by: string;
  note?: string;
}

export interface Incident {
  id: string;
  dedup_key: string;
  severity: AlarmSeverity;
  title: string;
  state: IncidentState;
  first_seen: string;
  last_seen: string;
  count: number;
  occurrences?: IncidentOccurrence[];
  acked_by?: string;
  resolved_by?: string;
  silenced_until?: string;
  note?: string;
  audit?: IncidentAuditEntry[];
}

export interface IncidentList {
  incidents: Incident[];
  counts: Record<string, number>; // triggered|acked|resolved|snoozed → count
}

// 지표 기반 알림 룰(IMP-36). latency/error/block 임계 알림. 발송은 IMP-15 디스패처 재사용.
export type AlertMetric = "ttft_p95" | "latency_avg" | "error_rate" | "block_rate" | "throughput" | "count";
export type AlertOp = "gt" | "gte" | "lt" | "lte";
export type AlertWindow = "5m" | "1h" | "1d";
export type AlertRuleState = "OK" | "WARNING" | "ALERT" | "NO_DATA" | "PAUSED";

export interface AlertRule {
  id: string;
  name: string;
  metric: AlertMetric;
  op: AlertOp;
  alert_threshold: number;
  warn_threshold?: number;
  window: AlertWindow;
  severity: "info" | "warning" | "critical";
  no_data_mode?: "no_data" | "treat_as_zero" | "hold_previous";
  recovery_window?: number;
  renotify_min?: number;
  enabled: boolean;
  state?: AlertRuleState;
  last_value?: number;
  created_at?: string;
}

export interface AlertMetricMeta {
  key: AlertMetric;
  title: string;
  unit: string;
  lower_better: boolean;
}

export interface AlertRulesResponse {
  rules: AlertRule[];
  metrics: AlertMetricMeta[];
  enabled?: boolean; // 발송 가능(manage) 여부
}

export interface AlertRulePreview {
  metric: AlertMetric;
  window: AlertWindow;
  value: number;
  has_data: boolean;
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

// ───────────── 토폴로지·노드·네트워크 (IMP-55 — 데이터 계층 팩토리) ─────────────
// 임계 상태는 단일 출처(mockFactory.statusFromThresholds) — GPU tempColor/gpuStatus 와 통일.
export type NodeStatus = "ok" | "warn" | "crit";

// 토폴로지 그래프 노드. server=GPU 노드 호스트, service=엔드포인트/서빙, gpu=개별 GPU 디바이스.
export interface TopologyNode {
  id: string;
  kind: "server" | "service" | "gpu";
  status: NodeStatus;
  label: string;
  metrics?: Record<string, number>; // 노드 요약 지표(util·qps 등) — 화면 툴팁/셀 강조용
}
// 방향 엣지. from→to 흐름. qps·error_rate 는 서비스 간 호출 링크에만.
export interface TopologyEdge {
  from: string;
  to: string;
  qps?: number;
  error_rate?: number; // 0..1
}
export interface TopologyGraph {
  generated_at: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  source: string;
}

// 노드 골든시그널(USE 세트) 시계열 — host 별. 큐레이션(전량 아님):
// utilization = cpu/mem/disk util, saturation = load/swap/disk-io, errors/traffic = net err/rx/tx.
export interface NodePoint {
  ts: string;
  cpu_util: number; // 0..1
  mem_util: number; // 0..1
  disk_util: number; // 0..1
  load1: number; // 1분 load average (saturation)
  swap_used_perc: number; // 0..1 (saturation)
  disk_io_perc: number; // 0..1 (saturation)
  net_rx_mbps: number; // traffic
  net_tx_mbps: number; // traffic
  net_err_per_s: number; // errors
}
export interface NodeMetrics {
  generated_at: string;
  host: string;
  status: NodeStatus; // 최신 지표 기준 파생(단일 출처)
  points: NodePoint[];
  source: string;
}

// 네트워크 링크 시계열 — 노드/스위치 간 링크. 대역폭·지연·손실·에러.
export interface NetworkPoint {
  ts: string;
  rx_mbps: number;
  tx_mbps: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  loss_perc: number; // 0..1 패킷 손실률
  errs_per_s: number;
}
export interface NetworkLink {
  id: string;
  from: string;
  to: string;
  status: NodeStatus; // 최신 지연/손실 기준 파생(단일 출처)
  capacity_mbps: number;
  points: NetworkPoint[];
}
export interface NetworkReport {
  generated_at: string;
  links: NetworkLink[];
  source: string;
}

// ───────────── 온톨로지 데이터 모델 (IMP-56 — Palantir Foundry Object/Link/Action) ─────────────
// docs/palantir-ontology-analysis.md §5.1–5.3 을 그대로 반영. 화면별 응답 타입(위)이 각 화면에 갇혀 있는
// 것을 넘어, 도메인을 명사(Object)·관계(Link)·동사(Action)로 표현하는 공용 계약(common contract) 계층.
// 단일 출처: 온톨로지는 기존 Model/Endpoint/Service/GpuDevice/Node/Trace/Incident mock 을 승격해 파생한다.

// §5.1 Object Types (명사) — 현실 엔티티를 디지털로 매핑.
export type ObjectType = "Model" | "Endpoint" | "Service" | "GpuDevice" | "Node" | "Trace" | "Incident";

// §5.2 Link Types (관계 그래프) — 트러블슈팅 척추:
//   Service --consumes--> Endpoint --serves--> Model --runsOn--> GpuDevice --hostedBy--> Node
//   Trace --routedTo--> Endpoint · Trace --executedOn--> GpuDevice · Incident --affects--> {any object}
export type LinkKind = "serves" | "runsOn" | "hostedBy" | "routedTo" | "executedOn" | "consumes" | "affects";

// 온톨로지 공통 상태 렌즈 — 기존 NodeStatus(ok|warn|crit) + unknown(미배포/미측정). 소스에서 파생(단일 출처).
export type ObjectStatus = "ok" | "warn" | "crit" | "unknown";

// 온톨로지 객체 — Property 는 소스별 payload(props). revision 은 미래 Action writeback 의 stale-write(409)
// 낙관적 동시성 경로를 지금 열어두기 위한 필드(IMP-59). 객체가 바뀔 때마다 증가.
export interface OntologyObject<T = Record<string, unknown>> {
  id: string;
  type: ObjectType;
  title: string;
  props: T;
  status: ObjectStatus;
  revision: number;
}

// 방향 엣지(from→to). linkKind 로 §5.2 관계를 구분.
export interface OntologyLink {
  from: string;
  to: string;
  linkKind: LinkKind;
}

// §5.3 Action Types (동사 — 제어). name=Action 식별자, target=대상 Object Type,
// params=사용자 입력 폼, requiredCap=capability 게이팅(§2 Submission Criteria), sideEffects=알림/audit 등.
export interface ActionParam {
  name: string;
  kind: "text" | "number" | "enum" | "object";
  required: boolean;
  options?: string[]; // enum 후보
}
export interface ActionType {
  name: string;
  target: ObjectType;
  params: ActionParam[];
  requiredCap?: string; // 예: models.write (없으면 기본 허용)
  sideEffects: string[]; // 예: ["audit", "알림"]
}

// §2 Submission Criteria 판정 결과 — ok=false 면 reason(기계판독 사유)으로 "disabled + why" 무료 획득.
export interface SubmissionCheck {
  ok: boolean;
  reason?: string;
}

// Action(writeback) audit 라인(IMP-59) — IncidentAuditEntry 를 일반화. 어떤 verb 든 동일 계약으로 기록.
// outcome: ok=반영됨, conflict=stale revision(409), denied=capability 거부(403), error=기타.
export type ActionOutcome = "ok" | "conflict" | "denied" | "error";
export interface ActionAuditEntry {
  actionType: string;      // verb 이름(scaleReplicas 등)
  target: string;          // 대상 Object id
  params: Record<string, unknown>;
  actor: string;           // 실행 주체(mock=operator)
  ts: string;
  outcome: ActionOutcome;
  note?: string;
}

// 단일 mutation 계약 응답(IMP-59) — mock/실백엔드 동일. object=reconcile 대상 canonical 객체.
export interface ActionResult {
  outcome: ActionOutcome;
  object?: OntologyObject;   // 성공 시 갱신된 canonical 객체(provisional 을 이걸로 수렴)
  audit: ActionAuditEntry;
  reason?: string;           // 실패(denied/conflict) 사유 — 기계판독
}

// 응답 래퍼 — GET /ontology/objects, GET /ontology/objects/:id/links.
export interface OntologyObjectList {
  generated_at: string;
  objects: OntologyObject[];
  source: string;
}
export interface OntologyLinkList {
  generated_at: string;
  object_id: string;
  links: OntologyLink[];
  source: string;
}

// get_object_metrics tool(IMP-73)의 데이터 — 객체의 수치 메트릭을 이름별 시계열 + 현재값으로.
// 결정적(mock): 객체 id·range 로 seed 된다. points 는 range 구간의 sparkline(끝이 현재값).
export interface ObjectMetricSeries {
  key: string;        // 메트릭 키(예: util_perc, ttft_ms)
  label: string;      // 사람용 라벨
  unit: string;       // 단위(%, ms, GB …)
  current: number;    // 현재값(points 마지막)
  points: number[];   // 시계열(결정적)
}
export interface ObjectMetricsReport {
  generated_at: string;
  object_id: string;
  range: string;      // 1h|6h|24h|7d
  series: ObjectMetricSeries[];
  source: string;
}

// ───────────── 엔티티-앵커 Metric Explorer (IMP-71 — 전량 메트릭 드릴다운) ─────────────
// 큐레이션 요약(IMP-46/Gpu SlidePanel)은 KNOWNS 대시보드로 그대로 두고, explorer 는 UNKNOWNS 검색가능
// 전량 드릴다운(Splunk Observability Metric Explorer 의 entity→all-metrics→drill 미러). 온톨로지 객체가
// 엔티티 앵커. mock 은 buildOntology() 스냅샷(IMP-81)에서 결정적 category→metric 트리를 파생하고,
// live(IMP-79)는 동일 스키마를 VictoriaMetrics /series+/query+/query_range 로 채운다(transport 만 스왑).

// 메트릭 타입 — raw DCGM/node exporter 값은 타입 없이는 의미가 다르다.
//  gauge=순간값(FB_USED·SM_CLOCK), counter=단조누적(ECC·PCIe replay·XID), rate=초당(net_err/s).
export type MetricType = "gauge" | "counter" | "rate";

// 메트릭 상태 — 임계 밴드(단일 출처 statusFromThresholds 계열). none=임계 정의 없음(중립).
export type MetricStatus = "ok" | "warn" | "crit" | "none";

// 전량 메트릭 한 행 — TYPE + UNIT + freshness + 임계 + 스파크라인 + facet(label/tag).
export interface MetricRow {
  key: string;        // 원본 메트릭명(예: DCGM_FI_DEV_FB_USED, node_cpu_seconds_total)
  label: string;      // 사람용 라벨
  type: MetricType;
  unit: string;       // bytes|MiB|MHz|W|°C|count|%|req/s|load|"" — 단위 없이는 무의미
  value: number;      // 현재값(points 끝점)
  status: MetricStatus;
  freshness_sec: number; // 마지막 스크랩 경과(초) — 신선도
  points: number[];   // 결정적 시계열(끝=value). live 는 펼칠 때 lazy /query_range.
  facets: Record<string, string>; // gpu|instance|job|device 등 label(facet 필터·검색 대상)
}

// 카테고리(접힘/펼침 단위) — GPU: Utilization/Memory/Clocks/Power·Thermal/Interconnect/Errors/Throttle/Per-process.
//   Node: CPU/Memory/Disk/Filesystem/Network/Load/Systemd.
export interface MetricCategory {
  key: string;
  label: string;
  rows: MetricRow[];
}

// GET /ontology/objects/:id/metric-tree?range= 응답 — mock/실백엔드 동일 계약.
export interface ObjectMetricTree {
  generated_at: string;
  object_id: string;
  object_type: string; // GpuDevice | Node (그 외는 엔티티 앵커 아님 → 빈 categories)
  range: string;       // 1h|6h|24h|7d
  categories: MetricCategory[];
  facet_keys: string[]; // 이 엔티티가 emit 하는 facet 키 목록(UI facet 셀렉터)
  source: string;      // "metric-explorer (mock)" | 실백엔드
}

// ───────────── AI Agent (IMP-60 — 로컬 모델 + MCP tool-calling 온톨로지 접지) ─────────────
// docs/palantir-ontology-analysis.md §3·§5.4 + AWS Prescriptive Guidance grounded-agent Pattern 5.
// "채팅"이 아니라 "온톨로지 위에서 tool 을 쓰는 운영 에이전트": LLM 이 온톨로지를 tool 로 조회(read-only)하고
// 근본원인 후보 + 실행 가능 Action 을 제안한다. **핵심 안전장치**: 에이전트의 tool 은 조회 3종뿐이고
// (mutating tool 없음), mutation 은 오직 <ActionForm>(IMP-59) confirm + capability 게이팅으로만 실행된다.

// read-only tool 이름 — 모델이 자동 실행. mutating(invokeAction)은 의도적으로 tool 에서 배제(two-tier 게이팅).
export type AgentToolName = "queryObjects" | "traverseLinks" | "getIncidents";

// tool 호출(모델이 낸 typed call) — args 는 tool 별 파라미터(문자열 위주로 escape-safe 렌더).
export interface AgentToolCall {
  tool: AgentToolName;
  args: Record<string, string>;
}

// tool 실행 결과 — grounding 소스인 objectId 목록을 항상 반환(RCA 인용의 출처). found=false → grounding 없음.
export interface AgentToolResult {
  objectIds: string[]; // 이 tool 이 접지한 온톨로지 객체 id(인용 소스)
  summary: string;     // 사람용 한 줄 요약(escape 렌더)
  found: boolean;      // 아무것도 못 찾으면 false → 정적 runbook fallback 트리거
}

// ReAct 타임라인 한 스텝(discriminated union) — reasoning(생각) 또는 tool(도구 호출+결과).
export type AgentStep =
  | { kind: "reasoning"; text: string }
  | { kind: "tool"; call: AgentToolCall; result: AgentToolResult };

// 근본원인 후보 카드 — 모든 claim 은 objectId/trace id 를 인용(citations)해야 한다(grounding 1급).
// suggestedAction 은 "제안"일 뿐 — 실행은 사용자의 <ActionForm> confirm + capability 게이팅을 반드시 통과한다.
export interface RcaCandidate {
  objectId: string;            // 대상 온톨로지 객체 id(ObjectView deep-link)
  title: string;
  objectType: ObjectType;
  confidence: number;          // 0..1 (순위·바 표시)
  claim: string;               // 근본원인 추정 서술(escape 렌더 — "추정", 상관≠인과)
  citations: string[];         // 근거 objectId/trace id(비어 있으면 grounding 없음)
  suggestedAction?: { actionType: string; target: string }; // 제안 verb(ActionForm 확장으로만 실행)
}

// 에이전트 실행 1회 결과 — 전체 transcript 는 traceId 로 키잉되어 audit 표면과 연결된다.
export interface AgentRun {
  traceId: string;             // transcript 추적 id(audit 조인 키)
  intent: string;             // 사용자 의도(자연어, escape 렌더)
  steps: AgentStep[];          // ReAct 타임라인(순서 보존)
  candidates: RcaCandidate[];  // confidence 순위 RCA 후보(grounding 있을 때만)
  grounded: boolean;           // tool 이 근거를 찾았는지. false → fallbackRunbook 사용(hallucination 금지)
  fallbackRunbook?: string[];  // grounding 없음 시 정적 runbook 절차(모델이 지어내지 않음)
  audit: AgentAuditEntry[];    // transcript audit 라인(prompt/tool/reasoning/action)
  generated_at: string;
  source: string;             // "agent (mock)" | 실백엔드
}

// transcript audit 라인(IMP-60) — ActionAuditEntry 의 형제. 어떤 실행이든 traceId 로 묶는다.
export interface AgentAuditEntry {
  traceId: string;
  kind: "prompt" | "tool" | "reasoning" | "action";
  detail: string; // 마스킹된 메타데이터만(원문/시크릿 로깅 금지)
  ts: string;
}

// ── Kinetic 감지→객체 귀속 파생 레이어(IMP-72) ──────────────────────────────
// 감지된 이상을 온톨로지 객체(Model/GpuDevice/Node)에 결정적으로 귀속시켜, "어느 객체가 왜 아픈지 +
// 지금 무엇을 눌러야 하는지" 를 4-슬롯 카드로 낸다. 순수 파생(api/detection.ts), 새 데이터 모델 발명 없음.

// 감지 신호 소스 종류 — 어느 축에서 이상이 왔는지(카드 근거 슬롯의 계열 구분).
export type DetectionSignalKind =
  | "alertrule"   // alertrules threshold 크로싱(TTFT p95 / error / block)
  | "throttle"    // GPU clock-throttle reason 비트(thermal/reliability, IMP-76)
  | "idleAlloc"   // GPU 유휴 할당 갭(VRAM 점유·util 낮음)
  | "saturation"  // Node CPU/네트워크 포화
  | "firstAnomaly"; // buildRootCausePath first-anomaly 시간축(추정 원인 시각)

// 근거(evidence) 슬롯 한 줄 — 어느 신호가 언제 임계 초과했는가 + 인용(objectId/시각).
export interface DetectionSignal {
  kind: DetectionSignalKind;
  label: string;      // 사람용 신호명(예: "TTFT p95 급증")
  detail: string;     // 임계 대비 값 서술(escape 렌더) — "820ms > 임계 800ms" 등
  observedAt: string; // 관측 시각 라벨("12분 전" 등, 상대 시간)
  citation: string;   // 근거 objectId/룰 id(grounding 강제)
}

// Kinetic 알림 — 4-슬롯 카드의 단일 출처. dedupe/state-transition 억제 후 남은 것만.
export interface KineticAlert {
  objectId: string;                 // [슬롯1] 영향 객체 id
  title: string;                    //         객체 표시명
  objectType: ObjectType;           //         타입(chip)
  status: ObjectStatus;             //         현재 상태(crit/warn — ok 는 승격 안 됨)
  signals: DetectionSignal[];       // [슬롯2] 근거(신호 집계 — dedupe 결과)
  confidence: "high" | "med";       //         신뢰도(신호 ≥2 → high, 1 → med) — IBM Probable Cause
  probableCause: string;            // [슬롯3] 추정 원인 경로 서술(first-anomaly 시간축, "추정")
  hypothesis: string;               //         /agent 로 넘길 가설 intent(pre-fill 마찰 제거)
  suggestedAction?: {               // [슬롯4] 추천 Action(제안일 뿐 — 실행은 ActionForm confirm)
    actionType: string;
    target: string;
  };
  breachCount: number;              //         지속 임계초과 카운트(sustained collapse → 배지)
}

export interface KineticAlertList {
  generated_at: string;
  alerts: KineticAlert[];
  source: string;
}

// ───────────── 메트릭 소스 / 익스포터 커버리지 매트릭스 (IMP-74) ─────────────
// Diagnostics(연동 상태)는 외부 의존성 능동 프로브(도달성)이고, 이건 '어떤 신호를 어떤 익스포터가 주고
// 무엇이 아직 갭인가'를 보여주는 Grafana Entity-catalog / OTel-coverage 방식의 커버리지 인벤토리.
// mock-first — 실 상태(up{job}+scrape_samples_scraped+last-scrape age)는 IMP-79 spike 로 transport 만 스왑.

// 소스 3단 상태 — up 단독 금지. "타깃 살아있는데 특정 계열 빔"까지 잡으려면 up + 샘플수 + 신선도 필요.
//  NOT_CONFIGURED    : up=0 (스크레이프 타깃 없음/미구성)
//  CONFIGURED_NO_DATA: up=1 이지만 scrape_samples_scraped=0 또는 last-scrape age 초과(계열 빔·정체)
//  HEALTHY           : up=1 · 샘플>0 · 신선(age ≤ 임계)
export type MetricSourceStatus = "NOT_CONFIGURED" | "CONFIGURED_NO_DATA" | "HEALTHY";

// 소스 프로토콜 — signal-provider 추상(OTel 정합). 향후 OTel Collector 리시버로 흡수 가능.
export type MetricSourceProtocol = "prometheus" | "otlp";

// 소스 카드 안의 부가 배지 — NVML per-process 미지원처럼 "잘못된 신뢰 방지" 인라인 경고.
//  NVML 은 독립 카드 금지(DCGM 하위 라이브러리) — DCGM 카드 안 배지로만 표기.
export interface MetricSourceNote {
  label: string;   // 배지 텍스트(예: "per-process = 미지원")
  detail: string;  // 근거 서술(예: "DCGM/NVML 원천 한계 — 이슈 #521")
  issue?: string;  // 참조 이슈/링크(예: "#521")
  tone: "warn" | "info";
}

// scrape 라이브 상태 — mock 은 결정적, 실 스왑은 VictoriaMetrics 값으로 동일 필드 채움(deriveSourceStatus 재사용).
export interface MetricSourceScrape {
  job: string;                 // Prometheus job 라벨(예: "node-exporter")
  up: 0 | 1;                   // up{job} — 타깃 살아있음(단독으론 부족)
  scrape_samples_scraped: number; // 마지막 스크랩 샘플 수(0 = 계열 빔)
  last_scrape_age_sec: number; // 마지막 스크랩 경과(초) — 신선도
}

// 익스포터(소스) 카드 — 제공 메트릭 계열 + 대상 온톨로지 객체 타입 + 상태 + 프로토콜.
export interface MetricSourceCard {
  id: string;                    // node_exporter|kube-state-metrics|cadvisor|dcgm-exporter|process-exporter|blackbox-exporter
  label: string;                 // 표시명
  role: string;                  // 한 줄 역할(예: "호스트 OS 자원(USE)")
  protocol: MetricSourceProtocol;
  families: string[];            // 제공 메트릭 계열(예: node_cpu_seconds_total …)
  targetTypes: ObjectType[];     // 대상 온톨로지 객체 타입(Node/GpuDevice/Endpoint …) — Model pod 는 Model 로 표기
  targetNote?: string;           // 대상 보조 설명(예: "Model pod(컨테이너)")
  status: MetricSourceStatus;    // deriveSourceStatus(scrape) 파생
  scrape: MetricSourceScrape;    // 라이브 판정 근거(실 스왑 대상)
  notes: MetricSourceNote[];     // 인라인 갭/경고 배지(DCGM per-process 등)
}

// 커버리지 셀 — '신호 × 객체'. covered=이 소스가 신호를 준다 / gap=아직 안 잡힘(원천 한계·미배포 익스포터).
//  GAP 셀은 클릭 → 드릴다운(gpu/nodes/investigate) 또는 추천 익스포터로 연결(IMP-71/72 grounding).
export interface SignalCoverageCell {
  signal: string;                // 신호명(예: "per-process GPU memory")
  objectType: ObjectType;        // 대상 객체 타입
  objectLabel?: string;          // 표시 보조(예: "Model pod")
  covered: boolean;              // true=커버 / false=GAP
  sourceId?: string;             // covered 일 때 제공 소스 id
  reason?: string;               // GAP 사유 카피(원천 한계·필요 익스포터)
  recommended?: string;          // 추천 익스포터 id(GAP 해소 경로)
  issue?: string;                // 참조 이슈(예: "#521")
  drilldown?: "gpu" | "nodes" | "investigate"; // GAP 셀 클릭 시 이동 대상 화면(스파이크/근거)
}

// GET /metric-sources 응답 — 소스 카드 축 + 커버리지 매트릭스(covered/gap 셀).
export interface MetricSourceCoverage {
  generated_at: string;
  sources: MetricSourceCard[];
  coverage: SignalCoverageCell[]; // covered + gap 셀 모두(매트릭스 — 무엇이 되고 무엇이 갭인지)
  source: string;                 // 데이터 출처 라벨(mock 표식)
}
