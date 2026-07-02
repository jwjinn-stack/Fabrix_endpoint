# IMP-98 — 복합 진단 read-only MCP tool (get_incident_context / get_pod_diagnostics)

- Type: compete (sev=medium, effort=L)
- Branch: `feature/evolve-cycle7-incident-explain`
- Date: 2026-07-02

## 배경 / 문제
현 read-only MCP tool 은 `list_pods` / `get_events` / `describe_deployment` 로 **원자적**이다(IMP-91).
AI 든 외부 MCP 클라이언트든 "이 인시던트 왜 났나"의 원인 컨텍스트를 모으려면 여러 tool 을
스스로 순서대로 부르고(list_pods → get_events → describe_deployment) 결과를 직접 상관·조합해야 한다
= 다중 라운드트립 + 중간 스키마/추론 반복 직렬화(토큰 낭비). 인시던트-앵커 진단 번들이 없다.

IMP-99 가 이미 **단일 seam** `buildIncidentEvidence(objectId, snapshot)` 를 추출해 두었다
(상관 pods·events·deployment·큐신호 + root-cause 요약, 순수·결정적·직렬화 가능). 이걸 그대로 MCP tool 로
한 번에 노출한다.

## 설계 (하이브리드 / coarse→fine)
2025 MCP "coarse-grained/workflow tool" 패턴: 흔한 유스케이스는 워크플로 캡슐화 tool 로 다중
round-trip 제거하되, 원자 tool 은 유연성·드릴다운용으로 **유지**(하이브리드).

- 복합 tool 2종을 `K8S_TOOL_REGISTRY` 에 추가(+schema.json 재emit, 3-way drift canary 유지):
  - `get_incident_context(objectId)` — `buildIncidentEvidence(objectId)` 번들 반환
    (상관 pods·events·deployment·큐신호·root-cause 요약 + 인용 refs objectId/podRef).
  - `get_pod_diagnostics(pod)` — 한 파드의 waiting reason / 재시작 / OOM / 연관 events.
- **단일 출처**: 두 tool 모두 IMP-99 seam(`buildIncidentEvidence`)만 호출한다 → UI(ObjectView/COP)와
  MCP 가 동일 shape 반환. `get_pod_diagnostics` 도 파드 → 상관 objectId 로 같은 seam 을 태워 일관.
- 원자 tool(list_pods/get_events/describe_deployment) 은 그대로 유지(coarse→fine 드릴다운 폴백).
- 반환 스키마 = "요약 + 근거 인용 refs(objectId/podRef)".

## Read-only 안전 (two-tier)
- 두 tool 다 조회 동사(`get_*`)라 `assertReadOnly()` 자동 커버(MUTATING_VERBS 에 get 없음).
- strict 인자 검증: `additionalProperties:false` + `required`(objectId / pod).
- mutating 동사 없음. Go `mcp_contract_test.go` 의 read-only shape/verb 가드가 두 tool도 통과.
- 부작용 없음: 순수 seam(buildIncidentEvidence)만 소비, 상태 변경 0.

## 정직성 (mock 라벨)
- K8sSnapshot 은 mock 파생(buildK8sSnapshot). 실 kube-mcp = SPIKE(IMP-79/91/101). tool description 에
  "read-only diagnostic bundle, no mutation (mock-first)" 명시. 반환 source 에 mock 표기.

## Prompt 템플릿 (선택 — 5번 항목)
`diagnose_incident` 절차 가이드를 별도 MCP **PROMPT** 로 분리할 수 있으나(가이드=prompt, 결정론적 근거
조립=tool), 현 mock MCP 라우터(mcp.go / mock.ts)는 `prompts/*` 메서드를 아직 구현하지 않는다.
→ 이번엔 tool(결정론적 근거 조립)만 확정하고 prompt 템플릿은 clean 하지 않아 **skip**(백로그 노트 준수).

## 구현 위치
- `web/src/actions/ontologyTools.ts` — K8S_TOOL_REGISTRY 에 2 tool 추가(+ re-emit).
- `web/src/actions/ontology-tools.schema.json` — 재생성.
- `backend/internal/server/ontology_tools_schema.json` — byte 동일 복사(go:embed).
- `web/src/api/agent.ts` — 순수 실행부 `toolGetIncidentContext` / `toolGetPodDiagnostics`(seam 소비).
- `web/src/api/types.ts` — 반환 타입(PodDiagnostics) 추가.

## 테스트 케이스
1. **registered + read-only**: K8S_TOOL_REGISTRY 에 get_incident_context/get_pod_diagnostics 존재,
   assertReadOnly(K8S_TOOL_REGISTRY) throw 안 함. mock tools/list 에 두 tool 노출, mutating 동사 0.
2. **strict arg 검증**: 두 tool inputSchema additionalProperties:false + required(objectId/pod).
3. **seam 단일 출처**: toolGetIncidentContext 결과 == buildIncidentEvidence(objectId, snapshot)
   (동일 shape·인용 refs). toolGetPodDiagnostics 가 파드→objectId 상관으로 같은 seam 소비.
4. **원자 tool 유지**: list_pods/get_events/describe_deployment 계약 그대로 존재.
5. **drift canary green**: emit == committed(TS), web 아티팩트 == Go embed(Go).
6. **round-trip 감소 측정**(mock.mcp.test): 원자-only 경로(list_pods+get_events+describe_deployment=3 call)
   vs 복합(get_incident_context=1 call) 라운드트립 비교 — 복합이 감소함을 assert.
7. **honest mock**: description 에 "no mutation" / mock 표기.

## 완료 기준
`cd web && npm run test` 전부 green(격리 + drift canary 포함), `npm run build`(tsc) green.
`cd backend && go test ./...` green, `go build ./...` green. IMPROVEMENTS.md IMP-98 Status→done.
