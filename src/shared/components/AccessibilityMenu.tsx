import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccessibility, type ColorMode } from '../hooks/useAccessibility';

export default function AccessibilityMenu() {
  const [open, setOpen] = useState(false);
  const { settings, setColorMode, setFontSize } = useAccessibility();
  const [announcement, setAnnouncement] = useState('');
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape key closes menu; focus trap inside panel
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    // Focus first button in panel
    const timer = setTimeout(() => {
      const firstBtn = panelRef.current?.querySelector<HTMLElement>('button');
      firstBtn?.focus();
    }, 0);
    return () => { document.removeEventListener('keydown', handleKeyDown); clearTimeout(timer); };
  }, [open]);

  const handleColorMode = (mode: ColorMode) => {
    setColorMode(mode);
    const label = mode === 'dark' ? t('common.accessibility.darkMode') : t('common.accessibility.highContrastMode');
    setAnnouncement(t('common.accessibility.switchedTo', { label }));
  };

  const handleFontSize = (size: 'normal' | 'large' | 'xlarge') => {
    setFontSize(size);
    const label = size === 'normal' ? t('common.accessibility.fontSizeNormal') : size === 'large' ? t('common.accessibility.fontSizeLarge') : t('common.accessibility.fontSizeXLarge');
    setAnnouncement(t('common.accessibility.fontSizeChanged', { label }));
  };

  return (
    <>
      <div aria-live="assertive" className="sr-only">{announcement}</div>
      <div className="fixed bottom-4 right-4 z-50">
        <button
          ref={triggerRef}
          onClick={() => setOpen(!open)}
          className="w-14 h-14 rounded-full bg-yellow-500 text-black font-bold text-2xl shadow-lg hover:bg-yellow-400 focus:outline-none focus:ring-4 focus:ring-yellow-300"
          aria-label={t('common.accessibility.openSettings')}
          aria-expanded={open}
        >
          ♿
        </button>

        {open && (
          <div
            ref={panelRef}
            className="absolute bottom-16 right-0 w-72 bg-gray-900 border-2 border-yellow-400 rounded-xl shadow-2xl p-4 space-y-4"
            role="dialog"
            aria-modal="true"
            aria-label={t('common.accessibility.settings')}
          >
            <h3 className="text-lg font-bold text-yellow-400">{t('common.accessibility.settings')}</h3>

            {/* Color mode */}
            <fieldset>
              <legend className="font-semibold mb-2">{t('common.accessibility.screenMode')}</legend>
              <div className="flex gap-2">
                {([
                  { value: 'dark' as const, labelKey: 'common.accessibility.dark' },
                  { value: 'high-contrast' as const, labelKey: 'common.accessibility.highContrast' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleColorMode(opt.value)}
                    className={`btn flex-1 ${settings.colorMode === opt.value ? 'btn-primary ring-2 ring-yellow-400' : 'bg-gray-700 text-white'}`}
                    aria-pressed={settings.colorMode === opt.value}
                    aria-label={t('common.accessibility.modeLabel', { label: t(opt.labelKey), selected: settings.colorMode === opt.value ? t('common.accessibility.selected') : '' })}
                  >
                    {t(opt.labelKey)}
                    {settings.colorMode === opt.value && ' ✓'}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Font size */}
            <fieldset>
              <legend className="font-semibold mb-2">{t('common.accessibility.fontSize')}</legend>
              <div className="flex gap-2">
                {([
                  { value: 'normal' as const, labelKey: 'common.accessibility.fontSizeNormal' },
                  { value: 'large' as const, labelKey: 'common.accessibility.fontSizeLarge' },
                  { value: 'xlarge' as const, labelKey: 'common.accessibility.fontSizeXLarge' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleFontSize(opt.value)}
                    className={`btn flex-1 text-sm ${settings.fontSize === opt.value ? 'btn-primary ring-2 ring-yellow-400' : 'bg-gray-700 text-white'}`}
                    aria-pressed={settings.fontSize === opt.value}
                    aria-label={t('common.accessibility.fontSizeLabel', { label: t(opt.labelKey), selected: settings.fontSize === opt.value ? t('common.accessibility.selected') : '' })}
                  >
                    {t(opt.labelKey)}
                    {settings.fontSize === opt.value && ' ✓'}
                  </button>
                ))}
              </div>
            </fieldset>

            <button
              className="btn btn-secondary w-full"
              onClick={() => setOpen(false)}
              aria-label={t('common.accessibility.closeSettings')}
            >
              {t('common.close')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
