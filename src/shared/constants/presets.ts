import type { TournamentType, BracketFormatType, ScoringRules, MatchRules, TeamRules, WizardPreset } from '../types';

export interface TournamentPreset {
  id: string;
  /** i18n key for name (under common.presets) */
  nameKey: string;
  /** i18n key for description */
  descriptionKey: string;
  type: TournamentType;
  scoringRules: ScoringRules;
  matchRules: MatchRules;
  teamRules?: TeamRules;
  formatType: BracketFormatType;
}

export const TOURNAMENT_PRESETS: TournamentPreset[] = [
  {
    id: 'ibsa_individual',
    nameKey: 'common.presets.ibsaIndividual.name',
    descriptionKey: 'common.presets.ibsaIndividual.description',
    type: 'individual',
    scoringRules: { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2, deuceEnabled: true },
    matchRules: { timeoutsPerPlayer: 1, timeoutDurationSeconds: 60 },
    formatType: 'round_robin',
  },
  {
    id: 'ibsa_team',
    nameKey: 'common.presets.ibsaTeam.name',
    descriptionKey: 'common.presets.ibsaTeam.description',
    type: 'team',
    scoringRules: { winScore: 31, setsToWin: 1, maxSets: 1, minLead: 2, deuceEnabled: true },
    matchRules: { timeoutsPerPlayer: 1, timeoutDurationSeconds: 60 },
    teamRules: { teamSize: 3, rotationEnabled: true, rotationInterval: 6 },
    formatType: 'round_robin',
  },
];

export interface FormatOption {
  value: BracketFormatType;
  /** i18n key for label */
  labelKey: string;
  /** i18n key for description */
  descriptionKey: string;
}

export const FORMAT_OPTIONS: FormatOption[] = [
  { value: 'round_robin', labelKey: 'common.formats.roundRobin.label', descriptionKey: 'common.formats.roundRobin.description' },
  { value: 'single_elimination', labelKey: 'common.formats.singleElimination.label', descriptionKey: 'common.formats.singleElimination.description' },
  { value: 'double_elimination', labelKey: 'common.formats.doubleElimination.label', descriptionKey: 'common.formats.doubleElimination.description' },
  { value: 'swiss', labelKey: 'common.formats.swiss.label', descriptionKey: 'common.formats.swiss.description' },
  { value: 'group_knockout', labelKey: 'common.formats.groupKnockout.label', descriptionKey: 'common.formats.groupKnockout.description' },
];

// ===== 멀티스테이지 위자드 프리셋 =====
export const WIZARD_PRESETS: WizardPreset[] = [
  {
    id: 'ibsa_individual',
    name: 'common.presets.ibsaIndividual.name',
    description: 'common.presets.ibsaIndividual.wizardDescription',
    type: 'individual',
    scoringRules: { winScore: 11, setsToWin: 2, maxSets: 3, minLead: 2, deuceEnabled: true },
    matchRules: { timeoutsPerPlayer: 1, timeoutDurationSeconds: 60 },
    formatType: 'round_robin',
  },
  {
    id: 'ibsa_team',
    name: 'common.presets.ibsaTeam.name',
    description: 'common.presets.ibsaTeam.wizardDescription',
    type: 'team',
    scoringRules: { winScore: 31, setsToWin: 1, maxSets: 1, minLead: 2, deuceEnabled: true },
    matchRules: { timeoutsPerPlayer: 1, timeoutDurationSeconds: 60 },
    teamRules: { teamSize: 3, rotationEnabled: true, rotationInterval: 6 },
    formatType: 'round_robin',
  },
];
