import http from 'http';
import { DashboardStateStore } from './store.js';
import { renderOperatorConsoleHtml } from './ui-template.js';

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
        if (method === 'GET' && pathname === '/') {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.writeHead(200);
          res.end(renderOperatorConsoleHtml());
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

        // POST /api/workflows/:id/approve
        const approveMatch = /^\/api\/workflows\/([^/]+)\/approve$/.exec(pathname);
        if (method === 'POST' && approveMatch) {
          const workflowId = approveMatch[1]!;
          const body = await this.parseJsonBody(req);
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
