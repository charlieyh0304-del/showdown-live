import { useTranslation } from 'react-i18next';

export default function LanguageToggle() {
  const { i18n } = useTranslation();
  const isKo = i18n.language === 'ko';

  const toggle = () => {
    const next = isKo ? 'en' : 'ko';
    i18n.changeLanguage(next);
    localStorage.setItem('showdown_language', next);
  };

  return (
    <button
      onClick={toggle}
      className="px-2 py-1 rounded text-xs font-bold bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
      aria-label={isKo ? 'Switch to English' : '한국어로 전환'}
    >
      {isKo ? 'EN' : '한국어'}
    </button>
  );
}
