// Package httpx 는 JSON 응답·미들웨어 등 HTTP 보조 유틸을 제공한다.
package httpx

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// JSON 은 v 를 JSON 으로 직렬화해 상태코드와 함께 응답한다.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("응답 직렬화 실패", "err", err)
	}
}

// Error 는 표준 에러 응답({"error": ...})을 반환한다.
func Error(w http.ResponseWriter, status int, msg string) {
	JSON(w, status, map[string]string{"error": msg})
}
