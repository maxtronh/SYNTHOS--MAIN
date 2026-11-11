import type { RateLimiterConfig, RedisCommandClient } from './types.js';

export const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local current = redis.call('ZCARD', key)
if current < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return 1
end
return 0
`.trim();

export interface IRateLimiter {
  tryAcquire(bucketKey: string, nowMs?: number): Promise<boolean>;
}

/**
 * Production Redis-backed atomic sliding-window rate limiter using Lua.
 */
export class RedisSlidingWindowRateLimiter implements IRateLimiter {
  private readonly redis: RedisCommandClient;
  private readonly config: RateLimiterConfig;
  private sequence = 0;

  constructor(redisClient: RedisCommandClient, config: RateLimiterConfig) {
    this.redis = redisClient;
    this.config = config;
  }

  public async tryAcquire(bucketKey: string, nowMs: number = Date.now()): Promise<boolean> {
    this.sequence++;
    const uniqueMember = `${nowMs}-${this.sequence}`;
    const allowed = await this.redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      bucketKey,
      nowMs,
      this.config.windowMs,
      this.config.maxJobsPerWindow,
      uniqueMember
    );
    return allowed === 1;
  }
}

/**
 * Deterministic in-memory sliding-window rate limiter for local and CI execution.
 */
export class InMemorySlidingWindowRateLimiter implements IRateLimiter {
  private readonly config: RateLimiterConfig;
  private buckets = new Map<string, number[]>();

  constructor(config: RateLimiterConfig) {
    this.config = config;
  }

  public async tryAcquire(bucketKey: string, nowMs: number = Date.now()): Promise<boolean> {
    const windowStart = nowMs - this.config.windowMs;
    const timestamps = (this.buckets.get(bucketKey) ?? []).filter(t => t > windowStart);

    if (timestamps.length >= this.config.maxJobsPerWindow) {
      this.buckets.set(bucketKey, timestamps);
      return false;
    }

    timestamps.push(nowMs);
    this.buckets.set(bucketKey, timestamps);
    return true;
  }
}
