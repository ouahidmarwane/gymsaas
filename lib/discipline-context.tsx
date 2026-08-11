'use client'
// lib/discipline-context.tsx
// Contexte de la discipline active. Un membre du personnel rattaché à une
// discipline y est verrouillé ; l'admin (discipline null) peut basculer
// entre « Toutes » et chacune des 3 disciplines.
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Discipline, DisciplineFilter, Profile } from '@/types'

const COOKIE = 'active-discipline'

function isFilter(v: string | null | undefined): v is DisciplineFilter {
  return v === 'karate' || v === 'full_contact' || v === 'aerobic' || v === 'all'
}

function readCookie(): DisciplineFilter | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.split('; ').map(c => c.split('=')).find(([n]) => n === COOKIE)
  const v = match?.[1] ?? null
  return isFilter(v) ? v : null
}

function writeCookie(d: DisciplineFilter) {
  document.cookie = `${COOKIE}=${d}; path=/; max-age=31536000; sameSite=Lax`
}

interface DisciplineContextValue {
  activeDiscipline: DisciplineFilter
  setActiveDiscipline: (d: DisciplineFilter) => void
  profileDiscipline: Discipline | null
  canSwitchDiscipline: boolean
}

const DisciplineContext = createContext<DisciplineContextValue | undefined>(undefined)

export function DisciplineProvider({ children, profile }: { children: ReactNode; profile: Profile }) {
  const profileDiscipline = profile.discipline ?? null
  const isAdmin = profile.role === 'admin'
  const canSwitchDiscipline = isAdmin || profileDiscipline === null
  // Verrouillé sur sa discipline, sinon « toutes » par défaut.
  const defaultDiscipline: DisciplineFilter = profileDiscipline ?? 'all'
  const [activeDiscipline, setActive] = useState<DisciplineFilter>(defaultDiscipline)

  useEffect(() => {
    if (profileDiscipline) {
      setActive(profileDiscipline)
      writeCookie(profileDiscipline)
      return
    }
    const c = readCookie()
    if (c) { setActive(c); return }
    writeCookie(defaultDiscipline)
  }, [defaultDiscipline, profileDiscipline])

  const setActiveDiscipline = (d: DisciplineFilter) => {
    if (!canSwitchDiscipline) return
    setActive(d)
    writeCookie(d)
  }

  const value = useMemo(
    () => ({ activeDiscipline, setActiveDiscipline, profileDiscipline, canSwitchDiscipline }),
    [activeDiscipline, canSwitchDiscipline, profileDiscipline],
  )

  return <DisciplineContext.Provider value={value}>{children}</DisciplineContext.Provider>
}

export function useDiscipline() {
  const ctx = useContext(DisciplineContext)
  if (!ctx) throw new Error('useDiscipline must be used within DisciplineProvider')
  return ctx
}

// Garde de route pour les pages propres au karaté (Grades, Championnats).
// Si la discipline active est full contact / aérobic, l'utilisateur est
// renvoyé vers le dashboard → isolation complète, même en accès direct par URL.
// Renvoie `true` si l'accès est bloqué (la page doit alors rendre null).
export function useKarateOnlyGuard(): boolean {
  const { activeDiscipline } = useDiscipline()
  const router = useRouter()
  const blocked = activeDiscipline === 'full_contact' || activeDiscipline === 'aerobic'
  useEffect(() => {
    if (blocked) router.replace('/dashboard')
  }, [blocked, router])
  return blocked
}
