# IMP-32 — 트레이스 서버사이드 전문(full-text) 검색

## 목적
트레이스 화면은 현재 드롭다운 필터(decision/status/model/app)만 서버로 전달한다. 자유 텍스트로
입력/출력/메타를 가로질러 트레이스를 찾는 경로가 없다 — Langfuse/Phoenix 는 입출력 전문검색이
조사 워크플로의 핵심이다(출처: langfuse.com/changelog/2025-05-19-full-text-search,
community.arize.com Phoenix search syntax). 백엔드 `langfuse.Filters` 에 `q`(free-text) 를
추가해 trace 의 검색가능 필드를 가로질러 매칭하고, FE 는 IMP-24 useUrlState 와 정합되게 디바운스
검색창 + q 칩을 노출하며 기존 드롭다운 필터와 AND 결합한다.

이 코드베이스는 mock/in-memory + langfuse client 경유다. 실 ClickHouse 직결이 아니므로 ILIKE/
hasToken 대신 그 데이터 경로(synthetic 폴백 + 실연동 매핑)에 맞춰 q 필터를 구현한다.

## 위협 모델 / PII (SENSITIVE — 핵심)
트레이스 입력/출력 검색은 **마스킹된 콘텐츠 정책의 경계를 가로지른다.** 검색이 마스킹이 가려야 할
원문을 사용자가 우회 조회하는 통로가 되어서는 안 된다.

### 검색 대상 필드 화이트리스트 (allowlist — 명시)
검색은 아래 화이트리스트 필드만 코퍼스로 삼는다. 화이트리스트에 없는 것은 절대 검색 대상이 아니다.
- 메타 식별자: `trace_id`, `model`, `endpoint`, `app_id`, `dept_id`, `api_key_id`,
  `user_id`, `session_id`, `route`
- 분류 라벨: `decision`, `status`, `finish_reason`
- 입력/출력 **미리보기 텍스트**(`input_preview` / `output_preview`) — **단, 마스킹 정책을
  통과해 트레이스에 보존된 비-마스킹 텍스트에 한함.**

### 마스킹/가드 원문 제외 (exclude — 명시)
- **가드레일 차단 원문(`GuardContent.Input`)은 검색 코퍼스에 절대 포함하지 않는다.** 이 값은
  민감 데이터라 별도 엔드포인트(`GET /guard/content`)로 명시적 lazy 조회만 가능하며, 트레이스
  목록 응답에도 들어있지 않다. q 필터는 이 경로를 건드리지 않는다.
- **차단(blocked) 트레이스의 input_preview 는 원문이 아니라 `[차단됨] …` 플레이스홀더**다(synth/
  mock 양쪽 동일). 따라서 차단 원문은 코퍼스에 처음부터 존재하지 않는다 → q 로도 조회 불가.
- 마스킹 정책(`MaskingPolicy`)이 `CaptureNone`/`CaptureMasked` 로 가린 원문은 트레이스에
  보존되지 않거나 마스킹된 형태로만 보존된다. 검색은 "트레이스에 보존된 텍스트"만 대상으로 하므로,
  마스킹이 제거/해시/부분가림한 원문은 정의상 코퍼스에 없다 → q 가 원문을 복원·노출할 수 없다.

### 왜 검색이 마스킹 콘텐츠를 누설할 수 없는가
검색은 "이미 트레이스에 들어있는(=정책을 통과한) 텍스트"의 부분일치만 본다. 마스킹/차단 원문은
그 텍스트가 아니다(별도 보호 경로이거나 플레이스홀더로 치환됨). 즉 q 는 **새 데이터 노출 채널을
만들지 않는다** — 이미 트레이스 상세에서 볼 수 있는 미리보기와 메타만 검색 가능하게 한다. 실
ClickHouse 도입 시에도 동일 원칙: 검색 컬럼 allowlist 에 마스킹-원문 컬럼을 절대 넣지 않는다(아래
"미해결/리뷰어 확인" 참조).

