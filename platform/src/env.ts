import type { ClubDatabase } from './club/club-database'

export interface Env {
  /** Base centrale : identité, clubs, abonnements. Jamais exposée à un club. */
  CONTROL: D1Database
  /** Un Durable Object SQLite par club, adressé par identifiant de club. */
  CLUB: DurableObjectNamespace<ClubDatabase>
  /** Fichiers membres (photos, passeports, documents). */
  MEDIA: R2Bucket
  /**
   * Clé Google Maps de la carte de supervision.
   *
   * Facultative : sans elle l'écran affiche la même information sous forme
   * de liste plutôt que de refuser de s'ouvrir. C'est une clé de navigateur,
   * à restreindre par référent HTTP côté Google Cloud — le serveur ne la
   * transmet qu'à un exploitant, pas à chaque visiteur.
   */
  GOOGLE_MAPS_API_KEY?: string
  /**
   * Développement uniquement : accepter `X-Forwarded-For` faute de
   * `CF-Connecting-IP`. À ne jamais poser en production — l'en-tête y est
   * fourni par l'appelant, donc choisi par lui.
   */
  TRUST_FORWARDED_IP?: string
}
