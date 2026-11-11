import { describe, it, expect } from 'vitest';
import {
  TraceContextCodec,
  FableTracer,
  InMemorySpanExporter,
  SloBurnRateEvaluator,
} from '../src/index.js';

describe('Phase 28: OpenTelemetry Tracing & SLO Burn-Rate Suite', () => {
  it('parses and formats valid W3C traceparent headers and rejects invalid ones', () => {
    const traceId = TraceContextCodec.generateTraceId();
    const spanId = TraceContextCodec.generateSpanId();
    const header = TraceContextCodec.format({ traceId, spanId, traceFlags: '01' });

    const parsed = TraceContextCodec.parse(header);
    expect(parsed).toEqual({ traceId, spanId, traceFlags: '01' });

    expect(TraceContextCodec.parse('invalid-header')).toBeNull();
    expect(TraceContextCodec.parse('00-00000000000000000000000000000000-1111111111111111-01')).toBeNull();
  });

  it('propagates traceId cleanly across parent workflow and child sandbox spans', () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new FableTracer(exporter);

    const rootSpan = tracer.startSpan('fable.workflow.execute', {
      'fable.workflow_id': 'wf-otel-1',
    }, null, 1000);

    const childSpan = tracer.startSpan('fable.sandbox.gate_l0', {
      'fable.sandbox_path': 'PATH_A_EPHEMERAL',
    }, rootSpan.getContext(), 1100);

    childSpan.setStatus('OK');
    childSpan.end(1450);

    rootSpan.end(1500);

    const traceSpans = exporter.getSpansByTraceId(rootSpan.getContext().traceId);
    expect(traceSpans.length).toBe(2);

    const recordedChild = traceSpans.find(s => s.name === 'fable.sandbox.gate_l0');
    expect(recordedChild?.parentSpanId).toBe(rootSpan.getContext().spanId);
    expect(recordedChild?.durationMs).toBe(350);
  });

  it('evaluates SLO error budget burn rate thresholds accurately', () => {
    // 0 errors -> NONE
    expect(
      SloBurnRateEvaluator.evaluate({ totalRequests: 1000, failedRequests: 0 }).alertSeverity
    ).toBe('NONE');

    // 0.3% error rate against 0.1% budget (3x burn rate) -> TICKET
    const ticket = SloBurnRateEvaluator.evaluate({ totalRequests: 1000, failedRequests: 3 });
    expect(ticket.burnRate).toBeCloseTo(3.0);
    expect(ticket.alertSeverity).toBe('TICKET');

    // 2.0% error rate against 0.1% budget (20x burn rate >= 14.4x) -> CRITICAL_PAGE
    const page = SloBurnRateEvaluator.evaluate({ totalRequests: 1000, failedRequests: 20 });
    expect(page.burnRate).toBeCloseTo(20.0);
    expect(page.alertSeverity).toBe('CRITICAL_PAGE');
  });
});
