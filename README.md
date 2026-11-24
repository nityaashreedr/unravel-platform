# Unravel backend — causRCA performance-audited pipeline

This repository contains only the Unravel backend analysis through Phase 5. It uses the authentic causRCA release and preserves the original archive and extraction.

## Architecture

`src/unravel_pipeline.py` loads long-form observations (`time_s,node,value,type`), pivots them into timestamp-by-variable matrices, and runs provenance/inventory, preprocessing, sensor visualisation, normal-only anomaly detection, change-point detection with onset-delay evaluation, and graph-constrained evidence extraction and candidate-cause ranking.

The expert graph comes from the supplied `all_nodes.csv` and `all_edges.csv`. Candidate causes are restricted to graph input nodes supported by observed evidence. Experiment descriptions provide manipulated variables only for evaluation, never for model fitting or inference.

## Dataset provenance

The data are [causRCA 1.0.0 on Zenodo](https://doi.org/10.5281/zenodo.15876410), with the official GitHub repository snapshot preserved separately. The archive MD5 is checked against the Zenodo record in `outputs/reports/dataset_inventory.json`. The extraction contains 170 normal-operation recordings and 100 fault recordings: coolant 25, hydraulics 41, probe 34.

## Methodology

Isolation Forest is fitted only on 80% of normal-operation files (133 files). Its anomaly threshold is the 99th percentile of scores on the remaining 34 normal-operation files. A robust IQR score is reported as a baseline with the same validation-only threshold selection. Fault cause windows are used only after inference to calculate precision, recall, F1, PR-AUC, and confusion matrices.

Change points are evaluated against documented `cause_start_at` and `cause_end_at`. The reports include whether onset was detected and the delay from onset. Both Binseg and PELT are run.

Cause ranking compares early-history versus late-observation effect sizes, propagates evidence through the expert directed graph, and reports Top-1 accuracy, Top-3 hit rate, Top-10 recall, and MRR over all 100 fault runs. This is evidence ranking, not causal identification.

## Reproduce

```powershell
& C:\Users\Nityaashree\anaconda3\python.exe -m pip install -r requirements.txt
& C:\Users\Nityaashree\anaconda3\python.exe src\unravel_pipeline.py --phase all
& C:\Users\Nityaashree\anaconda3\python.exe -m pytest -q
```

Reports are in `outputs/reports/`; figures are in `outputs/figures/`; model score artifacts are in `outputs/artifacts/`.

## Audited results

The previous implementation scored a model trained on the same fault run and selected its threshold from that test run. Its reported F1 was coolant 0.000, hydraulics 0.028, probe 0.000, and its Top-10 ranking recall was coolant 0.50, hydraulics 0.00, probe 0.00.

The corrected evaluation uses 100 fault runs with normal-only training and held-out normal threshold calibration. The corrected results remain difficult: Isolation Forest mean F1 is coolant 0.000, hydraulics 0.0003, probe 0.000; robust-IQR mean F1 is coolant 0.0090, hydraulics 0.0112, probe 0.0035. This is reported without tuning against fault labels or overstating performance. PELT detected onset within the documented interval on all 100 runs, with mean delay 3.79 seconds; Binseg did so on 96/100 runs with mean delay 32.28 seconds.

Ranking improved after graph restriction: mean Top-10 recall is coolant 0.567, hydraulics 0.439, probe 0.824. Mean Top-1 accuracy is coolant 0.000, hydraulics 0.342, probe 0.235. These results are observational and should not be interpreted as proof of causal discovery.

## Limitations

The cause window records the documented manipulation interval, not necessarily the first observable symptom. Normal operation contains multiple machine regimes, so a single global detector is conservative. The supplied timestamps reflect OPC UA publication timing and are not guaranteed to establish cross-variable causal order.

## Final backend validation

The complete pipeline was executed twice after fixing nondeterministic candidate-ranking serialization. SHA-256 hashes matched for all generated reports. The final validation report is `outputs/reports/final_backend_validation.json`.

PELT produced an actual observation timestamp after the documented onset on 100/100 fault runs. Mean delay was 3.795 seconds, with a range of 0 to 13.961 seconds. This validates onset timing against the supplied timestamps; it does not prove physical causation.

On 47,920 held-out normal-operation observations, Isolation Forest produced 480 false positives (1.002%) and the robust-IQR baseline produced 623 (1.300%). Isolation Forest mean F1 remained 0.000 for coolant, 0.0003 for hydraulics, and 0.000 for probe under the leakage-safe protocol.

The final candidate set contained 36 expert-graph input nodes, and all 14 distinct documented manipulated variables were valid members of that set. Ranking metrics were computed over all 100 fault runs. The five-test suite passes. No raw dataset files were modified, and no fault labels were used for fitting or threshold selection.

## Phase 6 API integration

The FastAPI layer is implemented in `src/api/main.py`. It does not duplicate analysis logic: `/analysis/run` launches the existing `src/unravel_pipeline.py` CLI with `UNRAVEL_DATA_DIR` and `UNRAVEL_OUTPUT_DIR` set to an isolated per-run directory. The validated baseline under `outputs/` is therefore not overwritten.

Start the API from the project root:

```powershell
& C:\Users\Nityaashree\anaconda3\python.exe -m uvicorn src.api.main:app --host 0.0.0.0 --port 8000
```

Endpoints:

- `GET /health`
- `POST /datasets/upload` — accepts and validates a causRCA-style ZIP archive
- `POST /analysis/run` — executes the complete existing pipeline in an isolated run directory
- `GET /analysis/{run_id}/anomalies`
- `GET /analysis/{run_id}/change-points`
- `GET /analysis/{run_id}/causes`
- `GET /analysis/{run_id}/evidence`

Uploaded archives are stored under `api_storage/uploads/` and run outputs under `api_storage/runs/`. This is filesystem storage only; no database, authentication, frontend, cloud deployment, synthetic data, or fabricated records were added.

## Phase 7 frontend integration

The React + Vite frontend is in `frontend/`. It uses the existing API without changing endpoint names, request schemas, response schemas, or analysis algorithms. `frontend/src/api.ts` is the central API service; `frontend/src/App.tsx` renders the overview, upload, analysis, anomaly, change-point, candidate-cause, and evidence views.

The development server proxies `/api/*` to `http://127.0.0.1:8000/*` so the browser can call the existing FastAPI service without adding backend CORS changes. The default API base is `/api`; it can be overridden with `VITE_API_BASE_URL` in a local `.env` file. The frontend displays only values returned by the backend. Counts are explicitly labelled as report rows or ranked entries where the API does not provide a distinct event count.

Start the backend in one PowerShell window from the project root:

```powershell
& C:\Users\Nityaashree\anaconda3\python.exe -m uvicorn src.api.main:app --host 0.0.0.0 --port 8000
```

Install and start the frontend in a second PowerShell window. The repository includes the frontend lockfile. If Node.js is not installed globally, the commands below use the project-local portable Node runtime used for validation:

```powershell
Set-Location frontend
$nodeHome=Join-Path (Resolve-Path '..') 'tools\node\node-v22.23.5-win-x64'
$env:Path="$nodeHome;$env:Path"
& (Join-Path $nodeHome 'npm.cmd') install
& (Join-Path $nodeHome 'npm.cmd') run dev -- --host 0.0.0.0 --port 5173
```

Open `http://127.0.0.1:5173/` locally, or use the laptop IPv4 address from another device. Upload the authentic causRCA ZIP, start an analysis, and use the navigation to inspect the backend-produced anomalies, change points, candidate hypotheses, and traceable evidence. The current backend runs analysis synchronously; the UI keeps the processing state visible until that request returns. There is no separate backend completion-status endpoint, so the frontend does not invent one.

Frontend validation completed with `npm run build`, the existing backend suite (`10 passed`), and a browser workflow against the live API: authentic archive upload accepted, run ID `5e22222c68604785ad748f0ea3907136` returned, 200 anomaly report rows loaded, 100 change-point reports loaded, and 2,000 ranked candidate entries loaded. The original `outputs/reports/final_backend_validation.json` SHA-256 remains `B3877950BBE4E3264F70076F6513871DF9267C0EAB336E098775D8C124D912C5`.

The frontend has no database or client-side persistence. For a production deployment, serve the compiled frontend behind a reverse proxy that maps `/api` to the FastAPI service, or set `VITE_API_BASE_URL` to an approved same-origin API path. The backend does not expose raw sensor time-series through these endpoints, so the UI does not fabricate sensor charts; it visualizes only available report fields.

### Private mobile-hotspot demonstration

The Vite server is configured to listen on `0.0.0.0`, and the FastAPI server should be started on `0.0.0.0` for same-hotspot access. The browser calls same-origin `/api` paths, so no `localhost` or `127.0.0.1` is sent by a phone browser; Vite proxies those requests to the laptop backend. No CORS broadening is required for this setup.

Find the laptop IPv4 address:

```powershell
ipconfig
```

Find the `IPv4 Address` under the active Wi-Fi adapter. If it is `192.168.64.6`, open this URL on the phone:

```text
http://192.168.64.6:5173/
```

If the phone cannot open the page, keep the laptop and phone on the same hotspot, confirm Windows Firewall allows private-network inbound TCP connections for Python/Node or ports `8000` and `5173`, and retry. Do not disable the firewall globally or expose the ports on public networks.

### Presentation default dataset

The preserved `data/raw/dataset_causRCA.zip` is now checked during FastAPI startup. Its MD5 must be `5d57a40184697a4c2bf9eef7c385ebb5`; the extracted `data/extracted/` tree is also validated for the required causRCA structure and observation schema. `GET /health` exposes the verified default dataset metadata, and `POST /analysis/run` with `{}` runs this default dataset. Manual ZIP upload remains available and uses the same validation path.
