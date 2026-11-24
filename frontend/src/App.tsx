import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { AnomalyReport, CauseRow, ChangePointRow, EvidenceResponse, HealthResponse, RunResponse, UploadResponse } from "./types";

type View = "overview" | "upload" | "analysis" | "anomalies" | "change-points" | "causes" | "evidence";
type Results = { anomalies?: AnomalyReport; changePoints?: ChangePointRow[]; causes?: CauseRow[]; evidence?: EvidenceResponse[] };

const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "◈" }, { id: "upload", label: "Dataset upload", icon: "↥" },
  { id: "analysis", label: "Analysis run", icon: "▶" }, { id: "anomalies", label: "Anomalies", icon: "△" },
  { id: "change-points", label: "Change points", icon: "⌁" }, { id: "causes", label: "Candidate causes", icon: "◎" },
  { id: "evidence", label: "Evidence explorer", icon: "✦" },
];

function App() {
  const [view, setView] = useState<View>("overview");
  const [upload, setUpload] = useState<UploadResponse>();
  const [run, setRun] = useState<RunResponse>();
  const [results, setResults] = useState<Results>({});
  const [busy, setBusy] = useState<"upload" | "analysis" | "results" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("Backend connection not checked yet.");
  const [health, setHealth] = useState<HealthResponse>();

  useEffect(() => {
    api.health().then(response => { setHealth(response); setNotice("Backend API connected; default dataset verified."); }).catch(() => setNotice("Backend connection unavailable."));
  }, []);

  const loadResults = async (runId: string) => {
    setBusy("results"); setError("");
    try {
      const [anomalies, changePoints, causes, evidence] = await Promise.all([
        api.anomalies(runId), api.changePoints(runId), api.causes(runId), api.evidence(runId),
      ]);
      setResults({ anomalies: anomalies.report, changePoints: changePoints.report, causes: causes.report, evidence: evidence.evidence });
      setNotice("Analysis reports loaded from the backend.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load analysis reports."); }
    finally { setBusy(null); }
  };

  const handleUpload = async (file: File) => {
    setBusy("upload"); setError(""); setNotice("Validating the archive with the backend…");
    try { const response = await api.uploadDataset(file); setUpload(response); setNotice("Authentic causRCA archive accepted."); setView("analysis"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed."); }
    finally { setBusy(null); }
  };

  const handleRun = async () => {
    setBusy("analysis"); setError(""); setNotice("Running the existing analysis pipeline. This may take several minutes…");
    try { const response = await api.runAnalysis(upload?.upload_id); setRun(response); await loadResults(response.run_id); setView("overview"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Analysis failed."); setBusy(null); }
  };

  const summary = useMemo(() => ({
    anomalyRows: results.anomalies?.results?.length,
    changePoints: results.changePoints?.length,
    causes: results.causes?.reduce((total, row) => total + row.ranked_candidates.length, 0),
  }), [results]);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">U</span><span>UNRAVEL</span></div>
      <p className="sidebar-caption">Industrial intelligence<br />for fault investigation</p>
      <nav>{navItems.map(item => <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
      <div className="sidebar-footer"><span className="status-dot" />Backend API<br /><small>{notice}</small></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><span className="eyebrow">INVESTIGATION CONSOLE</span><h1>{navItems.find(item => item.id === view)?.label}</h1></div><div className="run-chip">{run ? <>Run <strong>{run.run_id.slice(0, 8)}</strong></> : "No run selected"}</div></header>
      {error && <div className="alert error"><strong>Action could not complete</strong><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
      {busy && <div className="progress-banner"><span className="spinner" />{busy === "analysis" ? "Analysis is processing authentic observations…" : busy === "upload" ? "Validating dataset archive…" : "Loading backend reports…"}</div>}
      {view === "overview" && <Overview upload={upload} run={run} summary={summary} onNavigate={setView} />}
      {view === "upload" && <><DefaultDatasetNotice dataset={health?.default_dataset} /><UploadPanel busy={busy === "upload"} onUpload={handleUpload} /></>}
      {view === "analysis" && <><DefaultDatasetNotice dataset={health?.default_dataset} /><AnalysisPanel upload={upload} run={run} busy={busy === "analysis"} onRun={handleRun} onLoad={run ? () => loadResults(run.run_id) : undefined} /></>}
      {view === "anomalies" && <AnomaliesPanel report={results.anomalies} />}
      {view === "change-points" && <ChangePointsPanel rows={results.changePoints} />}
      {view === "causes" && <CausesPanel rows={results.causes} />}
      {view === "evidence" && <EvidencePanel rows={results.evidence} />}
    </main>
  </div>;
}

function Overview({ upload, run, summary, onNavigate }: { upload?: UploadResponse; run?: RunResponse; summary: { anomalyRows?: number; changePoints?: number; causes?: number }; onNavigate: (view: View) => void }) {
  return <section className="page"><div className="hero-card"><div><span className="eyebrow accent">UNRAVEL PLATFORM</span><h2>From signal to<br /><em>understanding.</em></h2><p>Evidence-backed industrial fault investigation using the validated causRCA analysis pipeline.</p><button className="primary" onClick={() => onNavigate(upload ? "analysis" : "upload")}>{upload ? "Continue investigation" : "Upload a dataset"}<span>→</span></button></div><div className="hero-orbit"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-core">U</div><span className="orbit-label label-one">SENSORS</span><span className="orbit-label label-two">EVIDENCE</span><span className="orbit-label label-three">CAUSES</span></div></div>
    <div className="section-heading"><div><span className="eyebrow">LIVE SNAPSHOT</span><h3>Investigation overview</h3></div><span className="muted">Values are shown only when returned by the backend.</span></div>
    <div className="metric-grid"><Metric label="Anomaly result rows" value={summary.anomalyRows} hint="Backend report" /><Metric label="Change-point runs" value={summary.changePoints} hint="Detected report rows" /><Metric label="Ranked candidates" value={summary.causes} hint="Evidence-backed entries" /><Metric label="Run status" value={run?.status} hint={run ? run.run_id : "No analysis started"} /></div>
    <div className="two-col"><div className="panel"><span className="eyebrow">DATASET</span><h3>{upload ? upload.filename : "No dataset loaded"}</h3>{upload ? <p>{upload.validation.normal_files} normal recordings · {upload.validation.fault_files} fault recordings<br /><span className="mono">MD5 {upload.archive_md5}</span></p> : <p>Upload the verified causRCA archive to begin an investigation.</p>}<button className="text-button" onClick={() => onNavigate("upload")}>{upload ? "Replace dataset" : "Open upload"} →</button></div><div className="panel"><span className="eyebrow">INTERPRETATION</span><h3>Candidate causes are hypotheses</h3><p>Rankings trace observed evidence through the expert graph. They are not confirmed root causes or causal proof.</p><button className="text-button" onClick={() => onNavigate("causes")}>Explore causes →</button></div></div>
  </section>;
}

function Metric({ label, value, hint }: { label: string; value?: number | string; hint: string }) { return <div className="metric-card"><span className="metric-label">{label}</span><strong>{value ?? "—"}</strong><small>{hint}</small></div>; }

function UploadPanel({ busy, onUpload }: { busy: boolean; onUpload: (file: File) => void }) { const [drag, setDrag] = useState(false); return <section className="page narrow"><div className="section-heading"><div><span className="eyebrow accent">DATA INGESTION</span><h2>Bring a verified dataset into focus.</h2></div></div><div className={drag ? "dropzone dragging" : "dropzone"} onDragOver={event => { event.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={event => { event.preventDefault(); setDrag(false); const file = event.dataTransfer.files[0]; if (file) onUpload(file); }}><div className="upload-icon">↥</div><h3>Drop the causRCA archive here</h3><p>Only the verified `.zip` release is accepted by the backend.</p><label className="primary file-label">{busy ? "Validating…" : "Choose archive"}<input disabled={busy} type="file" accept=".zip,application/zip" onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); }} /></label></div><div className="info-strip"><span>✓</span><div><strong>Backend validation is authoritative</strong><p>Checksum, dataset structure, observation schema, and file counts are validated server-side. Invalid or synthetic archives are rejected.</p></div></div></section>; }

function AnalysisPanel({ upload, run, busy, onRun, onLoad }: { upload?: UploadResponse; run?: RunResponse; busy: boolean; onRun: () => void; onLoad?: () => void }) { return <section className="page narrow"><div className="section-heading"><div><span className="eyebrow accent">PIPELINE CONTROL</span><h2>Execute the investigation.</h2></div></div><div className="panel process-panel"><div className="process-step"><span className="step-number">01</span><div><span className="eyebrow">DATASET</span><h3>{upload?.filename ?? "Use preserved authentic dataset"}</h3><p>{upload ? `${upload.validation.normal_files} normal · ${upload.validation.fault_files} fault recordings validated.` : "No upload selected. The backend will use its preserved authentic dataset."}</p></div><span className="check">✓</span></div><div className="process-line" /><div className="process-step"><span className="step-number">02</span><div><span className="eyebrow">ANALYSIS</span><h3>Run all validated phases</h3><p>Preprocessing, anomaly detection, PELT change points, and graph-constrained evidence ranking.</p></div><button disabled={busy} className="primary" onClick={onRun}>{busy ? "Processing…" : "Start analysis →"}</button></div>{run && <div className="run-result"><span className="status-dot" />{run.status} · Run ID <span className="mono">{run.run_id}</span><button className="text-button" onClick={onLoad}>Reload reports</button></div>}</div><div className="warning-note"><strong>Long-running operation</strong><span>The existing endpoint returns the completed run ID after synchronous pipeline execution. Keep this page open while processing.</span></div></section>; }

function AnomaliesPanel({ report }: { report?: AnomalyReport }) { const [filter, setFilter] = useState(""); const rows = report?.results.filter(row => String(row.group ?? "").includes(filter) || String(row.method ?? "").includes(filter)) ?? []; return <section className="page"><DataHeading eyebrow="ANOMALY DETECTION" title="Signals requiring attention" count={report ? `${rows.length} report rows` : undefined} /><div className="toolbar"><input placeholder="Filter group or method" value={filter} onChange={event => setFilter(event.target.value)} />{report && <span>Trained on {report.normal_train_files} normal files · validated on {report.normal_validation_files}</span>}</div>{report ? <div className="table-wrap"><table><thead><tr><th>Group</th><th>Experiment</th><th>Run</th><th>Method</th><th>Precision</th><th>Recall</th><th>F1</th><th>PR-AUC</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.group}-${row.experiment}-${index}`}><td><span className="tag">{String(row.group ?? "—")}</span></td><td>{String(row.experiment ?? "—")}</td><td>{String(row.run ?? "—")}</td><td>{String(row.method ?? "—")}</td><td>{metric(row.metrics?.precision)}</td><td>{metric(row.metrics?.recall)}</td><td><strong>{metric(row.metrics?.f1)}</strong></td><td>{metric(row.metrics?.pr_auc)}</td></tr>)}</tbody></table></div> : <EmptyState text="Run an analysis to load anomaly results." />}</section>; }

function ChangePointsPanel({ rows }: { rows?: ChangePointRow[] }) { return <section className="page"><DataHeading eyebrow="TEMPORAL ANALYSIS" title="Change-point timeline" count={rows ? `${rows.length} runs` : undefined} />{rows ? <div className="timeline-list">{rows.slice(0, 30).map(row => { const pelt = row.methods.pelt_rbf; return <div className="timeline-card" key={`${row.experiment}-${row.run}`}><div className="timeline-marker" /><div className="timeline-content"><div className="row-between"><div><span className="tag">{row.group}</span><strong>{row.experiment} / {row.run}</strong></div><span className={pelt.onset_detected ? "pill success" : "pill danger"}>{pelt.onset_detected ? "Onset detected" : "Not detected"}</span></div><div className="point-track">{pelt.detected_change_points.map((point, index) => <span className="point" style={{ left: `${Math.min(96, 8 + (index / Math.max(1, pelt.detected_change_points.length - 1)) * 88)}%` }} title={`Observed timestamp ${point}`} key={`${point}-${index}`} />)}<span className="cause-window" title={`Cause window ${row.cause_start_at}–${row.cause_end_at}`} /></div><div className="row-between small"><span>PELT observations: {pelt.detected_change_points.join(", ") || "None"}</span><span>Delay: {pelt.detection_delay_s == null ? "—" : `${pelt.detection_delay_s.toFixed(3)} s`}</span></div></div></div>; })}</div> : <EmptyState text="Run an analysis to load change points." />}</section>; }

function CausesPanel({ rows }: { rows?: CauseRow[] }) { const candidates = rows?.flatMap(row => row.ranked_candidates.map(candidate => ({ ...candidate, group: row.group, experiment: row.experiment, run: row.run }))) ?? []; const top = candidates.sort((a, b) => b.score - a.score).slice(0, 30); return <section className="page"><DataHeading eyebrow="ROOT-CAUSE INVESTIGATION" title="Candidate causes" count={rows ? `${candidates.length} candidate entries` : undefined} /><div className="hypothesis-note"><span>◎</span><div><strong>Hypotheses, not confirmed root causes</strong><p>Scores reflect traceable evidence propagated through the expert causal graph. They do not establish causation.</p></div></div>{rows ? <div className="cause-grid">{top.map((candidate, index) => <div className="cause-card" key={`${candidate.group}-${candidate.node}-${index}`}><div className="rank">{String(index + 1).padStart(2, "0")}</div><div className="cause-main"><div className="row-between"><h3>{candidate.node}</h3><strong className="score">{candidate.score.toFixed(3)}</strong></div><span className="tag">{candidate.group} · {candidate.experiment} · {candidate.run}</span><p>Supported by {candidate.supporting_evidence.length} observed evidence node{candidate.supporting_evidence.length === 1 ? "" : "s"}.</p><div className="evidence-chips">{candidate.supporting_evidence.slice(0, 5).map(item => <span key={item}>{item}</span>)}</div></div></div>)}</div> : <EmptyState text="Run an analysis to load candidate causes." />}</section>; }

function EvidencePanel({ rows }: { rows?: EvidenceResponse[] }) { const evidence = rows?.flatMap(row => row.ranked_candidates.map(candidate => ({ ...candidate, group: row.group, experiment: row.experiment, run: row.run }))) ?? []; return <section className="page"><DataHeading eyebrow="TRACEABILITY" title="Evidence explorer" count={rows ? `${evidence.length} evidence-linked candidates` : undefined} />{rows ? <div className="evidence-list">{evidence.slice(0, 50).map((item, index) => <div className="evidence-row" key={`${item.group}-${item.node}-${index}`}><div className="evidence-icon">✦</div><div className="evidence-body"><div className="row-between"><strong>{item.node}</strong><span className="score">{item.score.toFixed(3)}</span></div><span className="muted">{item.group} · {item.experiment} · {item.run}</span><p>Observed evidence supporting this candidate: {item.supporting_evidence.join(", ") || "No linked evidence returned"}.</p></div></div>)}</div> : <EmptyState text="Run an analysis to explore traceable evidence." />}</section>; }

function DataHeading({ eyebrow, title, count }: { eyebrow: string; title: string; count?: string }) { return <div className="section-heading"><div><span className="eyebrow accent">{eyebrow}</span><h2>{title}</h2></div>{count && <span className="count-badge">{count}</span>}</div>; }
function EmptyState({ text }: { text: string }) { return <div className="empty-state"><span>◌</span><h3>No backend data loaded</h3><p>{text}</p></div>; }
function metric(value: unknown) { return typeof value === "number" ? value.toFixed(3) : "—"; }

function DefaultDatasetNotice({ dataset }: { dataset?: UploadResponse }) { return dataset ? <div className="default-dataset panel"><span className="eyebrow">DEFAULT DATASET</span><h3>{dataset.name}</h3><p><span className="pill success">{dataset.archive_validation}</span> · {dataset.validation.normal_files} normal · {dataset.validation.fault_files} fault recordings</p><p className="mono">MD5 {dataset.archive_md5}</p></div> : null; }

export default App;
