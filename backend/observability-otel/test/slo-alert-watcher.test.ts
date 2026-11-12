import { describe, it, expect } from 'vitest';
import {
  SloAlertWatcher,
  AlertRouter,
  FakeAlertChannelAdapter,
} from '../src/index.js';

describe('Phase 3 / Wave 5: SLO Alert Watcher Integration', () => {
  it('registers and retrieves watch rules', () => {
    const router = new AlertRouter({ service: 'test-svc' });
    const watcher = new SloAlertWatcher(router);

    watcher.addRule({ service: 'fable-gateway', sloTargetAvailability: 0.999, checkIntervalMs: 60000 });
    watcher.addRule({ service: 'fable-dashboard', sloTargetAvailability: 0.995, checkIntervalMs: 120000 });

    const rules = watcher.getRules();
    expect(rules.length).toBe(2);
    expect(rules.find(r => r.service === 'fable-gateway')?.sloTargetAvailability).toBe(0.999);
    expect(rules.find(r => r.service === 'fable-dashboard')?.sloTargetAvailability).toBe(0.995);
  });

  it('removes a watch rule', () => {
    const router = new AlertRouter({ service: 'test-svc' });
    const watcher = new SloAlertWatcher(router);

    watcher.addRule({ service: 'fable-gateway', sloTargetAvailability: 0.999, checkIntervalMs: 60000 });
    expect(watcher.getRules().length).toBe(1);

    const removed = watcher.removeRule('fable-gateway');
    expect(removed).toBe(true);
    expect(watcher.getRules().length).toBe(0);

    const notRemoved = watcher.removeRule('nonexistent');
    expect(notRemoved).toBe(false);
  });

  it('evaluates a healthy service with no alert routed', async () => {
    const pdAdapter = new FakeAlertChannelAdapter('PAGERDUTY');
    const slackAdapter = new FakeAlertChannelAdapter('SLACK');
    const router = new AlertRouter({ service: 'fable-gateway', adapters: [pdAdapter, slackAdapter] });
    const watcher = new SloAlertWatcher(router);

    watcher.addRule({ service: 'fable-gateway', sloTargetAvailability: 0.999, checkIntervalMs: 60000 });

    const result = await watcher.evaluateService('fable-gateway', 1000, 0);

    expect(result).not.toBeNull();
    expect(result!.report.alertSeverity).toBe('NONE');
    expect(result!.alertRouted).toBe(false);
    expect(result!.channel).toBeUndefined();
    expect(pdAdapter.sent.length).toBe(0);
    expect(slackAdapter.sent.length).toBe(0);
  });

  it('routes TICKET severity to Slack channel', async () => {
    const pdAdapter = new FakeAlertChannelAdapter('PAGERDUTY');
    const slackAdapter = new FakeAlertChannelAdapter('SLACK');
    const router = new AlertRouter({ service: 'fable-gateway', adapters: [pdAdapter, slackAdapter] });
    const watcher = new SloAlertWatcher(router);

    watcher.addRule({ service: 'fable-gateway', sloTargetAvailability: 0.999, checkIntervalMs: 60000 });

    const result = await watcher.evaluateService('fable-gateway', 1000, 3);

    expect(result).not.toBeNull();
    expect(result!.report.alertSeverity).toBe('TICKET');
    expect(result!.report.burnRate).toBeCloseTo(3.0);
    expect(result!.alertRouted).toBe(true);
    expect(result!.channel).toBe('SLACK');
    expect(slackAdapter.sent.length).toBe(1);
    expect(slackAdapter.sent[0]?.service).toBe('fable-gateway');
    expect(pdAdapter.sent.length).toBe(0);
  });

  it('routes CRITICAL_PAGE severity to PagerDuty channel', async () => {
    const pdAdapter = new FakeAlertChannelAdapter('PAGERDUTY');
    const slackAdapter = new FakeAlertChannelAdapter('SLACK');
    const router = new AlertRouter({ service: 'fable-gateway', adapters: [pdAdapter, slackAdapter] });
    const watcher = new SloAlertWatcher(router);

    watcher.addRule({ service: 'fable-gateway', sloTargetAvailability: 0.999, checkIntervalMs: 60000 });

    const result = await watcher.evaluateService('fable-gateway', 1000, 20);

    expect(result).not.toBeNull();
    expect(result!.report.alertSeverity).toBe('CRITICAL_PAGE');
    expect(result!.report.burnRate).toBeCloseTo(20.0);
    expect(result!.alertRouted).toBe(true);
    expect(result!.channel).toBe('PAGERDUTY');
    expect(pdAdapter.sent.length).toBe(1);
    expect(pdAdapter.sent[0]?.service).toBe('fable-gateway');
    expect(slackAdapter.sent.length).toBe(0);
  });

  it('returns null for a service with no registered rule', async () => {
    const router = new AlertRouter({ service: 'test-svc' });
    const watcher = new SloAlertWatcher(router);

    const result = await watcher.evaluateService('unknown-svc', 1000, 5);
    expect(result).toBeNull();
  });

  it('tracks evaluation history and exposes latest result', async () => {
    const adapter = new FakeAlertChannelAdapter('SLACK');
    const router = new AlertRouter({ service: 'fable-gateway', adapters: [adapter] });
    const watcher = new SloAlertWatcher(router);

    watcher.addRule({ service: 'fable-gateway', sloTargetAvailability: 0.999, checkIntervalMs: 60000 });

    await watcher.evaluateService('fable-gateway', 1000, 0);
    await watcher.evaluateService('fable-gateway', 1000, 20);

    const history = watcher.getHistory();
    expect(history.length).toBe(2);
    expect(history[0]?.report.alertSeverity).toBe('NONE');
    expect(history[1]?.report.alertSeverity).toBe('CRITICAL_PAGE');

    const latest = watcher.getLatest('fable-gateway');
    expect(latest?.report.alertSeverity).toBe('CRITICAL_PAGE');

    const nonexistent = watcher.getLatest('unknown-svc');
    expect(nonexistent).toBeUndefined();
  });

  it('clears history when requested', async () => {
    const adapter = new FakeAlertChannelAdapter('SLACK');
    const router = new AlertRouter({ service: 'fable-gateway', adapters: [adapter] });
    const watcher = new SloAlertWatcher(router);

    watcher.addRule({ service: 'fable-gateway', sloTargetAvailability: 0.999, checkIntervalMs: 60000 });
    await watcher.evaluateService('fable-gateway', 1000, 20);
    expect(watcher.getHistory().length).toBe(1);

    watcher.clearHistory();
    expect(watcher.getHistory().length).toBe(0);
  });
});