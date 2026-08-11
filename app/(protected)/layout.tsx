// app/(protected)/layout.tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Sidebar } from '@/components/Sidebar'
import NotifBell from '@/components/NotifBell'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import GlobalDisciplineFilter from '@/components/GlobalDisciplineFilter'
import { BranchProvider } from '@/lib/branch-context'
import { DisciplineProvider } from '@/lib/discipline-context'
import { LanguageProvider } from '@/lib/i18n'
import OfflineBanner from '@/components/OfflineBanner'
import HistoryPanel from '@/components/HistoryPanel'
import SessionGuard from '@/components/SessionGuard'
import { getActiveBranchFromRequestCookies } from '@/lib/branch-server'
import { getNotifications, getPendingGradeChecks } from '@/lib/actions'
import { Settings } from 'lucide-react'
import type { Profile } from '@/types'
import type { ReactNode } from 'react'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!profile) {
    redirect('/login')
  }

  const activeBranch = getActiveBranchFromRequestCookies(cookies(), profile.branch)
  // Compteur non-lu personnalisé (notification_reads) + grades en parallèle
  const [notifList, pendingGradesRes] = await Promise.all([
    getNotifications(activeBranch).catch(() => [] as any[]),
    getPendingGradeChecks(activeBranch).catch(() => []),
  ])
  const unreadCount = (notifList as any[]).filter(n => !n.is_read).length
  const pendingGrades = pendingGradesRes

  return (
    <LanguageProvider>
      <BranchProvider profile={profile as Profile}>
       <DisciplineProvider profile={profile as Profile}>
        <SessionGuard />
        <OfflineBanner />
        <div className="app-shell">
          <Sidebar profile={profile as Profile} unreadCount={unreadCount ?? 0} pendingGradesCount={pendingGrades.length} />
          <main className="app-main">
            <div className="page-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Zone gauche (vide) — équilibre le centrage du filtre sur PC.
                  Masquée sur mobile : elle y volait la moitié de la largeur. */}
              <div className="page-actions-spacer" style={{ flex: 1, minWidth: 0 }} />
              {/* Filtre discipline global, centré */}
              <GlobalDisciplineFilter />
              {/* Zone droite : notifications, historique, réglages, langue */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
                <NotifBell activeBranch={activeBranch} initialCount={unreadCount ?? 0} />
                {profile.role === 'admin' && <HistoryPanel />}
                <Link href="/account" className="icon-btn" aria-label="Paramètres du compte">
                  <Settings size={17} strokeWidth={2.1} />
                </Link>
                <LanguageSwitcher />
              </div>
            </div>
            {children}
          </main>
        </div>
       </DisciplineProvider>
      </BranchProvider>
    </LanguageProvider>
  )
}
