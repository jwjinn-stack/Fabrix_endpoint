// IMP-108 — 전역 glossary-as-data 단일 출처(순수·의존성 0·결정적).
//
// IMP-97 statusGlossary(인시던트 상태 7개)를 관측 도메인 전반으로 승격.
// 어시스트 rule-based 폴백(IMP-104 explain-this)·explain_term MCP resource(IMP-106)·
// widgetMeta relatedTerms(IMP-105)가 이 하나만 인용 → 표면 간 용어 문구가 갈라지지 않는다.
// '가장 경험 적은 온콜' 기준 — 짧은 정의(short) + 왜 중요한가(why)를 한 줄씩(정보폭탄 금지).
//
// 상태 7개 term의 렌더는 statusGlossary.ts(IMP-97 하위셋 re-export) + StatusInfoTip 이 담당(회귀 0).

// 용어 분류 — 표면이 카테고리별 그룹핑/필터에 사용.
export type GlossaryCategory =
  | "incident-status" // 인시던트 상태 배지
  | "latency" // 지연/응답 시간
  | "gpu" // GPU 하드웨어/자원
  | "traffic"; // 트래픽/처리율/비용

export interface GlossaryTerm {
  term: string; // 표시 라벨(사람용)
  short: string; // 한 줄 정의
  why?: string; // 왜 중요한가(선택) — 초심자 판단 보조
  category: GlossaryCategory; // 분류(그룹핑/필터)
  aliases?: string[]; // 영문·검색 동의어(예: "TTFT" → "time to first token")
  relatedKeys?: string[]; // 연관 glossary key(탐색용)
}

