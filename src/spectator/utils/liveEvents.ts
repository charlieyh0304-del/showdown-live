/**
 * 실시간 현황의 의미 있는 사건 감지 (점수 한 점마다가 아니라: 세트 종료, 경기 종료, 골든골 시작).
 * aria-live 안내 문장은 이 사건으로만 만든다(점수마다 읽으면 화면낭독기 사용자가 다른 내용을 들을 수 없다).
 */
import type { Match } from '@shared/types';
import { setWinnerOf, type ScoringRuleSet } from '@shared/rules/competitionRules';
import { sideName } from './spectatorData';
import type { Translate } from './rulesSentence';

export type LiveEvent =
  | { kind: 'set_end'; match: Match; setNumber: number; winner: 1 | 2; score1: number; score2: number }
  | { kind: 'match_end'; match: Match; winner: 1 | 2 | null; sets1: number; sets2: number }
  | { kind: 'golden_goal'; match: Match };

function decidedSets(m: Match, rules: ScoringRuleSet): Array<{ index: number; winner: 1 | 2 }> {
  const sets = Array.isArray(m.sets) ? m.sets : [];
  const out: Array<{ index: number; winner: 1 | 2 }> = [];
  sets.forEach((s, index) => {
    const w = setWinnerOf(s, rules);
    if (w) out.push({ index, winner: w });
  });
  return out;
}

function winnerSide(m: Match): 1 | 2 | null {
  if (!m.winnerId) return null;
  if (m.winnerId === m.player1Id || m.winnerId === m.team1Id) return 1;
  if (m.winnerId === m.player2Id || m.winnerId === m.team2Id) return 2;
  return null;
}

/**
 * 이전 스냅샷과 새 스냅샷을 비교해 사건을 돌려준다. 이전에 없던 경기(처음 불러옴)는 사건을 만들지 않는다.
 * 시계(clock)가 있는 경기의 골든골은 MatchClockDisplay가 따로 알리므로 여기서는 시계 없는 경기만 본다.
 */
export function detectLiveEvents(
  prev: ReadonlyArray<Match>,
  next: ReadonlyArray<Match>,
  scoringOf: (m: Match) => ScoringRuleSet,
): LiveEvent[] {
  const before = new Map(prev.map(m => [m.id, m]));
  const events: LiveEvent[] = [];
  for (const m of next) {
    const p = before.get(m.id);
    if (!p) continue;
    const rules = scoringOf(m);
    if (p.status !== 'completed' && m.status === 'completed') {
      const ds = decidedSets(m, rules);
      events.push({
        kind: 'match_end', match: m, winner: winnerSide(m),
        sets1: ds.filter(d => d.winner === 1).length, sets2: ds.filter(d => d.winner === 2).length,
      });
      continue;
    }
    if (m.status === 'in_progress') {
      const pd = decidedSets(p, scoringOf(p));
      const nd = decidedSets(m, rules);
      if (nd.length > pd.length) {
        const last = nd[nd.length - 1];
        const s = m.sets![last.index];
        events.push({ kind: 'set_end', match: m, setNumber: last.index + 1, winner: last.winner, score1: s.player1Score, score2: s.player2Score });
      }
      if (!m.clock && !p.goldenGoalActive && m.goldenGoalActive) events.push({ kind: 'golden_goal', match: m });
    }
  }
  return events;
}

/** 사건 → 자연어 문장 ("김철수 대 이영희, 1세트 끝. 김철수 승리, 11 대 9") */
export function describeLiveEvent(e: LiveEvent, t: Translate): string {
  const p1 = sideName(e.match, 1) || t('referee.home.player1Default');
  const p2 = sideName(e.match, 2) || t('referee.home.player2Default');
  const court = e.match.courtName ? t('spectator.live.eventCourt', { court: e.match.courtName }) : '';
  switch (e.kind) {
    case 'set_end':
      return t('spectator.live.eventSetEnd', { court, p1, p2, set: e.setNumber, winner: e.winner === 1 ? p1 : p2, s1: e.score1, s2: e.score2 });
    case 'match_end':
      return e.winner
        ? t('spectator.live.eventMatchEnd', { court, p1, p2, winner: e.winner === 1 ? p1 : p2, s1: e.sets1, s2: e.sets2 })
        : t('spectator.live.eventMatchEndNoWinner', { court, p1, p2 });
    case 'golden_goal':
      return t('spectator.live.eventGoldenGoal', { court, p1, p2 });
  }
}
