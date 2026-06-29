import { useCallback, useEffect, useState } from "react";
import { fetchCredentials, harborImport } from "../api/client";
import type { ImportResult, ThirdPartyCred } from "../api/types";
import type { Page } from "../components/Layout";
import { useCap } from "../capabilities";

// 모델 임포트 — NGC/HuggingFace/업로드 소스에서 모델을 Harbor 레지스트리로 가져온다.
// Nutanix Enterprise AI "Import Model" 패턴. HF 다운로드는 [설정 > 서드파티 자격증명]의 토큰을 사용.
const SOURCES = [
  { value: "ngc", title: "NVIDIA NGC Catalog", icon: "▲", desc: "NVIDIA 검증 모델(NIM)을 NGC 카탈로그에서 직접 가져옵니다.", ph: "예: nvcr.io/nim/meta/llama-3.1-8b", cred: "ngc" },
  { value: "hf", title: "Hugging Face Model Hub", icon: "🤗", desc: "HuggingFace 모델을 다운로드→패키징→Harbor 로 push 합니다.", ph: "예: Qwen/Qwen2.5-0.5B-Instruct", cred: "hf" },
  { value: "upload", title: "직접 업로드", icon: "↥", desc: "호환 포맷 모델을 파일/버킷에서 직접 업로드(개발: CLI push).", ph: "예: ./qwen2.5-0.5b", cred: "" },
] as const;

