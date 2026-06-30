// Package mockstore 는 DB(PostgreSQL)·ClickHouse 없이 기능 테스트가 가능하도록
// server.DataStore / server.UsageSource 를 인메모리로 구현한다.
//
// 실제 K8s/DB 연동 시: cmd/api/main.go 의 와이어링만 *store.Store / *usage.Sink 로 바꾸면
// 되고, 핸들러·인터페이스는 불변이다(provider.Dashboard 의 mock/live 와 동일 패턴).
package mockstore

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/domain"
	"github.com/maymust/fabrix-endpoint/internal/server"
	"github.com/maymust/fabrix-endpoint/internal/usage"
)

// ── 시드 엔티티(프론트 web/src/api/mock.ts 와 정합) ──

type deptSeed struct{ id, name string }
type appSeed struct{ id, name, dept string }

var depts = []deptSeed{
	{"d-research", "리서치본부"},
	{"d-cs", "고객지원실"},
	{"d-platform", "플랫폼개발팀"},
	{"d-sales", "영업본부"},
	{"d-security", "정보보안팀"},
}

var apps = []appSeed{
	{"app-cs-bot", "고객상담 봇", "d-cs"},
	{"app-rag-kb", "사내지식 RAG", "d-research"},
	{"app-code", "코드 어시스턴트", "d-platform"},
	{"app-doc-sum", "문서 요약", "d-research"},
	{"app-sales-mail", "영업 메일 작성", "d-sales"},
}

// 사용량 귀속에 쓰는 모델 집합(catalog 와 정합되는 대표 id).
var models = []string{"gemma-3-27b-it", "qwen3-30b-a3b", "gpt-oss-120b"}

func ptrInt(v int) *int       { return &v }
func ptrI64(v int64) *int64   { return &v }
func ptrF64(v float64) *float64 { return &v }

// fnv 해시 — 결정적 시드(난수 대신 안정적 값).
func seed(s string) uint64 {
	var h uint64 = 1469598103934665603
	for i := 0; i < len(s); i++ {
		h ^= uint64(s[i])
		h *= 1099511628211
	}
	return h
}

// ── Store (server.DataStore 구현) ──

type Store struct {
	mu       sync.Mutex
	keys     []domain.APIKeyView
	users    []domain.User
	appDept  map[string]string // appID → deptID (SetAppDept 로 변경 가능)
	masking  domain.MaskingPolicy
	keySeq   int
	userSeq  int

	// IMP-39 — eval suite(데이터셋·실험). 키/유저 경로와 독립된 별도 mutex 로 보호(server.EvalStore 구현, eval.go).
	evalMu      sync.Mutex
	datasets    []server.EvalDataset
	experiments []server.Experiment
	evalSeq     int
}

