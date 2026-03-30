import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useReferees } from '@shared/hooks/useFirebase';
import { hashPin } from '@shared/utils/crypto';
import type { Referee } from '@shared/types';

interface RefereeForm {
  name: string;
  role: 'main' | 'assistant';
  pin: string;
}

const EMPTY_FORM: RefereeForm = { name: '', role: 'main', pin: '' };

export default function RefereeManagement() {
  const { t } = useTranslation();
  const { referees, loading, addReferee, updateReferee, deleteReferee } = useReferees();
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<RefereeForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Referee | null>(null);
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

  const openEdit = useCallback((referee: Referee) => {
    setForm({ name: referee.name, role: referee.role, pin: '' });
    setEditId(referee.id);
    setError('');
    setModalMode('edit');
  }, []);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setEditId(null);
    setError('');
  }, []);

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError(t('admin.referees.nameRequired'));
      return;
    }
    if (modalMode === 'add' && form.pin.length < 4) {
      setError(t('admin.referees.pinMinLength'));
      return;
    }
    if (modalMode === 'edit' && form.pin && form.pin.length < 4) {
      setError(t('admin.referees.pinMinLength'));
      return;
    }

    setSaving(true);
    setError('');
    try {
      const hashedPin = form.pin ? await hashPin(form.pin) : undefined;
      if (modalMode === 'edit' && editId) {
        const updateData: Partial<Referee> = {
          name: form.name.trim(),
          role: form.role,
        };
        if (hashedPin) {
          updateData.pin = hashedPin;
        }
        await updateReferee(editId, updateData);
      } else {
        await addReferee({
          name: form.name.trim(),
          role: form.role,
          pin: hashedPin,
        });
      }
      closeModal();
    } catch {
      setError(t('common.error.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [form, modalMode, editId, addReferee, updateReferee, closeModal]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteReferee(deleteTarget.id);
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteReferee]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  }, [closeModal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" aria-live="polite">
        <p className="text-2xl text-yellow-400 animate-pulse">{t('admin.referees.loadingReferees')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold text-yellow-400">{t('admin.referees.title')}</h1>
        <button className="btn btn-primary" onClick={openAdd} aria-label={t('admin.referees.addReferee')}>
          {t('admin.referees.addReferee')}
        </button>
      </div>

      {referees.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-xl text-gray-400">{t('admin.referees.noReferees')}</p>
        </div>
      ) : (
        <div className="space-y-3" aria-label={t('admin.referees.refereeListLabel')}>
          {referees.map(r => (
            <div key={r.id} className="card flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-bold text-lg">{r.name}</span>
                <span className={`ml-3 px-2 py-0.5 rounded text-sm font-bold ${
                  r.role === 'main' ? 'bg-yellow-800 text-yellow-300' : 'bg-gray-600 text-gray-300'
                }`}>
                  {r.role === 'main' ? t('common.refereeRole.main') : t('common.refereeRole.assistant')}
                </span>
                {r.pin && <span className="ml-2 text-green-400 text-sm">{t('admin.referees.pinSet')}</span>}
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-secondary"
                  onClick={() => openEdit(r)}
                  aria-label={t('admin.referees.editAriaLabel', { name: r.name })}
                >
                  {t('common.edit')}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setDeleteTarget(r)}
                  aria-label={t('admin.referees.deleteAriaLabel', { name: r.name })}
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
          <div className="modal-content" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="referee-modal-title">
            <h2 id="referee-modal-title" className="text-2xl font-bold text-yellow-400 mb-4 text-center">
              {modalMode === 'add' ? t('admin.referees.addReferee') : t('admin.referees.editReferee')}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="referee-name" className="block mb-1 font-semibold">{t('admin.referees.refereeNameLabel')}</label>
                <input
                  ref={nameInputRef}
                  id="referee-name"
                  className="input"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={t('admin.referees.refereeNamePlaceholder')}
                  aria-label={t('admin.referees.refereeNameAriaLabel')}
                />
              </div>
              <div>
                <label htmlFor="referee-role" className="block mb-1 font-semibold">{t('admin.referees.roleLabel')}</label>
                <select
                  id="referee-role"
                  className="input"
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value as 'main' | 'assistant' }))}
                  aria-label={t('admin.referees.roleAriaLabel')}
                >
                  <option value="main">{t('common.refereeRole.main')}</option>
                  <option value="assistant">{t('common.refereeRole.assistant')}</option>
                </select>
              </div>
              <div>
                <label htmlFor="referee-pin" className="block mb-1 font-semibold">
                  {modalMode === 'edit' ? t('admin.referees.pinLabelEdit') : t('admin.referees.pinLabel')}
                </label>
                <input
                  id="referee-pin"
                  type="password"
                  className="input"
                  value={form.pin}
                  onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
                  placeholder={modalMode === 'edit' ? t('admin.referees.pinPlaceholderEdit') : t('admin.referees.pinPlaceholder')}
                  autoComplete="new-password"
                  aria-label={t('admin.referees.pinAriaLabel')}
                />
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
          <div className="modal-content" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="referee-delete-title">
            <h2 id="referee-delete-title" className="text-2xl font-bold text-red-500 mb-4 text-center">{t('admin.referees.deleteReferee')}</h2>
            <p className="text-lg mb-6 text-center">{t('admin.referees.deleteConfirmMessage', { name: deleteTarget.name })}</p>
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
