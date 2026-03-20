import { useState, useEffect, useCallback } from 'react';
import { getPendingCount } from '../utils/offlineQueue';

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const updatePendingCount = useCallback(() => {
    setPendingCount(getPendingCount());
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowReconnected(true);
      updatePendingCount();
      // Hide the "reconnected" banner after 3 seconds
      setTimeout(() => setShowReconnected(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowReconnected(false);
      updatePendingCount();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Periodically check pending count while offline
    const interval = setInterval(updatePendingCount, 2000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [updatePendingCount]);

  if (isOnline && !showReconnected) return null;

  if (isOnline && showReconnected) {
    return (
      <div
        className="fixed top-0 left-0 right-0 bg-green-700 text-white text-center py-2 z-[60] text-lg font-bold transition-opacity duration-500"
        role="status"
        aria-live="polite"
      >
        온라인 복구됨
      </div>
    );
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 bg-yellow-600 text-white text-center py-2 z-[60] text-lg font-bold"
      role="alert"
      aria-live="assertive"
    >
      오프라인 모드 - 데이터가 자동 동기화됩니다
      {pendingCount > 0 && (
        <span className="ml-2 text-sm font-normal">
          (대기 중: {pendingCount}건)
        </span>
      )}
    </div>
  );
}
