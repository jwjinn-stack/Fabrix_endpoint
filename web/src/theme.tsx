// 브랜드 색상 테마 — 고객사 표준 색상에 맞춰 전체 UI 강조색(--primary 계열)을 바꾼다.
// 기본은 스틸 블루(MAYMUST). 설정 화면에서 프리셋 선택 또는 커스텀 HEX 지정.
// 적용 방식: documentElement 인라인 CSS 변수 오버라이드(라이트/다크 공통). localStorage 영속.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface Brand {
  id: string;
  name: string;
  primary: string;   // --primary
  strong: string;    // --primary-strong (진한 강조·호버)
  weak: string;      // --primary-weak (옅은 배경·선택)
  lite: string;      // --primary-lite (그라데이션·보조)
}

export const BRAND_PRESETS: Brand[] = [
  { id: "steel",  name: "스틸 블루", primary: "#4a86b8", strong: "#2f6690", weak: "#e9f1f8", lite: "#6ba3cd" },
  { id: "orange", name: "오렌지",     primary: "#fb6e00", strong: "#c2540a", weak: "#fff1e6", lite: "#ff9a4d" },
  { id: "teal",   name: "틸 그린",   primary: "#2f7d8c", strong: "#1f5a66", weak: "#e6f2f4", lite: "#5aa7b4" },
  { id: "indigo", name: "인디고",     primary: "#4f46e5", strong: "#3730a3", weak: "#eef0fd", lite: "#818cf8" },
  { id: "slate",  name: "슬레이트",   primary: "#475569", strong: "#334155", weak: "#eef1f5", lite: "#94a3b8" },
];

const DEFAULT_BRAND = BRAND_PRESETS[0];
const STORE_KEY = "fabrix.brand";

// ── 색 보정: 커스텀 HEX 에서 strong/weak/lite 파생 ──
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
// t(0..1) 만큼 target 색으로 섞는다.
function mix(hex: string, target: [number, number, number], t: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(rgb[0] + (target[0] - rgb[0]) * t, rgb[1] + (target[1] - rgb[1]) * t, rgb[2] + (target[2] - rgb[2]) * t);
}
const BLACK: [number, number, number] = [0, 0, 0];
const WHITE: [number, number, number] = [255, 255, 255];

// 임의 HEX → 4단계 브랜드(강조색 일관 명도 유지). 커스텀 색상용.
export function deriveBrand(primary: string, name = "커스텀"): Brand {
  return {
    id: "custom",
    name,
    primary,
    strong: mix(primary, BLACK, 0.3),
    lite: mix(primary, WHITE, 0.38),
    weak: mix(primary, WHITE, 0.9),
  };
}

export function isValidHex(hex: string): boolean {
  return hexToRgb(hex) !== null;
}

// CSS 변수 적용 — 라이트/다크 양쪽 스타일시트 규칙보다 우선(인라인).
export function applyBrand(b: Brand): void {
  const s = document.documentElement.style;
  s.setProperty("--primary", b.primary);
  s.setProperty("--primary-strong", b.strong);
  s.setProperty("--primary-weak", b.weak);
  s.setProperty("--primary-lite", b.lite);
}

function loadBrand(): Brand {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_BRAND;
    const saved = JSON.parse(raw) as { id?: string; primary?: string };
    if (saved.id && saved.id !== "custom") {
      const preset = BRAND_PRESETS.find((p) => p.id === saved.id);
      if (preset) return preset;
    }
    if (saved.primary && isValidHex(saved.primary)) return deriveBrand(saved.primary);
  } catch { /* ignore */ }
  return DEFAULT_BRAND;
}

interface ThemeCtx {
  brand: Brand;
  setBrand: (b: Brand) => void;
}
const Ctx = createContext<ThemeCtx>({ brand: DEFAULT_BRAND, setBrand: () => {} });

export function useBrand(): ThemeCtx {
  return useContext(Ctx);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [brand, setBrandState] = useState<Brand>(() => loadBrand());

  // 마운트·변경 시 CSS 변수 적용 + 영속.
  useEffect(() => {
    applyBrand(brand);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(brand.id === "custom" ? { id: "custom", primary: brand.primary } : { id: brand.id }));
    } catch { /* ignore */ }
  }, [brand]);

  const value = useMemo(() => ({ brand, setBrand: setBrandState }), [brand]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
