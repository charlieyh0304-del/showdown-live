import { describe, it, expect } from 'vitest';
import { parseSpectatorPath, sectionPath } from './spectatorRoutes';

describe('spectator deep links', () => {
  it('parses sections, legacy paths and unknown paths', () => {
    expect(parseSpectatorPath('')).toEqual({ kind: 'section', section: 'live' });
    expect(parseSpectatorPath('overview')).toEqual({ kind: 'section', section: 'live' });
    expect(parseSpectatorPath('players')).toEqual({ kind: 'section', section: 'players' });
    expect(parseSpectatorPath('standings/')).toEqual({ kind: 'section', section: 'standings' });
    expect(parseSpectatorPath('nope')).toEqual({ kind: 'section', section: 'live' });
  });

  it('parses player and referee detail keys (encoded names, slashes)', () => {
    expect(parseSpectatorPath(`player/${encodeURIComponent('김철수')}`)).toEqual({ kind: 'player', key: '김철수' });
    expect(parseSpectatorPath('player/a/b')).toEqual({ kind: 'player', key: 'a/b' });
    expect(parseSpectatorPath('referee/r1')).toEqual({ kind: 'referee', key: 'r1' });
    expect(parseSpectatorPath('player/%E0%A4')).toEqual({ kind: 'player', key: '%E0%A4' });
    expect(parseSpectatorPath('player')).toEqual({ kind: 'section', section: 'live' });
  });

  it('builds section paths (live is the tournament root)', () => {
    expect(sectionPath('t1', 'live')).toBe('/spectator/tournament/t1');
    expect(sectionPath('t1', 'next')).toBe('/spectator/tournament/t1/next');
  });
});
