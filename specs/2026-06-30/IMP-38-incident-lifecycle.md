# IMP-38 — 알림 acknowledge/resolve/snooze 인시던트 라이프사이클

## 목적
Notifications.tsx 는 overview.alarms + guard 차단을 그때그때 합쳐 read-only 로만 보여준다.
상태(ack/resolve/snooze)·발생/해소 시각·중복 그룹핑·이력 영속이 없어, 새로고침하면 사라진다.
OnCall/PagerDuty 모델을 채택해 **인시던트 라이프사이클**을 도입한다(group-merge dedup,
ack/resolve/snooze 전이, snooze 만료 자동 re-fire, 정상복귀 신호 auto-resolve).

Sources: Grafana OnCall alert groups, PagerDuty alerts lifecycle.

## 비목표 / SCOPE
- 인메모리(`internal/incident` Store seam — 기존 DataStore/mockstore 패턴). ZERO new deps(FE·Go).
- 아웃바운드 발송 자체는 IMP-15 가 담당. 여긴 인시던트 *상태관리*만.
- 기존 alarms/guard 표시는 보존하되 인시던트 모델 위로 재구성.
- 민감 영역 아님(인증/과금/아웃바운드/PII 아님) — 일반 빌드.

## 함수 시그니처 / 모델

### Go: `internal/incident/incident.go`
```go
type State string // "triggered" | "acked" | "resolved" | "snoozed"

type Occurrence struct { Ts string `json:"ts"` }           // 발생 타임스탬프(최근 N개)
type AuditEntry struct { Ts, From, To, By, Note string }    // 상태전이 이력

type Incident struct {
    ID            string       // inc_<dedupHash 앞부분>
    DedupKey      string       // ruleRef+scope 원본(표시·매칭용)
    Severity      string       // info|warning|critical
    Title         string
    State         State
    FirstSeen     string       // RFC3339
    LastSeen      string
    Count         int
    Occurrences   []Occurrence // 최근 N(=20)개
    AckedBy       string
    ResolvedBy    string
    SilencedUntil string       // snooze 만료(RFC3339); 빈 문자열=없음
    Note          string
    Audit         []AuditEntry
}

// Store (seam) — in-memory. now() 주입으로 시간 테스트 가능.
func NewStore() *Store
func (s *Store) SetNow(fn func() time.Time)         // 테스트 전용

// Observe 는 발생 신호를 흡수한다. 동일 dedupKey open(triggered/acked/snoozed) 인시던트가
// 있으면 group-merge(count++, lastSeen 갱신, occurrence push, resolved/snoozed→triggered 복귀),
// 없으면 새 인시던트 생성. 반환: 영향받은 인시던트 사본.
func (s *Store) Observe(dedupKey, severity, title string) Incident

// AutoResolve 는 동일 dedupKey 의 open 인시던트를 정상복귀 신호로 resolved 처리.
func (s *Store) AutoResolve(dedupKey string) (Incident, bool)

func (s *Store) List(filterState, filterSeverity string) []Incident // 필터(빈=전체), lastSeen desc
func (s *Store) Ack(id, by string) (Incident, error)
func (s *Store) Resolve(id, by string) (Incident, error)
func (s *Store) Snooze(id string, d time.Duration, by string) (Incident, error)

// Tick 는 silencedUntil 만료된 snoozed 인시던트를 triggered 로 re-fire(만료 처리).
// List/Observe 진입 시 호출(lazy) + 명시 호출 가능. 반환: re-fire 된 개수.
func (s *Store) Tick() int
```
- dedup hash: `inc_` + sha256(dedupKey) 앞 12 hex. group-merge 는 hash 가 아니라 dedupKey 원본으로 매칭.
- open 상태 = triggered|acked|snoozed (resolved 는 closed). Observe 시 closed 인시던트는
  새 인시던트로 재오픈하지 않고 **같은 id 재오픈**(resolved→triggered)으로 흡수(중복 폭증 방지).
- Occurrence ring 상한 20.

### Go: server 와이어링
- `Server.incidents *incident.Store` 필드 추가. `New()` 에서 `incident.NewStore()`.
- 시드: 기존 overview.alarms / guard 차단을 인시던트로 한 번 흡수하는 대신, **핸들러에서 합성 seed**
  (mock 정합): server.New 시 dashboard overview 의존 없이, incident store 에 결정적 seed 3~4건 주입
  (mockstore 정합 — `seedIncidents()` helper, in server). live 연동 시 quota/guard hook 으로 교체.

