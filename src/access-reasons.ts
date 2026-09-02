export type SemanticTone = 'success' | 'danger' | 'warning' | 'muted'

export interface ReasonPresentation {
  code: string
  label: string
  tone: SemanticTone
  hint: string
}

export const ACCESS_REASONS: Record<string, ReasonPresentation> = {
  ACCESS_GRANTED: {
    code: 'ACCESS_GRANTED',
    label: 'Accès autorisé',
    tone: 'success',
    hint: 'Badge et abonnement en règle',
  },
  SUBSCRIPTION_EXPIRED: {
    code: 'SUBSCRIPTION_EXPIRED',
    label: 'Abonnement expiré',
    tone: 'danger',
    hint: 'Renouvellement d’abonnement requis',
  },
  MEMBER_INACTIVE: {
    code: 'MEMBER_INACTIVE',
    label: 'Membre inactif',
    tone: 'danger',
    hint: 'Compte suspendu ou non actif',
  },
  CREDENTIAL_UNKNOWN: {
    code: 'CREDENTIAL_UNKNOWN',
    label: 'Badge non reconnu',
    tone: 'warning',
    hint: 'Identifiant non enregistré sur un membre',
  },
  CREDENTIAL_REVOKED: {
    code: 'CREDENTIAL_REVOKED',
    label: 'Badge révoqué',
    tone: 'danger',
    hint: 'Identifiant définitivement invalidé',
  },
  CREDENTIAL_LOST: {
    code: 'CREDENTIAL_LOST',
    label: 'Badge déclaré perdu',
    tone: 'danger',
    hint: 'Identifiant à remplacer',
  },
  CREDENTIAL_DISABLED: {
    code: 'CREDENTIAL_DISABLED',
    label: 'Badge désactivé',
    tone: 'warning',
    hint: 'Identifiant temporairement bloqué',
  },
  OUTSIDE_ALLOWED_HOURS: {
    code: 'OUTSIDE_ALLOWED_HOURS',
    label: 'Hors des horaires',
    tone: 'warning',
    hint: 'Passage refusé en dehors des créneaux de la règle',
  },
  ACCESS_RULE_DENIED: {
    code: 'ACCESS_RULE_DENIED',
    label: 'Refus par règle',
    tone: 'danger',
    hint: 'Une politique de sécurité bloque ce passage',
  },
  WRONG_BRANCH: {
    code: 'WRONG_BRANCH',
    label: 'Autre salle',
    tone: 'warning',
    hint: 'Abonnement restreint à une autre salle',
  },
  WRONG_DISCIPLINE: {
    code: 'WRONG_DISCIPLINE',
    label: 'Zone non autorisée',
    tone: 'warning',
    hint: 'L’abonnement ne couvre pas cette discipline',
  },
  ACCESS_POINT_UNKNOWN: {
    code: 'ACCESS_POINT_UNKNOWN',
    label: 'Point d’accès inconnu',
    tone: 'danger',
    hint: 'Point d’accès absent de la topologie',
  },
  ACCESS_POINT_DISABLED: {
    code: 'ACCESS_POINT_DISABLED',
    label: 'Point d’accès désactivé',
    tone: 'danger',
    hint: 'Point d’accès mis hors service',
  },
  DEVICE_DISABLED: {
    code: 'DEVICE_DISABLED',
    label: 'Équipement désactivé',
    tone: 'danger',
    hint: 'Contrôleur ou portique désactivé',
  },
  GATEWAY_DISABLED: {
    code: 'GATEWAY_DISABLED',
    label: 'Passerelle désactivée',
    tone: 'danger',
    hint: 'Passerelle matérielle désactivée',
  },
  SYSTEM_ERROR: {
    code: 'SYSTEM_ERROR',
    label: 'Erreur système',
    tone: 'danger',
    hint: 'Incident lors de l’évaluation du passage',
  },
}

export function getReasonPresentation(code: string | null | undefined): ReasonPresentation {
  if (!code) {
    return {
      code: 'UNKNOWN',
      label: 'Motif non précisé',
      tone: 'muted',
      hint: '',
    }
  }
  return (
    ACCESS_REASONS[code] ?? {
      code,
      label: code.replace(/_/g, ' ').toLowerCase(),
      tone: 'muted',
      hint: '',
    }
  )
}

export function formatDirection(direction: string | null | undefined): { label: string; code: string } {
  const norm = String(direction ?? '').toLowerCase()
  if (norm === 'entry') return { label: 'Entrée', code: 'entry' }
  if (norm === 'exit') return { label: 'Sortie', code: 'exit' }
  if (norm === 'bidirectional') return { label: 'Bidirectionnel', code: 'bidirectional' }
  return { label: direction || '—', code: norm }
}

export const DAYS_OF_WEEK = [
  { bit: 1, mask: 1, label: 'Lun', full: 'Lundi' },
  { bit: 2, mask: 2, label: 'Mar', full: 'Mardi' },
  { bit: 4, mask: 4, label: 'Mer', full: 'Mercredi' },
  { bit: 8, mask: 8, label: 'Jeu', full: 'Jeudi' },
  { bit: 16, mask: 16, label: 'Ven', full: 'Vendredi' },
  { bit: 32, mask: 32, label: 'Sam', full: 'Samedi' },
  { bit: 64, mask: 64, label: 'Dim', full: 'Dimanche' },
] as const

export function daysMaskToSelected(mask: number): number[] {
  return DAYS_OF_WEEK.filter(d => (mask & d.mask) !== 0).map(d => d.mask)
}

export function selectedToDaysMask(selectedMasks: number[]): number {
  return selectedMasks.reduce((acc, curr) => acc | curr, 0) || 127
}

export function formatDaysMask(mask: number): string {
  if (mask === 127) return 'Tous les jours'
  if (mask === 31) return 'Semaine (Lun–Ven)'
  if (mask === 96) return 'Week-end (Sam–Dim)'
  const active = DAYS_OF_WEEK.filter(d => (mask & d.mask) !== 0).map(d => d.label)
  return active.length ? active.join(', ') : 'Aucun jour'
}
