# IMP-87 — 고객사 화이트라벨 — 로고·제품명·favicon + 디자인 토큰 확장

- Type: aesthetic (sev=medium, effort=M) · Direction 7
- Branch: feature/evolve-cycle6-ontology-ux
- Area: `web/src/theme.tsx`, `web/src/components/Layout.tsx`, `web/src/capabilities.tsx`(BootScreen), `web/src/pages/Settings.tsx`, `web/index.html`

## 배경/문제
theme.tsx 는 색상 프리셋 5종 + 커스텀 HEX + deriveBrand(strong/weak/lite) + 다크모드까지 갖췄으나
화이트라벨의 핵심인 **로고·제품명·favicon** 개념이 전혀 없다. Layout.tsx:~203, capabilities.tsx BootScreen,
index.html 에 'FABRIX' 워드마크가 하드코딩됨. 색상은 갈아끼워지나 브랜드 정체성이 고정 — 화이트라벨 SaaS 판매의 핵심 결함.

## 목표(좁게)
Grafana Enterprise custom-branding 스키마(app_title / menu_logo / login_logo)를 미러하되 **단일 좁은 토큰 세트**로 봉인.
토큰 폭증(15번째 고객사에서 200개) 함정을 피하기 위해 신규 토큰은 딱 3개만 추가:
`productName`, `productSuffix?`, `logoDataUri?`, `faviconDataUri?`, `onPrimary`.

## 설계
### 1. TenantBrand (theme.tsx)
기존 `Brand`(id/name/primary/strong/weak/lite)를 유지하되 확장 `TenantBrand` 도입:
```
interface TenantBrand extends Brand {
  productName: string;    // 워드마크 본체 (기본 "FABRIX")
  productSuffix?: string; // 위첨자 (기본 "AI")
  onPrimary: string;      // --primary 위 텍스트 색(#fff|#111) — WCAG 실측 자동선택
  logoDataUri?: string;   // 있으면 워드마크 대신 <img>
  faviconDataUri?: string;
}
```
- 색(primary/strong/weak/lite)은 기존 프리셋/커스텀 흐름 그대로. onPrimary/logo/name 은 **별도 localStorage 키**(`fabrix.tenant`)로 분리 저장 → 색 프리셋 전환과 독립.
- `deriveBrand(primary)` 에 onPrimary 자동선택 추가: primary 상대휘도 계산 → 흰/검 중 대비 4.5:1(본문) 우선, 미달 시 3:1(UI) 더 높은 쪽. `contrastRatio(fg,bg)` · `pickOnPrimary(bg)` 순수함수.
- `wcagAssess(primary, onPrimary)` → { ratio, passAA(4.5), passUI(3.0) } 반환(Settings 경고용). **브랜드 색 자체는 막지 않음** — 텍스트-on-primary 조합만 검증.

### 2. 런타임 주입 (theme.tsx ThemeProvider useEffect)
- `applyBrand`: 기존 4개 + `--on-primary` 추가.
- 신규 useEffect(tenant 변경 시): `document.title = productName + suffix + " — 관제"`; `link[rel=icon].href = faviconDataUri`(없으면 유지). index.html 은 fallback.
- topbar CSS `.brand`/`sup` 하드코딩 #fff → `var(--on-primary)` 로 전환.

### 3. 렌더
- Layout.tsx topbar: logoDataUri 있으면 `<img class="brand-logo">`, 없으면 `{productName}<sup>{suffix}</sup>`.
- capabilities.tsx BootScreen: 동일 토큰(productName/suffix) 사용. 단 BootScreen 은 ThemeProvider 밖일 수 있으므로 `loadTenant()` 직접 호출(localStorage 단일 출처).

### 4. Settings "화이트라벨" 카드 (색상 프리셋 카드 **위**)
- 제품명·위첨자 텍스트 입력 + 로고 업로드 + favicon 업로드 + 라이브 프리뷰(topbar 미니).
- **manage-gated**: `canConfig`(credentials cap) 아니면 읽기전용(observe). IMP-82 카드는 손대지 않음.
- 업로드 = FileReader → data-URI. 가드: 이미지 MIME(image/png|jpeg|svg+xml|webp|gif|x-icon)만, 로고 ≤64KB, favicon ≤32KB + 정사각(±2px). 실패 시 toast/inline 경고, 저장 안 함.
- 색상 프리셋 카드 하단에 WCAG 경고: 현재 primary×onPrimary 대비가 AA 미달이면 amber 경고(색 자체는 유효 유지).

## 보안 라이트체크
- data-URI: `image/*` MIME 프리픽스 검증 + 크기 캡. `dangerouslySetInnerHTML` 미사용 — `<img src>` / `link.href` 대입만.
- 시크릿 없음. localStorage 만(mock-first).

## 테스트 케이스 (theme.whitelabel.test.tsx)
1. TenantBrand 저장/복원 — saveTenant→loadTenant 왕복(productName/suffix/logo/favicon).
2. 기본값 fallback — 저장 없으면 FABRIX / AI.
3. pickOnPrimary — 밝은 배경(#e9f1f8)→#111, 어두운 배경(#2f6690)→#fff.
4. contrastRatio — 흰-검 = 21:1, 동일색 = 1:1(근사).
5. wcagAssess — 저대비 조합(예: #cccccc on #ffffff) passAA=false 경고 트리거.
6. deriveBrand 가 onPrimary 를 채운다(임의 HEX).
7. isImageDataUri — png data-URI true, `javascript:` / 텍스트 false(injection 가드).
8. withinSizeCap — 64KB 초과 로고 거부.
9. document.title 주입 — ThemeProvider 마운트 후 title 에 productName 포함(RTL).
10. Layout 렌더 — productName 커스텀 시 topbar 에 표기(logo 없을 때).

## 완료 기준
- `npm run test` 전체 통과(isolation 포함), `npm run build`(tsc) 통과.
- IMPROVEMENTS.md IMP-87 Status → done.
