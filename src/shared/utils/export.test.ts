import { describe, it, expect } from 'vitest';
import { exportResultsCSV } from './export';
import type { Tournament, Match, Player, Team } from '../types';

const baseTournament: Tournament = {
  id: 't1',
  name: 'Test Cup',
  type: 'individual',
  date: '2026-04-13',
  status: 'completed',
  format: 'full_league',
  createdAt: 0,
  updatedAt: 0,
};

const players: Player[] = [
  { id: 'p1', name: 'Alice', createdAt: 0 },
  { id: 'p2', name: 'Bob', createdAt: 0 },
];

const completedMatch: Match = {
  id: 'm1',
  tournamentId: 't1',
  player1Id: 'p1',
  player1Name: 'Alice',
  player2Id: 'p2',
  player2Name: 'Bob',
  status: 'completed',
  winnerId: 'p1',
  sets: [{ player1Score: 11, player2Score: 5 }, { player1Score: 11, player2Score: 7 }],
  currentSet: 1,
  createdAt: 0,
};

describe('exportResultsCSV', () => {
  it('generates CSV with tournament info header', () => {
    const csv = exportResultsCSV(baseTournament, [completedMatch], players, []);
    expect(csv).toContain('Tournament Name,Test Cup');
    expect(csv).toContain('Date,2026-04-13');
    expect(csv).toContain('Singles');
  });

  it('includes ranking section', () => {
    const csv = exportResultsCSV(baseTournament, [completedMatch], players, []);
    expect(csv).toContain('=== Rankings ===');
    expect(csv).toContain('Alice');
    expect(csv).toContain('Bob');
  });

  it('includes match results section', () => {
    const csv = exportResultsCSV(baseTournament, [completedMatch], players, []);
    expect(csv).toContain('=== Match Results ===');
    expect(csv).toContain('11-5');
    expect(csv).toContain('11-7');
  });

  it('skips non-completed matches from results', () => {
    const pending: Match = { ...completedMatch, id: 'm2', status: 'pending', winnerId: undefined };
    const csv = exportResultsCSV(baseTournament, [completedMatch, pending], players, []);
    // Only 1 data row under match results (plus header)
    const matchSection = csv.split('=== Match Results ===')[1];
    const dataLines = matchSection.split('\n').filter(l => l.startsWith('1,'));
    expect(dataLines).toHaveLength(1);
  });

  it('uses translation function when provided', () => {
    const t = ((key: string) => {
      if (key === 'common.export.tournamentName') return '대회명';
      return key;
    }) as unknown as import('i18next').TFunction;
    const csv = exportResultsCSV(baseTournament, [completedMatch], players, [], t);
    expect(csv).toContain('대회명,Test Cup');
  });
});
