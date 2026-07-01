# IMP-72 — 이상 감지 → 온톨로지 객체 위 즉시 Action(kinetic) — Probable Cause 4-슬롯

- Type: ux (sev=high, effort=L) · Cycle5 능동 온톨로지 · focus 방향(2) "이상 감지→온톨로지 위 즉시 Action"
- Branch: `feature/evolve-cycle5-active-ontology`
- Sources: Datadog Bits AI SRE(자율 조사→Action Catalog 게이팅) · Grafana Assistant Investigations(findings→evidence→recommended next steps) · IBM Probable Root Cause(correlation≠causation copy) · Run:ai/NVIDIA idle-GPU reclaim

## 문제 (Why)

제어(kinetic) 축은 이미 ObjectView(IMP-57)+ActionForm(IMP-59)로 있으나 진입이 전적으로 **수동** — 사용자가 스스로 아픈 객체를 찾아 열고 Action 을 눌러야 한다. 이상 '감지'는 backend alertrules 엔진 + mockstore 룰(TTFT p95·에러율·차단율)로 threshold 알림에 그치고, 그 알림이 **'어느 온톨로지 객체(Model/GpuDevice/Node)가 왜 이상인지 + 지금 무엇을 눌러야 하는지'** 로 이어지지 않는다. agent.ts 는 결정적 RCA 후보를 내지만 사용자가 /agent 를 열어 intent 를 쳐야 돈다. focus 방향(2)가 요구하는 '이상 감지→온톨로지 위 즉시 Action' 의 능동 브리지가 비어 있다.

## 해결 (What)

감지된 이상을 온톨로지 객체(Model/GpuDevice/Node)에 **결정적으로 귀속**시키는 파생 레이어를 mock 에 추가하고, 대시보드/COP/ObjectView 상단에 **'Kinetic 알림' 스트립**을 얹는다. 각 항목은 반드시 **4-슬롯 카드**(Grafana findings→evidence→recommended next steps 순서):

1. **[영향 객체 chip]** — 어느 온톨로지 객체가 아픈가(글리프+타입+상태, objectTypeVisual 단일 출처).
2. **[근거(evidence)]** — 어느 신호가 언제 임계 초과했는가 + **objectId/시각 인용**(alertrules 룰명·threshold 대비 값·first-anomaly 시각).
3. **[추정 원인 경로(Probable Cause path)]** — IBM식 "추정 원인" + first-anomaly 시간축으로 무엇이 먼저 무너졌는지(buildRootCausePath hop 요약). 고정 마이크로카피 **"상관≠인과, 근거로 확인"**.
4. **[추천 Action]** — 3단 조치 사다리(아래).

**confidence(신뢰도)** 는 신호 수 기반 — high(신호 ≥2) / med(신호 1). IBM Probable Root Cause 명명(단정 회피).

### 3단 조치 사다리 (recommendation = 1급 상태)

- **(a) 조사 열기** — `/agent` 로 이동(objectId+가설 intent pre-fill해 마찰 제거). 항상 활성(읽기전용에서도 가치).
- **(b) ack/assign** — IMP-38 인시던트 연결(현 구현: COP 로 진입점 지정 이동). 항상 활성.
- **(c) 추천 Action 실행** — ActionForm confirm(capability+status 게이팅). observe 프로파일=이 rung 만 disabled(사유 표시), 조사/ack 는 활성.

SUGGESTED_ACTION 매핑: **GPU→drainGpu, Node→cordonNode, Model→restartModel/scaleReplicas**(agent.ts SUGGESTED_ACTION 확장·재사용).

### 노이즈 억제(파생 레이어 내장)

- **dedupe**: 동일 객체 다중 신호는 하나의 카드로 합쳐 signals[] 로 집계(신호 수 = confidence 근거).
- **state transition**: 정상↔이상 전이(상태 crit/warn)인 객체만 스트립 승격. 정상(ok) 객체는 미승격.
- **sustained collapse**: 지속 임계초과는 breachCount 로 접어 카운트 배지로 표기.
- **adaptive baseline/quantile**: TTFT p95 tail 은 baseline 대비 배수(quantile heuristic)로 판정(고정 임계 + 상대 배수).

## 설계 (How)

