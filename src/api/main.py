from __future__ import annotations

import json
import hashlib
import os
import shutil
import subprocess
import sys
import uuid
import zipfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parents[2]
API_ROOT = ROOT / "api_storage"
UPLOAD_ROOT = API_ROOT / "uploads"
RUN_ROOT = API_ROOT / "runs"
DEFAULT_ARCHIVE = ROOT / "data" / "raw" / "dataset_causRCA.zip"
DEFAULT_DATASET_ROOT = ROOT / "data" / "extracted"
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
EXPECTED_DATASET_MD5 = "5d57a40184697a4c2bf9eef7c385ebb5"
REQUIRED_PATHS = ("real_op", "dig_twin", "expert_graph/all_nodes.csv", "expert_graph/all_edges.csv")

app = FastAPI(title="Unravel Backend API", version="1.0.0")
_default_dataset: dict[str, Any] | None = None


class AnalysisRequest(BaseModel):
    upload_id: str | None = Field(default=None, description="Validated upload ID; omit to use the preserved authentic dataset")
    timeout_seconds: int = Field(default=900, ge=30, le=3600)


def _safe_id(value: str) -> str:
    if not value or value != Path(value).name or value in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid identifier")
    return value


def _find_dataset_root(extract_dir: Path) -> Path:
    candidates = [extract_dir] + [p for p in extract_dir.iterdir() if p.is_dir()]
    for candidate in candidates:
        if all((candidate / required).exists() for required in REQUIRED_PATHS):
            return candidate
    raise ValueError("Archive does not contain real_op, dig_twin, and expert_graph dataset structure")


def _validate_dataset(root: Path) -> dict[str, Any]:
    missing = [required for required in REQUIRED_PATHS if not (root / required).exists()]
    if missing:
        raise ValueError(f"Missing required dataset paths: {missing}")
    csv_files = list((root / "real_op").glob("*.csv")) + list((root / "dig_twin").glob("exp_*/exp_*/run_*/faultDataset_*.csv"))
    if not csv_files:
        raise ValueError("Dataset contains no recognized observation CSV files")
    import pandas as pd
    sample = pd.read_csv(csv_files[0], nrows=1)
    required_columns = {"time_s", "node", "value", "type"}
    if not required_columns.issubset(sample.columns):
        raise ValueError(f"Observation CSV must contain {sorted(required_columns)}")
    return {
        "root": str(root),
        "normal_files": len(list((root / "real_op").glob("*.csv"))),
        "fault_files": len(list((root / "dig_twin").glob("exp_*/exp_*/run_*/faultDataset_*.csv"))),
        "schema": sorted(required_columns),
    }


def _initialize_default_dataset() -> dict[str, Any]:
    if not DEFAULT_ARCHIVE.exists():
        raise ValueError(f"Preserved causRCA archive not found: {DEFAULT_ARCHIVE}")
    archive_md5 = hashlib.md5(DEFAULT_ARCHIVE.read_bytes()).hexdigest()
    if archive_md5 != EXPECTED_DATASET_MD5:
        raise ValueError("Preserved causRCA archive failed the verified MD5 check")
    validation = _validate_dataset(DEFAULT_DATASET_ROOT)
    return {
        "dataset_id": "causRCA-default",
        "name": "causRCA \u2014 Industrial Fault Investigation Dataset",
        "status": "ready",
        "archive_validation": "verified",
        "archive_md5": archive_md5,
        "authentic_source": "https://doi.org/10.5281/zenodo.15876410",
        "dataset_root": str(DEFAULT_DATASET_ROOT),
        "validation": validation,
    }


@app.on_event("startup")
def initialize_default_dataset() -> None:
    global _default_dataset
    try:
        _default_dataset = _initialize_default_dataset()
    except (OSError, ValueError) as exc:
        _default_dataset = {"dataset_id": "causRCA-default", "name": "causRCA \u2014 Industrial Fault Investigation Dataset", "status": "unavailable", "archive_validation": "failed", "error": str(exc)}


def _dataset_for_upload(upload_id: str | None) -> Path:
    if upload_id is None:
        if not _default_dataset or _default_dataset.get("status") != "ready":
            raise HTTPException(status_code=503, detail="The verified default causRCA dataset is unavailable")
        return DEFAULT_DATASET_ROOT
    upload_id = _safe_id(upload_id)
    manifest_path = UPLOAD_ROOT / upload_id / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="Upload not found")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    root = Path(manifest["dataset_root"])
    try:
        _validate_dataset(root)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return root


