import { describe, it, expect } from 'vitest';
import {
  AlertRouter,
  SloBurnRateEvaluator,
  PagerDutyAdapter,
  SlackAdapter,
  type AlertChannelAdapter,
} from '../src/index.js';

describe('Phase 3: Observability Alerting Integration', () => {
  class FakeAdapter implements AlertChannelAdapter {
    public readonly channel: AlertChannel;
    public readonly sent: Array<{ severity: string; service: string }> = [];

    constructor(channel: AlertChannel) {
      this.channel = channel;
    }

    public async send(alert: { severity: string; service: string }): Promise<void> {
      this.sent.push(alert);
    }
  }

  it('routes CRITICAL_PAGE burns to PagerDuty channel', async () => {
    const pdAdapter = new FakeAdapter('PAGERDUTY');
    const slackAdapter = new FakeAdapter('SLACK');

    const router = new AlertRouter({
      service: 'fable-gateway',
      adapters: [pdAdapter, slackAdapter],
    });

    const report = SloBurnRateEvaluator.evaluate({
      totalRequests: 1000,
      failedRequests: 20,
      sloTargetAvailability: 0.999,
    });
    expect(report.alertSeverity).toBe('CRITICAL_PAGE');

    const result = await router.routeBurnRateReport(report);

    expect(result.routed.length).toBe(1);
    expect(result.suppressed).toBe(0);
    expect(result.routed[0]?.channel).toBe('PAGERDUTY');
    expect(result.routed[0]?.severity).toBe('CRITICAL_PAGE');
    expect(pdAdapter.sent.length).toBe(1);
    expect(pdAdapter.sent[0]?.service).toBe('fable-gateway');
  });

  it('routes TICKET burns to Slack channel', async () => {
    const pdAdapter = new FakeAdapter('PAGERDUTY');
    const slackAdapter = new FakeAdapter('SLACK');

    const router = new AlertRouter({
      service: 'fable-dashboard',
      adapters: [pdAdapter, slackAdapter],
    });

    const report = SloBurnRateEvaluator.evaluate({
      totalRequests: 1000,
      failedRequests: 3,
      sloTargetAvailability: 0.999,
    });
    expect(report.alertSeverity).toBe('TICKET');

    const result = await router.routeBurnRateReport(report);

    expect(result.routed[0]?.channel).toBe('SLACK');
    expect(result.routed[0]?.severity).toBe('TICKET');
    expect(slackAdapter.sent.length).toBe(1);
  });

  it('suppresses NONE severity alerts', async () => {
    const adapter = new FakeAdapter();
    const router = new AlertRouter({ service: 'fable-svc', adapters: [adapter] });

    const report = SloBurnRateEvaluator.evaluate({
      totalRequests: 1000,
      failedRequests: 0,
    });

    const result = await router.routeBurnRateReport(report);

    expect(result.suppressed).toBe(1);
    expect(result.routed.length).toBe(0);
    expect(adapter.sent.length).toBe(0);
  });

  it('tracks all emitted alerts and supports acknowledgment', async () => {
    const adapter = new FakeAdapter();
    const router = new AlertRouter({ service: 'fable-svc', adapters: [adapter] });

    await router.routeBurnRateReport(
      SloBurnRateEvaluator.evaluate({ totalRequests: 1000, failedRequests: 20 })
    );
    await router.routeBurnRateReport(
      SloBurnRateEvaluator.evaluate({ totalRequests: 1000, failedRequests: 3 })
    );

    const alerts = router.getAlerts();
    expect(alerts.length).toBe(2);
    expect(alerts[0]?.acknowledged).toBe(false);

    const acked = router.acknowledgeAlert(alerts[0].alertId);
    expect(acked).toBe(true);
    expect(router.getAlerts()[0]?.acknowledged).toBe(true);

    const notFound = router.acknowledgeAlert('nonexistent');
    expect(notFound).toBe(false);
  });

  it('supports PagerDutyAdapter and SlackAdapter instantiation', () => {
    const pd = new PagerDutyAdapter('integration-key-123');
    expect(pd.channel).toBe('PAGERDUTY');

    const slack = new SlackAdapter('https://hooks.slack.com/services/xxx');
    expect(slack.channel).toBe('SLACK');
  });
});