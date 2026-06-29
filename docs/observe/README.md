# observe — 읽기 전용 관제 버전 (삼성생명/삼성증권) · 읽기 가이드

> **이 디렉토리는 `FABRIX_PROFILE=observe`로 배포하는 환경을 위한 문서 묶음이다.**
> FABRIX(web+BFF)가 고객이 운영하는 추론 플랫폼의 **텔레메트리를 읽어 관제 대시보드로만** 보여주고, 어떤 것도 변경하지 않는 배포. 이 환경을 맡았다면 아래 순서로 읽으면 된다.

## 이 환경은 무엇이고, 왜 이렇게 나누는가
- **무엇**: 메트릭·trace·가드레일 증적·쿠버 상태를 **읽기 전용**으로 집계해 보여주는 관제 콘솔. 엔드포인트 배포·키 발급·정책 변경 같은 **쓰기 기능이 코드 레벨에서 비활성**(라우트 미등록 → 호출 시 404/405).
- **왜 단일 코드베이스에서 프로파일로 나누나**: manage(풀버전)와 화면·로직이 동일하고 **차이는 "권한(쓰기 가능 여부)"뿐**이다. 코드를 둘로 포크하면 기능 드리프트·이중 유지보수가 생긴다. 그래서 한 코드베이스 + `FABRIX_PROFILE` 환경변수로 가른다.
- **왜 UI 숨김이 아니라 라우트 미등록인가**: UI에서 버튼만 숨기면 브라우저·직접 호출로 우회된다. observe는 mutating **핸들러 자체를 등록하지 않아** 404가 난다 → 금융 감사에서 "코드 레벨에서 변경 불가"를 증명할 수 있고 공격 표면이 줄어든다.

## 순서대로 읽으세요
> 플랫폼 용어(제논·Dynamo·Semantic Router·traceparent 등)가 처음이면 [공통 골격의 **용어 한 줄 정의**](../architecture/README.md#용어-한-줄-정의)부터. 더 깊은 배경은 [기획서](../paper/01-기획서.md)·[원본 아키텍처](../paper/02-아키텍처.md).

| 순서 | 문서 | 왜 이 환경에 필요한가 |
|---|---|---|
| 0 | **[../architecture/README.md#용어-한-줄-정의](../architecture/README.md#용어-한-줄-정의)** | 제논·SR·OTLP 등 용어를 먼저 잡아야 이후 문서가 막힘없이 읽힌다. |
| 1 | **[../architecture/README.md](../architecture/README.md)** (공통 골격) | 3평면(데이터·관측·콘솔) 분리를 먼저 이해해야 "FABRIX가 왜 추론 경로 밖에서 읽기만 하는지"가 납득된다. 양쪽 버전 공통 토대. |
| 2 | **[아키텍처.md](아키텍처.md)** (observe 전용) | 이 환경의 정확한 통신 9종(전부 GET)·등록/미등록 라우트·NAV·설계 근거. **핵심 문서.** |
| 3 | **[배포-운영-검증.md](배포-운영-검증.md)** | 실제로 어떻게 띄우고(env·Secret·RBAC), 무엇에 연결하고, `/capabilities`·`/diagnostics`로 어떻게 검증하는지. 운영 런북. |
| 4 | [../research/langfuse-가드레일-전략-리서치.md](../research/langfuse-가드레일-전략-리서치.md) (공통) | "왜 차단은 Semantic Router가 하고 Langfuse는 관측만인지"의 교차검증 근거. observe는 그 결과를 **읽기만** 한다. |
| 5 | [../integration/README.md](../integration/README.md) (공통) | 9개 의존성을 고객사 실 시스템에 **매칭**하는 통신 명세(URL·포트·인증). 연동·디버깅의 SSOT. |
| 6 | [../integration/k8s-otel-langfuse-연동.md](../integration/k8s-otel-langfuse-연동.md) (공통) | 트레이스가 **어떻게 채워지는지**(OTEL→Langfuse). observe는 그 결과를 트레이스 화면에서 읽는다. |
| 7 (선택) | [../integration/langfuse-api.md](../integration/langfuse-api.md) · [langfuse-mcp.md](../integration/langfuse-mcp.md) | Langfuse를 더 깊게 연동/디버깅할 때. observe엔 읽기 경로만 해당. |

## 안 읽어도 되는 것 (이 환경 무관) — 왜
- **[../manage/](../manage/)** 전체 — 엔드포인트 배포·키 발급·정책 편집 등 **쓰기**는 observe에 없다.
- 마스킹 정책 **편집** 절차 — observe는 조회만(PUT 405). 단 "마스킹 정책이 어디서 오는가"는 [배포-운영-검증.md](배포-운영-검증.md)에서 반드시 확인(observe 단독 시 함정).

## 한 줄 검증
`curl /api/v1/capabilities` → `readonly:true` · `curl -XPOST /api/v1/endpoints` → **404** · `curl /api/v1/diagnostics` → 9개 의존성 도달성.
