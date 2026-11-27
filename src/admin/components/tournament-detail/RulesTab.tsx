import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CompetitionRulesEditor, { type RulesStageOption } from '../rules/CompetitionRulesEditor';
import {
  buildRulesWritePayload,
  draftFromTournament,
  isDraftDirty,
  mergeDrafts,
  rulesChangeImpact,
  savedChangedSince,
  validateDraft,
  type RulesDraft,
} from '../rules/rulesEditorModel';
import { combineWriteResults, notifyTournamentWrite, notifyWriteOutcome, writeOrQueue, type WriteOutcome } from '@shared/utils/dataWrites';
import { queueUpdate } from '@shared/utils/offlineQueue';
import { showConfirm } from '@shared/utils/confirm';
import type { Match, Tournament, TournamentStage } from '@shared/types';

interface RulesTabProps {
  tournament: Tournament;
  matches: Match[];
  updateTournament: (data: Partial<Tournament>) => Promise<boolean>;
}

/**
 * 대회 상세 '경기 규칙' 탭: tournaments/{tid}/rules와 단계별 덮어쓰기(stages[i].rules)를 편집한다.
 * 저장 결과는 written/queued/failed로 알린다(M0a 쓰기 도우미).
 */
export default function RulesTab({ tournament, matches, updateTournament }: RulesTabProps) {
  const { t } = useTranslation();
  // 편집 중이 아니면 저장된 값을 그대로 따라간다(다른 관리자의 변경도 바로 보인다).
  // 편집할 때마다 그때의 저장 값(base)을 함께 기억한다(3방향 병합): 화면과 저장에는 base에서 바꾼
  // 섹션만 편집 값을 쓰고 나머지는 지금 저장된 값을 쓴다. 그래서 편집하는 동안 다른 관리자·챗봇이 바꾼
  // 섹션은 화면에 바로 보이고, 저장해도 되돌려지지 않는다.
  const saved = useMemo(() => draftFromTournament(tournament), [tournament]);
  const [edit, setEdit] = useState<{ base: RulesDraft; draft: RulesDraft } | null>(null);
  const draft = useMemo(() => (edit ? mergeDrafts(saved, edit.base, edit.draft) : saved), [edit, saved]);
  const [showIssues, setShowIssues] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: WriteOutcome | 'info'; text: string } | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const issues = useMemo(() => validateDraft(tournament, draft), [tournament, draft]);
  const impact = useMemo(() => rulesChangeImpact(tournament, matches), [tournament, matches]);
  const dirty = edit !== null && isDraftDirty(tournament, edit.draft, edit.base);
  const changedElsewhere = edit !== null && savedChangedSince(tournament, edit.base);

  const stageOptions: RulesStageOption[] = useMemo(() => {
    const stages: TournamentStage[] = Array.isArray(tournament.stages) ? tournament.stages : Object.values((tournament.stages ?? {}) as Record<string, TournamentStage>);
    return stages
      .filter(s => s && typeof s.id === 'string')
      .map(s => ({
        id: s.id,
        type: s.type,
        label: s.name || (s.type === 'qualifying'
          ? t('admin.rulesEditor.wizard.stageQualifying')
          : s.type === 'finals' ? t('admin.rulesEditor.wizard.stageFinals') : t('admin.rulesEditor.wizard.stageRanking')),
      }));
  }, [tournament.stages, t]);

  const handleSave = async () => {
    if (issues.length > 0) {
      setShowIssues(true);
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setShowIssues(false);
    if (!dirty || !edit) {
      setStatus({ kind: 'info', text: t('admin.rulesEditor.save.unchanged') });
      return;
    }
    if (impact === 'finals') {
      const ok = await showConfirm({
        message: t('admin.rulesEditor.impact.confirmMessage'),
        confirmLabel: t('admin.rulesEditor.impact.confirm'),
        destructive: true,
      });
      if (!ok) {
        setStatus({ kind: 'info', text: t('admin.rulesEditor.impact.cancelled') });
        return;
      }
    }
    setSaving(true);
    setStatus({ kind: 'info', text: t('admin.rulesEditor.save.saving') });
    try {
      const payload = buildRulesWritePayload(tournament, edit.draft, edit.base);
      const result = await writeOrQueue(
        () => updateTournament(payload as Partial<Tournament>),
        () => queueUpdate(`tournaments/${tournament.id}`, { ...payload, updatedAt: Date.now() }),
      );
      const outcome = combineWriteResults([result]);
      if (outcome === 'failed') {
        // false = 충돌(다른 사용자가 먼저 수정) 또는 서버 거부
        notifyTournamentWrite(false, t);
        setStatus({ kind: 'failed', text: t('admin.rulesEditor.save.failed') });
        return;
      }
      notifyWriteOutcome(outcome, t, t('admin.rulesEditor.save.written'));
      setStatus({ kind: outcome, text: t(outcome === 'queued' ? 'admin.rulesEditor.save.queued' : 'admin.rulesEditor.save.written') });
      // 서버에 반영되면 저장된 값을 따라간다. 큐에만 있으면 편집 내용을 화면에 남겨 둔다.
      if (outcome === 'written') setEdit(null);
    } catch (err) {
      console.error('[RulesTab] save failed', err);
      setStatus({ kind: 'failed', text: t('admin.rulesEditor.save.failed') });
    } finally {
      setSaving(false);
    }
  };

  const statusClass = status?.kind === 'failed' ? 'text-red-400' : status?.kind === 'queued' ? 'text-yellow-300' : status?.kind === 'written' ? 'text-green-400' : 'text-cyan-300';

  return (
    <section className="space-y-6" aria-labelledby="rules-tab-title">
      <h2 id="rules-tab-title" className="text-2xl font-bold text-yellow-400">{t('admin.rulesEditor.title')}</h2>

      {impact !== 'none' && (
        <div
          role="note"
          className={`card p-4 border-2 ${impact === 'finals' ? 'border-red-500 bg-red-900/20' : 'border-yellow-500 bg-yellow-900/20'}`}
        >
          <p className={impact === 'finals' ? 'text-red-200 font-semibold' : 'text-yellow-200'}>
            {t(impact === 'finals' ? 'admin.rulesEditor.impact.finals' : 'admin.rulesEditor.impact.started')}
          </p>
        </div>
      )}

      {changedElsewhere && (
        <div role="note" className="card p-4 border-2 border-cyan-500 bg-cyan-900/20">
          <p className="text-cyan-100">{t('admin.rulesEditor.save.changedElsewhere')}</p>
        </div>
      )}

      <CompetitionRulesEditor
        tournament={tournament}
        draft={draft}
        onChange={d => {
          setEdit({ base: saved, draft: d });
          setStatus(null);
        }}
        stageOptions={stageOptions}
        idPrefix="rules-tab"
        issues={issues}
        showIssues={showIssues}
        summaryRef={summaryRef}
      />

      <div className="card sticky bottom-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
          aria-describedby="rules-tab-save-status"
        >
          {saving ? t('admin.rulesEditor.save.saving') : t('admin.rulesEditor.save.button')}
        </button>
        {edit !== null && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={saving}
            onClick={() => {
              setEdit(null);
              setShowIssues(false);
              setStatus({ kind: 'info', text: t('admin.rulesEditor.save.discarded') });
            }}
          >
            {t('admin.rulesEditor.save.discard')}
          </button>
        )}
        <p id="rules-tab-save-status" role="status" aria-live="polite" className={`text-sm ${statusClass}`}>
          {status?.text ?? (dirty ? t('admin.rulesEditor.save.dirty') : '')}
        </p>
      </div>
    </section>
  );
}
