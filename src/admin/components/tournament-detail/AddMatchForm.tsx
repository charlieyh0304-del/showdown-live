import { useTranslation } from 'react-i18next';
import type { StageGroup } from '@shared/types';

export interface AddMatchFormProps {
  isTeamType: boolean;
  groupAssignment: StageGroup[];
  selectOptions: { id: string; name: string; group: string }[];
  existingPairs: Set<string>;
  // State
  addPlayer1: string;
  addPlayer2: string;
  addGroupId: string;
  setAddPlayer1: (v: string) => void;
  setAddPlayer2: (v: string) => void;
  setAddGroupId: (v: string) => void;
  // Callbacks
  handleAddMatch: () => Promise<void>;
}

export default function AddMatchForm({
  isTeamType,
  groupAssignment,
  selectOptions,
  existingPairs,
  addPlayer1,
  addPlayer2,
  addGroupId,
  setAddPlayer1,
  setAddPlayer2,
  setAddGroupId,
  handleAddMatch,
}: AddMatchFormProps) {
  const { t } = useTranslation();

  const hasGroups = groupAssignment.length > 0 && groupAssignment.some(g => (g.playerIds?.length || 0) > 0 || (g.teamIds?.length || 0) > 0);
  const selectedP1Group = addPlayer1 ? (() => {
    for (const g of groupAssignment) {
      if ((g.playerIds || []).includes(addPlayer1) || (g.teamIds || []).includes(addPlayer1)) return g.name;
    }
    return '';
  })() : '';
  const selectedGroupId = addGroupId || groupAssignment.find(g => g.name === selectedP1Group)?.id || '';

  // 선수1: 조 필터 적용
  const p1Options = hasGroups && addGroupId
    ? selectOptions.filter(o => o.group === groupAssignment.find(g => g.id === addGroupId)?.name)
    : selectOptions;

  // 선수2: 같은 조 + 미매칭 선수만
  const p2Options = selectOptions.filter(o => {
    if (o.id === addPlayer1) return false;
    if (existingPairs.has(`${addPlayer1}__${o.id}`)) return false;
    if (hasGroups && selectedP1Group && o.group !== selectedP1Group) return false;
    return true;
  });

  return (
    <div className="card space-y-3 border-green-600">
      <h3 className="font-bold text-green-400">{t('admin.tournamentDetail.bracketTab.addMatchTitle')}</h3>
      <div className="flex gap-3 flex-wrap items-end">
        {/* 조 선택 (조가 있을 때만) */}
        {hasGroups && (
          <div className="min-w-32">
            <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.bracketTab.groupSelectPlaceholder')}</label>
            <select className="input w-full" value={addGroupId} onChange={e => { setAddGroupId(e.target.value); setAddPlayer1(''); setAddPlayer2(''); }} aria-label={t('admin.tournamentDetail.bracketTab.groupSelectPlaceholder')}>
              <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
              {groupAssignment.map(g => (
                <option key={g.id} value={g.id}>{g.name} ({(g.playerIds?.length || 0) + (g.teamIds?.length || 0)})</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex-1 min-w-40">
          <label className="block text-sm text-gray-300 mb-1">{isTeamType ? t('admin.tournamentDetail.bracketTab.team1Label') : t('admin.tournamentDetail.bracketTab.player1Label')}</label>
          <select className="input w-full" value={addPlayer1} onChange={e => { setAddPlayer1(e.target.value); setAddPlayer2(''); if (hasGroups && !addGroupId) { const g = groupAssignment.find(g2 => (g2.playerIds || []).includes(e.target.value) || (g2.teamIds || []).includes(e.target.value)); if (g) setAddGroupId(g.id); } }} aria-label={isTeamType ? t('admin.tournamentDetail.bracketTab.team1SelectAriaLabel') : t('admin.tournamentDetail.bracketTab.player1SelectAriaLabel')}>
            <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
            {p1Options.map(o => (
              <option key={o.id} value={o.id}>{o.group ? `[${o.group}] ${o.name}` : o.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-40">
          <label className="block text-sm text-gray-300 mb-1">{isTeamType ? t('admin.tournamentDetail.bracketTab.team2Label') : t('admin.tournamentDetail.bracketTab.player2Label')}</label>
          <select className="input w-full" value={addPlayer2} onChange={e => setAddPlayer2(e.target.value)} aria-label={isTeamType ? t('admin.tournamentDetail.bracketTab.team2SelectAriaLabel') : t('admin.tournamentDetail.bracketTab.player2SelectAriaLabel')}>
            <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
            {p2Options.map(o => (
              <option key={o.id} value={o.id}>{o.group ? `[${o.group}] ${o.name}` : o.name}</option>
            ))}
          </select>
        </div>
        {/* 조 없을 때만 수동 그룹ID 입력 */}
        {!hasGroups && (
          <div className="min-w-32">
            <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.bracketTab.groupIdLabel')}</label>
            <input className="input w-full" value={addGroupId} onChange={e => setAddGroupId(e.target.value)} placeholder={t('admin.tournamentDetail.bracketTab.groupIdPlaceholder')} aria-label={t('admin.tournamentDetail.bracketTab.groupIdAriaLabel')} />
          </div>
        )}
        <button
          className="btn btn-success"
          onClick={() => { handleAddMatch(); if (hasGroups && selectedGroupId) setAddGroupId(selectedGroupId); }}
          disabled={!addPlayer1 || !addPlayer2 || addPlayer1 === addPlayer2}
          aria-label={t('admin.tournamentDetail.bracketTab.addAriaLabel')}
        >
          {t('admin.tournamentDetail.bracketTab.addButton')}
        </button>
      </div>
      {addPlayer1 && addPlayer2 && addPlayer1 === addPlayer2 && (
        <p className="text-red-400 text-sm">{t('admin.tournamentDetail.bracketTab.samePlayerError')}</p>
      )}
      {addPlayer1 && p2Options.length === 0 && (
        <p className="text-gray-400 text-sm">{t('admin.tournamentDetail.bracketTab.allDuplicate')}</p>
      )}
    </div>
  );
}
