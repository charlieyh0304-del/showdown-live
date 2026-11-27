import { describe, it, expect } from 'vitest';
import type { Match } from '@shared/types';
import { tFor, RAW_KEY } from '@shared/i18n/testing';
import { answerSpectatorIntent, parseSettingCommand, parseSpectatorIntent } from './spectatorIntents';

const ko = tFor('ko');
const en = tFor('en');
const names = ['이종경', '김철수', '이영희'];

describe('parseSpectatorIntent (기기 안 의도 파서)', () => {
  it('setting commands', () => {
    expect(parseSettingCommand('글씨 크게')).toEqual({ setting: 'fontStep', delta: 1 });
    expect(parseSettingCommand('글자 좀 작게 해 줘')).toEqual({ setting: 'fontStep', delta: -1 });
    expect(parseSettingCommand('고대비')).toEqual({ setting: 'colorMode', mode: 'high-contrast' });
    expect(parseSettingCommand('흰 바탕 고대비로')).toEqual({ setting: 'colorMode', mode: 'high-contrast-light' });
    expect(parseSettingCommand('색 반전')).toEqual({ setting: 'colorMode', mode: 'invert' });
    expect(parseSettingCommand('밝은 화면')).toEqual({ setting: 'colorMode', mode: 'light' });
    expect(parseSettingCommand('알림 꺼줘')).toEqual({ setting: 'notifications', on: false });
    expect(parseSettingCommand('알림 켜줘')).toEqual({ setting: 'notifications', on: true });
    expect(parseSettingCommand('오늘 날씨')).toBeNull();
  });

  it('favorites, court, next match, standings, live', () => {
    expect(parseSpectatorIntent('이종경 즐겨찾기', { names })).toEqual({ type: 'favorite', name: '이종경', on: true });
    expect(parseSpectatorIntent('이종경 즐겨찾기 해제', { names })).toEqual({ type: 'favorite', name: '이종경', on: false });
    expect(parseSpectatorIntent('1번 코트 지금 뭐 해?', { names })).toEqual({ type: 'court', court: '1' });
    expect(parseSpectatorIntent('김철수 다음 경기 언제야', { names })).toEqual({ type: 'nextMatch', name: '김철수' });
    expect(parseSpectatorIntent('A조 순위', { names })).toEqual({ type: 'standings', group: 'A' });
    expect(parseSpectatorIntent('지금 진행 중인 경기', { names })).toEqual({ type: 'live' });
    expect(parseSpectatorIntent('안녕', { names })).toBeNull();
  });
});

describe('answerSpectatorIntent (기기 안 답변)', () => {
  const day = '2026-11-28';
  const matches = [
    { id: 'm1', type: 'individual', status: 'in_progress', player1Id: 'p1', player1Name: '김철수', player2Id: 'p2', player2Name: '이영희', groupId: 'A', courtId: 'c1', courtName: '1번 코트', currentSet: 0, sets: [{ player1Score: 5, player2Score: 3 }] },
    { id: 'm2', type: 'individual', status: 'pending', player1Id: 'p3', player1Name: '이종경', player2Id: 'p2', player2Name: '이영희', groupId: 'A', courtId: 'c1', courtName: '1번 코트', scheduledDate: day, scheduledTime: '10:00' },
  ] as unknown as Match[];
  const data = { tournament: null, matches, schedule: [] };

  it('answers court, next match (even when it is running late), live and standings in both languages', () => {
    const late = new Date(`${day}T10:45:00`).getTime(); // m2는 45분 늦었지만 아직 시작 전
    const court = answerSpectatorIntent({ type: 'court', court: '1' }, data, late, ko)!;
    expect(court).toContain('김철수 대 이영희');
    expect(court).toContain('5 대 3');
    const next = answerSpectatorIntent({ type: 'nextMatch', name: '이종경' }, data, late, ko)!;
    expect(next).toContain('이종경 선수의 다음 경기는 이종경 대 이영희');
    expect(answerSpectatorIntent({ type: 'nextMatch', name: '김철수' }, data, late, ko)).toContain('지금 경기 중');
    expect(answerSpectatorIntent({ type: 'court', court: '9' }, data, late, ko)).toContain('9번 코트를 찾지 못했습니다');
    for (const t of [ko, en]) {
      for (const intent of [
        { type: 'court', court: '1' }, { type: 'nextMatch', name: '이종경' }, { type: 'live' }, { type: 'standings', group: 'A' }, { type: 'standings', group: 'Z' },
      ] as const) {
        const a = answerSpectatorIntent(intent, data, late, t);
        expect(a).toBeTruthy();
        expect(a).not.toMatch(RAW_KEY);
      }
    }
    expect(answerSpectatorIntent({ type: 'live' }, data, late, en)).toContain('1 match in progress');
  });
});
