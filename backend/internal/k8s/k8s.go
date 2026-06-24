// Package k8s 는 DynamoGraphDeployment CR(엔드포인트=모델 배포)을 조회/생성/삭제한다.
// dev 는 kubectl 셸아웃, 인클러스터는 ServiceAccount + RBAC(후속).
//
// 안전: 운영 리소스 보호 — 우리가 만든(label fabrix.managed-by=fabrix-endpoint) CR 만
// 삭제 가능. 생성은 기본 dry-run(서버측 검증)이며 apply=true 일 때만 실제 적용.
package k8s

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const (
	managedLabel = "fabrix.managed-by"
	managedValue = "fabrix-endpoint"
)

// Client 는 kubectl 기반 CR 조작기.
type Client struct {
	kubectl    string
	defaultNS  string
	enabled    bool
	apiVersion string
}

// New 는 kubectl 경로/기본 ns 로 클라이언트를 만든다. kubectl 미존재 시 비활성.
func New(kubectlPath, defaultNS string) *Client {
	if kubectlPath == "" {
		kubectlPath = "kubectl"
	}
	if defaultNS == "" {
		defaultNS = "dynamo-inference"
	}
	c := &Client{kubectl: kubectlPath, defaultNS: defaultNS, apiVersion: "nvidia.com/v1alpha1"}
	// kubectl 도달성 확인(version --client 는 빠름).
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := exec.CommandContext(ctx, c.kubectl, "version", "--client", "-o", "json").Run(); err == nil {
		c.enabled = true
	}
	return c
}

// Enabled 는 CR 조작 가능 여부.
func (c *Client) Enabled() bool { return c.enabled }

func (c *Client) run(ctx context.Context, stdin string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, c.kubectl, args...)
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		return out.Bytes(), fmt.Errorf("%s: %s", err, strings.TrimSpace(errb.String()))
	}
	return out.Bytes(), nil
}

// Endpoint 는 엔드포인트(=DynamoGraphDeployment) 요약.
type Endpoint struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Model     string `json:"model,omitempty"`
	Ready     bool   `json:"ready"`
	Backend   string `json:"backend"`
	Replicas  int    `json:"replicas"`
	AppID     string `json:"app_id,omitempty"`
	DeptID    string `json:"dept_id,omitempty"`
	Managed   bool   `json:"managed"` // 우리가 생성(삭제 가능)
	Age       string `json:"age,omitempty"`
}

