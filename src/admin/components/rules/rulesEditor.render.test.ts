import { it, expect, vi } from 'vitest';

// CI에는 Firebase 환경변수가 없다. 이 테스트는 화면 렌더만 보므로 Firebase 초기화를 대체한다.
vi.mock('../../../shared/config/firebase', () => ({
  database: {},
  auth: { currentUser: null },
  authReady: Promise.resolve(),
  default: {},
}));
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import CompetitionRulesEditor from './CompetitionRulesEditor';
import WizardStepRules from '../tournament-create/WizardStepRules';
import WizardStep5Preview from '../tournament-create/WizardStep5Preview';
import WizardStep4Finals from '../tournament-create/WizardStep4Finals';
import Step2Participants from '../tournament-create/Step2Participants';
import RulesTab from '../tournament-detail/RulesTab';
import { WIZARD_STAGE_KEYS, buildTournamentFromWizard, createDefaultState, wizardReducer } from '../tournament-create/wizardModel';
import { draftFromTournament, setFieldValue, validateDraft } from './rulesEditorModel';

// React 테스트 환경(jsdom)이 없어 서버 렌더로만 확인한다: 화면이 예외 없이 그려지고 접근성 id가 붙는지
it('rules editor, wizard steps and rules tab render (SSR smoke)', () => {
  let s = { ...createDefaultState('2026-11-27'), name: 'x' };
  s = wizardReducer(s, { type: 'SET_FIELD', field: 'tournamentMode', value: 'group_tournament' });
  s = wizardReducer(s, { type: 'SET_FIELD', field: 'participantCount', value: 16 });
  s = wizardReducer(s, { type: 'SET_FIELD', field: 'hasRoundScoringOverride', value: true });
  const base = buildTournamentFromWizard(s, { now: 0, stageIds: WIZARD_STAGE_KEYS, includeRules: false });
  const doc = buildTournamentFromWizard(s, { now: 0, stageIds: WIZARD_STAGE_KEYS });
  const noop = () => {};
  const html1 = renderToString(h(WizardStepRules, { state: s, dispatch: noop, base, issues: [], extraIssues: [{ scope: '__tournament__', path: 'confirm', code: 'confirmRequired' }], showIssues: true, summaryRef: null }));
  expect(html1).toContain('wizard-rules-confirm');
  expect(html1).toContain('wizard-rules-tb-points-up');
  const d = setFieldValue(s.rulesDraft, 'finals', 'scoring.individual.winScore', Number.NaN);
  const html2 = renderToString(h(CompetitionRulesEditor, { tournament: base, draft: d, onChange: noop, stageOptions: [{ id: 'finals', label: 'F' }], idPrefix: 'p', issues: validateDraft(base, d), showIssues: true }));
  expect(html2).toContain('p-error-summary-title');
  expect(renderToString(h(WizardStep5Preview, { state: s, doc, dispatch: noop, onSubmit: noop, saving: false }))).toContain('admin.rulesEditor.title');
  renderToString(h(WizardStep4Finals, { state: s, dispatch: noop }));
  renderToString(h(Step2Participants, { state: s, dispatch: noop }));
  const t = { ...doc, id: 't1', createdAt: 0, updatedAt: 0 };
  expect(draftFromTournament(t).tournament.presetId).toBe('ibsa');
  renderToString(h(RulesTab, { tournament: t, matches: [], updateTournament: async () => true }));
});
