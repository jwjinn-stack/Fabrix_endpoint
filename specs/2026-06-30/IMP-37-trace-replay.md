# IMP-37 — 트레이스 → 플레이그라운드 replay/re-run 경로

## 목적
트레이스 상세에서 튀는 요청(고지연·차단·에러)을 발견했을 때, 그 요청의 prompt/model/params 를
플레이그라운드에 그대로 실어 즉시 재현·수정·재평가하는 디버깅 루프를 연다.
Phoenix(Span Replay)·Langfuse(Open in Playground) 의 핵심 패턴.
지금은 진입점이 0건 — Playground.tsx:293 에 멀티모델 compare 가 이미 있으나 replay 진입로가 없다.

## 현 스키마 제약 (중요 — 함정 회피의 정직한 경계)
- `TraceSummary`/`TraceDetail` 에는 **raw 멀티턴 messages 도, 구조화된 params(temperature/top_p/max_tokens) 도 없다.**
  - 보유: `summary.model`(모델 id), `detail.input_preview`(사용자 입력 1건 문자열), `detail.output_preview`,
    span `attributes`(`gen_ai.request.*` 등 — temperature/top_p 는 mock 에 미계측, model/stream/finish 만).
- 따라서 MVP 페이로드는 trace 에서 **확실히 복원 가능한 것만** 시드한다:
  - `model` = `summary.model`
  - `prompt`(단일 user 메시지) = `input_preview`
  - `params` = span attributes 에서 추출 가능하면(temperature/top_p/max_tokens 의 OTel/Langfuse 공통 키) 사용,
    없으면 Playground 기본값 유지(억지 추정 금지).
- **차단(blocked) 트레이스**: `input_preview` 는 mock 에서 "[차단됨] …" 플레이스홀더라 원문이 없다.
  replay 는 가능하되, 차단 원문은 보존되지 않음을 prefill 노트로 남긴다(원문 복원은 follow-up).

## 요구사항 (MVP)
1. **진입점**: 트레이스 상세 패널(SlidePanel 안 `TraceDetailView`)에 "플레이그라운드에서 재현" 버튼.
   - `onNavigate('playground', { model })` 호출 + 리치 prefill 은 모듈 핸드오프로 전달.
2. **페이로드 전달 경로**(URL 비대상 — 프롬프트/파라미터는 URL 에 싣지 않음):
   - `web/src/pages/playgroundPrefill.ts` — 1회성 in-memory 핸드오프(set/take). 새 의존성 0.
   - model 은 기존 `NavParams.model`(URL `?model=`) 로도 전달 → 새로고침/딥링크에도 모델은 복원.
3. **Playground 시드**: 마운트 시 `takePrefill()` 로 핸드오프를 1회 소비 →
   `input`(프롬프트) · `model`(initialModel 우선) · `maxTokens`/`temperature`(있을 때만) 시드 + 출처 배너.
4. **profile/mutating 게이트**: observe 는 추론 호출 불가일 수 있음.
   - replay 버튼은 `useCap().can("playground")` 가 false 면 **disable + 안내 title**.

## 비목표 / follow-up (half-구현 금지)
- (follow-up) trace span attributes 에 raw messages/tools/변수까지 계측되면 그대로 시드.
- (follow-up) compare() 결합 — replay 출력 vs **원본 trace 출력** 나란히(compareRows 에 '원본(trace)' 컬럼).
  현 스키마는 단일 input_preview 만이라 원본 컬럼은 미루고, MVP 는 입력+params 시드에 집중.
- (follow-up) 차단 트레이스 원문 복원 + 가드 재분류 표시.

## 함수 시그니처
```ts
// playgroundPrefill.ts
export interface PlaygroundPrefill {
  prompt: string;            // 단일 user 메시지(input_preview 등)
  model?: string;            // 모델 id
  maxTokens?: number;        // 있을 때만
  temperature?: number;      // 있을 때만
  origin?: string;           // 배너용 출처 라벨(예: "트레이스 t_abc")
  note?: string;             // 보존 한계 안내(예: 차단 원문 없음)
}
export function setPrefill(p: PlaygroundPrefill): void;
export function takePrefill(): PlaygroundPrefill | null; // 소비 후 비움(1회성)

// Traces.tsx — TraceDetailView 안
function buildReplayPrefill(detail: TraceDetail): PlaygroundPrefill;
// onReplay = () => { setPrefill(buildReplayPrefill(detail)); onNavigate("playground", { model: detail.summary.model }); }

// Traces 컴포넌트는 onNavigate?: NavFn 를 받음(App.tsx 에서 navigate 주입).
```

## 테스트 케이스 (RTL / vitest)
- T1: 상세 패널에 "플레이그라운드에서 재현" 버튼 노출(detail 로드 후).
- T2: 클릭 → `onNavigate("playground", { model })` 호출 + `takePrefill()` 가 prompt/model 을 담아 반환.
- T3: Playground 마운트 시 prefill 이 input 에 시드되고, params(temperature/maxTokens) 가 있으면 슬라이더 값 복원.
- T4: observe(can("playground")=false) 면 재현 버튼 disabled.
- T5: `takePrefill()` 은 1회성 — 두 번째 호출은 null(중복 시드/뒤로가기 재시드 방지).

## 출력 위치
- `web/src/pages/playgroundPrefill.ts` (신규, 의존성 0)
- `web/src/pages/Traces.tsx` (재현 버튼 + onNavigate prop)
- `web/src/pages/Playground.tsx` (마운트 시 prefill 소비/시드 + 출처 배너)
- `web/src/App.tsx` (`<Traces onNavigate={navigate} />`)
- `web/src/pages/Traces.replay.test.tsx`, `web/src/pages/Playground.prefill.test.tsx` (신규 테스트)

## 의존성
none (ZERO new deps). 기존 Playground 추론 경로 재사용(observe 게이트 존중). BFF 변경 없음.
```
```
