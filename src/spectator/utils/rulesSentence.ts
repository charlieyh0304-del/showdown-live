/**
 * 순위 규칙을 쉬운 문장으로 (관전 화면 '조별 순위' 설명). 문장은 항상 대회의 유효 규칙
 * (resolveCompetitionRules 결과)에서 만들고, 고정 문구를 쓰지 않는다.
 */
import type { CompetitionRules, MatchKind } from '@shared/rules/competitionRules';

export type Translate = (key: string, opts?: Record<string, unknown>) => string;

const K = 'spectator.rules';

export interface RulesSentenceOptions {
  /** 조별 예선이 있으면 진출 인원도 설명한다 */
  hasGroups?: boolean;
  /** 부전승 점수(11:0 등)를 계산할 경기 종류 */
  kind?: MatchKind;
}

/** 승점 문장: "이기면 1점, 지면 0점" (+ 무승부·부전승·부전패가 다르면 덧붙임) */
function pointsSentence(r: CompetitionRules, t: Translate): string {
  const sp = r.standingsPoints;
  const parts = [t(`${K}.pointsWin`, { n: sp.win }), t(`${K}.pointsLoss`, { n: sp.loss })];
  if (sp.draw !== 0) parts.push(t(`${K}.pointsDraw`, { n: sp.draw }));
  if (sp.walkoverWin !== sp.win) parts.push(t(`${K}.pointsWalkoverWin`, { n: sp.walkoverWin }));
  if (sp.forfeitLoss !== sp.loss) parts.push(t(`${K}.pointsForfeitLoss`, { n: sp.forfeitLoss }));
  return t(`${K}.points`, { list: parts.join(t(`${K}.listSep`)) });
}

function walkoverSentence(r: CompetitionRules, t: Translate, kind: MatchKind): string {
  const w = r.walkover;
  if (!w.countInStandings) return t(`${K}.walkoverExcluded`);
  const score = w.setScore ?? r.scoring[kind].winScore;
  return t(`${K}.walkoverCounted`, { score: `${score}:0` });
}

function tiebreakSentence(r: CompetitionRules, t: Translate): string {
  // 승점은 1차 기준이므로 '같으면' 다음 기준부터 나열한다
  const criteria = r.tiebreak.criteria.filter((c, i) => !(i === 0 && c === 'points'));
  const unresolved = t(`${K}.unresolved.${r.tiebreak.unresolved}`);
  if (criteria.length === 0) return t(`${K}.tiebreakNone`, { unresolved });
  const list = criteria.map(c => t(`${K}.criteria.${c}`)).join(t(`${K}.orderSep`));
  const first = r.tiebreak.criteria[0] === 'points' ? t(`${K}.tiebreakLeadPoints`) : t(`${K}.tiebreakLead`);
  const h2h = criteria.includes('head_to_head') && r.tiebreak.headToHeadMode === 'recursive' ? t(`${K}.headToHeadRecursive`) : '';
  return [t(`${K}.tiebreak`, { lead: first, list, unresolved }), h2h].filter(Boolean).join(' ');
}

function qualificationSentence(r: CompetitionRules, t: Translate): string {
  const q = r.qualification;
  if (q.perGroup <= 0) return '';
  const base = t(`${K}.qualify`, { n: q.perGroup });
  return q.wildcards > 0 ? `${base} ${t(`${K}.wildcards`, { n: q.wildcards })}` : base;
}

/** 순위 규칙 설명 문장들 (한 문단) */
export function describeStandingsRules(rules: CompetitionRules, t: Translate, opts: RulesSentenceOptions = {}): string {
  const kind = opts.kind ?? 'individual';
  return [
    pointsSentence(rules, t),
    walkoverSentence(rules, t, kind),
    tiebreakSentence(rules, t),
    opts.hasGroups ? qualificationSentence(rules, t) : '',
  ].filter(Boolean).join(' ');
}
