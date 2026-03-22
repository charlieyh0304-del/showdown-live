import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

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

// SW 업데이트 시 자동 새로고침 + 적극적 업데이트 체크
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });

  navigator.serviceWorker.getRegistration().then(reg => {
    if (reg) {
      // 즉시 업데이트 체크
      reg.update();
      // 30초마다 업데이트 체크
      setInterval(() => reg.update(), 30 * 1000);
      // 탭이 다시 활성화될 때 업데이트 체크
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
      // 네트워크 복구 시 업데이트 체크
      window.addEventListener('online', () => reg.update());
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
