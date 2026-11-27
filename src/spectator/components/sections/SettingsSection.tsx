import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFavorites } from '@shared/hooks/useFirebase';
import { usePushNotifications } from '@shared/hooks/usePushNotifications';
import { useNotificationSettings } from '@shared/hooks/useNotificationSettings';

export interface SettingsSectionProps {
  /** 영문 이름 데이터가 있을 때만 이름 표기 선택을 보인다 */
  hasRomanNames: boolean;
  showRoman: boolean;
  onShowRomanChange: (on: boolean) => void;
}

function permissionState(): NotificationPermission | 'unsupported' {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';
}

/**
 * 관전 설정: 즐겨찾기 선수 경기 알림(기본 꺼짐, 켤 때만 권한을 묻는다), 결과 소리, 이름 표기.
 * 글씨 크기·색은 접근성 버튼에서 바꾼다(안내 문장).
 */
export default function SettingsSection({ hasRomanNames, showRoman, onShowRomanChange }: SettingsSectionProps) {
  const { t } = useTranslation();
  const uid = useId();
  const { favorites } = useFavorites();
  const { pushEnabled, pushSupported, enablePush, disablePush } = usePushNotifications(favorites);
  const { settings, update } = useNotificationSettings();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const turnOn = async () => {
    setBusy(true);
    const ok = await enablePush();
    setBusy(false);
    if (ok) { update({ enabled: true }); setStatus(t('spectator.settings.notifyOnDone', { count: favorites.length })); return; }
    setStatus(permissionState() === 'denied' ? t('spectator.settings.notifyDenied') : t('spectator.settings.notifyFailed'));
  };
  const turnOff = async () => {
    setBusy(true);
    await disablePush();
    update({ enabled: false });
    setBusy(false);
    setStatus(t('spectator.settings.notifyOffDone'));
  };

  const switchBtn = (on: boolean, label: string, onClick: () => void, describedBy?: string) => (
    <button type="button" role="switch" aria-checked={on} aria-describedby={describedBy} onClick={onClick}
      className={`btn w-full ${on ? 'btn-primary' : 'bg-gray-700 text-white'}`} style={{ fontSize: '1rem' }}>
      {label}: {on ? t('spectator.settings.on') : t('spectator.settings.off')}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      <section aria-labelledby={`${uid}-notify`} className="card">
        <h3 id={`${uid}-notify`} style={{ fontSize: '1.125rem', fontWeight: 'bold' }}>{t('spectator.settings.notifyTitle')}</h3>
        <p id={`${uid}-notify-help`} style={{ color: '#d1d5db', margin: '0.5rem 0' }}>{t('spectator.settings.notifyHelp')}</p>
        <p style={{ color: '#9ca3af', fontSize: '0.875rem', marginBottom: '0.5rem' }}>{t('spectator.settings.notifyPrivacy')}</p>
        {!pushSupported ? (
          <p style={{ color: '#fbbf24' }}>{t('spectator.settings.notifyUnsupported')}</p>
        ) : (
          <>
            <p style={{ marginBottom: '0.5rem' }}>
              {pushEnabled ? t('spectator.settings.notifyStateOn', { count: favorites.length }) : t('spectator.settings.notifyStateOff')}
            </p>
            {pushEnabled
              ? <button type="button" className="btn bg-gray-700 text-white w-full" disabled={busy} onClick={turnOff} aria-describedby={`${uid}-notify-help`}>{t('spectator.settings.notifyOff')}</button>
              : <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={turnOn} aria-describedby={`${uid}-notify-help`}>{t('spectator.settings.notifyOn')}</button>}
            {favorites.length === 0 && <p style={{ color: '#fbbf24', marginTop: '0.5rem' }}>{t('spectator.settings.notifyNoFavorites')}</p>}
          </>
        )}
        <p role="status" aria-live="polite" style={{ marginTop: '0.5rem', color: '#4ade80' }}>{status}</p>
      </section>

      <section aria-labelledby={`${uid}-sound`} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <h3 id={`${uid}-sound`} style={{ fontSize: '1.125rem', fontWeight: 'bold' }}>{t('spectator.settings.soundTitle')}</h3>
        {switchBtn(!!settings.resultSound, t('spectator.settings.resultSound'), () => update({ resultSound: !settings.resultSound }), `${uid}-sound-help`)}
        {settings.resultSound && switchBtn(settings.resultSoundFavoritesOnly !== false, t('spectator.settings.resultSoundFavoritesOnly'), () => update({ resultSoundFavoritesOnly: !(settings.resultSoundFavoritesOnly !== false) }))}
        <p id={`${uid}-sound-help`} style={{ color: '#9ca3af', fontSize: '0.875rem' }}>{t('spectator.settings.soundHelp')}</p>
      </section>

      {hasRomanNames && (
        <section aria-labelledby={`${uid}-names`} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <h3 id={`${uid}-names`} style={{ fontSize: '1.125rem', fontWeight: 'bold' }}>{t('spectator.settings.namesTitle')}</h3>
          {switchBtn(showRoman, t('spectator.settings.showRoman'), () => onShowRomanChange(!showRoman))}
        </section>
      )}
    </div>
  );
}
