# LLM-aware 인프라 관측 — correlation moat (IMP-50)

## 한 줄 포지셔닝
**LLM이 느린 게 앱인가, GPU인가, 네트워크인가?를 한 콘솔에서.**
경쟁사(Datadog Dependency Map · Kiali · Grafana service graph)는 service edge 를 host/GPU
saturation 과 native 융합하지 않는다. FABRIX Endpoint 는 이미 추적하는 엔티티(endpoint/host)를
join key 로 재사용해 **inference trace ↔ infra saturation 을 한 그래프에서 correlate** 한다.

## 상관 경로(드릴다운·인라인)
새 인프라 데이터 모델을 발명하지 않는다. 기존 화면을 얇은 correlation 레이어로 잇는다.

1. **토폴로지 노드 → 기존 화면 드릴다운** (`web/src/api/correlation.ts::nodeNavTarget`)
   - `service` 노드 → **Traces** (endpoint→model 매핑으로 모델 필터 시드)
   - `gpu` 노드 → **GPU/MIG** 화면 (host 시드)
   - `server` 노드 → **노드 메트릭(USE)** 화면 (host 시드 → 해당 호스트 상세 자동 오픈)
2. **trace ↔ infra 상관 인라인** (`correlateInfra`)
   - 트레이스 상세(SlidePanel)에 "이 요청 시각 GPU/호스트 pressure" 한 줄 요약.
   - endpoint 를 join key 로 토폴로지 service 노드 → 그 host/GPU saturation(mock) 을 표면화.
   - pressure(host/GPU warn·crit) 이면 "지연 원인이 GPU/호스트일 수 있음", 정상이면 "앱/모델 단" 힌트.
   - "인프라 상세로 →" 버튼으로 해당 host 의 골든시그널 화면으로 바로 이동.
3. **골든시그널 표준 4종**(latency/traffic/errors/saturation): bespoke 메트릭 없이 토폴로지 노드
   metrics(qps/error_rate/util/cpu)와 IMP-46(노드 USE)/IMP-49(네트워크)에 연결.

## join key
- `service` 노드 id == 트레이스 `endpoint` == 엔드포인트 이름 (예: `qwen3-32b-router`).
- `server`/`gpu` 노드 id == host (예: `gpu-node-01`, `gpu-node-01/gpu0`).
- endpoint→model 매핑은 `correlation.ts::ENDPOINT_TO_MODEL`(mock.ts ENDPOINTS 와 정합), 미지 값은 graceful passthrough.

## 상태
mock-first. observe(읽기전용)/manage 프로파일 모두에서 네비게이션 가능(읽기 동작). ZERO new deps,
hand-rolled(zero-dep), 라이트 스틸블루. 실 수집 연동 시 topology/노드 메트릭 소스만 교체하면 상관 경로는 그대로 유효.
