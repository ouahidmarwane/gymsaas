'use client'

import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import type { MemberRow } from '@/lib/member-status'

interface Branch { id: string; name: string }
interface Discipline { id: string; name: string }

/**
 * Ajout et modification d'un membre, dans la meme modale.
 *
 * Deux formulaires separes divergeaient au premier champ ajoute : l'un
 * gagnait la date d'adhesion, l'autre non, et personne ne s'en apercevait
 * avant qu'un club ne s'en plaigne.
 */
export default function MemberModal({
  member, branches, disciplines, onClose, onSaved,
}: {
  member: MemberRow | null
  branches: Branch[]
  disciplines: Discipline[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const editing = member !== null
  const today = new Date().toISOString().slice(0, 10)

  const [name, setName] = useState(member?.name ?? '')
  const [phone, setPhone] = useState(member?.phone ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [branchId, setBranchId] = useState(member?.branch_id ?? branches[0]?.id ?? '')
  const [disciplineId, setDisciplineId] = useState(member?.discipline_id ?? disciplines[0]?.id ?? '')
  const [joinDate, setJoinDate] = useState(member?.join_date?.slice(0, 10) ?? today)
  const [subExpiry, setSubExpiry] = useState(member?.sub_expiry?.slice(0, 10) ?? '')
  const [isInsured, setIsInsured] = useState(Boolean(member?.is_insured))
  const [insExpiry, setInsExpiry] = useState(member?.ins_expiry?.slice(0, 10) ?? '')

  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) { setProblem('Le nom est obligatoire.'); return }
    if (!phone.trim()) { setProblem('Le telephone est obligatoire.'); return }
    // Une assurance cochee sans echeance produirait un membre « assure »
    // dont personne ne sait jusqu'a quand : le tableau afficherait
    // « Non souscrite » a cote d'une pastille verte.
    if (isInsured && !insExpiry) { setProblem('Indiquez la fin de l’assurance.'); return }

    setBusy(true); setProblem(null)
    const payload = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      branchId: branchId || null,
      disciplineId: disciplineId || null,
      joinDate: joinDate || null,
      subExpiry: subExpiry || null,
      isInsured,
      insExpiry: isInsured ? insExpiry : null,
    }

    try {
      if (editing) await api.patch(`/api/members/${member.id}`, payload)
      else await api.post('/api/members', payload)
      await onSaved()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Enregistrement impossible')
      setBusy(false)
    }
  }

  return (
    <div className="compta-modal-overlay" onClick={onClose} role="dialog" aria-modal="true"
         aria-label={editing ? `Modifier ${member.name}` : 'Ajouter un membre'}>
      <div className="compta-modal" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 18 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
            {editing ? `Modifier ${member.name}` : 'Ajouter un membre'}
          </h2>
          <button className="gf-hide" onClick={onClose} aria-label="Fermer"><X size={15} /></button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Nom complet">
            <input className="input-dark" value={name} required autoFocus maxLength={200}
                   onChange={e => { setName(e.target.value); setProblem(null) }} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Téléphone">
              <input className="input-dark" value={phone} required inputMode="tel" maxLength={30}
                     onChange={e => { setPhone(e.target.value); setProblem(null) }} />
            </Field>
            <Field label="E-mail" hint="facultatif">
              <input className="input-dark" type="email" value={email} maxLength={200}
                     onChange={e => setEmail(e.target.value)} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {branches.length > 0 && (
              <Field label="Salle">
                <select className="input-dark" value={branchId}
                        onChange={e => setBranchId(e.target.value)}>
                  <option value="">—</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
            {disciplines.length > 0 && (
              <Field label="Discipline">
                <select className="input-dark" value={disciplineId}
                        onChange={e => setDisciplineId(e.target.value)}>
                  <option value="">—</option>
                  {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Inscrit le"
                   hint="la vraie date, pas celle de la saisie">
              <input className="input-dark" type="date" value={joinDate} max={today}
                     onChange={e => setJoinDate(e.target.value)} />
            </Field>
            <Field label="Fin d’abonnement">
              <input className="input-dark" type="date" value={subExpiry}
                     onChange={e => setSubExpiry(e.target.value)} />
            </Field>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: '0.85rem',
                          fontWeight: 600, cursor: 'pointer' }}>
            <input type="checkbox" checked={isInsured} style={{ accentColor: 'var(--gold)' }}
                   onChange={e => { setIsInsured(e.target.checked); setProblem(null) }} />
            Membre assuré
          </label>

          {isInsured && (
            <Field label="Fin d’assurance">
              <input className="input-dark" type="date" value={insExpiry}
                     onChange={e => { setInsExpiry(e.target.value); setProblem(null) }} />
            </Field>
          )}

          <div aria-live="polite">
            {problem && (
              <p role="alert" style={{
                padding: '0.6rem 0.85rem', borderRadius: 12,
                background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                color: '#fca5a5', fontSize: '0.82rem', fontWeight: 600,
              }}>{problem}</p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="btn-ghost" style={{ flex: 1 }}
                    onClick={onClose} disabled={busy}>Annuler</button>
            <button type="submit" className="btn-dark" disabled={busy}
                    style={{ flex: 1, background: 'var(--gold)', borderColor: 'transparent' }}>
              {busy ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--muted)' }}>
        {label}{hint && <span style={{ fontWeight: 500 }}> · {hint}</span>}
      </span>
      {children}
    </label>
  )
}
