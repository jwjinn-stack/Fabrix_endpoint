// 풀-피델리티 GPU 하드웨어 — 도메인 로직(IMP-76 track A). mock/실백엔드 무관 순수 디코더.
// DCGM 확정 필드(XID·clocksEventReasons)를 사람이 읽는 라벨로 변환한다. UI(GpuHardwareSection)와
// mock 생성기(mock.ts genGpuHardware)가 공유하는 단일 출처 — 프로덕션 컴포넌트가 mock 을 import 하지 않게.

// 대표 XID 코드 → 사람이 읽는 라벨. DCGM_FI_DEV_XID_ERRORS(230)는 "가장 최근 코드 1개"만 담는 gauge.
// (전체 이력은 dmesg/kubelet 파싱 필요 — out of scope). 0 = 최근 XID 없음(정상).
export const XID_LABELS: Record<number, string> = {
  0: "정상(XID 없음)",
  13: "Graphics Engine Exception",
  31: "GPU 메모리 페이지 폴트",
  43: "GPU가 SW 에 의해 중단됨",
  48: "Double-Bit ECC 오류(DBE)",
  63: "ECC 페이지 리타이어/리매핑 이벤트",
  74: "NVLink 오류",
  79: "GPU가 버스에서 사라짐(fallen off the bus)",
  94: "정정 불가 ECC 오류(contained)",
};

// XID 코드 → 라벨(미지 코드는 fallback). 음수/미등록도 graceful.
export function xidLabel(code: number): string {
  return XID_LABELS[code] ?? `XID ${code} (미분류)`;
}

// clock-throttle 사유 비트마스크 — DCGM_FI_DEV_CLOCKS_EVENT_REASONS(112) 비트 정의.
// 단일 비트마스크를 사람이 읽는 reason 리스트로 디코드. 값은 NVML nvmlClocksEventReason* 상수.
export const CLOCK_EVENT_BITS: { bit: number; reason: string }[] = [
  { bit: 0x0000000000000001, reason: "유휴(GpuIdle)" },
  { bit: 0x0000000000000002, reason: "애플리케이션 클럭 설정" },
  { bit: 0x0000000000000004, reason: "전력(SW Power Cap)" },
  { bit: 0x0000000000000008, reason: "열(HW Thermal Slowdown)" },
  { bit: 0x0000000000000010, reason: "HW 전력 제동(HW Power Brake)" },
  { bit: 0x0000000000000020, reason: "동기 부스트(Sync Boost)" },
  { bit: 0x0000000000000040, reason: "SW 열 제동(SW Thermal)" },
  { bit: 0x0000000000000080, reason: "신뢰성 저하(Reliability)" },
  { bit: 0x0000000000000100, reason: "보드 한계(Board Limit)" },
  { bit: 0x0000000000000200, reason: "저전력 상태(Low Utilization)" },
];

// 비트마스크 → reason 라벨 리스트. 0 → 빈 배열(제약 없음). 순수 — 테스트 가드.
export function decodeClocksEventReasons(mask: number): string[] {
  if (!mask || mask < 0) return [];
  return CLOCK_EVENT_BITS.filter((b) => (mask & b.bit) !== 0).map((b) => b.reason);
}
