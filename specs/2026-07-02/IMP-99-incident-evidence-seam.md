# IMP-99 — 근거 파생 단일 seam: buildIncidentEvidence (순수·결정적)

- Type: code (sev=medium, effort=M)
- Branch: feature/evolve-cycle7-incident-explain
- Date: 2026-07-02

## 배경 / 문제
인시던트 근거(evidence) 파생 로직이 세 곳에 흩어질 위험이 크다:
- `detection.ts` — `signalsForObject` + `probableCauseText` (KineticAlert 신호/추정원인)
- `investigate.ts` — `buildRootCausePath` (hop first-anomaly 시간축)
- `agent.ts` — `toolListPods/toolGetEvents/toolDescribeDeployment` (K8s 리소스 결과)

IMP-93(evidence 패널)·IMP-98(복합 MCP tool)·IMP-95(AI 원인)·IMP-100(타임라인)이 각각 "objectId →
상관 K8sPod/K8sEvent/K8sDeployment/큐·감지 신호 → 신호→추정원인→영향" 을 재현하면 임계·라벨·인용
규약이 화면마다 갈라진다.

## 목표 (Fix — 정확 구현)
`web/src/api/incidentEvidence.ts` 에 단일 **순수·결정적·의존성 0**(프로젝트 내부 순수 seam 만 조립) 함수
`buildIncidentEvidence(objectId, snapshot)` 를 신설한다.

1. objectId + 스냅샷(`{ objects, links, k8s }`)을 받아 **상관된 증거를 결정적으로** 수집:
   - K8sPod(s): phase/restarts/oomKilled/reason (objectId 일치)
   - K8sEvent(s): reason/message/count/involvedObject/time (objectId 일치)
   - K8sDeployment: rollout/available/unavailable (objectId 일치)
   - 감지 신호(detection.ts `signalsForObject`) + first-anomaly(investigate.ts `buildRootCausePath`)
2. `신호 → 추정원인 → 영향` 구조체 반환:
   - `lines: EvidenceLine[]` — 각 줄 `{ id, kind, signal(what+when+sourceRef), probableCause, impact, confidence, sourceRefs[] }`
   - 정렬: severity(crit>warn) → first-anomaly(이른 것 우선) → id (결정적)
   - `rootCauseSummary` — 짧은 추정 근본원인 요약(detection `probableCauseText` 재사용)
   - confidence: detection 규약 재사용 — **≥2 상관 신호 = high, 그 외 med**
   - `empty` + `emptyReason` — 상관 근거가 하나도 없으면 `"수집된 이벤트 없음"` (**환각 금지**)
3. **단일 출처**: detection.ts `signalsForObject`/`probableCauseText` 를 export 해 이 함수가 재사용(중복 아님).
   detection.ts `attributeDetections` 는 behavior-preserving(기존 테스트 green) — force-refactor 없음.
4. **직렬화 가능**: 원시값/배열/객체만 → `JSON.parse(JSON.stringify(x))` 라운드트립 동일(IMP-98 MCP 반환용).

## 설계 결정
- 조립만 한다(re-derive 아님): 감지 신호 = detection.ts, first-anomaly = investigate.ts, K8s = snapshot.k8s.
- 시각(observedAt) 라벨은 first-anomaly 파생(결정적) 또는 K8s event count 기반 — Date.now 미의존.
- `impact` 는 objectType/신호 kind 로 결정적 문구(과장 금지, "추정" 병기).
- snapshot.k8s 미제공(undefined) 시 K8s 증거는 건너뛰고 감지/first-anomaly 만으로 조립(graceful).

## 테스트 케이스 (web/src/api/incidentEvidence.test.ts)
1. 결정성 — 동일 (objectId, snapshot) → `JSON.stringify` 동일.
2. 구조 — 각 line 이 signal/probableCause/impact/confidence/sourceRefs 를 갖고, rootCauseSummary 존재.
3. 정렬 — severity/first-anomaly 순서(가장 이른 이상이 상단).
4. confidence 규약 — 상관 신호 ≥2 → high, 1 → med (detection 과 동형).
5. K8s 상관 — objectId 에 OOMKilled pod + OOMKilling event 가 있으면 sourceRefs 에 pod/event ref 포함.
6. empty-state — 상관 증거 0 → `empty=true`, `emptyReason="수집된 이벤트 없음"`, lines=[] (환각 없음).
7. 직렬화 — round-trip 동일(MCP 반환 가능).
8. behavior-preserving — 기존 detection/investigate/isolation(IMP-88) 테스트 green.

## 완료 기준
- `cd web && npm run test` + `npm run build`(tsc) green.
- IMP-99 Status → done (IMPROVEMENTS.md, 이 브랜치).
- 보안 라이트체크 clean(순수 데이터).