// List 는 모든 ns 의 DynamoGraphDeployment 를 요약 반환.
func (c *Client) List(ctx context.Context) ([]Endpoint, error) {
	out, err := c.run(ctx, "", "get", "dynamographdeployments.nvidia.com", "-A", "-o", "json")
	if err != nil {
		return nil, err
	}
	var list struct {
		Items []struct {
			Metadata struct {
				Name        string            `json:"name"`
				Namespace   string            `json:"namespace"`
				Labels      map[string]string `json:"labels"`
				Annotations map[string]string `json:"annotations"`
				Created     string            `json:"creationTimestamp"`
			} `json:"metadata"`
			Spec struct {
				Backend  string                 `json:"backendFramework"`
				Services map[string]serviceSpec `json:"services"`
			} `json:"spec"`
			Status struct {
				State      string `json:"state"`
				Conditions []struct {
					Type   string `json:"type"`
					Status string `json:"status"`
				} `json:"conditions"`
			} `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(out, &list); err != nil {
		return nil, err
	}
	eps := make([]Endpoint, 0, len(list.Items))
	for _, it := range list.Items {
		ready := strings.EqualFold(it.Status.State, "successful") || strings.EqualFold(it.Status.State, "ready")
		for _, cond := range it.Status.Conditions {
			if cond.Type == "Ready" && cond.Status == "True" {
				ready = true
			}
		}
		reps := 0
		for _, s := range it.Spec.Services {
			reps += s.Replicas
		}
		backend := it.Spec.Backend
		if backend == "" {
			backend = "vllm"
		}
		eps = append(eps, Endpoint{
			Name: it.Metadata.Name, Namespace: it.Metadata.Namespace, Ready: ready,
			Model: servedModelName(it.Spec.Services, it.Metadata.Name), Backend: backend, Replicas: reps,
			AppID: it.Metadata.Annotations["fabrix.app_id"], DeptID: it.Metadata.Annotations["fabrix.dept_id"],
			Managed: it.Metadata.Labels[managedLabel] == managedValue,
			Age:     it.Metadata.Created,
		})
	}
	return eps, nil
}

type serviceSpec struct {
	Replicas     int `json:"replicas"`
	ExtraPodSpec struct {
		MainContainer struct {
			Args []string `json:"args"`
		} `json:"mainContainer"`
	} `json:"extraPodSpec"`
}

func servedModelName(services map[string]serviceSpec, fallback string) string {
	for _, name := range []string{"VllmWorker", "VllmDecodeWorker", "VllmPrefillWorker"} {
		if s, ok := services[name]; ok {
			if m := servedModelFromArgs(s.ExtraPodSpec.MainContainer.Args); m != "" {
				return m
			}
		}
	}
	for _, s := range services {
		if m := servedModelFromArgs(s.ExtraPodSpec.MainContainer.Args); m != "" {
			return m
		}
	}
	return fallback
}

func servedModelFromArgs(args []string) string {
	for _, a := range args {
		if strings.HasPrefix(a, "--served-model-name=") {
			return strings.TrimPrefix(a, "--served-model-name=")
		}
	}
	return ""
}

// ModelReadiness 는 모델 워크로드의 실제 ready 상태를 "namespace/name" 키로 반환한다.
// DynamoGraphDeployment(dynamo-inference) + vllm ns Deployment 의 k8s 상태 기반(맥에서도 동작).
func (c *Client) ModelReadiness(ctx context.Context) map[string]bool {
	out := map[string]bool{}
	// DynamoGraphDeployments(gemma 등)
	if eps, err := c.List(ctx); err == nil {
		for _, e := range eps {
			out[e.Namespace+"/"+e.Name] = e.Ready
		}
	}
	// vllm ns Deployments(qwen3·qwen25vl·bge-* 등)
	if data, err := c.run(ctx, "", "get", "deployments", "-n", "vllm", "-o", "json"); err == nil {
		var list struct {
			Items []struct {
				Metadata struct {
					Name string `json:"name"`
				} `json:"metadata"`
				Status struct {
					ReadyReplicas int `json:"readyReplicas"`
				} `json:"status"`
			} `json:"items"`
		}
		if json.Unmarshal(data, &list) == nil {
			for _, it := range list.Items {
				out["vllm/"+it.Metadata.Name] = it.Status.ReadyReplicas >= 1
			}
		}
	}
	return out
}

// CreateSpec 은 위저드 입력.
type CreateSpec struct {
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	Model       string `json:"model"`       // HF id 예: Qwen/Qwen3-30B
	ServedName  string `json:"served_name"` // /v1/models 노출명
	Pattern     string `json:"pattern"`     // agg | agg_router
	Replicas    int    `json:"replicas"`    // worker replica 수
	GPU         int    `json:"gpu"`         // worker 당 GPU/MIG 슬라이스
	MaxModelLen int    `json:"max_model_len"`
	AppID       string `json:"app_id"`
	DeptID      string `json:"dept_id"`
	Image       string `json:"image"`
	// HarborRef 가 있으면 모델을 Harbor 에서 pull(initContainer) 해 /models 로 마운트 후 서빙.
	// 비면 기존 방식(워커 이미지/호스트 /models). 예: 192.168.160.43:30834/models/qwen3:latest
	HarborRef string `json:"harbor_ref"`
	// Access 는 추론 HTTP API 노출 방식: "cluster"(기본, ClusterIP — 인클러스터 전용) | "nodeport"(외부 노드포트).
	// Dynamo 기본 Frontend 서비스는 9090(system)만 노출하므로, OpenAI API(8000) 노출용 서비스를 별도로 생성한다.
	Access string `json:"access"`
}

// Manifest 는 CreateSpec 으로 DynamoGraphDeployment YAML 을 생성한다(라이브 CR 형상 기반).
func (c *Client) Manifest(s CreateSpec) string {
	if s.Namespace == "" {
		s.Namespace = c.defaultNS
	}
	if s.Replicas < 1 {
		s.Replicas = 1
	}
	if s.GPU < 1 {
		s.GPU = 1
	}
	if s.MaxModelLen == 0 {
		s.MaxModelLen = 16384
	}
	if s.ServedName == "" {
		s.ServedName = s.Model
	}
	if s.Image == "" {
		s.Image = "nvcr.io/nvidia/ai-dynamo/vllm-runtime:1.2.1" // 클러스터 검증된 버전(gemma 동일)
	}
	routerArg := ""
	if s.Pattern == "agg_router" || s.Pattern == "disagg" {
		routerArg = "\n            - \"--router-mode=kv\""
	}

	// Harbor pull 모드: initContainer(oras)가 모델을 /models 로 받고, 워커는 --model /models/<name>.
	// ★ Frontend 도 동일하게 /models 에 모델을 마운트해야 한다. dynamo.frontend 는 모델 디스커버리 시
	//   tokenizer/config 를 모델 경로에서 로드하는데, 경로가 없으면 HF id 로 착각해 조회 실패(/v1/models 빈 목록).
	//   (검증된 gemma 도 Frontend·Worker 양쪽에 /models 마운트 — 동일 패턴.)
	modelArg := s.Model
	harborInit, harborVol, harborMount := "", "", ""
	if s.HarborRef != "" {
		modelArg = "/models/" + s.ServedName
		harborInit = fmt.Sprintf(`
        initContainers:
          - name: harbor-pull
            image: ghcr.io/oras-project/oras:v1.2.0
            command: ["sh","-c"]
            args: ["oras pull --plain-http %s -o /models/%s && ls -la /models/%s"]
            volumeMounts:
              - { name: model-cache, mountPath: /models }`, s.HarborRef, s.ServedName, s.ServedName)
		harborMount = "\n          volumeMounts:\n            - { name: model-cache, mountPath: /models }"
		harborVol = "\n        volumes:\n          - name: model-cache\n            emptyDir: { sizeLimit: 80Gi }"
	}

	header := fmt.Sprintf(`apiVersion: nvidia.com/v1alpha1
kind: DynamoGraphDeployment
metadata:
  name: %s
  namespace: %s
  labels:
    fabrix.managed-by: fabrix-endpoint
  annotations:
    fabrix.app_id: %q
    fabrix.dept_id: %q
spec:
  services:
    Frontend:
      componentType: main
      replicas: 1
      extraPodSpec:%s
        mainContainer:
          image: %s
          command: ["python3", "-m", "dynamo.frontend"]
          args:
            - "--http-port=8000"%s%s%s
`, s.Name, s.Namespace, s.AppID, s.DeptID, harborInit, s.Image, routerArg, harborMount, harborVol)

	// 워커 1기 헬퍼(역할 인자 extra 추가, Harbor pull 시 initContainer/volume 포함).
	worker := func(name string, reps int, extra string) string {
		return fmt.Sprintf(`    %s:
      componentType: main
      replicas: %d
      resources:
        limits:
          gpu: "%d"
      extraPodSpec:%s
        mainContainer:
          image: %s
          command: ["python3", "-m", "dynamo.vllm"]
          args:
            - "--model=%s"
            - "--served-model-name=%s"
            - "--max-model-len=%d"
            - "--enable-prefix-caching"%s%s%s
`, name, reps, s.GPU, harborInit, s.Image, modelArg, s.ServedName, s.MaxModelLen, extra, harborMount, harborVol)
	}

	body := header + worker("VllmWorker", s.Replicas, "")
	if s.Pattern == "disagg" {
		// 분리(disagg): prefill ↔ decode 워커 분리 + NIXL KV 전송(Operator/런타임 연결).
		prefill := worker("VllmPrefillWorker", s.Replicas, "\n            - \"--is-prefill-worker\"")
		decode := worker("VllmDecodeWorker", s.Replicas*2, "")
		body = header + prefill + decode
	}
	return body + apiService(s.Name, s.Namespace, s.Access)
}

// apiService 는 추론 OpenAI HTTP API(8000) 노출용 Service 를 만든다.
// Dynamo 기본 Frontend 서비스는 9090(system)만 노출하므로, 8000 을 따로 노출해야 호출 가능하다.
// access="nodeport" 면 외부 노드포트(자동 할당), 아니면 ClusterIP(인클러스터 DNS: <name>-api.<ns>:8000).
func apiService(name, ns, access string) string {
	typ := "ClusterIP"
	if access == "nodeport" {
		typ = "NodePort"
	}
	return fmt.Sprintf(`---
apiVersion: v1
kind: Service
metadata:
  name: %s-api
  namespace: %s
  labels:
    fabrix.managed-by: fabrix-endpoint
spec:
  type: %s
  selector:
    nvidia.com/selector: %s-frontend
  ports:
    - name: openai-http
      port: 8000
      targetPort: 8000
      protocol: TCP
`, name, ns, typ, name)
}

// Create 는 생성한다. dryRun=true 면 서버측 검증만(실제 적용 안 함).
func (c *Client) Create(ctx context.Context, s CreateSpec, dryRun bool) (string, error) {
	manifest := c.Manifest(s)
	args := []string{"apply", "-f", "-", "-o", "name"}
	if dryRun {
		args = append(args, "--dry-run=server")
	}
	out, err := c.run(ctx, manifest, args...)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// ImportSpec 결과/미리보기.
type ImportResult struct {
	Manifest string `json:"manifest"`
	JobName  string `json:"job_name"`
	Applied  bool   `json:"applied"`
	CLIHint  string `json:"cli_hint"` // dev 직접 push 대안
}

// ImportModelJob 은 HF/NGC 모델을 Harbor 로 임포트하는 k8s Job 을 생성한다.
// dryRun=true 면 매니페스트만 반환(미리보기). namespace=fabrix-endpoint.
func (c *Client) ImportModelJob(ctx context.Context, source, modelID, project string, dryRun bool) (ImportResult, error) {
	name := "import-" + slugName(modelID)
	manifest := importJobManifest(name, source, modelID, project)
	cli := fmt.Sprintf("# dev 직접 push 예시(huggingface-cli + oras):\nhuggingface-cli download %s --local-dir /tmp/%s\noras push <HARBOR_HOST>/%s/%s:latest /tmp/%s",
		modelID, name, project, slugName(modelID), name)
	res := ImportResult{Manifest: manifest, JobName: name, CLIHint: cli}
	if dryRun {
		if _, err := c.run(ctx, manifest, "apply", "-f", "-", "--dry-run=server", "-o", "name"); err != nil {
			return res, err
		}
		return res, nil
	}
	out, err := c.run(ctx, manifest, "apply", "-f", "-", "-o", "name")
	if err != nil {
		return res, err
	}
	res.Applied = true
	res.JobName = strings.TrimSpace(string(out))
	return res, nil
}

// importJobManifest 는 모델 임포트 Job(다운로드→Harbor push) 매니페스트를 만든다.
// 이미지엔 huggingface_hub + oras 가 필요(운영은 전용 임포터 이미지로 교체).
func importJobManifest(name, source, modelID, project string) string {
	// initContainer(python): HF snapshot_download → /data/model.
	// container(oras): Harbor(harbor-core.harbor, in-cluster http) 로 login + push.
	// creds: fabrix-endpoint ns 의 harbor-import 시크릿(username/password).
	return fmt.Sprintf(`apiVersion: batch/v1
kind: Job
metadata:
  name: %s
  namespace: fabrix-endpoint
  labels:
    fabrix.managed-by: fabrix-endpoint
    purpose: model-import
spec:
  backoffLimit: 1
  ttlSecondsAfterFinished: 3600
  template:
    metadata:
      labels: { purpose: model-import }
    spec:
      restartPolicy: Never
      initContainers:
        - name: download
          image: python:3.11-slim
          env:
            - { name: SOURCE, value: %q }
            - { name: MODEL_ID, value: %q }
            # HF 액세스 토큰(설정 > 서드파티 자격증명) — 게이트 모델·레이트리밋 회피. 없으면 무시(public 다운로드).
            - name: HF_TOKEN
              valueFrom: { secretKeyRef: { name: fabrix-thirdparty, key: hf_token, optional: true } }
          command: ["sh","-c"]
          args:
            - |
              set -e
              pip install -q huggingface_hub
              echo "downloading $MODEL_ID ($SOURCE) ..."
              python -c "from huggingface_hub import snapshot_download; snapshot_download('$MODEL_ID', local_dir='/data/model', ignore_patterns=['*.pth','original/*'])"
              du -sh /data/model
          resources:
            requests: { cpu: "200m", memory: "512Mi" }
            limits: { cpu: "2", memory: "6Gi" }
          volumeMounts:
            - { name: scratch, mountPath: /data }
      containers:
        - name: push
          image: ghcr.io/oras-project/oras:v1.2.0
          env:
            - { name: HOST, value: "harbor-core.harbor" }
            - { name: PROJECT, value: %q }
            - { name: MODEL_NAME, value: %q }
            - name: HARBOR_USER
              valueFrom: { secretKeyRef: { name: harbor-import, key: username } }
            - name: HARBOR_PASS
              valueFrom: { secretKeyRef: { name: harbor-import, key: password } }
          command: ["sh","-c"]
          args:
            - |
              cd /data/model
              oras login --plain-http -u "$HARBOR_USER" -p "$HARBOR_PASS" "$HOST"
              oras push --plain-http "$HOST/$PROJECT/$MODEL_NAME:latest" . \
                --annotation "fabrix.source=%s" --annotation "fabrix.model-id=%s"
              echo "pushed $HOST/$PROJECT/$MODEL_NAME:latest"
          volumeMounts:
            - { name: scratch, mountPath: /data }
      volumes:
        - name: scratch
          emptyDir: { sizeLimit: 20Gi }
`, name, source, modelID, project, slugName(modelID), source, modelID)
}

func slugName(s string) string {
	s = strings.ToLower(s)
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			out = append(out, r)
		} else if r == '/' || r == '.' || r == '_' || r == ' ' {
			out = append(out, '-')
		}
	}
	res := strings.Trim(string(out), "-")
	if len(res) > 40 {
		res = res[:40]
	}
	if res == "" {
		res = "model"
	}
	return res
}

// 보호 ns — 절대 삭제 금지.
var protectedNS = map[string]bool{
	"vllm-semantic-router-system": true, "observability": true, "kserve": true,
	"project001": true, "kube-system": true,
}

// Delete 는 우리가 만든(managed) CR 만 삭제한다. 보호 ns/비관리 리소스는 거부.
func (c *Client) Delete(ctx context.Context, ns, name string) error {
	if protectedNS[ns] {
		return fmt.Errorf("보호된 네임스페이스(%s)의 리소스는 삭제할 수 없습니다", ns)
	}
	// managed 라벨 확인
	out, err := c.run(ctx, "", "get", "dynamographdeployments.nvidia.com", name, "-n", ns,
		"-o", fmt.Sprintf("jsonpath={.metadata.labels.%s}", strings.ReplaceAll(managedLabel, ".", "\\.")))
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(out)) != managedValue {
		return fmt.Errorf("FABRIX 가 생성한 엔드포인트만 삭제할 수 있습니다(운영 리소스 보호)")
	}
	_, err = c.run(ctx, "", "delete", "dynamographdeployments.nvidia.com", name, "-n", ns)
	// 함께 만든 추론 API 서비스(-api)도 정리(베스트에포트).
	_, _ = c.run(ctx, "", "delete", "svc", name+"-api", "-n", ns, "--ignore-not-found")
	return err
}

// Logs 는 엔드포인트(DynamoGraphDeployment) 파드의 최근 로그를 반환한다(P4-8 실시간 로그 팝업).
// 읽기 전용 — 보호 ns 도 조회 허용(mutating 아님). component 비면 전체 컴포넌트.
func (c *Client) Logs(ctx context.Context, ns, name, component string, tail int) (string, error) {
	if tail <= 0 || tail > 1000 {
		tail = 200
	}
	sel := "nvidia.com/dynamo-graph-deployment-name=" + name
	if component != "" {
		// nvidia.com/selector 라벨은 소문자(예: <name>-vllmworker).
		sel = "nvidia.com/selector=" + name + "-" + strings.ToLower(component)
	}
	out, err := c.run(ctx, "",
		"logs", "-n", ns, "-l", sel,
		fmt.Sprintf("--tail=%d", tail), "--all-containers=true", "--prefix=true",
		"--max-log-requests=10", "--timestamps=false")
	if err != nil {
		return string(out), err
	}
	return string(out), nil
}

// Components 는 엔드포인트의 컴포넌트(Frontend/VllmWorker 등) 목록을 반환한다(로그 필터용).
func (c *Client) Components(ctx context.Context, ns, name string) []string {
	out, err := c.run(ctx, "", "get", "pods", "-n", ns,
		"-l", "nvidia.com/dynamo-graph-deployment-name="+name,
		"-o", `jsonpath={range .items[*]}{.metadata.labels.nvidia\.com/dynamo-component}{"\n"}{end}`)
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	var comps []string
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		c := strings.TrimSpace(line)
		if c != "" && !seen[c] {
			seen[c] = true
			comps = append(comps, c)
		}
	}
	return comps
}

// --- 서드파티 자격증명(HF 토큰·NGC 키) — fabrix-endpoint ns 의 fabrix-thirdparty 시크릿 ---

const (
	thirdPartyNS     = "fabrix-endpoint"
	thirdPartySecret = "fabrix-thirdparty"
)

// ThirdPartyCred 는 자격증명 1건의 표시용 요약(값은 마스킹).
type ThirdPartyCred struct {
	Kind   string `json:"kind"`   // hf | ngc
	Name   string `json:"name"`   // 토큰/키 이름(평문)
	Masked string `json:"masked"` // 값 마스킹(예: hf_****vQF)
	Set    bool   `json:"set"`    // 값 설정 여부
}

// secretData 는 시크릿의 디코드된 data 맵을 반환한다. 없으면 빈 맵.
func (c *Client) secretData(ctx context.Context, ns, name string) (map[string]string, error) {
	out, err := c.run(ctx, "", "get", "secret", name, "-n", ns, "-o", "json")
	if err != nil {
		if strings.Contains(err.Error(), "NotFound") || strings.Contains(err.Error(), "not found") {
			return map[string]string{}, nil
		}
		return nil, err
	}
	var s struct {
		Data map[string]string `json:"data"`
	}
	if err := json.Unmarshal(out, &s); err != nil {
		return nil, err
	}
	res := map[string]string{}
	for k, v := range s.Data {
		if dec, derr := base64.StdEncoding.DecodeString(v); derr == nil {
			res[k] = string(dec)
		}
	}
	return res, nil
}

// GetCredentials 는 마스킹된 서드파티 자격증명(HF·NGC)을 반환한다.
func (c *Client) GetCredentials(ctx context.Context) ([]ThirdPartyCred, error) {
	data, err := c.secretData(ctx, thirdPartyNS, thirdPartySecret)
	if err != nil {
		return nil, err
	}
	return []ThirdPartyCred{
		{Kind: "hf", Name: data["hf_token_name"], Masked: maskSecret(data["hf_token"]), Set: data["hf_token"] != ""},
		{Kind: "ngc", Name: data["ngc_key_name"], Masked: maskSecret(data["ngc_key"]), Set: data["ngc_key"] != ""},
	}, nil
}

// SetCredential 은 자격증명 1건(kind=hf|ngc)을 시크릿에 업서트한다. value 가 비면 이름만 갱신(값 유지).
func (c *Client) SetCredential(ctx context.Context, kind, name, value string) error {
	if kind != "hf" && kind != "ngc" {
		return fmt.Errorf("지원하지 않는 자격증명 종류: %s", kind)
	}
	data, err := c.secretData(ctx, thirdPartyNS, thirdPartySecret)
	if err != nil {
		return err
	}
	switch kind {
	case "hf":
		data["hf_token_name"] = name
		if value != "" {
			data["hf_token"] = value
		}
	case "ngc":
		data["ngc_key_name"] = name
		if value != "" {
			data["ngc_key"] = value
		}
	}
	return c.applySecret(ctx, thirdPartyNS, thirdPartySecret, data)
}

// applySecret 은 data 로 시크릿을 생성/치환한다(기존 키는 호출부에서 병합 후 전달).
func (c *Client) applySecret(ctx context.Context, ns, name string, data map[string]string) error {
	var b strings.Builder
	b.WriteString("apiVersion: v1\nkind: Secret\nmetadata:\n  name: ")
	b.WriteString(name)
	b.WriteString("\n  namespace: ")
	b.WriteString(ns)
	b.WriteString("\n  labels:\n    fabrix.managed-by: fabrix-endpoint\ntype: Opaque\ndata:\n")
	for k, v := range data {
		b.WriteString("  ")
		b.WriteString(k)
		b.WriteString(": ")
		b.WriteString(base64.StdEncoding.EncodeToString([]byte(v)))
		b.WriteString("\n")
	}
	_, err := c.run(ctx, b.String(), "apply", "-f", "-")
	return err
}

// maskSecret 은 값을 앞3+****+뒤3 형태로 가린다(Nutanix 자격증명 화면 패턴).
func maskSecret(s string) string {
	if s == "" {
		return ""
	}
	r := []rune(s)
	if len(r) <= 8 {
		return strings.Repeat("*", len(r))
	}
	return string(r[:3]) + strings.Repeat("*", 16) + string(r[len(r)-3:])
}
