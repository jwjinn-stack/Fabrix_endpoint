# IMP-15 — 예산·이상 임계 초과 시 아웃바운드 알림 라우팅 (Webhook 디스패처)

## 목적
키별 일 토큰 예산(tpd) 게이지가 이미 계산하는 `alert_threshold`(임계) 교차 시점에, 화면을
보지 않아도 알 수 있도록 **외부로 능동 통지**하는 경로를 신설한다. 신규 판정 경로는 만들지
않는다 — 기존 quota 게이지가 산출하는 임계에 **디스패치만 hook** 한다(LiteLLM 이벤트 모델).

채널은 폐쇄망(air-gapped) 마찰이 가장 적은 **제네릭 Webhook 우선**. SMTP 는 인터페이스만
정의(스텁). Slack 불필요. observe(읽기 전용) 프로파일은 채널 설정 숨김 + 발송 비활성.

## 요구사항
1. **판정 경로 신설 금지.** `Limiter.AddTokens` 직후 임계(threshold)·예산(budget) 교차 시점에만 발화.
2. **페이로드 = LiteLLM 호환**: `{event, event_group, token(해시), spend, max_budget, event_message}`.
   - `event` ∈ {`threshold_crossed`, `budget_crossed`}
   - `event_group` = `key`(MVP. model/dept 는 후속)
   - `token` = **API 키 평문이 아니라 salted hash**(기존 attribution UserRef 와 동일 해시 계열)
   - `spend`/`max_budget` = 추정 KRW (EstCostKRW 기반). 평문 키·PII 미포함.
3. **채널 = 제네릭 Webhook 먼저**. SMTP 는 인터페이스 스텁만. Slack 없음.
4. **dedup TTL 필수**: 키×event 당 24h(`budget_alert_ttl=86400s`). 없으면 매 요청 발송 폭주.
5. **발송 이력 audit**(성공/실패/스킵 사유를 구조화 로그 + 인메모리 ring).
6. **UI**: Settings 에 Webhook URL 등록(manage 전용) + Keys 폼 AlertThreshold 옆 '초과 시 통지' 토글.
7. **profile 게이팅**: observe = 채널 설정 숨김 + 디스패처 발송 비활성(manage 전용).

## 위협 모델 / 아웃바운드 (SENSITIVE)
- **SSRF**: webhook URL 은 운영자 설정이지만 outbound. scheme 화이트리스트(`https`/`http`)만
  허용하고, 명백한 internal-metadata 타깃(169.254.169.254, `[::1]`, `metadata.google.internal`,
  localhost/루프백, `*.svc.cluster.local`, 와일드카드 사설망 대역은 **경고**)을 차단/거부한다.
  - 폐쇄망에서는 URL 이 **반드시 내부 relay** 여야 함을 문서화(외부 SaaS 직결 금지).
  - 잔여 SSRF 표면: 운영자가 의도적으로 사설 IP 를 넣으면 내부 도달 가능 — 그래서 manage(쓰기
    권한자)만 등록 가능 + scheme/메타데이터 거부 + 감사로그로 한정. DNS rebinding 까지는 막지
    않음(타임아웃·비차단·재시도 1회로 폭발 반경 제한). 사람 리뷰어 확인 항목.
- **payload/로그에 비밀·PII 금지**: webhook URL 을 토큰 임베드 형태로 로깅하지 않음(redact).
  페이로드의 `token` 은 평문 API 키가 아니라 salted hash. PII 미포함.
- **spam → dedup**: 키×event 당 24h TTL. 교차 1회만 발송, 같은 날 재교차는 억제.
- **non-blocking + bounded**: `go` 디스패치, `http.Client{Timeout}` + 재시도 1회(짧은 backoff).
  요청 hot path 를 절대 블록하지 않음. 실패는 감사만, fatal 아님.
- **profile 게이팅**: observe 배포는 발송 안 함(읽기 전용). manage 전용. 신규 의존성 0(net/http).

