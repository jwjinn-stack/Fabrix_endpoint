# FABRIX Endpoint 외부 연동 통신 명세

이 문서들은 FABRIX Endpoint **BFF(Go API 서버, `:8080`)** 가 외부 시스템과 **무엇과·어떻게** 통신하는지를 정리한다. 실사이트(고객사 클러스터) 연동 시 각 의존성을 어디에 매칭하고, 어떻게 디버깅·통합하는지의 단일 출처(SSOT)다.

- 코드 기준 작성(추정 아님). 각 항목의 파일·경로·쿼리는 detail 문서 참조.
- 런타임 연결 상태는 코드로도 확인 가능: **`GET /api/v1/diagnostics`** (능동 프로브) — [진단 사용법](#진단-실사이트-연동의-1차-도구) 참조.
- 배포 프로파일(observe/manage)별 필요 의존성은 [프로파일 매트릭스](#프로파일별-필요-의존성) 참조.
- **완결 아키텍처(2-프로파일)**: [../architecture/README.md](../architecture/README.md) — observe(읽기전용)/manage(관리) 두 버전의 평면·통신·배포 단일 출처.

---

## 통신 구조 한눈에

```
브라우저(SPA) ──HTTP──▶ FABRIX BFF (:8080)  ──┬─▶ VictoriaMetrics(vmselect)   메트릭(PromQL)
                          │ 단일 Pod         ├─▶ Dynamo/vLLM 프론트엔드      추론(OpenAI 호환)
                          │                  ├─▶ Semantic Router            가드레일 분류
                          │                  ├─▶ ClickHouse                 증적·사용량(HTTP SQL)
                          │                  ├─▶ MinIO/ObjectScale          WORM 불변 보존(S3)
                          │                  ├─▶ Langfuse                   트레이스/세션(Public API)
                          │                  ├─▶ PostgreSQL(CNPG)           키·앱·사용자
                          │                  ├─▶ Harbor                     모델 레지스트리(v2.0)
                          │                  └─▶ K8s API(kubectl)           엔드포인트 CR 오케스트레이션
```

브라우저는 **오직 BFF 와만** 통신한다(동일 오리진 `/api/v1`). 모든 외부 연동은 BFF 가 대행하므로, 브라우저↔외부 직접 통신·CORS·토큰 노출이 없다. Langfuse 도 자체 UI 가 아니라 BFF 가 Public API 로 받아 우리 화면에 그린다.

---

## 마스터 통신 매트릭스

| 의존성 | 역할 | env (URL) | 프로토콜·포트 | 인증 | 미설정/실패 시 |
|---|---|---|---|---|---|
| **VictoriaMetrics** (vmselect) | 대시보드 실측 메트릭 | `FABRIX_VMSELECT_URL` | HTTP, Prometheus API (`:8481`) | 없음(사설망) | `data_source=mock` 면 합성. live 인데 실패→0 폴백 |
| **Dynamo/vLLM 업스트림** | 플레이그라운드·모델 readiness | `FABRIX_GEMMA_UPSTREAM`(+ 인클러스터 DNS 고정) | HTTP, OpenAI 호환 (`:8000`) | 없음 | 모델 status=unreachable 표시 |
| **Semantic Router** | 가드레일(PII/Jailbreak) 판정 | `FABRIX_SR_URL` | HTTP, REST (`:8080`) | 없음 | 통과(차단 없음) + 한국어 PII 정규식 보강 |
| **ClickHouse** | 가드레일 증적 + 사용량 롤업 | `FABRIX_CLICKHOUSE_URL` | HTTP SQL (`:8123`) | `X-ClickHouse-User/Key` | 증적·롤업 비적재(판정/요청은 정상) |
| **MinIO/ObjectScale** | 증적 WORM 불변 보존 | `FABRIX_WORM_URL` (+`_BUCKET`,`_RETAIN_DAYS`) | S3 (minio-go), Object Lock | AK/SK (V4) | ClickHouse 증적만(불변 보존 없음) |
| **Langfuse** | 트레이스/세션/가드레일 원문 | `FABRIX_LANGFUSE_HOST`/`_PUBLIC_KEY`/`_SECRET_KEY` | HTTP, Public API (`:3000`) | HTTP Basic(public:secret) | synthetic 폴백(화면 안 빔) |
| **PostgreSQL** (CNPG) | 키·앱·사용자(RBAC) | `FABRIX_DATABASE_URL` | TCP, pgx (`:5432`) | URL 내 user:pw | 키·앱·사용자 기능 비활성 |
| **Harbor** | 모델 레지스트리 v2.0 | `FABRIX_HARBOR_URL` | HTTP, REST (`:80/:30834`) | HTTP Basic | 모델 목록/임포트 비활성 |
| **K8s API** | 엔드포인트(DynamoGraphDeployment CR) | `FABRIX_KUBECTL`/`FABRIX_ENDPOINTS_NS` | kubectl exec → API(`:443`) | ServiceAccount + RBAC | 엔드포인트 조회/배포 비활성 |

> 전 의존성이 **graceful**: 미설정이면 해당 기능만 꺼지고 나머지는 정상 동작한다(폴백). 즉 점진적 연동이 가능하다 — 메트릭만 먼저 붙이고, 나중에 ClickHouse·Langfuse·K8s 를 추가해도 된다.

---

## 프로파일별 필요 의존성

[2-프로파일 배포](../../) — `observe`(읽기 전용 관제, 예: 삼성증권) / `manage`(풀버전). capability 가 꺼진 의존성은 애초에 호출되지 않는다.

| 의존성 | observe(읽기 관제) | manage(풀) | 비고 |
|---|---|---|---|
| VictoriaMetrics | ✅ (live 일 때) | ✅ | `dashboard` cap |
| Langfuse | ✅ | ✅ | `traces` cap — 양쪽 핵심 |
| Semantic Router | ✅ 조회(증적) | ✅ 조회+정책변경 | `guard` / `guard.write` |
| ClickHouse(증적) | ✅ 조회 | ✅ | `guard` |
| ClickHouse(사용량) | ✅ | ✅ | `dashboard` |
| Dynamo 업스트림 | △ 모델 상태표시 | ✅ 플레이그라운드 | `models` / `playground` |
| Harbor | △ 조회(옵션) | ✅ 임포트 | `models` / `models.write` |
| PostgreSQL | ✕ 기본(옵션 켜면 조회) | ✅ 키·RBAC | `keys`/`users` |
| K8s API | ✕ 기본(옵션 켜면 목록) | ✅ 배포 | `endpoints`/`endpoints.write` |
| MinIO WORM | ✅ (증적 보존) | ✅ | `guard` |

observe 기본은 메트릭·트레이스·가드레일조회·모델조회만 받쳐주면 된다. 고객사별로 `FABRIX_FEATURES=+endpoints,+keys` 로 읽기 화면을 추가하면 해당 의존성도 함께 필요해진다.

---

## 진단: 실사이트 연동의 1차 도구

연동이 "되는지"를 추측하지 말고 **코드로 확인**한다.

### 1) `GET /api/v1/capabilities` — 설정 여부(얕음)
프로파일·활성 기능 + `integrations`(각 의존성 env 구성 여부 boolean). 부팅 시 프론트가 받아 메뉴를 토글.

### 2) `GET /api/v1/diagnostics` — 실제 연결성(능동 프로브, 깊음)
이 Pod 에서 각 의존성에 **실제로 read-only 프로브를 보내** 결과를 반환한다. 연동 디버깅의 핵심.

```bash
kubectl exec -it deploy/fabrix-endpoint -- wget -qO- localhost:8080/api/v1/diagnostics | jq
# 심층 진단(클라이언트별 Details 추가 왕복):
curl -s 'localhost:8080/api/v1/diagnostics?verbose=1' | jq '.summary, .network, (.checks[] | {name,reachable,fail_kind,timing})'
```

응답 예(일부 — 통신 디버깅 필드 포함):
```json
{
  "summary": {"total":10,"configured":6,"reachable":5,"degraded":1},
  "network": {
    "in_cluster": true,
    "api_server": "10.96.0.1:443",
    "kube_dns": ["10.96.0.10"],
    "search_domains": ["fabrix.svc.cluster.local","svc.cluster.local"],
    "no_proxy": ".svc,.cluster.local",
    "proxy_warnings": [],
    "hosts": [
      {"name":"harbor","env_key":"FABRIX_HARBOR_URL","scheme":"https","host":"harbor-core","port":"443","resolved":["10.96.50.8"],"latency_ms":3}
    ]
  },
  "checks":[
    {"name":"harbor","configured":true,"reachable":true,"latency_ms":33,"fail_kind":"ok",
     "remote_addr":"10.96.50.8:443",
     "timing":{"dns_ms":2,"connect_ms":7,"tls_ms":11,"ttfb_ms":31,"server_ms":11,"total_ms":33,"reused":false},
     "tls":{"version":"TLS 1.3","issuer":"FABRIX Internal CA","subject":"harbor-core.fabrix.svc","not_after":"2026-09-22T00:00:00Z","days_left":86},
     "required_by":["models","models.write"]},
    {"name":"semantic_router","configured":true,"reachable":false,"latency_ms":3001,"fail_kind":"conn_refused",
     "error":"dial tcp ...:8080 connect: connection refused","required_by":["guard","guard.write"]}
  ]
}
```

- `configured` = env 구성됨. `reachable` = 실제 연결 성공. `degraded` = 구성됐는데 도달 불가(=진짜 문제).
- **`fail_kind`** = 실패 원인 분류(`dns_fail`·`conn_refused`·`tls_fail`·`auth_fail`·`timeout`·`bad_status`·`ok`) — 조치가 종류마다 다름([통신디버깅-런북.md](./통신디버깅-런북.md) §1).
- **`timing`** = HTTP 프로브 단계 분해(DNS→TCP→TLS→서버). **`tls`** = 인증서 발급자·만료(남은 일). **`remote_addr`** = 실제 연결된 IP. **`history`** = 최근 추세(sparkline).
- **`network`** = 파드 레벨 점검(이름 해석·resolv.conf·in-cluster·프록시·env→호스트). 프로브 던지기 전 설정 오류를 잡는다.
- 프로브는 전부 **read-only**(상수 PromQL, `SELECT 1`, `BucketExists`, `traces?limit=1`, `kubectl get --raw=/healthz` 등) — 자격증명은 응답에 노출되지 않는다(`endpoint`·프록시 URL redact). `httptrace` 를 ctx 에 주입해 프로브 코드 변경 없이 단계 타이밍/TLS 수집.
- 프론트 **"연동 상태"** 화면이 이를 시각화: 단계 막대·실패 원인 배지·"통신 상세" 확장·sparkline·상단 "네트워크·설정 점검" 패널·"심층 진단" 토글.
- **`request`** = 그 프로브가 API 에 실제로 보내는 요청 명세(method·target·auth·body·expect, 코드와 1:1). "통신 상세"에서 *무슨 요청을 보내고 API 와 매칭되는지* 확인.
- **단일 라이브 재프로브**: `GET /api/v1/diagnostics/{name}` — 의존성 1개만 즉시 재호출("지금 테스트", read-only·양 프로파일). 화면의 [지금 테스트] 버튼이 호출 → 응답/계약(✓/✗)·단계·지연을 인라인 갱신.
- **`probe`** = 단일 재프로브의 **실제 요청/응답 캡처**(`req_method/req_url/req_headers/req_body/status_code/resp_headers/resp_body`). `httpx` RoundTripper 래핑으로 HTTP 클라이언트에서 수집(자격증명·키 헤더는 `***`, 본문 2KB 캡). 비-HTTP(pgx·kubectl·MinIO)는 본문 없음. 화면 **"통신 검사" 드로어**(개요/요청/응답/타이밍/이력 탭, Chrome DevTools Network 스타일)가 시각화.

### 연동 매칭 절차(권장)
1. Pod 띄우고 `/diagnostics` 호출 → `configured` 가 기대와 맞는지(=env 주입 확인).
2. `reachable:false && configured:true`(degraded) 항목의 `error` 로 원인 분류:
   - `connection refused`/`no such host` → Service DNS·포트·NetworkPolicy egress 점검.
   - `401/403`/`auth` → 자격증명(Secret) 점검.
   - `context deadline exceeded` → 방화벽 블랙홀 또는 과부하.
3. 고친 뒤 화면 "재검사" 또는 `/diagnostics` 재호출로 녹색 확인.

---

## K8s 배포 노트(Pod)

- **단일 이미지**. 프로파일은 env 로만 전환: `FABRIX_PROFILE=observe|manage`, `FABRIX_FEATURES=+endpoints,...`.
- **자격증명은 Secret 으로 주입**(URL 에 user:pw 가 들어가는 ClickHouse/Harbor/PostgreSQL/MinIO). 로그·진단에는 redact 되어 노출되지 않지만, env 자체는 Secret 으로.
- **NetworkPolicy egress**: BFF Pod 가 위 9개 대상(각 네임스페이스·포트)으로 나가야 한다. detail 문서의 인클러스터 DNS·포트를 allow 목록에 넣는다.
- **엔드포인트(K8s API) 연동**: dev 는 kubectl 셸아웃, 인클러스터는 ServiceAccount + RBAC(DynamoGraphDeployment CR get/create/delete, Pod logs, `/healthz` nonResourceURL get). detail 문서 참조.
- **observe 배포는 mutating egress 가 거의 없다**: 읽기 전용이므로 K8s write·Harbor import·PostgreSQL write 가 불필요(보안 단순화).

### 전체 env 레퍼런스
| env | 기본값 | 의미 |
|---|---|---|
| `FABRIX_PROFILE` | `manage` | 배포 프로파일 observe/manage |
| `FABRIX_FEATURES` | (빈값) | cap 미세조정 `+cap,-cap` |
| `FABRIX_API_ADDR` | `:8080` | 리슨 주소 |
| `FABRIX_ALLOWED_ORIGINS` | `http://localhost:5173` | CORS(동일오리진 배포면 불필요) |
| `FABRIX_DATA_SOURCE` | `mock` | `mock`/`live` — live 면 vmselect 조회 |
| `FABRIX_VMSELECT_URL` | (인클러스터 기본) | VictoriaMetrics Prometheus API |
| `FABRIX_GEMMA_UPSTREAM` | (인클러스터 기본) | Dynamo gemma 프론트엔드 OpenAI URL |
| `FABRIX_SR_URL` | (빈값=비활성) | Semantic Router |
| `FABRIX_CLICKHOUSE_URL` | (빈값=비활성) | ClickHouse(증적+사용량 공유) |
| `FABRIX_WORM_URL`/`_BUCKET`/`_RETAIN_DAYS` | (빈값)/`fabrix-worm`/`365` | MinIO Object Lock |
| `FABRIX_LANGFUSE_HOST`/`_PUBLIC_KEY`/`_SECRET_KEY` | (빈값=synthetic) | Langfuse Public API |
| `FABRIX_DATABASE_URL` | (빈값=비활성) | PostgreSQL(CNPG) |
| `FABRIX_HARBOR_URL` | (빈값=비활성) | Harbor v2.0 |
| `FABRIX_KUBECTL`/`FABRIX_ENDPOINTS_NS` | `kubectl`/`dynamo-inference` | 엔드포인트 CR |
| `FABRIX_AUDIT_SALT`/`FABRIX_POLICY_VERSION` | dev값/`v1` | 증적 해시 솔트·정책 버전 |

---

## Detail 문서
| 문서 | 의존성 |
|---|---|
| [metrics-victoriametrics.md](metrics-victoriametrics.md) | VictoriaMetrics(메트릭) |
| [dynamo-upstream.md](dynamo-upstream.md) | Dynamo/vLLM 추론 업스트림 |
| [semantic-router.md](semantic-router.md) | Semantic Router(가드레일) |
| [clickhouse.md](clickhouse.md) | ClickHouse(증적·사용량) |
| [minio-worm.md](minio-worm.md) | MinIO/ObjectScale(WORM) |
| [langfuse.md](langfuse.md) | Langfuse(트레이스/세션) — BFF 연동 현황 |
| [langfuse-api.md](langfuse-api.md) | Langfuse Public API 능력 카탈로그(ingestion/scores/prompts/…) |
| [langfuse-mcp.md](langfuse-mcp.md) | Langfuse MCP 서버 도구·설정(디버깅용) |
| [k8s-otel-langfuse-연동.md](k8s-otel-langfuse-연동.md) | K8s에서 app→SR→vLLM을 OTEL로 Langfuse 모니터링(설치~설정, 교차검증) |
| [postgresql.md](postgresql.md) | PostgreSQL(키·앱·사용자) |
| [harbor.md](harbor.md) | Harbor(모델 레지스트리) |
| [kubernetes.md](kubernetes.md) | K8s API(엔드포인트 CR) |
