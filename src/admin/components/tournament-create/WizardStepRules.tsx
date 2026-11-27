import { useMemo, type Dispatch, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import CompetitionRulesEditor, { type RulesStageOption } from '../rules/CompetitionRulesEditor';
import { fieldDomId, type RuleIssue } from '../rules/rulesEditorModel';
import type { Action, NewTournament, WizardState } from './wizardModel';

interface WizardStepRulesProps {
  state: WizardState;
  dispatch: Dispatch<Action>;
  /** 규칙 초안을 얹을 바탕 문서 (앞 단계 설정으로 만든 저장 전 대회, 스테이지 ID는 WIZARD_STAGE_KEYS) */
  base: NewTournament;
  issues: RuleIssue[];
  extraIssues: RuleIssue[];
  showIssues: boolean;
  summaryRef: Ref<HTMLDivElement>;
}

const ID_PREFIX = 'wizard-rules';

/**
 * 마법사 '경기 규칙' 단계: 프리셋에서 시작해 모든 규칙을 보여 주고, 관리자가 확인해야 다음 단계로 넘어간다.
 */
export default function WizardStepRules({ state, dispatch, base, issues, extraIssues, showIssues, summaryRef }: WizardStepRulesProps) {
  const { t } = useTranslation();

  const stageOptions: RulesStageOption[] = useMemo(() => (base.stages ?? []).map(s => ({
    id: s.id,
    type: s.type,
    label: s.type === 'qualifying'
      ? t('admin.rulesEditor.wizard.stageQualifying')
      : s.type === 'finals' ? t('admin.rulesEditor.wizard.stageFinals') : t('admin.rulesEditor.wizard.stageRanking'),
  })), [base.stages, t]);

  const confirmId = fieldDomId(ID_PREFIX, 'confirm');
  const confirmError = showIssues && !state.rulesConfirmed;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-yellow-400 text-center">{t('admin.rulesEditor.title')}</h2>
      <p className="text-gray-300">{t('admin.rulesEditor.wizard.intro')}</p>
      <CompetitionRulesEditor
        tournament={base}
        draft={state.rulesDraft}
        onChange={draft => dispatch({ type: 'SET_RULES_DRAFT', draft })}
        stageOptions={stageOptions}
        idPrefix={ID_PREFIX}
        issues={issues}
        extraIssues={extraIssues}
        showIssues={showIssues}
        summaryRef={summaryRef}
        footer={(
          <div className={`card border-2 ${confirmError ? 'border-red-500' : 'border-yellow-500'}`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                id={confirmId}
                type="checkbox"
                className="mt-1 w-6 h-6"
                checked={state.rulesConfirmed}
                onChange={e => dispatch({ type: 'SET_FIELD', field: 'rulesConfirmed', value: e.target.checked })}
                aria-invalid={confirmError ? true : undefined}
                aria-describedby={`${confirmId}-help${confirmError ? ` ${confirmId}-error` : ''}`}
              />
              <span className="font-bold text-lg">{t('admin.rulesEditor.wizard.confirm')}</span>
            </label>
            <p id={`${confirmId}-help`} className="text-gray-400 text-sm mt-1 ml-9">{t('admin.rulesEditor.wizard.confirmHelp')}</p>
            {confirmError && (
              <p id={`${confirmId}-error`} className="text-red-400 text-sm mt-1 ml-9">{t('admin.rulesEditor.errors.confirmRequired')}</p>
            )}
          </div>
        )}
      />
    </div>
  );
}
