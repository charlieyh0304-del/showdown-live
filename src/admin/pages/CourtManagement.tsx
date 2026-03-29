import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCourts, useReferees } from '@shared/hooks/useFirebase';
import type { Court } from '@shared/types';

interface CourtForm {
  name: string;
  location: string;
  assignedReferees: string[];
}

const EMPTY_FORM: CourtForm = { name: '', location: '', assignedReferees: [] };

export default function CourtManagement() {
  const { t } = useTranslation();
  const { courts, loading, addCourt, updateCourt, deleteCourt } = useCourts();
  const { referees } = useReferees();
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<CourtForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Court | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (modalMode) {
      nameInputRef.current?.focus();
    }
  }, [modalMode]);

  const openAdd = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditId(null);
    setError('');
    setModalMode('add');
  }, []);

  const openEdit = useCallback((court: Court) => {
    setForm({
      name: court.name,
      location: court.location ?? '',
      assignedReferees: court.assignedReferees ?? [],
    });
    setEditId(court.id);
    setError('');
    setModalMode('edit');
  }, []);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setEditId(null);
    setError('');
  }, []);

  const toggleReferee = useCallback((refId: string) => {
    setForm(f => {
      const current = f.assignedReferees;
      if (current.includes(refId)) {
        return { ...f, assignedReferees: current.filter(id => id !== refId) };
      }
      if (current.length >= 2) return f; // max 2
      return { ...f, assignedReferees: [...current, refId] };
    });
  }, []);

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError(t('admin.courts.courtNameRequired'));
      return;
    }

    setSaving(true);
    setError('');
    try {
      const data: Omit<Court, 'id' | 'createdAt'> = {
        name: form.name.trim(),
        ...(form.location ? { location: form.location.trim() } : {}),
        assignedReferees: form.assignedReferees,
      };
      if (modalMode === 'edit' && editId) {
        await updateCourt(editId, data);
      } else {
        await addCourt(data);
      }
      closeModal();
    } catch {
      setError(t('common.error.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [form, modalMode, editId, addCourt, updateCourt, closeModal]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteCourt(deleteTarget.id);
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteCourt]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  }, [closeModal]);

  const getRefereeNames = useCallback((ids?: string[]) => {
    if (!ids || ids.length === 0) return '';
    return ids.map(id => referees.find(r => r.id === id)?.name ?? t('common.unknown')).join(', ');
  }, [referees]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" aria-live="polite">
        <p className="text-2xl text-yellow-400 animate-pulse">{t('admin.courts.loadingCourts')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold text-yellow-400">{t('admin.courts.title')}</h1>
        <button className="btn btn-primary" onClick={openAdd} aria-label={t('admin.courts.addCourt')}>
          {t('admin.courts.addCourt')}
        </button>
      </div>

      {courts.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-xl text-gray-400">{t('admin.courts.noCourts')}</p>
        </div>
      ) : (
        <div className="space-y-3" aria-label={t('admin.courts.courtListLabel')}>
          {courts.map(c => (
            <div key={c.id} className="card flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-bold text-lg">{c.name}</span>
                {c.location && <span className="ml-3 text-gray-400">({c.location})</span>}
                {(c.assignedReferees?.length ?? 0) > 0 && (
                  <span className="ml-3 text-cyan-400 text-sm">
                    {t('admin.nav.referees')}: {getRefereeNames(c.assignedReferees)}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-secondary"
                  onClick={() => openEdit(c)}
                  aria-label={t('admin.courts.editAriaLabel', { name: c.name })}
                >
                  {t('common.edit')}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setDeleteTarget(c)}
                  aria-label={t('admin.courts.deleteAriaLabel', { name: c.name })}
                >
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalMode && (
        <div
          className="modal-backdrop"
          onClick={closeModal}
          onKeyDown={handleKeyDown}
        >
          <div className="modal-content" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="court-modal-title">
            <h2 id="court-modal-title" className="text-2xl font-bold text-yellow-400 mb-4 text-center">
              {modalMode === 'add' ? t('admin.courts.addCourt') : t('admin.courts.editCourt')}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="court-name" className="block mb-1 font-semibold">{t('admin.courts.courtNameLabel')}</label>
                <input
                  ref={nameInputRef}
                  id="court-name"
                  className="input"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={t('admin.courts.courtNamePlaceholder')}
                  aria-label={t('admin.courts.courtNameAriaLabel')}
                />
              </div>
              <div>
                <label htmlFor="court-location" className="block mb-1 font-semibold">{t('admin.courts.locationLabel')}</label>
                <input
                  id="court-location"
                  className="input"
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder={t('admin.courts.locationPlaceholder')}
                  aria-label={t('admin.courts.locationAriaLabel')}
                />
              </div>
              <div>
                <p className="mb-2 font-semibold">{t('admin.courts.refereeAssignment')}</p>
                {referees.length === 0 ? (
                  <p className="text-gray-400 text-sm">{t('admin.courts.noRefereesRegistered')}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {referees.map(r => {
                      const selected = form.assignedReferees.includes(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          className={`btn text-sm ${selected ? 'btn-primary' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                          onClick={() => toggleReferee(r.id)}
                          aria-pressed={selected}
                          aria-label={`${r.name} ${selected ? t('admin.courts.assigned') : t('admin.courts.unassigned')}`}
                        >
                          {r.name} ({r.role === 'main' ? t('common.refereeRole.main') : t('common.refereeRole.assistant')})
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {error && <p className="text-red-500 font-semibold" role="alert">{error}</p>}
              <div className="flex gap-4">
                <button type="submit" className="btn btn-primary flex-1" disabled={saving} aria-label={t('common.save')}>
                  {saving ? t('common.saving') : t('common.save')}
                </button>
                <button type="button" className="btn btn-secondary flex-1" onClick={closeModal} aria-label={t('common.cancel')}>
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="modal-backdrop"
          onClick={() => setDeleteTarget(null)}
          onKeyDown={e => { if (e.key === 'Escape') setDeleteTarget(null); }}
        >
          <div className="modal-content" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="court-delete-title">
            <h2 id="court-delete-title" className="text-2xl font-bold text-red-500 mb-4">{t('admin.courts.deleteCourt')}</h2>
            <p className="text-lg mb-6">{t('admin.courts.deleteConfirmMessage', { name: deleteTarget.name })}</p>
            <div className="flex gap-4">
              <button className="btn btn-danger flex-1" onClick={handleDelete} aria-label={t('common.delete')}>
                {t('common.delete')}
              </button>
              <button className="btn btn-secondary flex-1" onClick={() => setDeleteTarget(null)} aria-label={t('common.cancel')}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
