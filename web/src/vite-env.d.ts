/// <reference types="vite/client" />

interface ImportMetaEnv {
  // 프론트 단독 mock 모드 토글. "off" 면 실제 백엔드(:8080)로 붙는다(기본: mock 활성).
  readonly VITE_MOCK?: string;
  // 프론트 단독(mock) 실행 시 흉내낼 배포 프로파일. "observe" | "manage"(기본).
  // 실백엔드 연동 시에는 백엔드 /capabilities 응답이 우선한다.
  readonly VITE_PROFILE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
