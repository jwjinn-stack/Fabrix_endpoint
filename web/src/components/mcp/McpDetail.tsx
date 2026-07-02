// IMP-86 — MCP 연동 상세 화면(Tools / Resources / Prompts 3-탭, Inspector 3분류).
//
// 렌더 단일 출처 = ONTOLOGY_TOOL_REGISTRY + K8S_TOOL_REGISTRY(inputSchema 보유). 동시에 라이브
// tools/list·resources/list 와 **diff** 를 표시해 3-way drift(TS 레지스트리 ↔ 아티팩트 ↔ Go embed)를
// 눈에 보이게 한다. 서버는 read-only — 조회 tool 의 정적 예시 req/res 를 먼저 보여준다(mutating Run 없음).
//
// Stripe식 2열: 좌열=설명+SchemaTable, 우열=예시 JSON-RPC 요청/응답 코드블록.

import { useMemo, useState } from "react";
import type { McpTool, McpResource } from "../../api/client";
import { isMockMode } from "../../api/modelConnection";
import { ONTOLOGY_TOOL_REGISTRY, K8S_TOOL_REGISTRY, type OntologyToolSpec } from "../../actions/ontologyTools";
import Badge from "../Badge";
import { Accordion, SchemaTable, CodeBlock, StatusDot, type DotState } from "./primitives";
import { exampleRequest, exampleResponse } from "./examples";

type Tab = "tools" | "resources" | "prompts";

// 레지스트리(단일 출처) tool + 어느 그룹인지. name 순으로 안정 정렬.
interface RegRow {
  spec: OntologyToolSpec;
  group: "온톨로지" | "Kubernetes";
}
function registryRows(): RegRow[] {
  const rows: RegRow[] = [
    ...Object.values(ONTOLOGY_TOOL_REGISTRY).map((spec) => ({ spec, group: "온톨로지" as const })),
    ...Object.values(K8S_TOOL_REGISTRY).map((spec) => ({ spec, group: "Kubernetes" as const })),
  ];
  return rows.sort((a, b) => (a.spec.name < b.spec.name ? -1 : a.spec.name > b.spec.name ? 1 : 0));
}

// diff 판정 — 레지스트리 vs 라이브 tools/list.
type DriftKind = "both" | "registry-only" | "live-only";
function driftDot(kind: DriftKind): DotState {
  if (kind === "both") return "ok";
  if (kind === "live-only") return "info";
  return "warn"; // registry-only = 라이브 미노출(경고)
}
function driftBadge(kind: DriftKind) {
  if (kind === "both") return <Badge tone="green" dot>연결됨</Badge>;
  if (kind === "live-only") return <Badge tone="blue" dot>라이브 전용</Badge>;
  return <Badge tone="amber" dot>라이브 미노출</Badge>;
}

// tool 카드 — 좌:설명+스키마 / 우:예시 req/res. 접이식.
function ToolCard({ spec, group, drift }: { spec: OntologyToolSpec; group: string; drift: DriftKind }) {
  return (
    <Accordion
      title={
        <span className="mcp-tool-title">
          <StatusDot state={driftDot(drift)} title={drift === "both" ? "라이브 연결됨" : drift === "live-only" ? "라이브 전용" : "라이브 미노출"} />
          <code className="mcp-tool-name">{spec.name}</code>
          <span className="mcp-tool-group">{group}</span>
        </span>
      }
      meta={driftBadge(drift)}
    >
      <div className="mcp-tool-grid">
        {/* 좌열 — 설명 + 입력 스키마 */}
        <div className="mcp-tool-left">
          <p className="mcp-tool-desc">{spec.description}</p>
          <div className="mcp-sub-h">입력 스키마</div>
          <SchemaTable schema={spec.inputSchema} />
          <p className="mcp-readonly-note">
            🔒 조회 전용 tool — 상태를 변경하지 않습니다. 아래는 정적 예시입니다.
          </p>
        </div>
        {/* 우열 — 예시 JSON-RPC 요청/응답 */}
        <div className="mcp-tool-right">
          <CodeBlock label="예시 요청 · POST /api/v1/mcp" code={exampleRequest(spec)} />
          <CodeBlock label="예시 응답" code={exampleResponse(spec)} />
        </div>
      </div>
    </Accordion>
  );
}

// 라이브 전용 tool(레지스트리에 스키마 없음 — aggregate 등) 카드.
function LiveOnlyCard({ tool }: { tool: McpTool }) {
  return (
    <Accordion
      title={
        <span className="mcp-tool-title">
          <StatusDot state="info" title="라이브 전용(스키마 미노출)" />
          <code className="mcp-tool-name">{tool.name}</code>
          <span className="mcp-tool-group">aggregate</span>
        </span>
      }
      meta={<Badge tone="blue" dot>라이브 전용</Badge>}
    >
      <div className="mcp-tool-left">
        <p className="mcp-tool-desc">{tool.description ?? "설명 없음"}</p>
        <p className="mcp-empty">
          이 tool 은 라이브 서버(tools/list)에만 있고 TS 레지스트리에는 스키마가 없습니다 —
          입력 스키마 상세는 노출되지 않습니다.
        </p>
      </div>
    </Accordion>
  );
}

