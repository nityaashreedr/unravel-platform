export type JsonObject = Record<string, unknown>;

export interface UploadResponse {
  upload_id: string;
  dataset_id?: string;
  name?: string;
  status?: string;
  archive_validation?: string;
  filename: string;
  archive_md5: string;
  authentic_source: string;
  dataset_root: string;
  validation: {
    normal_files: number;
    fault_files: number;
    schema: string[];
  };
}

export interface HealthResponse {
  status: string;
  service: string;
  mode: string;
  default_dataset?: UploadResponse & { dataset_id: string; name: string; status: string; archive_validation: string };
}

export interface RunResponse {
  run_id: string;
  status: string;
  validation: {
    fault_runs: number;
    normal_files: number;
    isolation_rows: number;
    change_point_rows: number;
    ranking_rows: number;
    pelt_timestamps_are_actual_observation_timestamps: boolean;
    reports_match_expected_run_counts: boolean;
  };
}

export interface AnomalyReport {
  normal_train_files: number;
  normal_validation_files: number;
  feature_count: number;
  normal_validation: JsonObject;
  results: Array<JsonObject & { group?: string; method?: string; metrics?: JsonObject }>;
}

export interface ChangePointRow {
  group: string;
  experiment: string;
  run: string;
  cause_start_at: number;
  cause_end_at: number;
  methods: Record<string, {
    detected_change_points: number[];
    onset_detected: boolean;
    detection_delay_s: number | null;
  }>;
}

export interface CauseRow {
  group: string;
  experiment: string;
  run: string;
  true_manipulated_variables: string[];
  ranked_candidates: Array<{
    node: string;
    score: number;
    supporting_evidence: string[];
    evidence_effect_sizes: Record<string, number>;
  }>;
  top1_accuracy: number;
  top3_hit_rate: number;
  top10_recall: number;
  mrr: number;
}

export interface EvidenceResponse {
  group: string;
  experiment: string;
  run: string;
  ranked_candidates: CauseRow["ranked_candidates"];
}
