'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Bell, History, Settings, ShieldAlert, CalendarClock, UserPlus, Trash2,
  Pencil, CreditCard, Award, Check,
} from 'lucide-react'
import { api } from '@/lib/client'
import SlidingTabs from '@/components/SlidingTabs'
import ThemeModeToggle from '@/components/ThemeModeToggle'
import { useDiscipline } from '@/lib/discipline'

/**
 * Barre du haut : filtre discipline au centre, alertes / historique /
 * reglages a droite. Reprise de l'application d'origine, classes comprises.
 *
 * Le filtre ne s'affiche pas partout. Plusieurs ecrans raisonnent sur autre
 * chose que la discipline — la comptabilite compte de l'argent, la
 * supervision des sessions, l'equipe des comptes — et y proposer un filtre
 * laisserait croire qu'il agit.
 *
 * `/setup` est le cas le plus net, et le plus genant : c'est l'ecran ou l'on
 * DECLARE les disciplines. Un filtre qui les trie au-dessus de la liste qui
 * les cree n'a aucun sens, et il invite a croire qu'il cache des sports au
 * lieu de filtrer un contenu.
 */
const NO_FILTER = ['/comptabilite', '/supervision', '/staff', '/admin',
                   '/facturation', '/abonnement', '/setup']

interface Alert {
  id: string
  kind: string
  severity: 'info' | 'warn' | 'danger'
  title: string
  detail: string | null
  href: string | null
  at: string | null
}

interface Entry {
  id: number
  action: string
  entity: string | null
  entity_name: string | null
  detail: string | null
  actor_name: string | null
  created_at: string
}

const REFRESH_MS = 60_000

