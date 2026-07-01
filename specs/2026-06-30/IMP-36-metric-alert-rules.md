# IMP-36 — 지표 기반 알림 룰(지연 p95·에러율·가드 차단율 급증)

- **Type**: compete (sev=high, effort=L) — SENSITIVE(아웃바운드 알림)
- **Branch**: `feature/evolve-cycle2-alertrules`
- **Area**: `backend/internal/server/server.go`, `backend/internal/alerting/alerting.go`,
  `backend/internal/mockstore/`, `web/src/pages/Settings.tsx`, `web/src/pages/Diagnostics.tsx`

## 목적

알림이 quota.OnThresholdCross 한 곳(키별 토큰예산 = EventThresholdCrossed/EventBudgetCrossed)에만
묶여 있다. p95 지연·에러율·가드 차단율 같은 지표는 이미 산출되지만(overview/timeseries),
임계를 넘어도 아무도 통지받지 못한다. Langfuse(monitors)·Datadog(metric monitor)·Grafana(alert
rules)는 임의 지표 threshold 알림이 핵심. "돈 새는 것"만 알리고 "느려지거나 깨지는 것"은 못 알리는
비대칭을 없앤다.

정적 임계가 phase 1 의 기본(유일) 룰 타입. anomaly(EMA±σ)·outlier 는 baseline store 가 필요하므로
**phase 2 로 분리**(이 spec 범위 밖, 미구현).

## 요구사항

1. **AlertRule 모델**: dataSource/metric(화이트리스트 enum), aggregation, scope(global; endpoint/model
   filters 는 phase 1 에서 global 만), op(gt|gte|lt|lte), alertThreshold, warnThreshold(옵션 2-tier),
   window(5m/1h/1d enum), severity, enabled.
2. **평가 루프**: 기존 overview/timeseries 산출을 재사용(신규 data path 없음). 상태머신
   OK→WARNING→ALERT→NO_DATA(→PAUSED) 로 bare boolean 대신. Datadog anti-flapping 기본 내장:
   - **NO_DATA 게이트**: window 가 충분한 데이터포인트(≥minDataPoints)를 못 채우면 NO_DATA — error_rate/
     block_rate 가 빈 window 에서 조용히 발화하지 않는다(noDataMode 기본 NO_DATA).
   - **히스테리시스(recoveryWindow)**: trigger 후 동일 횟수만큼 연속 clear 돼야 복구(진동 방지).
   - **renotify**: elevated 상태가 지속되면 N분마다 재통지. 기존 alerting.go dedup 키 재사용.
3. **EventMetricBreached**: alerting.EventType 에 추가. 발화/복구 모두 **기존 IMP-15 디스패처(Dispatch)**
   로 보낸다. **새 아웃바운드 경로/채널 신설 금지** — SSRF 검증·해시 토큰·dedup·observe 차단 전부 재사용.
4. **CRUD endpoints**: list/get(read), create/update/delete(write=manage 게이트). observe 읽기전용.
5. **UI 패널**: Settings(+Diagnostics 링크) '알림 룰' = 룰 목록 + 생성 폼 + 선택 window 대비 live
   current-value preview. manage 편집 / observe 읽기전용(capability 게이트).

## 함수 시그니처

### AlertRule (backend/internal/domain/alertrule.go)
```go
type AlertMetric string // ttft_p95 | latency_avg | error_rate | block_rate | throughput | count
type AlertOp string     // gt | gte | lt | lte
type AlertWindow string // 5m | 1h | 1d
type AlertState string  // OK | WARNING | ALERT | NO_DATA | PAUSED
type NoDataMode string  // no_data(기본) | treat_as_zero | hold_previous

type AlertRule struct {
  ID, Name      string
  Metric        AlertMetric
  Op            AlertOp
  AlertThreshold float64
  WarnThreshold *float64    // 옵션 2-tier
  Window        AlertWindow
  Severity      string      // info|warning|critical
  NoDataMode    NoDataMode
  Enabled       bool
  // 평가 상태(서버 보유, 응답 표시):
  State         AlertState
  LastValue     *float64
  LastEvalAt    string
  CreatedAt     string
}
func (r AlertRule) Validate() error // metric/op/window/severity 화이트리스트 + threshold 유한·범위
```

### 평가 엔진 (backend/internal/alertrules/engine.go)
```go
type MetricSnapshot struct { Value float64; HasData bool } // overview/timeseries 에서 추출
type Evaluator struct { ... } // 룰 ID 별 상태머신 + 연속 카운터 보유
// Evaluate: 현재 스냅샷으로 룰 상태 전이 계산. 발화/복구 이벤트를 반환(디스패치는 호출자가).
func (e *Evaluator) Evaluate(rule domain.AlertRule, snap MetricSnapshot, now time.Time) (next domain.AlertState, fire *FireDecision)
// FireDecision{ Kind: "alert"|"warn"|"recover", Renotify bool }
```

