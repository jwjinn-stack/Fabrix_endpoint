// Package harbor 는 Harbor 레지스트리(모델 저장소)를 조회하고 HF→Harbor 임포트 잡을 만든다.
// 모델은 Harbor 에 OCI 아티팩트로 보관 → Dynamo 가 거기서 pull 해 추론한다(목표 아키텍처).
// dev 는 NodePort(:30834), 인클러스터는 svc harbor-core. (Nutanix NAI Models 화면 패턴)
package harbor

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client 는 Harbor API v2.0 클라이언트.
type Client struct {
	base    string // scheme://host:port (creds 제거)
	user    string
	pass    string
	http    *http.Client
	enabled bool
}

// New 는 Harbor URL(creds 포함)로 클라이언트를 만든다.
// 예: http://admin:<pw>@192.168.160.43:30834
func New(raw string) *Client {
	c := &Client{http: &http.Client{Timeout: 8 * time.Second}}
	if raw == "" {
		return c
	}
	u, err := url.Parse(raw)
	if err != nil {
		return c
	}
	if u.User != nil {
		c.user = u.User.Username()
		c.pass, _ = u.User.Password()
		u.User = nil
	}
	c.base = strings.TrimRight(u.String(), "/")
	c.enabled = true
	return c
}

func (c *Client) Enabled() bool { return c.enabled }

func (c *Client) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	if c.user != "" {
		req.SetBasicAuth(c.user, c.pass)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("harbor %d", resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// Model 은 Harbor 레지스트리의 모델(=repository) 1개.
type Model struct {
	Name        string   `json:"name"`         // repo 이름(project 제외)
	Project     string   `json:"project"`      // 프로젝트
	FullRef     string   `json:"full_ref"`     // <host>/<project>/<repo>
	Tags        []string `json:"tags"`         // 최신 아티팩트 태그
	Artifacts   int      `json:"artifacts"`    // 아티팩트 수
	Pulls       int64    `json:"pulls"`        // pull 수
	SizeBytes   int64    `json:"size_bytes"`   // 총 크기
	UpdatedAt   string   `json:"updated_at"`
}

type repoResp struct {
	Name         string `json:"name"` // "project/repo"
	ArtifactCount int   `json:"artifact_count"`
	PullCount    int64  `json:"pull_count"`
	UpdateTime   string `json:"update_time"`
}

type artifactResp struct {
	Size int64 `json:"size"`
	Tags []struct {
		Name string `json:"name"`
	} `json:"tags"`
}

// host 는 레지스트리 호스트(이미지 ref 용 — scheme 제거).
func (c *Client) host() string {
	h := c.base
	if i := strings.Index(h, "://"); i >= 0 {
		h = h[i+3:]
	}
	return h
}

// ListModels 는 모든 프로젝트의 repository 를 모델로 반환한다(태그·크기 포함).
func (c *Client) ListModels(ctx context.Context) ([]Model, error) {
	if !c.enabled {
		return []Model{}, nil
	}
	var repos []repoResp
	if err := c.get(ctx, "/api/v2.0/repositories?page_size=100", &repos); err != nil {
		return nil, err
	}
	out := make([]Model, 0, len(repos))
	for _, r := range repos {
		proj, name := splitRepo(r.Name)
		m := Model{
			Name: name, Project: proj, FullRef: c.host() + "/" + r.Name,
			Artifacts: r.ArtifactCount, Pulls: r.PullCount, UpdatedAt: r.UpdateTime,
		}
		// 최신 아티팩트 태그/크기(있으면)
		var arts []artifactResp
		if err := c.get(ctx, fmt.Sprintf("/api/v2.0/projects/%s/repositories/%s/artifacts?page_size=5&with_tag=true",
			url.PathEscape(proj), url.PathEscape(name)), &arts); err == nil {
			for _, a := range arts {
				m.SizeBytes += a.Size
				for _, t := range a.Tags {
					m.Tags = append(m.Tags, t.Name)
				}
			}
		}
		out = append(out, m)
	}
	return out, nil
}

// Status 는 Harbor 상태/용량(프로젝트 수, 모델 수, quota)을 반환한다.
func (c *Client) Status(ctx context.Context) map[string]any {
	st := map[string]any{"enabled": c.enabled, "registry": c.host()}
	if !c.enabled {
		return st
	}
	var projects []struct {
		Name      string `json:"name"`
		RepoCount int    `json:"repo_count"`
	}
	if err := c.get(ctx, "/api/v2.0/projects?page_size=50", &projects); err == nil {
		repos := 0
		names := []string{}
		for _, p := range projects {
			repos += p.RepoCount
			names = append(names, p.Name)
		}
		st["projects"] = names
		st["model_count"] = repos
		st["reachable"] = true
	} else {
		st["reachable"] = false
	}
	return st
}

func splitRepo(full string) (proj, name string) {
	if i := strings.Index(full, "/"); i >= 0 {
		return full[:i], full[i+1:]
	}
	return "library", full
}
