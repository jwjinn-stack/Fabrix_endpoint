# Langfuse MCP 서버 — 할 수 있는 것 (FABRIX 연동 레퍼런스)

> 목적: 나중에 MCP 를 붙일 때 쓰는 능력 카탈로그. **MCP = AI 에이전트(Claude Code/Cursor/Codex)가 Langfuse 데이터를 질의·관리**하는 통로. **가드레일이 아니고 런타임 경로도 아니다** — 개발·운영 디버깅 편의 도구.
> 권위 출처: [mcp.reference.langfuse.com](https://mcp.reference.langfuse.com/) · [MCP Server 문서](https://langfuse.com/docs/api-and-data-platform/features/mcp-server) · [빌드 블로그](https://langfuse.com/blog/2025-12-09-building-langfuse-mcp-server)

## 두 종류의 MCP 서버
| | ① 네이티브 내장(권장) | ② prompt 전용(레거시) |
|---|---|---|
| 위치 | Langfuse 서버 내장 `{host}/api/public/mcp` | npm `langfuse/mcp-server-langfuse`(로컬 Node 실행) |
| 전송 | **streamable HTTP**(GET=SSE 스트림, POST=JSON-RPC) | **stdio** |
| 도구 | 6개 도메인 다수(아래) | 단 2개: `get-prompts`, `get-prompt` |
| 설치 | 없음(서버 내장, 빌드 불필요) | `npm i` + 빌드 + 로컬 실행 |
| 인증 | Basic `base64(pk-lf:sk-lf)` 헤더 | env `LANGFUSE_PUBLIC_KEY/SECRET_KEY/BASEURL` |
| 용도 | 트레이스 디버깅 + 프롬프트/데이터셋/점수 관리 | 프롬프트 가져오기만 |

→ **거의 항상 ① 네이티브**를 쓴다(설치 0, 도구 풍부).

## 네이티브 서버 연결
| 항목 | 값 |
|---|---|
| 엔드포인트 | `{host}/api/public/mcp` (셀프호스트면 우리 host) |
| 리전(클라우드) | EU `cloud.langfuse.com`, US `us.cloud.langfuse.com`, JP `jp.cloud.langfuse.com`, HIPAA |
| 전송 | streamable HTTP |
| 인증 | `Authorization: Basic {base64(pk-lf-... : sk-lf-...)}` |
| 키 범위 | **프로젝트 범위 키만**(org 키는 거부) |
| 상태 | stateless(요청마다 새 인스턴스), write 도구는 **audit log** 기록 |

## 도구 전체 목록 (네이티브, 코드 기준 확인)
> 도구는 계속 추가되는 중 — **최신 전체 목록·입력스키마·요청예시는 [mcp.reference.langfuse.com](https://mcp.reference.langfuse.com/)** 이 단일 출처. 아래는 현재 확인된 세트.

### 프롬프트 · 데이터셋 (읽기/쓰기)
- `listPrompts` — 프로젝트 프롬프트 목록·필터·페이징
- `getPrompt` — 이름+버전/라벨로 프롬프트 조회
- `listDatasets` — 데이터셋(입출력 예제 모음) 목록
- `upsertDataset` — 데이터셋 생성/수정 ✍️
- `upsertDatasetItem` — 데이터셋 항목 추가/수정 ✍️
- `listDatasetRuns` / `listDatasetRunItems` — 평가 실행·항목 조회

### 관측 · 메트릭 (읽기 전용)
- `listObservations` — generation/span/event 질의(고급 필터)
- `getObservation` — 단일 관측(payload·메타 포함)
- `queryMetrics` — 사용량·비용·품질 메트릭(메트릭 엔진)
- `getMedia` — 미디어 자산 signed URL

### 스코어링 · 평가 (읽기/쓰기)
- `createScore` — trace/observation 점수 생성 ✍️
- `listScores` — 점수 조회·필터
- `createScoreConfig` — 점수 스키마(범주/수치) 정의 ✍️
- `listEvaluators` — 구성된 평가자(LLM-as-judge 등) 조회
- `listEvaluationRules` — 자동 평가 트리거 규칙 조회

> "read+write 도구가 기본 활성"이라 **쓰기 가능**(upsertDataset/createScore 등). 키 권한·범위에 주의.

## 설정 예
### Claude Code (`.mcp.json` 또는 `claude mcp add`)
```json
{
  "mcpServers": {
    "langfuse": {
      "type": "http",
      "url": "https://<our-langfuse-host>/api/public/mcp",
      "headers": { "Authorization": "Basic <base64(pk-lf-... : sk-lf-...)>" }
    }
  }
}
```
### Cursor (`~/.cursor/mcp.json` 동일 형태). ② prompt 전용은 stdio:
```json
{ "mcpServers": { "langfuse-prompts": {
  "command": "node", "args": ["<path>/build/index.js"],
  "env": { "LANGFUSE_PUBLIC_KEY":"pk-lf-...", "LANGFUSE_SECRET_KEY":"sk-lf-...", "LANGFUSE_BASEURL":"https://<host>" }
}}}
```

## FABRIX 활용 시나리오 (개발·운영 디버깅)
- **프로덕션 트레이스 디버깅**: IDE 에이전트가 `listObservations`/`getObservation` 으로 고지연 generation·예외·차단 케이스를 코드 옆에서 조사("이 세션에서 뭐가 느렸나").
- **가드레일 점수 확인/기록**: `listScores`/`createScore` 로 SR 판정·toxicity 점수 점검.
- **프롬프트 운영**: `listPrompts`/`getPrompt`(+prompt-only 서버)로 시스템/가드 프롬프트 버전 확인.
- **평가 규칙 점검**: `listEvaluators`/`listEvaluationRules` 로 LLM-as-judge 구성 확인.

> 이건 **개발/운영자 편의**다. 추론 런타임이나 사용자 화면 경로가 아니며, 가드레일 차단과 무관. 헤드리스/크론 환경에선 인터랙티브 인증이 없는 프로젝트 키 헤더 방식이라 동작은 하지만, write 도구 노출 여부를 키 권한으로 통제할 것.

## 보안 체크리스트
- [ ] **프로젝트 범위 키**만 사용(org 키 거부됨). dev/운영 프로젝트 분리.
- [ ] write 도구(upsert/createScore)가 기본 활성 → 읽기만 필요하면 별도 읽기 권한 키 발급 검토.
- [ ] secret 키는 IDE 설정에 평문 저장됨 → 개인 머신·시크릿 매니저 관리.
- [ ] 셀프호스트면 우리 host 의 `/api/public/mcp` 사용(클라우드로 데이터 전송 금지 — 데이터 레지던시).

## 출처
- [MCP Server 문서](https://langfuse.com/docs/api-and-data-platform/features/mcp-server) · [MCP 레퍼런스](https://mcp.reference.langfuse.com/)
- [네이티브 MCP 도구(DeepWiki)](https://deepwiki.com/langfuse/langfuse/5.4-mcp-server) · [빌드 블로그](https://langfuse.com/blog/2025-12-09-building-langfuse-mcp-server)
- [prompt 전용 서버(GitHub)](https://github.com/langfuse/mcp-server-langfuse) · [프롬프트 MCP 문서](https://langfuse.com/docs/prompt-management/features/mcp-server)
