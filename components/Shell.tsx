'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, Users, Award, Wallet, UserCog, SlidersHorizontal,
  ShieldAlert, Building2, Settings, LogOut, Menu, X, Receipt,
  Bell, MessageCircle, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { api, ApiError, privileged, type Me, type Capabilities } from '@/lib/client'
import { SKINS, DEFAULT_THEME } from '@/src/club/branding'
import TopBar from '@/components/TopBar'
import { DisciplineProvider, useDiscipline } from '@/lib/discipline'

// Coquille de l'application : le rail flottant en pilule de 78px, exactement
// comme l'application d'origine. Les classes viennent de globals.css, repris
// tel quel — c'est le systeme visuel du produit, pas une reinterpretation.

interface NavItem {
  href: string
  label: string
  icon: typeof LayoutDashboard
  /**
   * Ecran conditionne a ce que le club pratique reellement, ET a la
   * discipline retenue dans le filtre. Les deux, parce qu'ils ne disent pas
   * la meme chose : le club peut enseigner le karate — donc l'ecran existe —
   * pendant qu'on regarde la musculation, ou il n'a aucun sens.
   */
  needs?: (c: Capabilities, activeHasGrading: boolean) => boolean
}

type GlobalAnnouncement = {
  id: string
  title: string
  content: string
  status: string
  publishedAt: string | null
  createdAt: string
  isRead: number
}

type GlobalConversation = {
  id: string
  type: 'dm' | 'group' | 'team'
  name: string
  last_body: string | null
  last_at: string | null
  updated_at: string
  unread: number
}

type GlobalSupportThread = {
  id: string
  orgId: string
  orgName: string
  updatedAt: string
  lastBody: string | null
  unread: number
}

type GlobalNotice = {
  id: string
  kind: 'announcement' | 'conversation' | 'support'
  title: string
  body: string
  source: string
  at: string
  target: { kind: 'announcements' } | { kind: 'conversation'; id: string } | { kind: 'support'; orgId?: string }
}

type ActiveGlobalNotice = GlobalNotice & { shownAt: number; leaving: boolean }

const GLOBAL_NOTICE_MS = 8_000
const GLOBAL_NOTICE_POLL_MS = 4_000
const GLOBAL_NOTICE_LOGIN_DELAY_MS = 5_000
const GLOBAL_NOTICE_SEEN_KEY = 'gymflow:global-notice-seen'
const GLOBAL_NOTICE_LOGIN_KEY = 'gymflow:notice-login-at'
const MESSAGING_TARGET_KEY = 'gymflow:messaging-target'

/** Ecrans d'un club. Ils n'ont de sens que dans un club. */
const CLUB_NAV: NavItem[] = [
  { href: '/dashboard',      label: 'Tableau de bord',  icon: LayoutDashboard },
  { href: '/members',        label: 'Membres',          icon: Users },
  // Un club de boxe sans ceinture n'a pas de passage de grade. Le lien
  // n'apparait que si au moins une discipline du club est gradee — ET si la
  // discipline retenue dans le filtre l'est. Regarder « Musculation » et
  // garder un onglet « Passage de grade » ouvert sur des ceintures de karate
  // est une reponse a une question qu'on n'a pas posee.
  { href: '/grades',         label: 'Passage de grade', icon: Award,
    needs: (c, graded) => c.hasGrading && graded },
  { href: '/comptabilite',   label: 'Comptabilite',     icon: Wallet },
  { href: '/staff',          label: 'Equipe & droits',  icon: UserCog },
  { href: '/messagerie',     label: 'Messagerie',       icon: MessageCircle },
  { href: '/abonnement',     label: 'Mon abonnement',   icon: Receipt },
  { href: '/setup',          label: 'Configuration',    icon: SlidersHorizontal },
]

/** Un club non configure garde tout : c'est le seul moyen d'aller configurer. */
function allowed(
  items: NavItem[], capabilities: Capabilities | null, activeHasGrading: boolean,
): NavItem[] {
  if (!capabilities) return items
  return items.filter(item => !item.needs || item.needs(capabilities, activeHasGrading))
}

