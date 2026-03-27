import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import '@shared/i18n';

// Apply saved accessibility settings before first render to prevent flash
const savedAccessibility = localStorage.getItem('showdown_accessibility');
if (savedAccessibility) {
  try {
    const s = JSON.parse(savedAccessibility);
    document.documentElement.classList.add(`mode-${s.colorMode || 'dark'}`);
    document.documentElement.classList.add(`font-${s.fontSize || 'normal'}`);
  } catch {
    document.documentElement.classList.add('mode-dark', 'font-normal');
  }
} else {
  document.documentElement.classList.add('mode-dark', 'font-normal');
}

// SW 업데이트 시 확인 후 새로고침
if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });

  navigator.serviceWorker.getRegistration().then(reg => {
    if (reg) {
      // 새 SW가 대기 중일 때: 심판 경기 중이면 대기, 아니면 적용
      const applyUpdate = () => {
        if (reg.waiting) {
          const path = window.location.pathname;
          const isScoring = path.includes('/referee/match/') || path.includes('/referee/team/') || path.includes('/referee/practice/play');
          if (isScoring) return; // 경기 진행중에는 새로고침 방지
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      };

      // 이미 대기 중인 SW가 있으면 즉시 알림
      if (reg.waiting) {
        applyUpdate();
      }

      // 새 SW 설치 완료 시 알림
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              applyUpdate();
            }
          });
        }
      });

      // 즉시 업데이트 체크
      reg.update();
      // 30초마다 업데이트 체크
      setInterval(() => reg.update(), 5 * 60 * 1000);
      // 탭이 다시 활성화될 때 업데이트 체크
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
      // 네트워크 복구 시 업데이트 체크
      window.addEventListener('online', () => reg.update());
    }
  });
}

// 앱 즉시 렌더링 (인증은 백그라운드에서 진행, DB 쓰기 시 authReady로 대기)
import '@shared/config/firebase';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
