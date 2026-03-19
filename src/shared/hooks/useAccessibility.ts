import { useState, useEffect, useCallback } from 'react';

export type ColorMode = 'dark' | 'high-contrast';

interface AccessibilitySettings {
  colorMode: ColorMode;
  fontSize: 'normal' | 'large' | 'xlarge';
}

const STORAGE_KEY = 'showdown_accessibility';

function loadSettings(): AccessibilitySettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { colorMode: 'dark', fontSize: 'normal' };
}

export function useAccessibility() {
  const [settings, setSettings] = useState<AccessibilitySettings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

    // Apply to document
    const root = document.documentElement;
    root.classList.remove('mode-dark', 'mode-high-contrast');
    root.classList.add(`mode-${settings.colorMode}`);

    root.classList.remove('font-normal', 'font-large', 'font-xlarge');
    root.classList.add(`font-${settings.fontSize}`);
  }, [settings]);

  const setColorMode = useCallback((mode: ColorMode) => {
    setSettings(s => ({ ...s, colorMode: mode }));
  }, []);

  const setFontSize = useCallback((size: 'normal' | 'large' | 'xlarge') => {
    setSettings(s => ({ ...s, fontSize: size }));
  }, []);

  return { settings, setColorMode, setFontSize };
}
