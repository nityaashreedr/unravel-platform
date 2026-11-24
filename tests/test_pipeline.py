from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from unravel_pipeline import DATA, dataset_inventory, find_fault_files, find_normal_files, metadata_for_fault, pivot_observations
import networkx as nx
import pandas as pd


def test_authentic_dataset_present():
    inventory = dataset_inventory()
    assert inventory["total_files"] >= 400
    assert inventory["archive"]["md5"] == inventory["archive"]["expected_md5"]
    assert (DATA / "README_DATASET.md").exists()
    assert (DATA / "expert_graph" / "all_nodes.csv").exists()


def test_fault_schema_and_pivot():
    path = find_fault_files()[0]
    wide = pivot_observations(path)
    assert {"time_s", "node", "value", "type"}.issubset(set(__import__('pandas').read_csv(path, nrows=1).columns))
    assert wide.index.is_monotonic_increasing
    assert len(wide) > 0 and wide.shape[1] > 0


def test_normal_operation_and_label_mapping():
    assert len(find_normal_files()) == 170
    causes, desc = metadata_for_fault(find_fault_files()[0])
    assert causes["cause_start_at"] < causes["cause_end_at"]
    assert desc["manipulatedVars"]
    wide = pivot_observations(find_fault_files()[0])
    labels = (wide.index >= causes["cause_start_at"]) & (wide.index <= causes["cause_end_at"])
    assert labels.any() and (~labels).any()


def test_graph_loading_and_candidate_inputs():
    nodes = pd.read_csv(DATA / "expert_graph" / "all_nodes.csv")
    edges = pd.read_csv(DATA / "expert_graph" / "all_edges.csv")
    graph = nx.from_pandas_edgelist(edges, source="source_label", target="target_label", create_using=nx.DiGraph)
    inputs = set(nodes.loc[nodes["io"].fillna("").str.lower().eq("input"), "label"])
    assert len(graph) > 0 and len(edges) > 0 and inputs
    assert inputs.issubset(set(graph.nodes) | inputs)


def test_evaluation_reports_are_traceable():
    report = Path(__file__).resolve().parents[1] / "outputs" / "reports" / "isolation_forest.json"
    assert report.exists()
    data = __import__('json').loads(report.read_text())
    assert data["normal_train_files"] > 0 and data["normal_validation_files"] > 0
    row = data["results"][0]
    assert {"precision", "recall", "f1", "pr_auc"}.issubset(row["metrics"])
    assert set(row["confusion_matrix"]) == {"tn", "fp", "fn", "tp"}
