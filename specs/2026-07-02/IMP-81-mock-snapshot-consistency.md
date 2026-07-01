# IMP-81 — 온톨로지 mock 매 호출 재구성 + 결정적 agent 루프의 상태·성능 리스크 정리

- Type: code (sev=low). **동작 보존 리팩터**(no screen/mock output change).
- Branch: `feature/evolve-cycle5-active-ontology`
- 선행 성격: 파생 레이어(IMP-71 full metrics, IMP-72 detection, IMP-73 MCP)가
  **하나의 정합·메모이즈된 스냅샷** 위에서 얹히도록 정리한다.

## 배경 / 문제 (code-verified)

`web/src/api/mock.ts` 의 `buildOntology()` 는 objects/links 를 **매 호출마다 결정적으로 전부 재구성**한다.
현재 이를 fresh 하게 부르는 곳:

- `ontologyObjects()` (GET /ontology/objects)
- `ontologyObject()` (GET /ontology/objects/:id)
- `ontologyLinks()` (GET /ontology/objects/:id/links)
- `objectMetrics()` (GET /ontology/objects/:id/metrics)
- `applyAction()` (POST /ontology/actions/:name — 대상 snapshot 조회)
- `runAgentMock()` (POST /agent/run)

`buildOntology()` 는 내부적으로 `buildTopology()`, GPU마다 `genGpuHardware()`, `genTraceList()`(24h)
등을 재계산한다 → 한 요청에서 여러 파생이 각자 부르면 **O(N) 중복 재구성**.

두 가지 리스크:

1. **성능·중복**: 한 요청(예: /ontology/objects/:id/metrics)이 파생을 늘리면 rebuild 가 반복된다.
   KNOWN FLAKE: 온톨로지 404 테스트 스위트가 병렬 부하에서 ~1/8 간헐 타임아웃 — 반복 rebuild 비용과 연관 의심.
2. **정합(writeback vs 재구성)**: `applyAction` 은 상태 전이 결과를
   - (a) `ONTOLOGY_OVERRIDES[target]` 에 override 로 쓰고(다음 rebuild 가 `add()` 에서 얹음),
   - (b) 응답 `object` 는 **별도로 손수 조립**(`{ ...snapshot, status, revision, props }`).
   (a)의 rebuild-merge 와 (b)의 손조립이 **서로 다른 코드 경로**라 미묘하게 어긋날 여지가 있다
   (같은 객체가 직접 조회 vs 재구성으로 다르게 보일 위험). `revision` 필드(IMP-59)와 stale-write 409 는 이미 있다.

또한 `buildOntology()` 는 `Date.now()` 에 **전이적으로** 의존한다(`genTraceList` 의 `now`,
`genGpuHardware` 의 15초 버킷). 한 요청 안에서 여러 번 부르면 밀리초 경계에서 미세하게 다른 스냅샷이
나올 수 있어(트레이스 ts 등), "직접 조회 == 재구성 그래프" 를 요청 내에서 보장하려면 스냅샷 고정이 필요.

## 목표 / 비목표

- 목표: 한 요청에서 스냅샷을 **한 번만** 만들고 모든 파생이 공유(요청단위 메모이즈).
  writeback(provisional/reconciled) 상태와 buildOntology 재구성을 **revision 기준 단일 merge** 로 합쳐
  두 경로가 어긋나지 못하게 한다. 결정성 유지.
- 비목표: 화면/응답 스키마 변경 없음. 기존 테스트는 **무수정 통과**. 신규 UI 없음(시각 QA 없음).
  실제 추론(IMP-78)·detection(IMP-72)·full metric(IMP-71) 구현은 이 항목 범위 아님(이 스냅샷 위에 얹기만).

## 설계

### 1) 요청단위 스냅샷 메모이즈

- 모듈 스코프에 `SNAPSHOT_CACHE: OntologySnapshot | null` 추가.
- `buildOntology()` 는 캐시가 있으면 그대로 반환, 없으면 `buildOntologyFresh()`(기존 로직)로 만들어 캐시에 저장.
- `resetOntologySnapshot()` 이 캐시를 무효화한다.
- **요청 경계에서 초기화**: `route()` 진입(mock sleep 직후)에서 `resetOntologySnapshot()` 호출 →
  한 요청 내 모든 파생은 동일 스냅샷을 공유(값 안정 + 재구성 비용 1회). 요청이 끝나면(다음 요청 진입 시)
  캐시가 리셋되므로 시계열의 "살아있는" 변동(genTimeseries 등 온톨로지 밖 생성기)은 요청 사이에 그대로 유지.
