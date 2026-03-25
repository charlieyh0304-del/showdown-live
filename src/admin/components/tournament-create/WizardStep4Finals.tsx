import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import NumberStepper from './NumberStepper';

interface WizardStep4FinalsProps {
  state: {
    finalsFormat: 'single_elimination' | 'double_elimination' | 'round_robin';
    finalsStartRound: number;
    bracketArrangement: 'cross_group' | 'sequential' | 'custom';
    avoidSameGroup: boolean;
    thirdPlaceMatch: boolean;
    hasRankingMatch: boolean;
    rankingStartRank: number;
    rankingEndRank: number;
    rankingFormat: 'round_robin' | 'single_elimination';
    fifthToEighth: boolean;
    fifthToEighthFormat: 'simple' | 'full' | 'round_robin';
    classificationGroups: boolean;
    classificationGroupSize: number;
    hasGroupStage?: boolean;
    advanceCount?: number;
    advancePerGroup?: number;
    groupCount?: number;
    participantCount?: number;
    type?: string;
    teamSize?: number;
    // round scoring
    finalsScoringRules: { winScore: number; setsToWin: number; maxSets: number; minLead: number; deuceEnabled: boolean };
    hasRoundScoringOverride?: boolean;
    roundOverrideFromRound?: number;
    roundOverrideSetsToWin?: number;
    roundOverrideMaxSets?: number;
    // custom pairings
    customPairings?: Array<{ position: number; slot1: string; slot2: string }>;
  };
  dispatch: (action: { type: 'SET_FIELD'; field: string; value: unknown }) => void;
}

const FORMAT_CARD_KEYS = [
  { value: 'single_elimination' as const, icon: '🏆', labelKey: 'admin.tournamentCreate.finals.singleElimination', descKey: 'admin.tournamentCreate.finals.singleEliminationDescription' },
  { value: 'double_elimination' as const, icon: '🔄', labelKey: 'admin.tournamentCreate.finals.doubleElimination', descKey: 'admin.tournamentCreate.finals.doubleEliminationDescription' },
  { value: 'round_robin' as const, icon: '🔁', labelKey: 'admin.tournamentCreate.finals.roundRobin', descKey: 'admin.tournamentCreate.finals.roundRobinDescription' },
];

const ARRANGEMENT_OPTION_KEYS = [
  { value: 'cross_group' as const, labelKey: 'admin.tournamentCreate.finals.crossGroup', descKey: 'admin.tournamentCreate.finals.crossGroupDescription' },
  { value: 'sequential' as const, labelKey: 'admin.tournamentCreate.finals.sequential', descKey: 'admin.tournamentCreate.finals.sequentialDescription' },
  { value: 'custom' as const, labelKey: 'admin.tournamentCreate.finals.customArrangement', descKey: 'admin.tournamentCreate.finals.customArrangementDescription' },
];

// ===== Helper functions =====

function getSlotLabels(groupCount: number, advancePerGroup: number): string[] {
  const labels: string[] = [];
  for (let g = 0; g < groupCount; g++) {
    for (let r = 1; r <= advancePerGroup; r++) {
      labels.push(`${String.fromCharCode(65 + g)}${r}`);
    }
  }
  return labels;
}

