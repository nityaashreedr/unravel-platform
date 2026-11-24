from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from api.main import app


ROOT = Path(__file__).resolve().parents[1]
client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_upload_rejects_non_zip():
    response = client.post("/datasets/upload", files={"file": ("not.csv", b"time_s,node,value,type\n", "text/csv")})
    assert response.status_code == 415


def test_uploads_and_validates_authentic_archive():
    archive = (ROOT / "data" / "raw" / "dataset_causRCA.zip").read_bytes()
    response = client.post("/datasets/upload", files={"file": ("dataset_causRCA.zip", archive, "application/zip")})
    assert response.status_code == 201
    body = response.json()
    assert body["validation"]["normal_files"] == 170
    assert body["validation"]["fault_files"] == 100


def test_report_endpoints_return_structured_results(tmp_path, monkeypatch):
    run_id = "test-run"
    report_dir = tmp_path / run_id / "outputs" / "reports"
    report_dir.mkdir(parents=True)
    (report_dir / "isolation_forest.json").write_text(json.dumps({"results": []}), encoding="utf-8")
    (report_dir / "change_points.json").write_text("[]", encoding="utf-8")
    ranking = [{"group": "coolant", "experiment": "exp_22", "run": "run_1", "ranked_candidates": []}]
    (report_dir / "cause_ranking.json").write_text(json.dumps(ranking), encoding="utf-8")
    monkeypatch.setattr("api.main.RUN_ROOT", tmp_path)
    assert client.get(f"/analysis/{run_id}/anomalies").json()["report"]["results"] == []
    assert client.get(f"/analysis/{run_id}/change-points").json()["report"] == []
    assert client.get(f"/analysis/{run_id}/evidence").json()["evidence"][0]["group"] == "coolant"


def test_missing_run_is_404():
    response = client.get("/analysis/does-not-exist/anomalies")
    assert response.status_code == 404
