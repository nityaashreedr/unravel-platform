import type { AnomalyReport, CauseRow, ChangePointRow, EvidenceResponse, HealthResponse, RunResponse, UploadResponse } from "./types";

// The Vite dev server proxies /api to the existing FastAPI server. Production
// deployments can set VITE_API_BASE_URL to their same-origin reverse-proxy path.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new Error(`Cannot connect to the Unravel backend at ${API_BASE_URL}.`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : "The backend returned an error.";
    throw new Error(`${response.status}: ${detail}`);
  }
  return payload as T;
}

export const api = {
  health: () => request<HealthResponse>("/health"),
  uploadDataset: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<UploadResponse>("/datasets/upload", { method: "POST", body: form });
  },
  runAnalysis: (uploadId?: string) => request<RunResponse>("/analysis/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(uploadId ? { upload_id: uploadId } : {}),
  }),
  anomalies: (runId: string) => request<{ run_id: string; report: AnomalyReport }>(`/analysis/${encodeURIComponent(runId)}/anomalies`),
  changePoints: (runId: string) => request<{ run_id: string; report: ChangePointRow[] }>(`/analysis/${encodeURIComponent(runId)}/change-points`),
  causes: (runId: string) => request<{ run_id: string; report: CauseRow[] }>(`/analysis/${encodeURIComponent(runId)}/causes`),
  evidence: (runId: string) => request<{ run_id: string; evidence: EvidenceResponse[] }>(`/analysis/${encodeURIComponent(runId)}/evidence`),
};