### Go: 엔드포인트 (`internal/server/incidents.go`)
```
GET  /api/v1/incidents?state=&severity=     -> {incidents:[...], counts:{triggered,acked,resolved}}
POST /api/v1/incidents/{id}/ack             -> {incident}
POST /api/v1/incidents/{id}/resolve         -> {incident}
POST /api/v1/incidents/{id}/snooze {minutes} -> {incident}   (minutes 1..1440)
```
- 라우팅/게이팅: 조회(GET)는 `capability.Guard`(observe·manage 공통 read).
  ack 는 observe 도 허용 — **신규 cap `IncidentAck`**: observe 기본 on, manage on.
  resolve/snooze(=write)는 **신규 cap `IncidentWrite`**(=manage 전용, observe 미등록 404).
  → "observe 는 ack 까지만, write=manage" 요구 충족. 미등록이 실제 차단.
- id/minutes 입력 검증: id 는 store 조회로만 사용(주입 없음), minutes 는 1..1440 clamp+거부.

### FE: `web/src/components/Notifications.tsx` → 인시던트 인박스
```ts
type IncidentState = "triggered" | "acked" | "resolved" | "snoozed";
interface Incident { id; dedup_key; severity; title; state; first_seen; last_seen;
  count; acked_by?; resolved_by?; silenced_until?; note?; }
interface IncidentList { incidents: Incident[]; counts: Record<string,number>; }
```
- 상태 필터 탭: 미처리(triggered+snoozed) / 처리중(acked) / 해소(resolved). 기본 미처리.
- 각 행: severity dot, title, 발생횟수(count), 최초/최근 시각, 상태 배지.
- 액션: ack 버튼(triggered/snoozed 일 때), snooze(분 선택; triggered/acked), resolve(manage write cap).
  cap 게이팅: `useCap().can("incident.write")` → resolve/snooze 노출, ack 는 항상.
- 액션 후 toast(IMP-29) 피드백 + 목록 reload. IMP-31 비-모달 `<dialog>` 비회귀(show(), Escape 보강 유지).
- client.ts: `fetchIncidents(state?,severity?,signal)`, `ackIncident(id)`, `resolveIncident(id)`, `snoozeIncident(id,minutes)`.
- mock.ts: in-memory INCIDENTS + group-merge/ack/resolve/snooze 라우트(데이터 흐름 QA).

## 테스트 케이스
### Go (`internal/incident/incident_test.go`)
1. group-merge: 동일 dedupKey 2회 Observe → 1건, count=2, occurrences=2, firstSeen<lastSeen.
2. ack 전이: triggered→Ack→state=acked, ackedBy 기록, audit 1건.
3. snooze→silencedUntil→만료 re-fire: Snooze 10m → state=snoozed, silencedUntil set;
   now+11m 후 Tick → state=triggered(re-fire), audit 에 전이 기록.
4. auto-resolve: open 인시던트 AutoResolve → resolved, resolvedBy="auto".
5. resolved 재오픈: resolved 후 동일 dedupKey Observe → 같은 id, state=triggered.
6. List 필터: state/severity 필터가 정확히 거른다.

### Go (`internal/server/incidents_test.go`)
7. observe 게이트: `incident.write` 없는 caps → POST .../resolve 404, .../ack 200(처리).
8. manage: ack/resolve/snooze 200 + 상태 반영. snooze minutes 범위 밖 400.

### FE (`Notifications.test.tsx` 확장 또는 신규)
9. 인박스 렌더: incidents stub → 행/카운트 표시.
10. 상태 탭 전환: 해소 탭 클릭 → resolved 만.
11. ack 액션 → ackIncident 호출 + reload.

## 출력 위치
- `backend/internal/incident/incident.go`, `incident_test.go`
- `backend/internal/server/incidents.go`, `incidents_test.go`, server.go(필드/라우트/seed), capability/capability.go(2 cap)
- `web/src/components/Notifications.tsx`, `Notifications.test.tsx`, `web/src/api/client.ts`, `types.ts`, `mock.ts`

## 의존성
없음(zero new deps, FE·Go 모두). 기존 toast/dialog/capability 패턴 재사용.
