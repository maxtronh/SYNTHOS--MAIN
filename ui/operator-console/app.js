const ROLE_PRINCIPALS = {
  RELEASE_DIRECTOR: {
    subjectId: 'user-director-1',
    email: 'director@synthos.dev',
    tenantId: 'default',
    roles: ['RELEASE_DIRECTOR'],
    ssoAuthenticated: true,
  },
  SENIOR_ENGINEER: {
    subjectId: 'user-senior-1',
    email: 'senior@synthos.dev',
    tenantId: 'default',
    roles: ['SENIOR_ENGINEER'],
    ssoAuthenticated: true,
  },
  SECURITY_LEAD: {
    subjectId: 'user-sec-1',
    email: 'security@synthos.dev',
    tenantId: 'default',
    roles: ['SECURITY_LEAD'],
    ssoAuthenticated: true,
  },
  DEVELOPER: {
    subjectId: 'user-dev-1',
    email: 'developer@synthos.dev',
    tenantId: 'default',
    roles: ['DEVELOPER'],
    ssoAuthenticated: true,
  },
};

const TAB_TITLES = {
  ALL_WORKFLOWS: '⚡ Active & Recent Workflows',
  APPROVAL_QUEUE: '⏳ Blueprint Approval Queue',
  THREAT_OVERRIDES: '🛡️ Security Threat Override Queue',
  RELEASE_PROMOTION_QUEUE: '🚀 Production Release Promotion Queue',
};

let activeTab = 'ALL_WORKFLOWS';
let initializedDefaultTab = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCurrentPrincipal() {
  const select = document.getElementById('role-select');
  const key = select ? select.value : 'RELEASE_DIRECTOR';
  return ROLE_PRINCIPALS[key] || ROLE_PRINCIPALS.RELEASE_DIRECTOR;
}

function principalHeaders() {
  return { 'x-fable-principal': JSON.stringify(getCurrentPrincipal()) };
}

function showRbacBanner(message) {
  const banner = document.getElementById('rbac-banner');
  if (!banner) return;
  banner.textContent = message;
  banner.style.display = 'block';
}

function hideRbacBanner() {
  const banner = document.getElementById('rbac-banner');
  if (!banner) return;
  banner.textContent = '';
  banner.style.display = 'none';
}

function computeTabs(caps) {
  const tabs = [{ id: 'ALL_WORKFLOWS', label: 'All Workflows' }];
  if (caps.canApproveBlueprints) {
    tabs.push({ id: 'APPROVAL_QUEUE', label: 'Approval Queue' });
  }
  if (caps.canOverrideCriticalThreats) {
    tabs.push({ id: 'THREAT_OVERRIDES', label: 'Threat Overrides' });
  }
  if (caps.canPromoteProduction) {
    tabs.push({ id: 'RELEASE_PROMOTION_QUEUE', label: 'Release Promotion' });
  }
  return tabs;
}

function defaultTabFor(caps) {
  if (caps.canPromoteProduction) return 'RELEASE_PROMOTION_QUEUE';
  if (caps.canOverrideCriticalThreats) return 'THREAT_OVERRIDES';
  if (caps.canApproveBlueprints) return 'APPROVAL_QUEUE';
  return 'ALL_WORKFLOWS';
}

function filterWorkflowsForTab(workflows, tabId) {
  if (tabId === 'APPROVAL_QUEUE') {
    return workflows.filter(w => w.status === 'PENDING_APPROVAL' || w.status === 'STALE_PAUSED');
  }
  if (tabId === 'RELEASE_PROMOTION_QUEUE') {
    return workflows.filter(w => w.status === 'COMPLETED' && !w.releasePromoted);
  }
  if (tabId === 'THREAT_OVERRIDES') {
    return workflows.filter(w => w.status === 'FAILED' || w.status === 'STALE_PAUSED');
  }
  return workflows;
}

