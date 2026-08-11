// lib/discipline-server.ts
import type { Discipline, DisciplineFilter } from '@/types'

export function getActiveDisciplineFromRequestCookies(
  cookies: { get?: (name: string) => { value: string } | undefined } | undefined,
  profileDiscipline: Discipline | null | undefined = null,
): DisciplineFilter {
  // Un membre du personnel rattaché à une discipline y est verrouillé.
  if (profileDiscipline) return profileDiscipline
  const v = cookies?.get?.('active-discipline')?.value ?? null
  if (v === 'full_contact' || v === 'aerobic' || v === 'karate') return v
  // Admin / poste transversal : toutes les disciplines par défaut.
  return 'all'
}
