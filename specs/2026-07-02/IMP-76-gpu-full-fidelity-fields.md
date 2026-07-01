# IMP-76 (Track A) — 풀-피델리티 GPU 필드 확장 (XID·throttle reason·NVLink·PCIe·ECC·clock)

- Type: compete (sev=medium) · Cycle5 active-ontology
- Branch: `feature/evolve-cycle5-active-ontology`
- Sources: DCGM field-ids 문서 · dcgm-exporter `dcp-metrics-included.csv`/`default-counters.csv` · Run:ai GPU profiling metrics · Datadog DCGM integration · Last9 "GPU 관측 8계층"
  - https://docs.nvidia.com/datacenter/dcgm/latest/dcgm-api/dcgm-api-field-ids.html
  - https://github.com/NVIDIA/dcgm-exporter/blob/main/etc/dcp-metrics-included.csv
  - https://run-ai-docs.nvidia.com/saas/platform-management/monitor-performance/gpu-profiling-metrics
  - https://docs.datadoghq.com/integrations/dcgm/

## 목적 (Why)

제품 카테고리는 LLM/GPU-inference 관측·제어 콘솔이다. GPU 관측 경쟁자(NVIDIA DCGM Exporter, Run:ai(현 NVIDIA), Datadog DCGM integration, Grafana DCGM dashboard)는 하드웨어 근본원인 신호 — XID 에러·clock-throttle reason·NVLink/PCIe throughput·ECC·per-process·SM/mem clock — 까지 노출한다. FABRIX 의 GpuDevice 는 DCGM 필드 ~10개(util/mem/temp/power/SM/tensor/GR_ENGINE)만 보여줘 **'왜 느린가'의 하드웨어 근거(throttle·XID·interconnect 포화)를 못 짚는다** — 닫아야 할 경쟁 약점(table-stakes).

**두 트랙 중 이 스펙은 Track A(약점 닫기)만 구현한다:**

- **Track A (이 스펙 — 즉시 buildable, mock-first)**: GpuDevice 온톨로지 객체를 DCGM 확정 필드셋으로 확장하고, ObjectView/Gpu SlidePanel 에 'GPU 하드웨어' 섹션(Utilization/Memory/Clocks/Power·Thermal/Interconnect/Errors/Throttle 그룹 + throttle-reason·최근-XID 뱃지 + 단위 라벨)을 추가한다.
- **Track B (positioning — 이 스펙 범위 밖)**: 방어선은 '수직 필드 커버리지'가 아니라 정확히 **DCGM 하드웨어 신호를 Endpoint→Model→GPU→Node 온톨로지 인과 그래프에 in-place 바인딩(IMP-57/58) + 그 위 executable Action(drainGpu/cordonNode, IMP-59)**. raw Grafana/DCGM 대시보드도, 범용 APM(Datadog)도, Run:ai 도 이 '객체-그래프 traverse + 인라인 remediation' 루프는 닫지 않는다. Track B 의 인과 traverse UX 는 IMP-58 COP 표면에서 이미/후속으로 다룬다. 이 스펙은 그 traverse 가 딛고 설 **하드웨어 근거 필드**를 공급한다.

## 해결 (What)

DCGM 확정 필드명(deep-research 검증)으로 `GpuHardware` 를 정의하고 `GPUDevice.hw?` 로 부착, 결정적 mock 생성 + 하드웨어 섹션 렌더.

### 필드셋 (EXACT DCGM 필드명 — 열거 가능 확정)

- `xidError` ← `DCGM_FI_DEV_XID_ERRORS` (230). **gauge 로 "가장 최근 XID 코드 1개"만 담는다** — 카운터도, 이벤트 스트림도 아님. → **"최근 XID"로만 표기**(코드 1개 + enum→사람 라벨 맵). 가짜 다중-XID 타임라인 금지. 전체 fault history 는 kubelet/nvidia-device-plugin 이벤트 또는 dmesg `Xid` 파싱 필요 → **out of scope(spec note)**.
- `clocksEventReasons` ← `DCGM_FI_DEV_CLOCKS_EVENT_REASONS` (112). **단일 비트마스크** → 사람이 읽는 throttle-reason 리스트로 디코드(thermal / power / board / sync-boost / reliability). 실 수집은 **opt-in**(exporter counter-CSV 편집 + per-reason 카운터) → IMP-79 spike 로 게이팅(spec note).
- `nvlink` { `throughput` L0–L5 (KiB/s), `crcErrors`·`replayErrors`·`recoveryErrors` (fields 400–445) }
- `pcie` { `txBytes`/`rxBytes` (1009/1010, bytes), `replayCounter` (202, count) }
- `ecc` { `sbeVolatile`/`dbeVolatile`/`sbeAggregate`/`dbeAggregate` (310–313, count) }
- `smClock`/`memClock` (100/101, MHz)
- `perProcess` (205 accounting) — DCGM per-process 는 accounting 활성 필요 + time-sharing/MIG 제약 → 대표 프로세스 목록만(spec note).

### 렌더 (하드웨어 섹션)

`GpuHardwareSection` 컴포넌트(단일 출처) — Gpu.tsx SlidePanel + ObjectView 양쪽에서 재사용. 그룹:

