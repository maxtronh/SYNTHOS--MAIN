import type { ModuleExecutionCostRecord } from './types.js';

export interface PercentileStats {
  count: number;
  p50: number;
  p95: number;
  max: number;
  min: number;
}

export class OperationalMetricsTracker {
  private records: ModuleExecutionCostRecord[] = [];

  public recordExecution(record: Omit<ModuleExecutionCostRecord, 'totalCostUsd' | 'recordedAt'>): ModuleExecutionCostRecord {
    const fullRecord: ModuleExecutionCostRecord = {
      ...record,
      totalCostUsd: record.llmCostUsd + record.computeCostUsd,
      recordedAt: new Date().toISOString(),
    };
    this.records.push(fullRecord);
    return fullRecord;
  }

  /**
   * Average cost per accepted module across all runs
   */
  public getAverageCostPerModule(): { avgLlmCost: number; avgComputeCost: number; avgTotalCost: number } {
    if (this.records.length === 0) {
      return { avgLlmCost: 0, avgComputeCost: 0, avgTotalCost: 0 };
    }

    const totalLlm = this.records.reduce((acc, r) => acc + r.llmCostUsd, 0);
    const totalCompute = this.records.reduce((acc, r) => acc + r.computeCostUsd, 0);
    const total = this.records.reduce((acc, r) => acc + r.totalCostUsd, 0);

    return {
      avgLlmCost: totalLlm / this.records.length,
      avgComputeCost: totalCompute / this.records.length,
      avgTotalCost: total / this.records.length,
    };
  }

  /**
   * Calculates P50 and P95 latency across recorded module executions
   */
  public getLatencyStats(): PercentileStats {
    if (this.records.length === 0) {
      return { count: 0, p50: 0, p95: 0, max: 0, min: 0 };
    }

    const latencies = this.records.map(r => r.pipelineLatencyMs).sort((a, b) => a - b);
    const count = latencies.length;

    const p50Index = Math.floor(count * 0.5);
    const p95Index = Math.min(count - 1, Math.floor(count * 0.95));

    return {
      count,
      p50: latencies[p50Index] ?? 0,
      p95: latencies[p95Index] ?? 0,
      min: latencies[0] ?? 0,
      max: latencies[count - 1] ?? 0,
    };
  }

  /**
   * Calculates blast radius resolution duration metrics
   */
  public getBlastRadiusStats(): PercentileStats {
    const blastTimes = this.records
      .filter((r): r is ModuleExecutionCostRecord & { blastRadiusResolutionMs: number } => r.blastRadiusResolutionMs !== undefined)
      .map(r => r.blastRadiusResolutionMs)
      .sort((a, b) => a - b);

    if (blastTimes.length === 0) {
      return { count: 0, p50: 0, p95: 0, max: 0, min: 0 };
    }

    const count = blastTimes.length;
    const p50Index = Math.floor(count * 0.5);
    const p95Index = Math.min(count - 1, Math.floor(count * 0.95));

    return {
      count,
      p50: blastTimes[p50Index] ?? 0,
      p95: blastTimes[p95Index] ?? 0,
      min: blastTimes[0] ?? 0,
      max: blastTimes[count - 1] ?? 0,
    };
  }
}