export default function ModelImport({ onNavigate }: { onNavigate: (p: Page, model?: string) => void }) {
  const canImport = useCap().can("models.write"); // 모델 임포트 권한 — observe 에선 false(읽기 전용)
  const [creds, setCreds] = useState<ThirdPartyCred[]>([]);
  const [imp, setImp] = useState<null | string>(null);
  const [impForm, setImpForm] = useState({ model_id: "", project: "models" });
  const [impRes, setImpRes] = useState<ImportResult | null>(null);
  const [impBusy, setImpBusy] = useState(false);
  const [impMsg, setImpMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const loadCreds = useCallback(async (signal?: AbortSignal) => {
    try { const r = await fetchCredentials(signal); setCreds(r.credentials); } catch { /* 자격증명 조회 실패는 무시(임포트 자체는 가능) */ }
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    loadCreds(ctrl.signal);
    return () => ctrl.abort();
  }, [loadCreds]);

  const src = SOURCES.find((s) => s.value === imp);
  const credSet = (kind: string) => creds.find((c) => c.kind === kind)?.set ?? false;

  const openImport = (v: string) => { setImp(v); setImpForm({ model_id: "", project: "models" }); setImpRes(null); setImpMsg(null); setDone(false); };

  const doPreview = async () => {
    if (!impForm.model_id.trim() || !imp) return;
    setImpBusy(true); setImpMsg(null);
    try { setImpRes(await harborImport({ source: imp, model_id: impForm.model_id, project: impForm.project, apply: false })); }
    catch (e) { setImpMsg((e as Error).message); } finally { setImpBusy(false); }
  };
  const doApply = async () => {
    if (!impForm.model_id.trim() || !imp) return;
    setImpBusy(true); setImpMsg(null);
    try {
      const r = await harborImport({ source: imp, model_id: impForm.model_id, project: impForm.project, apply: true });
      setImpRes(r); setImpMsg(`임포트 잡 생성됨: ${r.job_name}`); setDone(true);
    } catch (e) { setImpMsg((e as Error).message); } finally { setImpBusy(false); }
  };

  return (
    <>
      <div className="page-head">
        <h1>모델 임포트</h1>
        <span className="crumb">모델 / 모델 임포트</span>
        <div className="spacer" />
        <button type="button" className="btn-ghost" onClick={() => onNavigate("models")}>← 모델 목록</button>
      </div>

      {!canImport && (
        <div className="state" role="status">읽기 전용 프로파일입니다. 모델 임포트는 관리(manage) 권한에서만 실행할 수 있습니다.</div>
      )}

      <div className="import-intro">
        <p>NVIDIA NGC · Hugging Face 에서 검증된 모델을 가져오거나, 파일/버킷에서 직접 업로드합니다. 가져온 모델은 <b>Harbor 레지스트리</b>에 저장되어 Dynamo 가 서빙합니다.</p>
        <div className="cred-chips">
          <span className={`chip ${credSet("hf") ? "ok" : "warn"}`}>HF 토큰 {credSet("hf") ? "설정됨" : "미설정"}</span>
          <span className={`chip ${credSet("ngc") ? "ok" : "warn"}`}>NGC 키 {credSet("ngc") ? "설정됨" : "미설정"}</span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => onNavigate("credentials")}>자격증명 관리 →</button>
        </div>
      </div>

      <div className="import-cards">
        {SOURCES.map((s) => (
          <div className="card import-card" key={s.value}>
            <div className="import-card-icon" aria-hidden="true">{s.icon}</div>
            <h3>{s.title}</h3>
            <p>{s.desc}</p>
            {s.cred && !credSet(s.cred) && <span className="chip warn" style={{ alignSelf: "flex-start" }}>토큰 필요</span>}
            {canImport && (
              <button type="button" className="btn-primary" onClick={() => openImport(s.value)}>가져오기</button>
            )}
          </div>
        ))}
      </div>

      {imp && src && (
        <div className="modal-overlay" onClick={() => setImp(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>모델 임포트 — {src.title}</h3><button type="button" className="icon" aria-label="닫기" onClick={() => setImp(null)}>✕</button></div>

            {impBusy && <div className="import-progress" role="status" aria-label="처리 중"><span /></div>}

            {src.cred && !credSet(src.cred) && (
              <div className="state" role="status">
                {src.cred === "hf" ? "Hugging Face" : "NGC"} 토큰이 미설정입니다. 게이트/비공개 모델은 실패할 수 있습니다.{" "}
                <button type="button" className="link-btn" onClick={() => { setImp(null); onNavigate("credentials"); }}>자격증명 설정 →</button>
              </div>
            )}

            <div className="pg-field-row">
              <label className="pg-field"><span>모델 ID / 경로 *</span>
                <input value={impForm.model_id} onChange={(e) => setImpForm({ ...impForm, model_id: e.target.value })} placeholder={src.ph} autoFocus /></label>
              <label className="pg-field"><span>Harbor 프로젝트</span>
                <input value={impForm.project} onChange={(e) => setImpForm({ ...impForm, project: e.target.value })} placeholder="models" /></label>
            </div>

            {impMsg && <div className="state" role={done ? "status" : "alert"}>{impMsg}</div>}
            {impRes && (
              <div className="ep-preview">
                <div className="code-lang">임포트 잡 매니페스트 (k8s Job)</div>
                <pre className="manifest">{impRes.manifest}</pre>
                <div className="code-lang">또는 dev 직접 push (CLI)</div>
                <pre className="manifest">{impRes.cli_hint}</pre>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setImp(null)}>닫기</button>
              {done ? (
                <button type="button" className="btn-primary" onClick={() => onNavigate("models")}>모델 목록에서 확인 →</button>
              ) : (
                <>
                  <button type="button" className="btn-ghost" onClick={doPreview} disabled={impBusy || !impForm.model_id.trim()}>미리보기</button>
                  {canImport && (
                    <button type="button" className="btn-primary" onClick={doApply} disabled={impBusy || !impForm.model_id.trim() || src.value === "upload"}>
                      {impBusy ? "처리 중…" : "임포트 잡 실행"}
                    </button>
                  )}
                </>
              )}
            </div>
            <div className="modal-note">
              {src.value === "upload"
                ? "직접 업로드는 개발 환경에서 CLI(huggingface-cli + oras)로 Harbor 에 push 합니다. 미리보기로 명령을 확인하세요."
                : "임포트 잡은 모델을 다운로드→패키징→Harbor push 합니다. 다운로드는 설정된 토큰을 사용합니다. 완료 후 [모델 목록]에 표시됩니다."}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