1. **Clocks** — SM/Mem clock (MHz)
2. **Interconnect** — PCIe tx/rx(자동 단위 B→KiB→MiB→GiB) + replay(count) · NVLink 합계 throughput(KiB/s) + link별 미니 표 + CRC/replay/recovery(count)
3. **Errors** — ECC SBE/DBE volatile·aggregate(count) + 최근 XID 뱃지(코드+라벨)
4. **Throttle** — clocksEventReasons 디코드 → reason 뱃지 리스트(없으면 "제약 없음")

- 최근-XID·throttle-reason 은 `Badge`(objectTypeVisual 톤) 로. 값마다 **단위 병기**(bytes vs MiB, W, MHz, count vs rate). 상태 색 + 텍스트 병기(WCAG 1.4.1).

## 설계 (How)

- **types.ts (additive)**: `GpuHardware` + 하위 인터페이스(`NvlinkStats`/`PcieStats`/`EccStats`/`GpuProcess`) + `XidCode`(라벨 맵 키) 추가. `GPUDevice.hw?: GpuHardware` 옵션 필드.
- **mock.ts**:
  - `XID_LABELS: Record<number, string>` (대표 XID 코드 enum→한글 라벨) + `xidLabel(code)`.
  - `CLOCK_EVENT_BITS`(비트→reason 라벨) + `decodeClocksEventReasons(mask): string[]` (순수, export — 테스트 가드).
  - `genGpuHardware(seedKey: string): GpuHardware` — `hash(seedKey)` + `rng` 로 전 필드 결정적 생성(mockFactory 재사용). idle/thermal 시나리오와 정합(온도 높으면 thermal 비트·throttle).
  - `genGPU()`: 각 device 에 `hw: genGpuHardware(uuid)` 부착.
  - `buildOntology()`: GpuDevice 객체 props 에 `genGpuHardware(gpuId)` 로 파생한 하드웨어 필드를 **평탄화/중첩**해 얹는다(ObjectView 가 읽도록). throttle/xid 는 props 에 요약 키로.
- **components/GpuHardwareSection.tsx (신규)**: `GpuHardware` 를 받아 그룹 카드 렌더. `formatBytes`(B/KiB/MiB/GiB) 헬퍼 포함.
- **ObjectView.tsx**: GpuDevice 타입이고 props 에 하드웨어가 있으면 'GPU 하드웨어' 섹션 렌더(Properties 아래). props → GpuHardware 재구성(mock 이 넣은 중첩 객체 소비).
- **Gpu.tsx**: SlidePanel 상세에 `detail.hw` 있으면 `GpuHardwareSection` 렌더.
- **재사용**: `hash`/`rng`/`clamp`(mockFactory), `Badge`, `DetailRow`, objectTypeVisual 톤. 신규 fetch 엔드포인트·prod 의존성 0.

## 데이터 계약

- `GpuHardware` 는 additive — 기존 GPUDevice 소비자(Gpu 테이블·LED·시계열)는 무변경.
- ontology GpuDevice props 는 하드웨어를 중첩(`hw`) + 요약 키(`xid_recent`, `throttle`)로 얹어 ObjectView Properties/badge 가 읽는다. dangling 링크·revision 규약 무변경.

## 테스트 케이스 (normal / retry / failure / bad-input / env-missing)

- **normal**: `fetchGPU()` device 에 `hw` 존재 · 모든 하위 필드(nvlink L0–L5·pcie tx/rx/replay·ecc 4종·sm/mem clock·perProcess) present · ObjectView GpuDevice 에 'GPU 하드웨어' 섹션 + 그룹 렌더 · 단위 라벨 표시.
- **retry (결정성)**: 같은 seedKey → `genGpuHardware` 동일 값. 같은 uuid 로 `fetchGPU` 두 번(같은 15s 버킷) → 동일 hw.
- **decode**: `decodeClocksEventReasons(mask)` 비트마스크 → 정확한 reason 리스트(0 → 빈 배열; thermal 비트 → ["thermal"] 포함). `xidLabel(code)` enum → 라벨(미지 코드 → fallback).
- **failure/bad-input**: `genGpuHardware("")` graceful(throw 없음, 유효 구조) · `xidLabel(-1)`/미지 코드 → fallback 라벨 · `decodeClocksEventReasons(0)` → `[]`.
- **env-missing**: GPUDevice 에 `hw` 없음(레거시/실백엔드 미제공) → 섹션 미렌더(페이지 안 죽음). ObjectView props 에 하드웨어 없으면 섹션 skip.
- **no regression**: 기존 gpu/ontology/mockFactory 테스트 전부 통과(additive).

## Out of scope

- 실 DCGM 수집(Prometheus 스크레이프, throttle-reason/PROF opt-in, profiling 모듈 로드 검증) → **IMP-79 spike** 선행.
- XID **전체 fault history/timeline**(230 은 최근 코드 1개 gauge) → kubelet/device-plugin 이벤트 · dmesg `Xid` 파싱 필요, 후속.
- Track B 인과 traverse·인라인 remediation UX(IMP-58/59 표면). MIG per-slice per-process 정밀 귀속.