### 스토어 seam (server.AlertRuleStore — mockstore 구현)
```go
type AlertRuleStore interface {
  ListAlertRules(ctx) ([]domain.AlertRule, error)
  GetAlertRule(ctx, id) (domain.AlertRule, error)
  CreateAlertRule(ctx, domain.AlertRule) (domain.AlertRule, error)
  UpdateAlertRule(ctx, id, domain.AlertRule) (domain.AlertRule, error)
  DeleteAlertRule(ctx, id) error
}
```

### endpoints (server)
- `GET  /api/v1/alerts/rules`              (Dashboard read cap) — 목록 + 상태
- `GET  /api/v1/alerts/rules/preview`      (read) — metric×window 의 live current value(신뢰 UX)
- `POST /api/v1/alerts/rules`              (Credentials write cap = manage)
- `PUT  /api/v1/alerts/rules/{id}`         (write)
- `DELETE /api/v1/alerts/rules/{id}`       (write)

### UI 패널
- `web/src/pages/Settings.tsx` 에 `AlertRulesCard` 추가(manage 편집 / observe 읽기전용).
- 룰 목록 테이블(metric/op/threshold/window/state) + 생성 폼 + live preview(선택 metric×window 현재값).
- Diagnostics 는 동일 카드를 재사용/링크(패널 위치).

## 테스트 케이스

- **정적임계 발화**: error_rate 룰 op=gt thr=0.05, snap value=0.1 → ALERT + fire(alert).
- **2-tier warn vs alert**: warn=0.03/alert=0.05, value=0.04 → WARNING(fire warn), value=0.1 → ALERT.
- **NO_DATA 게이트(빈 window 무발화)**: error_rate snap HasData=false, noDataMode=no_data → NO_DATA,
  fire=nil(조용한 발화 없음).
- **recoveryWindow 히스테리시스**: ALERT 후 1회 clear 로는 복구 안 됨(recoveryWindow=2), 2회 연속 clear
  여야 OK + fire(recover).
- **renotify**: ALERT 지속 시 renotify 간격 경과 후 fire(alert, Renotify=true), 간격 내 재평가는 fire=nil.
- **EventMetricBreached → 디스패처**: 발화가 alerting.Dispatch(EventMetricBreached) 로 가고 페이로드에
  평문 키/PII 없음(해시 토큰만, EventGroup="metric").
- **observe write 차단**: observe 프로파일에서 POST/PUT/DELETE 라우트 미등록(404).
- **FE RTL**: 룰 패널 렌더 + 생성폼 + live preview 표시 + observe 읽기전용(편집 버튼 숨김).

## 위협 모델 (SENSITIVE — 아웃바운드 알림)

- **아웃바운드는 IMP-15 재사용**: 발송은 전부 `alerting.Dispatcher.Dispatch` 를 거친다. 새 SSRF 표면·
  새 채널 없음. URL 검증·해시 토큰·dedup·observe 차단(enabled=false)·비차단 go 발송 전부 상속.
- **조용한 발화 방지(noDataMode)**: 빈/저샘플 window 에서 error_rate·block_rate 가 0 으로 읽혀 거짓
  발화하지 않게 NO_DATA 게이트(기본). treat_as_zero 는 명시 선택해야만.
- **진동 방지(recoveryWindow)**: 히스테리시스로 OK↔ALERT 플래핑 차단. renotify 는 dedup 키로 폭주 억제.
- **입력 화이트리스트·bounded**: metric/op/window/severity 는 enum 화이트리스트, threshold 는 유한·범위
  검증(NaN/Inf 거부). 룰 본문 MaxBytesReader 로 제한.
- **write=manage 게이트**: 룰 CRUD 변경은 Credentials cap(=manage). observe 는 라우트 미등록(404).
- **로그/페이로드 비밀·PII 금지**: 평가가 식별정보를 로그/페이로드에 넣지 않음(IMP-15 해시 토큰 패턴 유지,
  EventGroup="metric" 이므로 키 식별자조차 불필요 — 룰 ID/metric 만).

## 출력 위치

- backend: `internal/domain/alertrule.go`, `internal/alertrules/engine.go`(+test),
  `internal/mockstore/mockstore.go`(store 메서드), `internal/server/alertrules.go`(+test),
  `internal/server/server.go`(라우트·EventMetricBreached 배선), `internal/alerting/alerting.go`(EventType).
- web: `src/api/types.ts`, `src/api/client.ts`, `src/api/mock.ts`, `src/pages/Settings.tsx`
  (`AlertRulesCard` + test), `src/pages/Diagnostics.tsx`(링크).

## 의존성

없음(zero new deps). 표준 라이브러리 + 기존 IMP-15 alerting 인프라만 사용.
```
```
