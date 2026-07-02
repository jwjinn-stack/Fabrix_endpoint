// IMP-86 — MCP 상세 화면 프리미티브(자체 완결, 외부 CDN/하이라이터 의존 없음).
//
// StatusDot / Accordion / SchemaTable / CodeBlock — MCP Inspector·Stripe API 콘솔급 상세를
// Backend.AI 라이트 + 스틸블루 토큰으로 구현한다(네온 금지, 엔터프라이즈 모노). reduce-motion 안전.
//
// **보안**: CodeBlock 은 입력 문자열을 순수 토크나이즈해 <span> 텍스트로만 렌더한다 —
// eval / new Function / dangerouslySetInnerHTML 을 쓰지 않는다(코드블록은 실행 불가·표시 전용).

import { useId, useState, type ReactNode } from "react";
import type { JsonSchema } from "../../actions/ontologyTools";

// ── StatusDot — 연결 상태 점(스틸블루/녹색/주의; 네온 금지) ────────────────────
export type DotState = "ok" | "warn" | "off" | "info";
export function StatusDot({ state, title }: { state: DotState; title?: string }) {
  return <span className={`mcp-dot mcp-dot-${state}`} title={title} aria-label={title} role="img" />;
}

// ── Accordion — 접이식 카드(header 항상 보임, body 는 열림 시). reduce-motion 안전 ──
export function Accordion({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode; // 우측 배지/상태
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className={`mcp-acc ${open ? "open" : ""}`}>
      <button
        type="button"
        className="mcp-acc-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mcp-acc-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="mcp-acc-title">{title}</span>
        {meta && <span className="mcp-acc-meta">{meta}</span>}
      </button>
      {open && (
        <div id={bodyId} className="mcp-acc-body">
          {children}
        </div>
      )}
    </div>
  );
}

// ── SchemaTable — inputSchema properties → name·type·enum·description 표 ─────────
export function SchemaTable({ schema }: { schema?: JsonSchema }) {
  const props = schema?.properties ? Object.entries(schema.properties) : [];
  const required = new Set(schema?.required ?? []);
  if (props.length === 0) {
    return <p className="mcp-empty">입력 파라미터 없음 (인자 없이 호출).</p>;
  }
  return (
    <div className="mcp-schema-table" role="table" aria-label="입력 스키마">
      <div className="mcp-st-row mcp-st-head" role="row">
        <span role="columnheader">파라미터</span>
        <span role="columnheader">타입</span>
        <span role="columnheader">설명</span>
      </div>
      {props.map(([name, p]) => (
        <div className="mcp-st-row" role="row" key={name}>
          <span role="cell" className="mcp-st-name">
            <code>{name}</code>
            {required.has(name) ? (
              <span className="mcp-req" title="필수">필수</span>
            ) : (
              <span className="mcp-opt" title="선택">선택</span>
            )}
          </span>
          <span role="cell" className="mcp-st-type">
            <code>{p.type}</code>
            {p.enum && p.enum.length > 0 && (
              <span className="mcp-enum" title="허용값(밖은 스키마가 거부)">
                {p.enum.map((e) => (
                  <code key={e} className="mcp-enum-val">{e}</code>
                ))}
              </span>
            )}
          </span>
          <span role="cell" className="mcp-st-desc">{p.description}</span>
        </div>
      ))}
    </div>
  );
}

// ── CodeBlock — 경량 JSON 토크나이저(자체). 텍스트만 렌더(실행 없음) ──────────────
// JSON 문자열을 토큰(문자열/숫자/키워드/구두점/공백)으로 쪼개 각기 <span class> 로 감싼다.
// key(colon 앞 문자열)와 value 문자열을 구분해 Stripe식 하이라이트. 파싱 실패해도 원문을 그대로 출력한다.
type Tok = { t: "key" | "str" | "num" | "kw" | "punc" | "ws"; v: string };

// 정규식 기반 토크나이즈. 안전 — 실행 없이 분류만.
function tokenizeJson(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)|([{}[\],:])|(\s+)|([^\s{}[\],:"]+)/g;
  let m: RegExpExecArray | null;
  const pending: Tok[] = [];
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== undefined) pending.push({ t: "str", v: m[1] });
    else if (m[2] !== undefined) pending.push({ t: "num", v: m[2] });
    else if (m[3] !== undefined) pending.push({ t: "kw", v: m[3] });
    else if (m[4] !== undefined) pending.push({ t: "punc", v: m[4] });
    else if (m[5] !== undefined) pending.push({ t: "ws", v: m[5] });
    else if (m[6] !== undefined) pending.push({ t: "kw", v: m[6] }); // 알 수 없는 토큰(방어) — 키워드 톤
  }
  // 2차 패스 — 문자열 뒤(공백 건너뛰고)가 ':' 면 key 로 승격.
  for (let i = 0; i < pending.length; i++) {
    const tok = pending[i];
    if (tok.t === "str") {
      let j = i + 1;
      while (j < pending.length && pending[j].t === "ws") j++;
      if (j < pending.length && pending[j].t === "punc" && pending[j].v === ":") {
        out.push({ t: "key", v: tok.v });
        continue;
      }
    }
    out.push(tok);
  }
  return out;
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const toks = tokenizeJson(code);
  return (
    <div className="mcp-code">
      {label && <div className="mcp-code-label">{label}</div>}
      {/* 가로 스크롤 코드 영역 — 키보드로 스크롤 가능하게 tabIndex(스크롤 접근성). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <pre className="mcp-code-pre" tabIndex={0} role="group" aria-label={label ?? "코드"}>
        <code>
          {toks.map((tk, i) => (
            <span key={i} className={`hj-${tk.t}`}>{tk.v}</span>
          ))}
        </code>
      </pre>
    </div>
  );
}
