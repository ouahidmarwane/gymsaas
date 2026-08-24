'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  X, IdCard, Eye, Upload, Trash2, Pencil, MessageCircle, Camera, Phone,
  Maximize2, Minimize2, Plus, Minus,
} from 'lucide-react'
import { api, upload, ApiError } from '@/lib/client'
import { useScrollLock } from '@/lib/scroll-lock'
import { useModalMotion } from '@/lib/modal-motion'
import { useWindowZ, useRegisterWindow, useHasFloatingWindow } from '@/lib/window-stack'
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
  const { dismiss, cardRef, overlayClass } = useModalMotion(onClose)

  /**
   * La fiche est une fenetre parmi les autres des qu'une visionneuse est
   * ouverte : elle prend son rang dans la meme pile, et un clic dedans la
   * ramene devant. Sans cela, elle serait toujours soit au-dessus soit
   * en-dessous des visionneuses, et « cliquer a cote » y reviendrait
   * fatalement — ce qui n'est pas un bureau, c'est une bascule.
   */
  const { z: sheetZ, raise: raiseSheet } = useWindowZ()
  const floating = useHasFloatingWindow()

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
    <div className={`compta-modal-overlay mdet-overlay${overlayClass}${floating ? ' stacked' : ''}`}
         /* Tant qu'aucune fenetre n'est ouverte, la fiche est une modale
            ordinaire : le fond la ferme. Des qu'il y en a une, le fond cesse
            de fermer — on referme la fenetre d'abord, et un clic a cote ne
            doit pas emporter la fiche sous une piece d'identite ouverte. */
         onClick={floating ? undefined : dismiss}
         role="dialog" aria-modal={floating ? undefined : true}
         aria-label={`Fiche de ${member.name}`}
         /* La teinte de la personne diffuse derriere la modale : deux fiches
            ouvertes l'une apres l'autre ne se ressemblent plus. */
         style={{ '--mdet-tint': color, zIndex: floating ? sheetZ : undefined } as React.CSSProperties}>
      <div ref={cardRef} className="compta-modal mdet"
           onClick={e => e.stopPropagation()}
           onPointerDown={raiseSheet}
           style={photo ? ({ '--mdet-photo': `url("${photo}")` } as React.CSSProperties) : undefined}>
        {/* Hors du defilement : la croix reste sous la main quand on descend
            dans la fiche, et elle ne passe pas sous la barre. */}
        <button className="mdet-close" onClick={dismiss} aria-label="Fermer">
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
    if (file.size > 8 * 1024 * 1024) { setProblem('8 Mo maximum.'); return }

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

      {/*
        Deux boutons, pas trois. La corbeille etait ici, collee a la croix de
        fermeture : un geste manque supprimait la photo sans rien demander.
        Une action destructrice n'a rien a faire a cote du bouton que l'on
        vise le plus souvent. Le retrait vit dans « Modifier », ou l'on va
        deja quand on veut changer quelque chose, et il demande confirmation.
      */}
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
    if (file.size > 8 * 1024 * 1024) { setProblem('8 Mo maximum.'); return }

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

  /**
   * Une fenetre, pas une modale.
   *
   * Son rang vient de la pile partagee : elle passe devant quand on la
   * clique, et les autres gardent leur ordre relatif. Deux visionneuses
   * ouvertes — une piece d'identite et l'agrandissement de la photo — se
   * rangent donc l'une par rapport a l'autre, et pas seulement par rapport
   * a la fiche.
   */
  const { z, raise } = useWindowZ()
  useRegisterWindow()

  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ id: number; fromX: number; fromY: number; baseX: number; baseY: number } | null>(null)

  useScrollLock()
  const { dismiss, cardRef, overlayClass } = useModalMotion(onClose)

  /** Deplacement a la barre de titre, comme une fenetre. */
  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    // Pas de deplacement depuis la croix : on veut fermer, pas trainer.
    if ((e.target as Element).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      id: e.pointerId, fromX: e.clientX, fromY: e.clientY, baseX: pos.x, baseY: pos.y,
    }
  }

  useEffect(() => {
    function move(e: PointerEvent) {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      // Borne : la barre de titre doit rester attrapable. Poussee hors de
      // l'ecran, la fenetre ne se recupere plus qu'au rechargement.
      const limitX = window.innerWidth / 2
      const limitY = window.innerHeight / 2
      setPos({
        x: Math.max(-limitX, Math.min(limitX, d.baseX + (e.clientX - d.fromX))),
        y: Math.max(-limitY, Math.min(limitY, d.baseY + (e.clientY - d.fromY))),
      })
    }
    function up(e: PointerEvent) {
      if (drag.current?.id === e.pointerId) drag.current = null
    }
    // Sur window : relacher le doigt hors de la barre doit terminer le geste,
    // pas laisser la fenetre collee au curseur.
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

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

  const isPdf = blob?.type.includes('pdf')

  return createPortal(
    /* La couche n'est qu'un repere de position : elle ne capte aucun clic,
       elle n'a pas de voile. Un voile par fenetre assombrirait l'ecran deux
       fois avec deux visionneuses ouvertes — et un bureau ne s'assombrit pas
       quand on ouvre une fenetre. */
    <div className={`docview-layer${overlayClass}`} style={{ zIndex: z }}
         role="dialog" aria-label={title}>
      <div ref={cardRef} className="docview"
           style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
           /* En phase de remontee, et SANS stopPropagation.
              La version precedente utilisait onPointerDownCapture avec un
              stopPropagation : en capture, arreter la propagation empeche
              l'evenement de DESCENDRE jusqu'aux enfants — la barre de titre
              ne recevait donc jamais son onPointerDown, et la fenetre ne se
              deplacait pas. */
           onPointerDown={raise}>
        <div className="docview-bar"
             onPointerDown={startDrag}
             /* Double-clic sur la barre : retour au centre, quand on l'a
                perdue de vue en la poussant trop loin. */
             onDoubleClick={() => setPos({ x: 0, y: 0 })}>
          <span className="docview-title">{title}</span>
          {/* Echap ferme aussi : c'est la croix au clavier, pas un clic a
              cote. Le reste ne ferme rien. */}
          <button className="mdet-hero-btn" onClick={dismiss} aria-label="Fermer">
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        {error && <div className="docview-stage"><p className="mdet-problem">{error}</p></div>}
        {!error && !blob && <div className="docview-stage"><p className="mdet-void">Chargement…</p></div>}
        {blob && (isPdf
          ? <div className="docview-stage">
              <iframe className="docview-pdf" src={blob.url} title={title} />
            </div>
          : <ImageStage url={blob.url} title={title} />)}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Image que l'on peut agrandir et deplacer.
 *
 * Une piece d'identite scannee se lit rarement entiere a l'ecran : le numero
 * est en petits caracteres dans un coin. La vue s'ouvre donc ajustee, puis
 * la molette agrandit et le glisser promene — a la taille reelle des pixels
 * envoyes, jamais une version reduite.
 *
 * Le deplacement se fait en `transform` pur, sans toucher a la mise en page :
 * une image de huit millions de pixels doit suivre le curseur sans a-coups.
 */
function ImageStage({ url, title }: { url: string; title: string }) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ id: number; fromX: number; fromY: number; panX: number; panY: number } | null>(null)

  const MIN = 1
  const MAX = 6
  const movable = zoom > 1

  function apply(next: number, origin?: { x: number; y: number }) {
    const z = Math.min(MAX, Math.max(MIN, next))
    // Revenu a l'ajuste, l'image se recentre : laisser un decalage la ferait
    // reapparaitre de travers au zoom suivant.
    if (z === 1) { setPan({ x: 0, y: 0 }); setZoom(1); return }
    if (origin) {
      // Le point sous le curseur reste sous le curseur : sans cela, zoomer
      // sur un detail l'ecarte de l'ecran et il faut le rechercher.
      const ratio = z / zoom
      setPan(p => ({
        x: origin.x - (origin.x - p.x) * ratio,
        y: origin.y - (origin.y - p.y) * ratio,
      }))
    }
    setZoom(z)
  }

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault()
    const box = e.currentTarget.getBoundingClientRect()
    apply(zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18), {
      x: e.clientX - box.left - box.width / 2,
      y: e.clientY - box.top - box.height / 2,
    })
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!movable) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, fromX: e.clientX, fromY: e.clientY, panX: pan.x, panY: pan.y }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    setPan({ x: d.panX + (e.clientX - d.fromX), y: d.panY + (e.clientY - d.fromY) })
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) drag.current = null
  }

  return (
    <>
      <div className={`docview-stage docview-pannable${movable ? ' movable' : ''}`}
           onWheel={onWheel}
           onPointerDown={onPointerDown}
           onPointerMove={onPointerMove}
           onPointerUp={onPointerUp}
           onPointerCancel={onPointerUp}
           // Double-clic : bascule entre ajuste et deux fois, le geste que
           // tout le monde essaie en premier sur une image.
           onDoubleClick={() => apply(zoom > 1 ? 1 : 2)}>
        <img className="docview-img" src={url} alt={title} draggable={false}
             style={{
               transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
               // Pas de transition pendant le glisser : elle ferait trainer
               // l'image derriere le curseur.
               transition: drag.current ? 'none' : 'transform 0.12s ease-out',
             }} />
      </div>

      <div className="docview-zoom">
        <button className="mdet-hero-btn" onClick={() => apply(zoom / 1.4)}
                disabled={zoom <= MIN} title="Réduire" aria-label="Réduire">
          <Minus size={15} strokeWidth={2.4} />
        </button>
        <span className="docview-zoom-value">{Math.round(zoom * 100)} %</span>
        <button className="mdet-hero-btn" onClick={() => apply(zoom * 1.4)}
                disabled={zoom >= MAX} title="Agrandir" aria-label="Agrandir">
          <Plus size={15} strokeWidth={2.4} />
        </button>
        <button className="mdet-hero-btn" onClick={() => apply(1)}
                disabled={zoom === 1} title="Ajuster" aria-label="Ajuster">
          <Minimize2 size={14} strokeWidth={2.2} />
        </button>
      </div>
    </>
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

