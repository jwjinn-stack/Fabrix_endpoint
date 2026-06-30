import { useCallback, useEffect, useState } from "react";
import { fetchCredentials, setCredential } from "../api/client";
import type { ThirdPartyCred } from "../api/types";
import { useCap } from "../capabilities";
import { humanizeError } from "../utils/errors";

// 서드파티 자격증명 — HF Model Hub 토큰 · NVIDIA NGC 키 (모델 임포트 다운로드에 사용).
// Nutanix Enterprise AI "Settings · Third Party Credentials" 패턴. 값은 마스킹 저장(k8s Secret).
const KINDS = [
  {
    kind: "hf",
    title: "Hugging Face Model Hub 토큰",
    nameLabel: "토큰 이름",
    valueLabel: "액세스 토큰",
    ph: "hf_xxxxxxxxxxxxxxxxxxxx",
    help: "huggingface.co › Settings › Access Tokens 에서 read 권한 토큰을 발급하세요. 게이트(승인 필요) 모델·레이트리밋 회피에 필요합니다.",
  },
  {
    kind: "ngc",
    title: "NVIDIA NGC Personal Key",
    nameLabel: "키 이름",
    valueLabel: "키 값",
    ph: "nvapi-xxxxxxxx",
    help: "NGC › Setup › Generate Personal Key. NGC 카탈로그(NIM) 모델 임포트에 사용됩니다.",
  },
] as const;

export default function Credentials() {
  const canWrite = useCap().can("credentials"); // 자격증명 조회·설정(민감) 권한 — observe 에선 false
  const [creds, setCreds] = useState<ThirdPartyCred[]>([]);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [edit, setEdit] = useState<null | string>(null); // kind being edited
  const [form, setForm] = useState({ name: "", value: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const r = await fetchCredentials(signal);
      setCreds(r.credentials);
      setAvailable(r.available);
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

  // 에러·공지 자동 소거 — 사용자가 수정 후 재시도할 때 옛 메시지가 남아 혼란 주지 않게.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const credFor = (kind: string) => creds.find((c) => c.kind === kind);

  const openEdit = (kind: string) => {
    const c = credFor(kind);
    setForm({ name: c?.name ?? "", value: "" });
    setEdit(kind);
    setNotice(null);
  };

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      await setCredential({ kind: edit, name: form.name, value: form.value });
      setNotice(`${edit === "hf" ? "Hugging Face 토큰" : "NGC 키"}이(가) 저장되었습니다.`);
      setEdit(null);
      load();
    } catch (e) {
      setError(humanizeError((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>서드파티 자격증명</h1>
        <span className="crumb">설정 / 서드파티 자격증명</span>
        <div className="spacer" />
      </div>

      {error && <div className="state error" role="alert">{error}</div>}
      {notice && <div className="state" role="status">{notice}</div>}
      {!canWrite && !loading && (
        <div className="state" role="status">읽기 전용 프로파일입니다. 서드파티 자격증명 조회·설정은 관리(manage) 권한에서만 가능합니다.</div>
      )}
      {!available && !loading && (
        <div className="state" role="status">kubectl 미구성으로 자격증명 저장이 비활성입니다. (백엔드 FABRIX_KUBECTL/권한 확인)</div>
      )}
      {!error && loading && <div className="state" role="status">자격증명을 불러오는 중…</div>}

      <div className="cred-list">
        {KINDS.map((k) => {
          const c = credFor(k.kind);
          const editing = edit === k.kind;
          return (
            <div className="card cred-card" key={k.kind}>
              <div className="cred-head">
                <h3>{k.title}</h3>
                {!editing && canWrite && (
                  <button type="button" className="btn-ghost btn-sm" onClick={() => openEdit(k.kind)} disabled={!available}>
                    ✎ {c?.set ? "수정" : "등록"}
                  </button>
                )}
              </div>

              {!editing ? (
                <div className="cred-rows">
                  <div className="cred-row">
                    <span className="cred-label">{k.nameLabel}</span>
                    <span className="cred-value">{c?.name || <span className="muted">미설정</span>}</span>
                  </div>
                  <div className="cred-row">
                    <span className="cred-label">{k.valueLabel}</span>
                    <span className="cred-value mono">{c?.set ? c.masked : <span className="muted">미설정</span>}</span>
                  </div>
                </div>
              ) : (
                <div className="cred-edit">
                  <label className="pg-field">
                    <span>{k.nameLabel}</span>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: donggyu" />
                  </label>
                  <label className="pg-field">
                    <span>{k.valueLabel}{c?.set ? " (비워두면 기존 값 유지)" : ""}</span>
                    <input type="password" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={k.ph} autoComplete="off" />
                    {c?.set && <span className="cred-help" style={{ marginTop: 4 }}>비워두면 기존 값이 유지됩니다. 새 값을 입력하면 교체됩니다.</span>}
                  </label>
                  <div className="modal-actions">
                    <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>취소</button>
                    <button type="button" className="btn-primary" onClick={save} disabled={busy || (!form.name.trim() && !form.value.trim())}>
                      {busy ? "저장 중…" : "저장"}
                    </button>
                  </div>
                </div>
              )}
              <p className="cred-help">{k.help}</p>
            </div>
          );
        })}
      </div>

      <p className="slide-note" style={{ marginTop: 16 }}>
        값은 클러스터 Secret(fabrix-endpoint/fabrix-thirdparty)에 저장되며 화면에는 마스킹되어 표시됩니다. 모델 임포트 잡이 이 토큰을 사용해 Hugging Face 에서 다운로드합니다.
      </p>
    </>
  );
}