function renderRoleTabs(tabs) {
  const tabsEl = document.getElementById('role-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = tabs
    .map(tab => {
      const cls = tab.id === activeTab ? 'tab active' : 'tab';
      return `<button class="${cls}" onclick="selectTab('${tab.id}')">${escapeHtml(tab.label)}</button>`;
    })
    .join('');
}

async function onRoleChange() {
  hideRbacBanner();
  initializedDefaultTab = false;
  await loadDashboard();
}

async function selectTab(tabId) {
  hideRbacBanner();
  activeTab = tabId;
  await loadDashboard();
}

async function loadDashboard() {
  const headers = principalHeaders();
  const [capRes, wfRes, telRes, memoRes] = await Promise.all([
    fetch('/api/capabilities', { headers }).then(r => r.json()),
    fetch('/api/workflows').then(r => r.json()),
    fetch('/api/telemetry').then(r => r.json()),
    fetch('/api/memos').then(r => r.json()),
  ]);

  const principal = capRes.principal || getCurrentPrincipal();
  const caps = capRes.capabilities || {
    canApproveBlueprints: false,
    canOverrideCriticalThreats: false,
    canResolveMemos: false,
    canPromoteProduction: false,
  };

  const roleBadge = document.getElementById('role-badge');
  if (roleBadge) {
    roleBadge.textContent = (principal.roles && principal.roles.join(', ')) || 'Control Plane';
  }

  const tabs = computeTabs(caps);
  if (!initializedDefaultTab) {
    activeTab = defaultTabFor(caps);
    initializedDefaultTab = true;
  } else if (!tabs.some(t => t.id === activeTab)) {
    activeTab = defaultTabFor(caps);
  }
  renderRoleTabs(tabs);

  const titleEl = document.getElementById('workflows-title');
  if (titleEl) {
    titleEl.textContent = TAB_TITLES[activeTab] || TAB_TITLES.ALL_WORKFLOWS;
  }

  document.getElementById('m-wf-count').textContent = wfRes.workflows.length;
  document.getElementById('m-pending').textContent = wfRes.workflows.filter(
    w => w.status === 'PENDING_APPROVAL' || w.status === 'STALE_PAUSED'
  ).length;
  document.getElementById('m-cost').textContent = '$' + (telRes.costs.avgTotalCost || 0).toFixed(4);
  document.getElementById('m-p95').textContent = (telRes.latency.p95 || 0) + ' ms';

  const visibleWorkflows = filterWorkflowsForTab(wfRes.workflows, activeTab);
  const wfContainer = document.getElementById('workflows-container');
  if (visibleWorkflows.length === 0) {
    wfContainer.innerHTML = '<div class="card" style="color: var(--muted)">No workflows in this view.</div>';
  } else {
    wfContainer.innerHTML = visibleWorkflows.map(w => renderWorkflowCard(w, caps)).join('');
  }

  const memosContainer = document.getElementById('memos-container');
  if (memoRes.memos.length === 0) {
    memosContainer.innerHTML = '<div class="card" style="color: var(--muted)">No escalated Decision Memos.</div>';
  } else {
    memosContainer.innerHTML = memoRes.memos.map(m => renderMemoCard(m, caps)).join('');
  }
}

function renderWorkflowCard(wf, caps) {
  const badgeClass =
    wf.status === 'COMPLETED' ? 'badge-pass' : (wf.status === 'FAILED' ? 'badge-fail' : 'badge-warn');

  const nodesHtml = Object.values(wf.nodeStates).map(n => `
    <div class="node-box">
      <div style="font-weight: 600; font-size: 0.9rem;">${escapeHtml(n.nodeId)}</div>
      <div style="font-size: 0.75rem; color: var(--muted); margin: 4px 0;">${escapeHtml(n.contractId)}@${escapeHtml(n.contractVersion)}</div>
      <span class="badge ${n.state === 'PASSED' ? 'badge-pass' : (n.state === 'FAILED' ? 'badge-fail' : 'badge-info')}">${escapeHtml(n.state)}</span>
    </div>
  `).join('');

  const canApprove = (wf.status === 'PENDING_APPROVAL' || wf.status === 'STALE_PAUSED') && caps.canApproveBlueprints;
  const approveBtn = canApprove
    ? `<button onclick="approveWf('${escapeHtml(wf.workflowId)}')">Approve Blueprint</button>`
    : '';

  let promoteSection = '';
  if (wf.releasePromoted) {
    promoteSection = '<span class="badge badge-pass">PROMOTED TO PROD</span>';
  } else if (wf.status === 'COMPLETED' && caps.canPromoteProduction) {
    promoteSection = `<button class="btn-success" onclick="promoteWf('${escapeHtml(wf.workflowId)}')">Promote Release to Prod</button>`;
  }

  return `
    <div class="wf-card">
      <div class="wf-header">
        <div>
          <strong>${escapeHtml(wf.workflowId)}</strong> <span style="color:var(--muted)">(${escapeHtml(wf.goalId)})</span>
        </div>
        <div style="display:flex; gap: 8px; align-items:center;">
          <span class="badge ${badgeClass}">${escapeHtml(wf.status)}</span>
          ${approveBtn}
          ${promoteSection}
        </div>
      </div>
      <div class="node-list">${nodesHtml}</div>
    </div>
  `;
}

function renderMemoCard(m, caps) {
  const roleHint = caps.canResolveMemos
    ? '<span class="badge badge-info">ACTIONABLE BY ROLE</span>'
    : '<span class="badge badge-warn">READ-ONLY</span>';
  return `
    <div class="wf-card">
      <div class="wf-header">
        <strong>${escapeHtml(m.memoId)} — Node: ${escapeHtml(m.nodeId)}</strong>
        <div style="display:flex; gap:8px; align-items:center;">
          ${roleHint}
          <span class="badge badge-warn">${escapeHtml(m.status)} (${escapeHtml(m.totalCyclesAttempted)} Cycles)</span>
        </div>
      </div>
      <div style="font-size:0.85rem; color: var(--muted);">Assigned To: ${escapeHtml(m.assignedTo)}</div>
      <pre>${escapeHtml(m.consolidatedErrorLogs)}</pre>
    </div>
  `;
}

async function postOperatorAction(url, body) {
  hideRbacBanner();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...principalHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errPayload = await res.json().catch(() => ({}));
    const reasons = Array.isArray(errPayload.reasons) ? errPayload.reasons.join(' | ') : (errPayload.error || res.statusText);
    showRbacBanner(`OPA Policy Denied (${res.status}): ${reasons}`);
    return false;
  }
  await loadDashboard();
  return true;
}

async function approveWf(id) {
  const principal = getCurrentPrincipal();
  await postOperatorAction('/api/workflows/' + encodeURIComponent(id) + '/approve', {
    approvedBy: principal.email,
  });
}

async function promoteWf(id) {
  const principal = getCurrentPrincipal();
  await postOperatorAction('/api/workflows/' + encodeURIComponent(id) + '/promote', {
    approvedBy: principal.email,
    targetEnvironment: 'PRODUCTION',
  });
}

if (typeof window !== 'undefined') {
  window.onRoleChange = onRoleChange;
  window.selectTab = selectTab;
  window.approveWf = approveWf;
  window.promoteWf = promoteWf;
  window.loadDashboard = loadDashboard;
}

loadDashboard();
