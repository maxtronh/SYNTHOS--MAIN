import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  OpaPolicyEvaluator,
  type GovernanceAction,
  type OperatorPrincipal,
} from '@fable/governance-opa';
import { DashboardStateStore } from './store.js';
import { renderOperatorConsoleHtml } from './ui-template.js';

const UI_CONSOLE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../ui/operator-console'
);

const UI_STATIC_MIME: Record<string, string> = {
  '/': 'text/html; charset=utf-8',
  '/index.html': 'text/html; charset=utf-8',
  '/styles.css': 'text/css; charset=utf-8',
  '/app.js': 'application/javascript; charset=utf-8',
};

export class OperatorDashboardServer {
  private readonly store: DashboardStateStore;
  private server: http.Server | null = null;

  constructor(store?: DashboardStateStore) {
    this.store = store ?? new DashboardStateStore();
  }

  public getStore(): DashboardStateStore {
    return this.store;
  }

  public createRequestHandler(): http.RequestListener {
    return async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method ?? 'GET';

      // Set default CORS & JSON headers for API
      if (pathname.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json');
      }

      try {
        if (method === 'GET' && UI_STATIC_MIME[pathname] !== undefined) {
          this.serveStaticUiAsset(pathname, res);
          return;
        }

        if (method === 'GET' && pathname === '/api/health') {
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'ok', service: 'fable-engine-v3-dashboard' }));
          return;
        }

        if (method === 'GET' && pathname === '/api/workflows') {
          res.writeHead(200);
          res.end(JSON.stringify({ workflows: this.store.listWorkflowStates() }));
          return;
        }

        if (method === 'GET' && pathname === '/api/memos') {
          res.writeHead(200);
          res.end(JSON.stringify({ memos: this.store.listDecisionMemos() }));
          return;
        }

        if (method === 'GET' && pathname === '/api/telemetry') {
          res.writeHead(200);
          res.end(JSON.stringify({
            costs: this.store.metricsTracker.getAverageCostPerModule(),
            latency: this.store.metricsTracker.getLatencyStats(),
            blastRadius: this.store.metricsTracker.getBlastRadiusStats(),
          }));
          return;
        }

        if (method === 'GET' && pathname === '/api/capabilities') {
          const principal = this.parsePrincipalHeader(req);
          const tenantId = principal?.tenantId ?? 'default';
          const capabilities = principal
            ? {
                canApproveBlueprints: OpaPolicyEvaluator.evaluate({
                  principal,
                  action: 'APPROVE_BLUEPRINT',
                  resourceTenantId: tenantId,
                }).allowed,
                canOverrideCriticalThreats: OpaPolicyEvaluator.evaluate({
                  principal,
                  action: 'OVERRIDE_CRITICAL_THREAT',
                  resourceTenantId: tenantId,
                }).allowed,
                canResolveMemos: OpaPolicyEvaluator.evaluate({
                  principal,
                  action: 'RESOLVE_DECISION_MEMO',
                  resourceTenantId: tenantId,
                }).allowed,
                canPromoteProduction: OpaPolicyEvaluator.evaluate({
                  principal,
                  action: 'PROMOTE_PRODUCTION',
                  resourceTenantId: tenantId,
                }).allowed,
              }
            : {
                canApproveBlueprints: true,
                canOverrideCriticalThreats: true,
                canResolveMemos: true,
                canPromoteProduction: true,
              };

          res.writeHead(200);
          res.end(JSON.stringify({ principal, capabilities }));
          return;
        }

        // POST /api/workflows/:id/approve
        const approveMatch = /^\/api\/workflows\/([^/]+)\/approve$/.exec(pathname);
        if (method === 'POST' && approveMatch) {
          const workflowId = approveMatch[1]!;
          const body = await this.parseJsonBody(req);
          if (!this.enforceOpaIfPresent(req, res, 'APPROVE_BLUEPRINT')) return;
          const approvedBy = typeof body['approvedBy'] === 'string' ? body['approvedBy'] : 'operator';
          const updated = this.store.approveWorkflow(workflowId, approvedBy);
          res.writeHead(200);
          res.end(JSON.stringify({ workflow: updated }));
          return;
        }

        // POST /api/workflows/:id/promote
        const promoteMatch = /^\/api\/workflows\/([^/]+)\/promote$/.exec(pathname);
        if (method === 'POST' && promoteMatch) {
          const workflowId = promoteMatch[1]!;
          const body = await this.parseJsonBody(req);
          const authorId = typeof body['authorId'] === 'string' ? body['authorId'] : undefined;
          if (!this.enforceOpaIfPresent(req, res, 'PROMOTE_PRODUCTION', authorId)) return;
          const approvedBy = typeof body['approvedBy'] === 'string' ? body['approvedBy'] : 'release-manager';
          const targetEnv = body['targetEnvironment'] === 'STAGING' ? 'STAGING' : 'PRODUCTION';
          const updated = this.store.promoteWorkflowRelease(workflowId, approvedBy, targetEnv);
          res.writeHead(200);
          res.end(JSON.stringify({ workflow: updated }));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not Found' }));
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    };
  }

  public start(port: number = 3000): Promise<number> {
    return new Promise((resolve) => {
      this.server = http.createServer(this.createRequestHandler());
      this.server.listen(port, () => {
        const address = this.server?.address();
        const actualPort = typeof address === 'object' && address !== null ? address.port : port;
        resolve(actualPort);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(err => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private parsePrincipalHeader(req: http.IncomingMessage): OperatorPrincipal | null {
    const raw = req.headers['x-fable-principal'];
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      return JSON.parse(raw) as OperatorPrincipal;
    } catch {
      return null;
    }
  }

  private enforceOpaIfPresent(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    action: GovernanceAction,
    resourceAuthorId?: string
  ): boolean {
    const principal = this.parsePrincipalHeader(req);
    if (!principal) return true;

    const decision = OpaPolicyEvaluator.evaluate({
      principal,
      action,
      resourceTenantId: principal.tenantId,
      resourceAuthorId,
    });

    if (!decision.allowed) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Forbidden', reasons: decision.reasons }));
      return false;
    }

    return true;
  }

  private serveStaticUiAsset(pathname: string, res: http.ServerResponse): void {
    const fileName = pathname === '/' ? 'index.html' : pathname.slice(1);
    const fullPath = path.join(UI_CONSOLE_DIR, fileName);
    const mimeType = UI_STATIC_MIME[pathname] ?? 'text/plain; charset=utf-8';

    res.setHeader('Content-Type', mimeType);
    if (fs.existsSync(fullPath)) {
      res.writeHead(200);
      res.end(fs.readFileSync(fullPath, 'utf8'));
      return;
    }

    if (fileName === 'index.html') {
      res.writeHead(200);
      res.end(renderOperatorConsoleHtml());
      return;
    }

    res.writeHead(404);
    res.end('Asset not found');
  }

  private parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => {
        data += chunk;
      });
      req.on('end', () => {
        if (!data.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({});
        }
      });
    });
  }
}
