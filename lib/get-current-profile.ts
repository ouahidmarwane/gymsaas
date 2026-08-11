// lib/get-current-profile.ts
// Profil de l'utilisateur courant, mémoïsé PAR REQUÊTE via React.cache.
// Évite de re-valider le JWT (auth.getUser) + re-requêter profiles à chaque
// appel : sur un même rendu (layout + page + actions), une seule exécution.
// Volontairement hors 'use server' (cache() ne peut pas envelopper une
// server action exportée).
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export const getCurrentProfile = cache(async () => {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()
  return data
})