- **순수 파생 모듈** `web/src/api/detection.ts` (의존성 0, 순수 — 단위 테스트로 가드):
  - `attributeDetections(objects, links, opts?)` → `KineticAlert[]`.
  - 신호 소스(전부 온톨로지 스냅샷 위에서 파생):
    1. **alertrules 상태전이** — Model/Endpoint 의 status·props(ready)에서 TTFT p95 / error / block threshold 크로싱을 결정적 재현(mock ALERT_RULES 임계 재사용).
    2. **buildRootCausePath first-anomaly**(IMP-58) — 가장 이른 이상 hop 을 추정 원인 경로로.
    3. **GPU idle-alloc gap / thermal-throttle bit**(IMP-76) — props.hw.clocks_event_reasons thermal 비트, util<0.1·mem>0.5 유휴 갭.
    4. **node saturation** — Node util/net props threshold.
  - 각 객체로 신호를 모아 **dedupe→signals[]**, **state-transition 필터**, **confidence(신호수)**, **suggestedAction(타입 매핑)**, **가설 intent 문자열** 을 계산. 결정적(입력 동일 → 출력 동일, Date.now 미사용 경로).
- **mock 엔드포인트** `GET /ontology/detections` — `buildOntology()` **메모이즈 스냅샷 재사용**(IMP-81) 후 `attributeDetections` 호출. route() 요청 경계 캐시 그대로.
- **client** `fetchKineticAlerts(signal?)` → `{ alerts: KineticAlert[]; generated_at; source }`.
- **컴포넌트** `web/src/components/KineticStrip.tsx` — 4-슬롯 카드 + 3단 사다리. ActionForm(IMP-59) + SUGGESTED_ACTION 재사용. 실행 rung 은 토글로 ActionForm 펼침(confirm 게이팅 그대로). '조사 열기' 는 onNavigate("agent", {entity,intent}) — NavParams 에 entity/intent 추가(additive).
- **마운트**: Dashboard(관제) · Investigate(COP) · Ontology(ObjectView 호스트) 상단. props: `onNavigate`(조사/ack rung), 자체 폴링/신선도(15s, DataFreshness 재사용).
- **재사용**: ActionForm·getActionSpec·objectTypeVisual·Badge·DataFreshness·useObjectView(카드→ObjectView). ActionForm/registry 게이팅은 **가산만**(불변).

## 데이터 계약

- 신규 타입 `KineticAlert`(types.ts): `{ objectId; title; objectType; status; confidence:"high"|"med"; signals: DetectionSignal[]; probableCause: string; suggestedAction?: {actionType;target}; hypothesis: string; breachCount: number }`.
- `DetectionSignal`: `{ kind; label; detail; observedAt; citation }` — 근거 슬롯(어느 신호·언제·인용).
- NavParams 에 `entity?`/`intent?` 추가(additive) — /agent deep-link prefill.

## 테스트 케이스

- **attribution(결정성·정확 객체)**: 같은 온톨로지 입력 → 동일 KineticAlert[]; crit GPU/Node/Model 이 알림으로, ok 객체는 미포함.
- **4 슬롯 존재**: 카드에 영향 객체 chip + 근거(신호·시각) + 추정 원인 경로 + 추천 Action rung 이 모두 렌더 + "상관≠인과" 카피.
- **confidence**: 신호 ≥2 → high, 1 → med.
- **dedupe/state-transition 억제**: 한 객체 다중 신호 → 카드 1장·signals 집계; 정상(ok) 객체는 승격 안 됨; 지속 breach → count 배지.
- **observe 게이팅**: observe 프로파일 → 실행 rung disabled(+사유), 조사/ack rung 은 활성.
- **ActionForm confirm 필수**: 실행 rung 펼침 → destructive 는 ConfirmDialog(type-to-confirm) 경유(자동 mutation 경로 없음).
- **deep-link /agent**: '조사 열기' 클릭 → onNavigate("agent", {entity, intent}) 로 objectId+가설 전달.

## Out of scope

- 실 K8s mutating(IMP-67 spike) — mock optimistic only. 실 alertrules 상태머신 연결은 backend 후속.
- ActionForm/ACTION_REGISTRY 게이팅 로직 변경(가산만).
- 실시간 폴링 신선도 규약의 전면 통일(IMP-77) — 스트립은 자체 폴링만.
