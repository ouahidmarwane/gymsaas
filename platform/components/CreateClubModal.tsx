'use client'

import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { api, ApiError } from '@/lib/client'

/**
 * Creation d'un club depuis le tableau de bord plateforme.
 *
 * Le club nait vide : ni salle, ni sport. On ne devine pas ce qu'il enseigne,
 * on le lui demandera — ou on le configurera pour lui en mode support.
 */
export default function CreateClubModal({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (orgId: string) => void }) {
  const [clubName, setClubName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [plan, setPlan] = useState('trial')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // L'identifiant se derive du nom tant que personne ne l'a touche : une
  // saisie de moins, et il reste modifiable si le nom ne s'y prete pas.
  function onNameChange(value: string) {
    setClubName(value)
    if (!slugTouched) setSlug(slugify(value))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await api.post<{ orgId: string }>('/api/admin/clubs', {
        clubName, slug, ownerName, ownerEmail, ownerPassword, plan,
      })
      onCreated(res.orgId)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Creation impossible')
      setBusy(false)
    }
  }

  const ready = clubName.trim() && slug.trim() && ownerName.trim()
    && ownerEmail.trim() && ownerPassword.length >= 10

  return (
    <div className="compta-modal-overlay" onClick={onClose}
         role="dialog" aria-modal="true" aria-label="Ajouter un club">
      <div className="compta-modal" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Ajouter un club
          </h2>
          <button className="gf-hide" onClick={onClose} aria-label="Fermer"><X size={15} /></button>
        </div>
        <p className="dz-card-note" style={{ marginBottom: 18 }}>
          Le club demarre vide. Ses salles et ses sports se declarent ensuite.
        </p>

        <div aria-live="polite">
          {error && (
            <p role="alert" style={{
              padding: '0.6rem 0.85rem', marginBottom: 12, borderRadius: 12,
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5', fontSize: '0.82rem', fontWeight: 600,
            }}>{error}</p>
          )}
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Nom du club">
            <input className="input-dark" value={clubName} required autoFocus maxLength={120}
                   onChange={e => onNameChange(e.target.value)} placeholder="Ex. Judo Club Atlas" />
          </Field>

          <Field label="Identifiant" hint="Lettres, chiffres et tirets. Sert dans les adresses.">
            <input className="input-dark" value={slug} required maxLength={60}
                   pattern="[a-z0-9]+(-[a-z0-9]+)*"
                   onChange={e => { setSlugTouched(true); setSlug(slugify(e.target.value)) }} />
          </Field>

          <hr style={{ border: 0, borderTop: '1px solid var(--overlay)', margin: '2px 0' }} />

          <Field label="Nom du responsable">
            <input className="input-dark" value={ownerName} required maxLength={120}
                   onChange={e => setOwnerName(e.target.value)} />
          </Field>

          <Field label="E-mail du responsable" hint="Ce compte sera proprietaire du club.">
            <input className="input-dark" type="email" value={ownerEmail} required maxLength={200}
                   onChange={e => setOwnerEmail(e.target.value)} />
          </Field>

          <Field label="Mot de passe provisoire" hint="10 caracteres minimum.">
            <input className="input-dark" type="text" value={ownerPassword} required maxLength={200}
                   onChange={e => setOwnerPassword(e.target.value)} />
          </Field>

          <Field label="Formule">
            <select className="input-dark" value={plan} onChange={e => setPlan(e.target.value)}>
              <option value="trial">Essai 30 jours</option>
              <option value="essentiel">Essentiel</option>
              <option value="club">Club</option>
              <option value="federation">Federation</option>
            </select>
          </Field>

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="btn-dark"
                    style={{ flex: 1, background: 'var(--gold)', borderColor: 'transparent' }}
                    disabled={busy || !ready}>
              {busy ? 'Creation…' : 'Creer le club'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)' }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{hint}</span>}
    </label>
  )
}

function slugify(value: string): string {
  return value
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // enleve les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
