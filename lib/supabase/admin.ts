// lib/supabase/admin.ts
// Service-role client — SERVER ONLY. Required for auth.admin.* operations
// (createUser / deleteUser), which the anon-key client is not allowed to call.
// Never import this from a Client Component.
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
