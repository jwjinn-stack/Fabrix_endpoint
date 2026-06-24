# FABRIX Endpoint

vLLM Production Stack(추론 백엔드) 위에 올라가는 **인퍼런스 거버넌스·관제 레이어**.
누가·어떤 앱·어떤 키·어떤 모델/GPU를 얼마나 잘 쓰는지 귀속하고, 가드레일 증적을 남기며, 관제한다.

> 설계 단일 출처(SSOT): [docs/FABRIX-endpoint-개발참조-통합문서.md](docs/FABRIX-endpoint-개발참조-통합문서.md)

## 구성 (모노레포)

| 디렉토리 | 스택 | 역할 |
|----------|------|------|
| [backend/](backend/) | Go 1.26 | API(BFF) — 대시보드/리포트/증적 데이터를 프론트에 제공. 데이터 소스는 인터페이스로 추상화(현재 mock 주입) |
| [web/](web/) | React + TypeScript + Vite | 관제 대시보드 · 사용량 리포트 · 가드레일 증적 뷰 (MVP 3대 화면) |
| [docs/](docs/) | — | 설계 통합 문서 + 배포 템플릿 |

## 현재 진행 상태 (MVP 1슬라이스)

- ✅ 모노레포 스캐폴딩 (Go API + React Web)
- ✅ 관제 대시보드(문서 4-1) end-to-end — **mock 데이터 기반**
- ⏳ 사용량 리포트(4-2), 가드레일 증적 뷰(4-3) — 후속
- ⏳ 실제 데이터 소스 연동(Prometheus / ClickHouse / 증적 파이프라인) — `provider` 인터페이스 교체로 대응

> 실제 vLLM/Dynamo/ClickHouse/Prometheus 백엔드는 아직 로컬에 없으므로, API는 문서 스키마(2-2 / 3-5 등) 형태의 **mock 데이터**를 반환한다. 연동 시 [backend/internal/provider](backend/internal/provider) 인터페이스의 구현만 교체하면 프론트·핸들러는 불변.

## 빠른 시작

```bash
# 1) 백엔드 (Go API) — 기본 :8080
make backend          # 또는: cd backend && go run ./cmd/api

# 2) 프론트 (React) — 기본 :5173, /api 는 :8080 으로 프록시
make web              # 또는: cd web && npm install && npm run dev
```

브라우저에서 http://localhost:5173 접속 → 관제 대시보드.

## API (MVP)

| Method | Path | 설명 | 화면 |
|--------|------|------|------|
| GET | `/api/v1/healthz` | 헬스체크 | — |
| GET | `/api/v1/dashboard/overview?range=1h` | 4카드(트래픽/품질/가드레일/GPU) + 부서·앱 분포 + 알람 | 4-1 |
| GET | `/api/v1/dashboard/timeseries?range=1h` | QPS / TTFT p95 / 차단건수 시계열 | 4-1 |

`range`: `1h` · `6h` · `24h` · `7d`
# Fabrix_endpoint
