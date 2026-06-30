# ClickHouse — 가드레일 증적 + 사용량 롤업

HTTP 인터페이스(`:8123`)로 SQL 을 실행. **증적(audit)** 과 **사용량(usage)** 두 sink 이 같은 ClickHouse 인스턴스(같은 env)를 공유하되, 각각 독립 테이블·독립 연결.

- 코드: [`backend/internal/audit/clickhouse.go`](../../backend/internal/audit/clickhouse.go), [`backend/internal/usage/usage.go`](../../backend/internal/usage/usage.go)
- capability: 증적=`guard`, 사용량=`dashboard` · 프로파일: observe·manage 공통(조회)

## 연결
| 항목 | 값 |
|---|---|
| env | `FABRIX_CLICKHOUSE_URL` (audit·usage 공유) |
| 인클러스터 | `http://fabrix:<pw>@clickhouse.fabrix-endpoint:8123` |
| dev | `http://fabrix:fabrix_dev@localhost:18123` |
| 프로토콜 | HTTP SQL(`:8123`) |
| 인증 | URL 의 user:pw → 헤더 `X-ClickHouse-User`/`X-ClickHouse-Key` (`clickhouse.go:219`) |
| 타임아웃 | 8초 |

## 호출 API
- INSERT: `POST /?query=<SQL FORMAT JSONEachRow>` + JSON body (`clickhouse.go:200`, `usage.go:265`)
- SELECT: `GET /?query=<SQL>` → JSON
- 비동기 배치: 증적 100건/1초, 사용량 200건/2초 (핫패스 비차단, 큐 가득차면 드롭+경고)

### 테이블
- `fabrix.guard_audit`(증적, 쓰기전용 불변): `event_id, ts, trace_id, user_ref(salted SHA-256), dept_id, app_id, api_key_id, model, decision, guard_types[], pii_subtypes[], jb_confidence, policy_version, http_status, latency_ms`. BFF 가 부팅 시 `ALTER ... ADD COLUMN IF NOT EXISTS http_status/latency_ms`(비파괴) 자동 보강(`clickhouse.go:183`).
- `fabrix.usage_rollup`(SummingMergeTree, 5분 버킷): `bucket, dept_id, app_id, api_key_id, model, req_count, prompt_tokens, completion_tokens, error_count`. **자동 생성 안 함** — 운영에서 테이블 사전 생성 필요(`usage.go` 마이그레이션 없음).

> 보안: `user_ref` 는 salt(`FABRIX_AUDIT_SALT`) SHA-256(원문 미저장), PII 마스킹.

## 미설정/실패 시
env 비면 audit·usage 둘 다 `enabled=false`: 증적/롤업 비적재. **가드레일 판정·추론 요청 자체는 정상**(증적만 안 남음).

> 주의(운영): `audit.New()` 의 스키마 보강 `migrate()` 가 **동기**라, ClickHouse 가 설정됐는데 도달 불가면 Pod 기동이 타임아웃(8초)만큼 지연될 수 있다. 미설정이면 즉시 패스.

## 진단 프로브
`/diagnostics` → `clickhouse_audit`, `clickhouse_usage`(같은 인스턴스, 각 sink 별도 항목). 프로브 = `SELECT 1` (각 sink `Probe()`, 3초).

## 실사이트 매칭 체크리스트
- [ ] DB `fabrix` 및 테이블 `guard_audit`(컬럼 위와 일치), `usage_rollup`(SummingMergeTree) 사전 생성. usage 는 자동생성 안 되므로 DDL 필수.
- [ ] 계정 권한: guard_audit INSERT/ALTER, usage_rollup INSERT, 둘 다 SELECT.
- [ ] `FABRIX_CLICKHOUSE_URL` 에 creds 포함(Secret). `FABRIX_AUDIT_SALT` 운영 솔트.
- [ ] NetworkPolicy: BFF → `clickhouse.fabrix-endpoint:8123`.

## 트러블슈팅
| 증상 | 원인 | 조치 |
|---|---|---|
| diagnostics `clickhouse 401/516` | 자격증명/권한 | user/pw·GRANT 확인 |
| 증적은 되는데 사용량 비어있음 | `usage_rollup` 테이블 없음 | DDL 생성 |
| Pod 기동 지연 | ClickHouse 설정됐으나 도달불가(동기 migrate) | egress/DNS 확인 또는 일시적으로 env 비활성 |
