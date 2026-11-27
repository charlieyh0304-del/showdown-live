/**
 * 관전 도우미의 기기 안 답변 (서버에 닿지 않을 때, 그리고 설정 명령은 항상 기기에서 바로).
 * - 설정 명령: "글씨 크게", "글씨 작게", "고대비", "밝은 화면", "어두운 화면", "색 반전", "알림 켜줘/꺼줘", "○○ 즐겨찾기(해제)"
 * - 정보 질문: "1번 코트 지금 뭐 해?", "○○ 다음 경기", "A조 순위", "지금 진행 중인 경기"
 * 파서와 답변 생성은 순수 함수다(데이터와 번역 함수를 받는다).
 */
import type { Match, ScheduleSlot, Tournament } from '@shared/types';
import type { ColorMode } from '@shared/utils/a11ySettings';
import { calculateGroupRanking } from '@shared/utils/ranking';
import { matchSetWins } from '@shared/utils/scoring';
import { buildScheduleRows, courtBoard, nextMatchRows, sideName, involves, type ScheduleRow } from './spectatorData';
import type { Translate } from './rulesSentence';

export type SettingCommand =
  | { setting: 'fontStep'; delta: 1 | -1 }
  | { setting: 'colorMode'; mode: ColorMode }
  | { setting: 'notifications'; on: boolean };

export type SpectatorIntent =
  | { type: 'setting'; command: SettingCommand }
  | { type: 'favorite'; name: string; on: boolean }
  | { type: 'court'; court: string }
  | { type: 'nextMatch'; name: string }
  | { type: 'standings'; group: string | null }
  | { type: 'live' };

export interface IntentContext {
  /** 알려진 선수·팀 이름 (긴 이름부터 맞춘다) */
  names: ReadonlyArray<string>;
}

function compact(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/[\s?!.,~]+/g, '');
}

function findName(text: string, names: ReadonlyArray<string>): string | null {
  const c = compact(text);
  const sorted = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  return sorted.find(n => c.includes(compact(n))) ?? null;
}

/** 설정 명령만 (서버 없이 항상 기기에서 처리) */
export function parseSettingCommand(text: string): SettingCommand | null {
  const c = compact(text);
  if (/(글씨|글자|폰트|font).*(크게|키워|키우|확대|bigger|larger)|^(크게|bigger)$/.test(c)) return { setting: 'fontStep', delta: 1 };
  if (/(글씨|글자|폰트|font).*(작게|줄여|축소|smaller)/.test(c)) return { setting: 'fontStep', delta: -1 };
  if (/(색반전|반전|invert)/.test(c)) return { setting: 'colorMode', mode: 'invert' };
  if (/(흰바탕|흰색바탕|하얀바탕|white).*(고대비|검정|검은|black)|고대비.*(흰|하얀|white)/.test(c)) return { setting: 'colorMode', mode: 'high-contrast-light' };
  if (/(고대비|highcontrast)/.test(c)) return { setting: 'colorMode', mode: 'high-contrast' };
  if (/(밝은|라이트|light)(화면|모드|테마|mode)/.test(c)) return { setting: 'colorMode', mode: 'light' };
  if (/(어두운|다크|dark)(화면|모드|테마|mode)/.test(c)) return { setting: 'colorMode', mode: 'dark' };
  if (/(알림|notification).*(꺼|끄|해제|중지|off|disable)/.test(c)) return { setting: 'notifications', on: false };
  if (/(알림|notification).*(켜|켜줘|설정|받|on|enable)/.test(c)) return { setting: 'notifications', on: true };
  return null;
}

export function parseSpectatorIntent(text: string, ctx: IntentContext): SpectatorIntent | null {
  const command = parseSettingCommand(text);
  if (command) return { type: 'setting', command };
  const c = compact(text);
  const name = findName(text, ctx.names);
  if (name && /(즐겨찾기|favorite|별)/.test(c)) {
    return { type: 'favorite', name, on: !/(해제|빼|삭제|지워|취소|remove|unfavorite)/.test(c) };
  }
  const court = c.match(/(\d+)번?(코트|테이블|court|table)|(코트|테이블|court|table)(\d+)/);
  if (court) return { type: 'court', court: court[1] || court[4] };
  if (/(순위|랭킹|standing|ranking)/.test(c)) {
    const g = c.match(/([a-z가-힣0-9])조/);
    return { type: 'standings', group: g ? g[1].toUpperCase() : null };
  }
  if (name && /(다음|언제|일정|몇시|next|when|경기)/.test(c)) return { type: 'nextMatch', name };
  if (/(진행중|지금|현재|live|now)/.test(c)) return { type: 'live' };
  return null;
}

