# Fireworks AI · Together AI UI/UX 벤치마킹

> 목적: FABRIX Endpoint(증권사 인퍼런스 거버넌스/관제 콘솔)의 **모델 카탈로그 → 플레이그라운드 → 엔드포인트 발급** 플로우 구현을 위한 경쟁 제품 UI/UX 벤치마킹.
> 작성일: 2026-06-18 · 대상: Fireworks AI(https://fireworks.ai/), Together AI(https://www.together.ai/)
> FABRIX 맥락: **증권사 폐쇄망 온프렘**. 가격/요금 노출보다 **거버넌스·귀속(attribution)·가드레일·감사**를 우선. 두 제품의 "셀프서비스 개발자 UX"를 차용하되, 과금/회원가입/외부 SaaS 요소는 사내 권한·승인·감사 체계로 치환합니다.

> ⚠️ 신뢰도 표기: **높음**(공식 문서/직접 렌더링 교차확인) / **중간**(공식 문서 1개 또는 검색 스니펫) / **불확실**(로그인 게이트로 직접 확인 불가, 추정 포함). "추측"은 별도 명시.
> ⚠️ 두 제품 모두 **플레이그라운드·배포 대시보드가 로그인 게이트** 뒤에 있어, 해당 영역 일부는 공개 문서 기반 추정입니다. 정확 검증은 실제 로그인 후 dogfooding(스크린샷 캡처)이 필요합니다.

---

## TL;DR — 베껴올 핵심 8가지

1. **모델 카탈로그는 카드 그리드 + 상단 모달리티 탭**. 두 제품 모두 테이블이 아닌 카드 레이아웃, 상단에 Chat/Vision/Embedding/Rerank/Image 등 카테고리 탭. → FABRIX도 카드+탭. (높음)
2. **카드 한 줄에 핵심 메타데이터 압축**: 모델명 + 제공자 로고 + 컨텍스트 길이 + 모달리티 배지 + (Fireworks/Together는 가격). → FABRIX는 가격 자리에 **귀속/가드레일/배포상태 배지**를 넣습니다. (높음)
3. **모델 상세 페이지에 액션 3버튼 나란히**: Fireworks의 `Try in Playground / Deploy on Demand / Fine-tune`. 한 화면에서 시험→배포→튜닝으로 분기. → FABRIX는 `플레이그라운드에서 시험 / 엔드포인트 발급 / 가드레일·정책 설정`. (높음)
4. **"View code" 코드 스니펫 자동 생성**(curl/python/JS). 플레이그라운드에서 만든 설정 그대로 코드로 복사 → API 검증 루프를 한 화면에서 닫음. → FABRIX는 사내 base URL + 발급 토큰을 자동 주입한 스니펫. (Fireworks 중간 / Together 중간)
5. **OpenAI 호환 엔드포인트 + Bearer 토큰**이 사실상 표준. `https://api.../v1` + `Authorization: Bearer <KEY>`. → FABRIX도 OpenAI 호환 스킴 유지(마이그레이션 마찰 0), 단 엔드포인트는 사내 폐쇄망 URL. (높음)
6. **Serverless vs Dedicated 2분법을 명확히 노출**: 공유(토큰 과금, 즉시·SLA 약함) vs 전용(GPU 시간 과금, 격리·낮은 지연·rate limit 없음, 커스텀 모델 업로드). → FABRIX는 "공유 추론 풀 vs 전담(dedicated) GPU 배포"로 번역, **과금 대신 GPU 쿼터·우선순위·격리등급**으로 차별화. (높음)
7. **배포 위저드 = GPU 종류/개수 + min/max 레플리카 오토스케일 + scale-to-zero**. Fireworks는 미사용 1시간 시 0으로 축소. → FABRIX 발급 위저드도 동일 4입력(GPU·개수·오토스케일·리전) + **소유부서/용도/승인자** 필드 추가. (높음)
8. **API 키는 발급 시 1회만 표시, revoke/rotate 가능**. → FABRIX는 키를 **부서·서비스·용도에 귀속**시키고 발급·회수 전체를 감사 로그화. (높음)

---

## 1. 모델 카탈로그 / 라이브러리

### 1.1 Fireworks AI (`fireworks.ai/models` — 직접 렌더링 확인)

| 항목 | 내용 | 신뢰도 |
|---|---|---|
| 레이아웃 | **카드 그리드**. 테이블 아님 | 높음 |
| 카드 메타데이터 | 모델명 + 제공자 로고 + 가격(`$X/M Input • $Y/M Output`, 일부 캐시 입력가) + 컨텍스트 길이(`262144 Context`) + 모달리티 배지 | 높음 |
| 카테고리 탭 | **Featured / Serverless / Embeddings / Reranks / LLM / Vision(VLM)** 6탭(각 아이콘) | 높음 |
| 검색 | 상단 "Search model library" 텍스트박스 | 높음 |
| 필터 | "**Providers**" 드롭다운 + "**Filters**" 버튼 | 높음 |
| 정렬 | 명시적 정렬 셀렉터 **확인 불가** | 불확실 |
| 배지/태그 | "**New**" 신규 배지, 모달리티 배지(LLM/Vision), 제공자 로고(OpenAI·DeepSeek·Qwen·Kimi·GLM·NVIDIA·Google·MiniMax·Voyage 등) | 높음 |
| 파라미터 수 | 카드엔 미표시(모델명에 70B/120B 포함). 정확 수치는 **상세 페이지 Metadata 표**에 `Parameters 116B` 형태 | 높음 |
| 모델 상세 Metadata | State(Ready) · Created · Kind · Provider · HF 경로 · MoE 여부 · Parameters · Context Length · 기능 지원표(Fine-tuning/Serverless/Function Calling/Embeddings/Rerankers/image input 각 Supported 여부) · License | 높음 |
| 상세 상단 | 모델 경로 `accounts/fireworks/models/<name>` + 복사 버튼 + 액션 3버튼(`Try in Playground` / `Deploy on Demand` / `Fine-tune`) | 높음 |

### 1.2 Together AI (`together.ai/models`)

| 항목 | 내용 | 신뢰도 |
|---|---|---|
| 레이아웃 | **카드 기반**, "200+ 모델" 그리드 | 높음 |
| 카드 메타데이터 | 모델명 + 제공사(로고+이름) + 가격(입출력 백만 토큰당, 일부 캐시) + 파라미터 수 + 컨텍스트 길이 + 기능 태그 | 중간 |
| 카테고리 탭 | All / Chat / Image / Vision / Video / Audio / Transcribe / Code / Embeddings / Rerank / Moderation | 높음 |
| 필터 | 제공사별(All providers) 드롭다운 + 카테고리 탭 | 중간 |
| 배지/태그 | "new" 배지, 기능 태그(Function Calling · JSON Mode · Reasoning · Prompt Caching) | 중간 |
| 배포방식 표기 | 카드/메타데이터에 **Serverless vs Dedicated** 구분 | 중간 |

> 참고: Together 카드의 구체 단가·일부 모델명은 검색 요약 모델이 생성한 미확인 값이 섞여 있어 **단가/모델명 개별 수치는 불확실**. 카드 구조 자체는 교차 확인.

### 1.3 비교 정리

- **공통**: 카드 그리드 + 상단 모달리티 탭 + 제공자 필터 + 신규 배지 + 고밀도 메타데이터.
- **차이**: Together가 모달리티 카테고리(Video/Audio/Transcribe/Moderation까지)를 더 세분화. Fireworks는 카드에 가격을, 파라미터 수는 상세 페이지로 분리.

### 1.4 우리는 이렇게 차용 (FABRIX)

- **카드+탭 채택**, 단 탭 카테고리는 사내 운영 모달리티(Chat/Embedding/Vision/Rerank)로 한정하고, **가격 배지 자리에 거버넌스 메타데이터**를 노출: `소유부서` · `가드레일 적용여부` · `배포상태(공유풀/전용)` · `승인등급`.
- 상세 페이지 Metadata 표는 그대로 차용하되 행을 교체: 라이선스/HF경로 대신 **반입 승인일·검증(레드팀) 통과 여부·허용 부서·데이터 등급·감사 정책 ID**. 폐쇄망이므로 외부 HF 링크 대신 **사내 모델 레지스트리 경로**.

---

## 2. 플레이그라운드 (채팅)

> 두 제품 모두 플레이그라운드 실화면이 **로그인 게이트** 뒤. 아래 레이아웃 세부는 공식 문서·검색 기반 추정 포함.

### 2.1 Fireworks AI

| 항목 | 내용 | 신뢰도 |
|---|---|---|
| 진입 | 상세 페이지 `Try in Playground` → `app.fireworks.ai/playground?model=accounts/fireworks/models/<name>` | 높음 |
| 유형 | LLM / 이미지 / 오디오 3종 플레이그라운드 | 중간 |
| 레이아웃(좌 params/중앙 대화/우 code) | 파라미터 컨트롤 + 프롬프트 입력 + 코드 스니펫 패널 존재까지 확인. 정확한 좌/중/우 3분할 배치는 **미확인(추측)** | 불확실 |
| 파라미터 | UI: temperature, max_tokens 조정(문서 명시). 이미지: Guidance Scale/Inference Steps/Seed. API엔 top_p·top_k·min_p·typical_p·frequency_penalty·presence_penalty 존재하나 **UI 슬라이더 노출 범위는 미확인** | 중간/불확실 |
| 모델 전환 | 모델 ID 한 줄 변경으로 전환, URL 쿼리파라미터로도 전환 | 중간 |
| 스트리밍 | 토큰 단위 실시간(`stream=True`) | 높음 |
| TPS/토큰/지연 | 응답 지표(latency, tokens/sec) 플레이그라운드 표시 언급 | 중간 |
| 멀티모델 비교 | 이미지 플레이그라운드 비교 언급. **LLM 채팅 side-by-side는 확인 불가** | 불확실 |
| 코드 자동생성 | **확인됨**. Python/TypeScript/Java/Go/Shell(cURL) 스타터 코드, Chat/Completion 모드별 | 중간 |

### 2.2 Together AI

| 항목 | 내용 | 신뢰도 |
|---|---|---|
| 진입 | `api.together.xyz/playground`, 좌측 사이드바로 유형 전환 | 중간 |
| 레이아웃 | 좌측 사이드바(모델/유형 선택, 파라미터). 정확한 3분할은 **로그인 게이트로 확인 불가** | 불확실 |
| 모델 전환 | Together 제공 모델 + 사용자 파인튜닝 모델 선택, 사이드바 전환 | 중간 |
| 파라미터 | system prompt, temperature, max_tokens, top_p, stop sequences (top_k/repetition penalty는 확인 필요) | 중간 |
| 스트리밍 | API `stream=true` 지원, 토큰 스트리밍 | 높음(API)/중간(UI) |
| TPS/토큰/지연 | 플랫폼 TPS 수치 존재(예 gpt-oss-120b ~575 t/s)하나 **화면 인라인 표시 여부 미확정** | 불확실 |
| 멀티모델 비교 | 문서 확인 안 됨 → **추측 수준** | 불확실 |
| 코드 자동생성 | "inline run-inference code" 언급 → 코드 뷰 제공 가능성 높으나 버튼 명칭·동작 미확정 | 중간 |

### 2.3 비교 정리

- **공통 확실**: 스트리밍, 모델 전환, 파라미터 컨트롤(temperature/max_tokens 최소), 코드 스니펫 제공.
- **공통 불확실**: 정확한 3분할 레이아웃, LLM side-by-side 멀티모델 비교, TPS/지연의 화면 인라인 표시 위치. → 우리가 차별화로 가져갈 여지가 큰 영역.

### 2.4 우리는 이렇게 차용 (FABRIX)

- **좌 파라미터 / 중앙 대화 / 우 코드** 3분할을 표준 채택(업계가 수렴한 멘탈모델). temperature·max_tokens·top_p·stop을 1차 슬라이더로 노출.
- **TPS·토큰수·지연(P50/P99)·프롬프트/생성 토큰 분리 표시**를 채팅 응답 하단에 인라인으로 명시 노출 → 관제 콘솔 정체성. 경쟁사가 약한 지점이라 차별화.
- **멀티모델 side-by-side 비교**를 1급 기능으로(모델 교체 검증·반입 평가용). 동일 프롬프트를 2~3개 모델에 동시 발사, TPS/지연/토큰 비교 표.
- 코드 스니펫엔 **사내 폐쇄망 base URL + 발급 토큰 + 가드레일 헤더/정책 ID**를 자동 주입. 외부 SaaS 키 대신 부서 귀속 토큰.
- 가드레일 차원: 플레이그라운드 입력/출력에 **마스킹·금칙어·PII 필터 미리보기**를 켜고 끌 수 있게 → "배포 전 가드레일 검증"을 같은 화면에서.

---

## 3. 배포 / 엔드포인트 발급

### 3.1 Fireworks AI

| 항목 | 내용 | 신뢰도 |
|---|---|---|
| Serverless | 토큰당 과금, 콜드스타트 없음, 즉시 호출. 공유 인프라라 SLA·지연 보장 없음(best-effort), deprecation 최소 2주 고지 | 높음 |
| On-demand(Dedicated) | **GPU-초 과금**, 전용 GPU, 낮은 지연·높은 처리량·하드 rate limit 없음, 커스텀 모델(HF) 업로드 | 높음 |
| GPU 선택 | A100(80GB)/H100(80GB)/H200(141GB), 리전별 가용성 상이(MI300X 언급) | 높음 |
| 오토스케일 | min/max 레플리카, **미사용 1시간 시 scale-to-zero**(유휴 과금 0). scale-up 중 초기 503 → 앱에 재시도 필요 | 높음 |
| 리전 | `--region`(GLOBAL/US/EUROPE/APAC), 생성 후 변경 불가 | 높음 |
| 배포 방식 | **CLI 중심 `firectl`**: `firectl deployment create accounts/fireworks/models/<MODEL> --wait`. 프리셋(fast/throughput/cost), `--accelerator-type/-count`, 오토스케일 윈도우 | 높음 |
| 웹 위저드 | `Deploy on Demand` → `app.fireworks.ai/dashboard/deployments/create?baseModel=...`(로그인 필요). 단계 세부는 **확인 불가**, GPU·레플리카·FP8 양자화 옵션 노출 추정 | 중간/불확실 |
| API 키 | 대시보드 `settings/users/api-keys`에서 생성, revoke/rotate, firectl·REST로도 관리 | 높음 |
| 엔드포인트 URL | OpenAI 호환 `https://api.fireworks.ai/inference/v1`, Anthropic 호환 `https://api.fireworks.ai/inference` | 높음 |
| 인증 헤더 | `Authorization: Bearer $FIREWORKS_API_KEY` | 높음 |
| 모델 식별자 | Serverless: `accounts/fireworks/models/<MODEL>` / On-demand: `accounts/<ACCT>/deployments/<DEP_ID>` | 높음 |
| 과금/사용량 | 선불 크레딧(Stripe), 대시보드에서 사용량·지출한도·청구알림. Models API(메타)는 무료, 가입 시 $1 크레딧 | 높음/중간 |
| Rate limit | 초기 Total Prompt 3.6M TPM 등, 사용량 따라 adaptive, 초과 429·혼잡 503 | 높음 |

### 3.2 Together AI

| 항목 | 내용 | 신뢰도 |
|---|---|---|
| Serverless vs Dedicated | Serverless=공유·토큰 변동 과금·완전관리 / Dedicated=전용 격리·예측가능 지연·rate limit 없음·커스텀 업로드·오토스케일 | 높음 |
| 코드 변경 없는 전환 | 두 옵션 동일 추론 API → **코드 변경 없이 serverless↔dedicated 전환** | 높음 |
| API 키 | `api.together.ai/settings/.../api-keys`에서 Create key, **1회만 표시** → 안전 저장 | 높음 |
| 인증 헤더 | `Authorization: Bearer $TOGETHER_API_KEY` | 높음 |
| Base URL | `https://api.together.ai/v1` (OpenAI 완전 호환, base URL+키만 변경) | 높음 |
| 엔드포인트 | `/v1/chat/completions` · `/completions` · `/embeddings` · `/images/generations` · `/audio/speech` · `/audio/transcriptions` | 높음 |
| 배포 위저드(CLI) | `together endpoints hardware --model <m>` → `together endpoints create --model <m> --hardware <id> --display-name "..." --wait` → READY 시 endpoint ID | 높음 |
| 오토스케일 | `--gpu h100 --gpu-count 2 --min-replicas 1 --max-replicas 3`, 복제본 단위 수평 확장 | 높음 |
| GPU·단가(Dedicated) | H100 80GB SXM ~$6.49/h, H200 ~$7.89/h, B200 180GB ~$11.95/h (1/2/4/8 GPU) | 중간 |
| 과금 | Dedicated는 실행 하드웨어 **분당 과금**(요청량 무관), 복제본별 독립, 축소 시 즉시 중지 | 높음 |
| UI vs CLI | UI/CLI 양쪽으로 생성/시작/중지/업데이트/삭제 | 높음 |

### 3.3 비교 정리

- **공통**: OpenAI 호환 `/v1` + Bearer 토큰, API 키 1회 표시·revoke, serverless(공유·토큰)↔dedicated(전용·시간/분 과금) 2분법, CLI 배포 위저드(GPU종류·개수·min/max 레플리카), 코드 변경 없는 전환.
- **차이**: Together는 UI/CLI 동등 강조, Fireworks는 문서가 CLI(`firectl`)에 무게 + scale-to-zero를 명시. Together는 분당, Fireworks는 GPU-초 과금.

### 3.4 우리는 이렇게 차용 (FABRIX)

- **2분법 번역**: "공유 추론 풀(즉시 사용, 사내 best-effort)" vs "전담 GPU 배포(격리·우선순위 보장)". 과금 대신 **GPU 쿼터·우선순위 등급·격리 레벨**로 차별화 표기.
- **발급 위저드 단계**(경쟁사 4입력 + 거버넌스 필드):
  1. 모델 선택(반입 승인된 모델만 노출)
  2. 배포 형태(공유풀 / 전담) + 프리셋(저지연 / 처리량 / 비용효율 → 사내에선 *우선순위/처리량/절전*)
  3. GPU 종류·개수 + min/max 레플리카 오토스케일 + scale-to-zero(유휴 GPU 회수)
  4. 리전/노드풀(폐쇄망 클러스터·존)
  5. **거버넌스**: 소유부서·용도·승인자·데이터 등급·가드레일 정책 ID·만료일
  6. 검토→승인 워크플로우(증권사 내부통제) 후 발급
- **엔드포인트는 OpenAI 호환 스킴 유지**하되 URL은 사내 폐쇄망(예 `https://infer.<사내도메인>/v1`). 인증은 Bearer 토큰이되 **부서·서비스 귀속 토큰**, 발급/회수/로테이션 전체 **감사 로그**.
- **사용량 화면은 과금이 아니라 귀속·관제**로 재정의: 부서별·모델별·토큰/요청량·GPU 점유·가드레일 차단 건수·이상 호출(429/503) 추이. Fireworks의 rate limit·503 재시도 가이드는 **사내 capacity 정책 안내**로 전환.

---

## 4. 전반 UX 원칙

### 4.1 정보 밀도

- **Fireworks**: 카드 고밀도(가격 입출력+컨텍스트+모달리티 한 줄). 상세는 메타표+FAQ 아코디언+액션버튼으로 정보 많지만 구조화. (높음)
- **Together**: 카드·가격표 고밀도, 가격은 탭으로 모달리티 분리해 과밀 완화. (중간)
- **시사점**: 고밀도는 전문가 사용자에 적합하나 초심자 인지부하 위험. → FABRIX는 **요약 카드(저밀도) + 상세 펼침(고밀도)** 2단 구조 권장.

### 4.2 온보딩 마찰

- **Fireworks**: 문서상 5단계(라이브러리→플레이그라운드→키로 서버리스→온디맨드→복합 시스템). 플레이그라운드/대시보드 **로그인 필수**라 익명 체험 불가(첫 진입 마찰). OpenAI/Anthropic 호환·$1 크레딧으로 이후 마찰 완화. (중간)
- **Together**: 낮음 — SDK 설치→키→첫 요청 3단계, "5분 내 첫 엔드포인트", OpenAI 호환 base URL+키 교체. (높음)
- **시사점**: 폐쇄망 FABRIX는 **SSO·사내계정으로 진입 마찰 자체가 낮음**. 대신 "반입 승인·권한 부여"가 첫 마찰 → 승인 상태를 카탈로그에서 시각화해 마찰을 예측가능하게.

### 4.3 "배포 → 검증" 루프를 한 화면에서 닫는 방식

- **Fireworks**: 상세 페이지 한 화면에 `Try in Playground / Deploy on Demand / Fine-tune` 3버튼 → 같은 모델 즉시 분기. 플레이그라운드 내 코드 자동생성으로 "UI 실험→코드 복사→API 검증" 폐루프. (중간)
- **Together**: 카드에서 가격·배포옵션·인라인 실행 코드를 한 화면에 → 카탈로그에서 곧장 코드/배포로. (중간)
- **시사점(차용)**: FABRIX도 **상세 한 화면에서 시험→발급→가드레일 설정**으로 분기. 발급 직후 같은 화면에서 "테스트 호출"(헬스체크 + 샘플 추론 + 가드레일 동작 확인) 버튼으로 **발급→검증 루프를 닫음**.

### 4.4 강점 / 약점

**Fireworks 강점**: 카탈로그 정보밀도·일관 모달리티 분류 · OpenAI/Anthropic 호환 · 코드 자동생성 · 서버리스↔온디맨드 명확한 2분법 + scale-to-zero.
**Fireworks 약점**: 온디맨드가 CLI(`firectl`) 중심(비개발자 마찰) · 플레이그라운드/대시보드 로그인 벽 · 카탈로그 정렬 옵션 부재(추정) · 서버리스 SLA 미보장(503 가능).

**Together 강점**: OpenAI 완전 호환(마이그레이션 0) · serverless↔dedicated 코드 변경 없는 연속성 · CLI 배포 위저드 + 분당/복제본 과금 투명성 · 200+ 단일 카탈로그 · UI/CLI 동등.
**Together 약점(일부 추측)**: 플레이그라운드 핵심 UX(비교/TPS 인라인/코드뷰)가 로그인 게이트 뒤라 공개 노출 부족 · Dedicated 단가 분산 · 카드 고밀도 인지부하 · 엔터프라이즈는 "Contact Sales" 셀프서비스 단절.

**FABRIX 적용 결론**: 두 제품의 약점(로그인 벽·CLI 편중·SLA 미보장·정렬/비교 부재)이 곧 우리 차별화 기회입니다. 폐쇄망 콘솔이므로 **(a) UI 우선 위저드(CLI 의존 제거), (b) TPS/지연 인라인 관제, (c) 멀티모델 비교, (d) 발급 즉시 검증 루프, (e) 거버넌스·귀속·가드레일을 1급 메타데이터**로 끌어올리면, 셀프서비스 UX는 차용하되 증권사 관제 정체성을 확보합니다.

---

## 5. 우리 구현 매핑 (MVP → 확장)

### MVP (Phase 1) — "베껴오기" 우선순위

| 영역 | 차용 항목 | 출처 근거 |
|---|---|---|
| 카탈로그 | 카드 그리드 + 모달리티 탭 + 제공자/검색 필터 + 신규 배지. 카드 메타: 모델명·컨텍스트·모달리티 + **소유부서·배포상태·가드레일 배지** | Fireworks/Together 카드(높음) |
| 카탈로그 | 모델 상세 Metadata 표 + 액션 3버튼(`시험 / 발급 / 가드레일 설정`) | Fireworks 상세(높음) |
| 플레이그라운드 | 좌 파라미터(temp/max_tokens/top_p/stop) / 중앙 대화 / 우 코드 3분할, 스트리밍, **TPS·토큰·지연 인라인 표시** | 업계 수렴(중간) + 관제 차별화 |
| 플레이그라운드 | 코드 스니펫 자동생성(curl/python/JS) + 사내 base URL·토큰·정책 자동주입 | Fireworks 코드생성(중간) |
| 발급 | OpenAI 호환 `/v1` 엔드포인트 + Bearer **부서귀속 토큰**, 발급 1회 표시·revoke·감사 로그 | 양사 공통(높음) |
| 발급 | 공유풀/전담 2분법 + 위저드(모델→형태→GPU/개수/오토스케일→리전→**거버넌스 필드**→승인) | 양사 위저드(높음) |
| 루프 | 발급 직후 같은 화면 "테스트 호출"(헬스체크+샘플추론+가드레일 확인) | Fireworks 폐루프(중간) |

### 확장 (Phase 2+)

| 영역 | 확장 항목 |
|---|---|
| 카탈로그 | 정렬(지연/처리량/승인일/사용량), 반입 평가(레드팀) 결과·데이터 등급 표면화 |
| 플레이그라운드 | **멀티모델 side-by-side 비교**(동일 프롬프트→TPS/지연/토큰/가드레일 차단 비교표), 입출력 마스킹/PII 필터 미리보기 |
| 발급 | scale-to-zero(유휴 GPU 회수), 프리셋(우선순위/처리량/절전), 만료·자동 회수 정책, 승인 워크플로우 결재선 |
| 관제 | 부서·모델별 토큰/요청/GPU 점유·가드레일 차단·이상호출(429/503) 대시보드, 귀속 리포트, 이상탐지 알림 |
| 거버넌스 | 정책 ID 버전관리, 모델 deprecation 사내 고지(Fireworks 2주 고지 차용), 키 로테이션 정책 강제 |

---

## 출처

**Fireworks AI**
- 모델 라이브러리(직접 렌더링): https://fireworks.ai/models
- 모델 상세 예시(직접 렌더링): https://fireworks.ai/models/fireworks/gpt-oss-120b
- 모델 개요: https://docs.fireworks.ai/models/overview
- 온보딩(플레이그라운드): https://docs.fireworks.ai/getting-started/onboarding
- 텍스트 모델 쿼리(파라미터/스트리밍/엔드포인트): https://docs.fireworks.ai/guides/querying-text-models
- 온디맨드 배포: https://docs.fireworks.ai/guides/ondemand-deployments
- 빠른 시작(API 키): https://docs.fireworks.ai/getting-started/quickstart
- 서버리스 rate limit: https://docs.fireworks.ai/serverless/rate-limits
- 결제 관리: https://docs.fireworks.ai/faq/billing-pricing-usage/billing/billing-management
- 플레이그라운드/배포(로그인 필요): https://app.fireworks.ai/playground , https://app.fireworks.ai/dashboard/deployments/create

**Together AI**
- 홈: https://www.together.ai/
- 모델 카탈로그: https://www.together.ai/models
- 빠른 시작(API 키·인증): https://docs.together.ai/docs/quickstart
- 전용 추론(serverless vs dedicated, 위저드, 과금): https://docs.together.ai/docs/dedicated-inference
- OpenAI 호환: https://docs.together.ai/docs/openai-api-compatibility
- 가격: https://www.together.ai/pricing
- 플레이그라운드(로그인 필요): https://api.together.xyz/playground

---

## 확인이 더 필요한 항목 (로그인 dogfooding 권장)

- 두 제품 플레이그라운드의 **정확한 3분할 레이아웃**, 노출 파라미터 슬라이더 전체 목록
- **LLM 채팅 멀티모델 side-by-side 비교** 실재 여부 (양사 모두 불확실)
- **TPS/지연의 화면 인라인 표시 위치·형식**
- 온디맨드/Dedicated **웹 배포 위저드 단계 화면**
- Fireworks 카탈로그 **정렬 옵션** 유무
- Together 카드의 **구체 단가·모델명**(검색 요약 오염 가능성 → 원본 대조)

> 권장: 실제 로그인 계정으로 `/browse` 또는 인증 세션을 통해 위 항목을 스크린샷 캡처해 본 문서의 "불확실/추측" 표기를 보강하시기 바랍니다.