## 함수 시그니처
```go
// internal/alerting/alerting.go
type Event struct {
    Event        string  `json:"event"`         // threshold_crossed | budget_crossed
    EventGroup   string  `json:"event_group"`   // key | model | dept
    Token        string  `json:"token"`         // salted hash (NOT plaintext key)
    Spend        float64 `json:"spend"`         // 추정 KRW
    MaxBudget    float64 `json:"max_budget"`    // 추정 KRW
    EventMessage string  `json:"event_message"`
}

type Channel interface {            // Webhook / (SMTP stub)
    Name() string
    Send(ctx context.Context, e Event) error
}

func ValidateWebhookURL(raw string) (warnings []string, err error) // SSRF: scheme allowlist + metadata block

type WebhookChannel struct{ /* url, http.Client(timeout), retries */ }
func NewWebhookChannel(url string) (*WebhookChannel, error)

type SMTPChannel struct{} // 인터페이스 스텁만(미구현 — Send=ErrNotImplemented)

type Dispatcher struct{ /* channels, dedup, enabled(profile), salt, audit ring */ }
func NewDispatcher(enabled bool, salt string) *Dispatcher
func (d *Dispatcher) SetWebhook(url string) error          // 빈 url=해제. ValidateWebhookURL 적용
func (d *Dispatcher) WebhookConfigured() bool
func (d *Dispatcher) Dispatch(keyID string, e Event)        // 비동기·비차단·dedup·profile 게이트
func (d *Dispatcher) Audit() []SendRecord                   // 발송 이력(표시용)
func (d *Dispatcher) hashToken(keyID string) string         // salted SHA-256(앞 16자), 평문 미노출

// dedup store (키×event 당 TTL)
type dedup struct{ /* map[string]time.Time, ttl */ }
func (s *dedup) allow(k string) bool   // TTL 내 재발생이면 false(억제)
```

quota hook (판정 신설 없음 — AddTokens 가 교차를 보고 콜백):
```go
// internal/quota: AddTokens 가 임계 교차 시 등록된 콜백을 1회 호출(인메모리 cross 기록으로 1회성 보장)
func (l *Limiter) OnThresholdCross(fn func(key string, kind string, ratio float64, tpd int64))
func (l *Limiter) AddTokensWithBudget(key string, n int, tpd int64) // tpd>0 일 때 교차 판정→콜백
```

## 테스트 케이스
- threshold crossing fires once — tpd·threshold 설정 후 임계 넘기는 AddTokens 1회 → 콜백/발송 1회.
- dedup suppresses within TTL — 같은 키×event 재교차(같은 날) → 억제(발송 0).
- observe profile no-send — `NewDispatcher(enabled=false)` 면 Dispatch 가 발송 안 함.
- webhook failure audited not fatal — 서버 500/네트워크 실패 → panic 없음, Audit 에 실패 기록.
- payload has hashed token not plaintext — 발송 페이로드 `token` 에 평문 keyID 없음, 해시만.
- URL scheme validated — `file://`, `ftp://`, 빈 host → 거부. 169.254.169.254/localhost → 거부.

## 출력 위치
- `backend/internal/alerting/alerting.go` (+ `alerting_test.go`)
- `backend/internal/quota/quota.go` (AddTokensWithBudget + OnThresholdCross hook; + quota_test.go)
- `backend/internal/server/{server.go,catalog.go,keys.go,alerting.go}` (배선·hook·GET/PUT 핸들러)
- `backend/internal/config/config.go` (AlertWebhookURL env)
- `backend/cmd/api/main.go` (디스패처 생성·주입)
- `web/src/pages/Settings.tsx` (Webhook 등록 카드, manage 전용), `web/src/pages/Keys.tsx` ('초과 시 통지' 토글)
- `web/src/api/{client.ts,types.ts}`

## 의존성
없음(net/http 표준 라이브러리만). 신규 npm/go 모듈 0.
