import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFavorites, useReferees, useTournamentReferees, useTournamentLocalPlayers } from '@shared/hooks/useFirebase';
import { useSlotLabel } from '@shared/hooks/useSlotLabel';
import { useNotificationSettings } from '@shared/hooks/useNotificationSettings';
import { useAudioFeedback } from '@shared/hooks/useAudioFeedback';
import { resolveMatchScoring } from '@shared/rules/competitionRules';
import { ALL_DIVISIONS, filterByDivision, getDivisions, hasDivisionChoice, loadDivisionChoice, resolveDivisionChoice, rulesScopeStageId, saveDivisionChoice } from '@shared/utils/divisions';
import type { Match } from '@shared/types';
import BracketTab from '../components/tournament/BracketTab';
import PlayersTab from '../components/tournament/PlayersTab';
import RefereesTab from '../components/tournament/RefereesTab';
import LiveSection from '../components/sections/LiveSection';
import ScheduleSection from '../components/sections/ScheduleSection';
import StandingsSection from '../components/sections/StandingsSection';
import NextSection from '../components/sections/NextSection';
import SettingsSection from '../components/sections/SettingsSection';
import PeopleSearch from '../components/sections/PeopleSearch';
import ConnectionLine from '../components/sections/ConnectionLine';
import { PlayerDetail, RefereeDetail } from '../components/sections/PersonDetail';
import { useNow, useSpectatorData } from '../hooks/useSpectatorData';
import { buildPeopleIndex } from '../utils/peopleSearch';
import { buildScheduleRows, involves } from '../utils/spectatorData';
import { describeLiveEvent, detectLiveEvents } from '../utils/liveEvents';
import { setAssistantData } from '../utils/spectatorAssistant';
import { buildRomanMap, formatDisplayName, loadShowRoman, saveShowRoman } from '../utils/nameDisplay';
import { parseSpectatorPath, playerPath, SPECTATOR_SECTIONS, sectionPath, type SpectatorSection } from '../utils/spectatorRoutes';
import { tournamentDateRange, tournamentVenue } from '../utils/tournamentList';

/**
 * 관전 대회 화면 (df4095 구성): 대회 이름(h1) → 연결 상태 → 선수·심판 찾기 → 구역 메뉴 → 구역.
 * 구역·선수·심판마다 주소가 있어 뒤로 가기와 공유가 되고, 뒤로 돌아오면 누른 이름에 초점이 돌아온다.
 * 화면낭독기 안내(aria-live)는 세트 끝·경기 끝·골든골 같은 의미 있는 사건에서만 한다.
 */
