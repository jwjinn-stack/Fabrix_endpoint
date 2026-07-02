# IMP-111 Spike — 어시스트+RCA 추론을 인클러스터 LLM 게이트웨이(LiteLLM)로 백킹

> Status: **spike-needed** (다일짜리 인프라 채택). IMP-33(추론 백본 계열)과 공유.
> 전제: 전역 어시스트(IMP-103/110)·AI 원인설명(IMP-95)의 **실 모델 라우팅** 단계.
> 프론트 mock-first(rule-based 폴백)는 이 spike 없이도 buildable — 이건 실행 백본에 한정.

## 왜
어시스트(경량 설명)와 RCA(대형 추론)는 서로 다른 모델·타임아웃·토큰 예산이 필요하다. 각 화면이 Dynamo :8000을 직접 부르면 라우팅·타임아웃·토큰 관측·폴백을 매 표면이 재구현하게 된다. LLM 게이트웨이가 이를 위임한다.

## 후보
| 옵션 | 라이선스 | 비고 |
|---|---|---|
| **LiteLLM (권장)** | MIT | OpenAI-호환 프록시, 모델 라우팅(경량 설명모델 vs 대형 RCA)·타임아웃·재시도·토큰/비용 관측·rate limit, 자체호스팅 |
| 직접 라우팅 | — | 무의존이나 라우팅/관측 재발명 |

## 검증(go/no-go)
1. LiteLLM 인클러스터 배포(Helm/Deployment) + 폐쇄망 이미지 미러링.
2. Dynamo :8000(vLLM OpenAI-호환)을 LiteLLM 백엔드로 등록, 경량/대형 2모델 라우팅.
3. BFF가 어시스트/RCA 요청을 LiteLLM으로 위임(스트리밍 SSE 통과), 프론트 계약(IMP-110) 무변경.
4. 토큰/지연/비용 관측을 기존 관측 스택(Langfuse spike IMP-92)과 연동.
5. observe/manage 프로파일 정합(observe도 읽기 설명은 허용 가능하나 정책 확인).

## 채택 순서
1. Go 조건: 어시스트/RCA 실 모델 수요 확정 + 다중 모델 라우팅 필요 시.
2. LiteLLM 배포 → BFF 위임 → 프론트는 VITE_MOCK=off transport 스왑만(IMP-110 스트리밍 계약 유지).
3. IMP-82 모델 연결 상태 칩이 LiteLLM 헬스/모델 목록을 가리키게.

## 결론
**지금은 no-go(park).** 어시스트는 mock-first(rule-based/glossary 폴백) + 단일 Dynamo 직결(IMP-110)로 먼저. 다중 모델·관측 수요 확정 시 LiteLLM 채택.
