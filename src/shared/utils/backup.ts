import { ref, get, set } from 'firebase/database';
import { database } from '@shared/config/firebase';

export interface TournamentBackup {
  version: 1;
  timestamp: number;
  tournamentId: string;
  tournamentName: string;
  data: {
    tournament: unknown;
    matches: unknown;
    players: unknown;
    teams: unknown;
    schedule: unknown;
  };
}

export async function exportTournament(tournamentId: string): Promise<TournamentBackup | null> {
  try {
    const [tournament, matches, players, teams, schedule] = await Promise.all([
      get(ref(database, `tournaments/${tournamentId}`)),
      get(ref(database, `matches/${tournamentId}`)),
      get(ref(database, `tournamentPlayers/${tournamentId}`)),
      get(ref(database, `teams/${tournamentId}`)),
      get(ref(database, `schedule/${tournamentId}`)),
    ]);
    const tData = tournament.val();
    if (!tData) return null;
    return {
      version: 1,
      timestamp: Date.now(),
      tournamentId,
      tournamentName: tData.name || tournamentId,
      data: {
        tournament: tData,
        matches: matches.val(),
        players: players.val(),
        teams: teams.val(),
        schedule: schedule.val(),
      },
    };
  } catch (err) {
    console.error('Export failed:', err);
    return null;
  }
}

export function downloadBackup(backup: TournamentBackup): void {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date(backup.timestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `backup-${backup.tournamentName}-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function restoreTournament(backup: TournamentBackup): Promise<boolean> {
  try {
    const id = backup.tournamentId;
    const promises: Promise<void>[] = [];
    if (backup.data.tournament) promises.push(set(ref(database, `tournaments/${id}`), backup.data.tournament));
    if (backup.data.matches) promises.push(set(ref(database, `matches/${id}`), backup.data.matches));
    if (backup.data.players) promises.push(set(ref(database, `tournamentPlayers/${id}`), backup.data.players));
    if (backup.data.teams) promises.push(set(ref(database, `teams/${id}`), backup.data.teams));
    if (backup.data.schedule) promises.push(set(ref(database, `schedule/${id}`), backup.data.schedule));
    await Promise.all(promises);
    return true;
  } catch (err) {
    console.error('Restore failed:', err);
    return false;
  }
}

export function readBackupFile(file: File): Promise<TournamentBackup | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (data.version === 1 && data.tournamentId && data.data) resolve(data);
        else resolve(null);
      } catch {
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  });
}

// Auto-backup to localStorage (last 3 per tournament)
export async function autoBackupToLocal(tournamentId: string): Promise<void> {
  try {
    const backup = await exportTournament(tournamentId);
    if (!backup) return;
    const key = `showdown_backup_${tournamentId}`;
    const existing: TournamentBackup[] = JSON.parse(localStorage.getItem(key) || '[]');
    existing.unshift(backup);
    localStorage.setItem(key, JSON.stringify(existing.slice(0, 3)));
  } catch (err) {
    console.error('Auto-backup failed:', err);
  }
}

// Debounced auto-backup (max once per intervalMs)
let lastBackupTime = 0;
export async function autoBackupDebounced(tournamentId: string, intervalMs = 60000): Promise<void> {
  const now = Date.now();
  if (now - lastBackupTime < intervalMs) return;
  lastBackupTime = now;
  await autoBackupToLocal(tournamentId);
}

export function getLocalBackups(tournamentId: string): TournamentBackup[] {
  try {
    return JSON.parse(localStorage.getItem(`showdown_backup_${tournamentId}`) || '[]');
  } catch {
    return [];
  }
}