function generateCrossGroupPreview(
  groupCount: number,
  advancePerGroup: number,
  finalsStartRound: number,
): Array<{ match: number; slot1: string; slot2: string }> {
  const totalAdvanced = groupCount * advancePerGroup;
  const matchCount = Math.min(finalsStartRound / 2, Math.ceil(totalAdvanced / 2));
  const pairings: Array<{ match: number; slot1: string; slot2: string }> = [];

  if (groupCount === 2) {
    // 2 groups: A1 vs B2, B1 vs A2, then fill remaining slots
    for (let r = 0; r < advancePerGroup; r++) {
      const slot1Group = r % 2 === 0 ? 0 : 1;
      const slot2Group = r % 2 === 0 ? 1 : 0;
      const slot1Rank = Math.floor(r / 2) + 1;
      const slot2Rank = advancePerGroup - Math.floor(r / 2);
      pairings.push({
        match: pairings.length + 1,
        slot1: `${String.fromCharCode(65 + slot1Group)}${slot1Rank}`,
        slot2: `${String.fromCharCode(65 + slot2Group)}${slot2Rank}`,
      });
      if (pairings.length >= matchCount) break;
    }
    // If we need more matches from simple 2-group cross
    if (pairings.length === 0 && matchCount > 0) {
      pairings.push({ match: 1, slot1: 'A1', slot2: 'B2' });
      if (matchCount > 1) pairings.push({ match: 2, slot1: 'B1', slot2: 'A2' });
    }
  } else {
    // N groups: pair group i with group (N-1-i), ranks cross
    const pairedGroups: Array<[number, number]> = [];
    for (let i = 0; i < Math.ceil(groupCount / 2); i++) {
      const j = groupCount - 1 - i;
      if (i < j) pairedGroups.push([i, j]);
      else if (i === j) pairedGroups.push([i, i]);
    }

    for (const [g1, g2] of pairedGroups) {
      for (let r = 1; r <= advancePerGroup; r++) {
        const crossRank = advancePerGroup - r + 1;
        if (g1 !== g2) {
          pairings.push({
            match: pairings.length + 1,
            slot1: `${String.fromCharCode(65 + g1)}${r}`,
            slot2: `${String.fromCharCode(65 + g2)}${crossRank}`,
          });
          if (pairings.length >= matchCount) break;
          pairings.push({
            match: pairings.length + 1,
            slot1: `${String.fromCharCode(65 + g2)}${r}`,
            slot2: `${String.fromCharCode(65 + g1)}${crossRank}`,
          });
        } else {
          // Same group pairing for odd group count
          if (advancePerGroup >= 2) {
            pairings.push({
              match: pairings.length + 1,
              slot1: `${String.fromCharCode(65 + g1)}${r}`,
              slot2: `${String.fromCharCode(65 + g1)}${crossRank}`,
            });
          }
        }
        if (pairings.length >= matchCount) break;
      }
      if (pairings.length >= matchCount) break;
    }
  }

  // Ensure correct count
  return pairings.slice(0, matchCount);
}

function generateSequentialPreview(
  totalAdvanced: number,
  finalsStartRound: number,
): Array<{ match: number; slot1: string; slot2: string }> {
  const matchCount = Math.min(finalsStartRound / 2, Math.ceil(totalAdvanced / 2));
  const pairings: Array<{ match: number; slot1: string; slot2: string }> = [];

  for (let i = 0; i < matchCount; i++) {
    const topSeed = i + 1;
    const bottomSeed = totalAdvanced - i;
    if (topSeed >= bottomSeed && i > 0) break;
    pairings.push({
      match: i + 1,
      slot1: `#${topSeed}`,
      slot2: `#${bottomSeed}`,
    });
  }

  return pairings;
}

function getRoundLabel(round: number, t?: (key: string) => string): string {
  if (t) {
    switch (round) {
      case 2: return t('admin.tournamentCreate.finals.final');
      case 4: return t('admin.tournamentCreate.finals.round4');
      case 8: return t('admin.tournamentCreate.finals.round8');
      case 16: return t('admin.tournamentCreate.finals.round16');
      case 32: return t('admin.tournamentCreate.finals.round32');
      default: return `${round}`;
    }
  }
  if (round === 2) return 'Final';
  return `Round of ${round}`;
}

// ===== Toggle Switch component =====
function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${checked ? 'bg-green-600' : 'bg-gray-600'}`}
      onClick={onChange}
    >
      <span
        className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-7' : 'translate-x-1'}`}
      />
    </button>
  );
}

// ===== Main Component =====

