import { useMemo, useState, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RULES_PRESETS,
  RULES_PRESET_ORDER,
  matchKindOf,
  toList,
  type TiebreakCriterion,
  type TournamentLike,
} from '@shared/rules/competitionRules';
import {
  TOURNAMENT_SCOPE,
  addCriterion,
  applyPreset,
  availableCriteria,
  displayValue,
  effectiveRules,
  fieldDomId,
  fieldUsedAtStage,
  getPath,
  ibsaTimeLimitScopes,
  MAX_TIME_LIMIT_SECONDS,
  moveItem,
  overriddenPaths,
  removeItem,
  resetStagePaths,
  RULE_FIELD_PATHS,
  setFieldValue,
  setFieldValues,
  type RuleIssue,
  type RulesDraft,
} from './rulesEditorModel';
import { defaultServeRotation, defaultSideChangePoint, DEFAULT_SERVES_PER_TURN, DEFAULT_PLAYERS_ON_COURT } from '@shared/rules/serve';

/**
 * 대회 규칙 편집기 (M0b). 대회 생성 마법사의 '경기 규칙' 단계와 대회 상세의 '경기 규칙' 탭에서 쓴다.
 *
 * 접근성: 모든 조작은 키보드·화면 낭독기로 가능하다(끌어다 놓기 없음). 섹션마다 fieldset/legend,
 * 도움말은 aria-describedby, 순서 변경·되돌리기 결과는 aria-live로 알린다. 오류 요약은 호스트가 summaryRef로 초점을 옮긴다.
 */

export interface RulesStageOption {
  id: string;
  label: string;
  /** 스테이지 종류 (qualifying/finals/ranking_match): 그 단계에서 쓰이지 않는 항목을 숨기는 데 쓴다 */
  type?: string;
}

export interface CompetitionRulesEditorProps {
  /** 규칙을 얹을 대회 문서 (스테이지 포함). 마법사에서는 저장 전 미리 만든 문서. */
  tournament: TournamentLike;
  draft: RulesDraft;
  onChange: (draft: RulesDraft) => void;
  stageOptions: RulesStageOption[];
  /** DOM id 접두사 (한 화면에 편집기가 하나뿐이어도 고유하게) */
  idPrefix: string;
  issues: RuleIssue[];
  showIssues: boolean;
  summaryRef?: Ref<HTMLDivElement>;
  /** 오류 요약에 추가로 보여 줄 항목 (예: 마법사의 '확인' 체크) */
  extraIssues?: RuleIssue[];
  /** 편집기 아래에 붙일 내용 (마법사의 확인 체크) */
  footer?: ReactNode;
}

const BEST_OF = [1, 3, 5, 7];
const ROUND_SIZES = [64, 32, 16, 8, 4, 2];

