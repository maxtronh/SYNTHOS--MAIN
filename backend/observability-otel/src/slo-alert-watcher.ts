import type { SloBurnRateReport } from './types.js';
import { SloBurnRateEvaluator } from './slo-evaluator.js';
import { AlertRouter, type AlertChannelAdapter, AlertChannel } from './alert-router.js';

/**
 * A rule defining SLO targets and thresholds for a specific service.
 */
export interface AlertWatchRule {
  service: string;
  sloTargetAvailability: number;
  checkIntervalMs: number;
}

/**
 * Result of evaluating a single service against its SLO rule.
 */
export interface WatchResult {
  service: string;
  report: SloBurnRateReport;
  alertRouted: boolean;
  channel: AlertChannel | undefined;
  timestampMs: number;
}

/**
 * SLO Alert Watcher (Wave 5: Production Hardening).
 *
 * Watches configured services and evaluates their SLO burn rate on demand.
 * When a breach is detected (TICKET or CRITICAL_PAGE), it routes the alert
 * through the AlertRouter to the appropriate channel (PagerDuty or Slack).
 *
 * In production, this would be invoked on a cron interval (e.g. every 1-5 minutes)
 * by a scheduler or Temporal cron workflow.
 */
export class SloAlertWatcher {
  private readonly router: AlertRouter;
  private readonly rules = new Map<string, AlertWatchRule>();
  private readonly history: WatchResult[] = [];

  constructor(router: AlertRouter) {
    this.router = router;
  }

  /**
   * Register an SLO watch rule for a service.
   */
  public addRule(rule: AlertWatchRule): void {
    this.rules.set(rule.service, rule);
  }

  /**
   * Remove a watch rule for a service.
   */
  public removeRule(service: string): boolean {
    return this.rules.delete(service);
  }

  /**
   * Get all registered watch rules.
   */
  public getRules(): AlertWatchRule[] {
    return [...this.rules.values()];
  }

  /**
   * Evaluate a single service against its SLO rule and route alerts if breached.
   *
   * @param service - Service name to evaluate
   * @param totalRequests - Total requests observed in the window
   * @param failedRequests - Failed requests observed in the window
   * @returns WatchResult or null if no rule is registered for the service
   */
  public async evaluateService(
    service: string,
    totalRequests: number,
    failedRequests: number
  ): Promise<WatchResult | null> {
    const rule = this.rules.get(service);
    if (!rule) return null;

    const report = SloBurnRateEvaluator.evaluate({
      totalRequests,
      failedRequests,
      sloTargetAvailability: rule.sloTargetAvailability,
    });

    const result: WatchResult = {
      service,
      report,
      alertRouted: false,
      channel: undefined,
      timestampMs: Date.now(),
    };

    this.history.push(result);

    if (report.alertSeverity !== 'NONE') {
      const routeResult = await this.router.routeBurnRateReport(report, service);
      result.alertRouted = routeResult.routed.length > 0;
      result.channel = routeResult.routed[0]?.channel;
    }

    return result;
  }

  /**
   * Get the full evaluation history (most recent last).
   */
  public getHistory(): WatchResult[] {
    return [...this.history];
  }

  /**
   * Get the most recent evaluation result for a service.
   */
  public getLatest(service: string): WatchResult | undefined {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const entry = this.history[i];
      if (entry && entry.service === service) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Clear all evaluation history.
   */
  public clearHistory(): void {
    this.history.length = 0;
  }
}

/**
 * Fake alert channel adapter for testing.
 */
export class FakeAlertChannelAdapter implements AlertChannelAdapter {
  public readonly channel: AlertChannel;
  public readonly sent: Array<{ severity: string; service: string }> = [];

  constructor(channel: AlertChannel) {
    this.channel = channel;
  }

  public async send(alert: { severity: string; service: string }): Promise<void> {
    this.sent.push(alert);
  }
}