// New 는 시드 데이터를 채운 인메모리 스토어를 만든다.
func New() *Store {
	now := time.Now().UTC()
	s := &Store{appDept: map[string]string{}, masking: domain.DefaultMaskingPolicy()}
	for _, a := range apps {
		s.appDept[a.id] = a.dept
	}
	// 키: 앱마다 1개 + 일부 추가. created_at 은 과거로 분산.
	keyDefs := []struct {
		app, name, scope string
		ageDays          int
		rpm              int
		tpd              int64
		enabled          bool
	}{
		{"app-cs-bot", "cs-prod-key", "*", 42, 600, 2_000_000, true},
		{"app-rag-kb", "rag-prod-key", "*", 31, 300, 5_000_000, true},
		{"app-code", "code-assist-key", "qwen3-30b-a3b", 18, 1200, 8_000_000, true},
		{"app-doc-sum", "docsum-key", "gemma-3-27b-it", 12, 240, 1_500_000, true},
		{"app-sales-mail", "sales-mail-key", "*", 7, 120, 800_000, true},
		{"app-code", "code-legacy-key", "*", 90, 0, 0, false},
	}
	for i, k := range keyDefs {
		s.keySeq++
		created := now.AddDate(0, 0, -k.ageDays).Format(time.RFC3339)
		var revoked *string
		if !k.enabled {
			r := now.AddDate(0, 0, -2).Format(time.RFC3339)
			revoked = &r
		}
		view := domain.APIKeyView{
			APIKeyID:   fmt.Sprintf("ak_%06x", seed(k.app+k.name)%0xffffff),
			AppID:      k.app,
			AppName:    appName(k.app),
			DeptID:     s.appDept[k.app],
			Name:       k.name,
			ModelScope: k.scope,
			KeyPrefix:  fmt.Sprintf("fbx-%s", fmt.Sprintf("%04x", seed(k.name)%0xffff)),
			Enabled:    k.enabled,
			CreatedAt:  created,
			RevokedAt:  revoked,
		}
		if k.rpm > 0 {
			view.QuotaRPM = ptrInt(k.rpm)
		}
		if k.tpd > 0 {
			view.QuotaTPD = ptrI64(k.tpd)
			view.AlertThreshold = ptrF64(0.8)
		}
		_ = i
		s.keys = append(s.keys, view)
	}
	// 사용자: 부서마다 1~2명.
	userDefs := []struct{ email, name, role, dept, status string }{
		{"hjkim@maymust.com", "김현재", "admin", "d-platform", "active"},
		{"sychoi@maymust.com", "최서연", "super", "d-research", "active"},
		{"jwpark@maymust.com", "박지원", "user", "d-cs", "active"},
		{"mskang@maymust.com", "강민수", "user", "d-sales", "active"},
		{"yjlee@maymust.com", "이유진", "user", "d-research", "active"},
		{"hsjeong@maymust.com", "정현우", "user", "d-security", "disabled"},
	}
	for _, u := range userDefs {
		s.userSeq++
		s.users = append(s.users, domain.User{
			UserID:    fmt.Sprintf("u_%05x", seed(u.email)%0xfffff),
			Email:     u.email,
			Name:      u.name,
			Role:      u.role,
			DeptID:    u.dept,
			Status:    u.status,
			CreatedAt: now.AddDate(0, 0, -int(seed(u.email)%120)).Format(time.RFC3339),
		})
	}
	return s
}

func appName(appID string) string {
	for _, a := range apps {
		if a.id == appID {
			return a.name
		}
	}
	return appID
}

func (s *Store) Probe(_ context.Context) error { return nil }

func (s *Store) ListKeys(_ context.Context) ([]domain.APIKeyView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]domain.APIKeyView, len(s.keys))
	copy(out, s.keys)
	return out, nil
}

func (s *Store) IssueKey(_ context.Context, req domain.IssueKeyRequest) (domain.IssuedKey, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	appID := req.AppID
	if appID == "" {
		appID = "app-" + slug(req.AppName)
	}
	s.keySeq++
	id := fmt.Sprintf("ak_%06x", seed(req.KeyName+fmt.Sprint(s.keySeq))%0xffffff)
	prefix := fmt.Sprintf("fbx-%04x", seed(id)%0xffff)
	plain := fmt.Sprintf("%s-%016x", prefix, seed(id+"secret"))
	dept := req.DeptID
	if dept == "" {
		dept = s.appDept[appID]
	}
	view := domain.APIKeyView{
		APIKeyID: id, AppID: appID, AppName: orDefault(req.AppName, appName(appID)),
		DeptID: dept, Name: req.KeyName, ModelScope: orDefault(req.ModelScope, "*"),
		KeyPrefix: prefix, QuotaRPM: req.QuotaRPM, QuotaTPD: req.QuotaTPD,
		AlertThreshold: req.AlertThreshold, Enabled: true,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if _, ok := s.appDept[appID]; !ok {
		s.appDept[appID] = dept
	}
	s.keys = append([]domain.APIKeyView{view}, s.keys...)
	return domain.IssuedKey{APIKeyID: id, AppID: appID, Plaintext: plain, KeyPrefix: prefix}, nil
}

func (s *Store) KeyQuota(_ context.Context, keyID string) (domain.KeyQuota, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, k := range s.keys {
		if k.APIKeyID == keyID {
			return domain.KeyQuota{QuotaRPM: k.QuotaRPM, QuotaTPD: k.QuotaTPD, AlertThreshold: k.AlertThreshold, Enabled: k.Enabled, Found: true}, nil
		}
	}
	return domain.KeyQuota{Found: false}, nil
}

func (s *Store) RevokeKey(_ context.Context, keyID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC().Format(time.RFC3339)
	for i := range s.keys {
		if s.keys[i].APIKeyID == keyID {
			s.keys[i].Enabled = false
			s.keys[i].RevokedAt = &now
			return nil
		}
	}
	return fmt.Errorf("key not found: %s", keyID)
}

func (s *Store) ListUsers(_ context.Context) ([]domain.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]domain.User, len(s.users))
	copy(out, s.users)
	return out, nil
}

