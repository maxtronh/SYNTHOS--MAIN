import { describe, it, expect, vi } from 'vitest';
import {
  AlertRouter,
  PagerDutyHttpAdapter,
  SlackWebhookHttpAdapter,
  type AlertFetchFn,
} from '../src/index.js';

describe('P31/P36: Live HTTP Alert Webhook Adapters', () => {
  it('dispatches PagerDuty Events v2 JSON payloads for CRITICAL_PAGE alerts', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const mockFetch: AlertFetchFn = vi.fn(async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ status: 'success' }), { status: 202 });
    });

    const router = new AlertRouter({
      service: 'fable-prod',
      adapters: [new PagerDutyHttpAdapter('pd-routing-key-123', { fetchFn: mockFetch })],
    });

    await router.routeBurnRateReport({
      sloTargetAvailability: 0.999,
      observedErrorRate: 0.02,
      burnRate: 20,
      alertSeverity: 'CRITICAL_PAGE',
    });

    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe('https://events.pagerduty.com/v2/enqueue');
    expect(calls[0]?.body['routing_key']).toBe('pd-routing-key-123');
    expect(calls[0]?.body['event_action']).toBe('trigger');
  });

  it('dispatches Slack Block Kit payloads for TICKET alerts and throws on non-2xx failure', async () => {
    const okFetch: AlertFetchFn = vi.fn(async () => new Response('ok', { status: 200 }));
    const router = new AlertRouter({
      service: 'fable-prod',
      adapters: [new SlackWebhookHttpAdapter('https://hooks.slack.com/services/T00/B00/XXX', { fetchFn: okFetch })],
    });

    await router.routeBurnRateReport({
      sloTargetAvailability: 0.999,
      observedErrorRate: 0.003,
      burnRate: 3.0,
      alertSeverity: 'TICKET',
    });

    expect(okFetch).toHaveBeenCalledTimes(1);

    const errFetch: AlertFetchFn = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const failingAdapter = new SlackWebhookHttpAdapter('https://hooks.slack.com/services/fail', { fetchFn: errFetch });
    const sampleAlert = router.getAlerts()[0]!;

    await expect(failingAdapter.send(sampleAlert)).rejects.toThrow('Alert webhook delivery failed (429)');
  });
});
