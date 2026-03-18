import { useEffect } from 'react';

export function useNavigationGuard(shouldBlock: boolean, message: string = '경기가 진행 중입니다. 정말 이 페이지를 떠나시겠습니까?') {
  useEffect(() => {
    if (!shouldBlock) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [shouldBlock, message]);
}
