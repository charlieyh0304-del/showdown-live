import { useState, useCallback, useReducer, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTournaments } from '@shared/hooks/useFirebase';
import { WIZARD_PRESETS } from '@shared/constants/presets';
import StepIndicator from '../components/tournament-create/StepIndicator';
import WizardStep4Finals from '../components/tournament-create/WizardStep4Finals';
import WizardStep5Preview from '../components/tournament-create/WizardStep5Preview';
import WizardStepRules from '../components/tournament-create/WizardStepRules';
import Step1BasicInfo from '../components/tournament-create/Step1BasicInfo';
import Step2Participants from '../components/tournament-create/Step2Participants';
import {
  WIZARD_STAGE_KEYS,
  WIZARD_STEP,
  WIZARD_TOTAL_STEPS,
  buildTournamentFromWizard,
  createDefaultState,
  wizardReducer,
  type Action,
} from '../components/tournament-create/wizardModel';
import { TOURNAMENT_SCOPE, validateDraft, type RuleIssue } from '../components/rules/rulesEditorModel';

// ===== Component =====

export default function TournamentCreate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addTournament } = useTournaments();
  const [state, dispatch] = useReducer(wizardReducer, undefined, () => createDefaultState());
  const [saving, setSaving] = useState(false);
  // 이중 제출 방지: 렌더 전에 두 번 눌러도 한 번만 저장한다
  const submittingRef = useRef(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [rulesShowIssues, setRulesShowIssues] = useState(false);
  const rulesSummaryRef = useRef<HTMLDivElement>(null);

  const stepLabels = [
    t('admin.tournamentCreate.stepLabels.basicInfo'),
    t('admin.tournamentCreate.stepLabels.participants'),
    t('admin.tournamentCreate.stepLabels.format'),
    t('admin.tournamentCreate.stepLabels.rules'),
    t('admin.tournamentCreate.stepLabels.preview'),
  ];
  const stepRef = useRef<HTMLDivElement>(null);

  // 규칙 편집기의 바탕 문서(규칙 초안 제외)와 저장될 문서(미리보기)
  const rulesBase = useMemo(
    () => buildTournamentFromWizard(state, { now: 0, stageIds: WIZARD_STAGE_KEYS, includeRules: false }),
    [state],
  );
  const savedPreview = useMemo(() => buildTournamentFromWizard(state, { now: 0, stageIds: WIZARD_STAGE_KEYS }), [state]);

  const rulesIssues = useMemo((): RuleIssue[] => validateDraft(rulesBase, state.rulesDraft), [rulesBase, state.rulesDraft]);
  const confirmIssue: RuleIssue[] = state.rulesConfirmed ? [] : [{ scope: TOURNAMENT_SCOPE, path: 'confirm', code: 'confirmRequired' }];

  const validateStep = useCallback((step: number): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (step === WIZARD_STEP.basicInfo) {
      if (!state.name.trim()) {
        errors.name = t('admin.tournamentCreate.basicInfo.tournamentNameRequired');
      }
    }
    return errors;
  }, [state, t]);

  /** 규칙 단계 검사: 문제가 있으면 오류 요약을 보이고 초점을 옮긴다 */
  const rulesStepBlocked = useCallback((): boolean => {
    if (rulesIssues.length === 0 && state.rulesConfirmed) return false;
    setRulesShowIssues(true);
    requestAnimationFrame(() => rulesSummaryRef.current?.focus());
    return true;
  }, [rulesIssues.length, state.rulesConfirmed]);

  const tryAdvanceStep = useCallback((targetAction: Action) => {
    const errors = validateStep(state.step);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const firstErrorField = Object.keys(errors)[0];
      const el = document.getElementById(firstErrorField);
      el?.focus();
      return;
    }
    if (state.step === WIZARD_STEP.rules && rulesStepBlocked()) return;
    setFieldErrors({});
    setRulesShowIssues(false);
    dispatch(targetAction);
  }, [state.step, validateStep, rulesStepBlocked]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    stepRef.current?.focus();
  }, [state.step]);

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) return;
    if (!state.name.trim()) {
      setError(t('admin.tournamentCreate.basicInfo.tournamentNameRequired'));
      return;
    }
    if (rulesIssues.length > 0 || !state.rulesConfirmed) {
      // 규칙을 확인하지 않았거나 고칠 값이 있으면 규칙 단계로 돌아간다
      dispatch({ type: 'GO_TO_STEP', step: WIZARD_STEP.rules });
      setRulesShowIssues(true);
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const id = await addTournament(buildTournamentFromWizard(state));
      if (id) navigate(`/admin/tournament/${id}`);
    } catch (err) {
      console.error('대회 생성 오류:', err);
      setError(t('common.error.tournamentCreateFailed'));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }, [state, addTournament, navigate, t, rulesIssues.length]);

  const filteredPresets = WIZARD_PRESETS.filter(p => p.type === state.type);

  return (
    <div className="max-w-2xl mx-auto space-y-6" ref={stepRef} tabIndex={-1} style={{ outline: 'none' }}>
      <h1 className="text-3xl font-bold text-yellow-400 text-center">{t('admin.tournamentCreate.title')}</h1>
      <StepIndicator currentStep={state.step} totalSteps={WIZARD_TOTAL_STEPS} labels={stepLabels} />

      {/* Step 1: 기본 정보 */}
      {state.step === WIZARD_STEP.basicInfo && (
        <Step1BasicInfo
          state={state}
          dispatch={dispatch}
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          filteredPresets={filteredPresets}
          validateStep={validateStep}
          tryAdvanceStep={tryAdvanceStep}
        />
      )}

      {/* Step 2: 참가자 설정 */}
      {state.step === WIZARD_STEP.participants && (
        <Step2Participants state={state} dispatch={dispatch} />
      )}

      {/* Step 3: 대회 형식 */}
      {state.step === WIZARD_STEP.format && (
        <WizardStep4Finals state={state} dispatch={dispatch} />
      )}

      {/* Step 4: 경기 규칙 */}
      {state.step === WIZARD_STEP.rules && (
        <WizardStepRules
          state={state}
          dispatch={dispatch}
          base={rulesBase}
          issues={rulesIssues}
          extraIssues={confirmIssue}
          showIssues={rulesShowIssues}
          summaryRef={rulesSummaryRef}
        />
      )}

      {/* Step 5: 미리보기 (저장될 문서에서 읽는다) */}
      {state.step === WIZARD_STEP.preview && (
        <WizardStep5Preview state={state} doc={savedPreview} dispatch={dispatch} onSubmit={handleSubmit} saving={saving} />
      )}

      {/* Navigation */}
      {error && <p className="text-red-500 font-semibold" role="alert">{error}</p>}
      <div className="flex gap-4">
        {state.step > 1 && (
          <button
            className="btn btn-secondary flex-1"
            onClick={() => dispatch({ type: 'PREV_STEP' })}
            aria-label={t('common.back')}
          >
            {t('common.previous')}
          </button>
        )}
        {state.step < WIZARD_TOTAL_STEPS ? (
          <button
            className="btn btn-primary flex-1"
            onClick={() => tryAdvanceStep({ type: 'NEXT_STEP' })}
            aria-label={t('common.next')}
          >
            {t('common.next')}
          </button>
        ) : (
          <button
            className="btn btn-success flex-1"
            onClick={handleSubmit}
            disabled={saving}
            aria-label={t('admin.preview.createTournament')}
          >
            {saving ? t('common.creating') : t('admin.preview.createTournament')}
          </button>
        )}
        <button className="btn btn-accent" onClick={() => navigate('/admin')} aria-label={t('common.cancel')}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
