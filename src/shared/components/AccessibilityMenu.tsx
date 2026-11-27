import { useState, useRef, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccessibility } from '../hooks/useAccessibility';
import { COLOR_MODES, FONT_SCALES, effectiveReduceMotion, type ColorMode } from '../utils/a11ySettings';
import { isVoiceEnabled, setVoiceEnabled } from '../utils/voicePreference';

const K = 'common.accessibility';

const COLOR_MODE_KEYS: Record<ColorMode, string> = {
  dark: `${K}.dark`,
  light: `${K}.light`,
  'high-contrast': `${K}.highContrast`,
  'high-contrast-light': `${K}.highContrastLight`,
  invert: `${K}.invert`,
};

/**
 * 접근성 설정 (오른쪽 아래 버튼). 색 반전 모드에서도 이 버튼과 창은 반전하지 않는다(a11y-no-invert).
 * 선택지는 기본 라디오·스위치로 만들어 화면낭독기가 상태를 바로 읽는다. 바꾸면 결과를 aria-live로 알린다.
 */
export default function AccessibilityMenu({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const { settings, update, setColorMode, stepFont, reset } = useAccessibility();
  const [announcement, setAnnouncement] = useState('');
  const { t } = useTranslation();
  const uid = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // 음성 안내 켜기·끄기는 없앴다(소유자 결정). 예전에 켜 둔 기기가 끌 방법 없이 계속 말하지 않도록 한 번 끈다.
  useEffect(() => { if (isVoiceEnabled()) setVoiceEnabled(false); }, []);

  // Escape로 닫고 버튼으로 초점 복귀, 창 안에서 Tab 순환
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
          .filter(el => !(el instanceof HTMLInputElement && el.type === 'radio' && !el.checked));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    const timer = setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('h2')?.focus();
    }, 0);
    return () => { document.removeEventListener('keydown', handleKeyDown); clearTimeout(timer); };
  }, [open]);

  const say = (msg: string) => setAnnouncement(msg);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleColorMode = (mode: ColorMode) => {
    setColorMode(mode);
    say(t(`${K}.switchedTo`, { label: t(COLOR_MODE_KEYS[mode]) }));
  };

  const fontLabel = (level: number) => t(`${K}.fontLevel`, { n: level + 1, percent: Math.round(FONT_SCALES[level] * 100) });

  const handleFontLevel = (level: number) => {
    update({ fontLevel: level });
    say(t(`${K}.fontSizeChanged`, { label: fontLabel(level) }));
  };

  const handleStep = (delta: number) => {
    const next = stepFont(delta);
    say(t(`${K}.fontSizeChanged`, { label: fontLabel(next.fontLevel) }));
  };

  type SwitchKey = 'strongFocus' | 'reduceMotion';
  // 움직임 줄이기는 직접 고르기 전(null)에는 기기 설정 값을 보여 준다
  const switchValue = (key: SwitchKey): boolean => (key === 'reduceMotion' ? effectiveReduceMotion(settings) : settings[key]);

  const handleSwitch = (key: SwitchKey, labelKey: string) => {
    const next = !switchValue(key);
    update({ [key]: next });
    say(t(next ? `${K}.turnedOn` : `${K}.turnedOff`, { label: t(labelKey) }));
  };

  const handleReset = () => {
    reset();
    say(t(`${K}.resetDone`));
  };

  const radioGroup = <V extends string | number>(
    name: string,
    legend: string,
    options: ReadonlyArray<{ value: V; label: string }>,
    selected: V,
    onChange: (v: V) => void,
  ) => (
    <fieldset className="space-y-1">
      <legend className="font-semibold mb-1">{legend}</legend>
      {options.map(opt => {
        const id = `${uid}-${name}-${opt.value}`;
        return (
          <label key={String(opt.value)} htmlFor={id} className={`flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer ${selected === opt.value ? 'bg-yellow-400 text-black font-bold' : 'bg-gray-800 text-white'}`} style={{ minHeight: '44px' }}>
            <input
              id={id}
              type="radio"
              name={`${uid}-${name}`}
              checked={selected === opt.value}
              onChange={() => onChange(opt.value)}
              style={{ width: '1.25rem', height: '1.25rem', minHeight: 0 }}
            />
            <span>{opt.label}</span>
          </label>
        );
      })}
    </fieldset>
  );

  const switchRow = (key: SwitchKey, labelKey: string, helpKey: string) => {
    const on = switchValue(key);
    return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby={`${uid}-${key}-help`}
        onClick={() => handleSwitch(key, labelKey)}
        className={`btn w-full text-base ${on ? 'btn-primary ring-2 ring-yellow-400' : 'bg-gray-700 text-white'}`}
      >
        {t(labelKey)}: {on ? t(`${K}.on`) : t(`${K}.off`)}
      </button>
      <p id={`${uid}-${key}-help`} className="text-sm text-gray-400 mt-1">{t(helpKey)}</p>
    </div>
    );
  };

  return (
    <>
      <div aria-live="polite" role="status" className="sr-only">{announcement}</div>
      {/* 되돌림 필터(a11y-no-invert)는 고정 위치 요소 자체에 건다: 고정 요소의 조상에 필터가 있으면 화면이 아니라 그 조상을 기준으로 놓인다 */}
      <div className="a11y-no-invert fixed bottom-4 right-4 z-50">
        <button
          ref={triggerRef}
          onClick={() => setOpen(!open)}
          className="w-14 h-14 rounded-full bg-yellow-500 text-black font-bold text-2xl shadow-lg hover:bg-yellow-400 focus:outline-none focus:ring-4 focus:ring-yellow-300"
          aria-label={t(`${K}.openSettings`)}
          aria-expanded={open}
          aria-controls={open ? `${uid}-panel` : undefined}
        >
          <span aria-hidden="true">♿</span>
        </button>

        {open && (
          <div
            id={`${uid}-panel`}
            ref={panelRef}
            className="absolute bottom-16 right-0 bg-gray-900 border-2 border-yellow-400 rounded-xl shadow-2xl p-4 space-y-4 text-white"
            style={{ width: 'min(22rem, calc(100vw - 2rem))', maxHeight: 'min(80vh, 44rem)', overflowY: 'auto' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${uid}-title`}
          >
            <h2 id={`${uid}-title`} tabIndex={-1} className="text-lg font-bold text-yellow-400" style={{ outline: 'none' }}>{t(`${K}.settings`)}</h2>

            {radioGroup('color', t(`${K}.screenMode`), COLOR_MODES.map(m => ({ value: m, label: t(COLOR_MODE_KEYS[m]) })), settings.colorMode, handleColorMode)}

            <div className="space-y-2">
              {radioGroup('font', t(`${K}.fontSize`), FONT_SCALES.map((_, i) => ({ value: i, label: fontLabel(i) })), settings.fontLevel, handleFontLevel)}
              <div className="flex gap-2">
                <button type="button" className="btn flex-1 bg-gray-700 text-white text-base" onClick={() => handleStep(-1)} disabled={settings.fontLevel === 0}>{t(`${K}.fontSmaller`)}</button>
                <button type="button" className="btn flex-1 bg-gray-700 text-white text-base" onClick={() => handleStep(1)} disabled={settings.fontLevel === FONT_SCALES.length - 1}>{t(`${K}.fontLarger`)}</button>
              </div>
            </div>

            {radioGroup('weight', t(`${K}.fontWeight`), [
              { value: 'normal' as const, label: t(`${K}.weightNormal`) },
              { value: 'bold' as const, label: t(`${K}.weightBold`) },
            ], settings.fontWeight, v => { update({ fontWeight: v }); say(t(`${K}.valueChanged`, { label: t(`${K}.fontWeight`), value: t(v === 'bold' ? `${K}.weightBold` : `${K}.weightNormal`) })); })}

            {radioGroup('lh', t(`${K}.lineHeight`), [
              { value: 'normal' as const, label: t(`${K}.spacingNormal`) },
              { value: 'relaxed' as const, label: t(`${K}.spacingRelaxed`) },
              { value: 'loose' as const, label: t(`${K}.spacingLoose`) },
            ], settings.lineHeight, v => { update({ lineHeight: v }); say(t(`${K}.valueChanged`, { label: t(`${K}.lineHeight`), value: t(v === 'normal' ? `${K}.spacingNormal` : v === 'relaxed' ? `${K}.spacingRelaxed` : `${K}.spacingLoose`) })); })}

            {radioGroup('ls', t(`${K}.letterSpacing`), [
              { value: 'normal' as const, label: t(`${K}.spacingNormal`) },
              { value: 'wide' as const, label: t(`${K}.spacingRelaxed`) },
              { value: 'wider' as const, label: t(`${K}.spacingLoose`) },
            ], settings.letterSpacing, v => { update({ letterSpacing: v }); say(t(`${K}.valueChanged`, { label: t(`${K}.letterSpacing`), value: t(v === 'normal' ? `${K}.spacingNormal` : v === 'wide' ? `${K}.spacingRelaxed` : `${K}.spacingLoose`) })); })}

            {switchRow('strongFocus', `${K}.strongFocus`, `${K}.strongFocusHelp`)}
            {switchRow('reduceMotion', `${K}.reduceMotion`, `${K}.reduceMotionHelp`)}

            <button type="button" className="btn w-full bg-gray-700 text-white text-base" onClick={handleReset}>{t(`${K}.reset`)}</button>
            <button
              type="button"
              className="btn btn-secondary w-full"
              onClick={close}
              aria-label={t(`${K}.closeSettings`)}
            >
              {t('common.close')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