func (s *Store) CreateUser(_ context.Context, req domain.UserUpsertRequest) (domain.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.users {
		if strings.EqualFold(u.Email, req.Email) {
			return domain.User{}, fmt.Errorf("already exists: %s", req.Email)
		}
	}
	s.userSeq++
	u := domain.User{
		UserID: fmt.Sprintf("u_%05x", seed(req.Email+fmt.Sprint(s.userSeq))%0xfffff),
		Email:  req.Email, Name: req.Name, Role: orDefault(req.Role, "user"),
		DeptID: req.DeptID, Status: orDefault(req.Status, "active"),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	s.users = append(s.users, u)
	return u, nil
}

func (s *Store) UpdateUser(_ context.Context, id string, req domain.UserUpsertRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.users {
		if s.users[i].UserID == id {
			if req.Role != "" {
				s.users[i].Role = req.Role
			}
			if req.DeptID != "" {
				s.users[i].DeptID = req.DeptID
			}
			if req.Status != "" {
				s.users[i].Status = req.Status
			}
			return nil
		}
	}
	return fmt.Errorf("user not found: %s", id)
}

func (s *Store) DeleteUser(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.users {
		if s.users[i].UserID == id {
			s.users = append(s.users[:i], s.users[i+1:]...)
			return nil
		}
	}
	return fmt.Errorf("user not found: %s", id)
}

func (s *Store) DeptForUser(_ context.Context, email string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.users {
		if strings.EqualFold(u.Email, email) {
			return u.DeptID, u.DeptID != ""
		}
	}
	return "", false
}

func (s *Store) SetAppDept(_ context.Context, appID, deptID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.appDept[appID] = deptID
	for i := range s.keys {
		if s.keys[i].AppID == appID {
			s.keys[i].DeptID = deptID
		}
	}
	return nil
}

func (s *Store) GetMaskingPolicy(_ context.Context) (domain.MaskingPolicy, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.masking, nil
}

func (s *Store) SetMaskingPolicy(_ context.Context, p domain.MaskingPolicy) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	s.masking = p
	return nil
}

func (s *Store) OrgTree(_ context.Context) (domain.OrgTree, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// 부서별 앱(+키) / 멤버 트리 구성.
	known := make([]string, 0, len(depts))
	byDept := map[string]*domain.OrgDept{}
	for _, d := range depts {
		known = append(known, d.id)
		byDept[d.id] = &domain.OrgDept{DeptID: d.id}
	}
	miscDept := func(id string) *domain.OrgDept {
		if id == "" {
			id = ""
		}
		if byDept[id] == nil {
			byDept[id] = &domain.OrgDept{DeptID: id}
		}
		return byDept[id]
	}
	// 앱 → 키
	keysByApp := map[string][]domain.OrgKey{}
	for _, k := range s.keys {
		keysByApp[k.AppID] = append(keysByApp[k.AppID], domain.OrgKey{APIKeyID: k.APIKeyID, Name: k.Name, KeyPrefix: k.KeyPrefix, Enabled: k.Enabled})
	}
	seenApp := map[string]bool{}
	for _, a := range apps {
		dept := s.appDept[a.id]
		d := miscDept(dept)
		d.Apps = append(d.Apps, domain.OrgApp{AppID: a.id, Name: a.name, DeptID: dept, Keys: keysByApp[a.id]})
		seenApp[a.id] = true
	}
	// 멤버
	for _, u := range s.users {
		d := miscDept(u.DeptID)
		d.Members = append(d.Members, domain.OrgMember{UserID: u.UserID, Name: u.Name, Email: u.Email, Role: u.Role, Status: u.Status})
	}
	var out domain.OrgTree
	out.KnownDepts = known
	for _, d := range depts {
		out.Depts = append(out.Depts, *byDept[d.id])
	}
	if d, ok := byDept[""]; ok {
		out.Depts = append(out.Depts, *d)
	}
	return out, nil
}

