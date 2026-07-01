# IMP-67 Spike — 온톨로지 Action side-effect/워크플로 백본 (Temporal)

> Status: **spike-needed** (다일짜리 인프라 채택 — 코드 PR이 아니라 채택 결정 문서).
> 전제: IMP-59 Action 프레임워크의 mock-first 낙관 전이가 실 K8s mutating(cordon/drain/scale)으로 승격되는 단계에서만 필요.
> 프론트 mock 단계는 현행 유지 — 이 spike는 **실행 백본**에 한정.

## 왜 필요한가
IMP-59 Action 의 side effect(상태전이 pending→running, 알림, audit, 실 K8s mutating)는
**재시도·타임아웃·보상(rollback)·완전한 감사 이력**이 필요한 장기 실행 워크플로다.
인메모리 setTimeout 낙관 전이는 mock 단계엔 충분하지만, 실 mutating 단계에서 이를 손수 구현하면
Palantir Action 이 보장하는 트랜잭션·audit(doc 이 강조한 감사가능성)을 재발명하게 된다.

## 후보 & 평가
| 옵션 | 라이선스 | 장점 | 단점 |
|---|---|---|---|
| **Temporal** (권장) | MIT(코어) | durable workflow, 재시도/타임아웃/보상/실행이력 내장, Helm/operator 자체호스팅, 성숙·활발 | 러닝커브, Postgres/Cassandra 의존, 폐쇄망 이미지 미러링 필요 |
| **NATS JetStream** | Apache-2.0 | 경량 side-effect 큐, 운영 단순 | 워크플로/보상 로직은 앱이 직접 |
| 자체 인메모리 큐 | — | 무의존 | audit durability·재시도 신뢰성 부재(재발명) |

## 채택 순서(go/no-go 게이트)
1. **Go 조건**: IMP-59 가 실 K8s mutating(cordon/drain/scale)으로 승격 결정될 때만 착수. 그 전엔 no-go(mock 유지).
2. in-cluster Temporal 배포(Helm) + Postgres persistence — deploy/ 에 매니페스트, 폐쇄망 이미지 미러링(IMP-52/41 spike 계열 참조).
3. BFF(backend/)가 Action 제출을 Temporal workflow 로 위임 — activity = K8s API 호출, 보상 activity = rollback.
4. audit 이력을 Temporal 실행 이력 + 기존 ActionAuditEntry 로 이중 기록.
5. 프론트는 무변경 — 기존 optimistic UI 가 워크플로 상태로 수렴(IMP-59 provisional/reconciled 계약 그대로).

## 리스크
- 폐쇄망 이미지 미러링·Postgres 운영 부담(삼성증권 observe 프로파일엔 애초 mutating 없음 → manage 전용).
- 러닝커브 → 초기엔 단일 workflow(scaleReplicas)만 PoC 후 확장.

## 결론
**지금은 no-go(park).** IMP-59 실 mutating 승격이 결정되면 이 문서의 순서로 채택. 그 전까지 mock-first 낙관 전이 유지.
