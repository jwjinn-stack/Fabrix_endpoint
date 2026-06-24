-- FABRIX Endpoint 마스터 스키마 (문서 Part 1 ACCESS). DB: fabrix
-- 보안(R4): API 키 원문 저장 금지 — sha256 해시 + 표시용 prefix 만 보관.

CREATE TABLE IF NOT EXISTS app (
  app_id     TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT,                       -- chatbot|batch|opencode|agentic
  dept_id    TEXT,
  owner      TEXT,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_key (
  api_key_id  TEXT PRIMARY KEY,          -- key_xxxx (식별자)
  app_id      TEXT NOT NULL REFERENCES app(app_id),
  name        TEXT NOT NULL,
  model_scope TEXT NOT NULL DEFAULT '*', -- '*' 또는 특정 모델 id
  key_hash    TEXT NOT NULL,             -- sha256(평문) — 원문 미저장
  key_prefix  TEXT NOT NULL,             -- 표시용 앞부분 (fbx_xxxxxxxx)
  quota_rpm   INT,
  quota_tpd   BIGINT,
  alert_threshold DOUBLE PRECISION,       -- 예산 경고 임계(0..1) — 한도 대비 도달 시 경고
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_key_app ON api_key(app_id);
CREATE INDEX IF NOT EXISTS idx_api_key_hash ON api_key(key_hash);

-- 기존 DB 보강(비파괴) — 소유자 권한으로 재적용 시 컬럼 추가.
ALTER TABLE IF EXISTS api_key ADD COLUMN IF NOT EXISTS alert_threshold DOUBLE PRECISION;
