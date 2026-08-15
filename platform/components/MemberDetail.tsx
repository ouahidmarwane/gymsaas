'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  X, IdCard, Eye, Upload, Trash2, Pencil, MessageCircle, Camera, Phone, Maximize2,
} from 'lucide-react'
import { api, upload, ApiError } from '@/lib/client'
import { useScrollLock } from '@/lib/scroll-lock'
import {
  type MemberRow, subStatus, insStatus, daysUntil, photoUrl,
  SUB_LABEL, INS_LABEL, SUB_TONE, INS_TONE, whatsappFor, waLink,
} from '@/lib/member-status'

const AVATAR_COLORS = ['#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa']
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—')

/** Les deux seules pieces qu'un club peut demander ici. */
const DOC_TYPES = [
  { key: 'cin' as const, label: 'Carte nationale' },
  { key: 'passeport' as const, label: 'Passeport' },
]
const DOC_LABEL: Record<string, string> = { cin: 'Carte nationale', passeport: 'Passeport' }

/**
 * Fiche d'un membre, en lecture.
 *
 * Le tableau montre ce qu'on compare d'une ligne a l'autre ; la fiche montre
 * ce qu'on regarde quand quelqu'un est devant le comptoir. Elle ne recharge
 * rien : la ligne de la liste porte deja tout, et un aller-retour reseau
 * pour afficher ce qu'on a sous la main ferait clignoter la modale.
 */
