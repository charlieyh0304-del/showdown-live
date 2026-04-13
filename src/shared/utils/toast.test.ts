import { describe, it, expect, vi } from 'vitest';
import { onToast, showToast, showSuccess, showError, showWarning } from './toast';

describe('toast event bus', () => {
  it('onToast receives showToast events', () => {
    const cb = vi.fn();
    const unsub = onToast(cb);
    showToast('hello', 'info');
    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0]).toMatchObject({ message: 'hello', type: 'info' });
    unsub();
  });

  it('showSuccess sends success type with 3s default', () => {
    const cb = vi.fn();
    const unsub = onToast(cb);
    showSuccess('done');
    expect(cb.mock.calls[0][0]).toMatchObject({ type: 'success', duration: 3000 });
    unsub();
  });

  it('showError sends error type with 5s default', () => {
    const cb = vi.fn();
    const unsub = onToast(cb);
    showError('fail');
    expect(cb.mock.calls[0][0]).toMatchObject({ type: 'error', duration: 5000 });
    unsub();
  });

  it('showWarning sends warning type', () => {
    const cb = vi.fn();
    const unsub = onToast(cb);
    showWarning('warn');
    expect(cb.mock.calls[0][0]).toMatchObject({ type: 'warning', duration: 5000 });
    unsub();
  });

  it('custom duration overrides default', () => {
    const cb = vi.fn();
    const unsub = onToast(cb);
    showToast('msg', 'info', 1000);
    expect(cb.mock.calls[0][0].duration).toBe(1000);
    unsub();
  });

  it('unsubscribe stops receiving events', () => {
    const cb = vi.fn();
    const unsub = onToast(cb);
    unsub();
    showToast('after unsub', 'info');
    expect(cb).not.toHaveBeenCalled();
  });

  it('multiple listeners all receive events', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = onToast(cb1);
    const unsub2 = onToast(cb2);
    showToast('multi', 'info');
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
    unsub1();
    unsub2();
  });
});
