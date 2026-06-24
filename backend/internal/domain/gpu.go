package domain

// GPU/MIG 관제(문서 4-4) + MIG 효율 스코어(3-4). 출처: DCGM_FI_DEV_*/DCGM_FI_PROF_*.

// GPUDevice — GPU 1장(또는 MIG 슬라이스) 실측.
type GPUDevice struct {
	Hostname      string  `json:"hostname"`
	Index         string  `json:"gpu"`
	UUID          string  `json:"uuid"`
	Model         string  `json:"model"`
	UtilPerc      float64 `json:"util_perc"`       // 0..1 (DCGM GPU_UTIL/100)
	MemUsedMB     float64 `json:"mem_used_mb"`
	MemTotalMB    float64 `json:"mem_total_mb"`
	MemPerc       float64 `json:"mem_perc"`        // 0..1
	TempC         float64 `json:"temp_c"`
	PowerW        float64 `json:"power_w"`
	SMActive      float64 `json:"sm_active"`       // 0..1 (DCGM_FI_PROF_SM_ACTIVE)
	TensorActive  float64 `json:"tensor_active"`   // 0..1 (PIPE_TENSOR_ACTIVE)
	MIGEfficiency float64 `json:"mig_efficiency"`  // 0..1 (GR_ENGINE_ACTIVE — 3-4 효율 스코어)
}

// GPUSummary — 상단 요약.
type GPUSummary struct {
	TotalGPUs    int     `json:"total_gpus"`
	AvgUtil      float64 `json:"avg_util"`     // 0..1
	AvgMem       float64 `json:"avg_mem"`      // 0..1
	TotalPower   float64 `json:"total_power_w"`
	AvgMIGEff    float64 `json:"avg_mig_eff"`  // 0..1
	Hosts        int     `json:"hosts"`
	IdleAllocGap int     `json:"idle_alloc_gap"` // VRAM 점유(>=50%)인데 util<10% = 유휴 할당 갭 GPU 수 (Run:ai)
	MIGEnabled   bool    `json:"mig_enabled"`    // MIG 파티션 활성 여부(GPU_I_PROFILE 라벨 유무)
}

// GPUPoint — per-GPU 드릴다운 시계열 한 점.
type GPUPoint struct {
	Ts     string  `json:"ts"`
	Util   float64 `json:"util"`    // 0..1
	Mem    float64 `json:"mem"`     // 0..1
	TempC  float64 `json:"temp_c"`
	PowerW float64 `json:"power_w"`
}

// GPUTimeseries — GET /api/v1/gpu/timeseries?uuid= 응답(3단 드릴다운 tier-3).
type GPUTimeseries struct {
	UUID           string     `json:"uuid"`
	Hostname       string     `json:"hostname"`
	Points         []GPUPoint `json:"points"`
	MIGPartitioned bool       `json:"mig_partitioned"` // false = 전체 GPU 모드(파티션 없음)
	Source         string     `json:"source"`          // live | mock
}

// GPUReport — GET /api/v1/gpu 응답.
type GPUReport struct {
	GeneratedAt string      `json:"generated_at"`
	Summary     GPUSummary  `json:"summary"`
	Devices     []GPUDevice `json:"devices"`
	Source      string      `json:"source"` // live | mock
}
