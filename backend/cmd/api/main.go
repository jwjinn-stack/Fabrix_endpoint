// Command api 는 FABRIX Endpoint API(BFF) 서버의 진입점이다.
//
// MVP 는 mock 데이터 제공자를 주입한다. 실제 연동 시 FABRIX_DATA_SOURCE=live 로
// Prometheus/ClickHouse 기반 provider 구현을 주입하도록 확장한다(문서 §3 / §2-4).
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/maymust/fabrix-endpoint/internal/audit"
	"github.com/maymust/fabrix-endpoint/internal/catalog"
	"github.com/maymust/fabrix-endpoint/internal/config"
	"github.com/maymust/fabrix-endpoint/internal/guard"
	"github.com/maymust/fabrix-endpoint/internal/harbor"
	"github.com/maymust/fabrix-endpoint/internal/k8s"
	"github.com/maymust/fabrix-endpoint/internal/provider"
	"github.com/maymust/fabrix-endpoint/internal/store"
	"github.com/maymust/fabrix-endpoint/internal/usage"
	"github.com/maymust/fabrix-endpoint/internal/provider/live"
	"github.com/maymust/fabrix-endpoint/internal/provider/mock"
	"github.com/maymust/fabrix-endpoint/internal/server"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	cfg := config.Load()

	// 데이터 소스 선택. mock(기본) | live(VictoriaMetrics/vmselect 실데이터).
	var dashboard provider.Dashboard
	switch cfg.DataSource {
	case "mock":
		dashboard = mock.New()
	case "live":
		dashboard = live.New(cfg.VMSelectURL)
		slog.Info("live 데이터 소스", "vmselect", cfg.VMSelectURL)
	default:
		slog.Warn("알 수 없는 데이터 소스 — mock 으로 폴백", "data_source", cfg.DataSource)
		dashboard = mock.New()
		cfg.DataSource = "mock"
	}

	cat := catalog.New(cfg.GemmaUpstream)

	// 가드레일(Semantic Router) + 증적(ClickHouse). 미설정 시 통과/비적재로 안전 폴백.
	gc := guard.New(cfg.SRURL, cfg.PolicyVersion)
	if gc.Enabled() {
		slog.Info("가드레일 활성", "sr", cfg.SRURL, "policy", cfg.PolicyVersion)
	}
	as := audit.New(cfg.ClickHouseURL, cfg.AuditSalt)
	if as.Enabled() {
		slog.Info("증적 적재 활성 (ClickHouse guard_audit)")
	}
	if cfg.WORMURL != "" {
		w := audit.NewWORM(cfg.WORMURL, cfg.WORMBucket, cfg.WORMRetainDays)
		if w.Enabled() {
			as.AttachWORM(w)
			slog.Info("WORM 불변 보존 활성 (MinIO Object Lock)", "bucket", cfg.WORMBucket, "retain_days", cfg.WORMRetainDays)
		}
	}
	us := usage.New(cfg.ClickHouseURL)
	if us.Enabled() {
		slog.Info("사용량 롤업 활성 (ClickHouse usage_rollup)")
	}
	kc := k8s.New(cfg.KubectlPath, cfg.EndpointsNS)
	if kc.Enabled() {
		slog.Info("엔드포인트(DynamoGraphDeployment) 조작 활성 (kubectl)")
	}
	hc := harbor.New(cfg.HarborURL)
	if hc.Enabled() {
		slog.Info("Harbor 모델 레지스트리 활성")
	}

	// 키·앱 스토어(PostgreSQL). 미구성/연결 실패 시 nil → 키 기능만 비활성, 나머지 정상.
	var st *store.Store
	if cfg.DatabaseURL != "" {
		s, err := store.New(context.Background(), cfg.DatabaseURL)
		if err != nil {
			slog.Warn("DB 연결 실패 — 키 기능 비활성", "err", err)
		} else {
			st = s
			defer st.Close()
			slog.Info("키 스토어 연결됨 (PostgreSQL)")
		}
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.New(cfg, dashboard, cat, st, gc, as, us, kc, hc).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	// graceful shutdown
	go func() {
		slog.Info("FABRIX Endpoint API 시작", "addr", cfg.Addr, "data_source", cfg.DataSource)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("서버 종료(에러)", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	slog.Info("종료 신호 수신 — graceful shutdown")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("graceful shutdown 실패", "err", err)
	}
}
