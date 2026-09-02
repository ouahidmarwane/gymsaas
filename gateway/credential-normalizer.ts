import type { CredentialType } from './adapter-types'

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export class CredentialNormalizer {
  static normalize(type: string, identifier: string): string {
    if (!identifier || typeof identifier !== 'string') {
      throw new Error('INVALID_CREDENTIAL')
    }
    const trimmed = identifier.trim()
    if (!trimmed || trimmed.length > 512) {
      throw new Error('INVALID_CREDENTIAL')
    }

    if (type === 'rfid' || type === 'nfc') {
      const clean = trimmed.replace(/[-:\s]/g, '').toUpperCase()
      if (!/^[0-9A-F]{4,128}$/.test(clean)) {
        throw new Error('INVALID_CREDENTIAL')
      }
      return clean
    }

    if (type === 'qr') {
      if (trimmed.length < 8 || /[\x00-\x1F\x7F]/.test(trimmed)) {
        throw new Error('INVALID_CREDENTIAL')
      }
      return trimmed
    }

    // external / fingerprint / face / default
    if (trimmed.length > 160 || /[\x00-\x1F\x7F]/.test(trimmed)) {
      throw new Error('INVALID_CREDENTIAL')
    }
    return trimmed
  }

  static async computeLookupHash(
    type: string = 'rfid',
    identifier: string,
    provider: string | null = null
  ): Promise<string> {
    const normalized = CredentialNormalizer.normalize(type, identifier)
    const normalizedProvider = provider ? provider.trim() : ''
    const canonical = `gymflow-access-v1\0${type}\0${normalizedProvider}\0${normalized}`
    const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
    return hex(digestBytes)
  }

  static mask(identifier: string): string {
    if (!identifier || typeof identifier !== 'string') return '••••'
    const clean = identifier.replace(/[-:\s]/g, '')
    if (clean.length <= 4) return '••••'
    return `••••${clean.slice(-4)}`.slice(0, 24)
  }

  static validate(type: string, identifier: string): { valid: boolean; error?: string } {
    try {
      CredentialNormalizer.normalize(type, identifier)
      return { valid: true }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'INVALID_CREDENTIAL'
      return { valid: false, error: msg }
    }
  }
}

