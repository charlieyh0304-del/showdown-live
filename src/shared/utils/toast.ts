export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastEvent {
  message: string;
  type: ToastType;
  duration: number;
}

type ToastListener = (event: ToastEvent) => void;
const listeners: Set<ToastListener> = new Set();

export function onToast(cb: ToastListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 3000,
  error: 5000,
  warning: 5000,
  info: 4000,
};

export function showToast(message: string, type: ToastType = 'info', duration?: number): void {
  listeners.forEach(cb => cb({ message, type, duration: duration ?? DEFAULT_DURATIONS[type] }));
}

export function showSuccess(message: string, duration?: number): void {
  showToast(message, 'success', duration);
}

export function showError(message: string, duration?: number): void {
  showToast(message, 'error', duration);
}

export function showWarning(message: string, duration?: number): void {
  showToast(message, 'warning', duration);
}