export default function WizardStep4Finals({ state, dispatch }: WizardStep4FinalsProps) {
  const { t } = useTranslation();
  const advanceCount = state.advanceCount || 8;
  const groupCount = state.groupCount || 2;
  const advancePerGroup = state.advancePerGroup || 2;
  const isTeamType = state.type === 'team' || state.type === 'randomTeamLeague';
  const unitLabel = isTeamType ? t('common.units.team') : t('common.units.person');

  const setField = (field: string, value: unknown) => {
    dispatch({ type: 'SET_FIELD', field, value });
  };

  // Bracket preview
  const bracketPreview = useMemo(() => {
    if (!state.hasGroupStage) return [];
    if (state.bracketArrangement === 'cross_group') {
      return generateCrossGroupPreview(groupCount, advancePerGroup, state.finalsStartRound);
    }
    if (state.bracketArrangement === 'sequential') {
      const total = groupCount * advancePerGroup;
      return generateSequentialPreview(total, state.finalsStartRound);
    }
    return [];
  }, [state.hasGroupStage, state.bracketArrangement, groupCount, advancePerGroup, state.finalsStartRound]);

  // Slot labels for custom pairing
  const slotLabels = useMemo(
    () => (state.hasGroupStage ? getSlotLabels(groupCount, advancePerGroup) : []),
    [state.hasGroupStage, groupCount, advancePerGroup],
  );

  const customMatchCount = Math.min(state.finalsStartRound / 2, Math.ceil(slotLabels.length / 2));

  // Ensure customPairings array is initialized
  const customPairings = state.customPairings || [];

  // Count assigned slots in custom mode
  const assignedSlots = useMemo(() => {
    const set = new Set<string>();
    for (const p of customPairings) {
      if (p.slot1) set.add(p.slot1);
      if (p.slot2) set.add(p.slot2);
    }
    return set;
  }, [customPairings]);

  const unassignedCount = slotLabels.length - assignedSlots.size;

  // Round scoring helpers
  const setsToWin = state.finalsScoringRules.setsToWin;
  const maxSets = state.finalsScoringRules.maxSets;
  const overrideSetsToWin = state.roundOverrideSetsToWin || setsToWin + 1;
  const overrideMaxSets = state.roundOverrideMaxSets || overrideSetsToWin * 2 - 1;

  // Available rounds for override start
  const availableRounds = useMemo(() => {
    const rounds: Array<{ value: number; label: string }> = [];
    let r = state.finalsStartRound;
    while (r >= 2) {
      if (r < state.finalsStartRound) {
        rounds.push({ value: r, label: getRoundLabel(r, t) });
      }
      r = Math.floor(r / 2);
    }
    return rounds;
  }, [state.finalsStartRound]);

  // Scoring summary
  const scoringSummary = useMemo(() => {
    if (!state.hasRoundScoringOverride || !state.roundOverrideFromRound) return null;
    const fromRound = state.roundOverrideFromRound;
    const earlyPart = `${getRoundLabel(state.finalsStartRound, t)}~${getRoundLabel(fromRound * 2, t)}: ${t('admin.tournamentCreate.matchRules.finalsSets', { maxSets, setsToWin })}`;
    const latePart = `${getRoundLabel(fromRound, t)}~${getRoundLabel(2, t)}: ${t('admin.tournamentCreate.matchRules.overrideSets', { maxSets: overrideMaxSets, setsToWin: overrideSetsToWin })}`;
    return `${earlyPart} | ${latePart}`;
  }, [state.hasRoundScoringOverride, state.roundOverrideFromRound, state.finalsStartRound, maxSets, overrideMaxSets]);

  // Custom pairing helpers
  const handleCustomPairingChange = (matchIndex: number, slot: 'slot1' | 'slot2', value: string) => {
    const newPairings = [...customPairings];
    while (newPairings.length <= matchIndex) {
      newPairings.push({ position: newPairings.length + 1, slot1: '', slot2: '' });
    }
    newPairings[matchIndex] = { ...newPairings[matchIndex], [slot]: value };
    setField('customPairings', newPairings);
  };

  const applyCrossDefault = () => {
    const preview = generateCrossGroupPreview(groupCount, advancePerGroup, state.finalsStartRound);
    setField(
      'customPairings',
      preview.map((p) => ({ position: p.match, slot1: p.slot1, slot2: p.slot2 })),
    );
  };

  const resetCustomPairings = () => {
    const empty = Array.from({ length: customMatchCount }, (_, i) => ({
      position: i + 1,
      slot1: '',
      slot2: '',
    }));
    setField('customPairings', empty);
  };

  return (
    <div className="space-y-6">
      {/* Format selection */}
      <div className="card space-y-4">
        <h2 className="text-xl font-bold">{state.hasGroupStage ? t('admin.tournamentCreate.finals.formatTitle') : t('admin.tournamentCreate.finals.tournamentFormat')}</h2>
        <div
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
          role="radiogroup"
          aria-label={t('admin.tournamentCreate.finals.formatTitle')}
        >
          {FORMAT_CARD_KEYS.map((fmt) => (
            <button
              key={fmt.value}
              role="radio"
              aria-checked={state.finalsFormat === fmt.value}
              className={`card text-left p-4 border-2 ${
                state.finalsFormat === fmt.value
                  ? 'border-yellow-400 bg-gray-800'
                  : 'border-transparent hover:border-gray-600'
              }`}
              onClick={() => setField('finalsFormat', fmt.value)}
              aria-label={`${t(fmt.labelKey)}${state.finalsFormat === fmt.value ? `, ${t('common.accessibility.selected')}` : ''}`}
            >
              <div className="text-2xl mb-1" aria-hidden="true">
                {fmt.icon}
              </div>
              <h3 className="text-lg font-bold">{t(fmt.labelKey)}</h3>
              <p className="text-gray-400 text-sm">{t(fmt.descKey)}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Start round */}
      {state.finalsFormat !== 'round_robin' && (
        <div className="card space-y-4">
          <h3 className="text-lg font-semibold mb-2">{t('admin.tournamentCreate.finals.startRound')}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { value: 32, label: t('admin.tournamentCreate.finals.round32') },
              { value: 16, label: t('admin.tournamentCreate.finals.round16') },
              { value: 8, label: t('admin.tournamentCreate.finals.round8') },
              { value: 4, label: t('admin.tournamentCreate.finals.round4') },
            ]
              .filter((opt) => {
                const ac = state.advanceCount || state.participantCount || 8;
                return opt.value <= ac * 2;
              })
              .map((opt) => (
                <button
                  key={opt.value}
                  className={`btn py-3 text-lg ${state.finalsStartRound === opt.value ? 'btn-primary' : 'bg-gray-700 text-white'}`}
                  onClick={() => setField('finalsStartRound', opt.value)}
                  aria-pressed={state.finalsStartRound === opt.value}
                >
                  {opt.label}
                </button>
              ))}
          </div>
          {advanceCount < state.finalsStartRound && (
            <p className="text-yellow-500 text-sm mt-2">
              {t('admin.tournamentCreate.finals.byeInfo', { advance: advanceCount, unit: unitLabel, round: state.finalsStartRound, bye: state.finalsStartRound - advanceCount })}
            </p>
          )}
        </div>
      )}

      {/* Bracket arrangement (only with group stage) */}
      {state.hasGroupStage && state.finalsFormat !== 'round_robin' && (
        <div className="card space-y-4">
          <fieldset>
            <legend className="text-xl font-bold mb-4">{t('admin.tournamentCreate.finals.bracketArrangement')}</legend>
            <div className="space-y-3" role="radiogroup" aria-label={t('admin.tournamentCreate.finals.bracketArrangement')}>
              {ARRANGEMENT_OPTION_KEYS.map((opt) => (
                <button
                  key={opt.value}
                  role="radio"
                  aria-checked={state.bracketArrangement === opt.value}
                  className={`card w-full text-left p-4 border-2 ${
                    state.bracketArrangement === opt.value
                      ? 'border-yellow-400 bg-gray-800'
                      : 'border-transparent hover:border-gray-600'
                  }`}
                  onClick={() => setField('bracketArrangement', opt.value)}
                  aria-label={`${t(opt.labelKey)}: ${t(opt.descKey)}${state.bracketArrangement === opt.value ? `, ${t('common.accessibility.selected')}` : ''}`}
                >
                  <h3 className="text-lg font-bold">{t(opt.labelKey)}</h3>
                  <p className="text-gray-400 text-sm">{t(opt.descKey)}</p>
                </button>
              ))}
            </div>

            {/* Bracket preview for cross_group / sequential */}
            {(state.bracketArrangement === 'cross_group' || state.bracketArrangement === 'sequential') &&
              bracketPreview.length > 0 && (
                <div className="mt-4 p-4 bg-gray-800 rounded-lg">
                  <h4 className="text-sm font-semibold text-gray-400 mb-3">{t('admin.tournamentCreate.finals.bracketPreview')}</h4>
                  {/* Visual preview */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                    {bracketPreview.map((p) => (
                      <div
                        key={p.match}
                        className="flex items-center justify-between bg-gray-700 rounded px-3 py-2"
                      >
                        <span className="text-xs text-gray-400">{t('admin.preview.matchNumber', { position: p.match })}</span>
                        <span className="font-bold text-yellow-400">{p.slot1}</span>
                        <span className="text-gray-500 text-sm">vs</span>
                        <span className="font-bold text-cyan-400">{p.slot2}</span>
                      </div>
                    ))}
                  </div>
                  {/* Accessible text list */}
                  <div role="list" aria-label={t('admin.tournamentCreate.finals.bracketListAriaLabel')} className="sr-only">
                    {bracketPreview.map((p) => (
                      <div key={p.match} role="listitem">
                        {t('admin.preview.matchNumber', { position: p.match })}: {p.slot1} vs {p.slot2}
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Custom pairing UI */}
            {state.bracketArrangement === 'custom' && slotLabels.length > 0 && (
              <div className="mt-4 p-4 bg-gray-800 rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-400">{t('admin.tournamentCreate.finals.customPairingTitle')}</h4>
                  <div className="flex gap-2">
                    <button
                      className="btn bg-blue-600 text-white text-sm px-3 py-1"
                      onClick={applyCrossDefault}
                      aria-label={t('admin.tournamentCreate.finals.applyCrossDefault')}
                    >
                      {t('admin.tournamentCreate.finals.applyCrossDefault')}
                    </button>
                    <button
                      className="btn bg-gray-600 text-white text-sm px-3 py-1"
                      onClick={resetCustomPairings}
                      aria-label={t('admin.tournamentCreate.finals.resetPairings')}
                    >
                      {t('admin.tournamentCreate.finals.resetPairings')}
                    </button>
                  </div>
                </div>

                {/* Unassigned counter */}
                <p aria-live="polite" className="text-sm">
                  {unassignedCount > 0 ? (
                    <span className="text-yellow-400">{t('admin.tournamentCreate.finals.unassignedSlots', { count: unassignedCount })}</span>
                  ) : (
                    <span className="text-green-400">{t('admin.tournamentCreate.finals.allSlotsAssigned')}</span>
                  )}
                </p>

                {/* Match rows */}
                <div className="space-y-2">
                  {Array.from({ length: customMatchCount }, (_, i) => {
                    const pairing = customPairings[i] || { position: i + 1, slot1: '', slot2: '' };
                    // Determine which slots are taken by OTHER matches
                    const takenByOthers = new Set<string>();
                    for (let j = 0; j < customPairings.length; j++) {
                      if (j === i) continue;
                      if (customPairings[j]?.slot1) takenByOthers.add(customPairings[j].slot1);
                      if (customPairings[j]?.slot2) takenByOthers.add(customPairings[j].slot2);
                    }
                    // Also exclude the other slot of this same match
                    const slot1Taken = new Set(takenByOthers);
                    if (pairing.slot2) slot1Taken.add(pairing.slot2);
                    const slot2Taken = new Set(takenByOthers);
                    if (pairing.slot1) slot2Taken.add(pairing.slot1);

                    return (
                      <div
                        key={i}
                        className="flex items-center gap-2 bg-gray-700 rounded px-3 py-2"
                      >
                        <span className="text-xs text-gray-400 w-12 shrink-0">{t('admin.preview.matchNumber', { position: i + 1 })}</span>
                        <select
                          className="input bg-gray-600 text-white py-1 px-2 rounded flex-1"
                          value={pairing.slot1}
                          onChange={(e) => handleCustomPairingChange(i, 'slot1', e.target.value)}
                          aria-label={t('admin.tournamentCreate.finals.homePlayer', { num: i + 1 })}
                        >
                          <option value="">{t('admin.tournamentCreate.finals.selectSlot')}</option>
                          {slotLabels.map((label) => (
                            <option
                              key={label}
                              value={label}
                              disabled={slot1Taken.has(label)}
                            >
                              {label}
                              {slot1Taken.has(label) ? ` (${t('admin.tournamentCreate.finals.assigned')})` : ''}
                            </option>
                          ))}
                        </select>
                        <span className="text-gray-500 text-sm">vs</span>
                        <select
                          className="input bg-gray-600 text-white py-1 px-2 rounded flex-1"
                          value={pairing.slot2}
                          onChange={(e) => handleCustomPairingChange(i, 'slot2', e.target.value)}
                          aria-label={t('admin.tournamentCreate.finals.awayPlayer', { num: i + 1 })}
                        >
                          <option value="">{t('admin.tournamentCreate.finals.selectSlot')}</option>
                          {slotLabels.map((label) => (
                            <option
                              key={label}
                              value={label}
                              disabled={slot2Taken.has(label)}
                            >
                              {label}
                              {slot2Taken.has(label) ? ` (${t('admin.tournamentCreate.finals.assigned')})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>

                {/* Validation error */}
                {unassignedCount > 0 && customPairings.length > 0 && (
                  <p role="alert" className="text-red-400 text-sm">
                    {t('admin.tournamentCreate.finals.assignAllSlots', { count: unassignedCount })}
                  </p>
                )}
              </div>
            )}

            {/* Same group avoidance */}
            {state.bracketArrangement !== 'custom' && (
              <label className="flex items-center justify-between cursor-pointer mt-4">
                <span className="text-lg font-semibold">{t('admin.tournamentCreate.finals.avoidSameGroup')}</span>
                <ToggleSwitch
                  checked={state.avoidSameGroup}
                  onChange={() => setField('avoidSameGroup', !state.avoidSameGroup)}
                  ariaLabel={t('admin.tournamentCreate.finals.avoidSameGroup')}
                />
              </label>
            )}
          </fieldset>
        </div>
      )}

      {/* Full round robin info */}
      {state.finalsFormat === 'round_robin' &&
        !state.hasGroupStage &&
        (() => {
          const rawCount = state.participantCount || state.advanceCount || 8;
          const n =
            state.type === 'randomTeamLeague'
              ? Math.floor(rawCount / (state.teamSize || 3))
              : rawCount;
          return (
            <div className="card p-4 bg-blue-900/20 border border-blue-500/30">
              <p className="text-blue-300 font-semibold">{t('admin.tournamentCreate.finals.fullLeagueTitle')}</p>
              <p className="text-gray-400 text-sm mt-1">
                {isTeamType ? t('admin.tournamentCreate.finals.allTeamsPlay') : t('admin.tournamentCreate.finals.allPlayersPlay')}{' '}
                {t('admin.tournamentCreate.finals.totalMatchesLabel', { count: (n * (n - 1)) / 2 })}
              </p>
            </div>
          );
        })()}

      {/* Match scoring rules */}
      {state.finalsFormat !== 'round_robin' && (
        <div className="card space-y-4">
          <fieldset>
            <legend className="text-xl font-bold mb-4">{t('admin.tournamentCreate.matchRules.title')}</legend>

            <NumberStepper
              label={t('admin.tournamentCreate.matchRules.finalsSets', { maxSets, setsToWin })}
              value={setsToWin}
              min={1}
              max={5}
              onChange={(v) => {
                setField('finalsScoringRules', {
                  ...state.finalsScoringRules,
                  setsToWin: v,
                  maxSets: v * 2 - 1,
                });
              }}
              ariaLabel={t('admin.tournamentCreate.matchRules.finalsSets', { maxSets, setsToWin })}
            />

            {/* Round override toggle */}
            {availableRounds.length > 0 && (
              <div className="mt-6">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-lg font-semibold">{t('admin.tournamentCreate.matchRules.roundScoringOverride')}</span>
                  <ToggleSwitch
                    checked={!!state.hasRoundScoringOverride}
                    onChange={() => setField('hasRoundScoringOverride', !state.hasRoundScoringOverride)}
                    ariaLabel={t('admin.tournamentCreate.matchRules.roundScoringOverride')}
                  />
                </label>

                {state.hasRoundScoringOverride && (
                  <div className="mt-4 p-4 bg-gray-800 rounded-lg space-y-4">
                    <div className="flex items-center gap-4">
                      <label className="font-semibold text-sm text-gray-400" htmlFor="round-override-from">
                        {t('admin.tournamentCreate.matchRules.overrideStart')}
                      </label>
                      <select
                        id="round-override-from"
                        className="input bg-gray-600 text-white py-2 px-3 rounded"
                        value={state.roundOverrideFromRound || (availableRounds[0]?.value ?? 4)}
                        onChange={(e) => setField('roundOverrideFromRound', Number(e.target.value))}
                        aria-label={t('admin.tournamentCreate.matchRules.roundScoringOverride')}
                      >
                        {availableRounds.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <NumberStepper
                      label={t('admin.tournamentCreate.matchRules.overrideSets', { maxSets: overrideMaxSets, setsToWin: overrideSetsToWin })}
                      value={overrideSetsToWin}
                      min={setsToWin + 1}
                      max={5}
                      onChange={(v) => {
                        setField('roundOverrideSetsToWin', v);
                        setField('roundOverrideMaxSets', v * 2 - 1);
                      }}
                      ariaLabel={t('admin.tournamentCreate.matchRules.overrideSets', { maxSets: overrideMaxSets, setsToWin: overrideSetsToWin })}
                    />

                    {/* Summary */}
                    {scoringSummary && (
                      <p aria-live="polite" className="text-sm text-cyan-400 bg-gray-700 rounded px-3 py-2">
                        {scoringSummary}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </fieldset>
        </div>
      )}

      {/* 3rd/4th place match */}
      {state.finalsFormat !== 'round_robin' && (
        <div className="card">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-lg font-semibold">{t('admin.tournamentCreate.ranking.thirdPlaceMatch')}</span>
            <ToggleSwitch
              checked={state.thirdPlaceMatch}
              onChange={() => setField('thirdPlaceMatch', !state.thirdPlaceMatch)}
              ariaLabel={t('admin.tournamentCreate.ranking.thirdPlaceMatch')}
            />
          </label>
        </div>
      )}

      {/* Ranking match */}
      {state.finalsFormat !== 'round_robin' && (
        <div className="card space-y-4">
          <h2 className="text-xl font-bold">{t('admin.tournamentCreate.finals.rankingMatchTitle')}</h2>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-lg font-semibold">{t('admin.tournamentCreate.finals.rankingMatchToggle')}</span>
            <ToggleSwitch
              checked={state.hasRankingMatch}
              onChange={() => setField('hasRankingMatch', !state.hasRankingMatch)}
              ariaLabel={t('admin.tournamentCreate.finals.rankingMatchToggle')}
            />
          </label>

          {state.hasRankingMatch && (
            <div className="space-y-4 mt-4 p-4 bg-gray-800 rounded-lg">
              {/* 5~8th */}
              <label className="flex items-center justify-between cursor-pointer">
                <span className="font-semibold">{t('admin.tournamentCreate.finals.fifthToEighthTitle')}</span>
                <ToggleSwitch
                  checked={state.fifthToEighth}
                  onChange={() => setField('fifthToEighth', !state.fifthToEighth)}
                  ariaLabel={t('admin.tournamentCreate.finals.fifthToEighthTitle')}
                />
              </label>

              {state.fifthToEighth && (
                <div className="ml-4 space-y-2">
                  <h4 className="text-sm font-semibold text-gray-400">{t('admin.tournamentCreate.finals.fifthToEighthTitle')}</h4>
                  <div
                    className="grid grid-cols-3 gap-2"
                    role="radiogroup"
                    aria-label={t('admin.tournamentCreate.finals.fifthToEighthTitle')}
                  >
                    {(
                      [
                        { value: 'simple' as const, label: t('admin.preview.simplified'), desc: t('admin.tournamentCreate.finals.fifthToEighthSimpleDesc') },
                        { value: 'full' as const, label: t('admin.preview.crossMatch'), desc: t('admin.tournamentCreate.finals.fifthToEighthFullDesc') },
                        {
                          value: 'round_robin' as const,
                          label: t('admin.preview.fullLeagueMatch'),
                          desc: t('admin.tournamentCreate.finals.fifthToEighthRoundRobinDesc'),
                        },
                      ] as const
                    ).map((opt) => {
                      const selected = state.fifthToEighthFormat === opt.value;
                      return (
                        <button
                          key={opt.value}
                          role="radio"
                          aria-checked={selected}
                          aria-label={`${opt.label} ${opt.desc}${selected ? `, ${t('common.accessibility.selected')}` : ''}`}
                          className={`p-3 rounded-lg text-center text-sm font-semibold transition-all ${
                            selected
                              ? 'bg-yellow-500 text-black border-2 border-yellow-300 shadow-lg'
                              : 'bg-gray-700 text-gray-300 border-2 border-gray-600 hover:bg-gray-600'
                          }`}
                          onClick={() => setField('fifthToEighthFormat', opt.value)}
                        >
                          <span className="block">
                            {selected ? '✓ ' : ''}
                            {opt.label}
                          </span>
                          <span
                            className="block text-xs mt-1"
                            style={{ opacity: selected ? 1 : 0.6 }}
                          >
                            {opt.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {t('admin.tournamentCreate.finals.currentSelection')}{' '}
                    <span className="text-yellow-400 font-bold">
                      {state.fifthToEighthFormat === 'simple'
                        ? t('admin.preview.simplified')
                        : state.fifthToEighthFormat === 'full'
                          ? t('admin.preview.crossMatch')
                          : t('admin.preview.fullLeagueMatch')}
                    </span>
                  </p>
                </div>
              )}

              {/* IBSA classification groups */}
              <label className="flex items-center justify-between cursor-pointer">
                <span className="font-semibold">{t('admin.tournamentCreate.finals.classificationGroups')}</span>
                <ToggleSwitch
                  checked={state.classificationGroups}
                  onChange={() => setField('classificationGroups', !state.classificationGroups)}
                  ariaLabel={t('admin.tournamentCreate.finals.classificationGroups')}
                />
              </label>
              {state.classificationGroups && (
                <div className="ml-4">
                  <NumberStepper
                    label={t('admin.tournamentCreate.finals.groupSizeLabel')}
                    value={state.classificationGroupSize}
                    min={3}
                    max={8}
                    onChange={(v) => setField('classificationGroupSize', v)}
                    ariaLabel={t('admin.tournamentCreate.finals.classificationGroupSizeAriaLabel')}
                  />
                </div>
              )}

              <h3 className="text-lg font-bold text-cyan-400 mt-4">{t('admin.tournamentCreate.finals.rankingFormatTitle')}</h3>
              <div
                className="grid grid-cols-2 gap-3"
                role="radiogroup"
                aria-label={t('admin.tournamentCreate.finals.rankingFormatAriaLabel')}
              >
                {(
                  [
                    { value: 'round_robin' as const, labelKey: 'admin.tournamentCreate.finals.rankingRoundRobin' },
                    { value: 'single_elimination' as const, labelKey: 'admin.tournamentCreate.finals.rankingSingleElimination' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    role="radio"
                    aria-checked={state.rankingFormat === opt.value}
                    className={`btn text-lg py-3 ${
                      state.rankingFormat === opt.value ? 'btn-primary' : 'bg-gray-700 text-white'
                    }`}
                    onClick={() => setField('rankingFormat', opt.value)}
                    aria-label={`${t(opt.labelKey)}${state.rankingFormat === opt.value ? `, ${t('common.accessibility.selected')}` : ''}`}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
