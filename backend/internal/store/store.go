// Package store 는 PostgreSQL(CNPG) 마스터 데이터 접근 — app/api_key.
// 보안(R4): API 키 원문 미저장. sha256 해시 + 표시용 prefix 만 보관한다.
package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// Store 는 Postgres 풀을 감싼다.
type Store struct {
	pool *pgxpool.Pool
}

// New 는 연결 풀을 만든다(연결 검증 포함).
func New(ctx context.Context, url string) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	s := &Store{pool: pool}
	s.migrate(ctx) // RBAC 등 신규 테이블 보장(idempotent)
	return s, nil
}

// migrate 는 신규 테이블을 보장한다(CREATE IF NOT EXISTS, 비파괴).
func (s *Store) migrate(ctx context.Context) {
	_, _ = s.pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS app_user (
		user_id    TEXT PRIMARY KEY,
		email      TEXT NOT NULL,
		name       TEXT NOT NULL,
		role       TEXT NOT NULL DEFAULT 'user',   -- admin | user | super
		dept_id    TEXT,
		status     TEXT NOT NULL DEFAULT 'active',  -- active | disabled
		created_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	// 마스킹 정책(게이트웨이 글루가 폴링) — 단일 행(id=1) JSONB. (비파괴)
	_, _ = s.pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS masking_policy (
		id         INT PRIMARY KEY,
		policy     JSONB NOT NULL,
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	// 앱 소유 부서(조직·귀속) — app 테이블에 dept_id 보강(비파괴).
	// 주의: 앱 DB 롤이 api_key/app 테이블 owner 가 아니면 ALTER 가 권한 거부(42501)될 수 있다.
	// dept_id 는 이미 적용돼 있어 IF NOT EXISTS 가 no-op. 신규 컬럼은 owner 마이그레이션으로 적용 권장.
	if _, err := s.pool.Exec(ctx, `ALTER TABLE IF EXISTS app ADD COLUMN IF NOT EXISTS dept_id TEXT`); err != nil {
		slog.Warn("app.dept_id 보강 스킵(권한/기존)", "err", err)
	}
	// 예산 경고 임계(P4-5)는 인메모리(quota.Limiter)로 관리 — api_key DDL 권한 불필요.
	// (프로덕션 영속화는 owner 롤 마이그레이션으로 alert_threshold 컬럼 추가 후 전환)
	// 비어 있으면 기본 관리자 시드.
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM app_user`).Scan(&n); err == nil && n == 0 {
		_, _ = s.pool.Exec(ctx,
			`INSERT INTO app_user(user_id,email,name,role,dept_id) VALUES
			 ('u_admin','sw_platform_ai04@maymust.com','플랫폼 관리자','admin','D-PLATFORM'),
			 ('u_research','research-lead@maymust.com','리서치 리드','user','리서치본부'),
			 ('u_wm','wm-lead@maymust.com','WM 리드','user','WM본부')`)
	}
}

// Close 는 풀을 닫는다.
func (s *Store) Close() { s.pool.Close() }

// Probe 는 PostgreSQL 연결 가용성을 확인한다(Ping, read-only). 진단용.
func (s *Store) Probe(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return s.pool.Ping(ctx)
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slug(s string) string {
	out := slugRe.ReplaceAllString(strings.ToLower(strings.TrimSpace(s)), "-")
	out = strings.Trim(out, "-")
	if out == "" {
		out = "app"
	}
	return out
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// IssueKey 는 앱을 보장(upsert)하고 새 키를 발급한다. 평문은 반환값에만 1회 노출.
func (s *Store) IssueKey(ctx context.Context, req domain.IssueKeyRequest) (domain.IssuedKey, error) {
	appID := strings.TrimSpace(req.AppID)
	if appID == "" {
		appID = slug(req.AppName)
	}
	appName := strings.TrimSpace(req.AppName)
	if appName == "" {
		appName = appID
	}
	scope := req.ModelScope
	if scope == "" {
		scope = "*"
	}
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO app(app_id, name, dept_id) VALUES($1,$2,NULLIF($3,''))
		 ON CONFLICT(app_id) DO UPDATE SET name=EXCLUDED.name, dept_id=EXCLUDED.dept_id`,
		appID, appName, req.DeptID); err != nil {
		return domain.IssuedKey{}, fmt.Errorf("app upsert: %w", err)
	}

	plaintext := "fbx_" + randHex(20) // fbx_ + 40 hex
	sum := sha256.Sum256([]byte(plaintext))
	keyHash := hex.EncodeToString(sum[:])
	keyPrefix := plaintext[:12] // fbx_xxxxxxxx
	keyID := "key_" + randHex(6)
	keyName := req.KeyName
	if keyName == "" {
		keyName = appID + "-key"
	}

	if _, err := s.pool.Exec(ctx,
		`INSERT INTO api_key(api_key_id, app_id, name, model_scope, key_hash, key_prefix, quota_rpm, quota_tpd)
		 VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
		keyID, appID, keyName, scope, keyHash, keyPrefix, req.QuotaRPM, req.QuotaTPD); err != nil {
		return domain.IssuedKey{}, fmt.Errorf("key insert: %w", err)
	}
	return domain.IssuedKey{APIKeyID: keyID, AppID: appID, Plaintext: plaintext, KeyPrefix: keyPrefix}, nil
}

// KeyQuota 는 키의 쿼터/활성 상태를 조회한다(쿼터 강제용).
func (s *Store) KeyQuota(ctx context.Context, keyID string) (domain.KeyQuota, error) {
	var q domain.KeyQuota
	err := s.pool.QueryRow(ctx,
		`SELECT quota_rpm, quota_tpd, enabled FROM api_key WHERE api_key_id=$1 AND revoked_at IS NULL`,
		keyID).Scan(&q.QuotaRPM, &q.QuotaTPD, &q.Enabled)
	if err != nil {
		return domain.KeyQuota{Found: false}, nil // 없거나 회수됨 → 미발견(통과 정책은 호출측)
	}
	q.Found = true
	return q, nil
}

// ListKeys 는 키 목록(마스킹)을 최신순으로 반환한다.
func (s *Store) ListKeys(ctx context.Context) ([]domain.APIKeyView, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT k.api_key_id, k.app_id, a.name, COALESCE(a.dept_id,''), k.name, k.model_scope, k.key_prefix,
		        k.quota_rpm, k.quota_tpd, k.enabled, k.created_at, k.revoked_at
		 FROM api_key k JOIN app a ON a.app_id = k.app_id
		 ORDER BY k.created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []domain.APIKeyView{}
	for rows.Next() {
		var v domain.APIKeyView
		var created time.Time
		var revoked *time.Time
		if err := rows.Scan(&v.APIKeyID, &v.AppID, &v.AppName, &v.DeptID, &v.Name, &v.ModelScope,
			&v.KeyPrefix, &v.QuotaRPM, &v.QuotaTPD, &v.Enabled, &created, &revoked); err != nil {
			return nil, err
		}
		v.CreatedAt = created.UTC().Format(time.RFC3339)
		if revoked != nil {
			r := revoked.UTC().Format(time.RFC3339)
			v.RevokedAt = &r
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// RevokeKey 는 키를 회수(비활성 + revoked_at)한다.
func (s *Store) RevokeKey(ctx context.Context, keyID string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE api_key SET enabled=false, revoked_at=now() WHERE api_key_id=$1 AND revoked_at IS NULL`,
		keyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("키 없음 또는 이미 회수됨: %s", keyID)
	}
	return nil
}
