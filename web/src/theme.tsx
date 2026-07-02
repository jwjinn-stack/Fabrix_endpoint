// 브랜드 색상 테마 — 고객사 표준 색상에 맞춰 전체 UI 강조색(--primary 계열)을 바꾼다.
// 기본은 스틸 블루(MAYMUST). 설정 화면에서 프리셋 선택 또는 커스텀 HEX 지정.
// 적용 방식: documentElement 인라인 CSS 변수 오버라이드(라이트/다크 공통). localStorage 영속.
//
// IMP-87 — 화이트라벨: 색상에 더해 제품명·위첨자·로고·favicon 을 고객사별로 바꾼다(direction 7).
//   Grafana Enterprise custom-branding(app_title/menu_logo/login_logo) 스키마를 미러하되
//   **토큰 폭증을 피해** 좁은 단일 세트(TenantBrand)로 봉인한다. 색(primary 계열)과 브랜드
//   정체성(name/logo/favicon/onPrimary)은 별도 localStorage 키로 분리 저장해 서로 독립적으로 바뀐다.
//   onPrimary(--primary 위 텍스트 색)는 WCAG 상대휘도로 흰/검 중 대비가 나은 쪽을 실측 자동선택한다.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface Brand {
  id: string;
  name: string;
  primary: string;   // --primary
  strong: string;    // --primary-strong (진한 강조·호버)
  weak: string;      // --primary-weak (옅은 배경·선택)
  lite: string;      // --primary-lite (그라데이션·보조)
  onPrimary: string; // --on-primary (--primary 위 텍스트 색 · WCAG 대비 자동선택)
}

// 고객사 브랜드 정체성 — 색과 분리된 화이트라벨 토큰(좁게 유지). productName/suffix 는 워드마크,
//  logo/favicon 은 data-URI(mock-first). onPrimary 는 Brand 에서 파생돼 여기서도 유효.
export interface TenantBrand {
  productName: string;    // 워드마크 본체 (기본 "FABRIX")
  productSuffix: string;  // 위첨자 (기본 "AI"; 빈 문자열이면 위첨자 없음)
  logoDataUri?: string;   // 있으면 워드마크 대신 <img>
  faviconDataUri?: string;
}

export const BRAND_PRESETS: Brand[] = [
  { id: "steel",  name: "스틸 블루", primary: "#4a86b8", strong: "#2f6690", weak: "#e9f1f8", lite: "#6ba3cd", onPrimary: "#ffffff" },
  { id: "orange", name: "오렌지",     primary: "#fb6e00", strong: "#c2540a", weak: "#fff1e6", lite: "#ff9a4d", onPrimary: "#ffffff" },
  { id: "teal",   name: "틸 그린",   primary: "#2f7d8c", strong: "#1f5a66", weak: "#e6f2f4", lite: "#5aa7b4", onPrimary: "#ffffff" },
  { id: "indigo", name: "인디고",     primary: "#4f46e5", strong: "#3730a3", weak: "#eef0fd", lite: "#818cf8", onPrimary: "#ffffff" },
  { id: "slate",  name: "슬레이트",   primary: "#475569", strong: "#334155", weak: "#eef1f5", lite: "#94a3b8", onPrimary: "#ffffff" },
];

const DEFAULT_BRAND = BRAND_PRESETS[0];
const STORE_KEY = "fabrix.brand";
const TENANT_KEY = "fabrix.tenant";

// 화이트라벨 기본값 — 저장이 없으면 FABRIX / AT 로 폴백(index.html·기존 하드코딩과 동일).
export const DEFAULT_TENANT: TenantBrand = { productName: "FABRIX", productSuffix: "AI" };

// 업로드 가드 상수(보안 라이트체크 — data-URI 만 허용, 크기 캡).
export const LOGO_MAX_BYTES = 64 * 1024;    // 로고 ≤64KB
export const FAVICON_MAX_BYTES = 32 * 1024; // favicon ≤32KB
const ALLOWED_IMG_MIME = ["image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/gif", "image/x-icon", "image/vnd.microsoft.icon"];

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

