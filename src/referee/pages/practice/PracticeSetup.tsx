import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MatchType } from '@shared/types';

interface TeamMember {
  name: string;
  gender: 'male' | 'female';
}

interface TeamData {
  name: string;
  coach: string;
  members: TeamMember[];
}

const emptyTeam = (defaultName: string): TeamData => ({
  name: defaultName,
  coach: '',
  members: [
    { name: '선수1', gender: 'male' },
    { name: '선수2', gender: 'male' },
    { name: '선수3', gender: 'female' },
  ],
});

export default function PracticeSetup() {
  const navigate = useNavigate();
  const [matchType, setMatchType] = useState<MatchType>('individual');
  const [player1Name, setPlayer1Name] = useState('연습선수A');
  const [player2Name, setPlayer2Name] = useState('연습선수B');
  const [setsToWin, setSetsToWin] = useState(2);

  // Team-specific
  const [teams, setTeams] = useState<TeamData[]>([]);
  const [editingTeam, setEditingTeam] = useState<number | null>(null);

  const focusTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (focusTargetRef.current) {
      const el = document.querySelector<HTMLInputElement>(focusTargetRef.current);
      el?.focus();
      focusTargetRef.current = null;
    }
  });

  const addTeam = () => {
    if (teams.length >= 2) return;
    const t = emptyTeam(teams.length === 0 ? '팀 A' : '팀 B');
    setTeams([...teams, t]);
    setEditingTeam(teams.length);
    focusTargetRef.current = `[data-team="${teams.length}"] [data-field="name"]`;
  };

  const updateTeam = (idx: number, data: Partial<TeamData>) => {
    setTeams(teams.map((t, i) => i === idx ? { ...t, ...data } : t));
  };

  const removeTeam = (idx: number) => {
    setTeams(teams.filter((_, i) => i !== idx));
    setEditingTeam(null);
  };

  const addMember = (idx: number) => {
    const t = teams[idx];
    if (t.members.length >= 6) return;
    updateTeam(idx, { members: [...t.members, { name: `선수${t.members.length + 1}`, gender: 'male' }] });
    focusTargetRef.current = `[data-team="${idx}"] [data-member="${t.members.length}"]`;
  };

  const removeMember = (teamIdx: number, memberIdx: number) => {
    const t = teams[teamIdx];
    if (t.members.length <= 3) return;
    updateTeam(teamIdx, { members: t.members.filter((_, i) => i !== memberIdx) });
  };

  const handleStart = () => {
    const config = matchType === 'team'
      ? { SETS_TO_WIN: 1, MAX_SETS: 1, POINTS_TO_WIN: 31, MIN_POINT_DIFF: 2 }
      : { SETS_TO_WIN: setsToWin, MAX_SETS: setsToWin * 2 - 1, POINTS_TO_WIN: 11, MIN_POINT_DIFF: 2 };

    const p1 = matchType === 'team' ? (teams[0]?.name || '팀 A') : player1Name;
    const p2 = matchType === 'team' ? (teams[1]?.name || '팀 B') : player2Name;

    const params = new URLSearchParams({
      type: matchType,
      p1,
      p2,
      config: JSON.stringify(config),
    });

    if (matchType === 'team') {
      params.set('t1m', JSON.stringify(teams[0]?.members.map(m => m.name) || []));
      params.set('t2m', JSON.stringify(teams[1]?.members.map(m => m.name) || []));
      if (teams[0]?.coach?.trim()) params.set('t1c', teams[0].coach.trim());
      if (teams[1]?.coach?.trim()) params.set('t2c', teams[1].coach.trim());
    }

    navigate(`/referee/practice/play?${params.toString()}`);
  };

  const canStart = matchType === 'individual'
    ? player1Name.trim() && player2Name.trim()
    : teams.length === 2 && teams.every(t => t.name.trim() && t.members.length >= 3 && t.members.every(m => m.name.trim()));

  return (
    <div className="p-4 max-w-lg mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-center" style={{ color: '#c084fc' }}>연습 경기 설정</h1>

      <div className="card space-y-4">
        <h2 className="text-xl font-bold">경기 유형</h2>
        <div className="flex gap-3">
          <button
            className={`btn flex-1 text-lg py-4 ${matchType === 'individual' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
            onClick={() => { setMatchType('individual'); setSetsToWin(2); }}
            aria-pressed={matchType === 'individual'}
          >
            개인전
          </button>
          <button
            className={`btn flex-1 text-lg py-4 ${matchType === 'team' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
            onClick={() => setMatchType('team')}
            aria-pressed={matchType === 'team'}
          >
            팀전
          </button>
        </div>
      </div>

      {matchType === 'individual' ? (
        <>
          <div className="card space-y-4">
            <h2 className="text-xl font-bold">선수 이름</h2>
            <input className="input" value={player1Name} onChange={e => setPlayer1Name(e.target.value)} placeholder="선수 1 이름" aria-label="선수 1 이름" />
            <input className="input" value={player2Name} onChange={e => setPlayer2Name(e.target.value)} placeholder="선수 2 이름" aria-label="선수 2 이름" />
          </div>
          <div className="card space-y-4">
            <h2 className="text-xl font-bold">경기 규칙</h2>
            <div className="flex items-center gap-2">
              <span className="text-gray-300">승리 점수:</span>
              <span className="text-white font-bold">11점</span>
              <span className="text-gray-400 text-sm">(IBSA 공식 규칙)</span>
            </div>
            <div>
              <label className="block mb-2 text-gray-300">세트 수 (선승)</label>
              <div className="flex gap-2">
                {[1, 2, 3].map(v => (
                  <button key={v} className={`btn flex-1 ${setsToWin === v ? 'btn-primary' : 'bg-gray-700 text-white'}`} onClick={() => setSetsToWin(v)} aria-pressed={setsToWin === v}>
                    {v}세트
                  </button>
                ))}
              </div>
            </div>
            <p className="text-cyan-400 font-semibold">11점 | {setsToWin}세트 선승 | 최대 {setsToWin * 2 - 1}세트 | 2점차</p>
          </div>
        </>
      ) : (
        <>
          {/* 등록된 팀 목록 */}
          {teams.map((team, idx) => (
            <div key={idx} className="card space-y-3" data-team={idx} style={{ borderLeft: `4px solid ${idx === 0 ? '#facc15' : '#22d3ee'}` }}>
              {editingTeam === idx ? (
                /* 팀 편집 모드 */
                <>
                  <div className="flex justify-between items-center">
                    <h3 className={`text-lg font-bold ${idx === 0 ? 'text-yellow-400' : 'text-cyan-400'}`}>팀 {idx + 1} 편집</h3>
                    <button className="text-sm text-gray-400 underline" onClick={() => setEditingTeam(null)} aria-label="팀 편집 완료" style={{ minHeight: '44px', minWidth: '44px' }}>완료</button>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">팀 이름</label>
                    <input className="input" data-field="name" value={team.name} onChange={e => updateTeam(idx, { name: e.target.value })} aria-label="팀 이름" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">코치 (선택)</label>
                    <input className="input" value={team.coach} onChange={e => updateTeam(idx, { coach: e.target.value })} placeholder="코치 이름" aria-label="코치 이름" />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm text-gray-400">팀원 (서브 순서)</label>
                    {team.members.map((member, mi) => (
                      <div key={mi} className="flex gap-2 items-center">
                        <span className="text-gray-400 text-sm w-6">{mi + 1}</span>
                        <input
                          className="input flex-1"
                          data-member={mi}
                          value={member.name}
                          onChange={e => {
                            const arr = [...team.members];
                            arr[mi] = { ...arr[mi], name: e.target.value };
                            updateTeam(idx, { members: arr });
                          }}
                          placeholder={`${mi + 1}번 선수`}
                          aria-label={`${mi + 1}번 선수`}
                        />
                        <button
                          className={`btn text-xs px-2 py-1 ${member.gender === 'male' ? 'bg-blue-700 text-blue-200' : 'bg-pink-700 text-pink-200'}`}
                          onClick={() => {
                            const arr = [...team.members];
                            arr[mi] = { ...arr[mi], gender: member.gender === 'male' ? 'female' : 'male' };
                            updateTeam(idx, { members: arr });
                          }}
                          aria-label={`성별 변경: ${member.gender === 'male' ? '남' : '여'}`}
                        >
                          {member.gender === 'male' ? '남' : '여'}
                        </button>
                        {team.members.length > 3 && (
                          <button className="btn bg-red-900 text-red-300 text-xs px-2 py-1" onClick={() => removeMember(idx, mi)} aria-label={`${member.name} 제거`}>삭제</button>
                        )}
                      </div>
                    ))}
                    {team.members.length < 6 && (
                      <button className="btn bg-gray-700 text-gray-300 text-sm w-full py-2" onClick={() => addMember(idx)}>
                        + 예비 선수 추가 (최대 {6 - team.members.length}명)
                      </button>
                    )}
                    {(() => {
                      const maleCount = team.members.filter(m => m.gender === 'male').length;
                      const femaleCount = team.members.filter(m => m.gender === 'female').length;
                      const activeMembers = team.members.slice(0, 3);
                      const activeMale = activeMembers.filter(m => m.gender === 'male').length;
                      const activeFemale = activeMembers.filter(m => m.gender === 'female').length;
                      return (
                        <div className="text-xs text-gray-400 space-y-1">
                          <p>출전 3명{team.members.length > 3 ? ` + 예비 ${team.members.length - 3}명` : ''} | 입력 순서 = 서브 로테이션 순서</p>
                          <p>성별: 남 {maleCount}명 / 여 {femaleCount}명 (출전: 남 {activeMale} 여 {activeFemale})</p>
                        </div>
                      );
                    })()}
                  </div>
                  <button className="btn bg-red-900/50 text-red-400 text-sm w-full py-2" onClick={() => removeTeam(idx)}>팀 삭제</button>
                </>
              ) : (
                /* 팀 요약 보기 */
                <div
                  className="flex justify-between items-center cursor-pointer"
                  onClick={() => setEditingTeam(idx)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingTeam(idx); } }}
                  role="button"
                  tabIndex={0}
                  aria-label={`${team.name} 팀 편집`}
                >
                  <div>
                    <h3 className={`text-lg font-bold ${idx === 0 ? 'text-yellow-400' : 'text-cyan-400'}`}>{team.name}</h3>
                    {team.coach && <p className="text-sm text-gray-400">코치: {team.coach}</p>}
                    <p className="text-sm text-gray-400">{team.members.map(m => m.name).join(', ')}</p>
                  </div>
                  <span className="text-gray-400 text-sm" aria-hidden="true">편집</span>
                </div>
              )}
            </div>
          ))}

          {/* 새 팀 추가 버튼 */}
          {teams.length < 2 && (
            <button
              className="card w-full text-center py-6 border-2 border-dashed border-gray-600 hover:border-yellow-400 text-gray-400 hover:text-yellow-400 text-lg font-bold"
              onClick={addTeam}
              aria-label={`새 팀 추가. 현재 ${teams.length}팀 등록됨, 최대 2팀`}
            >
              + 새 팀 추가 ({teams.length}/2)
            </button>
          )}

          <div className="card">
            <p className="text-cyan-400 font-semibold">31점 | 1세트 단판 | 서브 3회 교대 | 2점차</p>
          </div>
        </>
      )}

      <div className="flex gap-4">
        <button className="btn btn-success btn-large flex-1" onClick={handleStart} disabled={!canStart} aria-label="연습 시작">연습 시작</button>
        <button className="btn btn-accent flex-1" onClick={() => navigate('/referee/practice')} aria-label="뒤로">뒤로</button>
      </div>
    </div>
  );
}