export default function TopBar({ canSeeHistory }: { canSeeHistory: boolean }) {
  const pathname = usePathname()
  const { active, setActive, disciplines, visible } = useDiscipline()
  const [open, setOpen] = useState<'alerts' | 'history' | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [now, setNow] = useState(() => Date.now())

  // La pastille se charge partout : c'est son interet, alerter depuis
  // n'importe quel ecran. La liste, elle, n'est tiree qu'a l'ouverture.
  useEffect(() => {
    let alive = true
    const load = () => api.get<{ items: Alert[] }>('/api/notifications')
      .then(d => { if (alive) { setAlerts(d.items); setNow(Date.now()) } })
      .catch(() => {})
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [pathname])

  useEffect(() => {
    if (open !== 'history' || !canSeeHistory) return
    api.get<{ entries: Entry[] }>('/api/audit')
      .then(d => setEntries(d.entries)).catch(() => {})
  }, [open, canSeeHistory])

  const showFilter = visible && !NO_FILTER.some(p => pathname.startsWith(p))
  const unread = alerts.length

  return (
    <div className="page-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {/* Cale gauche : c'est elle qui centre reellement le filtre. */}
      <div className="page-actions-spacer" style={{ flex: 1, minWidth: 0 }} />

      {showFilter && (
        <div className="global-disc-filter">
          <SlidingTabs
            items={[
              { key: 'all', label: 'Toutes disciplines' },
              ...disciplines.map(d => ({ key: d.id, label: d.name })),
            ]}
            value={active}
            onChange={setActive}
          />
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center',
                    gap: 10, justifyContent: 'flex-end' }}>
        <ThemeModeToggle />
        <Dropdown
          label="Alertes"
          icon={<Bell size={17} strokeWidth={2.1} />}
          count={unread}
          isOpen={open === 'alerts'}
          onToggle={() => setOpen(open === 'alerts' ? null : 'alerts')}
          title="Alertes"
          note={unread === 0 ? 'Rien a signaler' : `${unread} a traiter`}
          footer={{ href: '/members', label: 'Voir les membres' }}
        >
          {alerts.length === 0 ? (
            <p className="notif-empty">
              Rien a signaler. Une echeance qui approche, une assurance manquante ou une
              connexion inhabituelle apparaitrait ici.
            </p>
          ) : alerts.map(a => (
            <Link key={a.id} href={a.href ?? '#'} className="notif-item notif-item-unread"
                  onClick={() => setOpen(null)}>
              <span className="notif-item-icon" style={{ color: toneOf(a.severity) }}>
                {a.kind === 'subscription' ? <CreditCard size={15} strokeWidth={2.2} />
                  : a.kind === 'security' ? <ShieldAlert size={15} strokeWidth={2.2} />
                  : <CalendarClock size={15} strokeWidth={2.2} />}
              </span>
              <span className="notif-item-body">
                <span className="notif-item-name">{a.title}</span>
                <span className="notif-item-msg">
                  {[a.detail, a.at ? relative(a.at, now) : null].filter(Boolean).join(' · ')}
                </span>
              </span>
            </Link>
          ))}
        </Dropdown>

        {canSeeHistory && (
          <Dropdown
            label="Historique"
            icon={<History size={17} strokeWidth={2.1} />}
            count={0}
            isOpen={open === 'history'}
            onToggle={() => setOpen(open === 'history' ? null : 'history')}
            title="Historique"
            note="Tout ce qui a change"
          >
            {entries.length === 0 ? (
              <p className="notif-empty">Aucune activite enregistree pour l&apos;instant.</p>
            ) : entries.slice(0, 40).map(e => (
              <div key={e.id} className="notif-item">
                <span className="notif-item-icon" style={{ color: 'var(--muted)' }}>
                  {iconFor(e.action)}
                </span>
                <span className="notif-item-body">
                  <span className="notif-item-name">
                    {ACTION_LABEL[e.action] ?? e.action}
                    {e.entity_name ? ` — ${e.entity_name}` : ''}
                  </span>
                  <span className="notif-item-msg">
                    {[e.actor_name, relative(e.created_at, now)].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </div>
            ))}
          </Dropdown>
        )}

        <Link href="/account" className="icon-btn" aria-label="Parametres du compte">
          <Settings size={17} strokeWidth={2.1} />
        </Link>
      </div>
    </div>
  )
}

/** Bouton a pastille et panneau deroulant, ferme au clic exterieur et a Echap. */
function Dropdown({
  label, icon, count, isOpen, onToggle, title, note, footer, children,
}: {
  label: string
  icon: React.ReactNode
  count: number
  isOpen: boolean
  onToggle: () => void
  title: string
  note: string
  footer?: { href: string; label: string }
  children: React.ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onToggle()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onToggle() }
    // En capture : un lien du panneau qui navigue ne doit pas laisser le
    // panneau ouvert derriere lui.
    document.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [isOpen, onToggle])

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={onToggle} aria-label={label}
              aria-expanded={isOpen} aria-haspopup="true">
        {icon}
        {count > 0 && <span className="notif-count-badge">{count > 99 ? '99+' : count}</span>}
      </button>

      {isOpen && (
        <div className="notif-dropdown" role="dialog" aria-label={title}>
          <div className="notif-dropdown-header">
            <span className="notif-dropdown-title">{title}</span>
            <span className="dz-card-note">{note}</span>
          </div>
          <div className="notif-dropdown-body">{children}</div>
          {footer && (
            <Link href={footer.href} className="notif-dropdown-footer" onClick={onToggle}>
              {footer.label}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

const ACTION_LABEL: Record<string, string> = {
  member_add: 'Membre ajoute',
  member_update: 'Membre modifie',
  member_archive: 'Membre archive',
  payment_add: 'Encaissement',
  payment_reverse: 'Encaissement corrige',
  payment_refund: 'Remboursement',
  prices_update: 'Tarifs modifies',
  subscription_renew: 'Abonnement renouvele',
  grade_session: 'Passage de grade programme',
  grade_decision: 'Grade decide',
  branch_add: 'Salle ajoutee',
  discipline_add: 'Discipline ajoutee',
}

function iconFor(action: string) {
  if (action.startsWith('payment')) return <CreditCard size={15} strokeWidth={2.2} />
  if (action.startsWith('grade')) return <Award size={15} strokeWidth={2.2} />
  if (action.endsWith('_add')) return <UserPlus size={15} strokeWidth={2.2} />
  if (action.endsWith('_archive')) return <Trash2 size={15} strokeWidth={2.2} />
  if (action.endsWith('_update')) return <Pencil size={15} strokeWidth={2.2} />
  return <Check size={15} strokeWidth={2.2} />
}

const toneOf = (s: Alert['severity']) =>
  s === 'danger' ? '#f87171' : s === 'warn' ? '#f59e0b' : 'var(--muted)'

function relative(iso: string, now: number): string {
  const seconds = Math.floor((now - Date.parse(iso)) / 1000)
  if (seconds < 0) return 'a venir'
  if (seconds < 60) return "a l'instant"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  return `il y a ${Math.floor(hours / 24)} j`
}
