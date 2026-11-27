import { describe, it, expect } from 'vitest';
import { drawTeams } from './teamDraw';

const players = (m: number, f: number, o = 0) => [
  ...Array.from({ length: m }, (_, i) => ({ id: `m${i}`, gender: 'male' })),
  ...Array.from({ length: f }, (_, i) => ({ id: `f${i}`, gender: 'female' })),
  ...Array.from({ length: o }, (_, i) => ({ id: `o${i}` })),
];

describe('drawTeams', () => {
  it('is reproducible with the stored seed', () => {
    const a = drawTeams({ players: players(5, 4), teamSize: 3, seed: 'abc' });
    expect(drawTeams({ players: players(5, 4), teamSize: 3, seed: 'abc' })).toEqual(a);
  });
  it('never drops a player: everyone is in a team or unassigned (more women than teams)', () => {
    const r = drawTeams({ players: players(1, 6, 1), teamSize: 3, seed: 's' });
    expect(r.teams).toHaveLength(2);
    const all = [...r.teams.flat(), ...r.unassigned].sort();
    expect(all).toEqual(players(1, 6, 1).map(p => p.id).sort());
    expect(r.teams.every(t => t.length === 3)).toBe(true);
    expect(r.unassigned).toHaveLength(2);
  });
  it('spreads women and places seeds first', () => {
    const r = drawTeams({ players: players(6, 3), teamSize: 3, seed: 'x', seedIds: ['m0', 'm1', 'm2'] });
    expect(r.teams.map(t => t[0])).toEqual(['m0', 'm1', 'm2']);
    expect(r.teams.every(t => t.filter(id => id.startsWith('f')).length === 1)).toBe(true);
  });
  it('honors a gender ratio', () => {
    const r = drawTeams({ players: players(4, 4), teamSize: 4, seed: 'y', genderRatio: { male: 2, female: 2 } });
    expect(r.teams.every(t => t.filter(id => id.startsWith('f')).length === 2)).toBe(true);
  });
});
