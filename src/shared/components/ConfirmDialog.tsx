import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { onConfirm, type ConfirmOptions } from '@shared/utils/confirm';

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
