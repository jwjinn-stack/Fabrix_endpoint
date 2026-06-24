#!/usr/bin/env bash
# FABRIX Endpoint — dev 백엔드 기동 (실데이터 연동)
# 통신: vmselect·gemma·ClickHouse 는 NodePort(항상 통신). SR·PG 는 견고한 port-forward
#       (연결 확인 + 죽으면 자동 복구하는 keeper). 환경변수 export 후 Go API 실행.
# 사용: scripts/dev-up.sh         (백엔드 실행 + keeper)
#       scripts/dev-up.sh pf      (포트포워드/keeper만)
set -euo pipefail
cd "$(dirname "$0")/.."

# 로컬 비밀(커밋 금지). DB URL 등 — .gitignore 등록됨.
if [ -f .env.dev.local ]; then set -a; . ./.env.dev.local; set +a; fi

NODEIP="${FABRIX_NODE_IP:-192.168.160.43}"

# ensure_pf — 포트가 실제로 응답하는지 확인하고, 죽었으면 재기동(stale 프로세스 정리 포함).
ensure_pf() {
  local name="$1" ns="$2" svc="$3" lp="$4" rp="$5"
  if nc -z localhost "$lp" >/dev/null 2>&1; then return 0; fi   # 살아있으면 통과
  pkill -f "port-forward.*${svc}.*${lp}:${rp}" 2>/dev/null || true
  nohup kubectl port-forward -n "$ns" "svc/$svc" "$lp:$rp" >"/tmp/pf-${name}.log" 2>&1 &
  disown || true
  echo "port-forward ↻ ${name} (${lp}:${rp})"
}

# pf_keeper — 백그라운드로 SR/PG port-forward 를 20초마다 점검·복구(이동/슬립 후에도 통신 유지).
pf_keeper() {
  while true; do
    ensure_pf sr vllm-semantic-router-system semantic-router 18080 8080
    ensure_pf pg fabrix-endpoint             fabrix-pg-rw    5432  5432
    sleep 20
  done
}

ensure_pf sr vllm-semantic-router-system semantic-router 18080 8080
ensure_pf pg fabrix-endpoint             fabrix-pg-rw    5432  5432
# keeper 가 이미 돌고 있지 않으면 시작
if ! pgrep -f "fabrix-pf-keeper" >/dev/null 2>&1; then
  ( exec -a fabrix-pf-keeper bash -c "$(declare -f ensure_pf pf_keeper); pf_keeper" ) >/tmp/pf-keeper.log 2>&1 &
  disown || true
  echo "pf-keeper ↑ (SR·PG 20s 자동복구)"
fi
sleep 2

export FABRIX_DATA_SOURCE="${FABRIX_DATA_SOURCE:-live}"
export FABRIX_VMSELECT_URL="${FABRIX_VMSELECT_URL:-http://${NODEIP}:30401/select/0/prometheus}"
export FABRIX_GEMMA_UPSTREAM="${FABRIX_GEMMA_UPSTREAM:-http://${NODEIP}:30812}"
export FABRIX_SR_URL="${FABRIX_SR_URL:-http://localhost:18080}"
# ClickHouse 는 NodePort 30123(항상 통신, port-forward 불필요).
export FABRIX_CLICKHOUSE_URL="${FABRIX_CLICKHOUSE_URL:-http://fabrix:fabrix_dev@${NODEIP}:30123}"
export FABRIX_AUDIT_SALT="${FABRIX_AUDIT_SALT:-fabrix-dev-salt}"
export FABRIX_POLICY_VERSION="${FABRIX_POLICY_VERSION:-v1}"
# WORM 불변 보존(MinIO Object Lock, NodePort 30903)
export FABRIX_WORM_URL="${FABRIX_WORM_URL:-http://fabrixadmin:fabrix_worm_dev@${NODEIP}:30903}"
export FABRIX_WORM_BUCKET="${FABRIX_WORM_BUCKET:-fabrix-worm}"
# DB(키·앱)는 비밀번호 필요 시 FABRIX_DATABASE_URL 로 주입. 미설정이면 키 기능만 비활성.
[ -n "${FABRIX_DATABASE_URL:-}" ] && export FABRIX_DATABASE_URL

if [ "${1:-}" = "pf" ]; then echo "포트포워드/keeper 준비 완료."; exit 0; fi

# :8080 점유 프로세스 종료(go-build 캐시 바이너리는 cmd/api 패턴으로 안 잡힘 → 포트 기준).
PORT_PID="$(lsof -nP -iTCP:8080 -sTCP:LISTEN -t 2>/dev/null || true)"
if [ -n "$PORT_PID" ]; then echo ":8080 점유 PID 종료: $PORT_PID"; kill $PORT_PID 2>/dev/null || true; sleep 1; fi

echo "백엔드 시작 (:8080, data=${FABRIX_DATA_SOURCE})"
cd backend
exec go run ./cmd/api
