import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Player, Team, SeedEntry, Tournament } from '@shared/types';

// Firebase can return arrays as objects with numeric keys; ensure we always get an array
function toArray<T>(val: T[] | Record<string, T> | undefined | null): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val);
  return [];
}

// ========================
// 한글 IME 안전 입력 컴포넌트
// React DOM 트리 완전 우회 - 순수 native DOM으로 input 생성
// React의 이벤트 위임/값 추적이 input에 전혀 개입하지 않음
// ========================
function KoreanNameInput({ onSubmit, placeholder, ariaLabel }: {
  onSubmit: (name: string, gender: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const composingRef = useRef(false);

  const submit = useCallback(() => {
    const input = inputRef.current;
    const select = selectRef.current;
    if (!input) return;
    const trimmed = input.value.trim();
    if (!trimmed) return;
    onSubmit(trimmed, select?.value || '');
    input.value = '';
    if (select) select.value = '';
    input.focus();
  }, [onSubmit]);

  return (
    <div style={{ display: 'flex', gap: '4px' }}>
      <input
        ref={inputRef}
        className="input"
        style={{ flex: 1, fontSize: '0.875rem' }}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !composingRef.current) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder || t('admin.tournamentDetail.koreanInput.playerNamePlaceholder')}
        aria-label={ariaLabel}
      />
      <select
        ref={selectRef}
        className="input"
        style={{ width: '64px', fontSize: '0.875rem' }}
        aria-label={t('admin.tournamentDetail.koreanInput.genderAriaLabel')}
      >
        <option value="">{t('admin.tournamentDetail.koreanInput.genderLabel')}</option>
        <option value="male">{t('admin.tournamentDetail.koreanInput.genderMale')}</option>
        <option value="female">{t('admin.tournamentDetail.koreanInput.genderFemale')}</option>
      </select>
      <button
        type="button"
        className="btn btn-success"
        style={{ fontSize: '0.875rem', padding: '0.5rem 0.75rem' }}
        onClick={submit}
        aria-label={t('admin.tournamentDetail.koreanInput.addPlayerAriaLabel')}
      >
        +
      </button>
    </div>
  );
}

// ========================
// Players Tab
// ========================
export interface PlayersTabProps {
  tournament: Tournament;
  tournamentPlayers: Player[];
  globalPlayers: Player[];
  addTournamentPlayer: (player: Omit<Player, 'id' | 'createdAt'>) => Promise<string | null>;
  deleteTournamentPlayer: (id: string) => Promise<void>;
  addPlayersFromGlobal: (players: Player[]) => Promise<void>;
  updateTournament: (data: Record<string, unknown>) => Promise<boolean | void>;
  isTeamType: boolean;
  teams: Team[];
  setTeamsBulk: (teams: Team[]) => Promise<void>;
}