export default function TournamentView() {
  const params = useParams<{ id: string; '*': string }>();
  const id = params.id || null;
  const route = parseSpectatorPath(params['*'] || '');
  const navigate = useNavigate();
  const { t } = useTranslation();
  const data = useSpectatorData(id);
  const { tournament, matches: allMatches, schedule, loading } = data;
  const { favoriteIds, isFavorite, toggleFavorite } = useFavorites();
  const { referees } = useReferees();
  const { assignments } = useTournamentReferees(id);
  const { players: localPlayers } = useTournamentLocalPlayers(id);
  const now = useNow();
  const slotLabel = useSlotLabel(allMatches);

  // 부(division): 지금은 기본 부 하나(docs/05 부록 5). 둘 이상이면 고르는 창이 보인다.
  const divisions = useMemo(() => getDivisions(tournament, allMatches), [tournament, allMatches]);
  const [divisionChoice, setDivisionChoice] = useState<string>(() => (id ? loadDivisionChoice(id) : null) || ALL_DIVISIONS);
  const division = resolveDivisionChoice(divisionChoice, divisions);
  const matches = useMemo(() => filterByDivision(allMatches, division, divisions), [allMatches, division, divisions]);

  const rows = useMemo(() => buildScheduleRows(matches, schedule, tournament?.date || ''), [matches, schedule, tournament?.date]);
  const people = useMemo(() => buildPeopleIndex(allMatches, referees, assignments), [allMatches, referees, assignments]);

  // 이름 표기 (영문 데이터가 있을 때만)
  const romanMap = useMemo(() => buildRomanMap(localPlayers as Array<{ name?: string }>), [localPlayers]);
  const [showRoman, setShowRoman] = useState(loadShowRoman);
  const nameOf = useCallback((n: string) => formatDisplayName(n, romanMap, showRoman), [romanMap, showRoman]);

  // 도우미(기기 안 답변)가 지금 대회 데이터를 쓰게 한다
  useEffect(() => {
    setAssistantData({ tournament, matches: allMatches, schedule });
    return () => setAssistantData(null);
  }, [tournament, allMatches, schedule]);

  // 의미 있는 사건만 알림 (세트 끝·경기 끝·골든골) + 결과 소리(설정에서 켠 경우)
  const prevMatches = useRef<Match[] | null>(null);
  const [liveMsg, setLiveMsg] = useState('');
  const { settings: notif } = useNotificationSettings();
  const audio = useAudioFeedback();
  useEffect(() => {
    if (data.usingCache) return;
    const prev = prevMatches.current;
    prevMatches.current = allMatches;
    if (!prev) return;
    const events = detectLiveEvents(prev, allMatches, m => resolveMatchScoring(m, tournament));
    if (events.length === 0) return;
    const text = events.map(e => describeLiveEvent(e, t)).join(' ');
    setLiveMsg(text);
    const ends = events.filter(e => e.kind === 'match_end');
    if (notif.resultSound && ends.some(e => notif.resultSoundFavoritesOnly === false || involves(e.match, favoriteIds))) audio.matchComplete();
  }, [allMatches, tournament, t, data.usingCache, notif.resultSound, notif.resultSoundFavoritesOnly, favoriteIds, audio]);

  const sectionLabel = (s: SpectatorSection) => t(`spectator.sections.${s}`);
  const activeSection: SpectatorSection = route.kind === 'player' ? 'players' : route.kind === 'referee' ? 'referees' : route.section;

  useEffect(() => {
    if (tournament) document.title = t('spectator.tournament.pageTitle', { name: `${sectionLabel(activeSection)} - ${tournament.name}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament?.name, activeSection, t]);

  const onSelectPlayer = useCallback((name: string) => {
    const p = people.find(x => x.kind !== 'referee' && x.name === name);
    if (id) navigate(playerPath(id, p?.id || name));
  }, [people, id, navigate]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }} role="status" aria-live="polite">
        <p style={{ fontSize: '1.5rem' }}>{t('common.loading')}</p>
      </div>
    );
  }

  if (!tournament || !id) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <h1 style={{ fontSize: '1.5rem', color: '#ef4444' }}>{t('spectator.tournament.notFound')}</h1>
        <p style={{ marginTop: '1rem' }}><Link to="/spectator" className="btn btn-primary">{t('spectator.layout.backToTournamentList')}</Link></p>
      </div>
    );
  }

  const venue = tournamentVenue(tournament);
  const team = tournament.type === 'team' || tournament.type === 'randomTeamLeague';
  const headingProps = (title: string) => ({
    'data-route-focus': true,
    'data-route-title': t('spectator.tournament.pageTitle', { name: `${title} - ${tournament.name}` }),
    tabIndex: -1,
    style: { fontSize: '1.375rem', fontWeight: 'bold', marginBottom: '0.75rem', outline: 'none' } as const,
  });

  let content: React.ReactNode;
  if (route.kind === 'player') {
    const person = people.find(p => p.kind !== 'referee' && (p.id === route.key || p.name === route.key)) ?? null;
    content = <PlayerDetail person={person} playerKey={route.key} tournament={tournament} tournamentId={id} matches={allMatches} schedule={schedule} slotLabel={slotLabel} now={now} isFavorite={isFavorite} toggleFavorite={toggleFavorite} nameOf={nameOf} divisions={divisions} />;
  } else if (route.kind === 'referee') {
    const person = people.find(p => p.kind === 'referee' && p.id === route.key) ?? null;
    content = <RefereeDetail person={person} refereeId={route.key} assignedIds={assignments[route.key]?.assignedMatchIds || []} tournament={tournament} tournamentId={id} matches={allMatches} schedule={schedule} slotLabel={slotLabel} now={now} />;
  } else {
    const s = route.section;
    content = (
      <>
        <h2 id="section-title" {...headingProps(sectionLabel(s))}>{sectionLabel(s)}</h2>
        {s === 'live' && <LiveSection rows={rows} matches={matches} now={now} tournament={tournament} tournamentId={id} slotLabel={slotLabel} isFavorite={isFavorite} toggleFavorite={toggleFavorite} navigate={navigate} />}
        {s === 'schedule' && <ScheduleSection rows={rows} tournament={tournament} tournamentId={id} slotLabel={slotLabel} favoriteIds={favoriteIds} />}
        {s === 'standings' && <StandingsSection matches={matches} tournament={tournament} isFavorite={isFavorite} onSelectPlayer={onSelectPlayer} rulesStageId={rulesScopeStageId(division, divisions)} />}
        {s === 'bracket' && <BracketTab matches={matches} tournamentType={tournament.type} onSelectPlayer={onSelectPlayer} tournament={tournament} allMatches={allMatches} />}
        {s === 'next' && <NextSection rows={rows} now={now} tournament={tournament} tournamentId={id} slotLabel={slotLabel} favoriteIds={favoriteIds} />}
        {s === 'players' && <PlayersTab matches={matches} isTeam={team} isFavorite={isFavorite} toggleFavorite={toggleFavorite} tournamentId={id} tournament={tournament} nameOf={nameOf} />}
        {s === 'referees' && <RefereesTab referees={referees} assignments={assignments} matches={allMatches} tournamentId={id} />}
        {s === 'settings' && <SettingsSection hasRomanNames={romanMap.size > 0} showRoman={showRoman} onShowRomanChange={on => { setShowRoman(on); saveShowRoman(on); }} />}
      </>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '0.75rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>{tournament.name}</h1>
        <p style={{ color: '#d1d5db' }}>
          {[tournamentDateRange(tournament), venue, t(`common.tournamentType.${tournament.type}`)].filter(Boolean).join(' · ')}
        </p>
        <ConnectionLine connected={data.connected} lastUpdateAt={data.lastUpdateAt} usingCache={data.usingCache} cacheSavedAt={data.cacheSavedAt} now={now} />
      </div>

      {/* 의미 있는 사건 알림 (세트·경기 끝, 골든골). 점수 한 점마다 읽지 않는다. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveMsg}</p>

      <PeopleSearch people={people} tournamentId={id} nameOf={nameOf} />

      <nav aria-label={t('spectator.sections.menuLabel')} className="spectator-section-nav" style={{ marginBottom: '1rem' }}>
        <ul style={{ listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(7rem, 1fr))', gap: '0.375rem', padding: 0 }}>
          {SPECTATOR_SECTIONS.map(s => (
            <li key={s}>
              <Link
                to={sectionPath(id, s)}
                aria-current={activeSection === s ? 'page' : undefined}
                className="btn"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', fontSize: '1rem', padding: '0.5rem', backgroundColor: activeSection === s ? undefined : '#1f2937', color: activeSection === s ? undefined : '#fff', textDecoration: 'none', border: '1px solid #374151' }}
              >
                {sectionLabel(s)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {hasDivisionChoice(divisions) && (
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="division-select" style={{ display: 'block', fontWeight: 'bold' }}>{t('spectator.filters.division')}</label>
          <select id="division-select" className="input" value={division} onChange={e => { setDivisionChoice(e.target.value); saveDivisionChoice(id, e.target.value); }}>
            <option value={ALL_DIVISIONS}>{t('spectator.filters.all')}</option>
            {divisions.map(d => <option key={d.id} value={d.id}>{d.label || d.id}</option>)}
          </select>
        </div>
      )}

      <section aria-labelledby={route.kind === 'section' ? 'section-title' : undefined} aria-label={route.kind !== 'section' ? sectionLabel(activeSection) : undefined}>
        {content}
      </section>
    </div>
  );
}
