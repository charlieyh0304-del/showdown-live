import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { onConfirm, onPrompt, type ConfirmOptions, type PromptOptions } from '@shared/utils/confirm';

interface ActiveConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

export default function ConfirmDialog() {
  const { t } = useTranslation();
  const [active, setActive] = useState<ActiveConfirm | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    return onConfirm((options, resolve) => {
      setActive({ ...options, resolve });
    });
  }, []);

  // 다이얼로그 열릴 때 취소 버튼에 초점 (안전한 기본값)
  useEffect(() => {
    if (active) {
      cancelBtnRef.current?.focus();
    }
  }, [active]);

  const handleConfirm = useCallback(() => {
    active?.resolve(true);
    setActive(null);
  }, [active]);

  const handleCancel = useCallback(() => {
    active?.resolve(false);
    setActive(null);
  }, [active]);

  // ESC로 취소
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel();
    }
    // 포커스 트랩: Tab/Shift+Tab이 다이얼로그 밖으로 나가지 않도록
    if (e.key === 'Tab') {
      const first = cancelBtnRef.current;
      const last = confirmBtnRef.current;
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [handleCancel]);

  if (!active) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60"
      role="presentation"
      onClick={handleCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-message"
        className="card w-[90%] max-w-sm space-y-4"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <p id="confirm-dialog-message" className="text-gray-200 whitespace-pre-line">
          {active.message}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            ref={cancelBtnRef}
            className="btn btn-secondary"
            onClick={handleCancel}
          >
            {active.cancelLabel || t('common.cancel')}
          </button>
          <button
            ref={confirmBtnRef}
            className={active.destructive ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={handleConfirm}
          >
            {active.confirmLabel || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== PromptDialog — window.prompt() 대체 =====

interface ActivePrompt extends PromptOptions {
  resolve: (value: string | null) => void;
}

export function PromptDialog() {
  const { t } = useTranslation();
  const [active, setActive] = useState<ActivePrompt | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    return onPrompt((options, resolve) => {
      setValue(options.defaultValue || '');
      setActive({ ...options, resolve });
    });
  }, []);

  useEffect(() => {
    if (active) {
      inputRef.current?.focus();
    }
  }, [active]);

  const handleConfirm = useCallback(() => {
    active?.resolve(value || null);
    setActive(null);
    setValue('');
  }, [active, value]);

  const handleCancel = useCallback(() => {
    active?.resolve(null);
    setActive(null);
    setValue('');
  }, [active]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleCancel();
    if (e.key === 'Enter') handleConfirm();
  }, [handleCancel, handleConfirm]);

  if (!active) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60"
      role="presentation"
      onClick={handleCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-dialog-message"
        className="card w-[90%] max-w-sm space-y-4"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <p id="prompt-dialog-message" className="text-gray-200 whitespace-pre-line">
          {active.message}
        </p>
        <input
          ref={inputRef}
          type="text"
          className="input"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={active.placeholder || ''}
          aria-label={active.message}
        />
        <div className="flex gap-3 justify-end">
          <button
            ref={cancelBtnRef}
            className="btn btn-secondary"
            onClick={handleCancel}
          >
            {active.cancelLabel || t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleConfirm}
          >
            {active.confirmLabel || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
