import { useState } from 'react';
import { useAccessibility, type ColorMode } from '../hooks/useAccessibility';

export default function AccessibilityMenu() {
  const [open, setOpen] = useState(false);
  const { settings, setColorMode, setFontSize } = useAccessibility();
  const [announcement, setAnnouncement] = useState('');

  const handleColorMode = (mode: ColorMode) => {
    setColorMode(mode);
    const label = mode === 'dark' ? '다크 모드' : '고대비 모드';
    setAnnouncement(`${label}로 전환되었습니다`);
  };

  const handleFontSize = (size: 'normal' | 'large' | 'xlarge') => {
    setFontSize(size);
    const label = size === 'normal' ? '기본' : size === 'large' ? '크게' : '매우 크게';
    setAnnouncement(`글꼴 크기가 ${label}로 변경되었습니다`);
  };

  return (
    <>
      <div aria-live="assertive" className="sr-only">{announcement}</div>
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setOpen(!open)}
          className="w-14 h-14 rounded-full bg-yellow-500 text-black font-bold text-2xl shadow-lg hover:bg-yellow-400 focus:outline-none focus:ring-4 focus:ring-yellow-300"
          aria-label="접근성 설정 열기"
          aria-expanded={open}
        >
          ♿
        </button>

        {open && (
          <div
            className="absolute bottom-16 right-0 w-72 bg-gray-900 border-2 border-yellow-400 rounded-xl shadow-2xl p-4 space-y-4"
            role="dialog"
            aria-label="접근성 설정"
          >
            <h3 className="text-lg font-bold text-yellow-400">접근성 설정</h3>

            {/* Color mode */}
            <fieldset>
              <legend className="font-semibold mb-2">화면 모드</legend>
              <div className="flex gap-2">
                {([
                  { value: 'dark' as const, label: '다크' },
                  { value: 'high-contrast' as const, label: '고대비' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleColorMode(opt.value)}
                    className={`btn flex-1 ${settings.colorMode === opt.value ? 'btn-primary ring-2 ring-yellow-400' : 'bg-gray-700 text-white'}`}
                    aria-pressed={settings.colorMode === opt.value}
                    aria-label={`${opt.label} 모드 ${settings.colorMode === opt.value ? '선택됨' : ''}`}
                  >
                    {opt.label}
                    {settings.colorMode === opt.value && ' ✓'}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Font size */}
            <fieldset>
              <legend className="font-semibold mb-2">글꼴 크기</legend>
              <div className="flex gap-2">
                {([
                  { value: 'normal' as const, label: '기본' },
                  { value: 'large' as const, label: '크게' },
                  { value: 'xlarge' as const, label: '매우 크게' },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleFontSize(opt.value)}
                    className={`btn flex-1 text-sm ${settings.fontSize === opt.value ? 'btn-primary ring-2 ring-yellow-400' : 'bg-gray-700 text-white'}`}
                    aria-pressed={settings.fontSize === opt.value}
                    aria-label={`글꼴 크기 ${opt.label} ${settings.fontSize === opt.value ? '선택됨' : ''}`}
                  >
                    {opt.label}
                    {settings.fontSize === opt.value && ' ✓'}
                  </button>
                ))}
              </div>
            </fieldset>

            <button
              className="btn btn-secondary w-full"
              onClick={() => setOpen(false)}
              aria-label="접근성 설정 닫기"
            >
              닫기
            </button>
          </div>
        )}
      </div>
    </>
  );
}
