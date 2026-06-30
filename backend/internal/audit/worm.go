package audit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/maymust/fabrix-endpoint/internal/domain"
)

// WORM 은 가드레일 증적의 불변 보존(MinIO/ObjectScale Object Lock). 능가축(SSOT #20).
// ClickHouse 는 가변 조회 미러, WORM 은 변경/삭제 불가 원본.
type WORM struct {
	cli        *minio.Client
	bucket     string
	retainDays int
	enabled    bool
}

// NewWORM 은 MinIO(S3) 클라이언트를 만들고 Object Lock 버킷을 보장한다.
// raw 예: http://fabrixadmin:fabrix_worm_dev@192.168.160.43:30903 (creds 포함).
func NewWORM(raw, bucket string, retainDays int) *WORM {
	w := &WORM{bucket: bucket, retainDays: retainDays}
	if raw == "" {
		return w
	}
	u, err := url.Parse(raw)
	if err != nil {
		slog.Warn("WORM URL 파싱 실패 — 비활성", "err", err)
		return w
	}
	ak, sk := "", ""
	if u.User != nil {
		ak = u.User.Username()
		sk, _ = u.User.Password()
	}
	secure := u.Scheme == "https"
	cli, err := minio.New(u.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(ak, sk, ""),
		Secure: secure,
	})
	if err != nil {
		slog.Warn("WORM(MinIO) 클라이언트 생성 실패 — 비활성", "err", err)
		return w
	}
	w.cli = cli
	if w.bucket == "" {
		w.bucket = "fabrix-worm"
	}
	if w.retainDays <= 0 {
		w.retainDays = 365
	}
	// Object Lock 버킷 보장(이미 있으면 통과).
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	exists, _ := cli.BucketExists(ctx, w.bucket)
	if !exists {
		if err := cli.MakeBucket(ctx, w.bucket, minio.MakeBucketOptions{ObjectLocking: true}); err != nil {
			slog.Warn("WORM 버킷 생성 실패 — 비활성", "err", err, "bucket", w.bucket)
			return w
		}
	}
	w.enabled = true
	return w
}

// Enabled 는 WORM 보존 가능 여부.
func (w *WORM) Enabled() bool { return w.enabled }

// Probe 는 MinIO/ObjectScale 버킷 도달성을 확인한다(BucketExists=HEAD, read-only). 진단용.
func (w *WORM) Probe(ctx context.Context) error {
	if !w.enabled {
		return fmt.Errorf("worm 미구성")
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	exists, err := w.cli.BucketExists(ctx, w.bucket)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("버킷 %s 없음", w.bucket)
	}
	return nil
}

// Put 은 증적 1건을 불변 객체로 저장한다(GOVERNANCE 보존, retainDays).
// 키: guard-audit/YYYY/MM/DD/<event_id>.json
func (w *WORM) Put(ctx context.Context, row domain.GuardAuditRow) error {
	if !w.enabled {
		return nil
	}
	body, err := json.Marshal(row)
	if err != nil {
		return err
	}
	ts := time.Now().UTC()
	key := fmt.Sprintf("guard-audit/%s/%s.json", ts.Format("2006/01/02"), row.EventID)
	retain := ts.Add(time.Duration(w.retainDays) * 24 * time.Hour)
	_, err = w.cli.PutObject(ctx, w.bucket, key, bytes.NewReader(body), int64(len(body)), minio.PutObjectOptions{
		ContentType:     "application/json",
		Mode:            minio.Governance,
		RetainUntilDate: retain,
	})
	return err
}

// Stats 는 WORM 보존 객체 수/버킷을 반환한다(상태 표시용).
func (w *WORM) Stats(ctx context.Context) (int, string) {
	if !w.enabled {
		return 0, ""
	}
	n := 0
	for obj := range w.cli.ListObjects(ctx, w.bucket, minio.ListObjectsOptions{Prefix: "guard-audit/", Recursive: true}) {
		if obj.Err != nil {
			break
		}
		n++
		if n >= 100000 {
			break
		}
	}
	return n, w.bucket
}

func wormKeyDate(s string) string { return strings.SplitN(s, "T", 2)[0] }
