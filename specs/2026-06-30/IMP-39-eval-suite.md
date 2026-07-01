# IMP-39 — 평가 데이터셋·실험·회귀 비교(eval suite)

## 목적
기존 eval 은 단건 LLM-as-judge(model+prompt+criteria → 1~5점)에 그친다. Langfuse/Phoenix 처럼
**데이터셋(고정 테스트 케이스)·실험(데이터셋×고정 config 배치 채점)·회귀 비교(이전 실행 대비 점수 델타)**를
추가해 "프롬프트/모델 바꿨을 때 N개 케이스 점수 변화"를 핵심 가치로 제공한다.

## 비회귀 / SCOPE
- 기존 `POST /api/v1/eval/run` 단건 경로 보존(Eval 탭의 Single).
- mockstore in-memory seam(DataStore 패턴) — ZERO new deps.
- capability 게이트: `Eval` cap(기존 단건과 동일). observe 는 라우트 미등록 → 404.
- IMP-18 ScoreBadge/scoreColor·기존 error/success 토큰 재사용. neon 금지.
- v1 배치는 소량 동기. 대량 async 큐는 후속 — idempotent/resumable 하게 설계만.

## 요구사항 (정제 5)
1. expectedOutput OPTIONAL — reference-free + reference-based 둘 다(golden answer 강제 금지).
2. experiment 레코드에 config 스냅샷 저장(model / prompt-version / judge criteria / dataset version).
3. per-case 매트릭스 + aggregate 행(mean, pass-rate) + run-vs-run per-case + aggregate DELTA.
4. v1 소량 동기, idempotent — 같은 datasetId+config 재실행은 새 run 누적(이전 run 보존, 비교 가능).
5. judge config snapshot — judge 교체 시 비교성 유지(비교 헤더에 judge identity 표시).

## 함수 시그니처

### 도메인 (backend/internal/server/eval.go 또는 eval_suite.go)
```go
type EvalDatasetItem struct {
    ID             string `json:"id"`
    Input          string `json:"input"`
    ExpectedOutput string `json:"expected_output,omitempty"` // OPTIONAL
    Criteria       string `json:"criteria,omitempty"`        // 케이스별 채점 기준(선택)
    Metadata       string `json:"metadata,omitempty"`
}
type EvalDataset struct {
    ID        string            `json:"id"`
    Name      string            `json:"name"`
    Version   int               `json:"version"`     // 아이템 변경 시 증가(스냅샷 기준)
    Items     []EvalDatasetItem `json:"items"`
    CreatedAt string            `json:"created_at"`
    UpdatedAt string            `json:"updated_at"`
}

type ExperimentConfig struct {
    Model         string `json:"model"`
    JudgeModel    string `json:"judge_model"`
    PromptVersion string `json:"prompt_version,omitempty"` // 프롬프트 변형 식별(자유 문자열)
    Criteria      string `json:"criteria"`                 // judge 기준 스냅샷
}
type ExperimentCaseResult struct {
    ItemID    string `json:"item_id"`
    Input     string `json:"input"`
    Response  string `json:"response"`
    Score     int    `json:"score"`     // 0..5 (0=차단/실패)
    Rationale string `json:"rationale"`
    Blocked   bool   `json:"blocked"`
}
type Experiment struct {
    ID            string                 `json:"id"`
    DatasetID     string                 `json:"dataset_id"`
    DatasetName   string                 `json:"dataset_name"`
    DatasetVer    int                    `json:"dataset_version"` // 스냅샷
    Config        ExperimentConfig       `json:"config"`          // 스냅샷
    Cases         []ExperimentCaseResult `json:"cases"`
    MeanScore     float64                `json:"mean_score"`
    PassRate      float64                `json:"pass_rate"` // score>=4 비율
    CreatedAt     string                 `json:"created_at"`
}
```

### seam (sources.go)
```go
type EvalStore interface {
    ListDatasets(ctx) ([]EvalDataset, error)
    CreateDataset(ctx, EvalDataset) (EvalDataset, error)   // id/version/ts 채움
    GetDataset(ctx, id string) (EvalDataset, bool)
    ListExperiments(ctx) ([]Experiment, error)
    SaveExperiment(ctx, Experiment) (Experiment, error)    // id/ts 채움
}
```
mockstore.Store 가 구현. Server 에 `evalStore EvalStore` 필드 추가(nil 가능 → 미구성 시 503).

### 엔드포인트 (Eval cap 게이트)
- `GET  /api/v1/eval/datasets`            → {datasets:[]}
- `POST /api/v1/eval/datasets`            → 생성(name+items 검증, bounded: ≤50 items, input≤8KB)
- `GET  /api/v1/eval/experiments`         → {experiments:[]} (config 스냅샷 포함, 최신순)
- `POST /api/v1/eval/experiments`         → {dataset_id, config} → 케이스별 배치 채점(동기), 저장 후 반환

배치 채점은 기존 judge 로직(parseJudge + catalog.Chat) 재사용. 가드레일 차단 케이스는 score=0/blocked.

### Eval.tsx 탭 구조
- 탭: `Single` / `Datasets` / `Experiments` (간단한 버튼 토글, neon 금지)
- Single = 기존 단건 UI 무수정 이전.
- Datasets = 목록 + 새 데이터셋 생성(name + 케이스 input/expected/criteria 행 추가).
- Experiments = dataset 선택 + config(model/judge/promptVersion/criteria) → 실행. 결과 목록.
  - Experiment 뷰 = case×run 매트릭스(행=케이스, 열=선택된 run) + aggregate(mean/pass-rate) 행.
  - 비교 = 두 run 선택 → per-case score DELTA + aggregate DELTA + regression(▼)/improvement(▲) 플래그.
  - 비교 헤더에 judge identity(model+criteria) 표시 — judge 교체 시 비교성 경고.
  - ScoreBadge scoreColor 재사용.

### client.ts / types.ts
- EvalDataset/EvalDatasetItem/ExperimentConfig/ExperimentCaseResult/Experiment 타입.
- fetchDatasets / createDataset / fetchExperiments / runExperiment.
- mock.ts 라우트 추가(인메모리 DATASETS/EXPERIMENTS).

## 테스트 케이스
- Go: dataset CRUD(생성→목록→get), experiment 배치 채점(케이스 수 = items 수, mean/pass-rate 계산),
  run-vs-run delta(별도 계산 안 함 — FE 책임이나 mean 차이 확인), expectedOutput 옵션(없어도 채점),
  config snapshot 보존, bounded 입력 검증(items 초과 400).
- FE RTL: 탭 전환, dataset 목록 렌더, experiment 매트릭스 렌더, 두 run 비교 시 delta regression(▼) 표시.

## 출력 위치
- backend/internal/server/eval_suite.go (신규), sources.go(EvalStore), server.go(라우트), server.go New(주입)
- backend/internal/mockstore/eval.go (신규) + mockstore.go New seed
- web/src/pages/Eval.tsx (탭 재구성), web/src/api/{types.ts,client.ts,mock.ts}
- 테스트: backend/internal/server/eval_suite_test.go, web/src/pages/Eval.suite.test.tsx

## 의존성
none (ZERO new deps).