def _read_report(run_id: str, filename: str) -> Any:
    run_id = _safe_id(run_id)
    path = RUN_ROOT / run_id / "outputs" / "reports" / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Analysis run or report not found")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid generated report: {filename}") from exc


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "unravel-backend", "mode": "batch-pipeline-api", "default_dataset": _default_dataset or {"status": "initializing"}}


@app.post("/datasets/upload", status_code=status.HTTP_201_CREATED)
async def upload_dataset(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=415, detail="Only .zip dataset archives are accepted")
    upload_id = uuid.uuid4().hex
    upload_dir = UPLOAD_ROOT / upload_id
    extract_dir = upload_dir / "extracted"
    upload_dir.mkdir(parents=True, exist_ok=False)
    archive_path = upload_dir / "dataset.zip"
    try:
        total = 0
        with archive_path.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Dataset archive exceeds 100 MB limit")
                destination.write(chunk)
        archive_md5 = hashlib.md5(archive_path.read_bytes()).hexdigest()
        if archive_md5 != EXPECTED_DATASET_MD5:
            raise HTTPException(status_code=422, detail="Archive is not the verified causRCA Zenodo release")
        with zipfile.ZipFile(archive_path) as archive:
            base = extract_dir.resolve()
            for member in archive.infolist():
                target = (extract_dir / member.filename).resolve()
                if os.path.commonpath([str(base), str(target)]) != str(base):
                    raise HTTPException(status_code=400, detail="Archive contains an unsafe path")
            archive.extractall(extract_dir)
        dataset_root = _find_dataset_root(extract_dir)
        validation = _validate_dataset(dataset_root)
        manifest = {"upload_id": upload_id, "dataset_id": upload_id, "name": "causRCA \u2014 Industrial Fault Investigation Dataset", "filename": file.filename, "status": "ready", "archive_validation": "verified", "dataset_root": str(dataset_root), "archive_md5": archive_md5, "authentic_source": "https://doi.org/10.5281/zenodo.15876410", "validation": validation}
        (upload_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        return manifest
    except HTTPException:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise
    except (OSError, zipfile.BadZipFile, ValueError) as exc:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail=f"Dataset validation failed: {exc}") from exc
    finally:
        await file.close()


@app.post("/analysis/run", status_code=status.HTTP_202_ACCEPTED)
def run_analysis(request: AnalysisRequest) -> dict[str, Any]:
    dataset_root = _dataset_for_upload(request.upload_id)
    run_id = uuid.uuid4().hex
    run_dir = RUN_ROOT / run_id
    output_dir = run_dir / "outputs"
    run_dir.mkdir(parents=True, exist_ok=False)
    env = os.environ.copy()
    env["UNRAVEL_DATA_DIR"] = str(dataset_root)
    env["UNRAVEL_OUTPUT_DIR"] = str(output_dir)
    command = [sys.executable, str(ROOT / "src" / "unravel_pipeline.py"), "--phase", "all"]
    try:
        completed = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=request.timeout_seconds, check=False)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail=f"Analysis timed out after {request.timeout_seconds} seconds") from exc
    (run_dir / "stdout.txt").write_text(completed.stdout or "", encoding="utf-8")
    (run_dir / "stderr.txt").write_text(completed.stderr or "", encoding="utf-8")
    if completed.returncode != 0:
        raise HTTPException(status_code=500, detail={"message": "Analysis pipeline failed", "return_code": completed.returncode, "stderr": completed.stderr[-4000:]})
    validation = _read_report(run_id, "final_backend_validation.json")
    return {"run_id": run_id, "status": "completed", "dataset_root": str(dataset_root), "validation": validation["execution_checks"]}


@app.get("/analysis/{run_id}/anomalies")
def anomalies(run_id: str) -> dict[str, Any]:
    return {"run_id": run_id, "report": _read_report(run_id, "isolation_forest.json")}


@app.get("/analysis/{run_id}/change-points")
def change_points(run_id: str) -> dict[str, Any]:
    return {"run_id": run_id, "report": _read_report(run_id, "change_points.json")}


@app.get("/analysis/{run_id}/causes")
def causes(run_id: str) -> dict[str, Any]:
    return {"run_id": run_id, "report": _read_report(run_id, "cause_ranking.json")}


@app.get("/analysis/{run_id}/evidence")
def evidence(run_id: str) -> dict[str, Any]:
    report = _read_report(run_id, "cause_ranking.json")
    return {"run_id": run_id, "evidence": [{"group": row["group"], "experiment": row["experiment"], "run": row["run"], "ranked_candidates": row["ranked_candidates"]} for row in report]}
