export type SpanStatus = 'UNSET' | 'OK' | 'ERROR';

export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: string;
}

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string | undefined;
  name: string;
  attributes: Record<string, string | number | boolean>;
  status: SpanStatus;
  errorMessage?: string | undefined;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
}

export interface ISpanExporter {
  exportSpan(span: SpanRecord): void;
}

export interface SloBurnRateReport {
  sloTargetAvailability: number;
  observedErrorRate: number;
  burnRate: number;
  alertSeverity: 'NONE' | 'TICKET' | 'CRITICAL_PAGE';
}
