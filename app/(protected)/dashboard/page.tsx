// app/(protected)/dashboard/page.tsx
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getActiveBranchFromRequestCookies } from '@/lib/branch-server'
import { getActiveDisciplineFromRequestCookies } from '@/lib/discipline-server'
import { getCurrentProfile, getNotifications, getPendingGradeChecks } from '@/lib/actions'
import { enrichMember } from '@/lib/gym'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import DashboardClient from '@/components/DashboardClient'

const BRANCHES = [
  { key: 'sbata',  icon: '📍' },
  { key: 'rachad', icon: '📍' },
]

export default async function DashboardPage() {
  const supabase = createClient()
  const profile = await getCurrentProfile()
  const activeBranch = getActiveBranchFromRequestCookies(cookies(), profile?.branch)
  const activeDiscipline = getActiveDisciplineFromRequestCookies(cookies(), profile?.discipline)
  const allDisc = activeDiscipline === 'all'
  // Grades + championnats concernent le karaté : visibles en vue « Toutes »
  // ou en vue « Karaté », masqués sur full contact / aérobic.
  const showKarate = allDisc || activeDiscipline === 'karate'
  // Helper : applique le filtre discipline sauf en vue « Toutes »
  // (générique pour préserver le typage du query builder Supabase)
  const withDisc = <T,>(q: T): T => (allDisc ? q : (q as any).eq('discipline', activeDiscipline))

  // All independent queries run in parallel — each awaited query is a full
  // network round-trip to Supabase, so chaining them serially adds seconds
  const [
    { data: members = [] },
    { data: allMembers = [] },
    notifications,
    pendingGrades,
    adminCounts,
    champsRes,
  ] = await Promise.all([
    withDisc(
      supabase
        .from('members')
        .select('id, name, phone, join_date, sub_expiry, is_insured, ins_expiry, branch, grade, photo_url')
        .eq('branch', activeBranch)
    ),
    // Stats globales : la discipline active, toutes succursales
    withDisc(
      supabase
        .from('members')
        .select('id, join_date, sub_expiry, is_insured, ins_expiry, branch, grade')
    ),
    getNotifications(activeBranch).catch(() => []),
    // Grades : karaté (ou vue Toutes)
    showKarate ? getPendingGradeChecks(activeBranch).catch(() => []) : Promise.resolve([]),
    profile?.role === 'admin'
      ? Promise.all([
          withDisc(supabase.from('members').select('id', { count: 'exact', head: true }).eq('branch', 'sbata')),
          withDisc(supabase.from('members').select('id', { count: 'exact', head: true }).eq('branch', 'rachad')),
        ])
      : Promise.resolve(null),
    // Championnats : karaté (ou vue Toutes)
    showKarate
      ? supabase
          .from('championships')
          .select('id, name, date, location, status, branch')
          .in('status', ['upcoming', 'ongoing'])
          .gte('date', new Date().toISOString().split('T')[0])
          .order('date', { ascending: true })
          .limit(3)
      : Promise.resolve({ data: [] }),
  ])

  const enriched = (members ?? []).map(enrichMember)
  const allEnriched = (allMembers ?? []).map(enrichMember)

  const stats = {
    total:         allEnriched.length,
    active:        allEnriched.filter(m => m.sub_status === 'active').length,
    uninsured:     allEnriched.filter(m => m.ins_status === 'uninsured').length,
    notifications: notifications?.length ?? 0,
    renewal:       enriched.filter(m => ['expiring', 'expired'].includes(m.sub_status)).length,
    grades:        pendingGrades.length,
  }

  const today = format(new Date(), 'EEEE d MMMM yyyy', { locale: fr })

  const sbataCount  = adminCounts ? adminCounts[0].count ?? 0 : 0
  const rachadCount = adminCounts ? adminCounts[1].count ?? 0 : 0

  const branches = BRANCHES.map(branch => ({
    ...branch,
    count:  branch.key === 'sbata' ? sbataCount : rachadCount,
    active: activeBranch === branch.key,
  }))

  const upcomingGrades = pendingGrades.slice(0, 5)
  const upcomingChampionships: any[] = champsRes.data ?? []

  const membersData = enriched.map(m => ({
    id: m.id,
    name: (m as any).name ?? null,
    photo_url: (m as any).photo_url ?? null,
    join_date: m.join_date ?? null,
    sub_expiry: m.sub_expiry ?? null,
    is_insured: m.is_insured,
    sub_status: m.sub_status,
    ins_status: m.ins_status,
    branch: m.branch ?? 'sbata',
    grade: (m as any).grade ?? null,
  }))

  const allMembersData = allEnriched.map(m => ({
    id: m.id,
    join_date: m.join_date ?? null,
    sub_expiry: m.sub_expiry ?? null,
    is_insured: m.is_insured,
    sub_status: m.sub_status,
    ins_status: m.ins_status,
    branch: m.branch ?? 'sbata',
    grade: (m as any).grade ?? null,
  }))

  return (
    <DashboardClient
      today={today}
      profileName={profile?.name ?? null}
      canEdit={['admin', 'receptionist'].includes(profile?.role ?? '')}
      activeBranch={activeBranch}
      stats={stats}
      branches={branches}
      upcomingGrades={upcomingGrades}
      members={membersData}
      allMembers={allMembersData}
      upcomingChampionships={upcomingChampionships}
    />
  )
}
