import { ACCESS_SNAPSHOT_SCHEMA_VERSION } from '../src/access-snapshot'
import type { AccessAuthorizationSnapshot } from './types'
import { base64UrlDecode } from './signer'

export interface SnapshotVerificationResult {
  valid: boolean
  reason?: string
}

export class SnapshotVerifier {
  private readonly snapshotVerificationKey: string
  private cachedKey: CryptoKey | null = null
  private cachedKeyString: string | null = null

  constructor(snapshotVerificationKey: string) {
    this.snapshotVerificationKey = snapshotVerificationKey
  }

  private async getVerificationKey(): Promise<CryptoKey> {
    if (this.cachedKey && this.cachedKeyString === this.snapshotVerificationKey) {
      return this.cachedKey
    }

    const keyBytes = base64UrlDecode(this.snapshotVerificationKey)
    const importedKey = await crypto.subtle.importKey(
      'spki',
      keyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )
    this.cachedKey = importedKey
    this.cachedKeyString = this.snapshotVerificationKey
    return importedKey
  }

  async verifySnapshot(
    snapshot: AccessAuthorizationSnapshot,
    signature: string,
    expectedBranchId?: string,
    nowMs: number = Date.now()
  ): Promise<SnapshotVerificationResult> {
    if (!snapshot || typeof snapshot !== 'object') {
      return { valid: false, reason: 'SNAPSHOT_MALFORMED' }
    }

    if (snapshot.snapshotSchemaVersion !== ACCESS_SNAPSHOT_SCHEMA_VERSION) {
      return { valid: false, reason: 'UNSUPPORTED_SNAPSHOT_SCHEMA_VERSION' }
    }

    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
      return { valid: false, reason: 'INVALID_SNAPSHOT_REVISION' }
    }

    if (expectedBranchId && snapshot.branchId !== expectedBranchId) {
      return { valid: false, reason: 'WRONG_BRANCH_ID' }
    }

    if (!snapshot.timezone || typeof snapshot.timezone !== 'string') {
      return { valid: false, reason: 'INVALID_TIMEZONE' }
    }

    try {
      new Intl.DateTimeFormat('en', { timeZone: snapshot.timezone }).format(new Date(nowMs))
    } catch {
      return { valid: false, reason: 'INVALID_IANA_TIMEZONE' }
    }

    if (!snapshot.validUntil || typeof snapshot.validUntil !== 'string') {
      return { valid: false, reason: 'INVALID_VALID_UNTIL' }
    }

    const validUntilMs = Date.parse(snapshot.validUntil)
    if (Number.isNaN(validUntilMs) || validUntilMs <= nowMs) {
      return { valid: false, reason: 'SNAPSHOT_EXPIRED' }
    }

    if (!Array.isArray(snapshot.accessPoints) || !Array.isArray(snapshot.credentials) || !Array.isArray(snapshot.members) || !Array.isArray(snapshot.rules)) {
      return { valid: false, reason: 'INVALID_COLLECTION_STRUCTURE' }
    }

    // Cryptographic signature check
    if (!signature || typeof signature !== 'string') {
      return { valid: false, reason: 'MISSING_SIGNATURE' }
    }

    try {
      const key = await this.getVerificationKey()
      const signatureBytes = base64UrlDecode(signature)
      const canonicalSnapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot))

      const isValid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        key,
        signatureBytes,
        canonicalSnapshotBytes
      )

      if (!isValid) {
        return { valid: false, reason: 'INVALID_SIGNATURE' }
      }
    } catch {
      return { valid: false, reason: 'SIGNATURE_VERIFICATION_FAILED' }
    }

    return { valid: true }
  }
}

