# Langfuse — 트레이스 / 세션 / 가드레일 원문

트레이스·세션·관측(observation)을 Public API 로 조회해 **우리 대시보드에 직접 렌더**(Langfuse 자체 UI 미사용). observe·manage 양쪽 핵심.

- 코드: [`backend/internal/langfuse/client.go`](../../backend/internal/langfuse/client.go) (실연동), `synth.go`(폴백)
- capability: `traces` · 프로파일: observe·manage 공통

## 연결
| 항목 | 값 |
|---|---|
| env | `FABRIX_LANGFUSE_HOST`, `FABRIX_LANGFUSE_PUBLIC_KEY`, `FABRIX_LANGFUSE_SECRET_KEY` |
| 인클러스터 | `http://langfuse-web.langfuse.svc.cluster.local:3000` |
| 프로토콜 | HTTP, Langfuse Public API(`:3000`) |
| 인증 | HTTP Basic — username=public, password=secret (`client.go:53`) |
| 타임아웃 | 8초 |

## 호출 API (client.go, base=`{host}/api/public`)
- `GET /traces?limit=100` → 목록 (`client.go:68`)
- `GET /traces/{id}` + `GET /observations?traceId={id}` → 상세(스팬)
- `GET /sessions?limit=60`, `GET /sessions/{id}` → 세션/턴
- `GET /observations?traceId={id}&type=GUARDRAIL` → 차단 프롬프트 원문(`client.go:116`)
- observation type: `GENERATION`/`GUARDRAIL`/`RETRIEVER` 등. 비용·토큰·지연 포함.

## 미설정/실패 시 (중요)
`Configured()`(host·public·secret **셋 다** 있어야 true)가 false 거나 실연동 호출이 에러나면 → **synthetic 폴백**(`synth.go`, 결정적 seed). 즉 Langfuse 없이도 트레이스/세션 화면이 그럴듯하게 채워진다(데모·오프라인). 실연동 성공 시에만 실데이터.

> 디버깅 함정: 화면에 트레이스가 보여도 **synthetic 일 수 있다**. 실연동 여부는 `/diagnostics` 의 `langfuse.reachable` 또는 `/capabilities` 의 `integrations.langfuse` 로 확인.

## 진단 프로브
`/diagnostics` → `langfuse`. 프로브 = `GET /api/public/traces?limit=1`(Basic auth 검증 포함, 5초) (`client.go` `Probe()`). 401 이면 키 오류, connection 이면 네트워크.

## 실사이트 매칭 체크리스트
- [ ] Langfuse 인스턴스 + 프로젝트의 public/secret 키 발급 → 3개 env 주입(secret 은 Secret).
- [ ] 추론 파이프라인이 Langfuse 에 trace/observation 을 **계측**하는가? (GUARDRAIL observation 의 input 이 비어있으면 원문 미계측)
- [ ] host 경로: `/api/public` 프리픽스는 코드가 붙이므로 host 는 `http://langfuse-web...:3000` 까지만.
- [ ] NetworkPolicy: BFF → `langfuse-web.langfuse:3000` egress.

## 트러블슈팅
| 증상 | 원인 | 조치 |
|---|---|---|
| 트레이스가 synthetic 같음 | 미설정 or 실패 폴백 | `/diagnostics` langfuse 확인, 키 3개 점검 |
| diagnostics `401/403` | public/secret 오류 | 키 재발급 |
| 가드레일 원문 빈값 | 파이프라인이 GUARDRAIL input 미계측 | 계측 추가 |
