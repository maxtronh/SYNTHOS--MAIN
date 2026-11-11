import type { IdempotencyLock } from './types.js';

export class DistributedLockManager {
  private locks: Map<string, IdempotencyLock> = new Map();

  /**
   * Acquire a distributed idempotency lock (equivalent to Redis SET NX PX).
   */
  public acquireLock(
    lockKey: string,
    ownerId: string,
    ttlMs: number = 30000
  ): boolean {
    const now = Date.now();
    const existing = this.locks.get(lockKey);

    if (existing && existing.expiresAtMs > now && existing.ownerId !== ownerId) {
      // Lock is held by another active process
      return false;
    }

    this.locks.set(lockKey, {
      lockKey,
      ownerId,
      acquiredAt: new Date(now).toISOString(),
      expiresAtMs: now + ttlMs,
    });

    return true;
  }

  /**
   * Release lock safely if owner matches.
   */
  public releaseLock(lockKey: string, ownerId: string): boolean {
    const existing = this.locks.get(lockKey);
    if (!existing || existing.ownerId !== ownerId) {
      return false;
    }

    this.locks.delete(lockKey);
    return true;
  }

  public isLocked(lockKey: string): boolean {
    const existing = this.locks.get(lockKey);
    if (!existing) return false;
    return existing.expiresAtMs > Date.now();
  }

  public getActiveLocks(): IdempotencyLock[] {
    const now = Date.now();
    return Array.from(this.locks.values()).filter(l => l.expiresAtMs > now);
  }
}
