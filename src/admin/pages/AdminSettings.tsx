import { useState, useEffect, useCallback } from 'react';
import { ref, onValue, set, remove, push } from 'firebase/database';
import { database } from '@shared/config/firebase';
import { hashPin, verifyPin } from '@shared/utils/crypto';
import { useAuth } from '@shared/hooks/useAuth';
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
    setSampleSaved(`선수 ${players.length}명, 심판 ${referees.length}명 저장 완료`);
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
      setChangePinError('새 PIN은 4자리 이상이어야 합니다.');
      return;
    }
    if (newPin !== confirmPin) {
      setChangePinError('새 PIN이 일치하지 않습니다.');
      return;
    }

    // 현재 비밀번호 확인
    if (session?.adminId) {
      // admins/ 컬렉션의 관리자
      const admin = admins.find(a => a.id === session.adminId);
      if (!admin) {
        setChangePinError('관리자 정보를 찾을 수 없습니다.');
        return;
      }
      const valid = await verifyPin(currentPin, admin.pin);
      if (!valid) {
        setChangePinError('현재 PIN이 올바르지 않습니다.');
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
          setChangePinError('현재 PIN이 올바르지 않습니다.');
          return;
        }
      }
      const hashed = await hashPin(newPin);
      await set(ref(database, 'config/adminPin'), hashed);
    }

    setChangePinSuccess('비밀번호가 변경되었습니다.');
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
      setAddError('이름을 입력해주세요.');
      return;
    }
    if (newAdminPin.length < 4) {
      setAddError('PIN은 4자리 이상이어야 합니다.');
      return;
    }
    if (newAdminPin !== newAdminConfirm) {
      setAddError('PIN이 일치하지 않습니다.');
      return;
    }

    const hashed = await hashPin(newAdminPin);
    const newAdmin: Omit<Admin, 'id'> = {
      name: newAdminName.trim(),
      pin: hashed,
      createdAt: Date.now(),
    };

    await push(ref(database, 'admins'), newAdmin);

    setAddSuccess(`${newAdminName.trim()} 관리자가 추가되었습니다.`);
    setNewAdminName('');
    setNewAdminPin('');
    setNewAdminConfirm('');
    setShowAddAdmin(false);
  }, [newAdminName, newAdminPin, newAdminConfirm]);

  // 관리자 삭제
  const handleDeleteAdmin = useCallback(async (admin: Admin & { id: string }) => {
    if (admins.length <= 1) {
      alert('마지막 관리자는 삭제할 수 없습니다.');
      return;
    }
    if (admin.id === session?.adminId) {
      alert('현재 로그인한 관리자 계정은 삭제할 수 없습니다.');
      return;
    }
    if (!window.confirm(`${admin.name} 관리자를 삭제하시겠습니까?`)) return;
    await remove(ref(database, `admins/${admin.id}`));
  }, [admins, session]);

  if (loading) {
    return <div className="flex justify-center p-8" aria-live="polite"><p className="text-gray-300 animate-pulse">로딩 중...</p></div>;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-yellow-400">관리자 설정</h1>

      {/* 현재 로그인 정보 */}
      <div className="card">
        <h2 className="text-xl font-bold mb-3">현재 로그인</h2>
        <p className="text-gray-300">
          {session?.adminName ?? '관리자'}
          {session?.adminId && <span className="text-gray-400 text-sm ml-2">(ID: {session.adminId.slice(0, 8)})</span>}
        </p>
      </div>

      {/* 비밀번호 변경 */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold">비밀번호 변경</h2>
          <button
            className="btn btn-secondary text-sm"
            onClick={() => { setShowChangePin(!showChangePin); setChangePinError(''); setChangePinSuccess(''); }}
            aria-expanded={showChangePin}
            aria-label={showChangePin ? '비밀번호 변경 취소' : '비밀번호 변경'}
          >
            {showChangePin ? '취소' : '변경'}
          </button>
        </div>
        {changePinSuccess && <p className="text-green-400 font-semibold mb-2" role="alert">{changePinSuccess}</p>}
        {showChangePin && (
          <form onSubmit={handleChangePin} className="space-y-3">
            <div>
              <label htmlFor="current-pin" className="block mb-1 text-sm text-gray-300">현재 PIN</label>
              <input
                id="current-pin"
                type="password"
                className="input"
                value={currentPin}
                onChange={e => setCurrentPin(e.target.value)}
                placeholder="현재 PIN 입력"
                autoComplete="current-password"
              />
            </div>
            <div>
              <label htmlFor="new-pin" className="block mb-1 text-sm text-gray-300">새 PIN (4자리 이상)</label>
              <input
                id="new-pin"
                type="password"
                className="input"
                value={newPin}
                onChange={e => setNewPin(e.target.value)}
                placeholder="새 PIN 입력"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label htmlFor="confirm-new-pin" className="block mb-1 text-sm text-gray-300">새 PIN 확인</label>
              <input
                id="confirm-new-pin"
                type="password"
                className="input"
                value={confirmPin}
                onChange={e => setConfirmPin(e.target.value)}
                placeholder="새 PIN 확인"
                autoComplete="new-password"
              />
            </div>
            {changePinError && <p className="text-red-500 text-sm" role="alert">{changePinError}</p>}
            <button type="submit" className="btn btn-primary w-full">비밀번호 변경</button>
          </form>
        )}
      </div>

      {/* 관리자 목록 */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold">관리자 목록</h2>
          <button
            className="btn btn-success text-sm"
            onClick={() => { setShowAddAdmin(!showAddAdmin); setAddError(''); setAddSuccess(''); }}
            aria-expanded={showAddAdmin}
            aria-label={showAddAdmin ? '관리자 추가 취소' : '관리자 추가'}
          >
            {showAddAdmin ? '취소' : '+ 관리자 추가'}
          </button>
        </div>

        {addSuccess && <p className="text-green-400 font-semibold mb-2" role="alert">{addSuccess}</p>}

        {showAddAdmin && (
          <form onSubmit={handleAddAdmin} className="space-y-3 mb-4 p-4 bg-gray-800 rounded-lg">
            <h3 className="text-lg font-bold text-gray-300">새 관리자 추가</h3>
            <div>
              <label htmlFor="admin-name" className="block mb-1 text-sm text-gray-300">이름</label>
              <input
                id="admin-name"
                type="text"
                className="input"
                value={newAdminName}
                onChange={e => setNewAdminName(e.target.value)}
                placeholder="관리자 이름"
              />
            </div>
            <div>
              <label htmlFor="new-admin-pin" className="block mb-1 text-sm text-gray-300">PIN (4자리 이상)</label>
              <input
                id="new-admin-pin"
                type="password"
                className="input"
                value={newAdminPin}
                onChange={e => setNewAdminPin(e.target.value)}
                placeholder="PIN 입력"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label htmlFor="admin-pin-confirm" className="block mb-1 text-sm text-gray-300">PIN 확인</label>
              <input
                id="admin-pin-confirm"
                type="password"
                className="input"
                value={newAdminConfirm}
                onChange={e => setNewAdminConfirm(e.target.value)}
                placeholder="PIN 확인"
                autoComplete="new-password"
              />
            </div>
            {addError && <p className="text-red-500 text-sm" role="alert">{addError}</p>}
            <button type="submit" className="btn btn-primary w-full">추가</button>
          </form>
        )}

        {admins.length === 0 ? (
          <p className="text-gray-400">등록된 관리자가 없습니다. (레거시 PIN으로 로그인 중)</p>
        ) : (
          <div className="space-y-2">
            {admins.map(admin => (
              <div key={admin.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-lg">
                <div>
                  <span className="text-white font-semibold">{admin.name}</span>
                  {admin.id === session?.adminId && (
                    <span className="ml-2 text-xs bg-yellow-600 text-white px-2 py-0.5 rounded">현재 로그인</span>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    등록일: {new Date(admin.createdAt).toLocaleDateString('ko-KR')}
                  </div>
                </div>
                <button
                  className="btn btn-danger text-sm"
                  onClick={() => handleDeleteAdmin(admin)}
                  disabled={admin.id === session?.adminId || admins.length <= 1}
                  aria-label={`${admin.name} 관리자 삭제`}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* 시뮬레이션 샘플 이름 */}
      <div className="card">
        <h2 className="text-xl font-bold mb-3">시뮬레이션 샘플 이름</h2>
        <p className="text-gray-400 text-sm mb-4">
          선수/심판이 등록되지 않은 대회에서 시뮬레이션 실행 시 사용됩니다. 줄바꿈으로 구분하세요.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="sample-players" className="block text-sm font-semibold text-gray-300 mb-1">선수 이름 ({samplePlayerText.split('\n').filter(s => s.trim()).length}명)</label>
            <textarea
              id="sample-players"
              className="input w-full h-48"
              value={samplePlayerText}
              onChange={e => setSamplePlayerText(e.target.value)}
              placeholder={"홍길동\n김철수\n이영희\n박민수\n최수진"}
              aria-label="샘플 선수 이름 목록"
            />
          </div>
          <div>
            <label htmlFor="sample-referees" className="block text-sm font-semibold text-gray-300 mb-1">심판 이름 ({sampleRefereeText.split('\n').filter(s => s.trim()).length}명)</label>
            <textarea
              id="sample-referees"
              className="input w-full h-48"
              value={sampleRefereeText}
              onChange={e => setSampleRefereeText(e.target.value)}
              placeholder={"심판 A\n심판 B\n심판 C"}
              aria-label="샘플 심판 이름 목록"
            />
          </div>
        </div>
        {sampleSaved && <p className="text-green-400 text-sm mt-2" role="alert">{sampleSaved}</p>}
        <button className="btn btn-primary w-full mt-3" onClick={handleSaveSampleNames}>
          샘플 이름 저장
        </button>
      </div>
    </div>
  );
}
