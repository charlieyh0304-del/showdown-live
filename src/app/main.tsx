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

// SW 업데이트 시 자동 새로고침 + 주기적 업데이트 체크
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });

  // 기존 SW가 있으면 즉시 업데이트 체크
  navigator.serviceWorker.getRegistration().then(reg => {
    if (reg) {
      reg.update();
      // 1분마다 업데이트 체크
      setInterval(() => reg.update(), 60 * 1000);
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