export default function CompetitionRulesEditor({
  tournament,
  draft,
  onChange,
  stageOptions,
  idPrefix,
  issues,
  showIssues,
  summaryRef,
  extraIssues = [],
  footer,
}: CompetitionRulesEditorProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<string>(TOURNAMENT_SCOPE);
  const [announcement, setAnnouncement] = useState('');
  const [presetChoice, setPresetChoice] = useState<string>(() => {
    const p = draft.tournament.presetId;
    return typeof p === 'string' && RULES_PRESETS[p] ? p : 'ibsa';
  });
  const [addChoice, setAddChoice] = useState<string>('');

  // 사라진 스테이지를 고르고 있으면 대회 전체로
  const activeScope = scope === TOURNAMENT_SCOPE || stageOptions.some(s => s.id === scope) ? scope : TOURNAMENT_SCOPE;
  const isStage = activeScope !== TOURNAMENT_SCOPE;
  const kind = matchKindOf(tournament.type);
  const sp = `scoring.${kind}`;

  /** 다음 렌더가 끝난 뒤 요소로 초점을 옮긴다 (순서 변경·범위 전환·되돌리기 뒤에 초점을 잃지 않게) */
  const setPendingFocus = (targetId: string) => {
    requestAnimationFrame(() => document.getElementById(targetId)?.focus());
  };

  const eff = useMemo(() => effectiveRules(tournament, draft, activeScope), [tournament, draft, activeScope]);
  const baseEff = useMemo(() => effectiveRules(tournament, draft, TOURNAMENT_SCOPE), [tournament, draft]);
  const overridden = useMemo(() => new Set<string>(isStage ? overriddenPaths(tournament, draft, activeScope) : []), [tournament, draft, activeScope, isStage]);
  const stageType = isStage ? stageOptions.find(s => s.id === activeScope)?.type : undefined;
  /** 이 범위에서 경기 생성·순위 계산이 실제로 읽는 항목인가 */
  const used = (path: string) => !isStage || fieldUsedAtStage(path, stageType);
  /** 보여 줄 항목: 이 범위에서 쓰이거나, 쓰이지 않는데 덮어쓴 값이 남아 있어(되돌릴 수 있게) 보여야 하는 항목 */
  const shown = (...paths: string[]) => paths.some(p => used(p) || overridden.has(p));

  const scopeName = (id: string) => (id === TOURNAMENT_SCOPE ? t('admin.rulesEditor.scope.tournament') : (stageOptions.find(s => s.id === id)?.label ?? id));
  const id = (path: string) => fieldDomId(idPrefix, path);
  const fieldLabel = (path: string) => t(`admin.rulesEditor.fields.${path.replace(/\./g, '-')}`);
  const hiddenLabels = isStage
    ? [...new Set(RULE_FIELD_PATHS.filter(p => (p.startsWith('scoring.') ? p.startsWith(`scoring.${kind}.`) : true) && !shown(p)).map(fieldLabel))]
    : [];
  const value = (path: string) => displayValue(tournament, draft, activeScope, path);
  const set = (path: string, v: unknown) => onChange(setFieldValue(draft, activeScope, path, v));
  const setMany = (values: Record<string, unknown>) => onChange(setFieldValues(draft, activeScope, values));

  const scopeIssues = showIssues ? issues.filter(i => i.scope === activeScope) : [];
  const issueFor = (...paths: string[]) => scopeIssues.find(i => paths.includes(i.path));
  const issueMessage = (i: RuleIssue) => t(`admin.rulesEditor.errors.${i.code}`, i.params ?? {});
  const allIssues = showIssues ? [...issues, ...extraIssues] : [];

  const criterionName = (c: string) => t(`admin.rulesEditor.tiebreak.criteria.${c}`);
  const roundName = (n: number) => t(`admin.rulesEditor.rounds.r${n}`);
  const bestOfLabel = (max: number) => t('admin.rulesEditor.scoring.bestOfOption', { max, win: (max + 1) / 2 });

  /** 대회 값을 읽기 쉬운 말로 (덮어쓰기 표시용) */
  const formatValue = (path: string, v: unknown): string => {
    if ((v === null || v === undefined) && /\.(servesPerTurn|sideChangeAt|playersOnCourt|serveRotation)$/.test(path)) return t('admin.rulesEditor.valueAuto');
    if (v === null || v === undefined) return t('admin.rulesEditor.valueNone');
    if (Array.isArray(v)) return v.join(',');
    if (typeof v === 'boolean') return v ? t('admin.rulesEditor.valueOn') : t('admin.rulesEditor.valueOff');
    if (path.endsWith('.maxSets') || path.endsWith('.setsToWin')) {
      const max = getPath(baseEff, path.replace(/setsToWin$/, 'maxSets')) as number;
      return bestOfLabel(max);
    }
    if (path.endsWith('.minLead')) return (v as number) >= 2 ? t('admin.rulesEditor.valueOn') : t('admin.rulesEditor.valueOff');
    if (path.endsWith('.timeLimitSeconds')) return typeof v === 'number' && v > 0 ? t('admin.rulesEditor.timeLimit.minutesValue', { min: Math.round(v / 60) }) : t('admin.rulesEditor.valueNone');
    if (path === 'tiebreak.criteria') return toList<string>(v).map(criterionName).join(t('admin.rulesEditor.tiebreak.joiner'));
    if (path === 'roundScoring') {
      const r = v as { fromRound: number; individual?: { setsToWin?: number }; team?: { setsToWin?: number } };
      const win = r[kind]?.setsToWin;
      return win ? t('admin.rulesEditor.scoring.round.summary', { round: roundName(r.fromRound), max: win * 2 - 1, win }) : roundName(r.fromRound);
    }
    const enumLabels: Record<string, Record<string, string>> = {
      'tiebreak.headToHeadMode': { recursive: 'tiebreak.h2hRecursive', single_pass: 'tiebreak.h2hSingle' },
      'tiebreak.unresolved': { admin_decision: 'tiebreak.unresolvedAdmin', lot: 'tiebreak.unresolvedLot', playoff: 'tiebreak.unresolvedPlayoff' },
      'finalRanking.thirdPlace': { match: 'finalRanking.thirdMatch', joint: 'finalRanking.thirdJoint' },
      'finalRanking.fifthToEighth': { joint: 'finalRanking.joint', qualifying_record: 'finalRanking.qualifyingRecord' },
      'finalRanking.lowerPlaces': { joint: 'finalRanking.joint', qualifying_record: 'finalRanking.qualifyingRecord' },
      'retirement.mode': { keep_played: 'walkover.retirementKeep', as_walkover: 'walkover.retirementVoid', as_recorded: 'walkover.retirementRecorded' },
      [`${sp}.timeLimitUnit`]: { per_set: 'timeLimit.perSet', per_match: 'timeLimit.perMatch' },
      [`${sp}.goldenGoalMode`]: { next_point: 'timeLimit.nextPoint', goal_only: 'timeLimit.goalOnly' },
    };
    const key = enumLabels[path]?.[String(v)];
    if (key) return t(`admin.rulesEditor.${key}`);
    return String(v);
  };

  /** 스테이지에서 대회 값과 다르면 배지 + 되돌리기 버튼 */
  const renderOverride = ({ paths, focusId }: { paths: string[]; focusId: string }) => {
    if (!isStage || !paths.some(p => overridden.has(p))) return null;
    const label = fieldLabel(paths[0]);
    const baseValue = paths.map(p => formatValue(p, getPath(baseEff, p)))[0];
    return (
      <div className="flex flex-wrap items-center gap-2 mt-1">
        <span className="text-xs font-semibold text-orange-300 bg-orange-900/40 rounded px-2 py-0.5">
          {t('admin.rulesEditor.override.badge', { value: baseValue })}
        </span>
        {!paths.some(used) && (
          <span className="text-xs text-yellow-200">{t('admin.rulesEditor.override.notUsed')}</span>
        )}
        <button
          type="button"
          className="text-xs underline text-cyan-300 hover:text-cyan-200"
          onClick={() => {
            onChange(resetStagePaths(tournament, draft, activeScope, paths));
            setAnnouncement(t('admin.rulesEditor.override.resetDone', { field: label }));
            setPendingFocus(focusId);
          }}
        >
          {t('admin.rulesEditor.override.reset', { field: label })}
        </button>
      </div>
    );
  };

  const renderError = ({ issue, forId }: { issue?: RuleIssue; forId: string }) =>
    issue ? <p id={`${forId}-error`} className="text-red-400 text-sm mt-1">{issueMessage(issue)}</p> : null;

  const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;

  const renderNumber = ({ path, label, help, min, max, step }: { path: string; label: string; help?: string; min?: number; max?: number; step?: number }) => {
    if (!shown(path)) return null;
    const fid = id(path);
    const raw = value(path);
    const issue = issueFor(path);
    return (
      <div>
        <label htmlFor={fid} className="block font-semibold mb-1">{label}</label>
        <input
          id={fid}
          type="number"
          inputMode="numeric"
          className={`input w-32 ${issue ? 'border-red-500 border-2' : ''}`}
          value={typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : ''}
          min={min}
          max={max}
          step={step ?? 1}
          onChange={e => set(path, e.target.value === '' ? Number.NaN : Number(e.target.value))}
          aria-invalid={issue ? true : undefined}
          aria-describedby={describedBy(help && `${fid}-help`, issue && `${fid}-error`)}
        />
        {help && <p id={`${fid}-help`} className="text-gray-400 text-sm mt-1">{help}</p>}
        {renderError({ issue: issue, forId: fid })}
        {renderOverride({ paths: [path], focusId: fid })}
      </div>
    );
  };

  /** 비우면 기본값(자동)을 쓰는 숫자 (서브 수·사이드 체인지 점수·코트 위 선수 수). 기본값은 자리 표시와 도움말로 알린다. */
  const renderAutoNumber = ({ path, label, help, autoValue, min, max }: { path: string; label: string; help: string; autoValue: number; min: number; max: number }) => {
    if (!shown(path)) return null;
    const fid = id(path);
    const raw = value(path);
    const issue = issueFor(path);
    return (
      <div>
        <label htmlFor={fid} className="block font-semibold mb-1">{label}</label>
        <input
          id={fid}
          type="number"
          inputMode="numeric"
          className={`input w-32 ${issue ? 'border-red-500 border-2' : ''}`}
          value={typeof raw === 'number' && Number.isFinite(raw) && raw !== 0 ? String(raw) : ''}
          placeholder={t('admin.rulesEditor.scoring.autoPlaceholder', { value: autoValue })}
          min={min}
          max={max}
          step={1}
          onChange={e => set(path, e.target.value === '' ? null : Number(e.target.value))}
          aria-invalid={issue ? true : undefined}
          aria-describedby={describedBy(`${fid}-help`, issue && `${fid}-error`)}
        />
        <p id={`${fid}-help`} className="text-gray-400 text-sm mt-1">{help} {t('admin.rulesEditor.scoring.autoHelp', { value: autoValue })}</p>
        {renderError({ issue, forId: fid })}
        {renderOverride({ paths: [path], focusId: fid })}
      </div>
    );
  };

  const renderCheck = ({ path, label, help, checked, onToggle }: { path: string; label: string; help?: string; checked?: boolean; onToggle?: (v: boolean) => void }) => {
    if (!shown(path)) return null;
    const fid = id(path);
    const isChecked = checked ?? value(path) === true;
    return (
      <div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            id={fid}
            type="checkbox"
            className="mt-1 w-5 h-5"
            checked={isChecked}
            onChange={e => (onToggle ? onToggle(e.target.checked) : set(path, e.target.checked))}
            aria-describedby={help ? `${fid}-help` : undefined}
          />
          <span className="font-semibold">{label}</span>
        </label>
        {help && <p id={`${fid}-help`} className="text-gray-400 text-sm mt-1 ml-8">{help}</p>}
        {renderOverride({ paths: [path], focusId: fid })}
      </div>
    );
  };

  const renderRadios = ({ path, legend, options, current, onSelect, help, resetPaths }: {
    path: string;
    legend: string;
    options: { value: string; label: string }[];
    current: string;
    onSelect: (v: string) => void;
    help?: string;
    resetPaths?: string[];
  }) => {
    if (!shown(...(resetPaths ?? [path]))) return null;
    const gid = id(path);
    return (
      <fieldset className="space-y-2" aria-describedby={help ? `${gid}-help` : undefined}>
        <legend className="font-semibold mb-1">{legend}</legend>
        {help && <p id={`${gid}-help`} className="text-gray-400 text-sm">{help}</p>}
        {options.map((o, i) => (
          <label key={o.value} className="flex items-start gap-3 cursor-pointer">
            <input
              id={i === 0 ? gid : `${gid}-${o.value}`}
              type="radio"
              className="mt-1 w-5 h-5"
              name={gid}
              value={o.value}
              checked={current === o.value}
              onChange={() => onSelect(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
        {renderOverride({ paths: resetPaths ?? [path], focusId: gid })}
      </fieldset>
    );
  };

  // ===== 값 =====
  const scoring = eff.scoring[kind];
  const rawMaxSets = value(`${sp}.maxSets`) as number;
  const bestOfOptions = BEST_OF.includes(rawMaxSets) || !Number.isFinite(rawMaxSets) ? BEST_OF : [...BEST_OF, rawMaxSets].sort((a, b) => a - b);
  type RoundPart = { setsToWin?: number; maxSets?: number; timeLimitSeconds?: number };
  const roundRule = value('roundScoring') as { fromRound: number; individual?: RoundPart; team?: RoundPart } | null;
  const roundTimeLimit = roundRule?.[kind]?.timeLimitSeconds;
  // 시간 제한 (분 단위로 보여 준다)
  const rawTimeLimit = value(`${sp}.timeLimitSeconds`);
  // 켜짐: 양수 값, 또는 분 입력을 비운 상태(NaN — 오류로 알린다). 없음(undefined/null/0)은 꺼짐
  const timeLimitOn = typeof rawTimeLimit === 'number' && (Number.isNaN(rawTimeLimit) || rawTimeLimit > 0);
  const timeLimitMinutes = typeof rawTimeLimit === 'number' && Number.isFinite(rawTimeLimit) && rawTimeLimit > 0 ? rawTimeLimit / 60 : null;
  const ibsaScopes = ibsaTimeLimitScopes(tournament, draft);
  const roundSetsToWin = roundRule?.[kind]?.setsToWin ?? scoring.setsToWin;
  const criteria = toList<TiebreakCriterion>(value('tiebreak.criteria'));
  const remaining = availableCriteria(criteria);
  const addValue = remaining.includes(addChoice as TiebreakCriterion) ? addChoice : (remaining[0] ?? '');
  const walkoverScore = value('walkover.setScore') as number | null;
  const fifthMode = eff.finalRanking.placementMatches ? 'placement' : eff.finalRanking.fifthToEighth;

  const lastKey = eff.tiebreak.unresolved === 'lot' ? 'lastLot' : eff.tiebreak.unresolved === 'playoff' ? 'lastPlayoff' : 'lastAdmin';
  const preview = criteria.length > 0
    ? t('admin.rulesEditor.tiebreak.preview', { order: criteria.map(criterionName).join(t('admin.rulesEditor.tiebreak.joiner')), last: t(`admin.rulesEditor.tiebreak.${lastKey}`) })
    : t('admin.rulesEditor.tiebreak.previewEmpty');

  const updateCriteria = (next: TiebreakCriterion[], message: string, focusId: string | null) => {
    set('tiebreak.criteria', next);
    setAnnouncement(message);
    if (focusId) setPendingFocus(focusId);
  };

  const presetName = (pid: string) => t(RULES_PRESETS[pid]?.labelKey ?? pid);
  const appliedPreset = typeof draft.tournament.presetId === 'string' ? draft.tournament.presetId : eff.presetId;

  return (
    <div className="space-y-6">
      {allIssues.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          aria-labelledby={`${idPrefix}-error-summary-title`}
          className="card border-2 border-red-500 bg-red-900/20 p-4 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        >
          <h2 id={`${idPrefix}-error-summary-title`} className="text-lg font-bold text-red-300">
            {t('admin.rulesEditor.errors.summaryTitle', { count: allIssues.length })}
          </h2>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            {allIssues.map((issue, i) => (
              <li key={`${issue.scope}-${issue.path}-${i}`}>
                <button
                  type="button"
                  className="underline text-left text-red-200 hover:text-white"
                  onClick={() => {
                    if (issue.path !== 'confirm') setScope(issue.scope);
                    setPendingFocus(/^roundScoring\.\w+\.timeLimitSeconds$/.test(issue.path)
                      ? `${id('roundScoring')}-timelimit`
                      : id(issue.path === `${sp}.setsToWin` ? `${sp}.maxSets` : issue.path));
                  }}
                >
                  {t('admin.rulesEditor.errors.item', { scope: scopeName(issue.scope), field: fieldLabel(issue.path), message: issueMessage(issue) })}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-gray-300">{t('admin.rulesEditor.intro')}</p>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>

      {/* 설정 범위 */}
      <div className="card space-y-2">
        <label htmlFor={`${idPrefix}-scope`} className="block font-semibold text-lg">{t('admin.rulesEditor.scope.label')}</label>
        <select
          id={`${idPrefix}-scope`}
          className="input"
          value={activeScope}
          onChange={e => {
            setScope(e.target.value);
            setAnnouncement(t('admin.rulesEditor.scope.changed', { name: scopeName(e.target.value) }));
          }}
          aria-describedby={describedBy(`${idPrefix}-scope-help`, `${idPrefix}-scope-status`, hiddenLabels.length > 0 && `${idPrefix}-scope-hidden`)}
        >
          <option value={TOURNAMENT_SCOPE}>{t('admin.rulesEditor.scope.tournament')}</option>
          {stageOptions.map(s => (
            <option key={s.id} value={s.id}>{t('admin.rulesEditor.scope.stage', { name: s.label })}</option>
          ))}
        </select>
        <p id={`${idPrefix}-scope-help`} className="text-gray-400 text-sm">{t('admin.rulesEditor.scope.help')}</p>
        <p id={`${idPrefix}-scope-status`} className="text-sm text-cyan-300">
          {isStage
            ? (overridden.size > 0 ? t('admin.rulesEditor.scope.overrideCount', { count: overridden.size }) : t('admin.rulesEditor.scope.noOverride'))
            : t('admin.rulesEditor.preset.current', { name: presetName(appliedPreset) })}
        </p>
        {hiddenLabels.length > 0 && (
          <p id={`${idPrefix}-scope-hidden`} className="text-sm text-gray-300">
            {t('admin.rulesEditor.scope.hiddenNote', { fields: hiddenLabels.join(t('admin.rulesEditor.listJoiner')) })}
          </p>
        )}
      </div>

      {/* 프리셋 (대회 전체만) */}
      {!isStage && (
        <fieldset className="card space-y-3" aria-describedby={`${idPrefix}-preset-note`}>
          <legend className="text-xl font-bold">{t('admin.rulesEditor.preset.legend')}</legend>
          <p id={`${idPrefix}-preset-note`} className="text-yellow-200 text-sm bg-yellow-900/30 rounded p-2">{t('admin.rulesEditor.preset.note')}</p>
          {RULES_PRESET_ORDER.map(pid => (
            <label key={pid} className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                className="mt-1 w-5 h-5"
                name={`${idPrefix}-preset`}
                value={pid}
                checked={presetChoice === pid}
                onChange={() => setPresetChoice(pid)}
                aria-describedby={`${idPrefix}-preset-${pid}-desc`}
              />
              <span>
                <span className="font-semibold block">{presetName(pid)}</span>
                <span id={`${idPrefix}-preset-${pid}-desc`} className="text-gray-400 text-sm">{t(`admin.rulesEditor.preset.descriptions.${pid}`)}</span>
              </span>
            </label>
          ))}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              onChange(applyPreset(draft, presetChoice));
              setAnnouncement(t('admin.rulesEditor.preset.applied', { name: presetName(presetChoice) }));
            }}
          >
            {t('admin.rulesEditor.preset.apply')}
          </button>
        </fieldset>
      )}

      {/* 점수·세트 */}
      <fieldset className="card space-y-4">
        <legend className="text-xl font-bold">{t('admin.rulesEditor.scoring.legend')}</legend>
        <p className="text-cyan-300 font-semibold">{kind === 'team' ? t('admin.rulesEditor.scoring.kindTeam') : t('admin.rulesEditor.scoring.kindIndividual')}</p>
        {renderNumber({ path: `${sp}.winScore`, label: t('admin.rulesEditor.scoring.winScore'), help: t('admin.rulesEditor.scoring.winScoreHelp'), min: 1, max: 99 })}
        <div>
          <label htmlFor={id(`${sp}.maxSets`)} className="block font-semibold mb-1">{t('admin.rulesEditor.scoring.bestOf')}</label>
          <select
            id={id(`${sp}.maxSets`)}
            className={`input ${issueFor(`${sp}.maxSets`, `${sp}.setsToWin`) ? 'border-red-500 border-2' : ''}`}
            value={Number.isFinite(rawMaxSets) ? rawMaxSets : scoring.maxSets}
            onChange={e => {
              const max = Number(e.target.value);
              setMany({ [`${sp}.maxSets`]: max, [`${sp}.setsToWin`]: Math.ceil(max / 2) });
            }}
            aria-invalid={issueFor(`${sp}.maxSets`, `${sp}.setsToWin`) ? true : undefined}
            aria-describedby={issueFor(`${sp}.maxSets`, `${sp}.setsToWin`) ? `${id(`${sp}.maxSets`)}-error` : undefined}
          >
            {bestOfOptions.map(n => (
              <option key={n} value={n}>{n % 2 === 1 ? bestOfLabel(n) : String(n)}</option>
            ))}
          </select>
          {renderError({ issue: issueFor(`${sp}.maxSets`, `${sp}.setsToWin`), forId: id(`${sp}.maxSets`) })}
          {renderOverride({ paths: [`${sp}.maxSets`, `${sp}.setsToWin`], focusId: id(`${sp}.maxSets`) })}
        </div>
        {renderCheck({
          path: `${sp}.minLead`,
          label: t('admin.rulesEditor.scoring.winBy2'),
          help: t('admin.rulesEditor.scoring.winBy2Help'),
          checked: (value(`${sp}.minLead`) as number) >= 2,
          onToggle: v => set(`${sp}.minLead`, v ? 2 : 1),
        })}
        {renderAutoNumber({
          path: `${sp}.servesPerTurn`,
          label: t('admin.rulesEditor.scoring.servesPerTurn'),
          help: t('admin.rulesEditor.scoring.servesPerTurnHelp'),
          autoValue: DEFAULT_SERVES_PER_TURN[kind],
          min: 1, max: 10,
        })}
        {renderAutoNumber({
          path: `${sp}.sideChangeAt`,
          label: t('admin.rulesEditor.scoring.sideChangeAt'),
          help: t('admin.rulesEditor.scoring.sideChangeAtHelp'),
          autoValue: defaultSideChangePoint(scoring.winScore),
          min: 1, max: Math.max(1, scoring.winScore - 1),
        })}
        {kind === 'team' && renderAutoNumber({
          path: 'scoring.team.playersOnCourt',
          label: t('admin.rulesEditor.scoring.playersOnCourt'),
          help: t('admin.rulesEditor.scoring.playersOnCourtHelp'),
          autoValue: DEFAULT_PLAYERS_ON_COURT,
          min: 1, max: 9,
        })}
        {kind === 'team' && shown('scoring.team.serveRotation') && (
          <RotationField
            fid={id('scoring.team.serveRotation')}
            label={t('admin.rulesEditor.scoring.serveRotation')}
            help={t('admin.rulesEditor.scoring.serveRotationHelp', { example: defaultServeRotation(scoring.playersOnCourt ?? DEFAULT_PLAYERS_ON_COURT).join(',') })}
            placeholder={defaultServeRotation(scoring.playersOnCourt ?? DEFAULT_PLAYERS_ON_COURT).join(',')}
            value={toList<string>(value('scoring.team.serveRotation')).join(',')}
            onCommit={tokens => set('scoring.team.serveRotation', tokens.length > 0 ? tokens : null)}
            error={renderError({ issue: issueFor('scoring.team.serveRotation'), forId: id('scoring.team.serveRotation') })}
            invalid={!!issueFor('scoring.team.serveRotation')}
            override={renderOverride({ paths: ['scoring.team.serveRotation'], focusId: id('scoring.team.serveRotation') })}
          />
        )}

        {/* 라운드별 세트 수 */}
        <div className="border-t border-gray-700 pt-4 space-y-3">
          {renderCheck({ path: "roundScoring", label: t('admin.rulesEditor.scoring.round.toggle'), help: t('admin.rulesEditor.scoring.round.help'), checked: !!roundRule, onToggle: on => set('roundScoring', on
              ? { fromRound: 4, [kind]: { setsToWin: Math.min(4, scoring.setsToWin + 1), maxSets: Math.min(4, scoring.setsToWin + 1) * 2 - 1 } }
              : null) })}
          {roundRule && (
            <div className="ml-8 space-y-3">
              <div>
                <label htmlFor={`${id('roundScoring')}-from`} className="block font-semibold mb-1">{t('admin.rulesEditor.scoring.round.from')}</label>
                <select
                  id={`${id('roundScoring')}-from`}
                  className={`input ${issueFor('roundScoring') ? 'border-red-500 border-2' : ''}`}
                  value={ROUND_SIZES.includes(roundRule.fromRound) ? roundRule.fromRound : ''}
                  onChange={e => set('roundScoring', { ...roundRule, fromRound: Number(e.target.value) })}
                  aria-invalid={issueFor('roundScoring') ? true : undefined}
                  aria-describedby={issueFor('roundScoring') ? `${id('roundScoring')}-error` : undefined}
                >
                  {!ROUND_SIZES.includes(roundRule.fromRound) && <option value="">—</option>}
                  {ROUND_SIZES.map(n => <option key={n} value={n}>{roundName(n)}</option>)}
                </select>
                {renderError({ issue: issueFor('roundScoring'), forId: id('roundScoring') })}
              </div>
              <div>
                <label htmlFor={`${id('roundScoring')}-bestof`} className="block font-semibold mb-1">{t('admin.rulesEditor.scoring.round.bestOf')}</label>
                <select
                  id={`${id('roundScoring')}-bestof`}
                  className="input"
                  value={roundSetsToWin * 2 - 1}
                  onChange={e => {
                    const max = Number(e.target.value);
                    set('roundScoring', { ...roundRule, [kind]: { ...roundRule[kind], setsToWin: Math.ceil(max / 2), maxSets: max } });
                  }}
                >
                  {BEST_OF.map(n => <option key={n} value={n}>{bestOfLabel(n)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${id('roundScoring')}-timelimit`} className="block font-semibold mb-1">{t('admin.rulesEditor.timeLimit.roundLabel')}</label>
                <input
                  id={`${id('roundScoring')}-timelimit`}
                  type="number"
                  inputMode="numeric"
                  className={`input w-32 ${issueFor(`roundScoring.${kind}.timeLimitSeconds`) ? 'border-red-500 border-2' : ''}`}
                  min={0}
                  max={MAX_TIME_LIMIT_SECONDS / 60}
                  step={1}
                  value={typeof roundTimeLimit === 'number' && Number.isFinite(roundTimeLimit) ? String(roundTimeLimit / 60) : ''}
                  onChange={e => {
                    const part: RoundPart = { ...roundRule[kind] };
                    if (e.target.value === '') delete part.timeLimitSeconds;
                    else part.timeLimitSeconds = Math.round(Number(e.target.value) * 60);
                    set('roundScoring', { ...roundRule, [kind]: part });
                  }}
                  aria-invalid={issueFor(`roundScoring.${kind}.timeLimitSeconds`) ? true : undefined}
                  aria-describedby={describedBy(`${id('roundScoring')}-timelimit-help`, issueFor(`roundScoring.${kind}.timeLimitSeconds`) && `${id('roundScoring')}-timelimit-error`)}
                />
                <p id={`${id('roundScoring')}-timelimit-help`} className="text-gray-400 text-sm mt-1">{t('admin.rulesEditor.timeLimit.roundHelp')}</p>
                {renderError({ issue: issueFor(`roundScoring.${kind}.timeLimitSeconds`), forId: `${id('roundScoring')}-timelimit` })}
              </div>
            </div>
          )}
        </div>
      </fieldset>

      {/* 시간 제한·골든골 (M0f) */}
      <fieldset className="card space-y-4" aria-describedby={`${idPrefix}-timelimit-help`}>
        <legend className="text-xl font-bold">{t('admin.rulesEditor.timeLimit.legend')}</legend>
        <p id={`${idPrefix}-timelimit-help`} className="text-gray-400 text-sm">{t('admin.rulesEditor.timeLimit.help')}</p>
        {ibsaScopes.length > 0 && (
          <p role="status" className="text-yellow-100 bg-yellow-900/50 border border-yellow-500 rounded p-3 font-semibold">
            <span aria-hidden="true">⚠️ </span>{t('admin.rulesEditor.timeLimit.ibsaWarning', { scopes: ibsaScopes.map(scopeName).join(t('admin.rulesEditor.listJoiner')) })}
          </p>
        )}
        {shown(`${sp}.timeLimitSeconds`) && (
          <div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                id={`${id(`${sp}.timeLimitSeconds`)}-toggle`}
                type="checkbox"
                className="mt-1 w-5 h-5"
                checked={timeLimitOn}
                onChange={e => set(`${sp}.timeLimitSeconds`, e.target.checked ? 30 * 60 : null)}
              />
              <span className="font-semibold">{t('admin.rulesEditor.timeLimit.toggle')}</span>
            </label>
            {timeLimitOn && (
              <div className="ml-8 mt-3">
                <label htmlFor={id(`${sp}.timeLimitSeconds`)} className="block font-semibold mb-1">{t('admin.rulesEditor.timeLimit.minutes')}</label>
                <input
                  id={id(`${sp}.timeLimitSeconds`)}
                  type="number"
                  inputMode="numeric"
                  className={`input w-32 ${issueFor(`${sp}.timeLimitSeconds`) ? 'border-red-500 border-2' : ''}`}
                  min={1}
                  max={MAX_TIME_LIMIT_SECONDS / 60}
                  step={1}
                  value={timeLimitMinutes !== null ? String(timeLimitMinutes) : ''}
                  onChange={e => set(`${sp}.timeLimitSeconds`, e.target.value === '' ? Number.NaN : Math.round(Number(e.target.value) * 60))}
                  aria-invalid={issueFor(`${sp}.timeLimitSeconds`) ? true : undefined}
                  aria-describedby={describedBy(`${id(`${sp}.timeLimitSeconds`)}-help`, issueFor(`${sp}.timeLimitSeconds`) && `${id(`${sp}.timeLimitSeconds`)}-error`)}
                />
                <p id={`${id(`${sp}.timeLimitSeconds`)}-help`} className="text-gray-400 text-sm mt-1">{t('admin.rulesEditor.timeLimit.minutesHelp')}</p>
                {renderError({ issue: issueFor(`${sp}.timeLimitSeconds`), forId: id(`${sp}.timeLimitSeconds`) })}
              </div>
            )}
            {renderOverride({ paths: [`${sp}.timeLimitSeconds`], focusId: `${id(`${sp}.timeLimitSeconds`)}-toggle` })}
          </div>
        )}
        {timeLimitOn && renderRadios({
          path: `${sp}.timeLimitUnit`,
          legend: t('admin.rulesEditor.timeLimit.unitLegend'),
          help: t('admin.rulesEditor.timeLimit.unitHelp'),
          current: scoring.timeLimitUnit ?? 'per_match',
          options: [
            { value: 'per_set', label: t('admin.rulesEditor.timeLimit.perSet') },
            { value: 'per_match', label: t('admin.rulesEditor.timeLimit.perMatch') },
          ],
          onSelect: v => set(`${sp}.timeLimitUnit`, v),
        })}
        {timeLimitOn && renderRadios({
          path: `${sp}.goldenGoalMode`,
          legend: t('admin.rulesEditor.timeLimit.goldenLegend'),
          help: t('admin.rulesEditor.timeLimit.goldenHelp'),
          current: scoring.goldenGoalMode ?? 'next_point',
          options: [
            { value: 'next_point', label: t('admin.rulesEditor.timeLimit.nextPoint') },
            { value: 'goal_only', label: t('admin.rulesEditor.timeLimit.goalOnly') },
          ],
          onSelect: v => set(`${sp}.goldenGoalMode`, v),
        })}
        {renderCheck({
          path: 'ibsaSanctioned',
          label: t('admin.rulesEditor.timeLimit.ibsa'),
          help: t('admin.rulesEditor.timeLimit.ibsaHelp'),
        })}
      </fieldset>

      {/* 승점 */}
      {shown('standingsPoints.win', 'standingsPoints.draw', 'standingsPoints.loss', 'standingsPoints.walkoverWin', 'standingsPoints.forfeitLoss') && (
      <fieldset className="card space-y-4" aria-describedby={`${idPrefix}-standings-help`}>
        <legend className="text-xl font-bold">{t('admin.rulesEditor.standings.legend')}</legend>
        <p id={`${idPrefix}-standings-help`} className="text-gray-400 text-sm">{t('admin.rulesEditor.standings.help')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(['win', 'draw', 'loss', 'walkoverWin', 'forfeitLoss'] as const).map(k => (
            shown(`standingsPoints.${k}`) && <div key={k}>{renderNumber({ path: `standingsPoints.${k}`, label: t(`admin.rulesEditor.standings.${k}`), min: -99, max: 99, step: 0.5 })}</div>
          ))}
        </div>
      </fieldset>
      )}

      {/* 부전승·기권 */}
      <fieldset className="card space-y-4" aria-describedby={`${idPrefix}-walkover-help`}>
        <legend className="text-xl font-bold">{t('admin.rulesEditor.walkover.legend')}</legend>
        <p id={`${idPrefix}-walkover-help`} className="text-gray-300 text-sm bg-gray-800 rounded p-3">{t('admin.rulesEditor.walkover.help')}</p>
        {renderRadios({ path: "walkover.setScore", legend: t('admin.rulesEditor.walkover.scoreLegend'), current: walkoverScore === null ? 'target' : 'custom', options: [
            { value: 'target', label: t('admin.rulesEditor.walkover.scoreTarget') },
            { value: 'custom', label: t('admin.rulesEditor.walkover.scoreCustom') },
          ], onSelect: v => {
            set('walkover.setScore', v === 'target' ? null : scoring.winScore);
            if (v === 'custom') setPendingFocus(`${id('walkover.setScore')}-value`);
          } })}
        {walkoverScore !== null && (
          <div className="ml-8">
            <label htmlFor={`${id('walkover.setScore')}-value`} className="block font-semibold mb-1">{t('admin.rulesEditor.walkover.scoreValue')}</label>
            <input
              id={`${id('walkover.setScore')}-value`}
              type="number"
              inputMode="numeric"
              className={`input w-32 ${issueFor('walkover.setScore') ? 'border-red-500 border-2' : ''}`}
              min={1}
              max={99}
              value={Number.isFinite(walkoverScore) ? String(walkoverScore) : ''}
              onChange={e => set('walkover.setScore', e.target.value === '' ? Number.NaN : Number(e.target.value))}
              aria-invalid={issueFor('walkover.setScore') ? true : undefined}
              aria-describedby={issueFor('walkover.setScore') ? `${id('walkover.setScore')}-error` : undefined}
            />
            {renderError({ issue: issueFor('walkover.setScore'), forId: id('walkover.setScore') })}
          </div>
        )}
        {renderCheck({ path: "walkover.countInStandings", label: t('admin.rulesEditor.walkover.countInStandings') })}
        {renderCheck({ path: "walkover.countInPlayerStats", label: t('admin.rulesEditor.walkover.countInPlayerStats') })}
        {renderCheck({ path: "walkover.byeCountsAsWalkover", label: t('admin.rulesEditor.walkover.byeCountsAsWalkover') })}
        {renderRadios({ path: "retirement.mode", legend: t('admin.rulesEditor.walkover.retirementLegend'), current: eff.retirement.mode, options: [
            { value: 'keep_played', label: t('admin.rulesEditor.walkover.retirementKeep') },
            { value: 'as_walkover', label: t('admin.rulesEditor.walkover.retirementVoid') },
            { value: 'as_recorded', label: t('admin.rulesEditor.walkover.retirementRecorded') },
          ], onSelect: v => set('retirement.mode', v) })}
      </fieldset>

      {/* 동률 기준 */}
      {shown('tiebreak.criteria', 'tiebreak.headToHeadMode', 'tiebreak.unresolved') && (
      <fieldset className="card space-y-4" aria-describedby={`${idPrefix}-tiebreak-help ${idPrefix}-tiebreak-preview`}>
        <legend className="text-xl font-bold">{t('admin.rulesEditor.tiebreak.legend')}</legend>
        <p id={`${idPrefix}-tiebreak-help`} className="text-gray-400 text-sm">{t('admin.rulesEditor.tiebreak.help')}</p>
        <p id={`${idPrefix}-tiebreak-preview`} className="text-cyan-200 bg-gray-800 rounded p-3">{preview}</p>
        {criteria.length === 0 ? (
          <p id={id('tiebreak.criteria')} tabIndex={-1} className="text-red-400">{t('admin.rulesEditor.tiebreak.none')}</p>
        ) : (
          <ol id={id('tiebreak.criteria')} tabIndex={-1} aria-label={t('admin.rulesEditor.tiebreak.listLabel')} className="space-y-2 focus:outline-none">
            {criteria.map((c, i) => {
              const name = criterionName(c);
              const upId = `${idPrefix}-tb-${c}-up`;
              const downId = `${idPrefix}-tb-${c}-down`;
              return (
                <li key={c} className="flex flex-wrap items-center gap-2 bg-gray-800 rounded px-3 py-2">
                  <span className="flex-1 min-w-[10rem]">
                    <span className="text-gray-400 mr-2">{t('admin.rulesEditor.tiebreak.position', { pos: i + 1 })}</span>
                    <span className="font-semibold">{name}</span>
                  </span>
                  <button
                    id={upId}
                    type="button"
                    className="btn bg-gray-700 text-white text-sm px-3 py-1"
                    disabled={i === 0}
                    aria-label={t('admin.rulesEditor.tiebreak.moveUp', { name })}
                    onClick={() => updateCriteria(moveItem(criteria, i, -1), t('admin.rulesEditor.tiebreak.moved', { name, pos: i }), i - 1 === 0 ? downId : upId)}
                  >
                    <span aria-hidden="true">▲</span>
                  </button>
                  <button
                    id={downId}
                    type="button"
                    className="btn bg-gray-700 text-white text-sm px-3 py-1"
                    disabled={i === criteria.length - 1}
                    aria-label={t('admin.rulesEditor.tiebreak.moveDown', { name })}
                    onClick={() => updateCriteria(moveItem(criteria, i, 1), t('admin.rulesEditor.tiebreak.moved', { name, pos: i + 2 }), i + 1 === criteria.length - 1 ? upId : downId)}
                  >
                    <span aria-hidden="true">▼</span>
                  </button>
                  <button
                    type="button"
                    className="btn bg-red-800 text-white text-sm px-3 py-1"
                    aria-label={t('admin.rulesEditor.tiebreak.remove', { name })}
                    onClick={() => updateCriteria(removeItem(criteria, i), t('admin.rulesEditor.tiebreak.removed', { name, count: criteria.length - 1 }), `${idPrefix}-tb-add-select`)}
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {renderError({ issue: issueFor('tiebreak.criteria'), forId: id('tiebreak.criteria') })}
        {renderOverride({ paths: ['tiebreak.criteria'], focusId: id('tiebreak.criteria') })}
        {remaining.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor={`${idPrefix}-tb-add-select`} className="block text-sm font-semibold mb-1">{t('admin.rulesEditor.tiebreak.addSelect')}</label>
              <select id={`${idPrefix}-tb-add-select`} className="input" value={addValue} onChange={e => setAddChoice(e.target.value)}>
                {remaining.map(c => <option key={c} value={c}>{criterionName(c)}</option>)}
              </select>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (!addValue) return;
                const next = addCriterion(criteria, addValue as TiebreakCriterion);
                updateCriteria(next, t('admin.rulesEditor.tiebreak.added', { name: criterionName(addValue), pos: next.length }), null);
              }}
            >
              {t('admin.rulesEditor.tiebreak.addButton')}
            </button>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">{t('admin.rulesEditor.tiebreak.allAdded')}</p>
        )}
        {renderRadios({ path: "tiebreak.headToHeadMode", legend: t('admin.rulesEditor.tiebreak.h2hLegend'), current: eff.tiebreak.headToHeadMode, options: [
            { value: 'recursive', label: t('admin.rulesEditor.tiebreak.h2hRecursive') },
            { value: 'single_pass', label: t('admin.rulesEditor.tiebreak.h2hSingle') },
          ], onSelect: v => set('tiebreak.headToHeadMode', v) })}
        {renderRadios({ path: "tiebreak.unresolved", legend: t('admin.rulesEditor.tiebreak.unresolvedLegend'), current: eff.tiebreak.unresolved, options: [
            { value: 'admin_decision', label: t('admin.rulesEditor.tiebreak.unresolvedAdmin') },
            { value: 'lot', label: t('admin.rulesEditor.tiebreak.unresolvedLot') },
            { value: 'playoff', label: t('admin.rulesEditor.tiebreak.unresolvedPlayoff') },
          ], onSelect: v => set('tiebreak.unresolved', v) })}
      </fieldset>
      )}

      {/* 최종 순위 */}
      {shown('finalRanking.thirdPlace', 'finalRanking.fifthToEighth', 'finalRanking.placementMatches', 'finalRanking.lowerPlaces', 'finalRanking.rankingUpTo') && (
      <fieldset className="card space-y-4">
        <legend className="text-xl font-bold">{t('admin.rulesEditor.finalRanking.legend')}</legend>
        {renderRadios({ path: "finalRanking.thirdPlace", legend: t('admin.rulesEditor.finalRanking.thirdLegend'), current: eff.finalRanking.thirdPlace, options: [
            { value: 'match', label: t('admin.rulesEditor.finalRanking.thirdMatch') },
            { value: 'joint', label: t('admin.rulesEditor.finalRanking.thirdJoint') },
          ], onSelect: v => set('finalRanking.thirdPlace', v) })}
        {renderRadios({ path: "finalRanking.fifthToEighth", legend: t('admin.rulesEditor.finalRanking.fifthLegend'), current: fifthMode, options: [
            { value: 'joint', label: t('admin.rulesEditor.finalRanking.joint') },
            { value: 'qualifying_record', label: t('admin.rulesEditor.finalRanking.qualifyingRecord') },
            { value: 'placement', label: t('admin.rulesEditor.finalRanking.placementMatches') },
          ], onSelect: v => setMany(v === 'placement'
            ? { 'finalRanking.placementMatches': true }
            : { 'finalRanking.placementMatches': false, 'finalRanking.fifthToEighth': v }), resetPaths: ['finalRanking.fifthToEighth', 'finalRanking.placementMatches'] })}
        {renderRadios({ path: "finalRanking.lowerPlaces", legend: t('admin.rulesEditor.finalRanking.lowerLegend'), current: eff.finalRanking.lowerPlaces, options: [
            { value: 'joint', label: t('admin.rulesEditor.finalRanking.joint') },
            { value: 'qualifying_record', label: t('admin.rulesEditor.finalRanking.qualifyingRecord') },
          ], onSelect: v => set('finalRanking.lowerPlaces', v) })}
        {renderNumber({ path: "finalRanking.rankingUpTo", label: t('admin.rulesEditor.finalRanking.rankingUpTo'), help: t('admin.rulesEditor.finalRanking.rankingUpToHelp'), min: 0, max: 512 })}
      </fieldset>
      )}

      {/* 본선 진출 */}
      {shown('qualification.perGroup', 'qualification.wildcards', 'qualification.avoidSameGroupFirstRound') && (
      <fieldset className="card space-y-4">
        <legend className="text-xl font-bold">{t('admin.rulesEditor.qualification.legend')}</legend>
        {renderNumber({ path: "qualification.perGroup", label: t('admin.rulesEditor.qualification.perGroup'), min: 1, max: 64 })}
        {renderNumber({ path: "qualification.wildcards", label: t('admin.rulesEditor.qualification.wildcards'), help: t('admin.rulesEditor.qualification.wildcardsHelp'), min: 0, max: 64 })}
        {renderCheck({ path: "qualification.avoidSameGroupFirstRound", label: t('admin.rulesEditor.qualification.avoidSameGroup') })}
      </fieldset>
      )}

      {/* 휴식 */}
      <fieldset className="card space-y-4">
        <legend className="text-xl font-bold">{t('admin.rulesEditor.schedule.legend')}</legend>
        {renderNumber({ path: "schedule.minRestMinutes", label: t('admin.rulesEditor.schedule.minRest'), help: t('admin.rulesEditor.schedule.minRestHelp'), min: 0, max: 600 })}
      </fieldset>

      {footer}
    </div>
  );
}

/**
 * 단체전 서브 순서 입력 (예: A1,B1,A2,B2,A3,B3). 입력 중에는 글자를 그대로 두고, 바뀔 때마다 토큰 목록으로 저장한다.
 * 비우면 기본 순서. 잘못된 순서는 검증 오류로 알린다(aria-invalid + 오류 문장).
 */
function RotationField({ fid, label, help, placeholder, value, onCommit, error, invalid, override }: {
  fid: string;
  label: string;
  help: string;
  placeholder: string;
  value: string;
  onCommit: (tokens: string[]) => void;
  error: ReactNode;
  invalid: boolean;
  override: ReactNode;
}) {
  const [text, setText] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  // 바깥 값이 바뀌면(범위 전환·되돌리기) 입력란도 맞춘다 (입력 중인 글자와 같은 값이면 그대로 둔다)
  if (value !== prevValue) {
    setPrevValue(value);
    if (tokensOf(text).join(',') !== value) setText(value);
  }
  return (
    <div>
      <label htmlFor={fid} className="block font-semibold mb-1">{label}</label>
      <input
        id={fid}
        type="text"
        className={`input w-full max-w-md ${invalid ? 'border-red-500 border-2' : ''}`}
        value={text}
        placeholder={placeholder}
        autoCapitalize="characters"
        spellCheck={false}
        onChange={e => { setText(e.target.value); onCommit(tokensOf(e.target.value)); }}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={`${fid}-help${invalid ? ` ${fid}-error` : ''}`}
      />
      <p id={`${fid}-help`} className="text-gray-400 text-sm mt-1">{help}</p>
      {error}
      {override}
    </div>
  );
}

function tokensOf(text: string): string[] {
  return text.split(/[\s,]+/).map(x => x.trim().toUpperCase()).filter(Boolean);
}