// ── WCAG 상대휘도·대비비 ── (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance)
function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
// 대비비(1:1 ~ 21:1). fg/bg 는 6자리 HEX. 파싱 실패 시 1(최악)로 보수적 반환.
export function contrastRatio(fg: string, bg: string): number {
  const a = hexToRgb(fg), b = hexToRgb(bg);
  if (!a || !b) return 1;
  const la = relLuminance(a), lb = relLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
// --primary 위 텍스트 색을 흰/검 중 대비가 나은 쪽으로 실측 자동선택.
//  본문 4.5:1 을 우선하되, 둘 다 미달이면 대비가 더 큰 쪽(UI 3:1 이라도)을 고른다.
export function pickOnPrimary(primary: string): string {
  const white = contrastRatio("#ffffff", primary);
  const black = contrastRatio("#111111", primary);
  return white >= black ? "#ffffff" : "#111111";
}
// 텍스트-on-primary 조합의 WCAG 통과 여부(브랜드 색 자체가 아니라 "조합"만 검증). Settings 경고용.
export function wcagAssess(primary: string, onPrimary: string): { ratio: number; passAA: boolean; passUI: boolean } {
  const ratio = contrastRatio(onPrimary, primary);
  return { ratio, passAA: ratio >= 4.5, passUI: ratio >= 3.0 };
}

// 임의 HEX → 4단계 브랜드(강조색 일관 명도 유지) + onPrimary 대비 자동선택. 커스텀 색상용.
export function deriveBrand(primary: string, name = "커스텀"): Brand {
  return {
    id: "custom",
    name,
    primary,
    strong: mix(primary, BLACK, 0.3),
    lite: mix(primary, WHITE, 0.38),
    weak: mix(primary, WHITE, 0.9),
    onPrimary: pickOnPrimary(primary),
  };
}

export function isValidHex(hex: string): boolean {
  return hexToRgb(hex) !== null;
}

// ── 화이트라벨 업로드 가드(보안) ──
// data-URI 가 이미지인지 검사 — `javascript:`·텍스트·비이미지 data-URI 거부(injection/오용 방지).
export function isImageDataUri(uri: string): boolean {
  const m = /^data:([^;,]+)[;,]/i.exec(uri.trim());
  if (!m) return false;
  return ALLOWED_IMG_MIME.includes(m[1].toLowerCase());
}
// data-URI 바이트 크기 근사(base64 페이로드 길이 기준) 캡 검사.
export function withinSizeCap(uri: string, maxBytes: number): boolean {
  const idx = uri.indexOf(",");
  const payload = idx >= 0 ? uri.slice(idx + 1) : uri;
  // base64 → 바이트: len*3/4 (padding 보정). 근사면 충분.
  const bytes = Math.floor((payload.length * 3) / 4);
  return bytes <= maxBytes;
}

// CSS 변수 적용 — 라이트/다크 양쪽 스타일시트 규칙보다 우선(인라인).
export function applyBrand(b: Brand): void {
  const s = document.documentElement.style;
  s.setProperty("--primary", b.primary);
  s.setProperty("--primary-strong", b.strong);
  s.setProperty("--primary-weak", b.weak);
  s.setProperty("--primary-lite", b.lite);
  s.setProperty("--on-primary", b.onPrimary || "#ffffff");
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

// 화이트라벨 로드/저장 — 색과 별개의 단일 출처(BootScreen 도 이걸 직접 읽는다).
export function loadTenant(): TenantBrand {
  try {
    const raw = localStorage.getItem(TENANT_KEY);
    if (!raw) return DEFAULT_TENANT;
    const s = JSON.parse(raw) as Partial<TenantBrand>;
    const t: TenantBrand = {
      productName: (s.productName ?? DEFAULT_TENANT.productName).slice(0, 40) || DEFAULT_TENANT.productName,
      productSuffix: (s.productSuffix ?? DEFAULT_TENANT.productSuffix).slice(0, 8),
      // 저장값이라도 방어적으로 재검증(로드 시점 injection 가드).
      logoDataUri: s.logoDataUri && isImageDataUri(s.logoDataUri) && withinSizeCap(s.logoDataUri, LOGO_MAX_BYTES) ? s.logoDataUri : undefined,
      faviconDataUri: s.faviconDataUri && isImageDataUri(s.faviconDataUri) && withinSizeCap(s.faviconDataUri, FAVICON_MAX_BYTES) ? s.faviconDataUri : undefined,
    };
    return t;
  } catch { return DEFAULT_TENANT; }
}
function saveTenant(t: TenantBrand): void {
  try { localStorage.setItem(TENANT_KEY, JSON.stringify(t)); } catch { /* ignore */ }
}

// 문서 title·favicon 런타임 주입 — index.html 은 fallback, 여기서 고객사 값으로 덮는다.
export function applyTenantDocument(t: TenantBrand): void {
  const suffix = t.productSuffix ? t.productSuffix : "";
  document.title = `${t.productName}${suffix ? ` ${suffix}` : ""} — 관제`;
  if (t.faviconDataUri && isImageDataUri(t.faviconDataUri)) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = t.faviconDataUri; // href 대입만 — innerHTML 미사용.
  }
}

interface ThemeCtx {
  brand: Brand;
  setBrand: (b: Brand) => void;
  tenant: TenantBrand;
  setTenant: (t: TenantBrand) => void;
}
const Ctx = createContext<ThemeCtx>({ brand: DEFAULT_BRAND, setBrand: () => {}, tenant: DEFAULT_TENANT, setTenant: () => {} });

export function useBrand(): ThemeCtx {
  return useContext(Ctx);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [brand, setBrandState] = useState<Brand>(() => loadBrand());
  const [tenant, setTenantState] = useState<TenantBrand>(() => loadTenant());

  // 마운트·변경 시 CSS 변수 적용 + 영속.
  useEffect(() => {
    applyBrand(brand);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(brand.id === "custom" ? { id: "custom", primary: brand.primary } : { id: brand.id }));
    } catch { /* ignore */ }
  }, [brand]);

  // 화이트라벨 — 문서 title/favicon 런타임 주입 + 영속.
  useEffect(() => {
    applyTenantDocument(tenant);
    saveTenant(tenant);
  }, [tenant]);

  const value = useMemo(() => ({ brand, setBrand: setBrandState, tenant, setTenant: setTenantState }), [brand, tenant]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
