// IMP-64 — Object Type 시각 언어의 단일 출처(글리프·라벨·색·틴트·className).
// docs/palantir-ontology-analysis.md §5.1(Object Types) 을 Palantir Workshop / Linear 수준의
// noun-type 위계(타입별 아이콘+색)로 인코딩한다. 스틸블루 계열·라이트·엔터프라이즈 — 네온 금지.
//
// 그동안 ObjectView.tsx / Ontology.tsx / Investigate.tsx 가 각자 TYPE_META(글리프+라벨)를 중복 정의하고
// 글리프 색이 전부 무채색(--text-dim)이었다. 여기로 통일하고, 색(color/tint)을 추가해 타입을 시각적으로 구분한다.
//   - glyph: 기존 3곳과 동일 유니코드(회귀 최소; 위계는 "색"으로 준다).
//   - color: 전경(글리프/테두리) CSS 토큰. tint: 약한 배경 CSS 토큰. 전부 기존 토큰에서만 — 신규 색 금지.
//   - className: `otype-<lower>` — index.css 에서 --otype-color/--otype-tint 를 주입.
import type { ObjectType } from "./types";

export interface ObjectTypeVisual {
  /** 타입 글리프(무채 유니코드; 색은 color 로). */
  glyph: string;
  /** 한글 라벨. */
  label: string;
  /** 전경 색 CSS 토큰(글리프·칩 테두리). */
  color: string;
  /** 약한 배경 색 CSS 토큰(칩 배경). */
  tint: string;
  /** CSS 클래스(index.css .otype-<x> 가 색 변수 주입). */
  className: string;
}

// 타입별 시각 토큰 — 색 의미:
//  Model=스틸블루(제품 심장) · Endpoint=진한 블루(외부 노출 표면) · Service=청록(논리 서비스; 블루와 구분)
//  GpuDevice/Node=그레이(물리 자원) · Trace=인디고(실행 궤적) · Incident=레드(항상 경계색).
export const objectTypeVisual: Record<ObjectType, ObjectTypeVisual> = {
  Model: { glyph: "◆", label: "모델", color: "var(--primary)", tint: "var(--primary-weak)", className: "otype-model" },
  Endpoint: { glyph: "▣", label: "엔드포인트", color: "var(--primary-strong)", tint: "var(--primary-weak)", className: "otype-endpoint" },
  Service: { glyph: "◈", label: "서비스", color: "var(--teal)", tint: "var(--teal-weak)", className: "otype-service" },
  GpuDevice: { glyph: "▤", label: "GPU", color: "var(--brand-gray-strong)", tint: "var(--brand-gray-weak)", className: "otype-gpu" },
  Node: { glyph: "▥", label: "노드", color: "var(--brand-gray-strong)", tint: "var(--brand-gray-weak)", className: "otype-node" },
  Trace: { glyph: "≣", label: "트레이스", color: "var(--blue)", tint: "#e8effe", className: "otype-trace" },
  Incident: { glyph: "▲", label: "인시던트", color: "var(--red)", tint: "var(--red-weak)", className: "otype-incident" },
};

// 편의 접근자 — 알 수 없는 타입 방어(런타임 안전; 기본 그레이 칩).
export function typeVisual(type: ObjectType): ObjectTypeVisual {
  return objectTypeVisual[type] ?? {
    glyph: "○", label: String(type), color: "var(--text-dim)", tint: "var(--surface-2)", className: "otype-unknown",
  };
}
