import type { SloBurnRateReport } from './types.js';

/**
 * Notification channel destinations for SLO burn-rate alerts.
 */
export type AlertChannel = 'PAGERDUTY' | 'SLACK' | 'EMAIL';

/**
 * A single alert produced by the alert router.
 */
export interface AlertRecord {
  alertId: string;
  severity: 'NONE' | 'TICKET' | 'CRITICAL_PAGE';
  burnRate: number;
  sloTargetAvailability: number;
  observedErrorRate: number;
  service: string;
  channel: AlertChannel;
  timestampMs: number;
  acknowledged: boolean;
}

/**
 * Result of routing an alert batch.
 */
export interface AlertRouteResult {
  routed: AlertRecord[];
  suppressed: number;
  total: number;
}

/**
 * AlertRouter (Phase 3: External Integrations).
 *
 * Routes SLO burn-rate evaluations to notification channels based on severity:
 *   - CRITICAL_PAGE -> PagerDuty (immediate page)
 *   - TICKET        -> Slack (ticket created)
 *   - NONE          -> suppressed (no notification)
 *
 * In production, channel adapters POST to PagerDuty Events API v2 and Slack
 * Incoming Webhooks. Here adapters are pluggable interfaces so the router can
 * be tested without network calls.
 */
export interface AlertChannelAdapter {
  channel: AlertChannel;
  send(alert: AlertRecord): Promise<void>;
}

export class AlertRouter {
  private readonly adapters = new Map<AlertChannel, AlertChannelAdapter>();
  private readonly alerts: AlertRecord[] = [];
  private alertCounter = 0;

  constructor(options: { service?: string; adapters?: AlertChannelAdapter[] } = {}) {
    this.service = options.service ?? 'fable-engine-v3';
    for (const adapter of options.adapters ?? []) {
      this.adapters.set(adapter.channel, adapter);
    }
  }

  private readonly service: string;

  /**
   * Register a channel adapter (e.g. PagerDuty, Slack, Email).
   */
  registerAdapter(adapter: AlertChannelAdapter): void {
    this.adapters.set(adapter.channel, adapter);
  }

  /**
   * Evaluate an SLO burn-rate report and route alerts to the appropriate channel.
   *
   * Returns which alerts were routed and how many were suppressed (NONE severity).
   */
  public async routeBurnRateReport(
    report: SloBurnRateReport,
    serviceOverride?: string
  ): Promise<AlertRouteResult> {
    const service = serviceOverride ?? this.service;
    let suppressed = 0;

    if (report.alertSeverity === 'NONE') {
      suppressed++;
      return { routed: [], suppressed, total: 1 };
    }

    const alert: AlertRecord = {
      alertId: `alert-${this.service}-${++this.alertCounter}`,
      severity: report.alertSeverity,
      burnRate: report.burnRate,
      sloTargetAvailability: report.sloTargetAvailability,
      observedErrorRate: report.observedErrorRate,
      service,
      channel: this.channelForSeverity(report.alertSeverity),
      timestampMs: Date.now(),
      acknowledged: false,
    };

    this.alerts.push(alert);

    const adapter = this.adapters.get(alert.channel);
    if (adapter) {
      await adapter.send(alert);
    }

    return { routed: [alert], suppressed, total: 1 };
  }

  /**
   * Get all alerts emitted by this router (for test assertions).
   */
  public getAlerts(): AlertRecord[] {
    return [...this.alerts];
  }

  /**
   * Mark an alert as acknowledged (e.g. after PagerDuty acknowledge).
   */
  public acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.alertId === alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    return true;
  }

  private channelForSeverity(severity: 'NONE' | 'TICKET' | 'CRITICAL_PAGE'): AlertChannel {
    switch (severity) {
      case 'CRITICAL_PAGE':
        return 'PAGERDUTY';
      case 'TICKET':
        return 'SLACK';
      case 'NONE':
      default:
        return 'SLACK';
    }
  }
}

/**
 * Example PagerDuty adapter (skeleton for production wiring).
 * Posts to PagerDuty Events API v2 in production.
 */
export class PagerDutyAdapter implements AlertChannelAdapter {
  public readonly channel: AlertChannel = 'PAGERDUTY';
  constructor(private readonly integrationKey: string) {}

  public async send(alert: AlertRecord): Promise<void> {
    // Production: POST to https://events.pagerduty.com/v2/enqueue
    // with routing_key, event_action, payload, client, client_url.
    // Here we record intent without network access.
    void this.integrationKey;
    void alert;
  }
}

/**
 * Example Slack adapter (skeleton for production wiring).
 * Posts to Slack Incoming Webhook URL in production.
 */
export class SlackAdapter implements AlertChannelAdapter {
  public readonly channel: AlertChannel = 'SLACK';
  constructor(private readonly webhookUrl: string) {}

  public async send(alert: AlertRecord): Promise<void> {
    // Production: POST JSON to webhookUrl with blocks/text.
    void this.webhookUrl;
    void alert;
  }
}

