import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlayers } from '@shared/hooks/useFirebase';
import type { Player } from '@shared/types';

interface PlayerForm {
  name: string;
  club: string;
  class: string;
  gender: 'male' | 'female' | '';
}

const EMPTY_FORM: PlayerForm = { name: '', club: '', class: '', gender: '' };
const CLASS_OPTIONS = ['', 'B1', 'B2', 'B3'];

export default function PlayerManagement() {
  const { t } = useTranslation();
  const { players, loading, addPlayer, updatePlayer, deletePlayer } = usePlayers();
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PlayerForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Player | null>(null);
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

  const openEdit = useCallback((player: Player) => {
    setForm({ name: player.name, club: player.club ?? '', class: player.class ?? '', gender: player.gender ?? '' });
    setEditId(player.id);
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
      setError(t('admin.players.nameRequired'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data: Omit<Player, 'id' | 'createdAt'> = {
        name: form.name.trim(),
        ...(form.club ? { club: form.club.trim() } : {}),
        ...(form.class ? { class: form.class } : {}),
        ...(form.gender ? { gender: form.gender } : {}),
      };
      if (modalMode === 'edit' && editId) {
        await updatePlayer(editId, data);
      } else {
        await addPlayer(data);
      }
      closeModal();
    } catch {
      setError(t('common.error.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [form, modalMode, editId, addPlayer, updatePlayer, closeModal, t]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deletePlayer(deleteTarget.id);
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deletePlayer]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  }, [closeModal]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" aria-live="polite">
        <p className="text-2xl text-yellow-400 animate-pulse">{t('admin.players.loadingPlayers')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-3xl font-bold text-yellow-400">{t('admin.players.title')}</h1>
        <button className="btn btn-primary" onClick={openAdd} aria-label={t('admin.players.addPlayer')}>
          {t('admin.players.addPlayer')}
        </button>
      </div>

      {players.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-xl text-gray-400">{t('admin.players.noPlayers')}</p>
        </div>
      ) : (
        <div className="space-y-3" aria-label={t('admin.players.playerListLabel')}>
          {players.map(p => (
            <div key={p.id} className="card flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-bold text-lg">{p.name}</span>
                {p.gender && <span className="ml-2 text-xs text-gray-400">{p.gender === 'male' ? t('common.gender.male') : t('common.gender.female')}</span>}
                {p.club && <span className="ml-3 text-gray-400">({p.club})</span>}
                {p.class && <span className="ml-3 text-cyan-400">[{p.class}]</span>}
              </div>
              <div className="flex gap-2">
                <button
                  className="btn btn-secondary"
                  onClick={() => openEdit(p)}
                  aria-label={t('admin.players.editAriaLabel', { name: p.name })}
                >
                  {t('common.edit')}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setDeleteTarget(p)}
                  aria-label={t('admin.players.deleteAriaLabel', { name: p.name })}
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
          <div className="modal-content" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="player-modal-title">
            <h2 id="player-modal-title" className="text-2xl font-bold text-yellow-400 mb-4">
              {modalMode === 'add' ? t('admin.players.addPlayer') : t('admin.players.editPlayer')}
            </h2>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="player-name" className="block mb-1 font-semibold">{t('admin.players.playerNameLabel')}</label>
                <input
                  ref={nameInputRef}
                  id="player-name"
                  className="input"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={t('admin.players.playerNamePlaceholder')}
                  aria-label={t('admin.players.playerNameAriaLabel')}
                />
              </div>
              <div>
                <label htmlFor="player-club" className="block mb-1 font-semibold">{t('admin.players.clubLabel')}</label>
                <input
                  id="player-club"
                  className="input"
                  value={form.club}
                  onChange={e => setForm(f => ({ ...f, club: e.target.value }))}
                  placeholder={t('admin.players.clubPlaceholder')}
                  aria-label={t('admin.players.clubAriaLabel')}
                />
              </div>
              <div>
                <label htmlFor="player-class" className="block mb-1 font-semibold">{t('admin.players.classLabel')}</label>
                <select
                  id="player-class"
                  className="input"
                  value={form.class}
                  onChange={e => setForm(f => ({ ...f, class: e.target.value }))}
                  aria-label={t('admin.players.classAriaLabel')}
                >
                  {CLASS_OPTIONS.map(c => (
                    <option key={c} value={c}>{c || t('admin.players.classUnspecified')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block mb-1 font-semibold">{t('admin.players.genderLabel')}</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`btn flex-1 ${form.gender === 'male' ? 'btn-primary ring-2 ring-yellow-400' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                    onClick={() => setForm(f => ({ ...f, gender: 'male' }))}
                    aria-pressed={form.gender === 'male'}
                    aria-label={t('admin.players.maleAriaLabel')}
                  >
                    {t('common.gender.male')}
                  </button>
                  <button
                    type="button"
                    className={`btn flex-1 ${form.gender === 'female' ? 'btn-primary ring-2 ring-yellow-400' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                    onClick={() => setForm(f => ({ ...f, gender: 'female' }))}
                    aria-pressed={form.gender === 'female'}
                    aria-label={t('admin.players.femaleAriaLabel')}
                  >
                    {t('common.gender.female')}
                  </button>
                  <button
                    type="button"
                    className={`btn flex-1 ${form.gender === '' ? 'btn-secondary ring-2 ring-gray-400' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
                    onClick={() => setForm(f => ({ ...f, gender: '' }))}
                    aria-pressed={form.gender === ''}
                    aria-label={t('admin.players.unspecifiedAriaLabel')}
                  >
                    {t('common.gender.unspecified')}
                  </button>
                </div>
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
          <div className="modal-content" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="player-delete-title">
            <h2 id="player-delete-title" className="text-2xl font-bold text-red-500 mb-4">{t('admin.players.deletePlayer')}</h2>
            <p className="text-lg mb-6">{t('admin.players.deleteConfirmMessage', { name: deleteTarget.name })}</p>
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
