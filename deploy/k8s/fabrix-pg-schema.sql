-- FABRIX Endpoint — 키·앱 마스터 스키마 (문서 Part 1 ACCESS)
-- store.go(IssueKey/ListKeys/RevokeKey)의 쿼리와 1:1 정합.
-- 보안(R4): API 키 원문 미저장 — sha256 해시(key_hash) + 표시용 prefix 만.

CREATE TABLE IF NOT EXISTS app (
  app_id     TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  dept_id    TEXT,                       -- 부서 귀속(후속, Nutanix/거버넌스 차별점)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_key (
  api_key_id  TEXT PRIMARY KEY,
  app_id      TEXT NOT NULL REFERENCES app(app_id),
  name        TEXT NOT NULL,
  model_scope TEXT NOT NULL DEFAULT '*', -- '*' 또는 특정 model id
  key_hash    TEXT NOT NULL,             -- sha256(plaintext)
  key_prefix  TEXT NOT NULL,             -- fbx_xxxxxxxx (표시용)
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_key_app ON api_key(app_id);
CREATE INDEX IF NOT EXISTS idx_api_key_hash ON api_key(key_hash); -- 인증 시 해시 조회
