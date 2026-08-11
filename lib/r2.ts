// lib/r2.ts
// Client Cloudflare R2 (API S3) — SERVEUR UNIQUEMENT.
// Ne jamais importer depuis un Client Component : les clés y seraient exposées.
//
// Un seul bucket R2 héberge les trois anciens buckets Supabase ; le nom du
// bucket logique devient simplement le premier segment de la clé R2 :
//   member-photos/<memberId>/<timestamp>.jpg
// Les chemins sont donc identiques à ceux de Supabase, ce qui rend la
// migration une copie octet pour octet, sans réécriture de chemin.
import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Buckets logiques autorisés — repris à l'identique de l'ancien proxy Supabase.
export const MEDIA_BUCKETS = ['member-photos', 'member-passports', 'member-documents'] as const
export type MediaBucket = typeof MEDIA_BUCKETS[number]

export function isMediaBucket(v: string): v is MediaBucket {
  return (MEDIA_BUCKETS as readonly string[]).includes(v)
}

// Préfixe interne des références stockées en base pour les objets R2.
export const R2_REF_PREFIX = 'r2://'

/** `r2://member-photos/<id>/<file>` → { bucket, path }, sinon null. */
export function parseR2Ref(stored: string | null | undefined): { bucket: MediaBucket; path: string } | null {
  if (!stored?.startsWith(R2_REF_PREFIX)) return null
  const rest = stored.slice(R2_REF_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  const bucket = rest.slice(0, slash)
  const path = rest.slice(slash + 1)
  if (!isMediaBucket(bucket) || !path || path.includes('..')) return null
  return { bucket, path }
}

export function buildR2Ref(bucket: MediaBucket, path: string): string {
  return `${R2_REF_PREFIX}${bucket}/${path}`
}

/** Clé R2 réelle = bucket logique + chemin. */
export function r2Key(bucket: MediaBucket, path: string): string {
  return `${bucket}/${path}`
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
  )
}

let cached: S3Client | null = null

export function r2Client(): S3Client {
  if (cached) return cached
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 non configuré : R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY manquants')
  }
  cached = new S3Client({
    // R2 ignore la région mais le SDK S3 en exige une.
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
  return cached
}

function bucketName(): string {
  const b = process.env.R2_BUCKET
  if (!b) throw new Error('R2 non configuré : R2_BUCKET manquant')
  return b
}

/** URL de lecture signée, valable `expiresIn` secondes (1 h par défaut). */
export async function signedReadUrl(bucket: MediaBucket, path: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    r2Client(),
    new GetObjectCommand({ Bucket: bucketName(), Key: r2Key(bucket, path) }),
    { expiresIn },
  )
}

/** URL d'écriture signée : le navigateur téléverse directement vers R2. */
export async function signedUploadUrl(
  bucket: MediaBucket,
  path: string,
  contentType: string,
  expiresIn = 300,
): Promise<string> {
  return getSignedUrl(
    r2Client(),
    new PutObjectCommand({ Bucket: bucketName(), Key: r2Key(bucket, path), ContentType: contentType }),
    { expiresIn },
  )
}

/** true si l'objet existe déjà dans R2 (utilisé par le backfill). */
export async function objectExists(bucket: MediaBucket, path: string): Promise<boolean> {
  try {
    await r2Client().send(new HeadObjectCommand({ Bucket: bucketName(), Key: r2Key(bucket, path) }))
    return true
  } catch {
    return false
  }
}