export interface SpectatorData {
  tournament: Tournament | null;
  matches: ReadonlyArray<Match>;
  schedule: ReadonlyArray<ScheduleSlot>;
}

function vs(m: Match, t: Translate): string {
  return t('spectator.assistant.vs', { p1: sideName(m, 1) || t('common.competitionRules.undecided'), p2: sideName(m, 2) || t('common.competitionRules.undecided') });
}

function liveScore(m: Match, tournament: Tournament | null, t: Translate): string {
  const sets = Array.isArray(m.sets) ? m.sets : [];
  const cur = sets[m.currentSet ?? sets.length - 1] ?? sets[sets.length - 1];
  const w = sets.length ? matchSetWins(m, tournament) : { player1: 0, player2: 0 };
  return t('spectator.assistant.liveScore', { set: (m.currentSet ?? 0) + 1, s1: cur?.player1Score ?? 0, s2: cur?.player2Score ?? 0, w1: w.player1, w2: w.player2 });
}

function rowWhen(r: ScheduleRow, t: Translate): string {
  const parts = [r.time.date, r.time.time].filter(Boolean).join(' ');
  const court = r.court.name ? ` ${r.court.name}` : '';
  return parts ? `${parts}${court}` : `${t('spectator.schedule.timeTbd')}${court}`;
}

/** 정보 질문에 데이터로 답한다 (설정·즐겨찾기 의도는 null — 실행하는 쪽이 처리한다) */
export function answerSpectatorIntent(intent: SpectatorIntent, data: SpectatorData, now: number, t: Translate): string | null {
  const rows = buildScheduleRows(data.matches, data.schedule, data.tournament?.date || '');
  switch (intent.type) {
    case 'court': {
      const board = courtBoard(rows, now);
      const entry = board.find(e => (e.court.name.match(/\d+/)?.[0] ?? e.court.id) === intent.court || e.court.id === intent.court);
      if (!entry) return t('spectator.assistant.courtUnknown', { court: intent.court });
      const parts: string[] = [];
      if (entry.current) parts.push(t('spectator.assistant.courtNow', { court: entry.court.name, match: vs(entry.current.match, t), score: liveScore(entry.current.match, data.tournament, t) }));
      else parts.push(t('spectator.assistant.courtIdle', { court: entry.court.name }));
      if (entry.next) parts.push(t('spectator.assistant.courtNext', { match: vs(entry.next.match, t), when: rowWhen(entry.next, t) }));
      return parts.join(' ');
    }
    case 'nextMatch': {
      const mine = rows.filter(r => involves(r.match, [intent.name]));
      const live = mine.find(r => r.match.status === 'in_progress');
      if (live) return t('spectator.assistant.playerLive', { name: intent.name, match: vs(live.match, t), score: liveScore(live.match, data.tournament, t) });
      const next = nextMatchRows(mine, now, { includeUntimed: true })[0];
      if (!next) return t('spectator.assistant.playerNoNext', { name: intent.name });
      return t('spectator.assistant.playerNext', { name: intent.name, match: vs(next.match, t), when: rowWhen(next, t) });
    }
    case 'standings': {
      const groupMatches = data.matches.filter(m => m.groupId && (!intent.group || m.groupId.toUpperCase() === intent.group));
      const pool = groupMatches.length ? groupMatches : (intent.group ? [] : [...data.matches]);
      if (pool.length === 0) return t('spectator.assistant.standingsNone');
      const groups = intent.group ? [intent.group] : [...new Set(pool.map(m => m.groupId || ''))].sort();
      return groups.map(g => {
        const gm = pool.filter(m => (m.groupId || '') === g || (!!intent.group && m.groupId?.toUpperCase() === g));
        const ranking = calculateGroupRanking([...gm], undefined, data.tournament, g ? gm[0]?.groupId || g : '');
        const list = ranking.slice(0, 4).map(r => t('spectator.assistant.rankItem', { rank: r.rank, name: r.playerName, w: r.wins, l: r.losses })).join(', ');
        const label = g ? t('spectator.tournament.view.groupLabel', { id: g }) : t('spectator.assistant.overall');
        return `${label}: ${list}`;
      }).join(' ');
    }
    case 'live': {
      const live = rows.filter(r => r.match.status === 'in_progress');
      if (live.length === 0) return t('spectator.assistant.noLive');
      return t('spectator.assistant.liveList', { count: live.length, list: live.slice(0, 5).map(r => `${r.court.name ? `${r.court.name} ` : ''}${vs(r.match, t)} ${liveScore(r.match, data.tournament, t)}`).join('; ') });
    }
    default:
      return null;
  }
}
