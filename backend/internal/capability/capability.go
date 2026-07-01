// Package capability 는 배포 프로파일과 세분화된 기능 플래그(capability)를 해석한다.
//
// 동일 바이너리를 환경변수만으로 두 제품처럼 배포하기 위한 것:
//   - observe : 메트릭·trace·쿠버 데이터를 읽기 전용으로 보여주는 관제 대시보드(예: 삼성증권).
//     mutating(생성/변경/삭제) cap 이 전부 꺼져 있어 server 가 해당 라우트를 아예 등록하지 않는다.
//   - manage  : 엔드포인트 생성·삭제까지 완전 관리하는 풀버전(모든 cap on).
//
// observe 의 화면 구성은 고객사/협력사 환경마다 유동적이므로, 프로파일이 기본값을 깔고
// FABRIX_FEATURES("+cap,-cap")로 개별 on/off 를 미세조정한다.
package capability

import "strings"

// 기능 키. ".write" 계열과 mutating 집합(아래)은 생성/변경/삭제를 수반한다.
const (
	Dashboard      = "dashboard"       // 관제·사용량·GPU·트래픽 (read)
	Traces         = "traces"          // 트레이스·세션 (read, Langfuse 정합)
	Guard          = "guard"           // 가드레일 증적·상태·정책 조회 (read)
	GuardWrite     = "guard.write"     // 가드레일 정책 변경(PUT)·분류 테스트(POST)
	Models         = "models"          // 모델 카탈로그·Harbor 레지스트리 조회 (read)
	ModelsWrite    = "models.write"    // 모델 임포트(Harbor import)
	Playground     = "playground"      // 플레이그라운드 chat (업스트림 호출·증적)
	Eval           = "eval"            // LLM-as-judge 평가 실행
	Endpoints      = "endpoints"       // 엔드포인트 목록·로그 (read)
	EndpointsWrite = "endpoints.write" // 엔드포인트 미리보기·생성·삭제
	Keys           = "keys"            // 키·앱 목록 (read)
	KeysWrite      = "keys.write"      // 키 발급·회수
	Users          = "users"           // 조직·사용자 조회 (read, RBAC)
	UsersWrite     = "users.write"     // 사용자 생성·수정·삭제, 앱 부서 설정
	Credentials    = "credentials"     // 서드파티 자격증명 조회·설정(민감)
	IncidentAck    = "incident.ack"    // 알림 인시던트 acknowledge(IMP-38) — observe 도 허용(ack-only)
	IncidentWrite  = "incident.write"  // 인시던트 resolve/snooze — manage 전용(상태 변경)
)

// all 은 정의된 모든 cap. manage 기본(=전부 on)과 /capabilities 응답 완전성의 단일 출처.
var all = []string{
	Dashboard, Traces, Guard, GuardWrite, Models, ModelsWrite,
	Playground, Eval, Endpoints, EndpointsWrite, Keys, KeysWrite,
	Users, UsersWrite, Credentials, IncidentAck, IncidentWrite,
}

// observeDefaults 는 observe 프로파일에서 기본 on 인 cap(읽기 관제 화면).
// 엔드포인트/키/사용자 읽기 등은 고객사별로 FABRIX_FEATURES 로 추가로 켠다.
// incident.ack 는 관제 운영자가 인시던트를 *처리중* 으로 표시할 수 있어야 하므로 observe 기본 on
// (IMP-38: observe=ack-only, resolve/snooze=manage).
var observeDefaults = []string{Dashboard, Traces, Guard, Models, IncidentAck}

// mutating 은 상태를 바꾸거나 외부로 부수효과를 내는 cap. 하나라도 켜지면 Readonly=false.
// (".write" 외에 playground/eval/credentials 도 mutating 으로 본다.)
// incident.ack 는 mutating 이 아니다(상태 표시일 뿐 — observe 의 read-only 성질을 깨지 않는다).
// incident.write(resolve/snooze)만 mutating.
var mutating = map[string]bool{
	GuardWrite: true, ModelsWrite: true, Playground: true, Eval: true,
	EndpointsWrite: true, KeysWrite: true, UsersWrite: true, Credentials: true,
	IncidentWrite: true,
}

// known 은 override 파싱 시 알 수 없는 키를 걸러내기 위한 색인.
var known = func() map[string]bool {
	m := make(map[string]bool, len(all))
	for _, c := range all {
		m[c] = true
	}
	return m
}()

// Set 은 해석된 기능 집합. 모든 cap 키를 명시적으로 담는다(true/false).
type Set map[string]bool

// Can 은 cap 활성 여부를 반환한다.
func (s Set) Can(cap string) bool { return s[cap] }

// Readonly 는 mutating cap 이 하나도 없을 때 true. observe 의 본질적 성질.
func (s Set) Readonly() bool {
	for cap := range mutating {
		if s[cap] {
			return false
		}
	}
	return true
}

// Resolve 는 프로파일 기본값에 override(FABRIX_FEATURES)를 적용해 Set 을 만든다.
//
// profile : "observe"(읽기 관제만) | 그 외 전부 "manage"(전부 on, 기본).
// override: "+cap,-cap" 콤마 구분. 선행 +/생략은 추가, -는 제거. 공백·대소문자 무시,
//
//	알 수 없는 키는 무시한다. 예: "+endpoints,+keys,-models".
func Resolve(profile, override string) Set {
	s := Set{}
	for _, c := range all {
		s[c] = false // 모든 키 명시 → /capabilities 응답 완전성
	}
	switch strings.ToLower(strings.TrimSpace(profile)) {
	case "observe":
		for _, c := range observeDefaults {
			s[c] = true
		}
	default: // manage (기본): 전부 on
		for _, c := range all {
			s[c] = true
		}
	}
	for _, tok := range strings.Split(override, ",") {
		tok = strings.ToLower(strings.TrimSpace(tok))
		if tok == "" {
			continue
		}
		add := true
		switch tok[0] {
		case '+':
			tok = strings.TrimSpace(tok[1:])
		case '-':
			add, tok = false, strings.TrimSpace(tok[1:])
		}
		if known[tok] {
			s[tok] = add // 알 수 없는 키는 무시
		}
	}
	return s
}