export default function McpDetail({
  tools,
  resources,
}: {
  tools: McpTool[];
  resources: McpResource[];
}) {
  const [tab, setTab] = useState<Tab>("tools");
  const mock = isMockMode();
  const rows = useMemo(registryRows, []);
  const liveNames = useMemo(() => new Set(tools.map((t) => t.name)), [tools]);
  const regNames = useMemo(() => new Set(rows.map((r) => r.spec.name)), [rows]);

  // 라이브에만 있는 tool(레지스트리 밖) = live-only(aggregate 등).
  const liveOnly = useMemo(() => tools.filter((t) => !regNames.has(t.name)), [tools, regNames]);

  // diff 요약(캐노피) — 연결/라이브전용/라이브미노출 카운트.
  const bothCount = rows.filter((r) => liveNames.has(r.spec.name)).length;
  const regOnlyCount = rows.length - bothCount;

  const TABS: { id: Tab; label: string; count: number }[] = [
    { id: "tools", label: "Tools", count: rows.length + liveOnly.length },
    { id: "resources", label: "Resources", count: resources.length },
    { id: "prompts", label: "Prompts", count: 0 },
  ];

  return (
    <div className="mcp-detail">
      {/* 정직성(direction 8) — mock 모드에서는 "라이브" tools/list·resources/list 가 실제 MCP 서버가 아니라
          mock 라우터가 되돌려준 응답이다. green "연결됨"·"라이브 연결됨" 이 실 연결로 읽히지 않도록 명시. */}
      {mock && (
        <div className="mcp-mock-banner state" role="note">
          <Badge tone="amber" dot>MOCK</Badge>
          <span>
            현재 mock 모드입니다 — 아래 tools/list·resources/list 는 <b>실제 MCP 서버가 아니라 mock 라우터가 되돌려준 카탈로그</b>입니다.
            “연결됨/라이브”는 mock 응답과 TS 레지스트리의 정합을 뜻하며, 실 MCP 연결이 아닙니다(VITE_MOCK=off 로 실서버 연결).
          </span>
        </div>
      )}

      {/* 상단 탭 — Inspector 3분류 */}
      <div className="mcp-tabs" role="tablist" aria-label="MCP 카탈로그">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`mcp-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span className="mcp-tab-count">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === "tools" && (
        <div role="tabpanel" aria-label="Tools">
          {/* drift diff 캐노피 — 단일 출처 vs 라이브 정합을 눈에 보이게 */}
          <div className="mcp-drift-bar" role="status">
            <StatusDot state="ok" /> 연결됨 {bothCount}
            {regOnlyCount > 0 && (<>
              {" · "}<StatusDot state="warn" /> 라이브 미노출 {regOnlyCount}
            </>)}
            {liveOnly.length > 0 && (<>
              {" · "}<StatusDot state="info" /> 라이브 전용 {liveOnly.length}
            </>)}
            <span className="mcp-drift-note">— TS 레지스트리(단일 출처) ↔ {mock ? "mock" : "라이브"} tools/list drift</span>
          </div>

          <div className="mcp-cards">
            {rows.map((r) => (
              <ToolCard
                key={r.spec.name}
                spec={r.spec}
                group={r.group}
                drift={liveNames.has(r.spec.name) ? "both" : "registry-only"}
              />
            ))}
            {liveOnly.map((t) => (
              <LiveOnlyCard key={t.name} tool={t} />
            ))}
            {rows.length === 0 && liveOnly.length === 0 && (
              <p className="mcp-empty">노출된 tool 이 없습니다.</p>
            )}
          </div>
        </div>
      )}

      {tab === "resources" && (
        <div role="tabpanel" aria-label="Resources">
          {resources.length === 0 ? (
            <p className="mcp-empty">노출된 resource 가 없습니다.</p>
          ) : (
            <div className="mcp-cards">
              {resources.map((r) => (
                <div className="mcp-res-card" key={r.uri}>
                  <div className="mcp-res-head">
                    <StatusDot state="ok" title="라이브 연결됨" />
                    <span className="mcp-res-name">{r.name ?? r.uri}</span>
                    {r.mimeType && <Badge tone="neutral">{r.mimeType}</Badge>}
                  </div>
                  <code className="mcp-res-uri">{r.uri}</code>
                  {r.description && <p className="mcp-tool-desc">{r.description}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "prompts" && (
        <div role="tabpanel" aria-label="Prompts">
          {/* 정직한 상태 — 서버가 prompts/list 를 노출하지 않음(가짜 데이터 금지) */}
          <div className="mcp-coming-soon">
            <StatusDot state="off" title="미노출" />
            <div>
              <div className="mcp-cs-title">Prompts — 해당 없음 (coming soon)</div>
              <p className="mcp-tool-desc">
                이 FABRIX MCP 서버는 아직 <code>prompts/list</code> 를 노출하지 않습니다.
                재사용 가능한 프롬프트 템플릿이 추가되면 여기에 나타납니다.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
