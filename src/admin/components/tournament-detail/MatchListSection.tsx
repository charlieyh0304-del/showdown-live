import { useTranslation } from 'react-i18next';
import type { Match, MatchStatus } from '@shared/types';

const STATUS_LABEL_KEYS: Record<MatchStatus, string> = {
  pending: 'common.matchStatus.pending',
  in_progress: 'common.matchStatus.inProgress',
  completed: 'common.matchStatus.completed',
};

const STATUS_ICONS: Record<MatchStatus, string> = {
  pending: '\u23F3',
  in_progress: '\u25B6',
  completed: '\u2713',
};

const STATUS_COLORS: Record<MatchStatus, string> = {
  pending: 'bg-gray-600 text-white',
  in_progress: 'bg-orange-500 text-black',
  completed: 'bg-green-600 text-white',
};

export interface MatchListSectionProps {
  matches: Match[];
  referees: { id: string; name: string }[];
  courts: { id: string; name: string }[];
  isTeamType: boolean;
  isCompleted: boolean;
  isManualMode: boolean;
  selectOptions: { id: string; name: string; group: string }[];
  // Callbacks
  handleSwapRound: (matchId: string, direction: 'up' | 'down') => Promise<void>;
  handleAssign: (matchId: string, field: 'refereeId' | 'courtId' | 'assistantRefereeId', value: string) => Promise<void>;
  handleDeleteMatch: (matchId: string) => Promise<void>;
  openEditModal: (match: Match) => void;
  // Edit modal state
  editingMatchId: string | null;
  setEditingMatchId: (id: string | null) => void;
  editPlayer1: string;
  editPlayer2: string;
  setEditPlayer1: (v: string) => void;
  setEditPlayer2: (v: string) => void;
  handleEditMatch: () => Promise<void>;
}

