'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Bell, ChevronDown, ChevronUp, History, MessageCircle, Settings, ShieldAlert, CalendarClock, UserPlus, Trash2,
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
const NO_FILTER = ['/comptabilite', '/supervision', '/connexions', '/staff', '/admin',
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

interface ConversationPreview {
  id: string
  type: 'dm' | 'group' | 'team'
  name: string
  last_body: string | null
  last_at: string | null
  updated_at: string
  unread: number
}

interface AnnouncementPreview {
  id: string
  title: string
  content: string
  status: string
  publishedAt: string | null
  createdAt: string
  isRead: number
}

interface SupportThreadPreview {
  id: string
  orgId: string
  orgName: string
  updatedAt: string
  lastBody: string | null
  unread: number
}

const REFRESH_MS = 60_000
const MESSAGING_TARGET_KEY = 'gymflow:messaging-target'

export default function TopBar({
  canSeeHistory,
}: {
  canSeeHistory: boolean
}) {
  const pathname = usePathname()
  const { active, setActive, disciplines, visible } = useDiscipline()
  const [open, setOpen] = useState<'alerts' | 'history' | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (open !== 'history' || !canSeeHistory) return
    api.get<{ entries: Entry[] }>('/api/audit')
      .then(d => { setEntries(d.entries); setNow(Date.now()) }).catch(() => {})
  }, [open, canSeeHistory])

  const showFilter = visible && !NO_FILTER.some(p => pathname.startsWith(p))

  return (
    <div
      className={`page-actions${showFilter ? ' page-actions-with-filter' : ''}`}
      style={{ display: 'flex', alignItems: 'center', gap: 10 }}
    >
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

export function NotificationAccess({
  canUseClubNotifications,
  canUseClubMessaging,
  canUseSupportMessaging,
}: {
  canUseClubNotifications: boolean
  canUseClubMessaging: boolean
  canUseSupportMessaging: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [centerOpen, setCenterOpen] = useState(false)
  const [centerClosing, setCenterClosing] = useState(false)
  const [centerLoading, setCenterLoading] = useState(false)
  const [centerError, setCenterError] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [conversations, setConversations] = useState<ConversationPreview[]>([])
  const [announcements, setAnnouncements] = useState<AnnouncementPreview[]>([])
  const [supportThreads, setSupportThreads] = useState<SupportThreadPreview[]>([])
  const [now, setNow] = useState(() => Date.now())
  const closeTimer = useRef<number | null>(null)
  const dragStartY = useRef<number | null>(null)
  const dragOpened = useRef(false)

  const openCenter = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setCenterClosing(false)
    setCenterOpen(true)
  }, [])

  const closeCenter = useCallback(() => {
    if (!centerOpen || centerClosing) return
    setCenterClosing(true)
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      setCenterOpen(false)
      setCenterClosing(false)
      closeTimer.current = null
    }, 230)
  }, [centerClosing, centerOpen])

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  useEffect(() => {
    if (!canUseClubNotifications) {
      setAlerts([])
      return
    }
    let alive = true
    const load = () => api.get<{ items: Alert[] }>('/api/notifications')
      .then(d => { if (alive) { setAlerts(d.items); setNow(Date.now()) } })
      .catch(() => {})
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [canUseClubNotifications, pathname])

  const loadMessageSummaries = useCallback(async (withSpinner = false) => {
    if (withSpinner) setCenterLoading(true)
    const failures: string[] = []
    const read = async <T,>(label: string, request: Promise<T>, fallback: T): Promise<T> => {
      try { return await request } catch {
        failures.push(label)
        return fallback
      }
    }
    try {
      const [conversationData, announcementData, supportData] = await Promise.all([
        canUseClubMessaging
          ? read('conversations', api.get<{ conversations: ConversationPreview[] }>('/api/messaging/conversations'), { conversations: [] })
          : Promise.resolve({ conversations: [] }),
        read('annonces', api.get<{ announcements: AnnouncementPreview[] }>('/api/messaging/announcements'), { announcements: [] }),
        canUseSupportMessaging
          ? read('support', api.get<{ threads: SupportThreadPreview[] }>('/api/messaging/support/threads'), { threads: [] })
          : Promise.resolve({ threads: [] }),
      ])
      setConversations(conversationData.conversations)
      setAnnouncements(announcementData.announcements)
      setSupportThreads(supportData.threads)
      setCenterError(failures.length > 0
        ? `Certaines informations n'ont pas pu etre chargees : ${failures.join(', ')}.`
        : null)
      setNow(Date.now())
    } finally {
      if (withSpinner) setCenterLoading(false)
    }
  }, [canUseClubMessaging, canUseSupportMessaging])

  useEffect(() => {
    void loadMessageSummaries()
    const timer = setInterval(() => void loadMessageSummaries(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [loadMessageSummaries, pathname])

  useEffect(() => {
    if (!centerOpen) return
    void loadMessageSummaries(true)
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') closeCenter() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [centerOpen, closeCenter, loadMessageSummaries])

  const unreadMessages = useMemo(() => (
    conversations.reduce((sum, item) => sum + item.unread, 0)
    + announcements.filter(item => item.status === 'published' && !item.isRead).length
    + supportThreads.reduce((sum, item) => sum + item.unread, 0)
  ), [announcements, conversations, supportThreads])
  const unread = alerts.length + unreadMessages
  const urgent = alerts.some(item => item.severity === 'danger' || item.severity === 'warn')
  const accessTone = urgent ? 'alert' : unreadMessages > 0 ? 'normal' : 'idle'
  const recentConversations = useMemo(() => (
    conversations
      .filter(item => item.last_body)
      .sort((a, b) => Date.parse(b.last_at ?? b.updated_at) - Date.parse(a.last_at ?? a.updated_at))
      .slice(0, 8)
  ), [conversations])
  const recentAnnouncements = useMemo(() => (
    announcements
      .filter(item => item.status === 'published')
      .sort((a, b) => Date.parse(b.publishedAt ?? b.createdAt) - Date.parse(a.publishedAt ?? a.createdAt))
      .slice(0, 5)
  ), [announcements])
  const recentSupport = useMemo(() => (
    supportThreads
      .filter(item => item.lastBody)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 4)
  ), [supportThreads])

  function openMessagingTarget(target: { kind: 'announcements' } | { kind: 'conversation'; id: string } | { kind: 'support'; orgId?: string }) {
    try { sessionStorage.setItem(MESSAGING_TARGET_KEY, JSON.stringify(target)) } catch { /* stockage indisponible */ }
    window.dispatchEvent(new Event('gymflow:messaging-target'))
    closeCenter()
    router.push('/messagerie')
  }

  function openAlert(href: string | null) {
    closeCenter()
    if (href) router.push(href)
  }

  function startAccessDrag(event: PointerEvent<HTMLButtonElement>) {
    dragStartY.current = event.clientY
    dragOpened.current = false
  }

  function finishAccessDrag(event: PointerEvent<HTMLButtonElement>) {
    const start = dragStartY.current
    dragStartY.current = null
    if (start !== null && event.clientY - start > 18 && !centerOpen) {
      dragOpened.current = true
      openCenter()
    }
  }

  return (
    <>
      <button
        className={`notification-access-row${centerOpen && !centerClosing ? ' is-open' : ''}`}
        type="button"
        data-tone={accessTone}
        onPointerDown={startAccessDrag}
        onPointerUp={finishAccessDrag}
        onPointerCancel={() => { dragStartY.current = null }}
        onClick={() => {
          if (dragOpened.current) {
            dragOpened.current = false
            return
          }
          centerOpen && !centerClosing ? closeCenter() : openCenter()
        }}
        aria-label={centerOpen && !centerClosing ? 'Remonter le panneau de notifications' : 'Descendre le panneau de notifications'}
        aria-expanded={centerOpen && !centerClosing}
        aria-haspopup="dialog"
      >
        <ChevronDown className="notification-access-chevron" size={15} strokeWidth={2.4} />
        <span className="notif-count-badge" aria-label={`${unread} notification(s) non lue(s)`}>
          {unread > 99 ? '99+' : unread}
        </span>
      </button>

      {centerOpen && (
        <>
          <NotificationCenter
            closing={centerClosing}
            tone={accessTone}
            alerts={alerts}
            conversations={recentConversations}
            announcements={recentAnnouncements}
            supportThreads={recentSupport}
            loading={centerLoading}
            now={now}
            error={centerError}
            onRefresh={() => loadMessageSummaries(true)}
            onOpenAlert={openAlert}
            onOpenConversation={id => openMessagingTarget({ kind: 'conversation', id })}
            onOpenAnnouncements={() => openMessagingTarget({ kind: 'announcements' })}
            onOpenSupport={orgId => openMessagingTarget({ kind: 'support', ...(orgId ? { orgId } : {}) })}
          />
          <button
            className={`notification-center-close-bottom${centerClosing ? ' is-closing' : ''}`}
            type="button"
            onClick={closeCenter}
            aria-label="Fermer le centre de notifications"
          >
            <ChevronUp size={15} strokeWidth={2.4} />
          </button>
        </>
      )}
    </>
  )
}

function NotificationCenter({
  closing, tone, alerts, conversations, announcements, supportThreads, loading, now,
  error, onRefresh, onOpenAlert, onOpenConversation, onOpenAnnouncements, onOpenSupport,
}: {
  closing: boolean
  tone: 'alert' | 'normal' | 'idle'
  alerts: Alert[]
  conversations: ConversationPreview[]
  announcements: AnnouncementPreview[]
  supportThreads: SupportThreadPreview[]
  loading: boolean
  now: number
  error: string | null
  onRefresh: () => Promise<void>
  onOpenAlert: (href: string | null) => void
  onOpenConversation: (id: string) => void
  onOpenAnnouncements: () => void
  onOpenSupport: (orgId?: string) => void
}) {
  const totalItems = alerts.length + conversations.length + announcements.length + supportThreads.length

  return (
    <section className={`notification-center${closing ? ' is-closing' : ''}`} data-tone={tone} role="dialog" aria-modal="true" aria-label="Centre de notifications">
      <div className="notification-center-clock" aria-hidden="true">
        <strong>{new Date(now).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong>
        <span>{new Date(now).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </div>

      <div className="notification-center-stack">
        <NotificationCenterGroup title="Alertes" note={alerts.length === 0 ? 'Rien a traiter' : `${alerts.length} a traiter`}>
          {alerts.length === 0 ? (
            <p className="notification-center-empty">Aucune alerte active pour le moment.</p>
          ) : alerts.slice(0, 8).map(alert => (
            <button key={alert.id} className="notification-center-card tone-alert" type="button" onClick={() => onOpenAlert(alert.href)}>
              <span className="notification-center-icon" style={{ color: toneOf(alert.severity) }}>
                {alert.kind === 'subscription' ? <CreditCard size={18} strokeWidth={2.2} />
                  : alert.kind === 'security' ? <ShieldAlert size={18} strokeWidth={2.2} />
                  : <CalendarClock size={18} strokeWidth={2.2} />}
              </span>
              <span className="notification-center-copy">
                <span className="notification-center-meta">
                  <b>GymFlow</b>
                  {alert.at && <time>{relative(alert.at, now)}</time>}
                </span>
                <strong>{alert.title}</strong>
                {alert.detail && <small>{alert.detail}</small>}
              </span>
            </button>
          ))}
        </NotificationCenterGroup>

        <NotificationCenterGroup title="Messagerie" note={conversations.length === 0 && announcements.length === 0 && supportThreads.length === 0 ? 'Aucun message recent' : 'Messages et annonces'}>
          {loading && totalItems === 0 ? <p className="notification-center-empty">Chargement des messages...</p> : null}
          {error && (
            <div className="notification-center-error" role="status">
              <span>{error}</span>
              <button type="button" onClick={() => void onRefresh()} disabled={loading}>
                {loading ? 'Actualisation...' : 'Reessayer'}
              </button>
            </div>
          )}
          {announcements.map(item => (
            <button key={`announcement-${item.id}`} className={`notification-center-card tone-normal${item.isRead ? '' : ' unread'}`} type="button" onClick={onOpenAnnouncements}>
              <span className="notification-center-icon"><Bell size={18} strokeWidth={2.2} /></span>
              <span className="notification-center-copy">
                <span className="notification-center-meta">
                  <b>Annonces GymFlow</b>
                  <time>{relative(item.publishedAt ?? item.createdAt, now)}</time>
                </span>
                <strong>{item.title}</strong>
                <small>{item.content}</small>
              </span>
            </button>
          ))}
          {supportThreads.map(item => (
            <button key={`support-${item.id}`} className={`notification-center-card tone-normal${item.unread > 0 ? ' unread' : ''}`} type="button" onClick={() => onOpenSupport(item.orgId)}>
              <span className="notification-center-icon"><ShieldAlert size={18} strokeWidth={2.2} /></span>
              <span className="notification-center-copy">
                <span className="notification-center-meta">
                  <b>GymFlow Support</b>
                  <time>{relative(item.updatedAt, now)}</time>
                </span>
                <strong>{item.orgName}</strong>
                <small>{item.lastBody}</small>
              </span>
              {item.unread > 0 && <span className="notification-center-unread">{item.unread > 99 ? '99+' : item.unread}</span>}
            </button>
          ))}
          {conversations.map(item => (
            <button key={`conversation-${item.id}`} className={`notification-center-card tone-normal${item.unread > 0 ? ' unread' : ''}`} type="button" onClick={() => onOpenConversation(item.id)}>
              <span className="notification-center-icon"><MessageCircle size={18} strokeWidth={2.2} /></span>
              <span className="notification-center-copy">
                <span className="notification-center-meta">
                  <b>{item.type === 'team' ? 'Canal equipe' : item.type === 'group' ? 'Groupe' : 'Message prive'}</b>
                  <time>{relative(item.last_at ?? item.updated_at, now)}</time>
                </span>
                <strong>{item.name}</strong>
                <small>{item.last_body}</small>
              </span>
              {item.unread > 0 && <span className="notification-center-unread">{item.unread > 99 ? '99+' : item.unread}</span>}
            </button>
          ))}
          {!loading && conversations.length === 0 && announcements.length === 0 && supportThreads.length === 0 && (
            <p className="notification-center-empty">Aucun message recent dans la messagerie.</p>
          )}
        </NotificationCenterGroup>
      </div>
    </section>
  )
}

function NotificationCenterGroup({
  title, note, children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <div className="notification-center-group">
      <header className="notification-center-group-head">
        <h2>{title}</h2>
        <span>{note}</span>
      </header>
      <div className="notification-center-list">{children}</div>
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
