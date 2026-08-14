'use client'

import { useRef, useState } from 'react'
import { X, IdCard, Eye, Upload, Trash2, Pencil, MessageCircle } from 'lucide-react'
import { api, upload, ApiError } from '@/lib/client'
import {
  type MemberRow, subStatus, insStatus, daysUntil,
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
  const sub = subStatus(member)
  const ins = insStatus(member)
  const left = daysUntil(member.sub_expiry)
  const wa = whatsappFor(member, clubName)

  // « saad SBATA » : le prenom porte la fiche, le nom se lit dessous. Tout
  // sur une ligne, un nom compose de quatre mots deborde du bandeau.
  const [head, ...rest] = member.name.trim().split(/\s+/)
  const tail = rest.join(' ')
  const color = AVATAR_COLORS[member.name.charCodeAt(0) % AVATAR_COLORS.length]

  return (
    <div className="compta-modal-overlay" onClick={onClose} role="dialog" aria-modal="true"
         aria-label={`Fiche de ${member.name}`}>
      <div className="compta-modal mdet" onClick={e => e.stopPropagation()}>
        <button className="mdet-close" onClick={onClose} aria-label="Fermer">
          <X size={16} strokeWidth={2.4} />
        </button>

        <header className="mdet-head">
          <span className="mdet-avatar" aria-hidden="true" style={{ background: color }}>
            {(head?.[0] ?? '?').toUpperCase()}
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 className="mdet-name">{head}</h2>
            {tail && <div className="mdet-surname">{tail}</div>}
          </div>
        </header>

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
          <Row label="Téléphone"><span className="mdet-num">{member.phone}</span></Row>
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

        <div className="mdet-actions">
          <a className="btn-ghost" href={waLink(member.phone, wa.message)}
             target="_blank" rel="noopener noreferrer" style={{ flex: 1, justifyContent: 'center' }}>
            <MessageCircle size={15} strokeWidth={2.2} /> WhatsApp
          </a>
          {canWrite && (
            <button className="btn-dark" onClick={onEdit}
                    style={{ flex: 1, justifyContent: 'center',
                             background: 'var(--gold)', borderColor: 'transparent' }}>
              <Pencil size={15} strokeWidth={2.2} /> Modifier
            </button>
          )}
        </div>
      </div>
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
          // Le fichier passe par le Worker : la cle R2 ne sort jamais du
          // serveur, et l'appartenance au club est reverifiee a chaque appel.
          <a className="gf-mini-btn" href={`/api/members/${member.id}/document`}
             target="_blank" rel="noopener noreferrer">
            <Eye size={13} strokeWidth={2.1} /> Voir
          </a>
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
    </div>
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

