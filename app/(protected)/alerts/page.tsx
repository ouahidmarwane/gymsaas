// app/(protected)/alerts/page.tsx
import { cookies } from 'next/headers'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getActiveBranchFromRequestCookies } from '@/lib/branch-server'
import { getActiveDisciplineFromRequestCookies } from '@/lib/discipline-server'
import { getNotifications } from '@/lib/actions'
import AlertsClient from './AlertsClient'
import type { Notification } from '@/types'

export default async function AlertsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('branch, discipline')
    .eq('user_id', user.id)
    .single()

  const activeBranch = getActiveBranchFromRequestCookies(cookies(), profile?.branch)
  const activeDiscipline = getActiveDisciplineFromRequestCookies(cookies(), profile?.discipline)
  const disc = activeDiscipline === 'all' ? undefined : activeDiscipline

  const notifications = await getNotifications(activeBranch, disc)

  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full" /></div>}>
      <AlertsClient initialNotifications={notifications ?? []} />
    </Suspense>
  )
}
