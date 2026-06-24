package store

import (
	"context"
	"fmt"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

var validRoles = map[string]bool{"admin": true, "user": true, "super": true}

func normRole(r string) string {
	if validRoles[r] {
		return r
	}
	return "user"
}

// ListUsers 는 사용자 목록을 최신순으로 반환한다.
func (s *Store) ListUsers(ctx context.Context) ([]domain.User, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT user_id, email, name, role, COALESCE(dept_id,''), status, created_at
		 FROM app_user ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.User{}
	for rows.Next() {
		var u domain.User
		var created time.Time
		if err := rows.Scan(&u.UserID, &u.Email, &u.Name, &u.Role, &u.DeptID, &u.Status, &created); err != nil {
			return nil, err
		}
		u.CreatedAt = created.UTC().Format(time.RFC3339)
		out = append(out, u)
	}
	return out, rows.Err()
}

// CreateUser 는 사용자를 추가한다.
func (s *Store) CreateUser(ctx context.Context, req domain.UserUpsertRequest) (domain.User, error) {
	if req.Email == "" || req.Name == "" {
		return domain.User{}, fmt.Errorf("email 과 name 은 필수입니다")
	}
	id := "u_" + randHex(6)
	role := normRole(req.Role)
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO app_user(user_id,email,name,role,dept_id) VALUES($1,$2,$3,$4,$5)`,
		id, req.Email, req.Name, role, req.DeptID); err != nil {
		return domain.User{}, err
	}
	return domain.User{UserID: id, Email: req.Email, Name: req.Name, Role: role, DeptID: req.DeptID, Status: "active"}, nil
}

// UpdateUser 는 역할/부서/상태를 수정한다.
func (s *Store) UpdateUser(ctx context.Context, id string, req domain.UserUpsertRequest) error {
	status := req.Status
	if status == "" {
		status = "active"
	}
	tag, err := s.pool.Exec(ctx,
		`UPDATE app_user SET role=$2, dept_id=$3, status=$4 WHERE user_id=$1`,
		id, normRole(req.Role), req.DeptID, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("사용자 없음: %s", id)
	}
	return nil
}

// DeptForUser 는 x-user-id(이메일)로 부서를 해석한다(identity-broker #14 로컬 1차).
// 외부 사내 DB 연동(세션ID→직원) 전, 내부 디렉터리(app_user)로 귀속.
func (s *Store) DeptForUser(ctx context.Context, email string) (string, bool) {
	var dept string
	err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(dept_id,'') FROM app_user WHERE email=$1 AND status='active'`, email).Scan(&dept)
	if err != nil || dept == "" {
		return "", false
	}
	return dept, true
}

// DeleteUser 는 사용자를 삭제한다.
func (s *Store) DeleteUser(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM app_user WHERE user_id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("사용자 없음: %s", id)
	}
	return nil
}
