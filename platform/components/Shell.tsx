'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, Users, Award, Trophy, Wallet, UserCog, SlidersHorizontal,
  ShieldAlert, Building2, Settings, LogOut, Menu, X,
} from 'lucide-react'
import { api, ApiError, type Me } from '@/lib/client'

// Coquille de l'application : le rail flottant en pilule de 78px, exactement
// comme l'application d'origine. Les classes viennent de globals.css, repris
// tel quel — c'est le systeme visuel du produit, pas une reinterpretation.

interface NavItem {
  href: string
  label: string
  icon: typeof LayoutDashboard
}

/** Ecrans d'un club. Ils n'ont de sens que dans un club. */
const CLUB_NAV: NavItem[] = [
  { href: '/dashboard',      label: 'Tableau de bord',  icon: LayoutDashboard },
  { href: '/members',        label: 'Membres',          icon: Users },
  { href: '/grades',         label: 'Passage de grade', icon: Award },
  { href: '/championships',  label: 'Championnats',     icon: Trophy },
  { href: '/comptabilite',   label: 'Comptabilite',     icon: Wallet },
  { href: '/staff',          label: 'Equipe & droits',  icon: UserCog },
  { href: '/setup',          label: 'Configuration',    icon: SlidersHorizontal },
]

/** Ecrans de la plateforme. L'exploitant supervise, il ne gere aucun club. */
const PLATFORM_NAV: NavItem[] = [
  { href: '/admin',       label: 'Clubs',       icon: Building2 },
  { href: '/supervision', label: 'Supervision', icon: ShieldAlert },
]

export default function Shell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [me, setMe] = useState<Me | null>(null)
  const [failed, setFailed] = useState(false)
  const [drawer, setDrawer] = useState(false)

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

  // La couleur du club ne repeint que --gold : tout le systeme visuel s'y
  // accroche deja (rail actif, barres, graphiques, focus), donc un club change
  // d'identite sans qu'aucune regle de contraste bouge.
  useEffect(() => {
    const root = document.documentElement
    const accent = me?.branding?.theme.accent
    if (accent) {
      root.style.setProperty('--gold', accent)
      root.style.setProperty('--tabs-pill-bg', accent)
    }
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
    if (clubRoute && me.isPlatformAdmin && !me.org && me.scope.mode !== 'support') {
      router.replace('/admin')
    }
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
  const items = !me
    ? []
    : inSupport
      ? CLUB_NAV
      : me.isPlatformAdmin && !me.org
        ? PLATFORM_NAV
        : me.isPlatformAdmin
          ? [...PLATFORM_NAV, ...CLUB_NAV]
          : CLUB_NAV

  // Hors support, un exploitant sans club represente la plateforme, pas un
  // club : ni logo de club, ni nom de club a afficher.
  const isOperatorView = Boolean(me?.isPlatformAdmin && !me?.org && !inSupport)
  const clubName = isOperatorView ? 'GymFlow' : (me?.branding?.name ?? 'GymFlow')
  const logo = isOperatorView ? null : me?.branding?.logoUrl

  return (
    <div className="app-shell">
      {inSupport && me && <SupportBar me={me} onLeft={() => { router.replace('/admin'); router.refresh() }} />}

      {/* Rail flottant, desktop */}
      <aside className="rail-shell rail-desktop" aria-label="Navigation principale">
        <Link href="/dashboard" className="rail-logo" title={clubName}>
          {logo
            ? <img src={logo} alt="" />
            : <span style={{ fontWeight: 800, fontSize: '0.8rem', color: '#fff' }}>
                {clubName.slice(0, 2).toUpperCase()}
              </span>}
        </Link>

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
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={19} strokeWidth={2.1} />
              </Link>
            )
          })}
        </nav>

        <div className="rail-bottom">
          <Link href="/account" className="rail-btn" title="Mon compte" aria-label="Mon compte">
            <Settings size={19} strokeWidth={2.1} />
          </Link>
          {me && (
            <span className="rail-avatar" title={me.user.name} aria-hidden="true">
              {me.user.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <button
            className="rail-btn"
            title="Se deconnecter"
            aria-label="Se deconnecter"
            onClick={async () => { await api.post('/api/auth/logout'); router.replace('/login') }}
          >
            <LogOut size={18} strokeWidth={2.1} />
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

      <main className="app-main">{children}</main>
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
              await api.post(canWrite ? '/api/admin/support/read-only' : '/api/admin/support/write')
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
