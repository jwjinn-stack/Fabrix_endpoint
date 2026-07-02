// 배포 프로파일(observe/manage) 런타임 게이팅.
//
// 부팅 시 백엔드 GET /api/v1/capabilities 를 1회 받아 Context 에 담고, NAV·버튼·페이지
// 접근을 토글한다. 실제 mutating 차단은 백엔드 라우트 미등록(404/405)이 담당하므로,
// 여기서는 UX(메뉴/버튼 숨김)만 책임진다 — 조회 실패 시 manage(전체)로 fail-open.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fetchCapabilities } from "./api/client";
import { loadTenant } from "./theme";
import type { Capabilities } from "./api/types";

// 조회 실패/구버전 백엔드 폴백 — 빈 맵 + can() 기본 true 로 전체 노출(UI 를 막지 않음).
const FALLBACK: Capabilities = {
  profile: "manage",
  readonly: false,
  capabilities: {},
  data_source: "",
  integrations: {},
};

interface CapCtx {
  caps: Capabilities;
  can: (cap: string) => boolean;
}

const Ctx = createContext<CapCtx>({ caps: FALLBACK, can: () => true });

// useCap 은 현재 배포 프로파일과 cap 질의 함수를 반환한다.
export function useCap(): CapCtx {
  return useContext(Ctx);
}

// CapabilitiesProvider 는 부팅 시 capabilities 를 받아온다. 해결 전에는 전체화면 로딩.
export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    fetchCapabilities(ac.signal)
      .then(setCaps)
      .catch((e) => {
        if (ac.signal.aborted) return;
        setFailed(true);
        console.warn("[FABRIX] /capabilities 조회 실패 — manage(전체)로 폴백", e);
      });
    return () => ac.abort();
  }, []);

  if (!caps && !failed) return <BootScreen />;

  const resolved = caps ?? FALLBACK;
  // 맵에 키가 있으면 그 값을, 없으면(폴백/구버전) 허용. observe 응답엔 모든 키가 명시돼 있다.
  const can = (cap: string): boolean => {
    const m = resolved.capabilities;
    return cap in m ? !!m[cap] : true;
  };

  return <Ctx.Provider value={{ caps: resolved, can }}>{children}</Ctx.Provider>;
}

// 부팅 로딩 — capabilities 해결 전 잠깐 보이는 전체화면.
//  IMP-87 — ThemeProvider 밖일 수 있으므로 loadTenant()를 직접 읽어 동일 화이트라벨 토큰 사용.
function BootScreen() {
  const tenant = loadTenant();
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
      <div style={{ textAlign: "center" }}>
        {tenant.logoDataUri ? (
          <img src={tenant.logoDataUri} alt={tenant.productName} style={{ maxHeight: 40, maxWidth: 200 }} />
        ) : (
          <div style={{ fontWeight: 800, fontSize: 22, color: "var(--brand-fabrix)", letterSpacing: ".02em" }}>
            {tenant.productName}
            {tenant.productSuffix && <sup style={{ fontSize: "var(--fs-xs)" }}>{tenant.productSuffix}</sup>}
          </div>
        )}
        <div style={{ marginTop: "var(--sp-3)", fontSize: "var(--fs-body)", color: "var(--text-faint)" }}>구성을 불러오는 중…</div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">구성을 불러오는 중입니다.</span>
    </div>
  );
}
