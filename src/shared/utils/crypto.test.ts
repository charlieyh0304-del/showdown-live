import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimiter } from './crypto';

describe('createRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows attempts before max failures', () => {
    const rl = createRateLimiter(3, 5000);
    expect(rl.canAttempt()).toBe(true);
    rl.recordFailure();
    expect(rl.canAttempt()).toBe(true);
    rl.recordFailure();
    expect(rl.canAttempt()).toBe(true);
  });

  it('locks after max failures', () => {
    const rl = createRateLimiter(3, 5000);
    rl.recordFailure();
    rl.recordFailure();
    rl.recordFailure(); // 3rd failure triggers lockout
    expect(rl.canAttempt()).toBe(false);
  });

  it('remainingLockout returns positive ms during lockout', () => {
    const rl = createRateLimiter(2, 10000);
    rl.recordFailure();
    rl.recordFailure();
    const remaining = rl.remainingLockout();
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(10000);
  });

  it('unlocks after lockout period', () => {
    const rl = createRateLimiter(2, 5000);
    rl.recordFailure();
    rl.recordFailure();
    expect(rl.canAttempt()).toBe(false);
    vi.advanceTimersByTime(5001);
    expect(rl.canAttempt()).toBe(true);
  });

  it('recordSuccess resets failures', () => {
    const rl = createRateLimiter(3, 5000);
    rl.recordFailure();
    rl.recordFailure();
    rl.recordSuccess();
    rl.recordFailure();
    rl.recordFailure();
    // Only 2 failures after reset, not locked
    expect(rl.canAttempt()).toBe(true);
  });

  it('remainingLockout returns 0 when not locked', () => {
    const rl = createRateLimiter(5, 10000);
    expect(rl.remainingLockout()).toBe(0);
  });
});
