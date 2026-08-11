// app/(protected)/supervision/page.tsx — supervision des connexions (admin)
import { redirect } from 'next/navigation'
import { getCurrentProfile, getActiveSessions, getSecurityEvents } from '@/lib/actions'
import SupervisionClient from '@/components/SupervisionClient'

export default async function SupervisionPage() {
  // Supervision : superadmin uniquement
  const profile = await getCurrentProfile()
  if (!profile || profile.role !== 'admin' || !profile.is_superadmin) redirect('/dashboard')

  const [initial, security] = await Promise.all([getActiveSessions(), getSecurityEvents()])
  return <SupervisionClient initial={initial as any[]} security={security as any[]} currentUserId={profile.user_id} />
}
