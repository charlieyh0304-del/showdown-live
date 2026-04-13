import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { calculateMatchCount } from '@shared/utils/tournament';
import { showWarning, showSuccess } from '@shared/utils/toast';
import { showConfirm } from '@shared/utils/confirm';
import type { Match, MatchStatus, ScheduleSlot, Tournament } from '@shared/types';

// Firebase can return arrays as objects with numeric keys; ensure we always get an array
function toArray<T>(val: T[] | Record<string, T> | undefined | null): T[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'object') return Object.values(val);
  return [];
}

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

export interface ScheduleTabProps {
  tournament: Pick<Tournament, 'stages' | 'qualifyingConfig' | 'finalsConfig' | 'rankingMatchConfig'>;
  matches: Match[];
  courts: { id: string; name: string }[];
  referees: { id: string; name: string }[];
  schedule: ScheduleSlot[];
  setScheduleBulk: (slots: Omit<ScheduleSlot, 'id'>[]) => Promise<void>;
  updateMatch: (matchId: string, data: Partial<Match>) => Promise<boolean | void>;
  updateMatchesBulk: (updates: Array<{ matchId: string; data: Partial<Match> }>) => Promise<void>;
  updateScheduleSlot: (slot: Omit<ScheduleSlot, 'id'>) => Promise<void>;
  participantCount: number;
}

