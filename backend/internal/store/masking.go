package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// GetMaskingPolicy 는 저장된 마스킹 정책을 반환한다. 행이 없으면 기본값(읽기는 항상 성공).
// 게이트웨이 글루가 폴링하는 엔드포인트의 데이터 소스.
func (s *Store) GetMaskingPolicy(ctx context.Context) (domain.MaskingPolicy, error) {
	var raw []byte
	err := s.pool.QueryRow(ctx, `SELECT policy FROM masking_policy WHERE id = 1`).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.DefaultMaskingPolicy(), nil
	}
	if err != nil {
		return domain.MaskingPolicy{}, err
	}
	var p domain.MaskingPolicy
	if err := json.Unmarshal(raw, &p); err != nil {
		return domain.MaskingPolicy{}, err
	}
	return p, nil
}

// SetMaskingPolicy 는 마스킹 정책을 upsert 한다(단일 행 id=1).
func (s *Store) SetMaskingPolicy(ctx context.Context, p domain.MaskingPolicy) error {
	raw, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx,
		`INSERT INTO masking_policy (id, policy, updated_at) VALUES (1, $1, now())
		 ON CONFLICT (id) DO UPDATE SET policy = EXCLUDED.policy, updated_at = now()`, raw)
	return err
}
