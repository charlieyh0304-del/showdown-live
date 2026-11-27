import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showError } from '@shared/utils/toast';
import { tiebreakDecisionKey } from '@shared/rules/competitionRules';
import type { UnresolvedTie } from '@shared/rules/tiebreak';

/**
 * 진출 경계에서 동률 규칙으로 풀리지 않은 동률을 관리자가 정하는 패널 (M0c).
 * 확정하면 tournaments/{tid}/rules/tiebreakDecisions/{key}에 기록되고, 동률 모듈이 그 순서를 쓴다
 * (클라이언트 순위표와 서버 generate_finals 모두).
 * 접근성: 제목, 목록(ol), 항목마다 위/아래 이동 버튼(선수 이름을 포함한 라벨), 결과는 aria-live로 알린다.
 * 저장하면 동률이 풀려 목록이 사라지므로, 알림 영역은 항상 남겨 두고 확정 안내 문구로 초점을 옮긴다.
 */
export interface TieDecisionPanelProps {
  ties: UnresolvedTie[];
  nameOf: (id: string) => string;
  groupLabel: (scope: string) => string;
  updateTournament: (data: Record<string, unknown>) => Promise<boolean | void>;
}

export default function TieDecisionPanel({ ties, nameOf, groupLabel, updateTournament }: TieDecisionPanelProps) {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<Record<string, string[]>>({});
  const [announcement, setAnnouncement] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState('');
  const savedRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 확정 직후 그 동률 항목(과 확정 버튼)이 사라져 초점이 문서 처음으로 떨어지지 않도록,
  // 남은 동률이 있으면 패널 제목, 없으면 확정 안내 문구로 초점을 옮긴다
  useEffect(() => {
    if (!savedNotice) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    if (ties.length > 0) headingRef.current?.focus();
    else savedRef.current?.focus();
  }, [ties.length, savedNotice]);

  // 알림 영역은 동률이 없어져도 계속 남겨 둬야 마지막 확정 결과가 읽힌다
  const liveRegion = <p className="sr-only" role="status" aria-live="polite">{announcement}</p>;
  if (ties.length === 0) {
    return (
      <>
        {liveRegion}
        {savedNotice && (
          <p ref={savedRef} tabIndex={-1} className="text-sm text-green-400">{savedNotice}</p>
        )}
      </>
    );
  }

  return (
    <>
    {liveRegion}
    <section className="card space-y-3 border-orange-500" aria-labelledby="tie-decision-title">
      <h4 id="tie-decision-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold text-orange-400">{t('common.competitionRules.tie.title')}</h4>
      {ties.map(tie => {
        const key = tiebreakDecisionKey(tie.scope, tie.ids);
        const order = orders[key] ?? tie.ids;
        const group = groupLabel(tie.scope);
        const orderText = order.map(nameOf).join(', ');
        const move = (idx: number, delta: number) => {
          const next = [...order];
          const j = idx + delta;
          if (j < 0 || j >= next.length) return;
          [next[idx], next[j]] = [next[j], next[idx]];
          setOrders(prev => ({ ...prev, [key]: next }));
          setAnnouncement(t('common.competitionRules.tie.position', { pos: j + 1 }) + ': ' + nameOf(next[j]));
        };
        const save = async () => {
          setSaving(key);
          try {
            const ok = await updateTournament({
              [`rules/tiebreakDecisions/${key}`]: { ids: order, scope: tie.scope, decidedAt: Date.now(), decidedBy: 'admin' },
            });
            if (ok === false) {
              showError(t('common.write.tournamentConflict'));
              return;
            }
            const msg = t('common.competitionRules.tie.saved', { group, order: orderText });
            setAnnouncement(msg);
            setSavedNotice(msg);
          } catch {
            showError(t('common.competitionRules.tie.saveFailed'));
          } finally {
            setSaving(null);
          }
        };
        return (
          <div key={key} className="bg-gray-800 rounded-lg p-3 space-y-2">
            <p className="text-sm text-gray-300">
              {t('common.competitionRules.tie.explain', { group, from: tie.fromRank, to: tie.toRank })}
            </p>
            <ol className="space-y-1" aria-label={group}>
              {order.map((id, idx) => (
                <li key={id} className="flex items-center gap-2">
                  <span className="w-20 text-sm text-gray-400">{t('common.competitionRules.tie.position', { pos: tie.fromRank + idx })}</span>
                  <span className="flex-1 font-semibold">{nameOf(id)}</span>
                  <button
                    type="button"
                    className="btn btn-secondary px-2 py-1"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    aria-label={t('common.competitionRules.tie.moveUp', { name: nameOf(id) })}
                  >
                    <span aria-hidden="true">▲</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary px-2 py-1"
                    onClick={() => move(idx, 1)}
                    disabled={idx === order.length - 1}
                    aria-label={t('common.competitionRules.tie.moveDown', { name: nameOf(id) })}
                  >
                    <span aria-hidden="true">▼</span>
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="btn btn-accent w-full"
              onClick={save}
              disabled={saving === key}
              aria-busy={saving === key}
              aria-label={t('common.competitionRules.tie.saveAria', { group, order: orderText })}
            >
              {t('common.competitionRules.tie.save')}
            </button>
          </div>
        );
      })}
    </section>
    </>
  );
}
