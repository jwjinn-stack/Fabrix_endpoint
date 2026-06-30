# IMP-33 스파이크 플랜 — LiteLLM Proxy 추론 데이터플레인 채택 (사람이 실행)

> **상태: `spike-needed`** — 이것은 코드 PR이 아니라 **다일짜리 인프라/운영 채택**이다. LiteLLM Proxy를
> 클러스터에 **새 서비스(별도 Deployment = pod)** 로 띄우고(Helm + Postgres + Redis), air-gapped라
> Harbor로 이미지를 미러링해야 한다. 자율 빌드 대상이 아니며, 이 문서를 따라 **사람이 1주 PoC로
> 실행**한다. (분류: platform · sensitive=인증/과금/추론 데이터플레인.)

## 왜 코드 PR이 아닌가
- 코드 한 줄을 고치는 변경이 아니라 **인프라 채택**이다: 별도 K8s Deployment(pod), Postgres(키/예산
  state), 선택 Redis(rpm/tpm 공유), 공식 Helm chart, air-gapped Harbor 이미지 미러·digest 검증.
- 실제 추론 트래픽·키·예산이 걸린 **데이터플레인**이라 라이브 검증(예산 강제·fallback·trace 귀속)이
  필수 → 무인 빌드 부적합. 1주 PoC + 사람 검토.

## 결정 (oss-evaluate 2026-06-30, 검증 완료)
**LiteLLM Proxy(BerriAI)를 enforcement engine으로 ADOPT, governance product로는 비채택.** FABRIX
자체 plane이 키 발급·profile/capability 게이팅·audit·가드레일의 **system-of-record(authoritative)**.
- riskiest 라이선스 주장(virtual keys·per-key/team/user 예산·spend tracking·100+ provider 라우팅·
  load-balancing·retry/fallback이 전부 **MIT·self-host $0**) → 검증 통과(HELD).
- 성숙도 압도적 1위(52.1k★, 1,676 contributors, v1.90.0, 공식 Helm + 커뮤니티 operator).

## SPLIT-PLANE 조립 (단일 ADOPT, governance는 BUILD/KEEP)
- **LiteLLM에서 ADOPT**: multi-provider 라우팅·load-balancing·retry/fallback·per-key/team/user 예산·
  spend tracking (MIT/$0).
- **FABRIX Go BFF+plane에서 BUILD/KEEP**(전부 LiteLLM Enterprise-gated → 인하우스 유지가 MIT 보전):
  키 발급 + virtual-key 레지스트리(source-of-truth)·profile/capability 게이팅(observe RO vs manage)·
  audit·가드레일·SSO/SCIM·key rotation.
- **흐름**: FABRIX가 자체 plane에서 키 발급 → LiteLLM key API로 provision/sync → LiteLLM이 예산/라우팅
  강제 → FABRIX plane이 system-of-record.
- **DATA-PATH**: LiteLLM = 별도 K8s Deployment(공식 /helm + Postgres(+Redis HA)). BFF가 catalog.go
  라우팅 재구현 중단, LiteLLM OpenAI 호환 HTTP를 백엔드로 호출하며 요청마다 virtual key 주입.
- **OBSERVABILITY**: `callbacks:["langfuse_otel"]`+`LITELLM_OTEL_V2=true`로 per-request trace를 기존
  Langfuse 정합 plane으로. **Prometheus 메트릭은 Enterprise-gated → 의존 금지, 자체 스크레이프.**
- **MCP 미교체**: FABRIX 수기 MCP JSON-RPC 유지(본 채택 범위 밖, IMP-9 별도).

## 채택 순서 (1주 PoC)
1. **[HARD GATE 先]** Harbor 미러 + digest-verify + **pin >= 1.83.0**(절대 1.82.7/8 금지 — 2026-03
   PyPI 공급망 compromise). cosign 서명 이미지, 클러스터 내 live pull 금지(Helm chart·Postgres 동일).
2. **manage 프로파일만** BFF 뒤에 LiteLLM 기동(소수 provider + fallback chain).
3. FABRIX-plane 키 발급 → LiteLLM key provision 배선, **예산 강제 동작 확인**.
4. Langfuse OTel 콜백 on, **trace 안착 확인**(auth→routing→LLM→DB write, session-id/tags).
5. catalog.go 라우팅을 LiteLLM 위임으로 전환.
6. observe 프로파일 RO 확장.
7. **[병행]** Envoy AI Gateway(Apache-2.0) 러너업 스파이크를 non-prod에서 돌려 open-core 경계 거부 시
   폴백 검증.

## 위협 모델 / 리스크 (go/no-go)
- **공급망(고)**: 입증된 PyPI compromise(1.82.7/8) → pin·digest-verify·cred 회전 **비협상**. 해당 버전
  구동 이력 있으면 credential/K8s-secret 회전.
- **라이선스 워치(주)**: MIT-$0는 keys/budgets/routing/fallback 범위 내에서만 성립. audit-log 보존·
  SSO>5users·SCIM·자동 key rotation·Prometheus·prompt-injection 가드레일 콜백 요건 발생 즉시
  Enterprise-gated로 $0 붕괴 → 이들은 **FABRIX plane에 유지**. 업그레이드마다 LICENSE/enterprise 경계 재감사.
- **2차 source-of-truth 위험**: 게이트웨이 자체 키/예산 admin이 FABRIX quota.Limiter/app-attribution과
  충돌 가능 → **FABRIX plane authoritative, 게이트웨이는 synced enforcement target으로만.**
- **스택 이물질**: Go-stdlib zero-runtime-dep 백엔드에 Python 런타임 + Postgres 주입(운영 부담).

## 후보 매트릭스
- **LiteLLM Proxy = ADOPT** (catalog.go:150 갭을 MIT $0 + 최고 K8s 툴링으로; pin>=1.83.0 + Harbor digest-verify; fit 8)
- **Envoy AI Gateway = CONSIDER(spike)** (완전 Apache-2.0·CNCF multi-vendor = open-core 거부 시 폴백; v1.0 신생·통합 무거움; fit 6.5)
- **Bifrost(Maxim) = CONSIDER(신중)** (Apache-2.0 + Go 일치이나 beta·adopter 0; spike only; fit 5)
- **Portkey Gateway = CONSIDER(좁게)** (MIT reliability+가드레일 프록시로 BFF 앞단만; governance plane 대체 불가; fit 6)

## 사람 승인 체크리스트 (코드/배포 전)
- [ ] Harbor에 LiteLLM 이미지(>=1.83.0) digest-pin 미러 + cosign 검증 구성 완료
- [ ] manage 프로파일 한정 기동 범위 합의 (observe는 후순위)
- [ ] FABRIX plane이 키/예산 system-of-record라는 경계 확정 (게이트웨이는 sync target)
- [ ] Enterprise-gated 기능 목록을 FABRIX 자체 plane 유지로 못박아 MIT 잔류 확인
- [ ] Postgres/Redis 운영 주체·백업·폐쇄망 네트워크 정책 확정
- [ ] 1주 PoC 성공 기준 정의: 예산 강제 1건 + fallback 1건 + trace 귀속 1건 end-to-end

## 출처
- https://docs.litellm.ai/docs/proxy/deploy , https://github.com/BerriAI/litellm/blob/main/LICENSE
- https://github.com/PalenaAI/litellm-operator , https://konghq.com/blog/enterprise/kong-ai-gateway-vs-litellm
