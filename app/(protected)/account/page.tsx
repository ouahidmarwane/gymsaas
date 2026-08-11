// app/(protected)/account/page.tsx
import Link from 'next/link'
import AccountClient from './AccountClient'
import { getCurrentProfile } from '@/lib/actions'
import type { Profile } from '@/types'

const STATUSES: Record<string, string> = {
  admin: 'Administrateur',
  receptionist: 'Réception',
  viewer: 'Lecture seule',
}

export default async function AccountPage() {
  const profile = await getCurrentProfile()

  return (
    <div className="max-w-3xl mx-auto text-white">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-white">Paramètres du compte</h1>
          <p className="text-gray-300 mt-1">Gère les informations de ton compte et ton accès.</p>
        </div>
        <Link
          href="/dashboard"
          className="btn-ghost text-sm text-white border border-white/20 px-4 py-2 rounded-lg hover:bg-white/10 transition"
        >
          ← Retour au tableau de bord
        </Link>
      </div>

      {!profile ? (
        <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-6">
          <p className="text-gray-300">Impossible de charger les informations du compte.</p>
        </div>
      ) : (
        <AccountClient profile={profile as Profile} />
      )}
    </div>
  )
}
