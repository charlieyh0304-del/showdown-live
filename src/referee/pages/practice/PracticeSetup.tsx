import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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

export default function PracticeSetup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [matchType, setMatchType] = useState<MatchType>('individual');
  const [player1Name, setPlayer1Name] = useState(t('referee.practice.setup.practicePlayerA'));
  const [player2Name, setPlayer2Name] = useState(t('referee.practice.setup.practicePlayerB'));
  const [player1Coach, setPlayer1Coach] = useState('');
  const [player2Coach, setPlayer2Coach] = useState('');
  const [maxSets, setMaxSets] = useState(3); // 총 세트 수 (1, 3, 5, 7, 9)
  const setsToWin = Math.ceil(maxSets / 2); // 선승 수 자동 계산

  const emptyTeam = (defaultName: string): TeamData => ({
    name: defaultName,
    coach: '',
    members: [
      { name: `${t('referee.practice.setup.memberPlaceholder', { num: 1 })}`, gender: 'male' },
      { name: `${t('referee.practice.setup.memberPlaceholder', { num: 2 })}`, gender: 'male' },
      { name: `${t('referee.practice.setup.memberPlaceholder', { num: 3 })}`, gender: 'female' },
    ],
  });

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
    const newTeam = emptyTeam(teams.length === 0 ? t('referee.practice.setup.teamA') : t('referee.practice.setup.teamB'));
    setTeams([...teams, newTeam]);
    setEditingTeam(teams.length);
    focusTargetRef.current = `[data-team="${teams.length}"] [data-field="name"]`;
  };

  const updateTeam = (idx: number, data: Partial<TeamData>) => {
    setTeams(teams.map((tm, i) => i === idx ? { ...tm, ...data } : tm));
  };

  const removeTeam = (idx: number) => {
    setTeams(teams.filter((_, i) => i !== idx));
    setEditingTeam(null);
  };

  const addMember = (idx: number) => {
    const tm = teams[idx];
    if (tm.members.length >= 6) return;
    updateTeam(idx, { members: [...tm.members, { name: t('referee.practice.setup.memberPlaceholder', { num: tm.members.length + 1 }), gender: 'male' }] });
    focusTargetRef.current = `[data-team="${idx}"] [data-member="${tm.members.length}"]`;
  };

  const removeMember = (teamIdx: number, memberIdx: number) => {
    const tm = teams[teamIdx];
    if (tm.members.length <= 3) return;
    updateTeam(teamIdx, { members: tm.members.filter((_, i) => i !== memberIdx) });
  };

  const handleStart = () => {
    const config = matchType === 'team'
      ? { SETS_TO_WIN: 1, MAX_SETS: 1, POINTS_TO_WIN: 31, MIN_POINT_DIFF: 2 }
      : { SETS_TO_WIN: setsToWin, MAX_SETS: maxSets, POINTS_TO_WIN: 11, MIN_POINT_DIFF: 2 };

    const p1 = matchType === 'team' ? (teams[0]?.name || t('referee.practice.setup.teamA')) : player1Name;
    const p2 = matchType === 'team' ? (teams[1]?.name || t('referee.practice.setup.teamB')) : player2Name;

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
    } else {
      if (player1Coach.trim()) params.set('p1c', player1Coach.trim());
      if (player2Coach.trim()) params.set('p2c', player2Coach.trim());
    }

    navigate(`/referee/practice/play?${params.toString()}`);
  };

  const canStart = matchType === 'individual'
    ? player1Name.trim() && player2Name.trim()
    : teams.length === 2 && teams.every(tm => tm.name.trim() && tm.members.length >= 3 && tm.members.every(m => m.name.trim()));

  return (
    <div className="p-4 max-w-lg mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-center" style={{ color: '#c084fc' }}>{t('referee.practice.setup.title')}</h1>

      <fieldset className="card space-y-4">
        <legend className="text-xl font-bold">{t('referee.practice.setup.matchType')}</legend>
        <div className="flex gap-3" role="radiogroup" aria-label={t('referee.practice.setup.matchType')}>
          <button
            role="radio"
            aria-checked={matchType === 'individual'}
            className={`btn flex-1 text-lg py-4 ${matchType === 'individual' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
            onClick={() => { setMatchType('individual'); setMaxSets(3); }}
            aria-label={`${t('referee.practice.setup.individual')}${matchType === 'individual' ? `, ${t('common.accessibility.selected')}` : ''}`}
          >
            {t('referee.practice.setup.individual')}
          </button>
          <button
            role="radio"
            aria-checked={matchType === 'team'}
            className={`btn flex-1 text-lg py-4 ${matchType === 'team' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
            onClick={() => setMatchType('team')}
            aria-label={`${t('common.tournamentType.team')}${matchType === 'team' ? `, ${t('common.accessibility.selected')}` : ''}`}
          >
            {t('common.tournamentType.team')}
          </button>
        </div>
      </fieldset>

      {matchType === 'individual' ? (
        <>
          <div className="card space-y-4">
            <h2 className="text-xl font-bold">{t('referee.practice.setup.playerNames')}</h2>
            <div className="space-y-1">
              <input className="input" value={player1Name} onChange={e => setPlayer1Name(e.target.value)} placeholder={t('referee.practice.setup.player1Name')} aria-label={t('referee.practice.setup.player1Name')} />
              <input className="input text-sm" value={player1Coach} onChange={e => setPlayer1Coach(e.target.value)} placeholder={`${player1Name} ${t('referee.practice.setup.coachLabel')}`} aria-label={`${player1Name} ${t('referee.practice.setup.coachLabel')}`} />
            </div>
            <div className="space-y-1">
              <input className="input" value={player2Name} onChange={e => setPlayer2Name(e.target.value)} placeholder={t('referee.practice.setup.player2Name')} aria-label={t('referee.practice.setup.player2Name')} />
              <input className="input text-sm" value={player2Coach} onChange={e => setPlayer2Coach(e.target.value)} placeholder={`${player2Name} ${t('referee.practice.setup.coachLabel')}`} aria-label={`${player2Name} ${t('referee.practice.setup.coachLabel')}`} />
            </div>
          </div>
          <div className="card space-y-4">
            <h2 className="text-xl font-bold">{t('referee.practice.setup.matchRules')}</h2>
            <div className="flex items-center gap-2">
              <span className="text-gray-300">{t('referee.practice.setup.winScore')}:</span>
              <span className="text-white font-bold">{t('referee.practice.setup.points11')}</span>
              <span className="text-gray-400 text-sm">{t('referee.practice.setup.ibsaRules')}</span>
            </div>
            <fieldset>
              <legend className="block mb-2 text-gray-300">{t('referee.practice.setup.setsToWin')}</legend>
              <div className="flex gap-2" role="radiogroup" aria-label={t('referee.practice.setup.setsToWin')}>
                {[1, 3, 5].map(v => (
                  <button key={v} role="radio" aria-checked={maxSets === v} className={`btn flex-1 ${maxSets === v ? 'btn-primary' : 'bg-gray-700 text-white'}`} onClick={() => setMaxSets(v)} aria-label={`${v}${t('common.units.set')}${maxSets === v ? `, ${t('common.accessibility.selected')}` : ''}`}>
                    {v}{t('common.units.set')}
                  </button>
                ))}
              </div>
            </fieldset>
            <p className="text-cyan-400 font-semibold text-center">{t('referee.practice.setup.ruleSummary', { setsToWin, maxSets })}</p>
          </div>
        </>
      ) : (
        <>
          {teams.map((team, idx) => (
            <div key={idx} className="card space-y-3" data-team={idx} style={{ borderLeft: `4px solid ${idx === 0 ? '#facc15' : '#22d3ee'}` }}>
              {editingTeam === idx ? (
                <>
                  <div className="flex justify-between items-center">
                    <h3 className={`text-lg font-bold ${idx === 0 ? 'text-yellow-400' : 'text-cyan-400'}`}>{t('referee.practice.setup.teamEdit', { num: idx + 1 })}</h3>
                    <button className="text-sm text-gray-400 underline" onClick={() => setEditingTeam(null)} aria-label={t('referee.practice.setup.teamEditDoneAriaLabel')} style={{ minHeight: '44px', minWidth: '44px' }}>{t('referee.practice.setup.teamEditDone')}</button>
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">{t('referee.practice.setup.teamName')}</label>
                    <input className="input" data-field="name" value={team.name} onChange={e => updateTeam(idx, { name: e.target.value })} aria-label={t('referee.practice.setup.teamNameAriaLabel')} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">{t('referee.practice.setup.coachOptional')}</label>
                    <input className="input" value={team.coach} onChange={e => updateTeam(idx, { coach: e.target.value })} placeholder={t('referee.practice.setup.coachOptional')} aria-label={t('referee.practice.setup.coachAriaLabel')} />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm text-gray-400">{t('referee.practice.setup.memberOrder')}</label>
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
                          placeholder={t('referee.practice.setup.memberPlaceholder', { num: mi + 1 })}
                          aria-label={t('referee.practice.setup.memberPlaceholder', { num: mi + 1 })}
                        />
                        <button
                          className={`btn text-xs px-2 py-1 ${member.gender === 'male' ? 'bg-blue-700 text-blue-200' : 'bg-pink-700 text-pink-200'}`}
                          onClick={() => {
                            const arr = [...team.members];
                            arr[mi] = { ...arr[mi], gender: member.gender === 'male' ? 'female' : 'male' };
                            updateTeam(idx, { members: arr });
                          }}
                          aria-label={t('referee.practice.setup.genderToggle', { gender: member.gender === 'male' ? t('common.gender.male') : t('common.gender.female') })}
                        >
                          {member.gender === 'male' ? t('common.gender.male') : t('common.gender.female')}
                        </button>
                        {team.members.length > 3 && (
                          <button className="btn bg-red-900 text-red-300 text-xs px-2 py-1" onClick={() => removeMember(idx, mi)} aria-label={`${member.name} ${t('common.delete')}`}>{t('common.delete')}</button>
                        )}
                      </div>
                    ))}
                    {team.members.length < 6 && (
                      <button className="btn bg-gray-700 text-gray-300 text-sm w-full py-2" onClick={() => addMember(idx)}>
                        {t('referee.practice.setup.addReserveMember', { max: 6 - team.members.length })}
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
                          <p>{t('referee.practice.setup.memberInfo', { reserve: team.members.length > 3 ? t('referee.practice.setup.reserveInfo', { count: team.members.length - 3 }) : '' })}</p>
                          <p>{t('referee.practice.setup.genderInfo', { male: maleCount, female: femaleCount, activeMale, activeFemale })}</p>
                        </div>
                      );
                    })()}
                  </div>
                  <button className="btn bg-red-900/50 text-red-400 text-sm w-full py-2" onClick={() => removeTeam(idx)}>{t('referee.practice.setup.deleteTeam')}</button>
                </>
              ) : (
                <div
                  className="flex justify-between items-center cursor-pointer"
                  onClick={() => setEditingTeam(idx)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingTeam(idx); } }}
                  role="button"
                  tabIndex={0}
                  aria-label={t('referee.practice.setup.teamSummaryAriaLabel', { name: team.name })}
                >
                  <div>
                    <h3 className={`text-lg font-bold ${idx === 0 ? 'text-yellow-400' : 'text-cyan-400'}`}>{team.name}</h3>
                    {team.coach && <p className="text-sm text-gray-400">{t('referee.practice.setup.coachLabel')}: {team.coach}</p>}
                    <p className="text-sm text-gray-400">{team.members.map(m => m.name).join(', ')}</p>
                  </div>
                  <span className="text-gray-400 text-sm" aria-hidden="true">{t('common.edit')}</span>
                </div>
              )}
            </div>
          ))}

          {teams.length < 2 && (
            <button
              className="card w-full text-center py-6 border-2 border-dashed border-gray-600 hover:border-yellow-400 text-gray-400 hover:text-yellow-400 text-lg font-bold"
              onClick={addTeam}
              aria-label={t('referee.practice.setup.addNewTeamAriaLabel', { current: teams.length })}
            >
              {t('referee.practice.setup.addNewTeam', { current: teams.length })}
            </button>
          )}

          <div className="card">
            <p className="text-cyan-400 font-semibold text-center">{t('referee.practice.setup.teamRuleSummary')}</p>
          </div>
        </>
      )}

      <div className="flex justify-center gap-4">
        <button className="btn btn-success btn-large flex-1" onClick={handleStart} disabled={!canStart} aria-label={t('referee.practice.setup.startAriaLabel')}>{t('referee.practice.setup.startButton')}</button>
        <button className="btn btn-accent flex-1" onClick={() => navigate('/referee/practice')} aria-label={t('common.back')}>{t('common.back')}</button>
      </div>
    </div>
  );
}
