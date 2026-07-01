// IMP-37 — 트레이스 → 플레이그라운드 replay 핸드오프.
//
// 프롬프트 원문·파라미터는 URL 에 싣지 않는다(누설·길이·인코딩 위험). 대신 화면 전환 직전
// 모듈 레벨 1회성 슬롯에 담아두고, 도착한 Playground 가 마운트 시 takePrefill() 로 1회 소비한다.
// model 만은 NavParams.model(URL ?model=) 로도 같이 넘겨 새로고침/딥링크에서도 모델이 복원되게 한다.
//
// 의존성 0. 단일 출처(모듈 클로저) — 1회성이라 뒤로가기/중복 마운트로 재시드되지 않는다.

export interface PlaygroundPrefill {
  // 단일 user 메시지(트레이스 input_preview 등). 빈 문자열이면 입력 시드를 생략한다.
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  // 배너용 출처 라벨(예: "트레이스 t_abc").
  origin?: string;
  // 보존 한계 안내(예: 차단 원문 없음 / 멀티턴 미보존).
  note?: string;
}

let pending: PlaygroundPrefill | null = null;

// setPrefill — 화면 전환 직전 replay 페이로드를 적재(이전 값 덮어씀).
export function setPrefill(p: PlaygroundPrefill): void {
  pending = p;
}

// takePrefill — 적재된 페이로드를 1회 소비(소비 후 비움). 없으면 null.
export function takePrefill(): PlaygroundPrefill | null {
  const p = pending;
  pending = null;
  return p;
}
