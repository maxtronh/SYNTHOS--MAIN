import crypto from 'crypto';
import type { TraceContext } from './types.js';

const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * W3C TraceContext parser and formatter (`traceparent` header).
 */
export class TraceContextCodec {
  public static generateTraceId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  public static generateSpanId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  public static format(ctx: TraceContext): string {
    return `00-${ctx.traceId}-${ctx.spanId}-${ctx.traceFlags}`;
  }

  public static parse(headerValue: string): TraceContext | null {
    const match = TRACEPARENT_REGEX.exec(headerValue.trim().toLowerCase());
    if (!match) return null;

    const [, traceId, spanId, traceFlags] = match;
    if (!traceId || !spanId || !traceFlags) return null;
    if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;

    return { traceId, spanId, traceFlags };
  }
}