// ── Usage (server.UsageSource 구현) ──

type Usage struct{}

// NewUsage 는 활성(enabled) 인메모리 사용량 롤업을 만든다.
func NewUsage() *Usage { return &Usage{} }

func (u *Usage) Enabled() bool                  { return true }
func (u *Usage) Enqueue(_ usage.Event)          {}
func (u *Usage) Probe(_ context.Context) error  { return nil }

// QueryRollup 은 group(model|dept|app|api_key) 축으로 결정적 합성 롤업을 반환한다.
func (u *Usage) QueryRollup(_ context.Context, rng domain.TimeRange, group string) ([]domain.UsageRow, error) {
	scale := rangeScale(rng)
	var rows []domain.UsageRow
	add := func(label string, dept, app, key string) {
		h := seed(group + label)
		model := models[h%uint64(len(models))]
		req := int64(400 + h%2600)
		req = int64(float64(req) * scale)
		pt := req * int64(420+h%900)
		ct := req * int64(160+h%500)
		rows = append(rows, domain.UsageRow{
			DeptID: dept, AppID: app, APIKeyID: key, Model: model,
			Requests: req, PromptTokens: pt, CompletionTokens: ct,
			TTFTp95ms: float64(110 + h%160), ITLavgMs: float64(14 + h%30),
		})
	}
	switch group {
	case "dept":
		for _, d := range depts {
			add(d.id, d.id, "", "")
		}
	case "app":
		for _, a := range apps {
			add(a.id, a.dept, a.id, "")
		}
	case "api_key":
		for _, k := range New().keys { // 시드 키 집합 재사용
			add(k.APIKeyID, k.DeptID, k.AppID, k.APIKeyID)
		}
	default: // model
		for _, m := range models {
			h := seed("model" + m)
			req := int64(float64(2000+h%9000) * scale)
			rows = append(rows, domain.UsageRow{
				Model: m, Requests: req,
				PromptTokens: req * int64(500+h%700), CompletionTokens: req * int64(200+h%400),
				TTFTp95ms: float64(120 + h%140), ITLavgMs: float64(15 + h%25),
			})
		}
	}
	return rows, nil
}

// QueryTrend 는 기간을 버킷으로 나눈 결정적 추세(약한 증가 + 일주기)를 반환한다.
func (u *Usage) QueryTrend(_ context.Context, rng domain.TimeRange) (domain.UsageTrend, error) {
	n, stepSec := trendBuckets(rng)
	now := time.Now().UTC()
	pts := make([]domain.UsageTrendPoint, 0, n)
	for i := n - 1; i >= 0; i-- {
		ts := now.Add(-time.Duration(i) * time.Duration(stepSec) * time.Second)
		h := seed(string(rng) + fmt.Sprint(i))
		base := 600 + float64(n-i)*4 // 약한 우상향
		diurnal := 1 + 0.4*float64((ts.Hour()+6)%12)/12.0
		req := int64((base + float64(h%180)) * diurnal)
		pts = append(pts, domain.UsageTrendPoint{
			Ts: ts.Format(time.RFC3339), Requests: req, Tokens: req * int64(700+h%500),
		})
	}
	return domain.UsageTrend{Range: rng, GeneratedAt: now.Format(time.RFC3339), BucketSec: stepSec, Points: pts}, nil
}

// ── helpers ──

func rangeScale(r domain.TimeRange) float64 {
	switch r {
	case domain.Range6h:
		return 6
	case domain.Range24h:
		return 24
	case domain.Range7d:
		return 168
	default:
		return 1
	}
}

func trendBuckets(r domain.TimeRange) (n, stepSec int) {
	switch r {
	case domain.Range6h:
		return 72, 300
	case domain.Range24h:
		return 96, 900
	case domain.Range7d:
		return 168, 3600
	default:
		return 60, 60
	}
}

func slug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, " ", "-")
	if s == "" {
		return "app"
	}
	return s
}

func orDefault(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}
