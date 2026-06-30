// Command glue 는 게이트웨이(Semantic Router) 옆 캡처 서비스다.
//
// 추론 요청의 프롬프트·응답·가드레일 판정을 받아(POST /v1/capture), FABRIX 마스킹 정책을
// 적용하고, 요청의 W3C trace-id 로 Langfuse ingestion 배치를 만들어 비동기 전송한다.
// vLLM OTEL 이 보내지 않는 "프롬프트/응답 원문"을 정책 통제하에 채우는 조각(docs/integration/k8s-otel-langfuse-연동.md §4.5).
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

	"github.com/maymust/fabrix-endpoint/internal/glue"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	cfg := glue.Load()

	policy := glue.NewPolicyStore(cfg.BFFURL, cfg.PollInterval)
	lf := glue.NewLangfuse(cfg.LangfuseHost, cfg.LangfusePublic, cfg.LangfuseSecret)
	g := glue.New(policy, glue.NewMasker(cfg.MaskSalt), lf)

	// 마스킹 정책 폴링 시작.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go policy.Run(ctx)

	srv := &http.Server{Addr: cfg.Addr, Handler: g.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		slog.Info("FABRIX 게이트웨이 글루 시작", "addr", cfg.Addr, "bff", cfg.BFFURL,
			"langfuse", lf.Enabled(), "poll", cfg.PollInterval.String())
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("글루 종료(에러)", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	slog.Info("종료 신호 — graceful shutdown")
	sctx, scancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer scancel()
	_ = srv.Shutdown(sctx)
}
