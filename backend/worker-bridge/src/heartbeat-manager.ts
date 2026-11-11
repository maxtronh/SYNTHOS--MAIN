import type { ActivityHeartbeatRecord } from './types.js';

export class ActivityHeartbeatManager {
  private heartbeats: Map<string, ActivityHeartbeatRecord> = new Map();

  public registerActivity(
    activityId: string,
    workflowId: string,
    maxHeartbeatIntervalMs: number = 10000,
    nowMs: number = Date.now()
  ): void {
    this.heartbeats.set(activityId, {
      activityId,
      workflowId,
      lastHeartbeatTimeMs: nowMs,
      maxHeartbeatIntervalMs,
      status: 'HEALTHY',
    });
  }

  public recordHeartbeat(activityId: string, nowMs: number = Date.now()): void {
    const record = this.heartbeats.get(activityId);
    if (!record) return;
    record.lastHeartbeatTimeMs = nowMs;
    record.status = 'HEALTHY';
  }

  public evaluateTimeouts(nowMs: number = Date.now()): ActivityHeartbeatRecord[] {
    const timedOut: ActivityHeartbeatRecord[] = [];
    for (const record of this.heartbeats.values()) {
      if (nowMs - record.lastHeartbeatTimeMs > record.maxHeartbeatIntervalMs) {
        record.status = 'HEARTBEAT_TIMEOUT';
        timedOut.push(record);
      }
    }
    return timedOut;
  }

  public unregisterActivity(activityId: string): void {
    this.heartbeats.delete(activityId);
  }

  public getStatus(activityId: string): ActivityHeartbeatRecord | undefined {
    return this.heartbeats.get(activityId);
  }
}
