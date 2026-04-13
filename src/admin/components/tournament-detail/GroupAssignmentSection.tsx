import { useTranslation } from 'react-i18next';
import type { Player, Team, StageGroup, Tournament } from '@shared/types';

// Firebase can return arrays as objects with numeric keys; ensure we always get an array
function toArray<T>(val: T[] | Record<string, T> | undefined | null): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val);
  return [];
}

export interface GroupAssignmentSectionProps {
  tournament: Tournament;
  tournamentPlayers: Player[];
  teams: Team[];
  isTeamType: boolean;
  isManualMode: boolean;
  groupAssignment: StageGroup[];
  groupEditWarning: boolean;
  setGroupAssignment: React.Dispatch<React.SetStateAction<StageGroup[]>>;
  setGroupEditWarning: React.Dispatch<React.SetStateAction<boolean>>;
  handleAutoGroupAssignment: () => Promise<void>;
  handleMovePlayer: (playerId: string, fromGroupId: string, toGroupId: string) => Promise<void>;
  updateTournament: (data: Record<string, unknown>) => Promise<boolean | void>;
}

export default function GroupAssignmentSection({
  tournament,
  tournamentPlayers,
  teams,
  isTeamType,
  isManualMode,
  groupAssignment,
  groupEditWarning,
  setGroupAssignment,
  setGroupEditWarning,
  handleAutoGroupAssignment,
  handleMovePlayer,
  updateTournament,
}: GroupAssignmentSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="card space-y-4 mb-4">
      <h3 className="text-lg font-bold text-yellow-400">{t('admin.tournamentDetail.bracketTab.groupAssignmentTitle')}</h3>
      {isManualMode ? (
        <div className="space-y-2">
          <button className="btn btn-primary w-full" onClick={handleAutoGroupAssignment} aria-label={t('admin.tournamentDetail.bracketTab.seedPlacementAriaLabel')}>
            {t('admin.tournamentDetail.bracketTab.seedPlacement')}
          </button>
          <p className="text-gray-400 text-sm">{t('admin.tournamentDetail.bracketTab.seedPlacementHint')}</p>
        </div>
      ) : (
        <button className="btn btn-success w-full" onClick={handleAutoGroupAssignment} aria-label={t('admin.tournamentDetail.bracketTab.autoAssignmentAriaLabel')}>
          {t('admin.tournamentDetail.bracketTab.autoAssignment')}
        </button>
      )}

      {/* 편성 결과 표시 */}
      {groupAssignment.length > 0 && (() => {
        const sizes = groupAssignment.map(g => (g.playerIds?.length || 0) + (g.teamIds?.length || 0));
        const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
        const isUnbalanced = sizes.some(s => Math.abs(s - avgSize) > 1);
        const assignedIds = new Set(groupAssignment.flatMap(g => g.playerIds));
        const unassignedPlayers = tournamentPlayers.filter(p => !assignedIds.has(p.id));
        return (
          <>
            {/* Group size summary */}
            <div className={`text-sm px-3 py-2 rounded ${isUnbalanced ? 'bg-yellow-900/50 border border-yellow-600 text-yellow-300' : 'bg-gray-700 text-gray-300'}`}>
              {groupAssignment.map((g, i) => (
                <span key={g.id}>
                  {i > 0 && ' | '}
                  <span className={sizes[i] !== Math.round(avgSize) && isUnbalanced ? 'text-yellow-400 font-bold' : ''}>
                    {g.name} ({t('admin.tournamentDetail.bracketTab.personCount', { count: sizes[i] })})
                  </span>
                </span>
              ))}
              {isUnbalanced && <span className="ml-2 text-yellow-400">{t('admin.tournamentDetail.bracketTab.unbalancedWarning')}</span>}
            </div>

            {/* 미배정 선수 */}
            {unassignedPlayers.length > 0 && (
              <div className="bg-red-900/30 border border-red-600 rounded p-3">
                <h4 className="text-sm font-bold text-red-400 mb-2">{t('admin.tournamentDetail.bracketTab.unassignedTitle', { count: unassignedPlayers.length })}</h4>
                <div className="space-y-1">
                  {unassignedPlayers.map(player => {
                    const seedIdx = toArray(tournament.seeds).findIndex(s => s.playerId === player.id);
                    return (
                      <div key={player.id} className="flex items-center gap-2 text-sm">
                        {seedIdx >= 0 && <span className="text-yellow-400 text-xs font-bold">{String.fromCharCode(65 + seedIdx)}</span>}
                        <span className="flex-1 text-gray-300">{player.name}</span>
                        <select
                          className="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1 border border-gray-600"
                          value=""
                          onChange={async (e) => {
                            const targetGroupId = e.target.value;
                            if (!targetGroupId) return;
                            const updatedGroups = groupAssignment.map(g =>
                              g.id === targetGroupId ? { ...g, playerIds: [...g.playerIds, player.id] } : g
                            );
                            setGroupAssignment(updatedGroups);
                            setGroupEditWarning(true);
                            const qualifyingStage = toArray(tournament.stages).find(s => s.type === 'qualifying');
                            if (qualifyingStage) {
                              const updatedStages = toArray(tournament.stages).map(s =>
                                s.id === qualifyingStage.id ? { ...s, groups: updatedGroups } : s
                              );
                              await updateTournament({ stages: updatedStages });
                            }
                          }}
                          aria-label={t('admin.tournamentDetail.bracketTab.assignGroupAriaLabel', { name: player.name })}
                        >
                          <option value="">{t('admin.tournamentDetail.bracketTab.selectGroupPlaceholder')}</option>
                          {groupAssignment.map(g => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Warning after manual edit */}
            {groupEditWarning && (
              <div className="text-sm px-3 py-2 rounded bg-orange-900/50 border border-orange-600 text-orange-300">
                {t('admin.tournamentDetail.bracketTab.groupEditWarning')}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {groupAssignment.map(group => (
                <div key={group.id} className="bg-gray-800 rounded p-3">
                  <h4 className="text-lg font-bold text-cyan-400 mb-2">{group.name} ({t('admin.tournamentDetail.bracketTab.personCount', { count: (group.playerIds?.length || 0) + (group.teamIds?.length || 0) })})</h4>
                  <ul className="space-y-1">
                    {(isTeamType ? (group.teamIds || []) : (group.playerIds || [])).map((pid) => {
                      const teamData = isTeamType ? teams.find(t => t.id === pid) : undefined;
                      const player = !isTeamType ? tournamentPlayers.find(p => p.id === pid) : undefined;
                      const displayName = isTeamType ? (teamData?.name || pid) : (player?.name || pid);
                      const seedIdx2 = toArray(tournament.seeds).findIndex(s => s.playerId === pid);
                      return (
                        <li key={pid} className="text-sm text-gray-300 flex items-center gap-2">
                          {seedIdx2 >= 0 && <span className="text-yellow-400 text-xs font-bold">{String.fromCharCode(65 + seedIdx2)}</span>}
                          <span className="flex-1">
                            {displayName}
                            {isTeamType && teamData?.memberNames && (
                              <span className="text-xs text-gray-500 ml-1">({teamData.memberNames.join(', ')})</span>
                            )}
                          </span>
                          {!isTeamType && (
                            <select
                              className="bg-gray-700 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-600"
                              value={group.id}
                              onChange={e => handleMovePlayer(pid, group.id, e.target.value)}
                              aria-label={t('admin.tournamentDetail.bracketTab.moveGroupAriaLabel', { name: displayName })}
                            >
                              {groupAssignment.map(g => (
                                <option key={g.id} value={g.id}>{g.name}</option>
                              ))}
                            </select>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </>
        );
      })()}
    </div>
  );
}
