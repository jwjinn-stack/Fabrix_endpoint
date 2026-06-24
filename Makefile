.PHONY: backend web build-backend build-web tidy clean

# 백엔드: Go API 서버 실행 (:8080)
backend:
	cd backend && go run ./cmd/api

# 프론트: React 개발 서버 실행 (:5173, /api → :8080 프록시)
web:
	cd web && npm install && npm run dev

# 백엔드 바이너리 빌드
build-backend:
	cd backend && go build -o bin/api ./cmd/api

# 프론트 프로덕션 빌드
build-web:
	cd web && npm install && npm run build

tidy:
	cd backend && go mod tidy

clean:
	rm -rf backend/bin web/dist web/node_modules