export default function MemberDetail({
  member, canWrite, canDelete, clubName, showBelt, onClose, onEdit, onChanged,
}: {
  member: MemberRow
  canWrite: boolean
  /** Retirer une piece d'identite est reserve aux administrateurs. */
  canDelete: boolean
  clubName: string
  showBelt: boolean
  onClose: () => void
  onEdit: () => void
  onChanged: () => void | Promise<void>
}) {
  useScrollLock()

  const sub = subStatus(member)
  const ins = insStatus(member)
  const left = daysUntil(member.sub_expiry)
  const wa = whatsappFor(member, clubName)
  const photo = photoUrl(member)

  // « saad SBATA » : le prenom porte la fiche, le nom se lit dessous. Tout
  // sur une ligne, un nom compose de quatre mots deborde du bandeau.
  const [head, ...rest] = member.name.trim().split(/\s+/)
  const tail = rest.join(' ')
  const color = AVATAR_COLORS[member.name.charCodeAt(0) % AVATAR_COLORS.length]!

  return (
    <div className="compta-modal-overlay mdet-overlay" onClick={onClose}
         role="dialog" aria-modal="true" aria-label={`Fiche de ${member.name}`}
         /* La teinte de la personne diffuse derriere la modale : deux fiches
            ouvertes l'une apres l'autre ne se ressemblent plus. */
         style={{ '--mdet-tint': color } as React.CSSProperties}>
      <div className="compta-modal mdet" onClick={e => e.stopPropagation()}
           style={photo ? ({ '--mdet-photo': `url("${photo}")` } as React.CSSProperties) : undefined}>
        {/* Hors du defilement : la croix reste sous la main quand on descend
            dans la fiche, et elle ne passe pas sous la barre. */}
        <button className="mdet-close" onClick={onClose} aria-label="Fermer">
          <X size={16} strokeWidth={2.4} />
        </button>

        {/*
          Le defilement vit ici, dans un enfant sans rayon, pendant que la
          carte garde le sien avec overflow: hidden. Sur la carte elle-meme,
          la gouttiere de la barre carrait les deux coins de droite : un
          navigateur peint la barre dans un couloir rectangulaire, et le
          rayon du conteneur ne s'y applique pas. Clippee par le parent, elle
          suit maintenant l'arrondi.
        */}
        <div className="mdet-scroll">
        {/* Le prolongement de la photo : floute, tres pale, il descend
            derriere les coordonnees et s'efface avant les boutons. */}
        <div className="mdet-wash" aria-hidden="true" />

        {/*
          Le portrait tient tout le haut, bord a bord, et le nom se pose
          dessus — la fiche contact d'un telephone, pas une vignette dans un
          cadre. Le voile sombre en bas rend le texte lisible quelle que soit
          la photo : sans lui, un portrait en plein soleil avale le nom.
        */}
        <PhotoHero member={member} photo={photo} initial={(head?.[0] ?? '?').toUpperCase()}
                   color={color} canWrite={canWrite} onChanged={onChanged}
                   head={head ?? ''} tail={tail} />

        {/* Les gestes du quotidien, en pastilles, a cheval sur la photo. */}
        <div className="mdet-quick">
          <QuickAction href={`tel:${member.phone.replace(/[^\d+]/g, '')}`}
                       label="Appeler" tone="#3b82f6">
            <Phone size={17} strokeWidth={2.2} />
          </QuickAction>
          <QuickAction href={waLink(member.phone, wa.message)} external
                       label="WhatsApp" tone="#25D366">
            <MessageCircle size={17} strokeWidth={2.2} />
          </QuickAction>
          {canWrite && (
            <QuickAction onClick={onEdit} label="Modifier" tone="var(--gold)">
              <Pencil size={17} strokeWidth={2.2} />
            </QuickAction>
          )}
        </div>

        <div className="mdet-body">
        {/* Memes pastilles que le tableau : leur contraste est deja verifie
            sur les cinq habillages, et deux jeux de couleurs pour un meme
            statut finiraient par diverger. */}
        <div className="mdet-badges">
          <span className={`badge ${SUB_TONE[sub]}`}>{SUB_LABEL[sub]}</span>
          <span className={`badge ${INS_TONE[ins]}`}>{INS_LABEL[ins]}</span>
        </div>

        <h3 className="mdet-section">Informations</h3>
        <div className="mdet-rows">
          {showBelt && member.grade_label && (
            <Row label="Ceinture">
              <span className="mdet-belt">
                <span className="mdet-belt-dot"
                      style={{ background: member.grade_color ?? '#94a3b8' }} />
                {member.grade_label}
              </span>
            </Row>
          )}
          {/* Le telephone est deja en gros sous le nom : le repeter ici
              n'ajoute rien et allonge la liste. */}
          <Row label="Email">{member.email || <span className="mdet-void">—</span>}</Row>
          {member.branch_name && <Row label="Salle">{member.branch_name}</Row>}
          {member.discipline_name && <Row label="Discipline">{member.discipline_name}</Row>}
          <Row label="Inscription"><span className="mdet-num">{day(member.join_date)}</span></Row>
          <Row label="Fin abonnement">
            <span className="mdet-num">{day(member.sub_expiry)}</span>
          </Row>
          <Row label="Jours restants (abo)">
            {/* Un nombre negatif se lit mal : « expiré depuis 12 j » dit la
                meme chose sans faire compter a rebours. */}
            {left === null ? <span className="mdet-void">—</span>
              : left >= 0 ? <span className="mdet-num">{left} j</span>
              : <span className="mdet-num" style={{ color: '#f87171' }}>
                  expiré depuis {Math.abs(left)} j
                </span>}
          </Row>
          <Row label="Assuré">{member.is_insured ? 'Oui' : 'Non'}</Row>
          <Row label="Fin assurance">
            {member.is_insured && member.ins_expiry
              ? <span className="mdet-num">{day(member.ins_expiry)}</span>
              : <span className="mdet-void">Non souscrite</span>}
          </Row>
        </div>

        <h3 className="mdet-section">Documents</h3>
        <IdentityDoc member={member} canWrite={canWrite} canDelete={canDelete}
                     onChanged={onChanged} />
        </div>
        </div>
      </div>
    </div>
  )
}

