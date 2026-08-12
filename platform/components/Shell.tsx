'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { api, ApiError, type Me } from '@/lib/client'
import styles from './shell.module.css'

const CLUB_NAV = [
  { href: '/dashboard', label: 'Tableau de bord' },
  { href: '/members',   label: 'Membres' },
]

export default function Shell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [me, setMe] = useState<Me | null>(null)
  const [failed, setFailed] = useState(false)

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

  // La couleur du club ne peint que les actions, la selection et le focus.
  // Le reste du systeme est fige, donc aucune teinte de club ne peut casser
  // le contraste du texte ou de la chrome.
  useEffect(() => {
    const accent = me?.branding?.theme.accent
    const root = document.documentElement
    if (accent) {
      root.style.setProperty('--primary', accent)
      root.style.setProperty('--primary-hover', accent)
      root.style.setProperty('--primary-ring', `color-mix(in oklch, ${accent} 36%, transparent)`)
    }
    const mode = me?.branding?.theme.mode
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode)
    else root.removeAttribute('data-theme')

    if (me?.branding?.locale === 'ar') {
      root.setAttribute('lang', 'ar'); root.setAttribute('dir', 'rtl')
    } else {
      root.setAttribute('lang', 'fr'); root.setAttribute('dir', 'ltr')
    }
  }, [me])

  if (failed) {
    return (
      <div className={styles.centered}>
        <p className={styles.problemTitle}>Impossible de charger votre session.</p>
        <p className={styles.problemBody}>
          La connexion au serveur a echoue. Reessayez dans un instant.
        </p>
        <button className="btn btn-secondary" onClick={() => location.reload()}>
          Reessayer
        </button>
      </div>
    )
  }

  if (!me) return <ShellSkeleton />

  const inSupport = me.scope.mode === 'support'
  const nav = me.isPlatformAdmin && !inSupport
    ? [{ href: '/admin', label: 'Clubs' }, ...CLUB_NAV]
    : CLUB_NAV

  return (
    <div className={styles.shell} data-support={inSupport || undefined}>
      {inSupport && <SupportBar me={me} onLeft={() => { router.replace('/admin'); router.refresh() }} />}

      <aside className={styles.side}>
        <div className={styles.brand}>
          {me.branding?.logoUrl
            ? <img className={styles.logo} src={me.branding.logoUrl} alt="" width={28} height={28} />
            : <span className={styles.logoFallback} aria-hidden="true">
                {(me.branding?.name ?? 'GF').slice(0, 2).toUpperCase()}
              </span>}
          <span className={styles.brandName}>{me.branding?.name ?? 'GymFlow'}</span>
        </div>

        <nav className={styles.nav} aria-label="Navigation principale">
          {nav.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={styles.navItem}
              aria-current={pathname === item.href ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={styles.foot}>
          <div className={styles.who}>
            <span className={styles.whoName}>{me.user.name}</span>
            <span className={styles.whoMeta}>
              {inSupport ? 'Support plateforme' : (me.org?.role ?? 'Sans club')}
            </span>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => { await api.post('/api/auth/logout'); router.replace('/login') }}
          >
            Quitter
          </button>
        </div>
      </aside>

      <main className={styles.main}>{children}</main>
    </div>
  )
}

/**
 * En mode support, l'interface doit le dire en permanence. C'est le seul
 * endroit ou elle hausse deliberement la voix : un exploitant qui oublie ou
 * il se trouve est exactement le risque a eliminer.
 */
function SupportBar({ me, onLeft }: { me: Me; onLeft: () => void }) {
  const [busy, setBusy] = useState<'write' | 'exit' | null>(null)
  const [canWrite, setCanWrite] = useState(me.scope.canWrite)

  return (
    <div className={styles.supportBar} role="status">
      <span className={styles.supportDot} aria-hidden="true" />
      <span className={styles.supportText}>
        Mode support &mdash; <strong>{me.branding?.name ?? me.scope.orgId}</strong>
        {canWrite
          ? <span className={styles.supportWrite}> &middot; ecriture activee</span>
          : <span className={styles.supportRead}> &middot; lecture seule</span>}
      </span>

      <div className={styles.supportActions}>
        {!canWrite && (
          <button
            className="btn btn-secondary btn-sm"
            data-busy={busy === 'write'}
            onClick={async () => {
              setBusy('write')
              try { await api.post('/api/admin/support/write'); setCanWrite(true) }
              finally { setBusy(null) }
            }}
          >
            Activer l&apos;ecriture
          </button>
        )}
        <button
          className="btn btn-secondary btn-sm"
          data-busy={busy === 'exit'}
          onClick={async () => {
            setBusy('exit')
            try { await api.del('/api/admin/support'); onLeft() }
            finally { setBusy(null) }
          }}
        >
          Sortir
        </button>
      </div>
    </div>
  )
}

function ShellSkeleton() {
  return (
    <div className={styles.shell}>
      <aside className={styles.side}>
        <div className={styles.brand}>
          <span className="skeleton" style={{ width: 28, height: 28, borderRadius: 6 }} />
          <span className="skeleton" style={{ width: '7rem', height: '0.875rem' }} />
        </div>
        <nav className={styles.nav} aria-hidden="true">
          {[0, 1, 2].map(i => (
            <span key={i} className="skeleton" style={{ height: '2rem', margin: '0 0.5rem' }} />
          ))}
        </nav>
      </aside>
      <main className={styles.main} />
    </div>
  )
}
