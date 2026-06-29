package capability

import "testing"

func TestResolveManageDefault(t *testing.T) {
	// 빈 프로파일/알 수 없는 프로파일은 manage 로 폴백 — 전부 on, 변경 가능.
	for _, p := range []string{"", "manage", "MANAGE", "weird"} {
		s := Resolve(p, "")
		for _, c := range all {
			if !s.Can(c) {
				t.Errorf("profile %q: cap %q 가 off (manage 는 전부 on 이어야 함)", p, c)
			}
		}
		if s.Readonly() {
			t.Errorf("profile %q: manage 는 Readonly 가 아니어야 함", p)
		}
	}
}

func TestResolveObserveDefault(t *testing.T) {
	s := Resolve("observe", "")
	// 읽기 관제 cap 만 on.
	for _, c := range []string{Dashboard, Traces, Guard, Models} {
		if !s.Can(c) {
			t.Errorf("observe: 읽기 cap %q 가 켜져 있어야 함", c)
		}
	}
	// 모든 mutating cap 과 추가 읽기 cap(endpoints/keys/users)은 off.
	for _, c := range []string{GuardWrite, ModelsWrite, Playground, Eval, EndpointsWrite, KeysWrite, UsersWrite, Credentials, Endpoints, Keys, Users} {
		if s.Can(c) {
			t.Errorf("observe: cap %q 는 기본 off 여야 함", c)
		}
	}
	if !s.Readonly() {
		t.Error("observe 기본은 Readonly 여야 함")
	}
}

func TestResolveObserveOverrideAddReadOnly(t *testing.T) {
	// 고객사별 미세조정: 읽기 cap 추가는 Readonly 를 깨지 않는다.
	s := Resolve("observe", "+endpoints,+keys")
	if !s.Can(Endpoints) || !s.Can(Keys) {
		t.Error("override 로 endpoints/keys 읽기가 켜져야 함")
	}
	if s.Can(EndpointsWrite) || s.Can(KeysWrite) {
		t.Error("읽기 cap 추가가 write cap 까지 켜면 안 됨")
	}
	if !s.Readonly() {
		t.Error("읽기 cap 만 추가했으므로 여전히 Readonly 여야 함")
	}
}

func TestResolveOverrideRemoveAndUnknown(t *testing.T) {
	s := Resolve("observe", "-guard, +bogus , +ENDPOINTS")
	if s.Can(Guard) {
		t.Error("-guard 로 가드레일 읽기가 꺼져야 함")
	}
	if s.Can("bogus") {
		t.Error("알 수 없는 키는 무시되어야 함")
	}
	if !s.Can(Endpoints) {
		t.Error("대문자/공백 토큰(+ENDPOINTS)도 인식되어야 함")
	}
}

func TestResolveWriteOverrideBreaksReadonly(t *testing.T) {
	s := Resolve("observe", "+endpoints.write")
	if !s.Can(EndpointsWrite) {
		t.Error("+endpoints.write 가 켜져야 함")
	}
	if s.Readonly() {
		t.Error("write cap 이 켜졌으면 Readonly 가 아니어야 함")
	}
}

func TestResolveAlwaysIncludesAllKeys(t *testing.T) {
	// observe 라도 모든 cap 키가 맵에 존재해야 한다(/capabilities 응답 완전성).
	s := Resolve("observe", "")
	if len(s) != len(all) {
		t.Errorf("Set 은 모든 cap 키(%d)를 담아야 함, got %d", len(all), len(s))
	}
}
