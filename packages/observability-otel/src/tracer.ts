import { TraceContextCodec } from './trace-context.js';
import type { ISpanExporter, SpanRecord, SpanStatus, TraceContext } from './types.js';

export class InMemorySpanExporter implements ISpanExporter {
  private readonly spans: SpanRecord[] = [];

  public exportSpan(span: SpanRecord): void {
    this.spans.push(span);
  }

  public getSpans(): SpanRecord[] {
    return [...this.spans];
  }

  public getSpansByTraceId(traceId: string): SpanRecord[] {
    return this.spans.filter(s => s.traceId === traceId);
  }
}

export class ActiveSpan {
  private readonly record: SpanRecord;
  private readonly exporter: ISpanExporter;
  private ended = false;

  constructor(
    record: SpanRecord,
    exporter: ISpanExporter
  ) {
    this.record = record;
    this.exporter = exporter;
  }

  public getContext(): TraceContext {
    return {
      traceId: this.record.traceId,
      spanId: this.record.spanId,
      traceFlags: '01',
    };
  }

  public setAttribute(key: string, value: string | number | boolean): void {
    this.record.attributes[key] = value;
  }

  public setStatus(status: SpanStatus, errorMessage?: string): void {
    this.record.status = status;
    if (errorMessage !== undefined) {
      this.record.errorMessage = errorMessage;
    }
  }

  public end(endTimeMs: number = Date.now()): SpanRecord {
    if (this.ended) return this.record;
    this.ended = true;
    this.record.endTimeMs = endTimeMs;
    this.record.durationMs = Math.max(0, endTimeMs - this.record.startTimeMs);
    if (this.record.status === 'UNSET') {
      this.record.status = 'OK';
    }
    this.exporter.exportSpan(this.record);
    return this.record;
  }
}

/**
 * OpenTelemetry-compatible Tracer propagating trace context across all 6 Fable tiers.
 */
export class FableTracer {
  private readonly exporter: ISpanExporter;

  constructor(exporter?: ISpanExporter) {
    this.exporter = exporter ?? new InMemorySpanExporter();
  }

  public startSpan(
    name: string,
    attributes: Record<string, string | number | boolean> = {},
    parentContext?: TraceContext | null,
    startTimeMs: number = Date.now()
  ): ActiveSpan {
    const traceId = parentContext?.traceId ?? TraceContextCodec.generateTraceId();
    const spanId = TraceContextCodec.generateSpanId();

    const record: SpanRecord = {
      traceId,
      spanId,
      parentSpanId: parentContext?.spanId,
      name,
      attributes: { ...attributes },
      status: 'UNSET',
      startTimeMs,
      endTimeMs: startTimeMs,
      durationMs: 0,
    };

    return new ActiveSpan(record, this.exporter);
  }
}
