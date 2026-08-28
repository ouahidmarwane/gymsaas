'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, Users, Award, Wallet, UserCog, SlidersHorizontal,
  ShieldAlert, Building2, Settings, LogOut, Menu, X, Receipt,
  MessageCircle, ChevronLeft, ChevronRight, ShieldCheck,
} from 'lucide-react'
import { api, ApiError, privileged, type Me, type Capabilities } from '@/lib/client'
import { DEFAULT_THEME, normalizeAccent } from '@/src/club/branding'
import TopBar, { NotificationAccess } from '@/components/TopBar'
import ThemeModeToggle from '@/components/ThemeModeToggle'
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
  /** Roles du club autorises a voir l'ecran dans la navigation. */
  roles?: Array<'owner' | 'admin' | 'staff' | 'viewer'>
}

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
  { href: '/connexions',     label: 'Supervision',      icon: ShieldCheck,
    roles: ['owner', 'admin'] },
  { href: '/messagerie',     label: 'Messagerie',       icon: MessageCircle },
  { href: '/abonnement',     label: 'Mon abonnement',   icon: Receipt },
  { href: '/setup',          label: 'Configuration',    icon: SlidersHorizontal },
]

/** Un club non configure garde tout : c'est le seul moyen d'aller configurer. */
function allowed(
  items: NavItem[], capabilities: Capabilities | null, activeHasGrading: boolean,
  role: string | null,
): NavItem[] {
  return items.filter(item =>
    (!item.roles || item.roles.includes(role as 'owner' | 'admin' | 'staff' | 'viewer')) &&
    (!capabilities || !item.needs || item.needs(capabilities, activeHasGrading)))
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
  const railRef = useRef<HTMLElement | null>(null)

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
    const accent = normalizeAccent(theme?.accent ?? DEFAULT_THEME.accent)
    root.style.setProperty('--gold', accent)
    root.style.setProperty('--tabs-pill-bg', accent)

    // Deux attributs, deux roles. data-theme est maintenant la preference
    // jour/nuit de cet appareil ; data-skin reste l'habillage du club.
    // Changer de club ne doit donc jamais forcer un retour en mode sombre.
    const skin = theme?.skin ?? DEFAULT_THEME.skin
    root.setAttribute('data-skin', skin)
    if (!root.hasAttribute('data-theme')) root.setAttribute('data-theme', 'light')
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
  const clubNav = allowed(
    CLUB_NAV, me?.capabilities ?? null, activeHasGrading, me?.org?.role ?? null,
  )

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

  const canUseClubMessaging = me?.scope.mode === 'member' && ['owner', 'admin', 'staff'].includes(me.org?.role ?? '')
  const canUseSupportMessaging = Boolean((me?.isPlatformAdmin && me.scope.mode !== 'support') ||
    ['owner', 'admin'].includes(me?.org?.role ?? ''))
  const canUseClubNotifications = Boolean(me?.org || inSupport)

  return (
    <div className={`app-shell${railOpen ? ' rail-open' : ' rail-closed'}${inSupport ? ' support-mode' : ''}`}>
      {inSupport && me && <SupportBar me={me} onLeft={() => { router.replace('/admin'); router.refresh() }} />}

      {me && (
        <NotificationAccess
          canUseClubNotifications={canUseClubNotifications}
          canUseClubMessaging={Boolean(canUseClubMessaging)}
          canUseSupportMessaging={canUseSupportMessaging}
        />
      )}

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
              background: 'var(--rail-bg)',
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

      {me && (pathname.startsWith('/messagerie') || (!inSupport && !me.org)) && (
        <div className={`shell-mode-toggle-floating${pathname.startsWith('/messagerie') ? ' on-messaging' : ''}`}>
          <ThemeModeToggle />
        </div>
      )}

      <main className={`app-main${pathname.startsWith('/messagerie') ? ' messaging-app-main' : ''}`}>
        {/* Barre du haut : filtre discipline, alertes, historique, reglages.
            Uniquement dans un club — la plateforme n'a ni discipline ni
            journal de club a montrer. */}
        {me && !pathname.startsWith('/messagerie') && (inSupport || me.org) && (
          <TopBar
            canSeeHistory={['owner', 'admin'].includes(me.org?.role ?? '') || inSupport}
          />
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
