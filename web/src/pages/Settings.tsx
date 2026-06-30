import { useCallback, useEffect, useState } from "react";
import { createUser, deleteUser, fetchUsers, updateUser } from "../api/client";
import type { User } from "../api/types";
import SlidePanel, { DetailRow } from "../components/SlidePanel";
import Badge, { type BadgeTone } from "../components/Badge";
import ConfirmDialog from "../components/ConfirmDialog";
import Modal from "../components/Modal";
import { SkeletonRows } from "../components/Skeleton";
import ReconfigurePanel from "../components/ReconfigurePanel";
import { useCap } from "../capabilities";
import { BRAND_PRESETS, deriveBrand, useBrand } from "../theme";
import InfoTip from "../components/InfoTip";
import { humanizeError } from "../utils/errors";
import { useToast } from "../toast";
import { useFieldValidation, required } from "../utils/useFieldValidation";
import FieldError from "../components/FieldError";

// 외관 · 브랜드 색상 — 고객사 표준 색상에 맞춰 전체 강조색(--primary 계열)을 전환.
function BrandColorCard() {
  const { brand, setBrand } = useBrand();
  return (
    <div className="card">
      <div className="card-head">
        <h3>외관 · 브랜드 색상</h3>
        <InfoTip>강조색(버튼·링크·차트·선택 상태)을 고객사 표준 색상으로 전환합니다. 이 브라우저에 저장됩니다.</InfoTip>
      </div>
      <p className="policy-hint" style={{ marginTop: 0 }}>
        고객사 표준 색상에 맞춰 전체 UI 강조색이 즉시 바뀝니다. 라이트·다크 모드 공통으로 적용되며 이 브라우저에 저장됩니다.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-3)", alignItems: "stretch" }}>
        {BRAND_PRESETS.map((p) => {
          const active = brand.id === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setBrand(p)}
              aria-pressed={active}
              title={p.name}
              style={{
                display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                border: `1px solid ${active ? "var(--primary)" : "var(--border-strong)"}`,
                boxShadow: active ? "0 0 0 2px var(--primary-weak)" : "none",
                borderRadius: 8, padding: "7px 12px", background: "var(--surface)", font: "inherit", fontSize: "var(--fs-sm)",
              }}
            >
              <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: "50%", background: p.primary, border: "1px solid rgba(0,0,0,0.1)", flex: "none" }} />
              <span style={{ color: "var(--text)" }}>{p.name}</span>
              {active && <span aria-hidden="true" style={{ color: "var(--primary)", fontWeight: 700 }}>✓</span>}
            </button>
          );
        })}
        {/* 커스텀 HEX — 임의 색에서 strong/weak/lite 자동 파생 */}
        <label
          title="임의 색상 지정"
          style={{
            display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
            border: `1px solid ${brand.id === "custom" ? "var(--primary)" : "var(--border-strong)"}`,
            boxShadow: brand.id === "custom" ? "0 0 0 2px var(--primary-weak)" : "none",
            borderRadius: 8, padding: "7px 12px", background: "var(--surface)", fontSize: "var(--fs-sm)",
          }}
        >
          <input
            type="color"
            value={brand.primary}
            onChange={(e) => setBrand(deriveBrand(e.target.value))}
            aria-label="커스텀 브랜드 색상"
            style={{ width: 22, height: 22, padding: 0, border: "none", background: "none", cursor: "pointer" }}
          />
          <span style={{ color: "var(--text)" }}>커스텀</span>
          {brand.id === "custom" && <code style={{ fontSize: "var(--fs-xs)" }}>{brand.primary}</code>}
        </label>
      </div>
      <div className="policy-hint">미리보기 — 현재 강조색: <button type="button" className="btn-primary btn-sm" style={{ marginLeft: 6 }}>버튼</button> <a href="#" onClick={(e) => e.preventDefault()} style={{ marginLeft: 8 }}>링크 예시</a></div>
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { admin: "관리자(Admin)", user: "일반(User)", super: "슈퍼(Super)" };
const ROLE_TONE: Record<string, BadgeTone> = { admin: "red", super: "pink", user: "green" };
// 권한 등급(높을수록 강함) — 상향 시 확인 다이얼로그를 띄우는 기준.
const ROLE_RANK: Record<string, number> = { user: 0, super: 1, admin: 2 };
const isEscalation = (from: string, to: string) => (ROLE_RANK[to] ?? 0) > (ROLE_RANK[from] ?? 0);

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
  const canWrite = useCap().can("users.write"); // 사용자 추가·역할 변경·삭제 권한
  const canConfig = useCap().can("credentials"); // 연동 설정 재구성(민감) — manage 전용
  const toast = useToast(); // 전역 토스트(IMP-29) — 성공/오류 일원화
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<string[]>(["admin", "user", "super"]);
  const [error, setError] = useState<string | null>(null); // 초기 로드 실패만 인라인 표시
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "user", dept_id: "" });
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<User | null>(null);
  const [confirmRole, setConfirmRole] = useState<{ user: User; role: string } | null>(null); // 권한 상향 확인
  const [confirmDel, setConfirmDel] = useState<User | null>(null); // 사용자 삭제 확인

  // IMP-22 — 사용자 추가 폼 인라인 검증(이메일·이름 필수, 이메일 형식). 짧은 폼 → 첫 오류필드 포커스.
  const fv = useFieldValidation(form, {
    email: (v) => {
      const s = String(v).trim();
      if (!s) return "이메일을 입력하세요.";
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? undefined : "올바른 이메일 형식이 아닙니다.";
    },
    name: required("이름을 입력하세요."),
  });

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetchUsers(signal);
      setUsers(r.users);
      setRoles(r.roles);
      setError(null);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(humanizeError((e as Error).message));
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

  // 역할 변경 — 권한 상향(user→super/admin 등)이면 확인 다이얼로그, 아니면 즉시 적용.
  const changeRole = (u: User, role: string) => {
    if (role === u.role) return;
    if (isEscalation(u.role, role)) { setConfirmRole({ user: u, role }); return; }
    void applyRole(u, role);
  };

  const applyRole = async (u: User, role: string) => {
    setBusy(true);
    try {
      await updateUser(u.user_id, { role, dept_id: u.dept_id, status: u.status });
      setConfirmRole(null);
      toast.success(`${u.name}님의 역할을 ${ROLE_LABEL[role] ?? role}(으)로 변경했습니다.`);
      load();
    } catch (e) { toast.error(humanizeError((e as Error).message)); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirmDel) return;
    setBusy(true);
    try {
      await deleteUser(confirmDel.user_id);
      toast.success(`${confirmDel.name}님을 삭제했습니다.`);
      setConfirmDel(null);
      load();
    } catch (e) { toast.error(humanizeError((e as Error).message)); } finally { setBusy(false); }
  };

  const submit = () => fv.handleSubmit(doSubmit);

  const doSubmit = async () => {
    setBusy(true);
    try {
      await createUser(form);
      setModal(false);
      fv.reset();
      toast.success(`${form.name}님을 추가했습니다.`);
      setForm({ email: "", name: "", role: "user", dept_id: "" });
      load();
    } catch (e) { toast.error(humanizeError((e as Error).message)); } finally { setBusy(false); }
  };

  const openAddUser = () => { fv.reset(); setForm({ email: "", name: "", role: "user", dept_id: "" }); setModal(true); };

  return (
    <>
      <div className="page-head">
        <h1>설정 · 관리</h1>
        <span className="crumb">설정 / RBAC · Users</span>
        <div className="spacer" />
        <span className="updated">{users.length}명</span>
        {canWrite && <button type="button" className="btn-primary" onClick={openAddUser}>+ 사용자 추가</button>}
      </div>

      {error && <div className="state error" role="alert">{error}</div>}
      {canConfig && <ReconfigurePanel />}

      <div className="card">
        <div className="card-head">
          <h3>사용자 · 역할</h3>
          <InfoTip>역할(Admin/User/Super)과 부서 매핑. 역할은 인라인으로 변경됩니다.</InfoTip>
        </div>
        {loading && users.length === 0 ? (
          <div className="table-scroll"><SkeletonRows rows={6} cols={6} /></div>
        ) : users.length === 0 ? (
          <div className="empty">사용자가 없습니다. “+ 사용자 추가”로 등록하세요.</div>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="데이터 표 — 좌우 스크롤 가능">
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
                    {canWrite ? (
                      <select className="range-select" value={u.role} onChange={(e) => changeRole(u, e.target.value)}>
                        {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
                      </select>
                    ) : (
                      roleTag(u.role)
                    )}
                  </td>
                  <td>{u.dept_id || <span className="muted">—</span>}</td>
                  <td>{u.status === "active" ? <Badge tone="green" dot>활성</Badge> : <Badge tone="neutral" dot>비활성</Badge>}</td>
                  <td className="num">
                    {canWrite && <button type="button" className="btn-danger-ghost" onClick={(e) => { e.stopPropagation(); setConfirmDel(u); }}>삭제</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>역할 × 권한 참조</h3>
          <InfoTip>역할별 허용 권한(읽기 전용 참조). 실제 강제는 API 레벨 RBAC.</InfoTip>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="데이터 표 — 좌우 스크롤 가능">
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
        </div>
        <div className="policy-hint">모든 권한 토글·역할 변경은 감사 이벤트로 캡처됩니다. 상향 권한 부여 차단(자신보다 높은 역할 부여 불가)은 현재 사용자 컨텍스트 연동 후 활성화됩니다.</div>
      </div>

      <BrandColorCard />

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
        <Modal open onClose={() => setModal(false)} title="사용자 추가">
            <label className="pg-field"><span>이메일 *</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@maymust.com" {...fv.fieldProps("email")} />
              <FieldError id={fv.errorId("email")} message={fv.showError("email")} /></label>
            <label className="pg-field"><span>이름 *</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="홍길동" {...fv.fieldProps("name")} />
              <FieldError id={fv.errorId("name")} message={fv.showError("name")} /></label>
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
              <button type="button" className="btn-primary" onClick={submit} disabled={busy}>{busy ? "추가 중…" : "추가"}</button>
            </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!confirmRole}
        title="권한 상향 확인"
        danger
        busy={busy}
        confirmLabel="권한 부여"
        message={
          <>
            <b>{confirmRole?.user.name}</b>님에게 <b>{confirmRole ? (ROLE_LABEL[confirmRole.role] ?? confirmRole.role) : ""}</b> 권한을 부여합니다. 더 넓은 운영·관리 권한이 적용됩니다. 계속할까요?
          </>
        }
        onConfirm={() => confirmRole && applyRole(confirmRole.user, confirmRole.role)}
        onCancel={() => setConfirmRole(null)}
      />

      <ConfirmDialog
        open={!!confirmDel}
        title="사용자 삭제"
        danger
        busy={busy}
        confirmLabel="삭제"
        message={<><b>{confirmDel?.name}</b>({confirmDel?.email}) 사용자를 삭제합니다. <b>되돌릴 수 없습니다</b>.</>}
        onConfirm={remove}
        onCancel={() => setConfirmDel(null)}
      />
    </>
  );
}
