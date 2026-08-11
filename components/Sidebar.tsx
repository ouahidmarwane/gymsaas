'use client'
// components/Sidebar.tsx — rail d'icônes flottant (maquette Activity Planner)
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { signOut } from '@/lib/actions'
import DesktopViewToggle from '@/components/DesktopViewToggle'
import { useT } from '@/lib/i18n'
import { useDiscipline } from '@/lib/discipline-context'
import type { Profile } from '@/types'
import clsx from 'clsx'
import { LayoutDashboard, Users, Award, Trophy, Wallet, ShieldCheck, LogOut, Menu, Activity } from 'lucide-react'

// karateOnly : Grades et Championnats sont des concepts propres au karaté.
// Ils ne sont visibles que lorsque la discipline active est « karate » ou
// « Toutes » ; ils disparaissent en Full contact / Aérobic (isolation
// complète entre disciplines). Piloté par le filtre global de la barre du
// haut — l'admin peut toujours revenir à Karaté/Toutes depuis ce filtre.
const NAV_ITEMS = [
  { href: '/dashboard',     labelKey: 'nav_dashboard',    icon: LayoutDashboard, roles: ['admin','receptionist','viewer'], badge: null,     karateOnly: false },
  { href: '/members',       labelKey: 'nav_members',      icon: Users,           roles: ['admin','receptionist','viewer'], badge: null,     karateOnly: false },
  { href: '/grades',        labelKey: 'nav_grades',       icon: Award,           roles: ['admin','receptionist','viewer'], badge: 'grades', karateOnly: true  },
  { href: '/championships', labelKey: 'nav_championships',icon: Trophy,          roles: ['admin','receptionist'],          badge: null,     karateOnly: true  },
  { href: '/comptabilite',  labelKey: 'nav_accounting',   icon: Wallet,          roles: ['admin'],                         badge: null,     karateOnly: false },
  { href: '/staff',         labelKey: 'nav_staff',        icon: ShieldCheck,     roles: ['admin'],                         badge: null,     karateOnly: false },
  { href: '/supervision',   labelKey: 'nav_supervision',  icon: Activity,        roles: ['admin'],                         badge: null,     karateOnly: false, superOnly: true },
] as const

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const palette = ['#2f6bff','#4d8cff','#9b72ff','#7ea5ff','#8b5cf6','#16a34a']
  const color = palette[name.charCodeAt(0) % palette.length]
  return (
    <div style={{ width: size, height: size, background: color, borderRadius: '50%', fontSize: size * 0.36, flexShrink: 0 }}
      className="flex items-center justify-center text-white font-bold shadow-md shadow-black/20">
      {initials}
    </div>
  )
}

export function Sidebar({ profile, unreadCount, pendingGradesCount = 0 }: { profile: Profile; unreadCount: number; pendingGradesCount?: number }) {
  const pathname = usePathname()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { t } = useT()
  const { activeDiscipline } = useDiscipline()

  // Close drawer on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const handleSignOut = () => {
    startTransition(async () => {
      await signOut()
      router.push('/login')
    })
  }

  // Grades / Championnats : visibles seulement quand la discipline active est
  // « Karaté » ou « Toutes ». Masqués en Full contact / Aérobic → isolation
  // complète entre les disciplines.
  const showKarateNav = activeDiscipline === 'karate' || activeDiscipline === 'all'
  // superOnly : réservé au superadmin (supervision)
  const isSuper = profile.role === 'admin' && profile.is_superadmin === true
  const visibleNav = NAV_ITEMS.filter(n =>
    n.roles.includes(profile.role as any) &&
    (!n.karateOnly || showKarateNav) &&
    (!(n as any).superOnly || isSuper),
  )

  const navButtons = (withLabels: boolean) => visibleNav.map(item => {
    const active = pathname.startsWith(item.href)
    const badgeCount = item.badge === 'grades' ? pendingGradesCount : 0
    const Icon = item.icon
    return (
      <Link key={item.href} href={item.href}
        title={t(item.labelKey)}
        aria-label={t(item.labelKey)}
        className={clsx(withLabels ? 'flex items-center gap-3' : undefined)}>
        <span className={clsx('rail-btn', active && 'active')}>
          <Icon size={19} strokeWidth={2.1} />
          {badgeCount > 0 && <span className="rail-badge">{badgeCount}</span>}
        </span>
        {withLabels && (
          <span className={clsx('text-sm font-semibold', active ? 'text-white' : 'text-slate-400')}>
            {t(item.labelKey)}
          </span>
        )}
      </Link>
    )
  })

  return (
    <>
      {/* Bascule vue téléphone / vue ordinateur — bouton flottant, car en vue
          PC la barre mobile est masquée (viewport ≥ 768 px) et le bouton
          serait inatteignable. Visible sur écran tactile uniquement. */}
      <DesktopViewToggle />

      {/* ── Rail flottant (desktop ≥768px) ── */}
      <div className="rail-desktop">
        <aside className="rail-shell">
          <Link href="/dashboard" className="rail-logo" title={t('org_name')}>
            <img src="/logo-noujoum-el-chaouia.png" alt="ANCS" />
          </Link>

          <nav className="rail-nav">{navButtons(false)}</nav>

          <div className="rail-bottom">
            <button onClick={handleSignOut} disabled={isPending} className="rail-btn" title={t('logout')} aria-label={t('logout')}>
              <LogOut size={18} strokeWidth={2.1} />
            </button>
            <Link href="/account" title={profile.name} aria-label={profile.name}>
              <Avatar name={profile.name} size={44} />
            </Link>
          </div>
        </aside>
      </div>

      {/* ── Barre mobile ── */}
      <div className="mobile-topbar">
        <button className="mobile-hamburger" onClick={() => setMobileOpen(true)} aria-label="Menu">
          <Menu size={20} strokeWidth={2.2} />
        </button>
        <div className="mobile-topbar-logo">
          <img src="/logo-noujoum-el-chaouia.png" alt="ANCS" className="mobile-topbar-img" />
          <span className="mobile-topbar-name">{t('org_name')}</span>
        </div>
        <div className="mobile-topbar-actions" />
      </div>

      {/* ── Tiroir mobile ── */}
      {mobileOpen && (
        <div className="mobile-drawer-overlay" onClick={() => setMobileOpen(false)}>
          <div className="mobile-drawer" onClick={e => e.stopPropagation()}>
            <div className="flex flex-col justify-between h-full py-6 px-5" style={{ background: 'linear-gradient(180deg, rgba(23,25,32,0.98), rgba(14,16,22,0.99))' }}>
              <div>
                <div className="flex items-center gap-3 mb-8">
                  <span className="rail-logo"><img src="/logo-noujoum-el-chaouia.png" alt="ANCS" /></span>
                  <div>
                    <div className="text-sm font-bold text-white">{t('org_name')}</div>
                    <div className="text-xs text-slate-400">{t('org_sub')}</div>
                  </div>
                </div>
                <nav className="flex flex-col gap-3">{navButtons(true)}</nav>
              </div>
              <div className="flex items-center gap-3">
                <Avatar name={profile.name} size={40} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{profile.name}</div>
                  <div className="text-xs text-slate-400">
                    {t(profile.role === 'admin' ? 'role_admin' : profile.role === 'receptionist' ? 'role_receptionist' : 'role_viewer')}
                  </div>
                </div>
                <button onClick={handleSignOut} disabled={isPending} className="rail-btn" title={t('logout')} aria-label={t('logout')}>
                  <LogOut size={17} strokeWidth={2.1} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export { Avatar }
