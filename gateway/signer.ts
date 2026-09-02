export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]!)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_BASE64URL')
  let encoded = value.replace(/-/g, '+').replace(/_/g, '/')
  while (encoded.length % 4) encoded += '='
  return Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
}

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return base64UrlEncode(bytes)
}

export interface SignedRequestHeaders {
  'Gateway-Id': string
  'Gateway-Signature': string
  'Gateway-Timestamp': string
  'Gateway-Nonce': string
  'Content-Type'?: string
}

export class GatewayM2MSigner {
  private readonly gatewayId: string
  private readonly getPrivateKey: () => Promise<string | null>
  private cachedKey: CryptoKey | null = null
  private cachedKeyString: string | null = null

  constructor(
    gatewayId: string,
    getPrivateKey: () => Promise<string | null>
  ) {
    this.gatewayId = gatewayId
    this.getPrivateKey = getPrivateKey
  }

  private async getSigningKey(): Promise<CryptoKey> {
    const rawKey = await this.getPrivateKey()
    if (!rawKey) {
      throw new Error('GATEWAY_PRIVATE_KEY_MISSING')
    }
    if (this.cachedKey && this.cachedKeyString === rawKey) {
      return this.cachedKey
    }

    const keyBytes = base64UrlDecode(rawKey)
    const importedKey = await crypto.subtle.importKey(
      'pkcs8',
      keyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    )
    this.cachedKey = importedKey
    this.cachedKeyString = rawKey
    return importedKey
  }

  async signRequest(
    method: string,
    path: string,
    bodyBytes: Uint8Array | ArrayBuffer | null = null,
    clockOffsetMs: number = 0
  ): Promise<{ headers: SignedRequestHeaders; nonce: string; timestamp: string }> {
    const key = await this.getSigningKey()
    const now = Date.now() + clockOffsetMs
    const timestamp = String(Math.floor(now / 1000))
    const nonce = generateNonce()

    const rawBody = bodyBytes
      ? (bodyBytes instanceof Uint8Array ? bodyBytes : new Uint8Array(bodyBytes))
      : new Uint8Array(0)

    const bodyDigest = await crypto.subtle.digest('SHA-256', rawBody.buffer as ArrayBuffer)
    const bodyHashHex = Array.from(new Uint8Array(bodyDigest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    // Path must be normalized pathname without query string
    const normalizedPath = path.split('?')[0] || path
    const canonicalRequest = `${method.toUpperCase()}\n${normalizedPath}\n${timestamp}\n${nonce}\n${bodyHashHex}`
    const canonicalBytes = new TextEncoder().encode(canonicalRequest)

    const signatureBytes = await crypto.subtle.sign(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      key,
      canonicalBytes
    )

    const signature = base64UrlEncode(signatureBytes)

    const headers: SignedRequestHeaders = {
      'Gateway-Id': this.gatewayId,
      'Gateway-Signature': signature,
      'Gateway-Timestamp': timestamp,
      'Gateway-Nonce': nonce,
    }

    if (bodyBytes && (rawBody as Uint8Array).byteLength > 0) {
      headers['Content-Type'] = 'application/json'
    }

    return { headers, nonce, timestamp }
  }
}

