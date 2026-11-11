async function loadDashboard() {
  const [wfRes, telRes, memoRes] = await Promise.all([
    fetch('/api/workflows').then(r => r.json()),
    fetch('/api/telemetry').then(r => r.json()),
    fetch('/api/memos').then(r => r.json()),
  ]);

  document.getElementById('m-wf-count').textContent = wfRes.workflows.length;
  document.getElementById('m-pending').textContent = wfRes.workflows.filter(
    w => w.status === 'PENDING_APPROVAL' || w.status === 'STALE_PAUSED'
  ).length;
  document.getElementById('m-cost').textContent = '$' + (telRes.costs.avgTotalCost || 0).toFixed(4);
  document.getElementById('m-p95').textContent = (telRes.latency.p95 || 0) + ' ms';

  const wfContainer = document.getElementById('workflows-container');
  if (wfRes.workflows.length === 0) {
    wfContainer.innerHTML = '<div class="card" style="color: var(--muted)">No active workflows registered.</div>';
  } else {
    wfContainer.innerHTML = wfRes.workflows.map(renderWorkflowCard).join('');
  }

  const memosContainer = document.getElementById('memos-container');
  if (memoRes.memos.length === 0) {
    memosContainer.innerHTML = '<div class="card" style="color: var(--muted)">No escalated Decision Memos.</div>';
  } else {
    memosContainer.innerHTML = memoRes.memos.map(renderMemoCard).join('');
  }
}

function renderWorkflowCard(wf) {
  const badgeClass =
    wf.status === 'COMPLETED' ? 'badge-pass' : (wf.status === 'FAILED' ? 'badge-fail' : 'badge-warn');

  const nodesHtml = Object.values(wf.nodeStates).map(n => `
    <div class="node-box">
      <div style="font-weight: 600; font-size: 0.9rem;">${n.nodeId}</div>
      <div style="font-size: 0.75rem; color: var(--muted); margin: 4px 0;">${n.contractId}@${n.contractVersion}</div>
      <span class="badge ${n.state === 'PASSED' ? 'badge-pass' : (n.state === 'FAILED' ? 'badge-fail' : 'badge-info')}">${n.state}</span>
    </div>
  `).join('');

  const approveBtn = (wf.status === 'PENDING_APPROVAL' || wf.status === 'STALE_PAUSED')
    ? `<button onclick="approveWf('${wf.workflowId}')">Approve Blueprint</button>`
    : '';

  const promoteBtn = (wf.status === 'COMPLETED' && !wf.releasePromoted)
    ? `<button class="btn-success" onclick="promoteWf('${wf.workflowId}')">Promote Release to Prod</button>`
    : (wf.releasePromoted ? '<span class="badge badge-pass">PROMOTED TO PROD</span>' : '');

  return `
    <div class="wf-card">
      <div class="wf-header">
        <div>
          <strong>${wf.workflowId}</strong> <span style="color:var(--muted)">(${wf.goalId})</span>
        </div>
        <div style="display:flex; gap: 8px; align-items:center;">
          <span class="badge ${badgeClass}">${wf.status}</span>
          ${approveBtn}
          ${promoteBtn}
        </div>
      </div>
      <div class="node-list">${nodesHtml}</div>
    </div>
  `;
}

function renderMemoCard(m) {
  return `
    <div class="wf-card">
      <div class="wf-header">
        <strong>${m.memoId} — Node: ${m.nodeId}</strong>
        <span class="badge badge-warn">${m.status} (${m.totalCyclesAttempted} Cycles)</span>
      </div>
      <div style="font-size:0.85rem; color: var(--muted);">Assigned To: ${m.assignedTo}</div>
      <pre>${m.consolidatedErrorLogs}</pre>
    </div>
  `;
}

async function approveWf(id) {
  await fetch('/api/workflows/' + id + '/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvedBy: 'operator-console-user' }),
  });
  await loadDashboard();
}

async function promoteWf(id) {
  await fetch('/api/workflows/' + id + '/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvedBy: 'release-director', targetEnvironment: 'PRODUCTION' }),
  });
  await loadDashboard();
}

loadDashboard();
