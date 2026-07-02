# IMP-101 Spike — 파드 진단 근거 수집 표준화 (kube-state-metrics + cAdvisor)

> Status: **spike-needed** (다일짜리 인프라 채택). IMP-79(K8s 메트릭 백본) 확장.
> 전제: 인시던트 원인 설명(IMP-93/94/95/98)의 **실 근거 수집** 단계. mock-first 화면은 이 spike 없이도 buildable.

## 왜
인시던트 "왜 NotReady/왜 backpressure"의 근거(파드 waiting reason·재시작·OOMKilled·스케줄 실패·큐 깊이)를 실 클러스터에서 얻으려면 표준 수집이 필요하다. 손수 스크레이프는 신뢰성·보존을 재발명한다.

## 수집원 매핑
| 근거 신호 | 수집원 | 메트릭(예) |
|---|---|---|
| 파드 상태·재시작·waiting reason | **kube-state-metrics** | kube_pod_status_phase, kube_pod_container_status_restarts_total, kube_pod_container_status_waiting_reason(ImagePullBackOff/CrashLoopBackOff) |
| OOMKilled·컨테이너 메모리 압박 | **cAdvisor**(kubelet) | container_oom_events_total, container_memory_working_set_bytes |
| 스케줄 실패·Pending 사유 | kube-state-metrics + scheduler events | kube_pod_status_unschedulable, 이벤트 reason=FailedScheduling |
| GPU throttle/XID | **DCGM-exporter**(IMP-79) | DCGM_FI_DEV_CLOCKS_EVENT_REASONS, XID |
| 큐 깊이·처리율·동시성(backpressure) | 추론 게이트웨이/vLLM 메트릭 | num_requests_waiting, num_requests_running, gpu_cache_usage, TTFT |
| 최근 이벤트 | kube events(API) 또는 event-exporter | reason/message/count/lastTimestamp |

## 검증(go/no-go)
1. kube-state-metrics + cAdvisor(kubelet) + DCGM 가 kube-prometheus-stack(IMP-79)로 함께 배포 가능한지.
2. waiting_reason·OOM·unschedulable 이 실제 노출되는지(폐쇄망 이미지 미러링 포함).
3. K8s 이벤트 수집(짧은 보존) 경로 — API watch vs event-exporter.
4. vLLM/게이트웨이 큐 메트릭(num_requests_waiting 등) 실제 export 여부.
5. 카디널리티·보존 예산.

## 채택 순서
1. Go 조건: 인시던트 원인 설명(IMP-93/94/95/98) mock 화면 검증 + 실 근거 수요 확정 시.
2. IMP-79 백본 위에 kube-state-metrics/cAdvisor/이벤트 추가 → BFF 가 `buildIncidentEvidence`(IMP-99) 계약과 동일 형태로 서빙(VITE_MOCK=off transport 스왑).
3. 프론트 Evidence 패널·MCP get_pod_diagnostics 는 무변경(스냅샷 소스만 스왑).

## 결론
**지금은 no-go(park).** 인시던트 근거는 mock-first(결정적 파생)로 먼저. 실 수요 확정 시 IMP-79와 함께 채택.
