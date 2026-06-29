# manage — 엔드포인트 관리 버전 (풀버전) · 읽기 가이드

> **이 디렉토리는 `FABRIX_PROFILE=manage`(기본)로 배포하는 환경을 위한 문서 묶음이다.**
> observe 의 모든 읽기 + **플랫폼 구성(쓰기)**: 엔드포인트 배포·삭제, 키 발급, 가드레일/마스킹 정책 편집, 모델 임포트, 사용자(RBAC), 자격증명, 플레이그라운드/평가. 이 환경을 맡았다면 아래 순서로 읽으면 된다.

## 이 환경은 무엇이고, observe 와 무엇이 다른가
- **무엇**: AI 추론 플랫폼의 **운영 콘솔**. 모델을 배포하고, 키를 발급하고, 가드레일·마스킹 정책을 바꾼다.
- **observe 와의 단 하나의 본질적 차이 = 쓰기 권한**. 읽기·화면·관측은 동일하고, manage 는 mutating 라우트가 **전부 등록**돼 데이터 플레인을 구성할 수 있다.
- **왜 manage 도 추론 핫패스에 안 끼나** — manage 는 데이터 플레인의 **컨트롤러**(무엇을 배포·허용·차단할지 결정)지, 추론 1건을 직접 처리하지 않는다. 추론은 여전히 게이트웨이가 처리한다. **control plane ≠ data plane.** (플레이그라운드/평가의 테스트 호출만 BFF 가 잠깐 경로에 끼는 유일한 예외)

## 순서대로 읽으세요
> 플랫폼 용어(제논·Dynamo·DynamoGraphDeployment·Semantic Router 등)가 처음이면 [공통 골격의 **용어 한 줄 정의**](../architecture/README.md#용어-한-줄-정의)부터. 더 깊은 배경은 [기획서](../paper/01-기획서.md)·[원본 아키텍처](../paper/02-아키텍처.md).

| 순서 | 문서 | 왜 이 환경에 필요한가 |
|---|---|---|
| 0 | **[../architecture/README.md#용어-한-줄-정의](../architecture/README.md#용어-한-줄-정의)** | 제논·SR·DynamoGraphDeployment 등 용어를 먼저 잡아야 쓰기(엔드포인트 배포 등) 절차가 막힘없이 읽힌다. |
| 1 | **[../architecture/README.md](../architecture/README.md)** (공통 골격) | 3평면 분리. manage 가 "데이터 플레인을 구성하되 핫패스엔 없다"를 이해하는 토대. |
| 2 | **[아키텍처.md](아키텍처.md)** (manage 전용) | 읽기 9종 + **쓰기 8종(W1~W8)**·등록 라우트·데이터플레인 구성 흐름·설계 근거. **핵심 문서.** |
| 3 | **[배포-운영-검증.md](배포-운영-검증.md)** | 배포(env·Secret)·**쓰기 RBAC**(kubectl create/delete·secrets)·엔드포인트 배포 운영·검증. 운영 런북. |
| 4 | [../research/langfuse-가드레일-전략-리서치.md](../research/langfuse-가드레일-전략-리서치.md) (공통) | 왜 차단은 SR(인라인)이고 Langfuse 가 아닌지. manage 는 **SR 정책을 편집**하므로 더 중요. |
| 5 | [../integration/README.md](../integration/README.md) (공통) | 9개 의존성 매칭 + 쓰기 대상(k8s·PG·Harbor·SR). 연동 SSOT. |
| 6 | [../integration/k8s-otel-langfuse-연동.md](../integration/k8s-otel-langfuse-연동.md) (공통) | 트레이스 적재(OTEL→Langfuse) + **게이트웨이 글루/마스킹 정책 소비**. manage 가 마스킹을 편집하면 글루가 폴링해 반영. |
| 7 | [../integration/langfuse-api.md](../integration/langfuse-api.md) · [langfuse-mcp.md](../integration/langfuse-mcp.md) (공통) | ingestion/scores 쓰기·프롬프트 관리·MCP 디버깅. manage 의 확장 연동. |

## 핵심 운영 흐름 (이 환경에서만 가능)
- **엔드포인트 배포**: 위저드 → preview(dry-run) → `kubectl apply` DynamoGraphDeployment → vLLM Pod 기동.
- **키 발급**: PG 에 sha256 해시 저장(원문 미저장) → 게이트웨이가 그 키로 인증·쿼터·귀속.
- **정책/마스킹 변경**: SR 정책(차단) / 마스킹 정책(PG, 글루 폴링) → 즉시 반영.

## 한 줄 검증
`curl /api/v1/capabilities` → `readonly:false`, 전 cap `true` · `curl -XPOST /api/v1/endpoints` → 라우트 존재(400/엔드포인트 로직) · `/diagnostics` → 의존성 도달성.
