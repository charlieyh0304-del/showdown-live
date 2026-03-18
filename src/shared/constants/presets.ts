import type { TournamentType, BracketFormatType, ScoringRules, MatchRules, TeamRules } from '../types';

export interface TournamentPreset {
  id: string;
  name: string;
  description: string;
  type: TournamentType;
  scoringRules: ScoringRules;
  matchRules: MatchRules;
  teamRules?: TeamRules;
  formatType: BracketFormatType;
}

export const TOURNAMENT_PRESETS: TournamentPreset[] = [
  {
    id: 'ibsa_individual',
    name: 'IBSA 공식 개인전',
    description: '11점 | 2세트 선승 | 최대 3세트 | 2점차',
    type: 'individual',
    scoringRules: { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2, deuceEnabled: true },
    matchRules: { timeoutsPerPlayer: 1, timeoutDurationSeconds: 60 },
    formatType: 'round_robin',
  },
  {
    id: 'ibsa_team',
    name: 'IBSA 공식 팀전',
    description: '31점 | 1세트 | 2점차 | 팀 3명',
    type: 'team',
    scoringRules: { winScore: 31, setsToWin: 1, maxSets: 1, minLead: 2, deuceEnabled: true },
    matchRules: { timeoutsPerPlayer: 1, timeoutDurationSeconds: 60 },
    teamRules: { teamSize: 3, rotationEnabled: true, rotationInterval: 6 },
    formatType: 'round_robin',
  },
  {
    id: 'friendly',
    name: '친선 경기',
    description: '7점 | 1세트 | 빠른 경기',
    type: 'individual',
    scoringRules: { winScore: 7, setsToWin: 1, maxSets: 1, minLead: 2, deuceEnabled: false },
    matchRules: { timeoutsPerPlayer: 1, timeoutDurationSeconds: 60 },
    formatType: 'round_robin',
  },
  {
    id: 'fast_tournament',
    name: '빠른 토너먼트',
    description: '11점 | 1세트 | 싱글 엘리미네이션',
    type: 'individual',
    scoringRules: { winScore: 11, setsToWin: 1, maxSets: 1, minLead: 2, deuceEnabled: true },
    matchRules: { timeoutsPerPlayer: 1, timeoutDurationSeconds: 60 },
    formatType: 'single_elimination',
  },
];

export const FORMAT_OPTIONS: { value: BracketFormatType; label: string; description: string }[] = [
  { value: 'round_robin', label: '풀리그 (라운드로빈)', description: '모든 참가자가 서로 한 번씩 대결' },
  { value: 'single_elimination', label: '싱글 엘리미네이션', description: '한 번 지면 탈락하는 토너먼트' },
  { value: 'double_elimination', label: '더블 엘리미네이션', description: '두 번 지면 탈락 (패자부활전)' },
  { value: 'swiss', label: '스위스 시스템', description: '비슷한 성적의 상대끼리 매칭' },
  { value: 'group_knockout', label: '조별리그 + 토너먼트', description: '조별 예선 후 결선 토너먼트' },
];
