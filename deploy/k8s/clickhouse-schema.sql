-- FABRIX Endpoint — ClickHouse 조회 미러 스키마 (문서 2-4 / 3-5)
-- DB: fabrix

-- 가드레일 증적 조회 미러 (원본은 WORM/ObjectScale, 여기는 가변 미러)
CREATE TABLE IF NOT EXISTS fabrix.guard_audit (
  event_id      UUID,
  ts            DateTime64(3),
  trace_id      String,
  user_ref      String,
  employee_id   Nullable(String),
  dept_id       LowCardinality(String),
  app_id        LowCardinality(String),
  api_key_id    LowCardinality(String),
  model         LowCardinality(String),
  decision      LowCardinality(String),  -- blocked|allowed|flagged
  guard_types   Array(String),
  pii_subtypes  Array(String),
  jb_confidence Float32,
  policy_version LowCardinality(String),
  http_status   UInt16 DEFAULT 0,   -- P4-9 SIEM 표준 컬럼(차단=403/통과=200). 백엔드 startup 시 ADD COLUMN IF NOT EXISTS 로도 보강
  latency_ms    UInt32 DEFAULT 0    -- P4-9 가드레일 판정 지연
  -- masked_sample(마스킹 샘플): 4-3 상세용. 적용하려면 ALTER TABLE ADD COLUMN masked_sample String DEFAULT '' (운영 승인 후)
) ENGINE = MergeTree
ORDER BY (ts, dept_id, app_id);

-- 사용량 귀속 롤업 (trace→배치 집계 결과)
CREATE TABLE IF NOT EXISTS fabrix.usage_rollup (
  bucket            DateTime,
  dept_id           LowCardinality(String),
  app_id            LowCardinality(String),
  api_key_id        LowCardinality(String),
  model             LowCardinality(String),
  req_count         UInt64,
  prompt_tokens     UInt64,
  completion_tokens UInt64,
  ttft_p50_ms       Float32,
  ttft_p95_ms       Float32,
  itl_avg_ms        Float32,
  error_count       UInt64
) ENGINE = SummingMergeTree
ORDER BY (bucket, dept_id, app_id, api_key_id, model);
