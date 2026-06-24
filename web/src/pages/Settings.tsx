import { useCallback, useEffect, useState } from "react";
import { createUser, deleteUser, fetchUsers, updateUser } from "../api/client";
import type { User } from "../api/types";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import Badge, { type BadgeTone } from "../components/Badge";

const ROLE_LABEL: Record<string, string> = { admin: "관리자(Admin)", user: "일반(User)", super: "슈퍼(Super)" };
const ROLE_TONE: Record<string, BadgeTone> = { admin: "red", super: "pink", user: "green" };

function roleTag(role: string) {
  return <Badge tone={ROLE_TONE[role] ?? "neutral"}>{ROLE_LABEL[role] ?? role}</Badge>;
}

// 역할 × 권한 참조 매트릭스(Langfuse 패턴) — 읽기 전용 참조표.
const PERMS: { label: string; admin: boolean; super: boolean; user: boolean }[] = [
  { label: "대시보드·사용량 조회", admin: true, super: true, user: true },
  { label: "가드레일 증적 조회", admin: true, super: true, user: true },
  { label: "API 키 발급·회수", admin: true, super: true, user: false },
  { label: "가드레일 정책 변경", admin: true, super: true, user: false },
  { label: "엔드포인트 배포·삭제", admin: true, super: true, user: false },
  { label: "사용자·역할 관리", admin: true, super: false, user: false },
];

// 설정/관리 — RBAC/Users·부서 매핑 (문서 2-13). Nutanix Admin·Backend.AI Credentials.
export default function Settings() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<string[]>(["admin", "user", "super"]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "user", dept_id: "" });
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<User | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetchUsers(signal);
      setUsers(r.users);
      setRoles(r.roles);
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const changeRole = async (u: User, role: string) => {
    try {
      await updateUser(u.user_id, { role, dept_id: u.dept_id, status: u.status });
      load();
    } catch (e) { setError((e as Error).message); }
  };

  const remove = async (id: string) => {
    try { await deleteUser(id); load(); } catch (e) { setError((e as Error).message); }
  };

  const submit = async () => {
    if (!form.email.trim() || !form.name.trim()) return;
    setBusy(true);
    try {
      await createUser(form);
      setModal(false);
      setForm({ email: "", name: "", role: "user", dept_id: "" });
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head">
        <h1>설정 · 관리</h1>
        <span className="crumb">설정 / RBAC · Users</span>
        <div className="spacer" />
        <span className="updated">{users.length}명</span>
        <button type="button" className="btn-primary" onClick={() => setModal(true)}>+ 사용자 추가</button>
      </div>

      {error && <div className="state error" role="alert">{error}</div>}
      {!error && loading && users.length === 0 && <div className="state" role="status">사용자를 불러오는 중…</div>}

      <div className="card">
        <div className="card-head">
          <h3>사용자 · 역할</h3>
          <span className="info" title="역할(Admin/User/Super)과 부서 매핑. 역할은 인라인으로 변경됩니다.">ⓘ</span>
        </div>
        {users.length === 0 && !loading ? (
          <div className="empty">사용자가 없습니다. “+ 사용자 추가”로 등록하세요.</div>
        ) : (
          <table className="usage-table">
            <thead>
              <tr><th>이름</th><th>이메일</th><th>역할</th><th>부서</th><th>상태</th><th></th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="clickable" onClick={() => setDetail(u)}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select className="range-select" value={u.role} onChange={(e) => changeRole(u, e.target.value)}>
                      {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
                    </select>
                  </td>
                  <td>{u.dept_id || <span className="muted">—</span>}</td>
                  <td>{u.status === "active" ? <Badge tone="green" dot>활성</Badge> : <Badge tone="neutral" dot>비활성</Badge>}</td>
                  <td className="num">
                    <button type="button" className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); remove(u.user_id); }}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>역할 × 권한 참조</h3>
          <span className="info" title="역할별 허용 권한(읽기 전용 참조). 실제 강제는 API 레벨 RBAC.">ⓘ</span>
        </div>
        <table className="usage-table rbac-matrix">
          <thead>
            <tr>
              <th>권한</th>
              <th className="num">관리자(Admin)</th>
              <th className="num">슈퍼(Super)</th>
              <th className="num">일반(User)</th>
            </tr>
          </thead>
          <tbody>
            {PERMS.map((p) => (
              <tr key={p.label}>
                <td>{p.label}</td>
                <td className="num">{p.admin ? <span className="perm-yes">✓</span> : <span className="perm-no">✕</span>}</td>
                <td className="num">{p.super ? <span className="perm-yes">✓</span> : <span className="perm-no">✕</span>}</td>
                <td className="num">{p.user ? <span className="perm-yes">✓</span> : <span className="perm-no">✕</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="policy-hint">모든 권한 토글·역할 변경은 감사 이벤트로 캡처됩니다. 상향 권한 부여 차단(자신보다 높은 역할 부여 불가)은 현재 사용자 컨텍스트 연동 후 활성화됩니다.</div>
      </div>

      <SlidePanel
        open={!!detail}
        title={detail ? `사용자 · ${detail.name}` : ""}
        subtitle={detail?.email}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <DetailRow label="이름">{detail.name}</DetailRow>
            <DetailRow label="이메일">{detail.email}</DetailRow>
            <DetailRow label="역할">{roleTag(detail.role)}</DetailRow>
            <DetailRow label="부서">{detail.dept_id || "—"}</DetailRow>
            <DetailRow label="상태">{detail.status === "active" ? <Badge tone="green" dot>활성</Badge> : <Badge tone="neutral" dot>비활성</Badge>}</DetailRow>
            <DetailRow label="User ID"><code>{detail.user_id}</code></DetailRow>
            <DetailRow label="등록일">{new Date(detail.created_at).toLocaleString("ko-KR", { hour12: false })}</DetailRow>
            <p className="slide-note">역할: Admin(전체 관리) · Super(읽기+운영) · User(조회). 부서는 귀속/증적 필터에 사용.</p>
          </>
        )}
      </SlidePanel>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>사용자 추가</h3><button type="button" className="icon" aria-label="닫기" onClick={() => setModal(false)}>✕</button></div>
            <label className="pg-field"><span>이메일 *</span>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@maymust.com" /></label>
            <label className="pg-field"><span>이름 *</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="홍길동" /></label>
            <div className="pg-field-row">
              <label className="pg-field"><span>역할</span>
                <select className="range-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
                </select></label>
              <label className="pg-field"><span>부서</span>
                <input value={form.dept_id} onChange={(e) => setForm({ ...form, dept_id: e.target.value })} placeholder="예: 리서치본부" /></label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setModal(false)}>취소</button>
              <button type="button" className="btn-primary" onClick={submit} disabled={busy || !form.email.trim() || !form.name.trim()}>{busy ? "추가 중…" : "추가"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
