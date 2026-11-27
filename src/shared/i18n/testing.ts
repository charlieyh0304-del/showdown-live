/**
 * 테스트용 번역 함수: 실제 ko/en 문구 파일로 독립 i18next 인스턴스를 만든다(앱 i18n 초기화처럼 브라우저 저장소를 읽지 않는다).
 * 없는 키는 키 문자열이 그대로 나오므로, 테스트는 결과에 RAW_KEY(예: 'spectator.rules.points')가 없는지로 누락을 잡는다.
 */
import i18next, { type i18n as I18n } from 'i18next';
import ko from './locales/ko.json';
import en from './locales/en.json';

export type TestTranslate = (key: string, opts?: Record<string, unknown>) => string;

const instances = new Map<string, I18n>();

export function tFor(lng: 'ko' | 'en'): TestTranslate {
  let inst = instances.get(lng);
  if (!inst) {
    inst = i18next.createInstance();
    void inst.init({
      resources: { ko: { translation: ko }, en: { translation: en } },
      lng,
      fallbackLng: false,
      interpolation: { escapeValue: false },
      initAsync: false,
    });
    instances.set(lng, inst);
  }
  const i = inst;
  return (key, opts) => String(i.t(key, opts as never));
}

/** 번역되지 않은 키 조각 또는 채워지지 않은 자리표시자 */
export const RAW_KEY = /\b(spectator|common|referee|admin)\.[A-Za-z_]+\.[A-Za-z_.]+|\{\{/;
