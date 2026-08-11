import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveBranchFromRequestCookies } from '@/lib/branch-server'
import { getCurrentProfile, getPrices } from '@/lib/actions'
import { enrichMember } from '@/lib/gym'
import ComptaClient from './ComptaClient'

export default async function ComptabilitePage() {
  const profile = await getCurrentProfile()
  // Comptabilité : réservée à l'administrateur
  if (!profile || profile.role !== 'admin') redirect('/dashboard')
  const activeBranch = getActiveBranchFromRequestCookies(cookies(), profile?.branch)
  const supabase = createClient()
  const initialPrices = await getPrices()

  const { data: allMembers = [] } = await supabase
    .from('members')
    .select('id, name, join_date, sub_expiry, is_insured, ins_expiry, branch, discipline')
    .order('join_date', { ascending: true })

  const enriched = (allMembers ?? []).map(m => enrichMember(m))

  return <ComptaClient members={enriched} activeBranch={activeBranch} initialPrices={initialPrices} />
}
