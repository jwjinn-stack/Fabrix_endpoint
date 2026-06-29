# PostgreSQL (CNPG) — 키 · 앱 · 사용자

API 키 발급/회수, 앱·부서 귀속, 사용자(RBAC) 마스터 데이터.

- 코드: [`backend/internal/store/store.go`](../../backend/internal/store/store.go) (+ `users.go`, `org.go`)
- capability: `keys`, `users` · 프로파일: 기본 manage(observe 는 옵션으로 조회만)

## 연결
| 항목 | 값 |
|---|---|
| env | `FABRIX_DATABASE_URL` (빈값=비활성) |
| 인클러스터 | `postgres://fabrix:<pw>@fabrix-pg-rw.fabrix-endpoint:5432/fabrix` |
| dev | port-forward 후 `postgres://fabrix:<pw>@localhost:5432/fabrix` |
| 드라이버 | `pgx/v5/pgxpool` (TCP, `:5432`) |
| 인증 | URL 내 user:pw |
| 연결 검증 | `New()` 가 `pool.Ping()` 5초로 검증, 실패 시 키 기능만 비활성 |

## 스키마 (store.go)
- `app_user`(`store.go:44`, CREATE IF NOT EXISTS): `user_id PK, email, name, role(admin|user|super), dept_id, status, created_at`. 비어있으면 기본 관리자 3명 시드.
- `app`: `app_id PK, name, dept_id`(ALTER ADD COLUMN IF NOT EXISTS — 비파괴).
- `api_key`: `api_key_id PK, app_id FK, name, model_scope, key_hash(sha256), key_prefix, quota_rpm, quota_tpd, enabled, created_at, revoked_at`.

> 보안(R4): **API 키 원문 미저장** — 발급 시 1회만 평문 반환, 이후 sha256 해시 + 표시용 prefix 만 보관.
> 마이그레이션 주의: 앱 DB 롤이 `app/api_key` owner 가 아니면 `ALTER` 가 권한 거부(42501)될 수 있음 → owner 롤로 사전 마이그레이션 권장.

## 미설정/실패 시
`FABRIX_DATABASE_URL` 비거나 Ping 실패 → `store=nil`: 키·앱·사용자(RBAC) 기능 비활성. 나머지 화면 정상. quota 경고 임계는 인메모리(quota.Limiter)로 동작.

## 진단 프로브
`/diagnostics` → `postgresql`. 프로브 = `pool.Ping()`(3초) (`store.go` `Probe()`).

## 실사이트 매칭 체크리스트
- [ ] CNPG(또는 일반 Postgres) 인스턴스 + DB `fabrix` + 롤.
- [ ] 롤 권한: app_user/app/api_key CREATE·ALTER(또는 owner 가 사전 생성), SELECT/INSERT/UPDATE.
- [ ] `FABRIX_DATABASE_URL`(Secret). RW 서비스(`-rw`)로 연결.
- [ ] NetworkPolicy: BFF → `fabrix-pg-rw.fabrix-endpoint:5432`.

## 트러블슈팅
| 증상 | 원인 | 조치 |
|---|---|---|
| 키 기능 안 보임 | DB 미설정/Ping 실패 | `/diagnostics` postgresql, env·egress 확인 |
| `42501 permission denied` | ALTER 권한 없음 | owner 롤로 사전 마이그레이션 |
| 발급 키 분실 | 원문 미저장(설계) | 재발급(원문은 발급 시 1회만) |
