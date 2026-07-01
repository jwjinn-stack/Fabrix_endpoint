# IMP-42 스파이크 플랜 — 트레이스 수집을 OpenTelemetry(OTLP + Collector)로 표준화 (사람이 실행)

> **상태: `spike-needed`** — OTel Collector + ClickHouse는 클러스터에 새 서비스를 배포하는 인프라 채택이라
> 코드 PR이 아니다. 또한 이 항목은 아직 **미연구(proposed)** — 채택 전 `oss-evaluate`로 비용/경계를 정량화해야 한다.

## 문제
`backend/internal/langfuse/`(synth.go, client.go)는 트레이스/스팬을 자체 스키마로 합성·매핑한다. 실데이터로 가면
LLM SDK·게이트웨이가 내보내는 트레이스를 표준 포맷으로 받아야 하는데, **OpenTelemetry GenAI semantic conventions
+ OpenLLMetry**가 사실상 업계 표준이고 Langfuse/Phoenix/Datadog 모두 OTLP를 수용한다. 자체 스키마 고수 시 신규 소스마다
어댑터를 손으로 만들어야 한다.

## 제안 방향 (oss-evaluate로 검증 필요)
- **OpenTelemetry Collector(Apache-2.0)**를 in-cluster 배포, BFF가 OTLP 트레이스를 받거나
  (Collector → ClickHouse 저장소 → BFF read) 내부 trace 모델로 매핑하는 어댑터를 둔다.
- **GenAI semantic conventions(`gen_ai.*` 속성)** + **OpenLLMetry(Apache-2.0)** instrumentation 채택 →
  Playground/프록시 경로가 표준 스팬 방출.
- 저장은 **ClickHouse(Apache-2.0)**(Langfuse·Phoenix가 쓰는 트레이스 백엔드)로 → **IMP-32 full-text 검색**과 연결.
- air-gapped 친화(전부 self-host). **절충**: 외부 표준을 입력으로 받되 UI/도메인 모델은 유지.

## 의존 / 연관
- **IMP-32**(트레이스 전문검색): 실 ClickHouse 도입 시 검색 컬럼 allowlist(마스킹 원문 배제)를 여기서 함께 확정.
- **IMP-41**(Prometheus 백본): 메트릭은 Prometheus, 트레이스는 OTel/ClickHouse — 관측 3축(metric/trace/log) 중 trace 축.
- air-gapped Harbor 이미지 미러링은 IMP-33/41과 동일 패턴.

## 사람 확인 체크리스트 (oss-evaluate + 배포 전)
- [ ] `oss-evaluate`로 OTel Collector vs 직접 OTLP 수신, ClickHouse 도입 비용(운영·스토리지) 정량화
- [ ] GenAI semantic conventions 버전 고정 + OpenLLMetry 라이선스/공급망 확인
- [ ] ClickHouse를 클러스터에 둘지(고객 운영 여부) — IMP-41 P0와 유사한 소유 경계 결정
- [ ] 내부 trace 도메인 모델 ↔ OTLP 매핑 어댑터 범위(현 langfuse synth 경로 대체 단계)
- [ ] air-gapped 이미지(Collector·ClickHouse) Harbor 미러 + digest 검증

## 출처 (oss-evaluate 단계에서 1차 출처 확보)
- OTel GenAI semantic conventions · OpenLLMetry · ClickHouse (미연구 — 채택 결정 전 정량화)
