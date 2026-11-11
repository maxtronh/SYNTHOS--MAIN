export function renderOperatorConsoleHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Fable Engine v3 — Operator Control Plane</title>
  <style>
    :root {
      --bg: #0f172a;
      --surface: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #3b82f6;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 24px; line-height: 1.5; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    h1 { font-size: 1.5rem; font-weight: 700; display: flex; align-items: center; gap: 10px; }
    .badge { padding: 4px 10px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
    .badge-pass { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .badge-warn { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); }
    .badge-fail { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
    .badge-info { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .metric-val { font-size: 1.8rem; font-weight: 700; margin-top: 6px; }
    .metric-label { font-size: 0.85rem; color: var(--muted); }
    .section-title { font-size: 1.15rem; font-weight: 600; margin: 24px 0 12px 0; }
    .wf-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 18px; margin-bottom: 16px; }
    .wf-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .node-list { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
    .node-box { background: #0f172a; border: 1px solid var(--border); padding: 10px 14px; border-radius: 6px; min-width: 180px; }
    button { background: var(--primary); color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.85rem; }
    button:hover { opacity: 0.9; }
    button.btn-success { background: var(--success); }
    button.btn-refresh { background: transparent; border: 1px solid var(--border); color: var(--text); }
    pre { background: #020617; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; color: #e2e8f0; margin-top: 8px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>🏛️ Fable Engine v3 <span class="badge badge-info">Control Plane</span></h1>
      <p style="color: var(--muted); font-size: 0.9rem;">Durable Temporal DAGs • Human Gate SLAs • Dual Precision/Recall Telemetry</p>
    </div>
    <button class="btn-refresh" onclick="loadDashboard()">↻ Refresh State</button>
  </header>

  <div class="grid" id="metrics-grid">
    <div class="card"><div class="metric-label">Total Workflows</div><div class="metric-val" id="m-wf-count">-</div></div>
    <div class="card"><div class="metric-label">Pending Approval</div><div class="metric-val" id="m-pending">-</div></div>
    <div class="card"><div class="metric-label">Avg Module Cost</div><div class="metric-val" id="m-cost">-</div></div>
    <div class="card"><div class="metric-label">P95 Pipeline Latency</div><div class="metric-val" id="m-p95">-</div></div>
  </div>

  <div class="section-title">⚡ Active & Recent Workflows</div>
  <div id="workflows-container">Loading workflows...</div>

  <div class="section-title">📝 Escalated Decision Memos (3-Cycle Patch Cap)</div>
  <div id="memos-container">Loading memos...</div>

  <script>
    async function loadDashboard() {
      const [wfRes, telRes, memoRes] = await Promise.all([
        fetch('/api/workflows').then(r => r.json()),
        fetch('/api/telemetry').then(r => r.json()),
        fetch('/api/memos').then(r => r.json())
      ]);

      document.getElementById('m-wf-count').textContent = wfRes.workflows.length;
      document.getElementById('m-pending').textContent = wfRes.workflows.filter(w => w.status === 'PENDING_APPROVAL' || w.status === 'STALE_PAUSED').length;
      document.getElementById('m-cost').textContent = '$' + (telRes.costs.avgTotalCost || 0).toFixed(4);
      document.getElementById('m-p95').textContent = (telRes.latency.p95 || 0) + ' ms';

      const wfContainer = document.getElementById('workflows-container');
      if (wfRes.workflows.length === 0) {
        wfContainer.innerHTML = '<div class="card" style="color: var(--muted)">No active workflows registered.</div>';
      } else {
        wfContainer.innerHTML = wfRes.workflows.map(wf => {
          const badgeClass = wf.status === 'COMPLETED' ? 'badge-pass' : (wf.status === 'FAILED' ? 'badge-fail' : 'badge-warn');
          const nodesHtml = Object.values(wf.nodeStates).map(n => \`
            <div class="node-box">
              <div style="font-weight: 600; font-size: 0.9rem;">\${n.nodeId}</div>
              <div style="font-size: 0.75rem; color: var(--muted); margin: 4px 0;">\${n.contractId}@\${n.contractVersion}</div>
              <span class="badge \${n.state === 'PASSED' ? 'badge-pass' : (n.state === 'FAILED' ? 'badge-fail' : 'badge-info')}">\${n.state}</span>
            </div>
          \`).join('');

          const approveBtn = (wf.status === 'PENDING_APPROVAL' || wf.status === 'STALE_PAUSED')
            ? \`<button onclick="approveWf('\${wf.workflowId}')">Approve Blueprint</button>\`
            : '';

          const promoteBtn = (wf.status === 'COMPLETED' && !wf.releasePromoted)
            ? \`<button class="btn-success" onclick="promoteWf('\${wf.workflowId}')">Promote Release to Prod</button>\`
            : (wf.releasePromoted ? '<span class="badge badge-pass">PROMOTED TO PROD</span>' : '');

          return \`
            <div class="wf-card">
              <div class="wf-header">
                <div>
                  <strong>\${wf.workflowId}</strong> <span style="color:var(--muted)">(\${wf.goalId})</span>
                </div>
                <div style="display:flex; gap: 8px; align-items:center;">
                  <span class="badge \${badgeClass}">\${wf.status}</span>
                  \${approveBtn}
                  \${promoteBtn}
                </div>
              </div>
              <div class="node-list">\${nodesHtml}</div>
            </div>
          \`;
        }).join('');
      }

      const memosContainer = document.getElementById('memos-container');
      if (memoRes.memos.length === 0) {
        memosContainer.innerHTML = '<div class="card" style="color: var(--muted)">No escalated Decision Memos.</div>';
      } else {
        memosContainer.innerHTML = memoRes.memos.map(m => \`
          <div class="wf-card">
            <div class="wf-header">
              <strong>\${m.memoId} — Node: \${m.nodeId}</strong>
              <span class="badge badge-warn">\${m.status} (\${m.totalCyclesAttempted} Cycles)</span>
            </div>
            <div style="font-size:0.85rem; color: var(--muted);">Assigned To: \${m.assignedTo}</div>
            <pre>\${m.consolidatedErrorLogs}</pre>
          </div>
        \`).join('');
      }
    }

    async function approveWf(id) {
      await fetch('/api/workflows/' + id + '/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy: 'operator-console-user' })
      });
      await loadDashboard();
    }

    async function promoteWf(id) {
      await fetch('/api/workflows/' + id + '/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedBy: 'release-director', targetEnvironment: 'PRODUCTION' })
      });
      await loadDashboard();
    }

    loadDashboard();
  </script>
</body>
</html>`;
}
