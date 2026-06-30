# MinIO / ObjectScale — WORM 불변 보존

가드레일 증적의 **변경·삭제 불가 원본** 보존(Object Lock). ClickHouse 가 가변 조회 미러라면, WORM 은 규제 대응용 불변 원본.

- 코드: [`backend/internal/audit/worm.go`](../../backend/internal/audit/worm.go)
- capability: `guard` · audit sink 에 연결(`AttachWORM`) · 프로파일: observe·manage 공통

## 연결
| 항목 | 값 |
|---|---|
| env | `FABRIX_WORM_URL`(creds 포함), `FABRIX_WORM_BUCKET`(기본 `fabrix-worm`), `FABRIX_WORM_RETAIN_DAYS`(기본 365) |
| dev | `http://fabrixadmin:<sk>@192.168.160.43:30903` |
| SDK | `github.com/minio/minio-go/v7` (S3 V4 서명) |
| 인증 | URL 의 access-key:secret-key → `credentials.NewStaticV4` (`worm.go:46`) |

## 동작
- 기동 시 Object Lock 버킷 보장: `BucketExists` → 없으면 `MakeBucket(ObjectLocking:true)` (`worm.go:64`).
- 증적 1건 = 객체 1개: `PutObject` with `RetainUntilDate`(=now+retainDays), GOVERNANCE 모드. 키 `guard-audit/YYYY/MM/DD/<event_id>.json` (`worm.go:78`).
- 보존 객체 수/버킷은 `Stats()`(ListObjects, 최대 10만 샘플) → `/guard/status` 의 worm_count.

## 미설정/실패 시
`FABRIX_WORM_URL` 비거나 버킷 생성 실패 → `enabled=false`. ClickHouse 증적만 남고 불변 보존은 없음.

## 진단 프로브
`/diagnostics` → `worm`. 프로브 = `BucketExists`(HEAD, read-only, 3초) (`worm.go` `Probe()` → audit `ProbeWORM()`).

## 실사이트 매칭 체크리스트
- [ ] 고객사 오브젝트 스토리지가 S3 호환(MinIO/ObjectScale/AWS S3)인가? `minio-go` 는 표준 S3 V4 → 대부분 호환.
- [ ] **Object Lock 활성화된 버킷** 필요(생성 시점에만 켤 수 있음). 기존 비-lock 버킷이면 신규 lock 버킷 생성.
- [ ] AK/SK 권한: PutObject(+retention), BucketExists, ListObjects.
- [ ] `https` 면 URL scheme=https(자동 secure). NetworkPolicy egress 허용.

## 트러블슈팅
| 증상 | 원인 | 조치 |
|---|---|---|
| diagnostics `버킷 없음`/생성실패 | Object Lock 미지원 버킷/권한 | lock 버킷 신규 생성, IAM 정책 확인 |
| `SignatureDoesNotMatch` | AK/SK 오류 | creds 재확인 |
| 보존 적용 안 됨 | 버킷 Object Lock 비활성 | 버킷 재생성(lock on) |
