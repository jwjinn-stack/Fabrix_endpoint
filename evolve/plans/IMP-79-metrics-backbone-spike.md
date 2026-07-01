# IMP-79 Spike — K8s 메트릭·익스포터 백본 채택

> Status: **spike-needed** (다일짜리 인프라 채택 — 코드 PR 아님, 채택 결정 문서).
> 전제: IMP-71(전량 메트릭 드릴다운)·IMP-74(커버리지 매트릭스)·IMP-76(풀-피델리티 GPU)의 **실 수집** 단계.
> 프론트는 mock-first 로 먼저 화면을 만든다(이 spike 없이도 화면은 buildable). 이 문서는 **실 수집 백본**에 한정.

## 왜 필요한가
IMP-71/74/76 은 훨씬 많은 메트릭(XID·throttle reason·NVLink·PCIe·ECC·per-process·cAdvisor·kube-state-metrics)을
온톨로지 객체에 붙인다. mock 단계는 결정적 생성으로 충분하지만, **실 클러스터 수집**은 표준 백본이 필요하다.
직접 스크레이프를 손으로 구현하면 신뢰성·보존·쿼리(PromQL)·스케일을 재발명하게 된다.

## 후보 & 평가
| 옵션 | 구성 | 장점 | 단점 |
|---|---|---|---|
| **kube-prometheus-stack** (권장 기본) | Prometheus + DCGM-exporter + kube-state-metrics + cAdvisor(kubelet) + node-exporter | 사실상 표준, Helm 한방, Grafana 포함, 생태계 최대 | Prometheus 장기보존·카디널리티 부담 |
| **VictoriaMetrics** | vmagent + vmstorage (+ 위 exporter들) | 고카디널리티·장기보존·저메모리, PromQL 호환 | 운영 경험 상대적 적음 |
| 직접 스크레이프 | 자체 수집기 | 무의존 | 신뢰성·PromQL·보존 재발명(비권장) |

## 검증해야 할 것 (딥리서치가 지목 — go/no-go 게이트)
1. **DCGM profiling 모듈** `libdcgmmoduleprofiling.so` 가 대상 노드(Dynamo on Harbor/K8s)에서 **로드 가능한지** — `DCGM_FI_PROF_*` 메트릭 전제.
2. **dcgm-exporter counter-CSV opt-in** 편집으로 throttle-REASON 비트마스크(`DCGM_FI_DEV_CLOCKS_EVENT_REASONS`) + per-reason 카운터 노출 가능한지.
3. **XID 이력**: `DCGM_FI_DEV_XID_ERRORS` 는 **최근 코드 1개(gauge)** 뿐 → fault-history 타임라인은 kubelet/device-plugin 이벤트·dmesg Xid 파싱 보강 필요(없으면 "최근 XID 배지"로 스코프 축소).
4. **per-process GPU**: DCGM 원천 갭 — NVML per-process 또는 별도 수집 필요 여부.
5. 폐쇄망(삼성증권 observe) 이미지 미러링·카디널리티 예산.

## 채택 순서
1. **Go 조건**: IMP-71/74/76 mock 화면이 검증되고 실 수집 수요가 확정될 때 착수.
2. kube-prometheus-stack(또는 VictoriaMetrics) Helm 배포 → BFF 가 PromQL 로 쿼리해 기존 mock 계약과 동일 형태로 서빙(`VITE_MOCK=off` transport 스왑).
3. dcgm-exporter counter-CSV opt-in + profiling 모듈 검증(위 1·2).
4. 온톨로지 객체(GpuDevice/Node)에 실 필드 바인딩 — mock 필드셋과 1:1.
5. 커버리지 매트릭스(IMP-74)를 실 exporter 상태로 라이브 연결.

## 결론
**지금은 no-go(park).** IMP-71/74/76 은 mock-first 로 먼저 빌드. 실 수집 수요 확정 시 이 순서로 채택하고,
위 5개 검증 항목 결과를 go/no-go 에 포함한다.
