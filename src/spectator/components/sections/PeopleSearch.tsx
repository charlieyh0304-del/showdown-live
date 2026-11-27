import { useId, useMemo, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { rememberFocusKey } from '@shared/utils/focusReturn';
import { searchPeople, type PersonEntry } from '../../utils/peopleSearch';
import { playerPath, refereePath } from '../../utils/spectatorRoutes';

export interface PeopleSearchProps {
  people: ReadonlyArray<PersonEntry>;
  tournamentId: string;
  nameOf?: (name: string) => string;
}

/**
 * 선수·심판 찾기 (ARIA 1.2 콤보박스): 글자를 넣으면 목록이 열리고, 위아래 화살표로 고르고 Enter로 그 사람 화면으로 간다.
 * Esc는 목록을 닫고(다시 누르면 글자를 지운다). 한글 초성(ㄱㅊㅅ)으로도 찾는다. 결과 수는 polite로 알린다.
 */
export default function PeopleSearch({ people, tournamentId, nameOf = n => n }: PeopleSearchProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const uid = useId();
  const listId = `${uid}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchPeople(people, query), [people, query]);
  const expanded = open && query.trim().length > 0;

  const kindLabel = (p: PersonEntry) => t(`spectator.search.kind.${p.kind}`);
  const choose = (p: PersonEntry) => {
    rememberFocusKey(location.key, 'people-search');
    setOpen(false);
    setActive(-1);
    navigate(p.kind === 'referee' ? refereePath(tournamentId, p.id) : playerPath(tournamentId, p.id));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (results.length) setActive(a => (a + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (results.length) setActive(a => (a <= 0 ? results.length - 1 : a - 1));
    } else if (e.key === 'Enter') {
      const pick = active >= 0 ? results[active] : results.length === 1 ? results[0] : undefined;
      if (expanded && pick) { e.preventDefault(); choose(pick); }
    } else if (e.key === 'Escape') {
      if (expanded) { e.preventDefault(); setOpen(false); setActive(-1); }
      else if (query) { e.preventDefault(); setQuery(''); }
    }
  };

  return (
    <div role="search" aria-label={t('spectator.search.region')} style={{ position: 'relative', marginBottom: '1rem' }}>
      <label htmlFor={`${uid}-input`} style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>{t('spectator.search.label')}</label>
      <input
        ref={inputRef}
        id={`${uid}-input`}
        data-focus-key="people-search"
        type="text"
        className="input"
        style={{ width: '100%' }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? `${uid}-opt-${active}` : undefined}
        aria-describedby={`${uid}-help`}
        autoComplete="off"
        value={query}
        placeholder={t('spectator.search.placeholder')}
        onChange={e => { setQuery(e.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => setOpen(true)}
      />
      <p id={`${uid}-help`} style={{ color: '#9ca3af', fontSize: '0.875rem', marginTop: '0.25rem' }}>{t('spectator.search.help')}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {query.trim() ? (results.length ? t('spectator.search.count', { count: results.length }) : t('spectator.search.none', { query: query.trim() })) : ''}
      </p>
      <ul
        id={listId}
        role="listbox"
        aria-label={t('spectator.search.listLabel')}
        hidden={!expanded || results.length === 0}
        style={{ position: 'absolute', left: 0, right: 0, zIndex: 30, listStyle: 'none', margin: 0, padding: '0.25rem', backgroundColor: '#111827', border: '2px solid var(--color-primary)', borderRadius: '0.5rem', maxHeight: '18rem', overflowY: 'auto' }}
      >
        {results.map((p, i) => (
          <li
            key={`${p.kind}:${p.id}`}
            id={`${uid}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={e => { e.preventDefault(); choose(p); }}
            style={{ padding: '0.625rem 0.75rem', minHeight: '48px', cursor: 'pointer', borderRadius: '0.375rem', backgroundColor: i === active ? 'var(--color-primary)' : 'transparent', color: i === active ? '#000' : '#fff' }}
          >
            <strong>{nameOf(p.name)}</strong>
            <span>{`, ${kindLabel(p)}`}{p.groups.length > 0 ? `, ${p.groups.map(g => t('spectator.tournament.view.groupLabel', { id: g })).join(' ')}` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
