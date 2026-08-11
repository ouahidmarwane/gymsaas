'use client'

import { useState, useTransition } from 'react'
import type { FormEvent } from 'react'
import { updateProfile, updatePassword } from '@/lib/actions'
import type { Profile } from '@/types'

interface AccountClientProps {
  profile: Profile
}

export default function AccountClient({ profile }: AccountClientProps) {
  // Nom et email : modifiables par l'administrateur uniquement (le superadmin
  // est un admin). Le personnel passe par un admin — cf. updateProfile.
  const canEditIdentity = profile.role === 'admin'
  const [name, setName] = useState(profile.name)
  const [email, setEmail] = useState(profile.email)
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    setError(null)

    startTransition(async () => {
      try {
        let saved = false

        if (canEditIdentity && (name !== profile.name || email !== profile.email)) {
          const result = await updateProfile(name.trim(), email.trim())
          if (!result || result.error) {
            setError(result?.error || 'Impossible de mettre à jour le profil.')
            return
          }
          setMessage('Nom et email mis à jour.')
          saved = true
        }

        if (password.length > 0) {
          if (currentPassword.length === 0) {
            setError('Pour changer le mot de passe, saisis d’abord le mot de passe actuel.')
            return
          }

          const result = await updatePassword(currentPassword, password)
          if (!result || result.error) {
            setError(result?.error || 'Impossible de mettre à jour le mot de passe.')
            return
          }
          setMessage((previous) =>
            previous ? `${previous} Mot de passe mis à jour.` : 'Mot de passe mis à jour.',
          )
          setPassword('')
          setCurrentPassword('')
          saved = true
        }

        if (!saved) {
          setMessage('Aucune modification détectée.')
        }
      } catch (err) {
        setError('Erreur lors de la mise à jour du compte.')
      }
    })
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-6 space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm uppercase tracking-[0.3em] text-gray-400">Nom</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!canEditIdentity}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white focus:outline-none focus:border-white/30 disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="Ton nom"
            />
          </label>
          <label className="block">
            <span className="text-sm uppercase tracking-[0.3em] text-gray-400">Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              disabled={!canEditIdentity}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-white focus:outline-none focus:border-white/30 disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="adresse@exemple.com"
            />
          </label>
        </div>

        {!canEditIdentity && (
          <p className="text-sm text-amber-300/90 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            🔒 Ton nom et ton email sont gérés par l&apos;administration. Pour les faire modifier,
            contacte un administrateur. Tu peux en revanche changer ton mot de passe ci-dessous.
          </p>
        )}

        <label className="block">
          <span className="text-sm uppercase tracking-[0.3em] text-gray-400">Mot de passe actuel</span>
          <div className="relative mt-2">
            <input
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              type={showCurrentPassword ? 'text' : 'password'}
              className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 pr-12 text-white focus:outline-none focus:border-white/30"
              placeholder="Saisis ton mot de passe actuel"
            />
            <button
              type="button"
              onClick={() => setShowCurrentPassword((visible) => !visible)}
              className="absolute inset-y-0 right-3 flex items-center text-white text-xl hover:text-gray-200"
              aria-label={showCurrentPassword ? 'Masquer le mot de passe actuel' : 'Afficher le mot de passe actuel'}
            >
              {showCurrentPassword ? '👁️' : '🔒'}
            </button>
          </div>
        </label>

        <label className="block">
          <span className="text-sm uppercase tracking-[0.3em] text-gray-400">Nouveau mot de passe</span>
          <div className="relative mt-2">
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type={showPassword ? 'text' : 'password'}
              className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 pr-12 text-white focus:outline-none focus:border-white/30"
              placeholder="Laisser vide pour conserver le mot de passe actuel"
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              className="absolute inset-y-0 right-3 flex items-center text-white text-xl hover:text-gray-200"
              aria-label={showPassword ? 'Masquer le nouveau mot de passe' : 'Afficher le nouveau mot de passe'}
            >
              {showPassword ? '👁️' : '🔒'}
            </button>
          </div>
        </label>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="btn bg-white text-slate-950 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Enregistrement...' : 'Enregistrer les modifications'}
          </button>
        </div>
      </form>

      <div className="rounded-2xl bg-slate-900/70 p-4 border border-white/5">
        <p className="text-sm text-gray-400">Infos du compte</p>
        <p className="mt-2 text-gray-300">
          {canEditIdentity
            ? 'Tu peux modifier ton nom, ton email et ton mot de passe. Si tu changes ton email, Supabase peut envoyer une confirmation par email.'
            : 'Tu peux modifier ton mot de passe. Le nom et l’email du compte sont modifiés par un administrateur, depuis la page Équipe.'}
        </p>
      </div>
    </div>
  )
}