/** Ecrans de la plateforme. L'exploitant supervise, il ne gere aucun club. */
const PLATFORM_NAV: NavItem[] = [
  { href: '/admin',        label: 'Clubs',        icon: Building2 },
  { href: '/messagerie',   label: 'Messagerie',   icon: MessageCircle },
  { href: '/facturation',  label: 'Facturation',  icon: Receipt },
  { href: '/supervision',  label: 'Supervision',  icon: ShieldAlert },
]

/**
 * Le fournisseur de discipline enveloppe la coquille au lieu d'etre rendu
 * par elle.
 *
 * Un composant ne peut pas lire un contexte qu'il pose lui-meme : `useContext`
 * remonte aux fournisseurs situes AU-DESSUS. La coquille rendait
 * `<DisciplineProvider>` dans son propre retour, donc `useDiscipline()` y
 * aurait renvoye la valeur de repli — filtre inerte, `activeHasGrading` a
 * true — et l'onglet des grades ne se serait jamais cache. D'ou la coupure en
 * deux : le fournisseur dehors, tout le reste dedans.
 */
export default function Shell({ children }: { children: ReactNode }) {
  return (
    <DisciplineProvider>
      <ShellBody>{children}</ShellBody>
    </DisciplineProvider>
  )
}

function ShellBody({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { activeHasGrading } = useDiscipline()
  const [me, setMe] = useState<Me | null>(null)
  const [failed, setFailed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [railOpen, setRailOpen] = useState(true)
  const [notices, setNotices] = useState<ActiveGlobalNotice[]>([])
  const [noticeTick, setNoticeTick] = useState(() => Date.now())
  const railRef = useRef<HTMLElement | null>(null)
  const noticeSeenRef = useRef<Set<string>>(new Set())
  const noticeTimersRef = useRef<Map<string, number[]>>(new Map())

  function setDesktopRailOpen(next: boolean) {
    setRailOpen(next)
    try { localStorage.setItem('gf-rail-open', next ? '1' : '0') } catch { /* stockage indisponible */ }
  }

  useEffect(() => {
    let alive = true
    api.get<Me>('/api/me')
      .then(data => { if (alive) setMe(data) })
      .catch(e => {
        if (!alive) return
        if (e instanceof ApiError && e.status === 401) router.replace('/login')
        else setFailed(true)
      })
    return () => { alive = false }
  }, [router])

  useEffect(() => {
    try {
      setRailOpen(localStorage.getItem('gf-rail-open') !== '0')
    } catch { /* stockage indisponible */ }
  }, [])

  useEffect(() => {
    if (!railOpen) return

    function closeOnOutsidePointer(event: PointerEvent) {
      const rail = railRef.current
      const target = event.target
      if (!rail || !(target instanceof Node)) return
      if (window.matchMedia('(max-width: 767px)').matches) return
      if (!rail.contains(target)) setDesktopRailOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [railOpen])

  // La couleur du club ne repeint que --gold : tout le systeme visuel s'y
  // accroche deja (rail actif, barres, graphiques, focus), donc un club change
  // d'identite sans qu'aucune regle de contraste bouge.
  useEffect(() => {
    // Rien n'est pose tant que la session n'a pas repondu. Chaque page monte
    // sa propre coquille : reappliquer un defaut a chaque navigation faisait
    // repasser l'application en sombre le temps de l'aller-retour, ce qui se
    // lit comme un habillage perdu.
    if (!me) return

    // Une fois la session connue, on pose TOUJOURS quelque chose.
    //
    // L'exploitant n'a pas de club : sans repli explicite, ses ecrans
    // gardaient l'habillage et la couleur du dernier club visite. La
    // plateforme se mettait donc aux couleurs de son client, ce qui brouille
    // exactement la frontiere que le mode support existe pour marquer.
    const root = document.documentElement
    const theme = me.branding?.theme
    const accent = theme?.accent ?? DEFAULT_THEME.accent
    root.style.setProperty('--gold', accent)
    root.style.setProperty('--tabs-pill-bg', accent)

    // Deux attributs, deux roles. data-theme porte la base claire ou sombre,
    // que la feuille d'origine connait deja ; data-skin porte la palette
    // par-dessus. Separer les deux evite de dupliquer la feuille claire.
    const skin = theme?.skin ?? DEFAULT_THEME.skin
    root.setAttribute('data-theme', SKINS[skin]?.base ?? 'dark')
    root.setAttribute('data-skin', skin)
    // Memorise pour que le prochain chargement complet peigne juste du
    // premier coup (voir le script de app/layout.tsx).
    try { localStorage.setItem('gf-skin', skin) } catch { /* mode prive */ }
    if (me?.branding?.locale === 'ar') {
      root.setAttribute('lang', 'ar'); root.setAttribute('dir', 'rtl')
    } else {
      root.setAttribute('lang', 'fr'); root.setAttribute('dir', 'ltr')
    }
  }, [me])

  useEffect(() => { setDrawer(false) }, [pathname])

  useEffect(() => () => {
    for (const timers of noticeTimersRef.current.values()) {
      for (const timer of timers) window.clearTimeout(timer)
    }
    noticeTimersRef.current.clear()
  }, [])

  function scheduleNoticeLifecycle(id: string) {
    const existing = noticeTimersRef.current.get(id)
    if (existing) for (const timer of existing) window.clearTimeout(timer)
    const leave = window.setTimeout(() => {
      setNotices(current => current.map(item => item.id === id ? { ...item, leaving: true } : item))
    }, GLOBAL_NOTICE_MS)
    const remove = window.setTimeout(() => {
      setNotices(current => current.filter(item => item.id !== id))
      noticeTimersRef.current.delete(id)
    }, GLOBAL_NOTICE_MS + 560)
    noticeTimersRef.current.set(id, [leave, remove])
  }

  function showNotices(items: GlobalNotice[]) {
    if (items.length === 0) return
    const shownAt = Date.now()
    const added: string[] = []
    setNotices(current => {
      const known = new Set(current.map(item => item.id))
      const next = items
        .filter(item => !known.has(item.id))
        .map(item => {
          added.push(item.id)
          return { ...item, shownAt, leaving: false }
        })
      return next.length ? [...next, ...current].slice(0, 5) : current
    })
    for (const id of added) scheduleNoticeLifecycle(id)
  }

  function dismissNotice(id: string) {
    setNotices(current => current.map(item => item.id === id ? { ...item, leaving: true } : item))
    const existing = noticeTimersRef.current.get(id)
    if (existing) for (const timer of existing) window.clearTimeout(timer)
    const remove = window.setTimeout(() => {
      setNotices(current => current.filter(item => item.id !== id))
      noticeTimersRef.current.delete(id)
    }, 520)
    noticeTimersRef.current.set(id, [remove])
  }

  useEffect(() => {
    for (const item of notices) {
      if (!item.leaving && !noticeTimersRef.current.has(item.id)) scheduleNoticeLifecycle(item.id)
    }
  }, [notices])

  useEffect(() => {
    const canReceiveClubNotices = me?.scope.mode === 'member' && ['owner', 'admin', 'staff'].includes(me.org?.role ?? '')
    const canReceivePlatformSupport = Boolean(me?.isPlatformAdmin && me.scope.mode !== 'support')
    if (!me || (!canReceiveClubNotices && !canReceivePlatformSupport)) {
      setNotices([])
      noticeSeenRef.current = new Set()
      return
    }

    let alive = true
    const noticeStorageKey = `${GLOBAL_NOTICE_SEEN_KEY}:${me.user.id}:${me.org?.id ?? 'platform'}`
    let justLoggedIn = false
    try {
      justLoggedIn = Boolean(sessionStorage.getItem(GLOBAL_NOTICE_LOGIN_KEY))
      if (justLoggedIn) {
        sessionStorage.removeItem(GLOBAL_NOTICE_LOGIN_KEY)
        sessionStorage.removeItem(noticeStorageKey)
        noticeSeenRef.current = new Set()
      } else {
        const stored = JSON.parse(sessionStorage.getItem(noticeStorageKey) ?? '[]') as string[]
        noticeSeenRef.current = new Set(stored.slice(-120))
      }
    } catch { noticeSeenRef.current = new Set() }

    const remember = (id: string) => {
      const seen = noticeSeenRef.current
      seen.add(id)
      const compact = [...seen].slice(-120)
      noticeSeenRef.current = new Set(compact)
      try { sessionStorage.setItem(noticeStorageKey, JSON.stringify(compact)) } catch { /* stockage indisponible */ }
    }
    const enqueueNotices = async () => {
      try {
        const [announcementData, conversationData, supportData] = await Promise.all([
          canReceiveClubNotices
            ? api.get<{ announcements: GlobalAnnouncement[] }>('/api/messaging/announcements')
            : Promise.resolve({ announcements: [] }),
          canReceiveClubNotices
            ? api.get<{ conversations: GlobalConversation[] }>('/api/messaging/conversations')
            : Promise.resolve({ conversations: [] }),
          api.get<{ threads: GlobalSupportThread[] }>('/api/messaging/support/threads'),
        ])
        const announcements = announcementData.announcements
          .filter(item => item.status === 'published' && !item.isRead)
          .sort((a, b) => Date.parse(b.publishedAt ?? b.createdAt) - Date.parse(a.publishedAt ?? a.createdAt))
        const conversations = conversationData.conversations
          .filter(item => item.unread > 0 && item.last_body)
          .sort((a, b) => Date.parse(b.last_at ?? b.updated_at) - Date.parse(a.last_at ?? a.updated_at))
        const supportThreads = supportData.threads
          .filter(item => item.unread > 0 && item.lastBody)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        const candidates: GlobalNotice[] = []
        for (const announcement of announcements) {
          candidates.push({
            id: `announcement:${announcement.id}`,
            kind: 'announcement',
            title: 'Nouvelle annonce GymFlow',
            body: announcement.title,
            source: 'Annonces GymFlow',
            at: announcement.publishedAt ?? announcement.createdAt,
            target: { kind: 'announcements' },
          })
        }
        for (const conversation of conversations) {
          candidates.push({
            id: `conversation:${conversation.id}:${conversation.last_at ?? conversation.updated_at}:${conversation.unread}`,
            kind: 'conversation',
            title: conversation.type === 'team' ? 'Nouveau message équipe' : 'Nouveau message',
            body: conversation.last_body ?? 'Un nouveau message vous attend.',
            source: conversation.name,
            at: conversation.last_at ?? conversation.updated_at,
            target: { kind: 'conversation', id: conversation.id },
          })
        }
        for (const thread of supportThreads) {
          candidates.push({
            id: `support:${thread.id}:${thread.updatedAt}:${thread.unread}`,
            kind: 'support',
            title: canReceivePlatformSupport ? 'Nouveau message support' : 'Nouveau message GymFlow Support',
            body: thread.lastBody ?? 'Un nouveau message support vous attend.',
            source: canReceivePlatformSupport ? thread.orgName : 'GymFlow Support',
            at: thread.updatedAt,
            target: { kind: 'support', ...(canReceivePlatformSupport ? { orgId: thread.orgId } : {}) },
          })
        }
        const pending = candidates
          .filter(item => !noticeSeenRef.current.has(item.id))
          .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        if (!alive || pending.length === 0) return
        for (const item of pending) remember(item.id)
        showNotices(pending)
      } catch { /* les notifications ne doivent jamais perturber l'app */ }
    }

    let pollTimer: number | undefined
    const startPolling = () => {
      void enqueueNotices()
      pollTimer = window.setInterval(() => void enqueueNotices(), GLOBAL_NOTICE_POLL_MS)
    }
    const loginDelay = justLoggedIn ? window.setTimeout(startPolling, GLOBAL_NOTICE_LOGIN_DELAY_MS) : undefined
    if (!justLoggedIn) startPolling()
    return () => {
      alive = false
      if (loginDelay) window.clearTimeout(loginDelay)
      if (pollTimer) window.clearInterval(pollTimer)
    }
  }, [me])

  useEffect(() => {
    if (notices.length === 0) return
    setNoticeTick(Date.now())
    const tick = window.setInterval(() => setNoticeTick(Date.now()), 250)
    return () => window.clearInterval(tick)
  }, [notices.length])

  async function openNotice(item: GlobalNotice) {
    try { sessionStorage.setItem(MESSAGING_TARGET_KEY, JSON.stringify(item.target)) } catch { /* stockage indisponible */ }
    if (item.kind === 'announcement') {
      const id = item.id.replace(/^announcement:/, '')
      await api.post(`/api/messaging/announcements/${encodeURIComponent(id)}/read`).catch(() => undefined)
    }
    dismissNotice(item.id)
    window.dispatchEvent(new Event('gymflow:messaging-target'))
    router.push('/messagerie')
  }

  // Un exploitant sans club qui atterrit sur un ecran de club n'a rien a y
  // voir : ces pages n'ont aucune base a ouvrir. On le renvoie a la
  // supervision plutot que de lui afficher « aucun club actif ».
  useEffect(() => {
    if (!me) return
    const clubRoute = CLUB_NAV.some(n => pathname.startsWith(n.href))
      && !PLATFORM_NAV.some(n => pathname.startsWith(n.href))
    if (clubRoute && me.isPlatformAdmin && !me.org && me.scope.mode !== 'support') {
      router.replace('/admin')
    }
  }, [me, pathname, router])

  /**
   * Abonnement expire : le club se connecte, puis atterrit sur sa page
   * d'abonnement.
   *
   * C'est une redirection, pas un verrou — l'API reste ouverte. Couper
   * reellement l'acces sur une donnee de facturation ferait sortir un bon
   * client au premier decalage de validation.
   *
   * Jamais en mode support : l'exploitant vient justement regarder ce qui se
   * passe dans un club, y compris quand il n'a pas paye.
   */
  useEffect(() => {
    if (!me || me.isPlatformAdmin || me.scope.mode === 'support') return
    if (!me.org || pathname.startsWith('/abonnement') || pathname.startsWith('/account')) return

    let alive = true
    api.get<{ expired: boolean }>('/api/subscription')
      .then(s => { if (alive && s.expired) router.replace('/abonnement') })
      .catch(() => { /* la facturation ne doit jamais fermer l'application */ })
    return () => { alive = false }
  }, [me, pathname, router])

  if (failed) {
    return (
      <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 6 }}>
            Impossible de charger votre session.
          </p>
          <p style={{ color: 'var(--muted)', fontSize: '0.875rem', marginBottom: 18 }}>
            La connexion au serveur a echoue.
          </p>
          <button className="btn-dark" onClick={() => location.reload()}>Reessayer</button>
        </div>
      </div>
    )
  }

  const inSupport = me?.scope.mode === 'support'

  // Trois contextes, trois rails.
  //
  // En mode support, on est DANS le club : le rail est celui du club, rien
  // d'autre. Y laisser Clubs et Supervision melangeait deux niveaux et
  // laissait croire qu'on etait encore sur la plateforme. La sortie vit dans
  // la barre rouge, ou elle est impossible a manquer.
  //
  // Hors support, un exploitant sans club ne voit que la plateforme : lui
  // montrer Membres ou Comptabilite n'aurait rien a ouvrir.
  const clubNav = allowed(CLUB_NAV, me?.capabilities ?? null, activeHasGrading)

  const items = !me
    ? []
    : inSupport
      ? clubNav
      : me.isPlatformAdmin && !me.org
        ? PLATFORM_NAV
        : me.isPlatformAdmin
          ? [...PLATFORM_NAV, ...clubNav]
          : clubNav

  // Hors support, un exploitant sans club represente la plateforme, pas un
  // club : ni logo de club, ni nom de club a afficher.
  const isOperatorView = Boolean(me?.isPlatformAdmin && !me?.org && !inSupport)
  const clubName = isOperatorView ? 'GymFlow' : (me?.branding?.name ?? 'GymFlow')
  const logo = isOperatorView ? null : me?.branding?.logoUrl

  return (
    <div className={`app-shell${railOpen ? ' rail-open' : ' rail-closed'}`}>
      {inSupport && me && <SupportBar me={me} onLeft={() => { router.replace('/admin'); router.refresh() }} />}

      {/* Rail flottant, desktop */}
      <aside
        ref={railRef}
        className={`rail-shell rail-desktop${railOpen ? ' expanded' : ' collapsed'}`}
        aria-label="Navigation principale"
      >
        <div className="rail-head">
          <Link href="/dashboard" className="rail-logo" title={clubName}>
            {logo
              ? <img src={logo} alt="" />
              : <span>
                  {clubName.slice(0, 2).toUpperCase()}
                </span>}
          </Link>
          <Link href="/dashboard" className="rail-brand" title={clubName}>
            <strong>{clubName}</strong>
            <small>{isOperatorView ? 'Plateforme' : 'Club sportif'}</small>
          </Link>
        </div>

        <button
          className="rail-toggle"
          type="button"
          aria-label={railOpen ? 'Replier la navigation' : 'Ouvrir la navigation'}
          aria-expanded={railOpen}
          onClick={() => setDesktopRailOpen(!railOpen)}
        >
          {railOpen ? <ChevronLeft size={16} strokeWidth={2.4} /> : <ChevronRight size={16} strokeWidth={2.4} />}
        </button>

        <nav className="rail-nav">
          {items.map(item => {
            const Icon = item.icon
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rail-btn${active ? ' active' : ''}`}
                title={item.label}
                data-tooltip={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={19} strokeWidth={2.1} />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="rail-bottom">
          <Link href="/account" className="rail-btn" title="Mon compte" data-tooltip="Mon compte" aria-label="Mon compte">
            <Settings size={19} strokeWidth={2.1} />
            <span>Mon compte</span>
          </Link>
          {me && (
            <div className="rail-user" title={me.user.name}>
              <span className="rail-avatar" aria-hidden="true">
                {me.user.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="rail-user-copy">
                <strong>{me.user.name}</strong>
                <small>{me.user.email}</small>
              </span>
            </div>
          )}
          <button
            className="rail-btn"
            title="Se deconnecter"
            data-tooltip="Se deconnecter"
            aria-label="Se deconnecter"
            onClick={async () => { await api.post('/api/auth/logout'); router.replace('/login') }}
          >
            <LogOut size={18} strokeWidth={2.1} />
            <span>Se deconnecter</span>
          </button>
        </div>
      </aside>

      {/* Barre + tiroir, mobile */}
      <div className="mobile-topbar">
        <button
          className="icon-btn"
          onClick={() => setDrawer(true)}
          aria-label="Ouvrir la navigation"
          style={{ width: 40, height: 40 }}
        >
          <Menu size={19} strokeWidth={2.1} />
        </button>
        <div className="mobile-topbar-logo">
          {logo && <img className="mobile-topbar-img" src={logo} alt="" />}
          <span className="mobile-topbar-name">{clubName}</span>
        </div>
        <span style={{ width: 40 }} />
      </div>

      {drawer && (
        <div className="mobile-drawer-overlay" onClick={() => setDrawer(false)}>
          <div
            className="mobile-drawer"
            onClick={e => e.stopPropagation()}
            style={{
              background: 'linear-gradient(180deg, rgba(23,25,32,0.98), rgba(14,16,22,0.99))',
              padding: '1.5rem 1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{clubName}</span>
              <button className="icon-btn" onClick={() => setDrawer(false)} aria-label="Fermer"
                      style={{ width: 36, height: 36 }}>
                <X size={17} />
              </button>
            </div>
            {items.map(item => {
              const Icon = item.icon
              const active = pathname === item.href || pathname.startsWith(item.href + '/')
              return (
                <Link key={item.href} href={item.href} className={`sidebar-link${active ? ' active' : ''}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.7rem 0.85rem',
                               borderRadius: 12, fontSize: '0.875rem', fontWeight: 600,
                               color: active ? '#fff' : 'var(--muted)',
                               background: active ? 'var(--gold)' : 'transparent' }}>
                  <Icon size={18} strokeWidth={2.1} /> {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {notices.length > 0 && (
        <div className="global-message-notice-stack" aria-live="polite" aria-label="Notifications">
          {notices.map((item, index) => (
            <GlobalNoticeCard
              key={item.id}
              notice={item}
              index={index}
              now={noticeTick}
              onOpen={() => void openNotice(item)}
              onClose={() => dismissNotice(item.id)}
            />
          ))}
        </div>
      )}

      <main className={`app-main${pathname.startsWith('/messagerie') ? ' messaging-app-main' : ''}`}>
        {/* Barre du haut : filtre discipline, alertes, historique, reglages.
            Uniquement dans un club — la plateforme n'a ni discipline ni
            journal de club a montrer. */}
        {me && !pathname.startsWith('/messagerie') && (inSupport || me.org) && (
          <TopBar canSeeHistory={['owner', 'admin'].includes(me.org?.role ?? '') || inSupport} />
        )}
        {children}
      </main>
    </div>
  )
}

/**
 * En mode support, l'interface doit le dire en permanence. C'est le seul
 * endroit ou elle hausse deliberement la voix : un exploitant qui oublie ou
 * il se trouve est exactement le risque a eliminer.
 */
function SupportBar({ me, onLeft }: { me: Me; onLeft: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [canWrite, setCanWrite] = useState(me.scope.canWrite)

  return (
    <div
      role="status"
      style={{
        position: 'fixed', top: 0, insetInline: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0.5rem 1rem',
        background: '#b91c1c', color: '#fff', fontSize: '0.8rem',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
    >
      <ShieldAlert size={16} strokeWidth={2.2} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Mode support &mdash; <strong>{me.branding?.name ?? me.scope.orgId}</strong>
        {canWrite ? ' · modification activee' : ' · lecture seule'}
      </span>
      <span style={{ marginInlineStart: 'auto', display: 'flex', gap: 6, flex: 'none' }}>
        <button
          className="btn-ghost"
          style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem',
                   background: 'rgba(255,255,255,0.16)', color: '#fff', borderColor: 'transparent' }}
          disabled={busy !== null}
          onClick={async () => {
            setBusy('mode')
            try {
              await (canWrite
                ? api.post('/api/admin/support/read-only')
                : privileged(() => api.post('/api/admin/support/write')))
              setCanWrite(!canWrite)
            } finally { setBusy(null) }
          }}
        >
          {canWrite ? 'Passer en lecture seule' : 'Activer la modification'}
        </button>
        <button
          className="btn-ghost"
          style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem',
                   background: 'rgba(255,255,255,0.16)', color: '#fff', borderColor: 'transparent' }}
          disabled={busy !== null}
          onClick={async () => {
            setBusy('exit')
            try { await api.del('/api/admin/support'); onLeft() } finally { setBusy(null) }
          }}
        >
          Sortir
        </button>
      </span>
    </div>
  )
}

function GlobalNoticeCard({
  notice, index, now, onOpen, onClose,
}: {
  notice: ActiveGlobalNotice
  index: number
  now: number
  onOpen: () => void
  onClose: () => void
}) {
  const elapsed = Math.min(GLOBAL_NOTICE_MS, Math.max(0, now - notice.shownAt))
  const remaining = Math.max(0, Math.ceil((GLOBAL_NOTICE_MS - elapsed) / 1000))
  const progress = Math.max(0, 1 - (elapsed / GLOBAL_NOTICE_MS))
  const Icon = notice.kind === 'announcement' ? Bell : MessageCircle

  return (
    <aside
      className={`announcement-notice global-message-notice${notice.leaving ? ' is-leaving' : ''}`}
      role="status"
      aria-label={notice.title}
      style={{
        '--notice-progress': `${progress * 360}deg`,
        '--notice-index': index,
      } as CSSProperties}
    >
      <button className="global-message-notice-main" onClick={onOpen}>
        <span className="announcement-notice-icon"><Icon size={19} strokeWidth={2.2} /></span>
        <span className="global-message-notice-copy">
          <b>{notice.title}</b>
          <strong>{notice.source}</strong>
          <small>{notice.body}</small>
        </span>
        <span className="global-message-notice-countdown" aria-label={`Disparait dans ${remaining} secondes`}>
          {remaining}s
        </span>
      </button>
      <button className="announcement-notice-close" onClick={onClose} aria-label="Fermer la notification">
        <X size={16} />
      </button>
    </aside>
  )
}
