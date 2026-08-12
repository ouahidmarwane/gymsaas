import type { ClubDatabase } from './club/club-database'

export interface Env {
  /** Base centrale : identité, clubs, abonnements. Jamais exposée à un club. */
  CONTROL: D1Database
  /** Un Durable Object SQLite par club, adressé par identifiant de club. */
  CLUB: DurableObjectNamespace<ClubDatabase>
  /** Fichiers membres (photos, passeports, documents). */
  MEDIA: R2Bucket
}
