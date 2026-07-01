# IMP-52 스파이크 플랜 — 호스트/네트워크 골든시그널 수집을 node_exporter로 표준 채택 (사람이 실행)

> **상태: `spike-needed`** — node_exporter/blackbox_exporter를 클러스터에 배포(DaemonSet)하고 Prometheus로
> scrape하는 **인프라 채택**이라 코드 PR이 아니다. 노드/네트워크 **화면(IMP-46/49)은 mock-first로 빌드**되며,
> 이 문서는 그 화면들의 **실 데이터 소스 연동 경로**를 정의한다. IMP-41(Prometheus 백본)의 **익스포터 층**.

## 왜 코드 PR이 아닌가
- node_exporter = 각 K8s 노드에 DaemonSet으로 배포, Prometheus가 scrape → 저장·룰은 IMP-41 백본.
- air-gapped 이미지 미러(Harbor) + Helm 값 오버레이 = 다일짜리 운영 작업. 화면은 mock으로 이미 동작하므로 블로킹 아님.

## 채택 (IMP-41 백본 위에서)
- **node_exporter**(Apache-2.0, Prometheus 공식, CNCF) — 호스트 CPU/mem/disk/netdev. kube-prometheus-stack Helm에 포함(DaemonSet), Harbor 미러.
- **netdev collector** — per-interface rx/tx bytes·errs·drops (네트워크 화면 대역폭/에러).
- **blackbox_exporter**(Apache-2.0) — 링크 지연·패킷손실(node_exporter가 못 주는 probe 계열). 필요 시 보강.
- **TCP retransmit** — node netstat collector 또는 전용 익스포터 필요(명시).
- BFF는 mock 대신 **Prometheus에 PromQL 질의**로 nodes/network 핸들러의 실 소스 전환.

## 골든시그널 PromQL (IMP-46 노드 화면 — USE method / Grafana id 13977 정합)
- **CPU util**: `100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`
- **Load(saturation)**: `node_load1` vs `count(node_cpu_seconds_total{mode="idle"}) by(instance)`
- **Mem util**: `(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100`
- **Swap(saturation)**: `node_memory_SwapFree_bytes / node_memory_SwapTotal_bytes`
- **Disk util**: `100 - (node_filesystem_avail_bytes / node_filesystem_size_bytes * 100)`
- **Disk IO sat**: `rate(node_disk_io_time_seconds_total[5m])`

## 네트워크 PromQL (IMP-49 네트워크 화면)
- **Mbps(rx/tx)**: `rate(node_network_receive_bytes_total[5m]) * 8 / 1e6` (tx 동일)
- **Errors/drops**: `rate(node_network_receive_errs_total[5m])`, `..._drop_total`
- **Retransmit rate**: `rate(node_netstat_Tcp_RetransSegs[5m]) / rate(node_netstat_Tcp_OutSegs[5m])`
- **지연/loss**: blackbox_exporter `probe_duration_seconds`, `probe_success` (probe 계열)

## 채택 순서
1. IMP-41 백본(Prometheus/Alertmanager) 선결 — [[IMP-41-spike]] P0(고객 소유 여부) 결정.
2. kube-prometheus-stack Helm의 node_exporter DaemonSet 활성 + Harbor 이미지 미러.
3. (네트워크 probe 필요 시) blackbox_exporter 배포 + probe 타깃 설정.
4. BFF nodes/network 핸들러의 mock 소스를 Prometheus PromQL 질의로 교체(화면·타입 불변 — mock↔live seam).
5. IMP-46/49 화면 상단 'mock' 배지 제거, 실 데이터 확인.

## 위협 모델 / Caveats (go/no-go)
- **라이선스**: node_exporter·blackbox_exporter 모두 Apache-2.0·CNCF — 깨끗(air-gapped 안전).
- **공급망**: 이미지 Harbor 미러 + digest 검증(latest float 금지), IMP-41 백본과 동일 정책.
- **수집 범위**: node_exporter는 수백 메트릭 — **화면은 큐레이션된 핵심만**(IMP-46 USE 세트), 전량 노출 금지.
- **네트워크 retransmit/probe**: node_exporter 단독으로 부족 → node netstat collector + blackbox_exporter 조합 확인.
- **2-profile**: observe는 읽기전용 — 수집/화면 모두 read. write 없음.

## 사람 승인 체크리스트
- [ ] IMP-41 P0(Prometheus 소유 경계) 결정 완료
- [ ] node_exporter DaemonSet + Harbor 미러(Apache-2.0, digest-pin)
- [ ] netdev/netstat collector로 네트워크 메트릭 커버 확인, 부족분 blackbox_exporter
- [ ] BFF nodes/network 핸들러 mock→PromQL seam 전환 지점 확정(화면 불변)
- [ ] 큐레이션 세트(USE/골든시그널)만 질의 — 전량 덤프 금지

## 출처 (spike 단계 1차 확보)
- Prometheus node_exporter / blackbox_exporter 공식 문서, kube-prometheus-stack Helm, Grafana "USE Method / Node"(id 13977).
