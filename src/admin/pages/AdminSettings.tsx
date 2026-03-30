import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ref, onValue, set, remove, push } from 'firebase/database';
import { database } from '@shared/config/firebase';
import { hashPin, verifyPin } from '@shared/utils/crypto';
import { useAuth } from '@shared/hooks/useAuth';
import { formatDate } from '@shared/utils/locale';
import type { Admin } from '@shared/types';

const SAMPLE_STORAGE_KEY = 'showdown_sample_names';

interface SampleNames {
  players: string[];
  referees: string[];
}

function loadSampleNames(): SampleNames {
  try {
    const saved = localStorage.getItem(SAMPLE_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { players: [], referees: [] };
}

function saveSampleNames(data: SampleNames) {
  localStorage.setItem(SAMPLE_STORAGE_KEY, JSON.stringify(data));
  // Firebase에도 저장
  set(ref(database, 'config/sampleNames'), data).catch(() => {});
}

export function getSampleNames(): SampleNames {
  return loadSampleNames();
}

export default function AdminSettings() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [admins, setAdmins] = useState<(Admin & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);

  // 샘플 이름
  const [sampleData, setSampleData] = useState<SampleNames>(loadSampleNames);
  const [samplePlayerText, setSamplePlayerText] = useState(sampleData.players.join('\n'));
  const [sampleRefereeText, setSampleRefereeText] = useState(sampleData.referees.join('\n'));
  const [sampleSaved, setSampleSaved] = useState('');

  // Firebase에서 샘플 이름 로드
  useEffect(() => {
    const sampleRef = ref(database, 'config/sampleNames');
    const unsub = onValue(sampleRef, (snap) => {
      if (snap.exists()) {
        const raw = snap.val();
        const data: SampleNames = {
          players: Array.isArray(raw.players) ? raw.players : (raw.players ? Object.values(raw.players) : []),
          referees: Array.isArray(raw.referees) ? raw.referees : (raw.referees ? Object.values(raw.referees) : []),
        };
        setSampleData(data);
        setSamplePlayerText(data.players.join('\n'));
        setSampleRefereeText(data.referees.join('\n'));
        localStorage.setItem(SAMPLE_STORAGE_KEY, JSON.stringify(data));
      }
    }, { onlyOnce: true });
    return () => unsub();
  }, []);

  const handleSaveSampleNames = () => {
    const players = samplePlayerText.split('\n').map(s => s.trim()).filter(s => s);
    const referees = sampleRefereeText.split('\n').map(s => s.trim()).filter(s => s);
    const data = { players, referees };
    setSampleData(data);
    saveSampleNames(data);
    setSampleSaved(t('admin.settings.sampleNamesSaved', { playerCount: players.length, refereeCount: referees.length }));
    setTimeout(() => setSampleSaved(''), 3000);
  };

  // 비밀번호 변경
  const [showChangePin, setShowChangePin] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [changePinError, setChangePinError] = useState('');
  const [changePinSuccess, setChangePinSuccess] = useState('');

  // 새 관리자 추가
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminPin, setNewAdminPin] = useState('');
  const [newAdminConfirm, setNewAdminConfirm] = useState('');
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');

  // 관리자 목록 로드
  useEffect(() => {
    const adminsRef = ref(database, 'admins');
    const unsub = onValue(adminsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val() as Record<string, Omit<Admin, 'id'>>;
        setAdmins(Object.entries(data).map(([id, admin]) => ({ id, ...admin })));
      } else {
        setAdmins([]);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // 비밀번호 변경
  const handleChangePin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePinError('');
    setChangePinSuccess('');

    if (newPin.length < 4) {
      setChangePinError(t('admin.settings.newPinMinLength'));
      return;
    }
    if (newPin !== confirmPin) {
      setChangePinError(t('admin.settings.newPinMismatch'));
      return;
    }

    // 현재 비밀번호 확인
    if (session?.adminId) {
      // admins/ 컬렉션의 관리자
      const admin = admins.find(a => a.id === session.adminId);
      if (!admin) {
        setChangePinError(t('admin.settings.adminNotFound'));
        return;
      }
      const valid = await verifyPin(currentPin, admin.pin);
      if (!valid) {
        setChangePinError(t('admin.settings.currentPinIncorrect'));
        return;
      }
      const hashed = await hashPin(newPin);
      await set(ref(database, `admins/${session.adminId}/pin`), hashed);
    } else {
      // 레거시 단일 관리자
      const snap = await import('firebase/database').then(m => m.get(ref(database, 'config/adminPin')));
      if (snap.exists()) {
        const valid = await verifyPin(currentPin, snap.val());
        if (!valid) {
          setChangePinError(t('admin.settings.currentPinIncorrect'));
          return;
        }
      }
      const hashed = await hashPin(newPin);
      await set(ref(database, 'config/adminPin'), hashed);
    }

    setChangePinSuccess(t('admin.settings.passwordChanged'));
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setShowChangePin(false);
  }, [currentPin, newPin, confirmPin, session, admins]);

  // 새 관리자 추가
  const handleAddAdmin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    setAddSuccess('');

    if (!newAdminName.trim()) {
      setAddError(t('admin.settings.nameRequired'));
      return;
    }
    if (newAdminPin.length < 4) {
      setAddError(t('admin.pinSetup.minLengthError'));
      return;
    }
    if (newAdminPin !== newAdminConfirm) {
      setAddError(t('admin.pinSetup.mismatchError'));
      return;
    }

    const hashed = await hashPin(newAdminPin);
    const newAdmin: Omit<Admin, 'id'> = {
      name: newAdminName.trim(),
      pin: hashed,
      createdAt: Date.now(),
    };

    await push(ref(database, 'admins'), newAdmin);

    setAddSuccess(t('admin.settings.adminAdded', { name: newAdminName.trim() }));
    setNewAdminName('');
    setNewAdminPin('');
    setNewAdminConfirm('');
    setShowAddAdmin(false);
  }, [newAdminName, newAdminPin, newAdminConfirm]);

  // 관리자 삭제
  const handleDeleteAdmin = useCallback(async (admin: Admin & { id: string }) => {
    if (admins.length <= 1) {
      alert(t('admin.settings.cannotDeleteLastAdmin'));
      return;
    }
    if (admin.id === session?.adminId) {
      alert(t('admin.settings.cannotDeleteSelf'));
      return;
    }
    if (!window.confirm(t('admin.settings.confirmDeleteAdmin', { name: admin.name }))) return;
    await remove(ref(database, `admins/${admin.id}`));
  }, [admins, session]);

  if (loading) {
    return <div className="flex justify-center p-8" aria-live="polite"><p className="text-gray-300 animate-pulse">{t('common.loading')}</p></div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-yellow-400 text-center">{t('admin.settings.title')}</h1>

      {/* 현재 로그인 정보 */}
      <div className="card">
        <h2 className="text-xl font-bold mb-3">{t('admin.settings.currentLogin')}</h2>
        <p className="text-gray-300">
          {session?.adminName ?? t('app.modeSelector.adminMode')}
          {session?.adminId && <span className="text-gray-400 text-sm ml-2">(ID: {session.adminId.slice(0, 8)})</span>}
        </p>
      </div>

      {/* 비밀번호 변경 */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold">{t('admin.settings.changePassword')}</h2>
          <button
            className="btn btn-secondary text-sm"
            onClick={() => { setShowChangePin(!showChangePin); setChangePinError(''); setChangePinSuccess(''); }}
            aria-expanded={showChangePin}
            aria-label={showChangePin ? t('common.cancel') : t('admin.settings.changeButton')}
          >
            {showChangePin ? t('common.cancel') : t('admin.settings.changeButton')}
          </button>
        </div>
        {changePinSuccess && <p className="text-green-400 font-semibold mb-2" role="alert">{changePinSuccess}</p>}
        {showChangePin && (
          <form onSubmit={handleChangePin} className="space-y-3">
            <div>
              <label htmlFor="current-pin" className="block mb-1 text-sm text-gray-300">{t('admin.settings.currentPin')}</label>
              <input
                id="current-pin"
                type="password"
                className="input"
                value={currentPin}
                onChange={e => setCurrentPin(e.target.value)}
                placeholder={t('admin.settings.currentPinPlaceholder')}
                autoComplete="current-password"
              />
            </div>
            <div>
              <label htmlFor="new-pin" className="block mb-1 text-sm text-gray-300">{t('admin.settings.newPin')}</label>
              <input
                id="new-pin"
                type="password"
                className="input"
                value={newPin}
                onChange={e => setNewPin(e.target.value)}
                placeholder={t('admin.settings.newPinPlaceholder')}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label htmlFor="confirm-new-pin" className="block mb-1 text-sm text-gray-300">{t('admin.settings.confirmNewPin')}</label>
              <input
                id="confirm-new-pin"
                type="password"
                className="input"
                value={confirmPin}
                onChange={e => setConfirmPin(e.target.value)}
                placeholder={t('admin.settings.confirmNewPinPlaceholder')}
                autoComplete="new-password"
              />
            </div>
            {changePinError && <p className="text-red-500 text-sm" role="alert">{changePinError}</p>}
            <button type="submit" className="btn btn-primary w-full">{t('admin.settings.changePasswordButton')}</button>
          </form>
        )}
      </div>

      {/* 관리자 목록 */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold">{t('admin.settings.adminList')}</h2>
          <button
            className="btn btn-success text-sm"
            onClick={() => { setShowAddAdmin(!showAddAdmin); setAddError(''); setAddSuccess(''); }}
            aria-expanded={showAddAdmin}
            aria-label={showAddAdmin ? t('common.cancel') : t('admin.settings.addAdmin')}
          >
            {showAddAdmin ? t('common.cancel') : t('admin.settings.addAdmin')}
          </button>
        </div>

        {addSuccess && <p className="text-green-400 font-semibold mb-2" role="alert">{addSuccess}</p>}

        {showAddAdmin && (
          <form onSubmit={handleAddAdmin} className="space-y-3 mb-4 p-4 bg-gray-800 rounded-lg">
            <h3 className="text-lg font-bold text-gray-300">{t('admin.settings.addAdminTitle')}</h3>
            <div>
              <label htmlFor="admin-name" className="block mb-1 text-sm text-gray-300">{t('admin.settings.adminName')}</label>
              <input
                id="admin-name"
                type="text"
                className="input"
                value={newAdminName}
                onChange={e => setNewAdminName(e.target.value)}
                placeholder={t('admin.settings.adminNamePlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="new-admin-pin" className="block mb-1 text-sm text-gray-300">{t('admin.settings.adminPinLabel')}</label>
              <input
                id="new-admin-pin"
                type="password"
                className="input"
                value={newAdminPin}
                onChange={e => setNewAdminPin(e.target.value)}
                placeholder={t('admin.settings.adminPinPlaceholder')}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label htmlFor="admin-pin-confirm" className="block mb-1 text-sm text-gray-300">{t('admin.settings.adminPinConfirm')}</label>
              <input
                id="admin-pin-confirm"
                type="password"
                className="input"
                value={newAdminConfirm}
                onChange={e => setNewAdminConfirm(e.target.value)}
                placeholder={t('admin.settings.adminPinConfirmPlaceholder')}
                autoComplete="new-password"
              />
            </div>
            {addError && <p className="text-red-500 text-sm" role="alert">{addError}</p>}
            <button type="submit" className="btn btn-primary w-full">{t('admin.settings.addButton')}</button>
          </form>
        )}

        {admins.length === 0 ? (
          <p className="text-gray-400">{t('admin.settings.noAdmins')}</p>
        ) : (
          <div className="space-y-2">
            {admins.map(admin => (
              <div key={admin.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                <div>
                  <span className="text-white font-semibold">{admin.name}</span>
                  {admin.id === session?.adminId && (
                    <span className="ml-2 text-xs bg-yellow-600 text-white px-2 py-0.5 rounded">{t('admin.settings.currentLoginBadge')}</span>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    {t('admin.settings.registeredDate')}: {formatDate(new Date(admin.createdAt))}
                  </div>
                </div>
                <button
                  className="btn btn-danger text-sm"
                  onClick={() => handleDeleteAdmin(admin)}
                  disabled={admin.id === session?.adminId || admins.length <= 1}
                  aria-label={t('admin.settings.deleteAdminAriaLabel', { name: admin.name })}
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* 시뮬레이션 샘플 이름 */}
      <div className="card">
        <h2 className="text-xl font-bold mb-3">{t('admin.settings.sampleNames')}</h2>
        <p className="text-gray-400 text-sm mb-4">
          {t('admin.settings.sampleNamesDescription')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="sample-players" className="block text-sm font-semibold text-gray-300 mb-1">{t('admin.settings.samplePlayerNames')} {t('admin.settings.countLabel', { count: samplePlayerText.split('\n').filter(s => s.trim()).length })}</label>
            <textarea
              id="sample-players"
              className="input w-full h-48"
              value={samplePlayerText}
              onChange={e => setSamplePlayerText(e.target.value)}
              placeholder={t('admin.settings.samplePlayerPlaceholder')}
              aria-label={t('admin.settings.samplePlayerNamesAriaLabel')}
            />
          </div>
          <div>
            <label htmlFor="sample-referees" className="block text-sm font-semibold text-gray-300 mb-1">{t('admin.settings.sampleRefereeNames')} {t('admin.settings.countLabel', { count: sampleRefereeText.split('\n').filter(s => s.trim()).length })}</label>
            <textarea
              id="sample-referees"
              className="input w-full h-48"
              value={sampleRefereeText}
              onChange={e => setSampleRefereeText(e.target.value)}
              placeholder={t('admin.settings.sampleRefereePlaceholder')}
              aria-label={t('admin.settings.sampleRefereeNamesAriaLabel')}
            />
          </div>
        </div>
        {sampleSaved && <p className="text-green-400 text-sm mt-2" role="alert">{sampleSaved}</p>}
        <button className="btn btn-primary w-full mt-3" onClick={handleSaveSampleNames}>
          {t('admin.settings.saveSampleNames')}
        </button>
      </div>
    </div>
  );
}
