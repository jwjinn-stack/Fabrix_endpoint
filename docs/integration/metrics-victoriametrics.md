# VictoriaMetrics (vmselect) — 메트릭

대시보드(관제/사용량/GPU/트래픽)의 **실측 메트릭** 소스. Prometheus 호환 쿼리 API.

- 코드: [`backend/internal/provider/live/live.go`](../../backend/internal/provider/live/live.go)
- capability: `dashboard` · 프로파일: observe·manage 공통
- 주입: `main.go` 에서 `FABRIX_DATA_SOURCE=live` 일 때 `live.New(cfg.VMSelectURL)` 로 provider 교체. `mock` 이면 합성 provider.

## 연결
| 항목 | 값 |
|---|---|
| env | `FABRIX_VMSELECT_URL` |
| 인클러스터 | `http://vmselect-vm.observability:8481/select/0/prometheus` |
| dev(NodePort) | `http://192.168.160.75:30401/select/0/prometheus` |
| 프로토콜 | HTTP, Prometheus Query API |
| 인증 | 없음(사설망 가정) |
| HTTP 타임아웃 | 8초 (`http.Client{Timeout:8s}`) |

## 호출 API (live.go)
- Instant: `GET {base}/api/v1/query?query={PromQL}` (`live.go:56`)
- Range: `GET {base}/api/v1/query_range?query={PromQL}&start=&end=&step=` (`live.go:60`)
- 성공 판정: HTTP 200 **그리고** 응답 `status == "success"` (`live.go:77,83`). 값은 문자열 → float 파싱.

### 사용 메트릭(실측 의존)
- **GPU(DCGM)**: `DCGM_FI_DEV_GPU_UTIL`, `DCGM_FI_DEV_FB_USED/FREE`, `DCGM_FI_DEV_GPU_TEMP`, `DCGM_FI_DEV_POWER_USAGE`, `DCGM_FI_PROF_GR_ENGINE_ACTIVE`, `DCGM_FI_PROF_SM_ACTIVE`, `DCGM_FI_PROF_PIPE_TENSOR_ACTIVE`
- **트래픽(Dynamo frontend)**: `dynamo_frontend_requests_total`(model 라벨), `dynamo_frontend_inflight_requests`, `dynamo_frontend_queued_requests`
- **품질(히스토그램)**: `dynamo_frontend_time_to_first_token_seconds_bucket`(TTFT), `dynamo_frontend_inter_token_latency_seconds_bucket`(ITL), `dynamo_frontend_request_duration_seconds_bucket`(E2E)
- **단계 분해**: `dynamo_frontend_stage_duration_seconds{stage=preprocess|route|transport_roundtrip}`, `dynamo_request_plane_queue_seconds`
- **엔진(vLLM)**: `vllm:num_requests_running`, `vllm:num_requests_waiting`, `vllm:kv_cache_usage_perc`
- **토큰**: `dynamo_frontend_input_sequence_tokens_sum`, `dynamo_frontend_cached_tokens_sum`, `dynamo_frontend_output_tokens_total`

데이터 없으면(트래픽 0 등) 각 값 0 으로 안전 폴백.

## 미설정/실패 시
- `FABRIX_DATA_SOURCE=mock`(기본): vmselect 미사용, 합성 데이터. 실연동 불필요.
- `live` 인데 쿼리 실패: 해당 값 0/빈 시계열로 폴백(대시보드 안 깨짐).

## 진단 프로브
`/diagnostics` → `victoriametrics` 항목. `data_source==live` 일 때만 `configured`. 프로브 = `GET /api/v1/query?query=1` (상수, 즉시 응답). [`live.go` `Probe()`]

## 실사이트 매칭 체크리스트
- [ ] 고객사 메트릭 백엔드가 VictoriaMetrics 인가? Thanos/Mimir/순정 Prometheus 면 `/select/0/prometheus` 프리픽스 제거하고 `/api/v1/query` 가 그대로 동작하는지 확인(전부 Prometheus 호환).
- [ ] Dynamo/DCGM exporter 가 실제로 위 메트릭을 노출하는가? (`{base}/api/v1/label/__name__/values` 로 메트릭 존재 확인)
- [ ] `FABRIX_DATA_SOURCE=live` + `FABRIX_VMSELECT_URL` 주입.
- [ ] NetworkPolicy: BFF → `vmselect-vm.observability:8481` egress 허용.

## 트러블슈팅
| 증상 | 원인 | 조치 |
|---|---|---|
| diagnostics `query status=error` | PromQL/프리픽스 불일치 | base URL 의 `/select/0/prometheus` 유무 확인 |
| 대시보드 값이 전부 0 | 메트릭 이름 불일치 또는 트래픽 없음 | 위 메트릭 존재 확인, 라벨 확인 |
| `connection refused` | Service/포트/NetworkPolicy | vmselect svc·8481·egress 점검 |