export default function ScheduleTab({ tournament, matches, courts: allCourts, referees, schedule, setScheduleBulk, updateMatch, updateMatchesBulk, updateScheduleSlot, participantCount }: ScheduleTabProps) {
  const { t } = useTranslation();
  // 대회에 배정된 경기장만 필터 (경기 또는 스케줄에서 사용된 courtId)
  const courts = useMemo(() => {
    const usedCourtIds = new Set<string>();
    for (const m of matches) { if (m.courtId) usedCourtIds.add(m.courtId); }
    for (const s of schedule) { if (s.courtId) usedCourtIds.add(s.courtId); }
    if (usedCourtIds.size === 0) return allCourts; // 아직 배정 전이면 전체 표시
    return allCourts.filter(c => usedCourtIds.has(c.id));
  }, [allCourts, matches, schedule]);
  const [startTime, setStartTime] = useState('09:00');
  const [interval, setInterval_] = useState(30);
  const [endTime, setEndTime] = useState('19:00');
  const [restInterval, setRestInterval] = useState(60);
  const [nextDayStartTime, setNextDayStartTime] = useState('09:00');
  const [generating, setGenerating] = useState(false);
  const [scheduleDate, setScheduleDate] = useState(new Date().toISOString().split('T')[0]);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [breakStart, setBreakStart] = useState('');
  const [breakEnd, setBreakEnd] = useState('');
  const [shiftMinutes, setShiftMinutes] = useState(30);
  const [shiftCourtId, setShiftCourtId] = useState('');
  const [moveFromCourt, setMoveFromCourt] = useState('');
  const [moveToCourt, setMoveToCourt] = useState('');


  // Manual schedule editing state
  const [manualEdits, setManualEdits] = useState<Record<string, { scheduledDate: string; scheduledTime: string; courtId: string; courtName: string }>>({});
  const [savingMatchId, setSavingMatchId] = useState<string | null>(null);
  const [resettingSchedule, setResettingSchedule] = useState(false);
  const [scheduleConflict, setScheduleConflict] = useState('');

  // Check if a player/team has another match at the same date+time
  const checkPlayerTimeConflict = useCallback((matchId: string, date: string, time: string): string | null => {
    if (!date || !time) return null;
    const currentMatch = matches.find(m => m.id === matchId);
    if (!currentMatch) return null;

    const currentPlayerIds = currentMatch.type === 'team'
      ? [currentMatch.team1Id, currentMatch.team2Id, currentMatch.team1Name, currentMatch.team2Name]
      : [currentMatch.player1Id, currentMatch.player2Id, currentMatch.player1Name, currentMatch.player2Name];

    for (const other of matches) {
      if (other.id === matchId || other.status === 'completed') continue;
      const otherEdit = manualEdits[other.id];
      const otherDate = otherEdit?.scheduledDate || other.scheduledDate || '';
      const otherTime = otherEdit?.scheduledTime || other.scheduledTime || '';
      if (otherDate !== date || otherTime !== time) continue;

      const otherPlayerIds = other.type === 'team'
        ? [other.team1Id, other.team2Id, other.team1Name, other.team2Name]
        : [other.player1Id, other.player2Id, other.player1Name, other.player2Name];

      for (const pid of currentPlayerIds) {
        if (pid && otherPlayerIds.includes(pid)) {
          const name = pid;
          const otherLabel = other.type === 'individual'
            ? `${other.player1Name ?? '?'} vs ${other.player2Name ?? '?'}`
            : `${other.team1Name ?? '?'} vs ${other.team2Name ?? '?'}`;
          return `${name}: ${date} ${time} ${otherLabel}`;
        }
      }
    }
    return null;
  }, [matches, manualEdits]);

  const getManualEdit = (match: Match) => {
    if (manualEdits[match.id]) return manualEdits[match.id];
    return {
      scheduledDate: match.scheduledDate || '',
      scheduledTime: match.scheduledTime || '',
      courtId: match.courtId || '',
      courtName: match.courtName || '',
    };
  };

  const setManualEdit = (matchId: string, field: string, value: string) => {
    setManualEdits(prev => {
      const current = prev[matchId] || {
        scheduledDate: matches.find(m => m.id === matchId)?.scheduledDate || '',
        scheduledTime: matches.find(m => m.id === matchId)?.scheduledTime || '',
        courtId: matches.find(m => m.id === matchId)?.courtId || '',
        courtName: matches.find(m => m.id === matchId)?.courtName || '',
      };
      if (field === 'courtId') {
        const court = courts.find(c => c.id === value);
        return { ...prev, [matchId]: { ...current, courtId: value, courtName: court?.name || '' } };
      }
      return { ...prev, [matchId]: { ...current, [field]: value } };
    });
  };

  const handleSaveManualEdit = useCallback(async (matchId: string) => {
    const edit = manualEdits[matchId];
    if (!edit) return;
    // Check for player time conflict
    const conflict = checkPlayerTimeConflict(matchId, edit.scheduledDate, edit.scheduledTime);
    if (conflict) {
      setScheduleConflict(conflict);
      setTimeout(() => setScheduleConflict(''), 5000);
      return;
    }
    setScheduleConflict('');
    setSavingMatchId(matchId);
    try {
      const matchData: Partial<Match> = {
        scheduledDate: edit.scheduledDate || undefined,
        scheduledTime: edit.scheduledTime || undefined,
        courtId: edit.courtId || undefined,
        courtName: edit.courtName || undefined,
      };
      // 매치 + 스케줄 슬롯을 동시에 업데이트
      const match = matches.find(m => m.id === matchId);
      const existingSlot = schedule.find(s => s.matchId === matchId);
      const label = match?.type === 'individual'
        ? `${match.player1Name ?? ''} vs ${match.player2Name ?? ''}`
        : `${match?.team1Name ?? ''} vs ${match?.team2Name ?? ''}`;
      await Promise.all([
        updateMatch(matchId, matchData),
        updateScheduleSlot({
          matchId,
          courtId: edit.courtId || existingSlot?.courtId || '',
          courtName: edit.courtName || existingSlot?.courtName || '',
          scheduledTime: edit.scheduledTime || existingSlot?.scheduledTime || '',
          scheduledDate: edit.scheduledDate || existingSlot?.scheduledDate || '',
          label: existingSlot?.label || label,
          status: existingSlot?.status || match?.status || 'pending',
        }),
      ]);
      setManualEdits(prev => { const next = { ...prev }; delete next[matchId]; return next; });
    } finally {
      setSavingMatchId(null);
    }
  }, [manualEdits, matches, schedule, updateMatch, updateScheduleSlot, checkPlayerTimeConflict]);

  const handleResetSchedule = useCallback(async () => {
    if (!await showConfirm({ message: t('admin.tournamentDetail.scheduleTab.resetConfirm'), destructive: true })) return;
    setResettingSchedule(true);
    try {
      for (const match of matches) {
        if (match.scheduledDate || match.scheduledTime) {
          await updateMatch(match.id, { scheduledDate: undefined, scheduledTime: undefined, courtId: undefined, courtName: undefined });
        }
      }
      await setScheduleBulk([]);
      setManualEdits({});
    } finally {
      setResettingSchedule(false);
    }
  }, [matches, updateMatch, setScheduleBulk]);

  const sortedMatches = useMemo(() => {
    return [...matches].sort((a, b) => {
      const dateA = a.scheduledDate || '';
      const dateB = b.scheduledDate || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const timeA = a.scheduledTime || '';
      const timeB = b.scheduledTime || '';
      if (timeA !== timeB) return timeA.localeCompare(timeB);
      return (a.round || 0) - (b.round || 0);
    });
  }, [matches]);

  // 설정 기반 예상 경기 수 계산
  const expectedMatchCount = useMemo(() => {
    const stages = toArray(tournament.stages) as { type?: string }[];
    const hasGroupStage = stages.some(s => s.type === 'qualifying');
    const hasFinalsStage = stages.some(s => s.type === 'finals');
    const groupCount = tournament.qualifyingConfig?.groupCount || 1;
    const advanceCount = tournament.finalsConfig?.advanceCount || 0;
    const rankingMatch = tournament.rankingMatchConfig || {
      enabled: false, thirdPlace: false, fifthToEighth: false,
      fifthToEighthFormat: 'simple' as const, classificationGroups: false, classificationGroupSize: 4,
    };
    const finalsStartRound = tournament.finalsConfig?.startingRound;
    return calculateMatchCount(participantCount, hasGroupStage, groupCount, hasFinalsStage, advanceCount, rankingMatch, finalsStartRound);
  }, [tournament.stages, tournament.qualifyingConfig, tournament.finalsConfig, tournament.rankingMatchConfig, participantCount]);

  const generateSchedule = useCallback(async () => {
    if (courts.length === 0 || matches.length === 0) return;

    // 경기 수 초과 검증
    const maxAllowed = expectedMatchCount.total;
    if (maxAllowed > 0 && matches.length > maxAllowed) {
      showWarning(t('admin.tournamentDetail.scheduleTab.matchCountExceeded', {
        max: maxAllowed, current: matches.length,
      }));
      return;
    }

    // 스케줄 중복 검증 (이미 스케줄이 배정된 경기 존재 여부)
    if (!onlyUnassigned) {
      const alreadyScheduled = matches.filter(m => m.scheduledDate && (m.status === 'pending' || m.status === 'in_progress'));
      if (alreadyScheduled.length > 0) {
        const confirmed = await showConfirm({ message: t('admin.tournamentDetail.scheduleTab.overwriteConfirm', {
          count: alreadyScheduled.length,
          defaultValue: `이미 스케줄이 배정된 경기가 ${alreadyScheduled.length}건 있습니다.\n기존 스케줄을 덮어쓰시겠습니까?`,
        }) });
        if (!confirmed) return;
      }
    }

    setGenerating(true);
    try {
      const targetMatches = onlyUnassigned
        ? matches.filter(m => (m.status === 'pending' || m.status === 'in_progress') && !m.scheduledDate)
        : matches.filter(m => m.status === 'pending' || m.status === 'in_progress');
      const newSlots: Omit<ScheduleSlot, 'id'>[] = [];

      // Track per-court: { courtId, courtName, date, timeMinutes }
      const courtSlots = courts.map(c => {
        const [h, m] = startTime.split(':').map(Number);
        return { courtId: c.id, courtName: c.name, date: scheduleDate, timeMinutes: h * 60 + m };
      });

      // Track per-player last end time: { date, timeMinutes }
      const playerLastEnd = new Map<string, { date: string; time: number }>();

      const getPlayerIds = (match: Match): string[] => {
        const ids: string[] = [];
        if (match.player1Id) ids.push(match.player1Id);
        if (match.player2Id) ids.push(match.player2Id);
        if (match.team1Id) ids.push(match.team1Id);
        if (match.team2Id) ids.push(match.team2Id);
        return ids;
      };

      const dayStartMinutes = (() => { const [h, m] = startTime.split(':').map(Number); return h * 60 + m; })();
      const dayEndMinutes = (() => { const [h, m] = endTime.split(':').map(Number); return h * 60 + m; })();
      const nextDayStart = (() => { const [h, m] = nextDayStartTime.split(':').map(Number); return h * 60 + m; })();
      const breakStartMin = breakStart ? (() => { const [h, m] = breakStart.split(':').map(Number); return h * 60 + m; })() : -1;
      const breakEndMin = breakEnd ? (() => { const [h, m] = breakEnd.split(':').map(Number); return h * 60 + m; })() : -1;

      // 휴식 시간 스킵
      const skipBreak = (time: number): number => {
        if (breakStartMin >= 0 && breakEndMin > breakStartMin && time >= breakStartMin && time < breakEndMin) {
          return breakEndMin;
        }
        return time;
      };

      const formatTime = (minutes: number): string => {
        const hh = Math.floor(minutes / 60).toString().padStart(2, '0');
        const mm = (minutes % 60).toString().padStart(2, '0');
        return `${hh}:${mm}`;
      };

      const addDays = (dateStr: string, days: number): string => {
        const d = new Date(dateStr);
        d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
      };

      let refereeIndex = 0;
      const batchUpdates: Array<{ matchId: string; data: Partial<Match> }> = [];
      for (const match of targetMatches) {
        const playerIds = getPlayerIds(match);

        let bestCourtIdx = 0;
        let bestDate = scheduleDate;
        let bestTime = Infinity;

        for (let ci = 0; ci < courtSlots.length; ci++) {
          const court = courtSlots[ci];
          let candidateDate = court.date;
          let candidateTime = skipBreak(court.timeMinutes);

          for (const pid of playerIds) {
            const last = playerLastEnd.get(pid);
            if (last) {
              if (last.date === candidateDate && last.time > candidateTime) {
                candidateTime = skipBreak(last.time);
              } else if (last.date > candidateDate) {
                candidateDate = last.date;
                candidateTime = skipBreak(Math.max(dayStartMinutes, last.time));
              }
            }
          }

          candidateTime = skipBreak(candidateTime);

          const candidateTotal = new Date(candidateDate).getTime() + candidateTime;
          const bestTotal = new Date(bestDate).getTime() + bestTime;
          if (ci === 0 || candidateTotal < bestTotal) {
            bestCourtIdx = ci;
            bestDate = candidateDate;
            bestTime = candidateTime;
          }
        }

        if (bestTime >= dayEndMinutes) {
          bestDate = addDays(bestDate, 1);
          bestTime = skipBreak(nextDayStart);
        }

        const court = courtSlots[bestCourtIdx];
        const timeStr = formatTime(bestTime);

        const label = match.type === 'individual'
          ? `${match.player1Name ?? ''} vs ${match.player2Name ?? ''}`
          : `${match.team1Name ?? ''} vs ${match.team2Name ?? ''}`;

        newSlots.push({
          matchId: match.id,
          courtId: court.courtId,
          courtName: court.courtName,
          scheduledTime: timeStr,
          scheduledDate: bestDate,
          label,
          status: match.status,
        });

        const matchUpdate: Partial<Match> = {
          scheduledTime: timeStr,
          scheduledDate: bestDate,
          courtId: court.courtId,
          courtName: court.courtName,
        };
        if (!match.refereeId && referees.length > 0) {
          const ref = referees[refereeIndex % referees.length];
          matchUpdate.refereeId = ref.id;
          matchUpdate.refereeName = ref.name;
          refereeIndex++;
        }
        batchUpdates.push({ matchId: match.id, data: matchUpdate });

        const courtEndTime = bestTime + interval;
        court.date = bestDate;
        court.timeMinutes = courtEndTime >= dayEndMinutes ? (court.date = addDays(bestDate, 1), nextDayStart) : courtEndTime;

        const playerEndTime = bestTime + restInterval;
        const playerEnd = playerEndTime >= dayEndMinutes ? { date: addDays(bestDate, 1), time: nextDayStart } : { date: bestDate, time: playerEndTime };
        for (const pid of playerIds) {
          playerLastEnd.set(pid, playerEnd);
        }
      }

      // 배치 업데이트: 모든 매치를 한번에 저장
      await updateMatchesBulk(batchUpdates);

      // If only assigning unassigned, keep existing schedule slots
      if (onlyUnassigned) {
        const existingSlots = schedule.map(s => ({
          matchId: s.matchId,
          courtId: s.courtId,
          courtName: s.courtName,
          scheduledTime: s.scheduledTime,
          scheduledDate: s.scheduledDate,
          label: s.label,
          status: s.status,
        }));
        await setScheduleBulk([...existingSlots, ...newSlots]);
      } else {
        await setScheduleBulk(newSlots);
      }
    } finally {
      setGenerating(false);
    }
  }, [matches, courts, startTime, interval, endTime, restInterval, nextDayStartTime, scheduleDate, onlyUnassigned, schedule, setScheduleBulk, updateMatch, expectedMatchCount.total, t, breakStart, breakEnd]);

  // Group schedule by date, then by time
  const dates = useMemo(() => {
    const dateSet = [...new Set(schedule.map(s => s.scheduledDate || ''))].sort();
    return dateSet;
  }, [schedule]);

  const hasMultipleDates = dates.length > 1 || (dates.length === 1 && dates[0] !== '');

  const timeSlotsByDate = useMemo(() => {
    return dates.map(date => {
      const dateSlots = schedule.filter(s => (s.scheduledDate || '') === date);
      const times = [...new Set(dateSlots.map(s => s.scheduledTime))].sort();
      const rows = times.map(time => ({
        time,
        slots: courts.map(court => dateSlots.find(s => s.scheduledTime === time && s.courtId === court.id) ?? null),
      }));
      return { date, rows };
    });
  }, [schedule, courts, dates]);

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <h2 className="text-xl font-bold text-center">{t('admin.tournamentDetail.scheduleTab.title')}</h2>
        <div className="flex gap-4 flex-wrap">
          <div>
            <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.dateLabel')}</label>
            <div className="flex items-center gap-2">
              <select
                className="input"
                value={scheduleDate.split('-')[0] || ''}
                onChange={e => { const [, m, d] = scheduleDate.split('-'); setScheduleDate(`${e.target.value}-${m || '01'}-${d || '01'}`); }}
                aria-label={t('admin.tournamentDetail.scheduleTab.dateLabel')}
              >
                {[...Array(5)].map((_, i) => { const y = new Date().getFullYear() + i - 1; return <option key={y} value={y}>{y}</option>; })}
              </select>
              <select
                className="input"
                value={parseInt(scheduleDate.split('-')[1] || '1', 10).toString()}
                onChange={e => { const [y, , d] = scheduleDate.split('-'); setScheduleDate(`${y}-${e.target.value.padStart(2, '0')}-${d || '01'}`); }}
                aria-label={t('admin.tournamentDetail.scheduleTab.dateLabel')}
              >
                {[...Array(12)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
              <select
                className="input"
                value={parseInt(scheduleDate.split('-')[2] || '1', 10).toString()}
                onChange={e => { const [y, m] = scheduleDate.split('-'); setScheduleDate(`${y}-${m}-${e.target.value.padStart(2, '0')}`); }}
                aria-label={t('admin.tournamentDetail.scheduleTab.dateLabel')}
              >
                {[...Array(31)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
              <button type="button" className="btn px-3 py-2 text-sm" onClick={() => setScheduleDate(new Date().toISOString().split('T')[0])} aria-label={t('admin.tournamentDetail.scheduleTab.todayButton')}>{t('admin.tournamentDetail.scheduleTab.todayButton')}</button>
            </div>
          </div>
          <div>
            <label htmlFor="start-time" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.startTimeLabel')}</label>
            <div className="flex items-center gap-1">
              <select
                className="input"
                value={startTime.split(':')[0]}
                onChange={e => setStartTime(`${e.target.value}:${startTime.split(':')[1]}`)}
                aria-label={t('admin.tournamentDetail.scheduleTab.startTimeLabel')}
              >
                {[...Array(24)].map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i}:00</option>)}
              </select>
              <select
                className="input"
                value={startTime.split(':')[1]}
                onChange={e => setStartTime(`${startTime.split(':')[0]}:${e.target.value}`)}
                aria-label={t('admin.tournamentDetail.scheduleTab.startTimeLabel')}
              >
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => <option key={m} value={m.toString().padStart(2, '0')}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="interval" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.intervalLabel')}</label>
            <div className="flex items-center gap-1">
              <select
                id="interval"
                className="input"
                value={interval}
                onChange={e => setInterval_(Number(e.target.value))}
                aria-label={t('admin.tournamentDetail.scheduleTab.intervalLabel')}
              >
                {[10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-4 flex-wrap">
          <div>
            <label htmlFor="end-time" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.endTimeLabel')}</label>
            <div className="flex items-center gap-1">
              <select
                className="input"
                value={endTime.split(':')[0]}
                onChange={e => setEndTime(`${e.target.value}:${endTime.split(':')[1]}`)}
                aria-label={t('admin.tournamentDetail.scheduleTab.endTimeLabel')}
              >
                {[...Array(24)].map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i}:00</option>)}
              </select>
              <select
                className="input"
                value={endTime.split(':')[1]}
                onChange={e => setEndTime(`${endTime.split(':')[0]}:${e.target.value}`)}
                aria-label={t('admin.tournamentDetail.scheduleTab.endTimeLabel')}
              >
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => <option key={m} value={m.toString().padStart(2, '0')}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="rest-interval" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.restIntervalLabel')}</label>
            <div className="flex items-center gap-1">
              <select
                id="rest-interval"
                className="input"
                value={restInterval}
                onChange={e => setRestInterval(Number(e.target.value))}
                aria-label={t('admin.tournamentDetail.scheduleTab.restIntervalLabel')}
              >
                {[10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120, 150, 180, 210, 240].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="next-day-start" className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.nextDayStartLabel')}</label>
            <div className="flex items-center gap-1">
              <select
                className="input"
                value={nextDayStartTime.split(':')[0]}
                onChange={e => setNextDayStartTime(`${e.target.value}:${nextDayStartTime.split(':')[1]}`)}
                aria-label={t('admin.tournamentDetail.scheduleTab.nextDayStartLabel')}
              >
                {[...Array(24)].map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i}:00</option>)}
              </select>
              <select
                className="input"
                value={nextDayStartTime.split(':')[1]}
                onChange={e => setNextDayStartTime(`${nextDayStartTime.split(':')[0]}:${e.target.value}`)}
                aria-label={t('admin.tournamentDetail.scheduleTab.nextDayStartLabel')}
              >
                {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => <option key={m} value={m.toString().padStart(2, '0')}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>
        {/* 점심시간 / 휴식시간 */}
        <div className="flex gap-4 flex-wrap">
          <div>
            <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.breakStartLabel')}</label>
            <input type="time" className="input" value={breakStart} onChange={e => setBreakStart(e.target.value)} aria-label={t('admin.tournamentDetail.scheduleTab.breakStartAriaLabel')} />
          </div>
          <div>
            <label className="block text-sm text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.breakEndLabel')}</label>
            <input type="time" className="input" value={breakEnd} onChange={e => setBreakEnd(e.target.value)} aria-label={t('admin.tournamentDetail.scheduleTab.breakEndAriaLabel')} />
          </div>
          {breakStart && breakEnd && (
            <div className="flex items-end">
              <span className="text-xs text-yellow-400 bg-yellow-900/30 rounded px-2 py-1">{t('admin.tournamentDetail.scheduleTab.breakPeriod', { start: breakStart, end: breakEnd })}</span>
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyUnassigned}
            onChange={e => setOnlyUnassigned(e.target.checked)}
            aria-label={t('admin.tournamentDetail.scheduleTab.onlyUnassigned')}
          />
          {t('admin.tournamentDetail.scheduleTab.onlyUnassigned')}
        </label>
        <button
          className="btn btn-accent"
          onClick={generateSchedule}
          disabled={generating || courts.length === 0 || matches.length === 0}
          aria-label={t('admin.tournamentDetail.scheduleTab.generateButton')}
        >
          {generating ? t('admin.tournamentDetail.scheduleTab.generating') : t('admin.tournamentDetail.scheduleTab.generateButton')}
        </button>
        {courts.length === 0 && <p className="text-gray-400 text-center">{t('admin.tournamentDetail.scheduleTab.noCourts')}</p>}
      </div>

      {/* 일괄 이동 / 코트 이동 */}
      <div className="card space-y-4">
        <h2 className="text-lg font-bold text-center">{t('admin.tournamentDetail.scheduleTab.scheduleAdjustTitle')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 시간 일괄 이동 */}
          <div className="space-y-2 p-3 bg-gray-800 rounded-lg">
            <h3 className="text-sm font-bold text-gray-300">{t('admin.tournamentDetail.scheduleTab.timeShiftTitle')}</h3>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">{t('admin.tournamentDetail.scheduleTab.shiftMinutesLabel')}</label>
                <input type="number" className="input w-full" value={shiftMinutes} onChange={e => setShiftMinutes(Number(e.target.value))} aria-label={t('admin.tournamentDetail.scheduleTab.shiftMinutesAriaLabel')} />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">{t('admin.tournamentDetail.scheduleTab.courtFilterLabel')}</label>
                <select className="input w-full" value={shiftCourtId} onChange={e => setShiftCourtId(e.target.value)} aria-label={t('admin.tournamentDetail.scheduleTab.courtFilterAriaLabel')}>
                  <option value="">{t('admin.tournamentDetail.scheduleTab.allCourts')}</option>
                  {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-secondary flex-1 text-sm" style={{ minHeight: '44px' }}
                onClick={async () => {
                  const target = matches.filter(m => m.scheduledTime && (!shiftCourtId || m.courtId === shiftCourtId));
                  if (target.length === 0) return;
                  if (!await showConfirm({ message: t('admin.tournamentDetail.scheduleTab.shiftConfirm', { count: target.length, minutes: shiftMinutes }) })) return;
                  for (const m of target) {
                    const [h, min] = (m.scheduledTime || '00:00').split(':').map(Number);
                    let total = h * 60 + min + shiftMinutes;
                    let ds = 0;
                    while (total < 0) { total += 1440; ds--; }
                    while (total >= 1440) { total -= 1440; ds++; }
                    const newTime = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
                    const newDate = ds !== 0 && m.scheduledDate ? (() => { const d = new Date(m.scheduledDate!); d.setDate(d.getDate() + ds); return d.toISOString().split('T')[0]; })() : m.scheduledDate;
                    await updateMatch(m.id, { scheduledTime: newTime, ...(newDate ? { scheduledDate: newDate } : {}) });
                  }
                  showSuccess(shiftMinutes > 0
                    ? t('admin.tournamentDetail.scheduleTab.shiftCompleteForward', { count: target.length, minutes: shiftMinutes })
                    : t('admin.tournamentDetail.scheduleTab.shiftCompleteBackward', { count: target.length, minutes: -shiftMinutes }));
                }}
                aria-label={t('admin.tournamentDetail.scheduleTab.shiftAriaLabel', { minutes: shiftMinutes })}
              >
                {shiftMinutes > 0
                  ? t('admin.tournamentDetail.scheduleTab.shiftForward', { minutes: shiftMinutes })
                  : t('admin.tournamentDetail.scheduleTab.shiftBackward', { minutes: -shiftMinutes })}
              </button>
            </div>
          </div>

          {/* 코트 이동 */}
          <div className="space-y-2 p-3 bg-gray-800 rounded-lg">
            <h3 className="text-sm font-bold text-gray-300">{t('admin.tournamentDetail.scheduleTab.courtMoveTitle')}</h3>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">{t('admin.tournamentDetail.scheduleTab.fromCourtLabel')}</label>
                <select className="input w-full" value={moveFromCourt} onChange={e => setMoveFromCourt(e.target.value)} aria-label={t('admin.tournamentDetail.scheduleTab.fromCourtAriaLabel')}>
                  <option value="">{t('admin.tournamentDetail.scheduleTab.selectOption')}</option>
                  {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 mb-1">{t('admin.tournamentDetail.scheduleTab.toCourtLabel')}</label>
                <select className="input w-full" value={moveToCourt} onChange={e => setMoveToCourt(e.target.value)} aria-label={t('admin.tournamentDetail.scheduleTab.toCourtAriaLabel')}>
                  <option value="">{t('admin.tournamentDetail.scheduleTab.selectOption')}</option>
                  {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <button className="btn btn-secondary w-full text-sm" style={{ minHeight: '44px' }}
              disabled={!moveFromCourt || !moveToCourt || moveFromCourt === moveToCourt}
              onClick={async () => {
                const target = matches.filter(m => m.courtId === moveFromCourt);
                if (target.length === 0) { showWarning(t('admin.tournamentDetail.scheduleTab.noMatchesToMove')); return; }
                const toName = courts.find(c => c.id === moveToCourt)?.name || '';
                if (!await showConfirm({ message: t('admin.tournamentDetail.scheduleTab.courtMoveConfirm', { count: target.length, court: toName }) })) return;
                for (const m of target) {
                  await updateMatch(m.id, { courtId: moveToCourt, courtName: toName });
                }
                showSuccess(t('admin.tournamentDetail.scheduleTab.courtMoveComplete', { count: target.length }));
                setMoveFromCourt(''); setMoveToCourt('');
              }}
              aria-label={t('admin.tournamentDetail.scheduleTab.courtMoveAriaLabel')}
            >
              {t('admin.tournamentDetail.scheduleTab.courtMoveButton')}
            </button>
          </div>
        </div>
      </div>

      {timeSlotsByDate.length > 0 && timeSlotsByDate.some(d => d.rows.length > 0) && (
        <div className="card overflow-x-auto">
          <h2 className="text-xl font-bold mb-4 text-center">{t('admin.tournamentDetail.scheduleTab.scheduleGridTitle')}</h2>
          {timeSlotsByDate.map(({ date, rows }) => {
            if (rows.length === 0) return null;
            return (
              <div key={date || 'no-date'} className="mb-6">
                {hasMultipleDates && (
                  <h3 className="text-lg font-bold text-yellow-400 mb-2">
                    {date || t('admin.tournamentDetail.scheduleTab.dateUnspecified')}
                  </h3>
                )}
                <table className="w-full border-collapse mb-4" aria-label={t('admin.tournamentDetail.scheduleTab.scheduleGridTitle') + (date ? ` - ${date}` : '')}>
                  <thead>
                    <tr>
                      {hasMultipleDates && <th scope="col" className="border border-gray-600 p-3 text-left bg-gray-800">{t('admin.tournamentDetail.scheduleTab.dateColumnHeader')}</th>}
                      <th scope="col" className="border border-gray-600 p-3 text-left bg-gray-800">{t('admin.tournamentDetail.scheduleTab.timeColumnHeader')}</th>
                      {courts.map(c => (
                        <th scope="col" key={c.id} className="border border-gray-600 p-3 text-center bg-gray-800">{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.time}>
                        {hasMultipleDates && <td className="border border-gray-600 p-3 text-sm text-gray-400">{date || '-'}</td>}
                        <td className="border border-gray-600 p-3 font-semibold text-cyan-400">{row.time}</td>
                        {row.slots.map((slot, i) => (
                          <td key={i} className="border border-gray-600 p-3 text-center">
                            {slot ? (
                              <div>
                                <p className="font-semibold text-sm">{slot.label}</p>
                                <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold ${STATUS_COLORS[slot.status]}`}>
                                  {STATUS_ICONS[slot.status]} {t(STATUS_LABEL_KEYS[slot.status])}
                                </span>
                              </div>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual schedule editing */}
      {matches.length > 0 && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-xl font-bold text-center">{t('admin.tournamentDetail.scheduleTab.individualScheduleTitle')}</h2>
            <button
              className="btn bg-red-700 hover:bg-red-600 text-white"
              onClick={handleResetSchedule}
              disabled={resettingSchedule || matches.length === 0}
              aria-label={t('admin.tournamentDetail.scheduleTab.resetScheduleButton')}
            >
              {resettingSchedule ? t('admin.tournamentDetail.scheduleTab.resetting') : t('admin.tournamentDetail.scheduleTab.resetScheduleButton')}
            </button>
          </div>
          {scheduleConflict && (
            <div className="bg-red-900/50 border border-red-600 rounded-lg p-3 text-red-300 text-sm">
              {t('admin.tournamentDetail.scheduleTab.conflictWarning')}: {scheduleConflict}
            </div>
          )}
          <div className="space-y-3">
            {sortedMatches.map(match => {
              const edit = getManualEdit(match);
              const matchLabel = match.type === 'individual'
                ? `${match.player1Name ?? '?'} vs ${match.player2Name ?? '?'}`
                : `${match.team1Name ?? '?'} vs ${match.team2Name ?? '?'}`;
              const hasEdits = !!manualEdits[match.id];
              return (
                <div key={match.id} className="bg-gray-800 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-xs">R{match.round}</span>
                      <span className="font-semibold text-sm">{matchLabel}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${STATUS_COLORS[match.status]}`}>
                        {STATUS_ICONS[match.status]} {t(STATUS_LABEL_KEYS[match.status])}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      {match.scheduledDate && <span>{match.scheduledDate}</span>}
                      {match.scheduledTime && <span>{match.scheduledTime}</span>}
                      {match.courtName && <span>/ {match.courtName}</span>}
                      {!match.scheduledDate && !match.scheduledTime && <span className="text-gray-400">{t('admin.tournamentDetail.scheduleTab.unassignedLabel')}</span>}
                    </div>
                  </div>
                  {match.status === 'completed' ? (
                    <p className="text-xs text-gray-500">{t('common.matchStatus.completed')} - {t('admin.tournamentDetail.scheduleTab.completedNoEdit')}</p>
                  ) : (
                  <div className="flex gap-3 flex-wrap items-end">
                    <div>
                      <label className="block text-xs text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.scheduleDateLabel')}</label>
                      {(() => {
                        const [y, mo, dy] = (edit.scheduledDate || '').split('-');
                        const curYear = new Date().getFullYear();
                        const setDate = (part: 'y' | 'm' | 'd', val: string) => {
                          const ny = part === 'y' ? val : (y || String(curYear));
                          const nm = part === 'm' ? val : (mo || '01');
                          const nd = part === 'd' ? val : (dy || '01');
                          setManualEdit(match.id, 'scheduledDate', `${ny}-${nm}-${nd}`);
                        };
                        return (
                          <div className="flex gap-1">
                            <select className="input text-sm" value={mo || ''} onChange={e => setDate('m', e.target.value)} aria-label={`${matchLabel} ${t('admin.tournamentDetail.scheduleTab.scheduleDateLabel')}`}>
                              <option value="">{t('common.date.month')}</option>
                              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => <option key={m} value={m}>{parseInt(m)}{t('common.date.monthUnit')}</option>)}
                            </select>
                            <select className="input text-sm" value={dy || ''} onChange={e => setDate('d', e.target.value)}>
                              <option value="">{t('common.date.day')}</option>
                              {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map(d => <option key={d} value={d}>{parseInt(d)}{t('common.date.dayUnit')}</option>)}
                            </select>
                          </div>
                        );
                      })()}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.scheduleTimeLabel')}</label>
                      <div className="flex items-center gap-1">
                        <select
                          className="input text-sm"
                          value={(edit.scheduledTime || '09:00').split(':')[0]}
                          onChange={e => setManualEdit(match.id, 'scheduledTime', `${e.target.value}:${(edit.scheduledTime || '09:00').split(':')[1]}`)}
                          aria-label={`${matchLabel} ${t('admin.tournamentDetail.scheduleTab.scheduleTimeLabel')}`}
                        >
                          {[...Array(24)].map((_, i) => <option key={i} value={i.toString().padStart(2, '0')}>{i}:00</option>)}
                        </select>
                        <select
                          className="input text-sm"
                          value={(edit.scheduledTime || '09:00').split(':')[1]}
                          onChange={e => setManualEdit(match.id, 'scheduledTime', `${(edit.scheduledTime || '09:00').split(':')[0]}:${e.target.value}`)}
                          aria-label={`${matchLabel} ${t('admin.tournamentDetail.scheduleTab.scheduleTimeLabel')}`}
                        >
                          {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => <option key={m} value={m.toString().padStart(2, '0')}>{m}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-300 mb-1">{t('admin.tournamentDetail.scheduleTab.courtLabel')}</label>
                      <select
                        className="input text-sm"
                        value={edit.courtId}
                        onChange={e => setManualEdit(match.id, 'courtId', e.target.value)}
                        aria-label={`${matchLabel} ${t('admin.tournamentDetail.scheduleTab.courtLabel')}`}
                      >
                        <option value="">{t('admin.tournamentDetail.bracketTab.refereeUnassigned')}</option>
                        {courts.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      className="btn btn-accent text-sm px-4 py-2"
                      onClick={() => handleSaveManualEdit(match.id)}
                      disabled={!hasEdits || savingMatchId === match.id}
                      aria-label={`${matchLabel} ${t('common.save')}`}
                    >
                      {savingMatchId === match.id ? t('admin.tournamentDetail.scheduleTab.savingButton') : t('admin.tournamentDetail.scheduleTab.saveButton')}
                    </button>
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
