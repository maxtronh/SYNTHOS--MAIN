import type { SloBurnRateReport } from './types.js';

/**
 * Computes Google SRE-style SLO error budget burn rate and alert severity.
 * For example, with a 99.9% SLO (0.1% error budget):
 *   - burnRate >= 14.4 -> CRITICAL_PAGE (2% monthly budget burned in 1 hour)
 *   - burnRate >= 2.0  -> TICKET
 */
export class SloBurnRateEvaluator {
  public static evaluate(input: {
    totalRequests: number;
    failedRequests: number;
    sloTargetAvailability?: number;
  }): SloBurnRateReport {
    const sloTarget = input.sloTargetAvailability ?? 0.999;
    const errorBudget = 1 - sloTarget;

    if (input.totalRequests <= 0) {
      return {
        sloTargetAvailability: sloTarget,
        observedErrorRate: 0,
        burnRate: 0,
        alertSeverity: 'NONE',
      };
    }

    const observedErrorRate = input.failedRequests / input.totalRequests;
    const burnRate = errorBudget > 0 ? observedErrorRate / errorBudget : 0;

    let alertSeverity: SloBurnRateReport['alertSeverity'] = 'NONE';
    if (burnRate >= 14.4) {
      alertSeverity = 'CRITICAL_PAGE';
    } else if (burnRate >= 2.0) {
      alertSeverity = 'TICKET';
    }

    return {
      sloTargetAvailability: sloTarget,
      observedErrorRate,
      burnRate,
      alertSeverity,
    };
  }
}
