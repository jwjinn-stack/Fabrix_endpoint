# 기능: CI 회귀 게이트 (go test·tsc·lint·프론트 테스트)

## 목적
유일 워크플로우가 docker build/push 뿐 — go test/vet/tsc/npm test/lint 0건. 백엔드 테스트 12+개가 PR에서 안 돌고 프론트는 tsc조차 게이트 안 됨. 폐쇄망 금융 제품에서 무게이트 머지는 품질 리스크.

## 요구사항
- `.github/workflows/ci.yml`(신규, pull_request 트리거): backend(go vet+test), web(npm ci+tsc --noEmit+lint+test) 병렬 잡.
- `build-and-push.yml`: `checks` 잡 추가(동일 검증) + `build: needs: checks` → main 푸시 이미지 빌드도 게이트 통과 후에만.
- IMP-13(프론트 test/lint)이 선결 — 이번에 함께 done.
- main 보호 규칙에 ci 필수 체크 등록은 GitHub 설정(레포 admin) 후속.

## 테스트 케이스
- 로컬 검증: `cd backend && go vet ./... && go test ./...` 통과, `cd web && tsc --noEmit && npm run lint && npm test` 통과.
- YAML 문법 유효.

## 출력 위치
- `.github/workflows/ci.yml`(신규), `.github/workflows/build-and-push.yml`(checks 게이트).

## 의존성
- IMP-13(프론트 러너·린터).
