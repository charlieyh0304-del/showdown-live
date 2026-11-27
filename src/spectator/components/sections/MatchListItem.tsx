import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Match } from '@shared/types';
import type { SlotLabel } from '@shared/hooks/useSlotLabel';
import type { TournamentLike } from '@shared/rules/competitionRules';
import { matchSetWins } from '@shared/utils/scoring';
import type { ScheduleRow } from '../../utils/spectatorData';
import { useStageLabel } from '../../hooks/useStageLabels';

export type SlotLabelFn = (m: Match, side: 1 | 2) => SlotLabel;

/** 화면낭독기가 항목 사이를 끊어 읽게 하는 보이지 않는 쉼표 */
function Sep() {
  return <span className="sr-only">, </span>;
}

const STATUS_COLOR: Record<string, string> = { in_progress: '#ef4444', completed: '#22c55e', pending: '#d1d5db' };

export interface MatchListItemProps {
  row: ScheduleRow;
  tournamentId: string;
  slotLabel: SlotLabelFn;
  tournament?: TournamentLike | null;
  /** 이 선수 기준 승패 표시 (선수 상세) */
  perspectiveKey?: string;
  /** 시각 대신 날짜까지 보인다 */
  showDate?: boolean;
}

/**
 * 경기 한 줄 (링크). 링크 글자 전체가 화면낭독기 이름이 된다:
 * "10:30, 1번 코트, A조, 김철수 대 이영희, 끝남, 세트 2 대 1". 미정 자리는 '미정 (4강 1경기 승자)'.
 */
export default function MatchListItem({ row, tournamentId, slotLabel, tournament, perspectiveKey, showDate }: MatchListItemProps) {
  const { t } = useTranslation();
  const stageLabel = useStageLabel();
  const m = row.match;
  const s1 = slotLabel(m, 1);
  const s2 = slotLabel(m, 2);
  const when = row.time.time
    ? (showDate && row.time.date ? `${row.time.date} ${row.time.time}` : row.time.time)
    : t('spectator.schedule.timeTbd');
  const stage = stageLabel(m);
  const sets = Array.isArray(m.sets) ? m.sets : [];
  const wins = m.status !== 'pending' && sets.length > 0 ? matchSetWins(m, tournament) : null;
  let result = '';
  if (perspectiveKey && m.status === 'completed' && m.winnerId) {
    const mine = [m.player1Id, m.team1Id, m.player1Name, m.team1Name].includes(perspectiveKey) ? 1 : 2;
    const winSide = m.winnerId === m.player1Id || m.winnerId === m.team1Id ? 1 : 2;
    result = mine === winSide ? t('spectator.playerProfile.win') : t('spectator.playerProfile.loss');
  }
  return (
    <li>
      <Link
        to={`/spectator/match/${tournamentId}/${m.id}`}
        className="card"
        style={{ display: 'block', textDecoration: 'none', color: 'inherit', padding: '0.625rem 0.875rem', border: `1px solid ${m.status === 'in_progress' ? '#ef4444' : '#374151'}` }}
      >
        <span style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.875rem', color: '#d1d5db' }}>
          <span style={{ fontWeight: 'bold', color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{when}</span>
          {row.court.name && <span><Sep />{row.court.name}</span>}
          {stage && <span><Sep />{stage}</span>}
        </span>
        <span style={{ display: 'block', fontSize: '1.0625rem', fontWeight: 'bold', margin: '0.25rem 0' }}>
          <Sep />
          <span style={s1.undecided ? { color: '#9ca3af', fontStyle: 'italic' } : undefined}>{s1.undecided ? s1.srText : s1.text}</span>
          {' '}{t('spectator.schedule.versus')}{' '}
          <span style={s2.undecided ? { color: '#9ca3af', fontStyle: 'italic' } : undefined}>{s2.undecided ? s2.srText : s2.text}</span>
        </span>
        <span style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.875rem' }}>
          <span style={{ color: STATUS_COLOR[m.status] || '#d1d5db', fontWeight: 'bold' }}><Sep />{t(`spectator.schedule.status.${m.status}`)}</span>
          {wins && <span><Sep />{t('spectator.schedule.setScore', { s1: wins.player1, s2: wins.player2 })}</span>}
          {result && <span style={{ fontWeight: 'bold' }}><Sep />{result}</span>}
          {m.refereeName && <span style={{ color: '#9ca3af' }}><Sep />{t('spectator.schedule.referee', { name: m.refereeName })}</span>}
        </span>
      </Link>
    </li>
  );
}