- **mutation 후 무효화**: `applyAction` 이 `ONTOLOGY_OVERRIDES` 를 갱신하면 같은 요청에서 만든 캐시를
  무효화(`resetOntologySnapshot()`)해, 이후(다음 요청)의 rebuild 가 새 override 를 즉시 반영.

결정성 근거: `buildOntology()` 의 시각 의존은 (i) trace ts, (ii) GPU 15초 버킷뿐인데 둘 다
스냅샷을 요청당 1회 고정하므로 "같은 요청 내 반복 호출 == 동일 값"이 성립. 요청 간 결정성(같은 id 집합·
링크 집합)은 seed 고정(hash("topology"), `trace:${i}` 등)이라 기존과 동일하게 보존.

### 2) writeback ↔ 재구성 정합 (revision 단일 merge)

- override 를 canonical 에 얹는 로직을 **순수 함수 `mergeOverride(base, ov)`** 로 추출:
  `status = ov.status ?? base.status`, `revision = ov.revision ?? base.revision`,
  `props = ov.props ? { ...base.props, ...ov.props } : base.props`.
- `buildOntology()` 의 `add()` 가 이 함수를 쓴다(재구성 경로).
- `applyAction()` 이 상태 전이 결과 `object` 를 만들 때 **동일한 `mergeOverride`** 로 만든다
  (손조립 제거). 즉 direct-fetch(재구성) 와 action 응답 object 가 **같은 merge 함수**에서 나온다
  → 두 경로가 어긋날 수 없다.
- stale-write 409 경로(`body.revision < snapshot.revision`)와 idempotency 는 그대로.

### 3) 결정적 agent 루프의 순수/부작용 경계 정리

- `runAgentLoop`(api/agent.ts)는 이미 순수(스냅샷 주입 → 결과). `runAgentMock` 은
  (a) 스냅샷 주입(공유 스냅샷 사용), (b) transcript 를 `AGENT_AUDIT` 에 append 하는 **부작용**을 갖는다.
- 경계를 주석으로 명시: "순수 계산(runAgentLoop) vs mock 부작용(audit append)". 향후 실제 추론(IMP-78)은
  `runAgentLoop` 자리를 transport 로 스왑하고 audit append 는 그대로 두면 된다 — 이 seam 을 문서화.
- 동작 변화 없음(스텝 순서·후보·audit 키잉 그대로).

## 테스트 케이스 (신규 — 기존 패턴 재사용)

`src/api/ontology.consistency.test.ts` (신규):

1. **memoize(요청 내 일관 스냅샷)**: 한 요청으로 얻은 objects 와, 그 안의 각 object 를 참조하는
   links(같은 요청 흐름)가 서로 정합(dangling 없음) — 라우터가 요청 경계에서 리셋해도 응답 내부는 일관.
   (라우터를 통과하므로 "요청단위 메모이즈"가 응답을 깨지 않음을 가드.)
2. **writeback-merge 정합(direct == rebuilt)**: `submitAction` 으로 상태 전이 후,
   `fetchOntologyObject(id)`(직접) 와 `fetchOntologyObjects(type)` 안의 같은 id(재구성 그래프 뷰)가
   **status·revision·props.last_action 이 완전히 동일**. action 응답 object 와도 동일.
3. **409 stale-write 유지**: 낮은 revision 재시도 → `conflict` + 사유(정합 병합 후에도 그대로).
4. **결정성(요청 간)**: 반복 호출 시 같은 id 집합·같은 링크 집합(seed 고정).
5. **agent 루프 불변**: 같은 intent → 동일 step 종류 순서·동일 후보 objectId 집합(공유 스냅샷으로도 유지).

기존 스위트(ontology.test.ts / mock.action.test.ts / mock.agent.test.ts / agent.test.ts) **무수정 통과** 필수.

## 완료 기준

- `npm run test` 전체 통과(2회 — 간헐 404 타임아웃 재확인).
- `npm run build`(tsc) 통과.
- 화면/응답 스키마 변화 0. override·revision·idempotency·409 동작 보존.
- 순수 mock 리팩터 → 보안 영향 없음(secret/injection/네트워크 신규 없음).
