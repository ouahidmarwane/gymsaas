'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { X, Camera, Trash2 } from 'lucide-react'
import { api, upload, ApiError } from '@/lib/client'
import { type MemberRow, photoUrl } from '@/lib/member-status'
import { useScrollLock } from '@/lib/scroll-lock'
import { useModalMotion } from '@/lib/modal-motion'
import { celebrate, readNeon } from '@/lib/celebrate'

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
  useScrollLock()
  const { dismiss, cardRef, overlayClass } = useModalMotion(onClose)

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

  /**
   * Photo.
   *
   * A la creation, le membre n'a pas encore d'identifiant : le fichier ne
   * peut donc pas partir tout de suite. Il attend en memoire et suit
   * immediatement l'enregistrement. A la modification il part seul, sans
   * obliger a valider tout le formulaire pour un simple portrait.
   */
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoGone, setPhotoGone] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  /** Mesure pour l'origine de la celebration, tant que la modale est la. */
  const submitRef = useRef<HTMLButtonElement>(null)

  // L'URL d'objet est liberee : sans cela, chaque essai de photo garde son
  // fichier en memoire jusqu'au rechargement de la page.
  useEffect(() => {
    if (!photoFile) { setPhotoPreview(null); return }
    const url = URL.createObjectURL(photoFile)
    setPhotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photoFile])

  const existing = member && !photoGone ? photoUrl(member) : null
  const shown = photoPreview ?? existing

  function pick(file: File) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setProblem('Photo : format accepté PNG, JPEG ou WebP.'); return
    }
    if (file.size > 8 * 1024 * 1024) { setProblem('Photo : 8 Mo maximum.'); return }
    setProblem(null); setPhotoGone(false); setPhotoFile(file)
  }

  async function dropPhoto() {
    // Un simple choix de fichier s'annule sans rien detruire.
    if (photoFile) {
      setPhotoFile(null)
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    if (!editing || !member.photo_key) { setPhotoGone(true); return }
    // Le fichier part de R2 et ne revient pas : c'est le dernier endroit
    // d'ou l'on peut supprimer une photo, et il doit le demander.
    if (!confirm(`Supprimer définitivement la photo de ${member.name} ?`)) return
    setBusy(true)
    try {
      await api.del(`/api/members/${member.id}/photo`)
      setPhotoGone(true)
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Suppression impossible')
    } finally { setBusy(false) }
  }

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

    // Origine de la celebration, mesuree pendant que la modale est encore la.
    let origin: { x: number; y: number } | null = null

    try {
      // `savedId` couvre le cas ou la fiche est passee mais pas la photo :
      // sans lui, un second clic sur « Ajouter » creerait un doublon.
      let id = member?.id ?? savedId
      if (id) await api.patch(`/api/members/${id}`, payload)
      else {
        id = (await api.post<{ id: string }>('/api/members', payload)).id
        setSavedId(id)

        // Le rectangle se prend ICI, pas plus tard.
        //
        // `onSaved()` ferme la modale : le bouton quitte le document, et
        // getBoundingClientRect ne rend plus que des zeros. Les confettis
        // partiraient du coin superieur gauche de l'ecran. On mesure tant
        // que le bouton existe, on declenche apres.
        const r = submitRef.current?.getBoundingClientRect()
        if (r && r.width > 0) origin = { x: r.left + r.width / 2, y: r.top }
      }

      // La photo suit l'enregistrement, jamais l'inverse : un envoi qui
      // echoue ne doit pas faire perdre la fiche deja saisie. C'est aussi
      // pourquoi son echec est signale sans annuler ce qui est ecrit.
      if (photoFile && id) {
        try {
          await upload('PUT', `/api/members/${id}/photo`, photoFile)
        } catch (e) {
          setProblem(e instanceof ApiError
            ? `Membre enregistré, mais la photo n’est pas passée : ${e.message}`
            : 'Membre enregistré, mais la photo n’est pas passée.')
          setBusy(false)
          return
        }
      }
      await onSaved()

      // Apres la confirmation du serveur, jamais avant : une celebration
      // optimiste feterait un membre que la base a refuse. Et apres
      // `onSaved()`, donc au-dessus de la liste deja rafraichie — ce que
      // permettent les coordonnees mises de cote plus haut.
      //
      // La couleur est relue maintenant, pas au chargement du module : un
      // club qui vient de changer sa teinte doit voir la nouvelle.
      if (origin) {
        celebrate({
          x: origin.x, y: origin.y,
          label: 'Membre ajouté',
          neon: true,
          neonColor: readNeon(),
        })
      }
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Enregistrement impossible')
      setBusy(false)
    }
  }

  return (
    <div className={`compta-modal-overlay${overlayClass}`} onClick={dismiss} role="dialog" aria-modal="true"
         aria-label={editing ? `Modifier ${member.name}` : 'Ajouter un membre'}>
      <div ref={cardRef} className="compta-modal" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 18 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
            {editing ? `Modifier ${member.name}` : 'Ajouter un membre'}
          </h2>
          <button className="gf-hide" onClick={dismiss} aria-label="Fermer"><X size={15} /></button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* La photo en premier : c'est ce qu'on regarde d'abord sur la
              fiche, donc ce qu'on cherche d'abord ici. */}
          <div className="mmod-photo">
            <span className="mmod-photo-thumb">
              {shown
                ? <img src={shown} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <Camera size={20} strokeWidth={1.8} style={{ color: 'var(--muted)' }} />}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="gf-mini-btn" disabled={busy}
                        onClick={() => fileRef.current?.click()}>
                  <Camera size={13} strokeWidth={2.1} /> {shown ? 'Changer' : 'Ajouter une photo'}
                </button>
                {shown && (
                  <button type="button" className="gf-mini-btn" disabled={busy}
                          style={{ color: '#f87171' }} onClick={dropPhoto}>
                    <Trash2 size={13} strokeWidth={2.1} /> Retirer
                  </button>
                )}
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                PNG, JPEG ou WebP · 8 Mo maximum
                {!editing && photoFile && ' · envoyée après l’enregistrement'}
              </span>
            </div>
            <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp"
                   onChange={e => { const f = e.target.files?.[0]; if (f) pick(f) }} />
          </div>

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
                    onClick={dismiss} disabled={busy}>Annuler</button>
            <button ref={submitRef} type="submit" className="btn-dark" disabled={busy}
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