// 전역 용어 단일 출처. key 는 소문자 안정 식별자(배지/상태 문자열·검색어와 매핑).
export const GLOSSARY: Record<string, GlossaryTerm> = {
  // ── incident-status(IMP-97 원본 문구 유지 — 회귀 0) ─────────────────────
  triggered: {
    term: "발생·미확인",
    short: "알림이 방금 울렸고 아직 아무도 확인(ack)하지 않은 상태입니다.",
    why: "가장 먼저 손봐야 할 후보 — 확인·배정으로 담당자를 지정하세요.",
    category: "incident-status",
    aliases: ["triggered", "unacked", "미확인"],
    relatedKeys: ["acked", "crit"],
  },
  acked: {
    term: "확인·배정됨",
    short: "누군가 이미 확인(ack)하고 담당으로 잡은 상태입니다.",
    why: "중복 대응을 피하려면 배정자를 확인하고 진행 상황을 이어받으세요.",
    category: "incident-status",
    aliases: ["acked", "acknowledged", "확인됨"],
    relatedKeys: ["triggered"],
  },
  notready: {
    term: "파드 미기동(NotReady)",
    short: "쿠버네티스 파드가 아직 준비(Ready)되지 않아 요청을 받지 못하는 상태입니다.",
    why: "기동 실패·크래시 루프·자원 부족 정황 — 가용 레플리카가 줄어 처리량이 떨어집니다.",
    category: "incident-status",
    aliases: ["notready", "not ready", "미기동"],
    relatedKeys: ["replica", "cordon"],
  },
  backpressure: {
    term: "backpressure(유입>처리율)",
    short: "들어오는 요청이 처리 속도를 넘어서 대기 큐가 쌓이는 상태입니다.",
    why: "동시성 한도·대형 prefill 정황 — 대기 시간(TTFT)이 함께 올라 사용자 지연으로 이어집니다.",
    category: "incident-status",
    aliases: ["backpressure", "back-pressure", "역압", "적체"],
    relatedKeys: ["queue-depth", "concurrency", "ttft", "prefill"],
  },
  warn: {
    term: "주의(warn)",
    short: "값이 주의 임계선을 넘었습니다 — 아직 위험은 아니지만 추세를 지켜봐야 합니다.",
    why: "지금 원인을 좁혀 두면 위험(crit)으로 번지기 전에 막을 수 있습니다.",
    category: "incident-status",
    aliases: ["warn", "warning", "주의"],
    relatedKeys: ["crit", "slo"],
  },
  crit: {
    term: "위험(crit)",
    short: "값이 위험 임계선을 넘어 사용자 영향이 진행 중일 가능성이 큽니다.",
    why: "가장 우선 대응 대상 — 근거(신호→추정원인→영향)를 확인하고 조치하세요.",
    category: "incident-status",
    aliases: ["crit", "critical", "위험"],
    relatedKeys: ["warn", "blast"],
  },
  blast: {
    term: "영향 확산(blast-radius)",
    short: "하나의 원인이 관계 그래프를 타고 여러 대상으로 번진 범위입니다.",
    why: "같은 노드/GPU를 공유하는 다른 서비스까지 영향받는지 함께 봐야 합니다.",
    category: "incident-status",
    aliases: ["blast", "blast radius", "blast-radius", "영향 확산"],
    relatedKeys: ["crit", "nvlink"],
  },

  // ── latency(지연/응답) ──────────────────────────────────────────────────
  ttft: {
    term: "TTFT(첫 토큰까지 시간)",
    short: "요청을 보낸 뒤 첫 응답 토큰이 나오기까지 걸린 시간입니다.",
    why: "체감 응답성의 핵심 — prefill 지연·대기 큐가 길어지면 함께 올라갑니다.",
    category: "latency",
    aliases: ["ttft", "time to first token", "첫 토큰"],
    relatedKeys: ["prefill", "backpressure", "p95"],
  },
  p95: {
    term: "p95(95백분위 지연)",
    short: "요청 100건 중 95번째로 느린 값 — 평균이 숨기는 꼬리 지연을 봅니다.",
    why: "SLO 판정 기준으로 흔히 쓰임 — 소수 사용자의 나쁜 경험을 잡아냅니다.",
    category: "latency",
    aliases: ["p95", "95th percentile", "95백분위"],
    relatedKeys: ["p99", "slo", "ttft"],
  },
  p99: {
    term: "p99(99백분위 지연)",
    short: "요청 100건 중 99번째로 느린 값 — 극단 꼬리 지연을 봅니다.",
    why: "p95는 정상이어도 p99가 튀면 특정 조건(대형 요청·자원 경합) 정황입니다.",
    category: "latency",
    aliases: ["p99", "99th percentile", "99백분위"],
    relatedKeys: ["p95", "slo"],
  },
  prefill: {
    term: "prefill(입력 처리 단계)",
    short: "모델이 입력 프롬프트 전체를 한 번에 읽어 KV 캐시를 채우는 단계입니다.",
    why: "긴 입력일수록 오래 걸려 TTFT를 좌우 — 첫 토큰 지연의 주 원인입니다.",
    category: "latency",
    aliases: ["prefill", "pre-fill", "입력 처리"],
    relatedKeys: ["decode", "ttft"],
  },
  decode: {
    term: "decode(토큰 생성 단계)",
    short: "prefill 이후 토큰을 하나씩 이어서 생성하는 단계입니다.",
    why: "출력 길이·동시성에 비례해 처리량을 결정 — 토큰당 지연을 봅니다.",
    category: "latency",
    aliases: ["decode", "generation", "생성"],
    relatedKeys: ["prefill", "concurrency"],
  },
  slo: {
    term: "SLO(서비스 수준 목표)",
    short: "지연·에러율 등에 대해 지키기로 한 목표 임계선입니다.",
    why: "정상/이상 판정의 기준선 — 이 선을 넘으면 인시던트 후보가 됩니다.",
    category: "latency",
    aliases: ["slo", "service level objective", "서비스 수준 목표"],
    relatedKeys: ["p95", "error-rate", "warn"],
  },

  // ── gpu(하드웨어/자원) ──────────────────────────────────────────────────
  xid: {
    term: "XID(GPU 오류 코드)",
    short: "NVIDIA GPU가 커널에 보고하는 하드웨어/드라이버 오류 코드입니다.",
    why: "특정 XID는 ECC·과열·재부팅 신호 — 파드 크래시의 근본 원인일 수 있습니다.",
    category: "gpu",
    aliases: ["xid", "xid error", "gpu error code"],
    relatedKeys: ["ecc", "nvlink"],
  },
  nvlink: {
    term: "NVLink(GPU 간 고속 링크)",
    short: "여러 GPU를 직접 잇는 고대역폭 인터커넥트입니다.",
    why: "멀티-GPU 추론의 병목 지점 — 링크 저하 시 처리량이 급감합니다.",
    category: "gpu",
    aliases: ["nvlink", "nv-link", "nvlink link"],
    relatedKeys: ["pcie", "blast"],
  },
  pcie: {
    term: "PCIe(호스트-장치 버스)",
    short: "CPU/메모리와 GPU를 잇는 시스템 버스입니다.",
    why: "대역폭 저하·다운그레이드 시 데이터 전송 지연 — 처리량 병목이 됩니다.",
    category: "gpu",
    aliases: ["pcie", "pci-e", "pci express"],
    relatedKeys: ["nvlink"],
  },
  ecc: {
    term: "ECC(오류 정정 메모리)",
    short: "GPU 메모리의 비트 오류를 감지·정정하는 기능입니다.",
    why: "정정불가(uncorrectable) 오류가 쌓이면 XID·파드 크래시로 이어집니다.",
    category: "gpu",
    aliases: ["ecc", "ecc error", "error correcting code"],
    relatedKeys: ["xid"],
  },
  replica: {
    term: "replica(레플리카)",
    short: "동일 모델을 서빙하는 파드 사본의 수입니다.",
    why: "가용 레플리카가 줄면 남은 파드에 부하가 몰려 지연·backpressure가 커집니다.",
    category: "gpu",
    aliases: ["replica", "replicas", "레플리카"],
    relatedKeys: ["notready", "cordon", "drain"],
  },
  cordon: {
    term: "cordon(스케줄 차단)",
    short: "노드에 새 파드가 배치되지 않도록 표시하는 조작입니다(기존 파드는 유지).",
    why: "문제 노드 격리의 첫 단계 — drain 전에 신규 유입만 먼저 막습니다.",
    category: "gpu",
    aliases: ["cordon", "코든", "스케줄 차단"],
    relatedKeys: ["drain", "notready"],
  },
  drain: {
    term: "drain(파드 축출)",
    short: "노드의 기존 파드를 안전하게 다른 노드로 옮기는 조작입니다.",
    why: "cordon 이후 문제 노드를 완전히 비울 때 사용 — 서비스 중단 최소화가 관건입니다.",
    category: "gpu",
    aliases: ["drain", "드레인", "파드 축출"],
    relatedKeys: ["cordon", "replica"],
  },

  // ── traffic(트래픽/처리율/비용) ────────────────────────────────────────
  throttle: {
    term: "throttle(요청 제한)",
    short: "과부하를 막으려 요청을 의도적으로 지연·거부하는 조치입니다.",
    why: "429/거부가 늘면 사용자 영향 — 왜 걸렸는지(reason)를 함께 봐야 합니다.",
    category: "traffic",
    aliases: ["throttle", "throttling", "rate limit", "요청 제한"],
    relatedKeys: ["throttle-reason", "block-rate", "qps"],
  },
  "throttle-reason": {
    term: "throttle 사유",
    short: "요청이 제한된 이유(동시성 한도·쿼터·backpressure 등)입니다.",
    why: "사유별로 대응이 다름 — 쿼터면 증설, backpressure면 부하 완화입니다.",
    category: "traffic",
    aliases: ["throttle reason", "throttle-reason", "제한 사유"],
    relatedKeys: ["throttle", "backpressure", "concurrency"],
  },
  "error-rate": {
    term: "에러율(error-rate)",
    short: "전체 요청 대비 실패(5xx 등) 요청의 비율입니다.",
    why: "SLO 위반의 직접 신호 — 급등 시 배포·의존성·자원을 함께 살핍니다.",
    category: "traffic",
    aliases: ["error rate", "error-rate", "에러율", "실패율"],
    relatedKeys: ["block-rate", "slo"],
  },
  "block-rate": {
    term: "차단율(block-rate)",
    short: "가드레일·정책에 의해 차단된 요청의 비율입니다.",
    why: "정상 요청이 과차단되는지, 위협이 실제 늘었는지 구분해야 합니다.",
    category: "traffic",
    aliases: ["block rate", "block-rate", "차단율"],
    relatedKeys: ["error-rate", "throttle"],
  },
  qps: {
    term: "QPS(초당 요청 수)",
    short: "초당 처리되는 요청 건수 — 트래픽 규모의 기본 지표입니다.",
    why: "급증 시 backpressure·throttle의 선행 신호 — 용량 대비로 봅니다.",
    category: "traffic",
    aliases: ["qps", "queries per second", "rps", "초당 요청"],
    relatedKeys: ["concurrency", "backpressure"],
  },
  "token-cost": {
    term: "토큰 비용(token-cost)",
    short: "처리한 입력·출력 토큰 수에 비례해 발생하는 비용입니다.",
    why: "트래픽·프롬프트 길이 급증 시 비용이 함께 뜀 — 예산·효율 판단에 씁니다.",
    category: "traffic",
    aliases: ["token cost", "token-cost", "토큰비용", "토큰 비용"],
    relatedKeys: ["qps", "prefill"],
  },
  "queue-depth": {
    term: "큐 적체 깊이(queue-depth)",
    short: "처리를 기다리며 대기 큐에 쌓인 요청 수입니다.",
    why: "깊어질수록 대기 시간(TTFT) 증가 — backpressure의 직접 척도입니다.",
    category: "traffic",
    aliases: ["queue depth", "queue-depth", "대기 큐", "큐 깊이", "waiting"],
    relatedKeys: ["backpressure", "concurrency", "ttft"],
  },
  concurrency: {
    term: "동시성(concurrency)",
    short: "같은 시점에 동시에 처리 중인 요청 수입니다.",
    why: "한도를 넘으면 대기 큐가 쌓임 — backpressure·throttle의 근원입니다.",
    category: "traffic",
    aliases: ["concurrency", "동시성", "in-flight"],
    relatedKeys: ["queue-depth", "backpressure", "throttle-reason"],
  },
};

// 상태 7개 key(IMP-97 하위셋 — statusGlossary re-export 가 파생).
export const STATUS_TERM_KEYS = [
  "triggered",
  "acked",
  "notready",
  "backpressure",
  "warn",
  "crit",
  "blast",
] as const;

// glossary 조회 헬퍼 — 미지 key 는 undefined(호출부가 렌더 skip).
export function glossaryTerm(key: string): GlossaryTerm | undefined {
  return GLOSSARY[key];
}

// lookupTerm — key OR alias 로 해석(대소문자 무시). 미지 용어는 null(환각 금지).
// 어시스트 rule-based 폴백(IMP-104)·explain_term(IMP-106)이 사용자 입력을 해석하는 진입점.
export function lookupTerm(query: string): GlossaryTerm | null {
  if (!query) return null;
  const q = query.trim().toLowerCase();
  if (!q) return null;
  // 1) key 완전일치
  const byKey = GLOSSARY[q];
  if (byKey) return byKey;
  // 2) alias 완전일치(대소문자 무시)
  for (const term of Object.values(GLOSSARY)) {
    if (term.aliases?.some((a) => a.toLowerCase() === q)) return term;
  }
  // 3) 없으면 null — 없는 용어를 지어내지 않는다.
  return null;
}
