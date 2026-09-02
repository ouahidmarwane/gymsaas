'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { DAYS_OF_WEEK, daysMaskToSelected, selectedToDaysMask } from '@/src/access-reasons'
import styles from './access.module.css'

type AccessRow = Record<string, string | number | null>

export default function RuleBuilderModal({
  target,
  onClose,
  onSaved,
}: {
  target: AccessRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(target ? String(target.name ?? '') : '')
  const [branchId, setBranchId] = useState(target ? String(target.branch_id ?? '') : '')
  const [accessPointId, setAccessPointId] = useState(target ? String(target.access_point_id ?? '') : '')
  const [memberId, setMemberId] = useState(target ? String(target.member_id ?? '') : '')
  const [disciplineId, setDisciplineId] = useState(target ? String(target.discipline_id ?? '') : '')
  const [effect, setEffect] = useState<'allow' | 'deny'>(target?.effect === 'deny' ? 'deny' : 'allow')
  const [priority, setPriority] = useState<number>(target ? Number(target.priority ?? 0) : 0)
  const [selectedDays, setSelectedDays] = useState<number[]>(
    target ? daysMaskToSelected(Number(target.days_mask ?? 127)) : [1, 2, 4, 8, 16, 32, 64],
  )
  const [startTime, setStartTime] = useState(target ? String(target.start_time ?? '') : '')
  const [endTime, setEndTime] = useState(target ? String(target.end_time ?? '') : '')
  const [validFrom, setValidFrom] = useState(target ? String(target.valid_from ?? '') : '')
  const [validUntil, setValidUntil] = useState(target ? String(target.valid_until ?? '') : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleDay(mask: number) {
    setSelectedDays(curr => (curr.includes(mask) ? curr.filter(m => m !== mask) : [...curr, mask]))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const daysMask = selectedToDaysMask(selectedDays)
      const body: Record<string, unknown> = {
        name,
        effect,
        priority: Number(priority),
        daysMask,
        startTime: startTime || null,
        endTime: endTime || null,
        validFrom: validFrom ? new Date(validFrom).toISOString().replace('.000Z', 'Z') : null,
        validUntil: validUntil ? new Date(validUntil).toISOString().replace('.000Z', 'Z') : null,
      }

      if (target) {
        await api.patch(`/api/access/rules/${target.id}`, body)
      } else {
        body.branchId = branchId
        body.accessPointId = accessPointId || undefined
        body.memberId = memberId || undefined
        body.disciplineId = disciplineId || undefined
        body.status = 'active'
        await api.post('/api/access/rules', body)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de l’enregistrement de la règle')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalDialog} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{target ? 'Modifier la règle de passage' : 'Nouvelle règle de passage'}</h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Nom de la règle</label>
            <input
              type="text"
              required
              className={styles.formInput}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: Accès musculation semaine"
            />
          </div>

          {!target && (
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Identifiant de la salle</label>
              <input
                type="text"
                required
                className={styles.formInput}
                value={branchId}
                onChange={e => setBranchId(e.target.value)}
                placeholder="UUID de la salle"
              />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Effet de la règle</label>
              <select className={styles.formSelect} value={effect} onChange={e => setEffect(e.target.value as any)}>
                <option value="allow">Autoriser (allow)</option>
                <option value="deny">Refuser (deny)</option>
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Priorité (0–100)</label>
              <input
                type="number"
                min={0}
                max={100}
                className={styles.formInput}
                value={priority}
                onChange={e => setPriority(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Clickable Days Selector (Replacing raw 1..127 bitmask) */}
          <div className={styles.formGroup}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className={styles.formLabel}>Jours d’application</label>
              <div style={{ display: 'flex', gap: 6, fontSize: '0.68rem' }}>
                <button
                  type="button"
                  onClick={() => setSelectedDays([1, 2, 4, 8, 16, 32, 64])}
                  style={{ background: 'none', border: 0, color: 'var(--gold)', cursor: 'pointer', fontWeight: 600 }}
                >
                  Tous
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => setSelectedDays([1, 2, 4, 8, 16])}
                  style={{ background: 'none', border: 0, color: 'var(--gold)', cursor: 'pointer', fontWeight: 600 }}
                >
                  Semaine
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => setSelectedDays([32, 64])}
                  style={{ background: 'none', border: 0, color: 'var(--gold)', cursor: 'pointer', fontWeight: 600 }}
                >
                  Week-end
                </button>
              </div>
            </div>

            <div className={styles.daysPicker}>
              {DAYS_OF_WEEK.map(day => {
                const active = selectedDays.includes(day.mask)
                return (
                  <button
                    key={day.bit}
                    type="button"
                    className={`${styles.dayPill} ${active ? styles.dayPillActive : ''}`}
                    onClick={() => toggleDay(day.mask)}
                  >
                    {day.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Time window */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Heure de début (HH:MM)</label>
              <input
                type="time"
                className={styles.formInput}
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Heure de fin (HH:MM)</label>
              <input
                type="time"
                className={styles.formInput}
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="gf-banner danger">{error}</p>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <button type="button" className={styles.secondaryBtn} onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={busy}>
              {busy ? 'Enregistrement…' : target ? 'Enregistrer les modifications' : 'Créer la règle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