function PlayersTab({ tournament, tournamentPlayers, globalPlayers, addTournamentPlayer, deleteTournamentPlayer, addPlayersFromGlobal, updateTournament, isTeamType, teams, setTeamsBulk }: PlayersTabProps) {
  const { t } = useTranslation();
  const [generating, setGenerating] = useState(false);
  const [showGlobalModal, setShowGlobalModal] = useState(false);
  const [bulkNames, setBulkNames] = useState('');
  const [selectedGlobalIds, setSelectedGlobalIds] = useState<string[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [seeds, setSeeds] = useState<SeedEntry[]>(toArray(tournament.seeds));
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  // 팀별 설정 편집용 로컬 state (Firebase 즉시 쓰기 대신 로컬에서 편집 후 저장)
  const [editCoachName, setEditCoachName] = useState('');
  const [editMaxReserves, setEditMaxReserves] = useState<string>('');
  const [editGenderMale, setEditGenderMale] = useState<string>('');
  const [editGenderFemale, setEditGenderFemale] = useState<string>('');

  // 편집 모드 진입 시 현재 값 로드
  const startEditing = useCallback((teamId: string) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    setEditCoachName(team.coachName ?? '');
    setEditMaxReserves(team.maxReserves != null ? String(team.maxReserves) : '');
    setEditGenderMale(team.genderRatio?.male != null ? String(team.genderRatio.male) : '');
    setEditGenderFemale(team.genderRatio?.female != null ? String(team.genderRatio.female) : '');
    setEditingTeamId(teamId);
  }, [teams]);

  // 편집 저장
  const saveTeamSettings = useCallback(async () => {
    if (!editingTeamId) return;
    const male = editGenderMale === '' ? undefined : Number(editGenderMale);
    const female = editGenderFemale === '' ? undefined : Number(editGenderFemale);
    const newRatio = (male == null && female == null) ? undefined : { male: male ?? 0, female: female ?? 0 };
    const updated = teams.map(t => t.id !== editingTeamId ? t : {
      ...t,
      coachName: editCoachName || undefined,
      maxReserves: editMaxReserves === '' ? undefined : Number(editMaxReserves),
      genderRatio: newRatio,
    });
    await setTeamsBulk(updated);
    setEditingTeamId(null);
  }, [editingTeamId, editCoachName, editMaxReserves, editGenderMale, editGenderFemale, teams, setTeamsBulk]);
  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamCoach, setNewTeamCoach] = useState('');
  const [newTeamMembers, setNewTeamMembers] = useState<{ name: string; gender: '' | 'male' | 'female' }[]>([]);
  const composingRef = useRef(false);
  const isManualTeam = tournament.type === 'team';

  const openAddTeamModal = useCallback(() => {
    setNewTeamName('');
    setNewTeamCoach('');
    setNewTeamMembers([]);
    setShowAddTeamModal(true);
  }, []);

  const handleAddTeamFromModal = useCallback(async () => {
    const nextIdx = teams.length + 1;
    const name = newTeamName.trim() || t('admin.tournamentDetail.playersTabInline.defaultTeamName', { idx: nextIdx });
    // 모달에서 입력한 멤버들을 선수로 등록하면서 팀에 추가
    const memberIds: string[] = [];
    const memberNames: string[] = [];
    for (const m of newTeamMembers) {
      const id = await addTournamentPlayer({ name: m.name, gender: m.gender || undefined });
      if (id) {
        memberIds.push(id);
        memberNames.push(m.name);
      }
    }
    const newTeam: Team = {
      id: `team_${Date.now()}`,
      name,
      memberIds,
      memberNames,
      ...(newTeamCoach.trim() ? { coachName: newTeamCoach.trim() } : {}),
    };
    await setTeamsBulk([...teams, newTeam]);
    setShowAddTeamModal(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [teams, newTeamName, newTeamMembers, addTournamentPlayer, setTeamsBulk]);

  const handleDeleteTeam = useCallback(async (teamId: string) => {
    if (!confirm(t('admin.tournamentDetail.playersTabInline.deleteTeamConfirm'))) return;
    await setTeamsBulk(teams.filter(t => t.id !== teamId));
  }, [teams, setTeamsBulk]);


  const handleRemoveMemberFromTeam = useCallback(async (memberId: string, teamId: string) => {
    const updated = teams.map(t => {
      if (t.id !== teamId) return t;
      const idx = (t.memberIds || []).indexOf(memberId);
      if (idx === -1) return t;
      return {
        ...t,
        memberIds: (t.memberIds || []).filter((_, i) => i !== idx),
        memberNames: (t.memberNames || []).filter((_, i) => i !== idx),
      };
    });
    await setTeamsBulk(updated);
  }, [teams, setTeamsBulk]);

  const toggleSeed = (playerId: string, name: string) => {
    const existing = seeds.findIndex(s => s.playerId === playerId);
    if (existing >= 0) {
      setSeeds(seeds.filter((_, i) => i !== existing));
    } else {
      setSeeds([...seeds, { position: seeds.length + 1, playerId, name }]);
    }
  };

  const saveSeeds = async () => {
    await updateTournament({ seeds });
  };

  const handleBulkAdd = useCallback(async () => {
    const names = bulkNames.split('\n').map(n => n.trim()).filter(n => n);
    for (const name of names) {
      await addTournamentPlayer({ name });
    }
    setBulkNames('');
  }, [bulkNames, addTournamentPlayer]);

  const handleImportGlobal = useCallback(async () => {
    const toImport = globalPlayers.filter(p => selectedGlobalIds.includes(p.id));
    if (toImport.length === 0) return;
    await addPlayersFromGlobal(toImport);
    setSelectedGlobalIds([]);
    setShowGlobalModal(false);
  }, [globalPlayers, selectedGlobalIds, addPlayersFromGlobal]);

  const toggleGlobalSelect = useCallback((playerId: string) => {
    setSelectedGlobalIds(prev =>
      prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]
    );
  }, []);

  const generateRandomTeams = useCallback(async () => {
    if (tournamentPlayers.length < 3) return;
    setGenerating(true);
    try {
      const teamSize = tournament.teamRules?.teamSize || 3;
      const genderRatio = tournament.teamRules?.genderRatio;

      const males = tournamentPlayers.filter(p => p.gender === 'male');
      const females = tournamentPlayers.filter(p => p.gender === 'female');
      const hasBothGenders = males.length > 0 && females.length > 0;

      // 성별 비율 결정: 설정값 > 자동 계산 (혼성이면 균등 배분)
      const effectiveRatio = (genderRatio && (genderRatio.male > 0 || genderRatio.female > 0))
        ? genderRatio
        : hasBothGenders
          ? { male: Math.min(males.length, Math.ceil(teamSize / 2)), female: Math.max(1, teamSize - Math.min(males.length, Math.ceil(teamSize / 2))) }
          : null;

      if (effectiveRatio && hasBothGenders) {
        const teamCount = Math.floor(tournamentPlayers.length / teamSize);
        const requiredMales = effectiveRatio.male * teamCount;
        const requiredFemales = effectiveRatio.female * teamCount;

        if (males.length < requiredMales || females.length < requiredFemales) {
          alert(t('admin.tournamentDetail.playersTabInline.genderShortageAlert', { requiredMale: requiredMales, requiredFemale: requiredFemales, currentMale: males.length, currentFemale: females.length }));
          setGenerating(false);
          return;
        }

        const shuffledMales = [...males].sort(() => Math.random() - 0.5);
        const shuffledFemales = [...females].sort(() => Math.random() - 0.5);

        const newTeams: Team[] = [];
        for (let i = 0; i < teamCount; i++) {
          const members = [
            ...shuffledMales.splice(0, effectiveRatio.male),
            ...shuffledFemales.splice(0, effectiveRatio.female),
          ];
          newTeams.push({
            id: `team_${i + 1}`,
            name: t('admin.tournamentDetail.playersTabInline.defaultTeamName', { idx: i + 1 }),
            memberIds: members.map(m => m.id),
            memberNames: members.map(m => m.name),
          });
        }
        await setTeamsBulk(newTeams);
      } else {
        // 성별 정보 없는 경우에만 단순 랜덤
        const shuffled = [...tournamentPlayers].sort(() => Math.random() - 0.5);
        const newTeams: Team[] = [];
        let teamIdx = 1;
        for (let i = 0; i < shuffled.length; i += teamSize) {
          const members = shuffled.slice(i, i + teamSize);
          if (members.length === 0) continue;
          newTeams.push({
            id: `team_${teamIdx}`,
            name: t('admin.tournamentDetail.playersTabInline.defaultTeamName', { idx: teamIdx }),
            memberIds: members.map(m => m.id),
            memberNames: members.map(m => m.name),
          });
          teamIdx++;
        }
        await setTeamsBulk(newTeams);
      }
    } finally {
      setGenerating(false);
    }
  }, [tournamentPlayers, tournament.teamRules, setTeamsBulk]);

  return (
    <div className="space-y-6">
      {/* 개인전 또는 랜덤 팀리그: 전역 선수 등록 */}
      {!isManualTeam && (
      <div className="card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h2 className="text-xl font-bold text-center">{t('admin.tournamentDetail.playersTab.tournamentPlayers')} ({tournamentPlayers.length}{t('common.units.person')})</h2>
          <button
            className="btn btn-secondary"
            onClick={() => setShowGlobalModal(true)}
            aria-label={t('admin.tournamentDetail.playersTab.importFromGlobal')}
          >
            {t('admin.tournamentDetail.playersTab.importFromGlobal')}
          </button>
        </div>

        {/* 선수 추가 */}
        <div className="card space-y-4">
          <h3 className="text-lg font-bold">{t('admin.tournamentDetail.playersTab.addPlayerTitle')}</h3>

          {/* 개별 추가 - 비제어 컴포넌트 (한글 IME 호환) */}
          <KoreanNameInput
            placeholder={t('admin.tournamentDetail.playersTabInline.playerNamePlaceholder')}
            ariaLabel={t('admin.tournamentDetail.playersTabInline.playerNameAriaLabel')}
            onSubmit={async (name, gender) => {
              await addTournamentPlayer({ name, gender: (gender as 'male' | 'female') || undefined });
            }}
          />

          {/* 일괄 추가 */}
          <details>
            <summary className="text-sm text-blue-400 cursor-pointer">{t('admin.tournamentDetail.playersTabInline.bulkAddSummary')}</summary>
            <div className="mt-2 space-y-2">
              <textarea
                className="input w-full h-32"
                value={bulkNames}
                onChange={e => setBulkNames(e.target.value)}
                placeholder={t('admin.tournamentDetail.playersTabInline.bulkAddPlaceholder')}
                aria-label={t('admin.tournamentDetail.playersTabInline.bulkAddAriaLabel')}
              />
              <button
                className="btn btn-success w-full"
                onClick={handleBulkAdd}
                disabled={!bulkNames.trim()}
              >
                {t('admin.tournamentDetail.playersTabInline.bulkAddButton', { count: bulkNames.trim() ? bulkNames.trim().split('\n').filter(n => n.trim()).length : 0 })}
              </button>
            </div>
          </details>
        </div>

        {tournamentPlayers.length === 0 ? (
          <p className="text-gray-400 text-center">{t('admin.tournamentDetail.playersTab.noPlayers')}</p>
        ) : (
          <>
            <div className="flex justify-between items-center flex-wrap gap-2 mb-2">
              <label className="flex items-center gap-2 cursor-pointer" style={{ minHeight: '44px' }}>
                <input
                  type="checkbox"
                  checked={selectedPlayerIds.size === tournamentPlayers.length && tournamentPlayers.length > 0}
                  ref={el => { if (el) el.indeterminate = selectedPlayerIds.size > 0 && selectedPlayerIds.size < tournamentPlayers.length; }}
                  onChange={() => {
                    if (selectedPlayerIds.size === tournamentPlayers.length) setSelectedPlayerIds(new Set());
                    else setSelectedPlayerIds(new Set(tournamentPlayers.map(p => p.id)));
                  }}
                  aria-label={t('common.selectAll', { defaultValue: '전체 선택' })}
                  style={{ width: '20px', height: '20px' }}
                />
                <span className="text-sm text-gray-300">{t('common.selectAll', { defaultValue: '전체 선택' })} ({selectedPlayerIds.size}/{tournamentPlayers.length})</span>
              </label>
              {selectedPlayerIds.size > 0 && (
                <button
                  className="btn btn-danger text-sm"
                  style={{ minHeight: '44px' }}
                  onClick={async () => {
                    if (!confirm(t('admin.tournamentDetail.playersTabInline.bulkDeleteConfirm', { count: selectedPlayerIds.size, defaultValue: `${selectedPlayerIds.size}명을 삭제하시겠습니까?` }))) return;
                    for (const id of selectedPlayerIds) await deleteTournamentPlayer(id);
                    setSelectedPlayerIds(new Set());
                  }}
                  aria-label={t('admin.tournamentDetail.playersTabInline.bulkDelete', { count: selectedPlayerIds.size, defaultValue: `${selectedPlayerIds.size}명 삭제` })}
                >
                  {t('admin.tournamentDetail.playersTabInline.bulkDelete', { count: selectedPlayerIds.size, defaultValue: `${selectedPlayerIds.size}명 삭제` })}
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {tournamentPlayers.map(p => (
                <div key={p.id} className={`flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3 border ${selectedPlayerIds.has(p.id) ? 'border-yellow-500' : 'border-gray-600'}`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedPlayerIds.has(p.id)}
                      onChange={() => setSelectedPlayerIds(prev => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                        return next;
                      })}
                      aria-label={t('common.select', { name: p.name, defaultValue: `${p.name} 선택` })}
                      style={{ width: '18px', height: '18px', flexShrink: 0 }}
                    />
                    <span className="font-bold">{p.name}</span>
                    {isTeamType && p.gender === 'male' && <span className="ml-1 text-xs text-blue-400">{t('common.gender.male')}</span>}
                    {isTeamType && p.gender === 'female' && <span className="ml-1 text-xs text-pink-400">{t('common.gender.female')}</span>}
                    {p.club && <span className="ml-2 text-sm opacity-75">({p.club})</span>}
                    {p.class && <span className="ml-2 text-sm opacity-75">[{p.class}]</span>}
                  </div>
                  <button
                    className="text-red-400 hover:text-red-300 font-bold text-lg"
                    onClick={() => deleteTournamentPlayer(p.id)}
                    aria-label={t('admin.tournamentDetail.playersTabInline.deletePlayerAriaLabel', { name: p.name })}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      )}

      {isTeamType && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h2 className="text-xl font-bold text-center">{t('admin.tournamentDetail.playersTabInline.teamCompositionTitle', { count: teams.length })}</h2>
            <div className="flex gap-2">
              {tournament.type === 'randomTeamLeague' && (
                <button
                  className="btn btn-accent"
                  onClick={generateRandomTeams}
                  disabled={generating || tournamentPlayers.length < 3}
                  aria-label={t('admin.tournamentDetail.playersTabInline.randomTeamAriaLabel')}
                >
                  {generating ? t('admin.tournamentDetail.playersTabInline.generating') : t('admin.tournamentDetail.playersTabInline.randomTeamGenerate')}
                </button>
              )}
              <button className="btn btn-success" onClick={openAddTeamModal} aria-label={t('admin.tournamentDetail.playersTabInline.addNewTeamAriaLabel')}>
                {t('admin.tournamentDetail.playersTabInline.addNewTeam')}
              </button>
            </div>
          </div>

          {/* 팀 카드 목록 */}
          {teams.length === 0 ? (
            <p className="text-gray-400 text-center">{t('admin.tournamentDetail.playersTabInline.noTeams')}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {teams.map(team => {
                const isEditing = editingTeamId === team.id;
                const globalMaxReserves = tournament.teamRules?.maxReserves;
                const globalGenderRatio = tournament.teamRules?.genderRatio;
                const memberCount = (team.memberIds || []).length;
                return (
                  <div key={team.id} className="bg-gray-800 rounded-lg p-4 border border-gray-600">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-cyan-400">{team.coachName ? t('admin.tournamentDetail.playersTabInline.teamHeaderWithCoach', { name: team.name, count: memberCount, coach: team.coachName }) : t('admin.tournamentDetail.playersTabInline.teamHeader', { name: team.name, count: memberCount })}</h3>
                      <div className="flex items-center gap-2">
                        <button
                          className="text-sm text-blue-400 hover:text-blue-300"
                          onClick={() => isEditing ? setEditingTeamId(null) : startEditing(team.id)}
                          aria-label={isEditing ? t('admin.tournamentDetail.playersTabInline.foldAriaLabel', { name: team.name }) : t('admin.tournamentDetail.playersTabInline.editAriaLabel', { name: team.name })}
                        >
                          {isEditing ? t('admin.tournamentDetail.playersTabInline.foldButton') : t('admin.tournamentDetail.playersTabInline.editButton')}
                        </button>
                        <button
                          className="text-sm text-red-400 hover:text-red-300"
                          onClick={() => handleDeleteTeam(team.id)}
                          aria-label={t('admin.tournamentDetail.playersTabInline.deleteAriaLabel', { name: team.name })}
                        >
                          {t('admin.tournamentDetail.playersTabInline.deleteButton')}
                        </button>
                      </div>
                    </div>
                    {/* 팀 멤버 목록 (항상 표시) */}
                    <ul className="mt-2 space-y-1">
                      {(team.memberIds ?? []).map((memberId, i) => {
                        const memberName = (team.memberNames ?? [])[i] ?? memberId;
                        const player = tournamentPlayers.find(p => p.id === memberId);
                        return (
                          <li key={memberId} className="flex items-center justify-between bg-gray-700 rounded px-3 py-1.5">
                            <span className="text-gray-200">
                              {memberName}
                              {player?.gender === 'male' && <span className="ml-1 text-xs text-blue-400">{t('common.gender.male')}</span>}
                              {player?.gender === 'female' && <span className="ml-1 text-xs text-pink-400">{t('common.gender.female')}</span>}
                            </span>
                            {isEditing && (
                            <button
                              className="text-red-400 hover:text-red-300 font-bold text-sm"
                              onClick={() => handleRemoveMemberFromTeam(memberId, team.id)}
                              aria-label={t('admin.tournamentDetail.playersTabInline.removeMemberAriaLabel', { name: memberName })}
                            >
                              x
                            </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {memberCount === 0 && (
                      <p className="text-gray-400 text-sm mt-2">{t('admin.tournamentDetail.playersTabInline.addMemberPlaceholder')}</p>
                    )}
                    {/* 편집 모드에서만 추가/설정 표시 */}
                    {isEditing && <>
                    {/* 팀 내 선수 추가 */}
                    <div className="mt-3">
                      <KoreanNameInput
                        placeholder={t('admin.tournamentDetail.playersTabInline.playerNamePlaceholder')}
                        ariaLabel={t('admin.tournamentDetail.playersTabInline.addMemberToTeamAriaLabel', { team: team.name })}
                        onSubmit={async (name, gender) => {
                          const id = await addTournamentPlayer({ name, gender: (gender as 'male' | 'female') || undefined });
                          if (!id) return;
                          const updated = teams.map(t => t.id !== team.id ? t : {
                            ...t,
                            memberIds: [...(t.memberIds || []), id],
                            memberNames: [...(t.memberNames || []), name],
                          });
                          await setTeamsBulk(updated);
                        }}
                      />
                    </div>
                    {/* Per-team settings editor (로컬 state로 편집, 저장 버튼으로 한번에 반영) */}
                      <div className="mt-3 pt-3 border-t border-gray-700 space-y-3">
                        <p className="text-xs text-gray-400">
                          {t('admin.tournamentDetail.playersTabInline.teamSettingsHint')}{globalMaxReserves != null || globalGenderRatio ? t('admin.tournamentDetail.playersTabInline.teamSettingsHintDefaults', { reserves: globalMaxReserves ?? '-', male: globalGenderRatio?.male ?? '-', female: globalGenderRatio?.female ?? '-' }) : ''})
                        </p>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.playersTabInline.coachLabel')}</label>
                          <input
                            type="text"
                            className="input w-full"
                            value={editCoachName}
                            placeholder={t('admin.tournamentDetail.playersTabInline.coachPlaceholder')}
                            onChange={e => setEditCoachName(e.target.value)}
                            aria-label={t('admin.tournamentDetail.playersTabInline.coachAriaLabel', { team: team.name })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.playersTabInline.reserveCountLabel')}</label>
                          <input
                            type="number"
                            className="input w-full"
                            min={0}
                            max={20}
                            value={editMaxReserves}
                            placeholder={globalMaxReserves != null ? t('admin.tournamentDetail.playersTabInline.reservePlaceholderDefault', { value: globalMaxReserves }) : t('admin.tournamentDetail.playersTabInline.reservePlaceholderNone')}
                            onChange={e => setEditMaxReserves(e.target.value)}
                            aria-label={t('admin.tournamentDetail.playersTabInline.reserveAriaLabel', { team: team.name })}
                          />
                        </div>
                        <div>
                          <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.playersTabInline.genderRatioLabel')}</label>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className="block text-xs text-gray-300 mb-0.5">{t('admin.tournamentDetail.playersTabInline.maleLabel')}</label>
                              <input
                                type="number"
                                className="input w-full"
                                min={0}
                                max={20}
                                value={editGenderMale}
                                placeholder={globalGenderRatio ? t('admin.tournamentDetail.playersTabInline.genderPlaceholderDefault', { value: globalGenderRatio.male }) : t('admin.tournamentDetail.playersTabInline.genderPlaceholderNone')}
                                onChange={e => setEditGenderMale(e.target.value)}
                                aria-label={t('admin.tournamentDetail.playersTabInline.maleAriaLabel', { team: team.name })}
                              />
                            </div>
                            <div className="flex-1">
                              <label className="block text-xs text-gray-300 mb-0.5">{t('admin.tournamentDetail.playersTabInline.femaleLabel')}</label>
                              <input
                                type="number"
                                className="input w-full"
                                min={0}
                                max={20}
                                value={editGenderFemale}
                                placeholder={globalGenderRatio ? t('admin.tournamentDetail.playersTabInline.genderPlaceholderDefault', { value: globalGenderRatio.female }) : t('admin.tournamentDetail.playersTabInline.genderPlaceholderNone')}
                                onChange={e => setEditGenderFemale(e.target.value)}
                                aria-label={t('admin.tournamentDetail.playersTabInline.femaleAriaLabel', { team: team.name })}
                              />
                            </div>
                          </div>
                        </div>
                        <button
                          className="btn btn-primary w-full"
                          onClick={saveTeamSettings}
                          aria-label={t('admin.tournamentDetail.playersTabInline.saveSettingsAriaLabel')}
                        >
                          {t('admin.tournamentDetail.playersTabInline.saveSettingsButton')}
                        </button>
                      </div>
                    </>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 수동 모드: 탑시드 지정 → 시드 수만큼 조 자동 생성 */}
      {tournament.formatType === 'manual' && tournamentPlayers.length >= 4 && (() => {
        const seedLabel = (idx: number) => String.fromCharCode(65 + idx);
        const maxSeeds = Math.min(16, Math.floor(tournamentPlayers.length / 2));
        const currentGroupCount = tournament.qualifyingConfig?.groupCount || 0;
        return (
          <div className="card space-y-4">
            <h3 className="text-lg font-bold text-yellow-400">{t('admin.tournamentDetail.topSeedSection.title')}</h3>
            <p className="text-gray-400 text-sm">
              {t('admin.tournamentDetail.topSeedSection.descriptionManual')}
            </p>
            <div className="space-y-2">
              {tournamentPlayers.map((player) => {
                const seedIdx = seeds.findIndex(s => s.playerId === player.id);
                const hasSeed = seedIdx >= 0;
                const label = hasSeed ? seedLabel(seedIdx) : '-';
                return (
                  <div key={player.id} className="flex items-center gap-3 bg-gray-800 rounded p-2">
                    <button
                      className={`w-8 h-8 rounded-full text-sm font-bold ${
                        hasSeed ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-400'
                      }`}
                      aria-label={hasSeed ? t('admin.tournamentDetail.topSeedSection.seedRemoveAriaLabel', { name: player.name, label }) : t('admin.tournamentDetail.topSeedSection.seedAssignAriaLabel', { name: player.name })}
                      onClick={() => {
                        if (hasSeed) {
                          toggleSeed(player.id, player.name);
                        } else if (seeds.length < maxSeeds) {
                          toggleSeed(player.id, player.name);
                        }
                      }}
                      disabled={!hasSeed && seeds.length >= maxSeeds}
                    >
                      {label}
                    </button>
                    <span className="text-white flex-1">{player.name}</span>
                    {hasSeed && (
                      <span className="text-yellow-400 text-xs font-bold">{t('admin.tournamentDetail.topSeedSection.seedBadge', { label })}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {seeds.length >= 2 && (
              <div className="bg-cyan-900/20 rounded-lg p-3">
                <p className="text-cyan-300 text-sm font-semibold">
                  {t('admin.tournamentDetail.topSeedSection.seedInfoText', { count: seeds.length, perGroup: Math.ceil(tournamentPlayers.length / seeds.length) })}
                </p>
              </div>
            )}
            <button
              className="btn btn-primary w-full"
              disabled={seeds.length < 2}
              onClick={async () => {
                const groupCount = seeds.length;
                await saveSeeds();

                const now = Date.now();
                const existingStages = toArray(tournament.stages);
                const existingQualifying = existingStages.find(s => s.type === 'qualifying');
                const qualifyingStage = existingQualifying || {
                  id: `stage_qualifying_${now}`,
                  name: t('admin.tournamentDetail.bracketTab.qualifyingStageName'),
                  order: 0,
                  type: 'qualifying' as const,
                  format: 'group_knockout' as const,
                  groupCount,
                  status: 'pending' as const,
                };
                const updatedStage = { ...qualifyingStage, groupCount };
                const stages = existingQualifying
                  ? existingStages.map(s => s.id === existingQualifying.id ? updatedStage : s)
                  : [updatedStage, ...existingStages];
                await updateTournament({
                  seeds,
                  stages,
                  qualifyingConfig: {
                    ...(tournament.qualifyingConfig || {}),
                    groupCount,
                    format: 'group_round_robin',
                  },
                });
              }}
              aria-label={t('admin.tournamentDetail.topSeedSection.saveAndCreateGroupsAriaLabel')}
            >
              {seeds.length < 2 ? t('admin.tournamentDetail.topSeedSection.minSeedRequired') : t('admin.tournamentDetail.topSeedSection.saveAndCreateGroups', { count: seeds.length })}
            </button>
            {currentGroupCount > 0 && (
              <p className="text-green-400 text-sm">{t('admin.tournamentDetail.topSeedSection.currentGroupCount', { count: currentGroupCount })}</p>
            )}
          </div>
        );
      })()}

      {/* 수동 모드: 본선 설정 (조가 있을 때) */}
      {tournament.formatType === 'manual' && tournament.qualifyingConfig?.groupCount && tournament.qualifyingConfig.groupCount > 1 && (
        <div className="card space-y-3">
          <h4 className="text-md font-bold text-cyan-400">{t('admin.tournamentDetail.finalsSetup.title')}</h4>
          <p className="text-gray-400 text-sm">{t('admin.tournamentDetail.finalsSetup.description')}</p>
          <div className="flex items-center gap-4">
            <label className="text-gray-300">{t('admin.tournamentDetail.finalsSetup.advancePerGroup')}</label>
            <input
              type="number"
              className="input w-24"
              min={1}
              max={Math.ceil(tournamentPlayers.length / (tournament.qualifyingConfig.groupCount || 2))}
              value={(() => {
                const fc = tournament.finalsConfig as Record<string, unknown> | undefined;
                const apc = fc?.advancePerGroup;
                return typeof apc === 'number' ? apc : 2;
              })()}
              onChange={async (e) => {
                const advancePerGroup = Math.max(1, Number(e.target.value) || 1);
                const groupCount = tournament.qualifyingConfig?.groupCount || 2;
                const totalAdvance = advancePerGroup * groupCount;
                let startRound = 4;
                while (startRound < totalAdvance) startRound *= 2;

                const existingStages = toArray(tournament.stages);
                const existingFinals = existingStages.find(s => s.type === 'finals');
                const now = Date.now();
                const finalsStage = existingFinals || {
                  id: `stage_finals_${now}`,
                  name: t('admin.tournamentDetail.bracketTab.finalsStageName'),
                  order: 1,
                  type: 'finals' as const,
                  format: 'single_elimination' as const,
                  status: 'pending' as const,
                };
                const updatedFinals = { ...finalsStage, advanceCount: totalAdvance };
                const stages = existingFinals
                  ? existingStages.map(s => s.id === existingFinals.id ? updatedFinals : s)
                  : [...existingStages, updatedFinals];

                await updateTournament({
                  stages,
                  finalsConfig: {
                    ...(typeof tournament.finalsConfig === 'object' && tournament.finalsConfig ? tournament.finalsConfig : {}),
                    advancePerGroup,
                    advanceCount: totalAdvance,
                    format: 'single_elimination',
                    startingRound: startRound,
                    seedMethod: 'manual',
                  },
                });
              }}
              aria-label={t('admin.tournamentDetail.finalsSetupInline.advancePerGroupAriaLabel')}
            />
            <span className="text-gray-400 text-sm">
              {t('admin.tournamentDetail.finalsSetupInline.totalAdvance', { count: (() => {
                const fc = tournament.finalsConfig as Record<string, unknown> | undefined;
                const apc = fc?.advancePerGroup;
                const adv = typeof apc === 'number' ? apc : 2;
                return adv * (tournament.qualifyingConfig?.groupCount || 2);
              })() })}
            </span>
          </div>
          {toArray(tournament.stages).find(s => s.type === 'finals') && (
            <p className="text-green-400 text-sm">{t('admin.tournamentDetail.finalsSetupInline.finalsReady')}</p>
          )}
        </div>
      )}

      {/* 자동 모드: 탑시드 지정 */}
      {tournament.formatType !== 'manual' && tournament.qualifyingConfig?.groupCount && tournament.qualifyingConfig.groupCount > 1 && tournamentPlayers.length > 0 && (() => {
        const groupCount = tournament.qualifyingConfig!.groupCount;
        const seedLabel = (idx: number) => String.fromCharCode(65 + idx);
        const maxSeeds = groupCount;
        return (
          <div className="card space-y-4">
            <h3 className="text-lg font-bold text-yellow-400">{t('admin.tournamentDetail.topSeedSection.title')}</h3>
            <p className="text-gray-400 text-sm">
              {t('admin.tournamentDetail.topSeedSection.descriptionAuto', { max: maxSeeds })}
            </p>
            <div className="space-y-2">
              {tournamentPlayers.map((player) => {
                const seedIdx = seeds.findIndex(s => s.playerId === player.id);
                const hasSeed = seedIdx >= 0;
                const label = hasSeed ? seedLabel(seedIdx) : '-';
                return (
                  <div key={player.id} className="flex items-center gap-3 bg-gray-800 rounded p-2">
                    <button
                      className={`w-8 h-8 rounded-full text-sm font-bold ${
                        hasSeed ? 'bg-yellow-500 text-black' : 'bg-gray-700 text-gray-400'
                      }`}
                      aria-label={hasSeed ? t('admin.tournamentDetail.topSeedSection.seedRemoveAutoAriaLabel', { name: player.name, label }) : t('admin.tournamentDetail.topSeedSection.seedAssignAriaLabel', { name: player.name })}
                      onClick={() => {
                        if (hasSeed) {
                          toggleSeed(player.id, player.name);
                        } else if (seeds.length < maxSeeds) {
                          toggleSeed(player.id, player.name);
                        }
                      }}
                      disabled={!hasSeed && seeds.length >= maxSeeds}
                    >
                      {label}
                    </button>
                    <span className="text-white flex-1">{player.name}</span>
                    {hasSeed && (
                      <span className="text-yellow-400 text-xs font-bold">{t('admin.tournamentDetail.topSeedSection.seedBadge', { label })}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {seeds.length >= maxSeeds && (
              <p className="text-gray-400 text-xs">{t('admin.tournamentDetail.topSeedSection.seedsFull', { current: seeds.length, max: maxSeeds })}</p>
            )}
            <button className="btn btn-primary w-full" onClick={saveSeeds} aria-label={t('admin.tournamentDetail.topSeedSection.saveSeedsAriaLabel')}>{t('admin.tournamentDetail.topSeedSection.saveSeedsButton')}</button>
          </div>
        );
      })()}

      {/* 새 팀 추가 모달 */}
      {showAddTeamModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowAddTeamModal(false)} onKeyDown={e => { if (e.key === 'Escape') setShowAddTeamModal(false); }}>
          <div
            className="bg-gray-900 rounded-xl p-6 w-full max-w-md space-y-4 border border-gray-700 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-team-modal-title"
          >
            <h3 id="add-team-modal-title" className="text-xl font-bold text-yellow-400 text-center">{t('admin.tournamentDetail.addTeamModal.title')}</h3>

            <div>
              <label htmlFor="new-team-name" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.addTeamModal.teamNameLabel')}</label>
              <input
                id="new-team-name"
                className="input w-full"
                value={newTeamName}
                onChange={e => setNewTeamName(e.target.value)}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                placeholder={t('admin.tournamentDetail.playersTabInline.defaultTeamName', { idx: teams.length + 1 })}
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="new-team-coach" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.addTeamModal.coachNameLabel')}</label>
              <input
                id="new-team-coach"
                className="input w-full"
                value={newTeamCoach}
                onChange={e => setNewTeamCoach(e.target.value)}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                placeholder={t('admin.tournamentDetail.addTeamModal.coachPlaceholder')}
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">{t('admin.tournamentDetail.addTeamModal.playerRegistration')}</label>
              <div className="mb-3">
                <KoreanNameInput
                  placeholder={t('admin.tournamentDetail.addTeamModal.playerNamePlaceholder')}
                  ariaLabel={t('admin.tournamentDetail.addTeamModal.playerNameAriaLabel')}
                  onSubmit={(name, gender) => {
                    setNewTeamMembers(prev => [...prev, { name, gender: gender as '' | 'male' | 'female' }]);
                  }}
                />
              </div>

              {newTeamMembers.length > 0 && (
                <ul className="space-y-1">
                  {newTeamMembers.map((m, i) => (
                    <li key={i} className="flex items-center justify-between bg-gray-800 rounded px-3 py-2">
                      <span className="text-gray-200">
                        {m.name}
                        {m.gender === 'male' && <span className="ml-1 text-xs text-blue-400">{t('common.gender.male')}</span>}
                        {m.gender === 'female' && <span className="ml-1 text-xs text-pink-400">{t('common.gender.female')}</span>}
                      </span>
                      <button
                        className="text-red-400 hover:text-red-300 font-bold text-sm"
                        onClick={() => setNewTeamMembers(prev => prev.filter((_, j) => j !== i))}
                        aria-label={t('admin.tournamentDetail.addTeamModal.removePlayerAriaLabel', { name: m.name })}
                      >
                        x
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {newTeamMembers.length === 0 && (
                <p className="text-gray-400 text-sm">{t('admin.tournamentDetail.addTeamModal.addPlayersPrompt')}</p>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                className="btn btn-success flex-1"
                onClick={handleAddTeamFromModal}
                aria-label={t('admin.tournamentDetail.addTeamModal.createTeamAriaLabel')}
              >
                {t('admin.tournamentDetail.addTeamModal.createTeamButton', { count: newTeamMembers.length })}
              </button>
              <button
                className="btn btn-secondary flex-1"
                onClick={() => setShowAddTeamModal(false)}
                aria-label={t('common.cancel')}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 전역 선수 가져오기 모달 */}
      {showGlobalModal && (
        <div className="modal-backdrop" onClick={() => setShowGlobalModal(false)} onKeyDown={e => { if (e.key === 'Escape') setShowGlobalModal(false); }}>
          <div className="card max-w-lg w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="global-player-modal-title">
            <div className="flex items-center justify-between mb-4">
              <h2 id="global-player-modal-title" className="text-xl font-bold text-center">{t('admin.tournamentDetail.playersTab.importFromGlobal')}</h2>
              <button
                className="text-gray-400 hover:text-white font-bold text-xl"
                onClick={() => setShowGlobalModal(false)}
                aria-label={t('common.close')}
              >
                x
              </button>
            </div>
            {globalPlayers.length === 0 ? (
              <p className="text-gray-400 text-center">{t('admin.tournamentDetail.globalPlayerModal.noGlobalPlayers')}</p>
            ) : (
              <div className="space-y-2 mb-4">
                <label className="flex items-center gap-2 cursor-pointer py-2" style={{ minHeight: '44px' }}>
                  <input
                    type="checkbox"
                    checked={selectedGlobalIds.length === globalPlayers.length && globalPlayers.length > 0}
                    ref={el => { if (el) el.indeterminate = selectedGlobalIds.length > 0 && selectedGlobalIds.length < globalPlayers.length; }}
                    onChange={() => {
                      if (selectedGlobalIds.length === globalPlayers.length) setSelectedGlobalIds([]);
                      else setSelectedGlobalIds(globalPlayers.map(p => p.id));
                    }}
                    aria-label={t('common.selectAll', { defaultValue: '전체 선택' })}
                    style={{ width: '20px', height: '20px' }}
                  />
                  <span className="text-sm text-gray-300">{t('common.selectAll', { defaultValue: '전체 선택' })} ({selectedGlobalIds.length}/{globalPlayers.length})</span>
                </label>
                {globalPlayers.map(p => {
                  const selected = selectedGlobalIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      className={`btn text-left w-full ${selected ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                      onClick={() => toggleGlobalSelect(p.id)}
                      aria-pressed={selected}
                      aria-label={selected ? t('admin.tournamentDetail.globalPlayerModal.selectedAriaLabel', { name: p.name }) : t('admin.tournamentDetail.globalPlayerModal.unselectedAriaLabel', { name: p.name })}
                    >
                      <span className="font-bold">{p.name}</span>
                      {p.club && <span className="ml-2 text-sm opacity-75">({p.club})</span>}
                      {p.class && <span className="ml-2 text-sm opacity-75">[{p.class}]</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <button
                className="btn btn-accent flex-1"
                onClick={handleImportGlobal}
                disabled={selectedGlobalIds.length === 0}
                aria-label={t('admin.tournamentDetail.globalPlayerModal.importAriaLabel')}
              >
                {t('admin.tournamentDetail.globalPlayerModal.importButton', { count: selectedGlobalIds.length })}
              </button>
              <button
                className="btn bg-gray-700 text-white hover:bg-gray-600 flex-1"
                onClick={() => setShowGlobalModal(false)}
                aria-label={t('common.cancel')}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PlayersTab;