/** Pastille ronde du bandeau : un lien ou un bouton, jamais les deux. */
function QuickAction({ children, label, tone, href, external, onClick }: {
  children: ReactNode
  label: string
  tone: string
  href?: string
  external?: boolean
  onClick?: () => void
}) {
  const inner = (
    <>
      <span className="mdet-quick-dot" style={{ background: tone }}>{children}</span>
      <span className="mdet-quick-label">{label}</span>
    </>
  )
  return href
    ? <a className="mdet-quick-item" href={href} title={label}
         {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{inner}</a>
    : <button className="mdet-quick-item" onClick={onClick} title={label}>{inner}</button>
}

/**
 * Le portrait, et rien d'autre, en haut de la fiche.
 *
 * Sans photo, l'initiale coloree occupe la meme place : la fiche garde sa
 * silhouette, qu'on ait pris le portrait ou pas. Un cadre vide en attendant
 * aurait donne l'impression d'un chargement qui n'arrive jamais.
 */
function PhotoHero({ member, photo, initial, color, canWrite, onChanged, head, tail }: {
  member: MemberRow
  photo: string | null
  initial: string
  color: string
  canWrite: boolean
  onChanged: () => void | Promise<void>
  head: string
  tail: string
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function send(file: File) {
    // Refuse ici ce que le serveur refuserait : faire monter quatre
    // mega-octets pour lire « format non accepte » est une perte de temps
    // sur la connexion d'une salle de sport.
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setProblem('Format accepté : PNG, JPEG ou WebP.'); return
    }
    if (file.size > 4 * 1024 * 1024) { setProblem('4 Mo maximum.'); return }

    setBusy(true); setProblem(null)
    try {
      await upload('PUT', `/api/members/${member.id}/photo`, file)
      await onChanged()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Envoi impossible')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove() {
    setBusy(true); setProblem(null)
    try {
      await api.del(`/api/members/${member.id}/photo`)
      await onChanged()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Suppression impossible')
    } finally { setBusy(false) }
  }

  return (
    <div className={`mdet-hero${photo ? '' : ' empty'}`}>
      {photo
        // Le portrait est rogne pour tenir le bandeau : le clic ouvre
        // l'original entier, comme sur un telephone.
        ? <button className="mdet-hero-open" onClick={() => setZoom(true)}
                  title="Voir la photo en grand" aria-label="Voir la photo en grand">
            <img className="mdet-hero-img" src={photo} alt={`Photo de ${member.name}`} />
          </button>
        : <span className="mdet-hero-initial" aria-hidden="true"
                style={{ color, background: `radial-gradient(circle at 50% 35%, ${color}33, transparent 72%)` }}>
            {initial}
          </span>}

      {/* Voile sombre en bas. Il n'est pas decoratif : sans lui, un nom
          blanc pose sur un portrait en plein soleil devient illisible, et
          on ne choisit pas la photo que le club televerse. */}
      <div className="mdet-hero-scrim" aria-hidden="true" />

      <div className="mdet-hero-caption">
        <h2 className="mdet-name">{head}</h2>
        {tail && <div className="mdet-surname">{tail}</div>}
        <div className="mdet-hero-phone">Mobile <b>{member.phone}</b></div>
      </div>

      <div className="mdet-hero-tools">
        {/* Voir : disponible meme sans droit d'ecriture. Regarder une photo
            n'est pas la modifier. */}
        {photo && (
          <button className="mdet-hero-btn" onClick={() => setZoom(true)}
                  title="Voir la photo" aria-label="Voir la photo">
            <Maximize2 size={15} strokeWidth={2.2} />
          </button>
        )}
        {canWrite && (
          <button className="mdet-hero-btn" disabled={busy}
                  onClick={() => fileRef.current?.click()}
                  title={photo ? 'Remplacer la photo' : 'Ajouter une photo'}
                  aria-label={photo ? 'Remplacer la photo' : 'Ajouter une photo'}>
            <Camera size={15} strokeWidth={2.2} />
          </button>
        )}
        {canWrite && photo && (
          <button className="mdet-hero-btn" disabled={busy} onClick={remove}
                  title="Retirer la photo" aria-label="Retirer la photo">
            <Trash2 size={15} strokeWidth={2.2} />
          </button>
        )}
        {canWrite && (
          <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp"
                 onChange={e => { const f = e.target.files?.[0]; if (f) send(f) }} />
        )}
      </div>

      <div aria-live="polite">
        {problem && <p role="alert" className="mdet-problem mdet-hero-problem">{problem}</p>}
      </div>

      {zoom && photo && (
        <DocViewer src={photo} title={`Photo de ${member.name}`}
                   onClose={() => setZoom(false)} />
      )}
    </div>
  )
}

/**
 * Piece d'identite : carte nationale OU passeport.
 *
 * Un seul emplacement volontairement. Deux cases auraient laisse la moitie
 * des fiches a moitie remplies, sans qu'on puisse distinguer l'oubli du
 * document qui n'existe pas — un etranger n'a pas de carte nationale
 * marocaine, un mineur n'a souvent pas de passeport.
 */
function IdentityDoc({ member, canWrite, canDelete, onChanged }: {
  member: MemberRow
  canWrite: boolean
  canDelete: boolean
  onChanged: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [viewing, setViewing] = useState(false)
  const [docType, setDocType] = useState<'cin' | 'passeport'>(member.id_doc_type ?? 'cin')
  const [number, setNumber] = useState(member.id_doc_number ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const has = Boolean(member.id_doc_key)

  async function send(file: File) {
    // Refuse ici ce que le serveur refuserait : faire monter quatre mega-
    // octets pour lire « format non accepte » est une perte de temps sur une
    // connexion de salle de sport.
    const ok = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
    if (!ok.includes(file.type)) { setProblem('Format accepté : PNG, JPEG, WebP ou PDF.'); return }
    if (file.size > 4 * 1024 * 1024) { setProblem('4 Mo maximum.'); return }

    setBusy(true); setProblem(null)
    try {
      const q = new URLSearchParams({ type: docType })
      if (number.trim()) q.set('number', number.trim())
      await upload('PUT', `/api/members/${member.id}/document?${q}`, file)
      setOpen(false)
      await onChanged()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Envoi impossible')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function saveNumberOnly() {
    setBusy(true); setProblem(null)
    try {
      const q = new URLSearchParams({ type: docType })
      if (number.trim()) q.set('number', number.trim())
      await api.put(`/api/members/${member.id}/document?${q}`, {})
      setOpen(false)
      await onChanged()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Enregistrement impossible')
    } finally { setBusy(false) }
  }

  async function remove() {
    if (!confirm('Retirer la pièce d’identité ? Le fichier est supprimé définitivement.')) return
    setBusy(true); setProblem(null)
    try {
      await api.del(`/api/members/${member.id}/document`)
      await onChanged()
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Suppression impossible')
    } finally { setBusy(false) }
  }

  return (
    <div className="mdet-rows">
      <div className="mdet-doc">
        <span className="mdet-doc-icon" aria-hidden="true"><IdCard size={16} strokeWidth={2} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mdet-doc-name">
            {has ? DOC_LABEL[member.id_doc_type ?? 'cin'] : 'Pièce d’identité'}
          </div>
          {has && member.id_doc_number && (
            <div className="mdet-doc-meta mdet-num">N° {member.id_doc_number}</div>
          )}
        </div>
        {has
          ? <span className="mdet-doc-ok">Fournie</span>
          : <span className="mdet-void">Non fournie</span>}
      </div>

      <div className="mdet-doc-actions">
        {has && (
          <button className="gf-mini-btn" onClick={() => setViewing(true)}>
            <Eye size={13} strokeWidth={2.1} /> Voir
          </button>
        )}
        {canWrite && (
          <button className="gf-mini-btn" onClick={() => setOpen(o => !o)} disabled={busy}>
            <Upload size={13} strokeWidth={2.1} /> {has ? 'Remplacer' : 'Ajouter'}
          </button>
        )}
        {has && canDelete && (
          <button className="gf-mini-btn" onClick={remove} disabled={busy}
                  style={{ color: '#f87171' }}>
            <Trash2 size={13} strokeWidth={2.1} /> Retirer
          </button>
        )}
      </div>

      {open && canWrite && (
        <div className="mdet-doc-form">
          <div className="mdet-doc-choice">
            {DOC_TYPES.map(t => (
              <button key={t.key} type="button"
                      className={`mdet-choice${docType === t.key ? ' on' : ''}`}
                      onClick={() => setDocType(t.key)}>{t.label}</button>
            ))}
          </div>
          <input className="input-dark" placeholder="Numéro (facultatif)" maxLength={40}
                 value={number} onChange={e => setNumber(e.target.value)} />
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf"
                 disabled={busy}
                 onChange={e => { const f = e.target.files?.[0]; if (f) send(f) }} />
          <p className="mdet-hint">
            PNG, JPEG, WebP ou PDF · 4 Mo maximum. Le fichier n’a pas d’adresse
            publique : il est servi par le serveur, qui vérifie à chaque ouverture
            que le demandeur fait partie de l’équipe de ce club.
          </p>
          {has && (
            <button className="gf-mini-btn" onClick={saveNumberOnly} disabled={busy}>
              Enregistrer sans changer le fichier
            </button>
          )}
        </div>
      )}

      <div aria-live="polite">
        {problem && <p role="alert" className="mdet-problem">{problem}</p>}
      </div>

      {viewing && (
        <DocViewer src={`/api/members/${member.id}/document`}
                   title={`${DOC_LABEL[member.id_doc_type ?? 'cin']} — ${member.name}`}
                   onClose={() => setViewing(false)} />
      )}
    </div>
  )
}

/**
 * Visionneuse de piece, au centre de la page.
 *
 * Le fichier est recupere en memoire plutot que pointe par une balise :
 * c'est ainsi qu'on connait son type reel avant d'afficher quoi que ce soit,
 * et qu'on choisit entre une image et un PDF sans deviner d'apres une
 * extension. L'adresse blob ne quitte pas l'onglet, et elle est liberee a la
 * fermeture — sinon le scan resterait en memoire jusqu'au rechargement.
 */
function DocViewer({ src, title, onClose }: {
  src: string; title: string; onClose: () => void
}) {
  const [blob, setBlob] = useState<{ url: string; type: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useScrollLock()

  useEffect(() => {
    let url: string | null = null
    let alive = true
    fetch(src, { credentials: 'same-origin' })
      .then(async res => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Fichier introuvable' : 'Lecture impossible')
        const body = await res.blob()
        if (!alive) return
        url = URL.createObjectURL(body)
        setBlob({ url, type: body.type })
      })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Lecture impossible') })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [src])

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])

  const isPdf = blob?.type.includes('pdf')

  return createPortal(
    <div className="docview-overlay" onClick={onClose} role="dialog" aria-modal="true"
         aria-label={title}>
      <div className="docview" onClick={e => e.stopPropagation()}>
        <div className="docview-bar">
          <span className="docview-title">{title}</span>
          <button className="mdet-hero-btn" onClick={onClose} aria-label="Fermer">
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        <div className="docview-stage">
          {error && <p className="mdet-problem">{error}</p>}
          {!error && !blob && <p className="mdet-void">Chargement…</p>}
          {blob && (isPdf
            ? <iframe className="docview-pdf" src={blob.url} title={title} />
            : <img className="docview-img" src={blob.url} alt={title} />)}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mdet-row">
      <span className="mdet-row-label">{label}</span>
      <span className="mdet-row-value">{children}</span>
    </div>
  )
}

