import { describe, it, expect, vi } from 'vitest';
import { onConfirm, showConfirm } from './confirm';

describe('confirm event bus', () => {
  it('showConfirm returns true when no listener and no window (node env)', async () => {
    const result = await showConfirm({ message: 'test' });
    expect(result).toBe(true);
  });

  it('showConfirm resolves true when listener confirms', async () => {
    const unsub = onConfirm((opts, resolve) => {
      expect(opts.message).toBe('delete?');
      resolve(true);
    });
    const result = await showConfirm({ message: 'delete?' });
    expect(result).toBe(true);
    unsub();
  });

  it('showConfirm resolves false when listener cancels', async () => {
    const unsub = onConfirm((_opts, resolve) => {
      resolve(false);
    });
    const result = await showConfirm({ message: 'cancel me' });
    expect(result).toBe(false);
    unsub();
  });

  it('passes destructive and label options', async () => {
    const unsub = onConfirm((opts, resolve) => {
      expect(opts.destructive).toBe(true);
      expect(opts.confirmLabel).toBe('Delete');
      expect(opts.cancelLabel).toBe('Keep');
      resolve(true);
    });
    await showConfirm({
      message: 'test',
      destructive: true,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    unsub();
  });

  it('unsubscribe falls back to default (true in node env)', async () => {
    const unsub = onConfirm((_opts, resolve) => resolve(true));
    unsub();
    const result = await showConfirm({ message: 'after unsub' });
    expect(result).toBe(true);
  });
});