## API 계약 (q 는 가산적 = 하위호환)
- `q` 파라미터는 **추가(additive)** 다. 기존 필터(decision/status/model/app)는 변경 없이 그대로
  동작한다. `q` 미지정/빈 문자열이면 필터 미적용(기존 동작과 동일).
- `GET /api/v1/traces?range=&decision=&status=&model=&app=&q=` — q 만 신규.
- 기존 클라이언트(q 미전송)는 동작 변화 없음. 응답 스키마(`TraceListReport`)는 불변.

## 함수 시그니처
### 백엔드
- `langfuse.Filters` 에 `Q string` 추가:
  `type Filters struct{ Decision, Status, Model, App, Q string }`
- `langfuse.traceMatchesQ(s domain.TraceSummary, inputPrev, outputPrev, q string) bool` —
  화이트리스트 필드 + 미리보기 텍스트에 대해 대소문자 무시 부분일치(AND 토큰). 빈 q 는 true.
- `langfuse.searchableText(s domain.TraceSummary, inputPrev, outputPrev string) string` —
  화이트리스트 필드만 모은 lower-case 코퍼스 문자열(가드 원문/마스킹 원문 제외).
- synth 목록 경로(`synthTraceList`)는 trace 당 동일 시드로 미리보기를 결정적으로 도출해
  (`synthPreview(seed, decision)`) q 매칭에 사용. 실연동 경로(`tracesLive`)는 trace.input/
  output 매핑값을 미리보기로 쓰되 동일 매칭 함수 적용.
- 핸들러(`handleTraces`): `f.Q = strings.TrimSpace(q.Get("q"))` 파싱(가산).
### 프론트
- `fetchTraces(range, filters?, signal?)` 의 filters 에 `q?: string` 추가 → q 가 있으면
  `q.set("q", v)`(빈 문자열 제외).
- `Traces.tsx` TRACE_SCHEMA 에 `q: strField("")` 추가(useUrlState). 디바운스 검색창
  (`patch({ q }, { debounce: true })`) + 활성 시 q 칩(지우기 버튼). 드롭다운 필터와 AND 결합
  (서버가 AND 처리 — FE 는 q 를 filters 에 실어 보냄).

## 테스트케이스
1. **q 가 input/output(미리보기) 매칭**: 특정 미리보기 텍스트 토큰으로 q → 해당 트레이스만 잔존.
2. **q 가 메타(model/app/decision) 매칭**: model 명 일부로 q → 그 모델 트레이스만.
3. **마스킹/차단 원문은 검색 불가**: 차단 트레이스의 (가려진) 원문 토큰("DAN", "주민번호" 등
   guard 원문 어휘)으로 q → **0건**(코퍼스에 없음). 차단 트레이스는 `[차단됨]` 플레이스홀더
   토큰으로만 검색됨.
4. **드롭다운 필터와 AND 결합**: decision=blocked + q=<메타토큰> → 둘 다 만족하는 것만.
5. **빈 q = 필터 미적용**: q="" → 기존 목록과 동일 건수.
6. **FE**: 검색창 입력 → useUrlState q 갱신(debounce), q 칩 노출/지우기, fetchTraces 가 q 전달.

## 출력 위치
- 백엔드: `backend/internal/langfuse/client.go`(Filters.Q + 매칭 헬퍼 + tracesLive 적용),
  `backend/internal/langfuse/synth.go`(synthTraceList q 적용 + synthPreview),
  `backend/internal/server/traces.go`(handleTraces q 파싱),
  `backend/internal/langfuse/search_test.go`(신규 Go 테스트).
- 프론트: `web/src/api/client.ts`(fetchTraces q), `web/src/api/mock.ts`(genTraceList q),
  `web/src/pages/Traces.tsx`(검색창 + q 칩 + 스키마), `web/src/urlState.test.ts` 또는
  `web/src/pages/Traces.search.test.tsx`(FE 테스트).

## 의존성
없음(zero new deps). useUrlState debounce(IMP-24), strField 재사용.