export default function MatchListSection({
  matches,
  referees,
  courts,
  isTeamType,
  isCompleted,
  isManualMode,
  selectOptions,
  handleSwapRound,
  handleAssign,
  handleDeleteMatch,
  openEditModal,
  editingMatchId,
  setEditingMatchId,
  editPlayer1,
  editPlayer2,
  setEditPlayer1,
  setEditPlayer2,
  handleEditMatch,
}: MatchListSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      {matches.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-gray-400 text-center">{t('admin.tournamentDetail.bracketTab.noBracket')}</p>
          {isManualMode && (
            <p className="text-yellow-400 text-sm mt-2">{t('admin.tournamentDetail.bracketTab.manualAddHint')}</p>
          )}
        </div>
      ) : (
        <div className="space-y-3" role="list" aria-label={`${t('admin.tournamentDetail.bracketTab.title')} (${matches.length})`}>
          {[...matches].sort((a, b) => {
            // 예선(groupId 있음) -> 본선(stageId에 finals) -> 기타
            const aIsQual = a.groupId ? 0 : 1;
            const bIsQual = b.groupId ? 0 : 1;
            if (aIsQual !== bIsQual) return aIsQual - bIsQual;
            return (a.createdAt ?? 0) - (b.createdAt ?? 0);
          }).map((match, matchIdx) => (
            <div key={match.id} className="card space-y-3" role="listitem" aria-setsize={matches.length} aria-posinset={matchIdx + 1}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  {/* Reorder buttons */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      className="text-xs text-gray-400 hover:text-white leading-none px-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleSwapRound(match.id, 'up')}
                      disabled={matchIdx === 0}
                      aria-label={t('admin.tournamentDetail.bracketTab.orderUpAriaLabel')}
                    >
                      &uarr;
                    </button>
                    <button
                      className="text-xs text-gray-400 hover:text-white leading-none px-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleSwapRound(match.id, 'down')}
                      disabled={matchIdx === matches.length - 1}
                      aria-label={t('admin.tournamentDetail.bracketTab.orderDownAriaLabel')}
                    >
                      &darr;
                    </button>
                  </div>
                  <span className="text-gray-400 text-sm">R{match.round}</span>
                  <span className="font-bold text-lg">
                    {match.type === 'team' ? (
                      <div>
                        <span>{match.team1Name ?? '?'} vs {match.team2Name ?? '?'}</span>
                        <div className="text-xs text-gray-400 mt-1 font-normal">
                          {match.team1Name}: {match.team1?.memberNames?.join(', ') || ''}
                          {' | '}
                          {match.team2Name}: {match.team2?.memberNames?.join(', ') || ''}
                        </div>
                      </div>
                    ) : `${match.player1Name ?? '?'} vs ${match.player2Name ?? '?'}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {match.status === 'pending' && !isCompleted && (
                    <button
                      className="text-xs text-blue-400 hover:text-blue-300 border border-blue-600 rounded px-2 py-1"
                      onClick={() => openEditModal(match)}
                      aria-label={t('admin.tournamentDetail.bracketTab.editMatchAriaLabel')}
                    >
                      {t('admin.tournamentDetail.bracketTab.editMatchButton')}
                    </button>
                  )}
                  {match.status === 'pending' && !isCompleted && (
                    <button
                      className="text-red-500 hover:text-red-400 font-bold text-lg leading-none px-1"
                      onClick={() => handleDeleteMatch(match.id)}
                      aria-label={t('admin.tournamentDetail.bracketTab.deleteMatchAriaLabel')}
                    >
                      &times;
                    </button>
                  )}
                  {match.walkover && (
                    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-600 text-white">
                      {t('admin.tournamentDetail.bracketTab.walkoverBadge')} ({match.type === 'individual'
                        ? (match.winnerId === match.player1Id ? match.player1Name : match.player2Name)
                        : (match.winnerId === match.team1Id ? match.team1Name : match.team2Name)} {t('spectator.playerProfile.win')})
                    </span>
                  )}
                  <span className={`px-3 py-1 rounded-full text-sm font-bold ${STATUS_COLORS[match.status]}`}>
                    {STATUS_ICONS[match.status]} {t(STATUS_LABEL_KEYS[match.status])}
                  </span>
                </div>
              </div>

              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-48">
                  <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.bracketTab.refereeLabel')}</label>
                  <select
                    className="input"
                    value={match.refereeId ?? ''}
                    onChange={e => handleAssign(match.id, 'refereeId', e.target.value)}
                    aria-label={`${match.type === 'individual' ? (match.player1Name ?? '?') + ' vs ' + (match.player2Name ?? '?') : (match.team1Name ?? '?') + ' vs ' + (match.team2Name ?? '?')} ${t('admin.tournamentDetail.bracketTab.refereeLabel')}`}
                  >
                    <option value="">{t('admin.tournamentDetail.bracketTab.refereeUnassigned')}</option>
                    {referees.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-48">
                  <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.bracketTab.assistantRefereeLabel')}</label>
                  <select
                    className="input"
                    value={match.assistantRefereeId ?? ''}
                    onChange={e => handleAssign(match.id, 'assistantRefereeId', e.target.value)}
                    aria-label={`${match.type === 'individual' ? (match.player1Name ?? '?') + ' vs ' + (match.player2Name ?? '?') : (match.team1Name ?? '?') + ' vs ' + (match.team2Name ?? '?')} ${t('admin.tournamentDetail.bracketTab.assistantRefereeLabel')}`}
                  >
                    <option value="">{t('admin.tournamentDetail.bracketTab.assistantRefereeNone')}</option>
                    {referees.filter(r => r.id !== match.refereeId).map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-48">
                  <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.bracketTab.courtLabel')}</label>
                  <select
                    className="input"
                    value={match.courtId ?? ''}
                    onChange={e => handleAssign(match.id, 'courtId', e.target.value)}
                    aria-label={`${match.type === 'individual' ? (match.player1Name ?? '?') + ' vs ' + (match.player2Name ?? '?') : (match.team1Name ?? '?') + ' vs ' + (match.team2Name ?? '?')} ${t('admin.tournamentDetail.bracketTab.courtLabel')}`}
                  >
                    <option value="">{t('admin.tournamentDetail.bracketTab.refereeUnassigned')}</option>
                    {courts.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 경기 수정 모달 */}
      {editingMatchId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setEditingMatchId(null)} onKeyDown={e => { if (e.key === 'Escape') setEditingMatchId(null); }}>
          <div className="bg-gray-900 rounded-xl p-6 w-full max-w-md space-y-4 border border-gray-700" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="edit-match-modal-title">
            <h3 id="edit-match-modal-title" className="text-lg font-bold text-yellow-400">{t('admin.tournamentDetail.bracketTab.editMatchModalTitle')}</h3>
            <div>
              <label className="block text-sm text-gray-300 mb-1">{isTeamType ? t('admin.tournamentDetail.bracketTab.team1Label') : t('admin.tournamentDetail.bracketTab.player1Label')}</label>
              <select className="input w-full" value={editPlayer1} onChange={e => setEditPlayer1(e.target.value)} aria-label={isTeamType ? t('admin.tournamentDetail.bracketTab.team1Label') : t('admin.tournamentDetail.bracketTab.player1Label')}>
                <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
                {selectOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1">{isTeamType ? t('admin.tournamentDetail.bracketTab.team2Label') : t('admin.tournamentDetail.bracketTab.player2Label')}</label>
              <select className="input w-full" value={editPlayer2} onChange={e => setEditPlayer2(e.target.value)} aria-label={isTeamType ? t('admin.tournamentDetail.bracketTab.team2Label') : t('admin.tournamentDetail.bracketTab.player2Label')}>
                <option value="">{t('admin.tournamentDetail.bracketTab.selectPlaceholder')}</option>
                {selectOptions.filter(o => o.id !== editPlayer1).map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            {editPlayer1 && editPlayer2 && editPlayer1 === editPlayer2 && (
              <p className="text-red-400 text-sm">{t('admin.tournamentDetail.bracketTab.samePlayerError')}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={() => setEditingMatchId(null)} aria-label={t('common.cancel')}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={handleEditMatch}
                disabled={!editPlayer1 || !editPlayer2 || editPlayer1 === editPlayer2}
                aria-label={t('common.save')}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
