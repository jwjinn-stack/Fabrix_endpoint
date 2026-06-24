package store

import (
	"context"
	"fmt"
	"sort"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// OrgTree 는 부서 → 앱 → 키 + 부서별 사용자 트리를 구성한다.
// app.dept_id(앱 소유 부서) 기준으로 묶고, dept_id 없는 앱은 "미귀속"(빈 문자열) 버킷.
func (s *Store) OrgTree(ctx context.Context) (domain.OrgTree, error) {
	// 1) 앱(+ 소속 부서)
	appRows, err := s.pool.Query(ctx, `SELECT app_id, name, COALESCE(dept_id,'') FROM app ORDER BY name`)
	if err != nil {
		return domain.OrgTree{}, err
	}
	apps := map[string]*domain.OrgApp{}
	order := []string{}
	for appRows.Next() {
		var a domain.OrgApp
		if err := appRows.Scan(&a.AppID, &a.Name, &a.DeptID); err != nil {
			appRows.Close()
			return domain.OrgTree{}, err
		}
		a.Keys = []domain.OrgKey{}
		apps[a.AppID] = &a
		order = append(order, a.AppID)
	}
	appRows.Close()
	if err := appRows.Err(); err != nil {
		return domain.OrgTree{}, err
	}

	// 2) 키 → 앱에 매단다
	keyRows, err := s.pool.Query(ctx, `SELECT api_key_id, app_id, name, key_prefix, enabled FROM api_key ORDER BY created_at DESC`)
	if err != nil {
		return domain.OrgTree{}, err
	}
	for keyRows.Next() {
		var k domain.OrgKey
		var appID string
		if err := keyRows.Scan(&k.APIKeyID, &appID, &k.Name, &k.KeyPrefix, &k.Enabled); err != nil {
			keyRows.Close()
			return domain.OrgTree{}, err
		}
		if a := apps[appID]; a != nil {
			a.Keys = append(a.Keys, k)
		}
	}
	keyRows.Close()
	if err := keyRows.Err(); err != nil {
		return domain.OrgTree{}, err
	}

	// 3) 사용자(부서별)
	userRows, err := s.pool.Query(ctx, `SELECT user_id, name, email, role, COALESCE(dept_id,''), status FROM app_user ORDER BY name`)
	if err != nil {
		return domain.OrgTree{}, err
	}
	membersByDept := map[string][]domain.OrgMember{}
	for userRows.Next() {
		var m domain.OrgMember
		var dept string
		if err := userRows.Scan(&m.UserID, &m.Name, &m.Email, &m.Role, &dept, &m.Status); err != nil {
			userRows.Close()
			return domain.OrgTree{}, err
		}
		membersByDept[dept] = append(membersByDept[dept], m)
	}
	userRows.Close()
	if err := userRows.Err(); err != nil {
		return domain.OrgTree{}, err
	}

	// 4) 부서별로 묶기. 앱 dept + 사용자 dept 의 합집합이 부서 목록.
	deptSet := map[string]bool{}
	appsByDept := map[string][]domain.OrgApp{}
	for _, id := range order {
		a := apps[id]
		deptSet[a.DeptID] = true
		appsByDept[a.DeptID] = append(appsByDept[a.DeptID], *a)
	}
	for d := range membersByDept {
		deptSet[d] = true
	}

	// known_depts: 미귀속("") 제외, 정렬.
	known := []string{}
	for d := range deptSet {
		if d != "" {
			known = append(known, d)
		}
	}
	sort.Strings(known)

	// 트리 구성: 명명 부서 먼저(정렬), 미귀속은 항목 있으면 맨 끝.
	// nil 슬라이스는 JSON null 로 직렬화되어 프론트에서 .length/.reduce 가 깨지므로 빈 배열 보장.
	coalesceApps := func(a []domain.OrgApp) []domain.OrgApp {
		if a == nil {
			return []domain.OrgApp{}
		}
		return a
	}
	coalesceMembers := func(m []domain.OrgMember) []domain.OrgMember {
		if m == nil {
			return []domain.OrgMember{}
		}
		return m
	}

	tree := domain.OrgTree{KnownDepts: known, Depts: []domain.OrgDept{}}
	for _, d := range known {
		tree.Depts = append(tree.Depts, domain.OrgDept{
			DeptID:  d,
			Apps:    coalesceApps(appsByDept[d]),
			Members: coalesceMembers(membersByDept[d]),
		})
	}
	if len(appsByDept[""]) > 0 || len(membersByDept[""]) > 0 {
		tree.Depts = append(tree.Depts, domain.OrgDept{
			DeptID:  "",
			Apps:    coalesceApps(appsByDept[""]),
			Members: coalesceMembers(membersByDept[""]),
		})
	}
	return tree, nil
}

// SetAppDept 는 앱의 소속 부서를 설정/해제한다("" 면 미귀속).
func (s *Store) SetAppDept(ctx context.Context, appID, deptID string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE app SET dept_id=NULLIF($2,'') WHERE app_id=$1`, appID, deptID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("앱 없음: %s", appID)
	}
	return nil
}
