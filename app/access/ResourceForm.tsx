'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import styles from './access.module.css'

type Kind = 'gateways' | 'devices' | 'points' | 'credentials' | 'rules'
type OptionKind = 'branches' | 'disciplines' | 'members' | 'gateways' | 'devices' | 'points'
type AccessRow = Record<string, string | number | null>
type Choice = { id: string; name: string }
type OptionPage = { items: Choice[]; nextCursor: string | null; hasMore: boolean }
type EditTarget = { kind: Kind; row: AccessRow }

const errorText = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback)

export function SelectField({
  label,
  kind,
  value,
  optional = false,
  onChange,
}: {
  label: string
  kind: OptionKind
  value: string
  optional?: boolean
  onChange: (value: string) => void
}) {
  const [choices, setChoices] = useState<Choice[]>([])
  const [query, setQuery] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const params = new URLSearchParams({ kind, limit: '50' })
        if (query.trim()) params.set('q', query.trim())
        const data = await api.get<OptionPage>(`/api/access/options?${params}`)
        setChoices(data.items)
      } catch (err) {
        console.error('Erreur choices', err)
      }
    }
    const timer = setTimeout(() => void load(), 200)
    return () => clearTimeout(timer)
  }, [kind, query])

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label className={styles.formLabel}>{label}</label>
      <select
        required={!optional}
        className={styles.formSelect}
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        {optional && <option value="">Tous / aucun</option>}
        {!optional && <option value="">Sélectionner…</option>}
        {choices.map(c => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  )
}

export function ResourceForm({
  kind,
  target,
  onCancel,
  onDone,
}: {
  kind: Kind
  target: EditTarget | null
  onCancel: () => void
  onDone: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const row = target?.row
    setValues(
      row
        ? {
            name: String(row.name ?? ''),
            status: String(row.status ?? ''),
            version: String(row.version ?? ''),
            adapterType: String(row.adapter_type ?? ''),
            deviceType: String(row.device_type ?? ''),
            externalDeviceId: String(row.external_device_id ?? ''),
            direction: String(row.direction ?? ''),
          }
        : {
            status: 'pending',
            direction: 'entry',
            type: 'rfid',
            adapterType: 'generic',
            deviceType: 'turnstile',
          },
    )
  }, [target])

  const set = (k: string, v: string) => setValues(curr => ({ ...curr, [k]: v }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      let body: Record<string, unknown>
      if (target) {
        body =
          kind === 'gateways'
            ? { name: values.name, status: values.status, version: values.version || null }
            : kind === 'devices'
            ? {
                name: values.name,
                status: values.status,
                adapterType: values.adapterType,
                deviceType: values.deviceType,
                externalDeviceId: values.externalDeviceId || null,
              }
            : { name: values.name, status: values.status, direction: values.direction }
        await api.patch(`/api/access/${kind}/${target.row.id}`, body)
      } else {
        body =
          kind === 'gateways'
            ? { branchId: values.branchId, name: values.name, status: values.status }
            : kind === 'devices'
            ? {
                gatewayId: values.gatewayId,
                name: values.name,
                adapterType: values.adapterType,
                deviceType: values.deviceType,
                status: values.status,
                externalDeviceId: values.externalDeviceId || undefined,
                metadata: {},
              }
            : kind === 'points'
            ? { deviceId: values.deviceId, name: values.name, direction: values.direction, status: 'active' }
            : { memberId: values.memberId, type: values.type, identifier: values.identifier }
        await api.post(`/api/access/${kind}`, body)
      }
      onDone()
    } catch (err) {
      setError(errorText(err, 'Enregistrement impossible'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onCancel}>
      <div className={styles.modalDialog} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{target ? 'Modifier' : 'Ajouter'} {kind}</h2>
          <button type="button" onClick={onCancel} style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Nom</label>
            <input
              type="text"
              required
              className={styles.formInput}
              value={values.name ?? ''}
              onChange={e => set('name', e.target.value)}
            />
          </div>

          {kind === 'gateways' && !target && (
            <div className={styles.formGroup}>
              <SelectField label="Salle" kind="branches" value={values.branchId ?? ''} onChange={v => set('branchId', v)} />
            </div>
          )}

          {kind === 'devices' && !target && (
            <div className={styles.formGroup}>
              <SelectField label="Passerelle" kind="gateways" value={values.gatewayId ?? ''} onChange={v => set('gatewayId', v)} />
            </div>
          )}

          {kind === 'points' && !target && (
            <div className={styles.formGroup}>
              <SelectField label="Équipement" kind="devices" value={values.deviceId ?? ''} onChange={v => set('deviceId', v)} />
            </div>
          )}

          {kind === 'points' && (
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Direction</label>
              <select className={styles.formSelect} value={values.direction ?? 'entry'} onChange={e => set('direction', e.target.value)}>
                <option value="entry">Entrée</option>
                <option value="exit">Sortie</option>
                <option value="bidirectional">Bidirectionnel</option>
              </select>
            </div>
          )}

          {error && <p className="gf-banner danger">{error}</p>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <button type="button" className={styles.secondaryBtn} onClick={onCancel}>
              Annuler
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={busy}>
              {busy ? 'Enregistrement…' : 'Valider'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
