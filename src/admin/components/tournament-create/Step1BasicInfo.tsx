import { useTranslation } from 'react-i18next';
import type { Dispatch } from 'react';
import type { WizardState, Action } from '../../pages/TournamentCreate';

interface Preset {
  id: string;
  name: string;
  description: string;
}

interface Step1BasicInfoProps {
  state: WizardState;
  dispatch: Dispatch<Action>;
  fieldErrors: Record<string, string>;
  setFieldErrors: (updater: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  filteredPresets: Preset[];
  validateStep: (step: number) => Record<string, string>;
  tryAdvanceStep: (action: Action) => void;
}

/**
 * 마법사 Step 1: 기본 정보 (대회명, 기간, 다중 일정, 종목, 프리셋 선택)
 */
export default function Step1BasicInfo({
  state,
  dispatch,
  fieldErrors,
  setFieldErrors,
  filteredPresets,
  validateStep,
  tryAdvanceStep,
}: Step1BasicInfoProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div>
          <label htmlFor="name" className="block mb-2 font-semibold text-lg">{t('admin.tournamentCreate.basicInfo.tournamentName')}</label>
          <input
            id="name"
            className={`input ${fieldErrors.name ? 'border-red-500 border-2' : ''}`}
            value={state.name}
            onChange={e => {
              dispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value });
              if (fieldErrors.name) setFieldErrors(prev => { const next = { ...prev }; delete next.name; return next; });
            }}
            placeholder={t('admin.tournamentCreate.basicInfo.tournamentNamePlaceholder')}
            aria-label={t('admin.tournamentCreate.basicInfo.tournamentNameAriaLabel')}
            aria-required="true"
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? 'name-error' : undefined}
          />
          {fieldErrors.name && (
            <p id="name-error" className="text-red-500 text-sm mt-1" role="alert">{fieldErrors.name}</p>
          )}
        </div>
        <div>
          <label htmlFor="start-date" className="block mb-2 font-semibold text-lg">{t('admin.tournamentCreate.basicInfo.tournamentPeriod')}</label>
          <div className="flex gap-3 items-center flex-wrap">
            <input
              id="start-date"
              type="date"
              className="input text-base"
              value={state.date || ''}
              onChange={e => dispatch({ type: 'SET_FIELD', field: 'date', value: e.target.value })}
              aria-label={t('admin.tournamentCreate.basicInfo.startDate')}
            />
            <span className="text-gray-400" aria-hidden="true">~</span>
            <input
              id="end-date"
              type="date"
              className="input text-base"
              value={state.endDate || ''}
              onChange={e => dispatch({ type: 'SET_FIELD', field: 'endDate', value: e.target.value })}
              min={state.date || undefined}
              aria-label={t('admin.tournamentCreate.basicInfo.endDate')}
            />
          </div>
          <p className="text-gray-400 text-xs mt-1">{t('admin.tournamentCreate.basicInfo.oneDayHint')}</p>
        </div>

        {/* 다중 날짜 선택 */}
        <div>
          <label className="block mb-2 font-semibold text-lg">{t('admin.tournamentCreate.basicInfo.scheduleDatesLabel')}</label>
          <p className="text-gray-400 text-xs mb-2">{t('admin.tournamentCreate.basicInfo.scheduleDatesHint')}</p>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="date"
              className="input text-sm"
              id="schedule-date-input"
              min={state.date || undefined}
              max={state.endDate || undefined}
            />
            <button
              type="button"
              className="btn btn-secondary text-sm px-3 py-1"
              onClick={() => {
                const input = document.getElementById('schedule-date-input') as HTMLInputElement;
                if (input?.value) {
                  dispatch({ type: 'ADD_SCHEDULE_DATE', date: input.value });
                  input.value = '';
                }
              }}
            >
              {t('admin.tournamentCreate.basicInfo.addDate')}
            </button>
          </div>
          {state.scheduleDates.length > 0 && (
            <div className="flex gap-2 flex-wrap mt-2">
              {state.scheduleDates.map(d => (
                <span key={d} className="inline-flex items-center gap-1 bg-gray-700 text-white text-sm px-3 py-1 rounded-full">
                  {d}
                  <button
                    type="button"
                    className="text-gray-400 hover:text-red-400 ml-1"
                    onClick={() => dispatch({ type: 'REMOVE_SCHEDULE_DATE', date: d })}
                    aria-label={`${d} ${t('common.delete')}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="text-xl font-bold text-center">{t('admin.tournamentCreate.basicInfo.typeSelection')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            className={`btn text-lg py-4 ${state.type === 'individual' ? 'btn-primary' : 'bg-gray-700 text-white'}`}
            onClick={() => dispatch({ type: 'SET_FIELD', field: 'type', value: 'individual' })}
            aria-pressed={state.type === 'individual'}
          >
            {t('admin.tournamentCreate.basicInfo.individual')}
          </button>
          <button
            type="button"
            className={`btn text-lg py-4 ${(state.type === 'team' || state.type === 'randomTeamLeague') ? 'btn-primary' : 'bg-gray-700 text-white'}`}
            onClick={() => dispatch({ type: 'SET_FIELD', field: 'type', value: 'team' })}
            aria-pressed={state.type === 'team' || state.type === 'randomTeamLeague'}
          >
            {t('admin.tournamentCreate.basicInfo.team')}
          </button>
        </div>
        {(state.type === 'team' || state.type === 'randomTeamLeague') && (
          <label className="flex items-center justify-between cursor-pointer mt-2">
            <span className="text-lg font-semibold">{t('admin.tournamentCreate.basicInfo.randomTeamComposition')}</span>
            <button
              role="switch"
              aria-checked={state.type === 'randomTeamLeague'}
              aria-label={t('admin.tournamentCreate.basicInfo.randomTeamComposition')}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${state.type === 'randomTeamLeague' ? 'bg-green-600' : 'bg-gray-600'}`}
              onClick={() => dispatch({ type: 'SET_FIELD', field: 'type', value: state.type === 'randomTeamLeague' ? 'team' : 'randomTeamLeague' })}
            >
              <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${state.type === 'randomTeamLeague' ? 'translate-x-7' : 'translate-x-1'}`} />
            </button>
          </label>
        )}
      </div>

      <div className="card space-y-4">
        <h2 className="text-xl font-bold text-center">{t('admin.tournamentCreate.presets.title')}</h2>
        {state.type !== 'individual' && (
          <p className="text-gray-400 text-sm">
            {t('admin.tournamentCreate.presets.presetHint')}
          </p>
        )}
        <div className="space-y-3" role="radiogroup" aria-label={t('admin.tournamentCreate.presets.title')}>
          {state.type !== 'individual' && filteredPresets.map(preset => (
            <button
              key={preset.id}
              role="radio"
              aria-checked={state.presetId === preset.id}
              aria-label={`${t(preset.description)}${state.presetId === preset.id ? `, ${t('common.accessibility.selected')}` : ''}`}
              className={`card w-full text-left p-4 border-2 ${state.presetId === preset.id ? 'border-yellow-400 bg-gray-800' : 'border-transparent hover:border-gray-600'}`}
              onClick={() => {
                const errors = validateStep(1);
                if (Object.keys(errors).length > 0) {
                  setFieldErrors(errors);
                  const el = document.getElementById(Object.keys(errors)[0]);
                  el?.focus();
                  return;
                }
                setFieldErrors({});
                dispatch({ type: 'APPLY_PRESET', presetId: preset.id });
                dispatch({ type: 'GO_TO_STEP', step: 2 });
              }}
            >
              <h3 className="text-lg font-bold">{t(preset.name)}</h3>
              <p className="text-gray-400 text-sm">{t(preset.description)}</p>
            </button>
          ))}
          <button
            className="card w-full text-left p-6 border-2 border-dashed border-yellow-400 hover:bg-gray-800"
            onClick={() => tryAdvanceStep({ type: 'NEXT_STEP' })}
          >
            <h3 className="text-lg font-bold text-yellow-400">⚙ {t('admin.tournamentCreate.presets.customTitle')}</h3>
            <p className="text-gray-400 text-sm mt-1">{t('admin.tournamentCreate.presets.customDescription')}</p>
          </button>
        </div>
      </div>
    </div>
  );
}
