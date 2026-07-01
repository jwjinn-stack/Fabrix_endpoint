// IMP-73 — 계약 drift canary(TS 측).
// emitOntologyToolSchemas() 출력이 committed 아티팩트(ontology-tools.schema.json)와 byte 동일한지
// 검증한다. 어긋나면 실패 = "레지스트리를 바꿨는데 아티팩트 재생성을 안 함" 을 CI 가 잡는다.
// (Go 측 mcp_contract_test.go 는 이 아티팩트 == Go 가 embed 한 파일임을 검증 — 3자 단일화 완성.)
//
// 커밋 파일은 Vite `?raw` 로 문자열(byte) 그대로 로드한다(node:fs 미사용 = @types/node 불필요).
import { describe, it, expect } from "vitest";
import committed from "./ontology-tools.schema.json?raw";
import { emitOntologyToolSchemas } from "./ontologyTools";

describe("ontology-tools.schema.json — contract drift canary", () => {
  it("emit == committed 아티팩트(byte 동일)", () => {
    const emitted = emitOntologyToolSchemas();
    expect(emitted).toBe(committed);
  });

  it("결정성 — emit 두 번 호출은 동일(key 정렬 안정)", () => {
    expect(emitOntologyToolSchemas()).toBe(emitOntologyToolSchemas());
  });
});
