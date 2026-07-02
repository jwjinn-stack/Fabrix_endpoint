// IMP-97 — 인시던트 상태 용어 glossary 단일 출처(순수·의존성 0).
//
// COP(Investigate)·KineticStrip·ObjectView 의 상태 배지(triggered/acked·NotReady·warn/crit·backpressure)를
// 화면 clutter 없이 in-flow 자가설명(tooltip-on-demand). 세 표면이 이 하나만 소비해 문구가 갈라지지 않게 한다.
// '가장 경험 적은 온콜' 기준 — 짧은 정의(short) + 왜 중요한가(why)를 한 줄씩(정보폭탄 금지).
//
// 렌더는 StatusInfoTip(IMP-4 InfoTip 재사용, hover+focus+tap·Esc dismiss·not hover-only) 이 담당.

export interface GlossaryTerm {
  term: string;   // 표시 라벨(사람용)
  short: string;  // 한 줄 정의
  why?: string;   // 왜 중요한가(선택) — 초심자 판단 보조
}

// 상태 용어 단일 출처. key 는 소문자 안정 식별자(배지/상태 문자열과 매핑).
export const STATUS_GLOSSARY: Record<string, GlossaryTerm> = {
  triggered: {
    term: "발생·미확인",
    short: "알림이 방금 울렸고 아직 아무도 확인(ack)하지 않은 상태입니다.",
    why: "가장 먼저 손봐야 할 후보 — 확인·배정으로 담당자를 지정하세요.",
  },
  acked: {
    term: "확인·배정됨",
    short: "누군가 이미 확인(ack)하고 담당으로 잡은 상태입니다.",
    why: "중복 대응을 피하려면 배정자를 확인하고 진행 상황을 이어받으세요.",
  },
  notready: {
    term: "파드 미기동(NotReady)",
    short: "쿠버네티스 파드가 아직 준비(Ready)되지 않아 요청을 받지 못하는 상태입니다.",
    why: "기동 실패·크래시 루프·자원 부족 정황 — 가용 레플리카가 줄어 처리량이 떨어집니다.",
  },
  backpressure: {
    term: "backpressure(유입>처리율)",
    short: "들어오는 요청이 처리 속도를 넘어서 대기 큐가 쌓이는 상태입니다.",
    why: "동시성 한도·대형 prefill 정황 — 대기 시간(TTFT)이 함께 올라 사용자 지연으로 이어집니다.",
  },
  warn: {
    term: "주의(warn)",
    short: "값이 주의 임계선을 넘었습니다 — 아직 위험은 아니지만 추세를 지켜봐야 합니다.",
    why: "지금 원인을 좁혀 두면 위험(crit)으로 번지기 전에 막을 수 있습니다.",
  },
  crit: {
    term: "위험(crit)",
    short: "값이 위험 임계선을 넘어 사용자 영향이 진행 중일 가능성이 큽니다.",
    why: "가장 우선 대응 대상 — 근거(신호→추정원인→영향)를 확인하고 조치하세요.",
  },
  blast: {
    term: "영향 확산(blast-radius)",
    short: "하나의 원인이 관계 그래프를 타고 여러 대상으로 번진 범위입니다.",
    why: "같은 노드/GPU를 공유하는 다른 서비스까지 영향받는지 함께 봐야 합니다.",
  },
};

// glossary 조회 헬퍼 — 미지 key 는 undefined(호출부가 렌더 skip).
export function glossaryTerm(key: string): GlossaryTerm | undefined {
  return STATUS_GLOSSARY[key];
}
