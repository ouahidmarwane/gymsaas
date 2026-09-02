import * as crypto from 'node:crypto'

export interface DigestChallenge {
  realm: string
  nonce: string
  qop?: string
  opaque?: string
  algorithm?: string
  stale?: boolean
}

export interface DigestCredentials {
  username: string
  password: string
}

export class HikvisionDigestAuth {
  private lastChallenge: DigestChallenge | null = null
  private nc: number = 0

  constructor() {}

  static parseChallenge(headerValue: string): DigestChallenge | null {
    if (!headerValue || !headerValue.toLowerCase().startsWith('digest ')) {
      return null
    }

    const challengeStr = headerValue.slice(7)
    const challenge: Record<string, string> = {}

    // Match key="value" or key=value tokens
    const regex = /([a-zA-Z0-9_-]+)=(?:"([^"]+)"|([^,\s]+))/g
    let match: RegExpExecArray | null

    while ((match = regex.exec(challengeStr)) !== null) {
      if (match[1]) {
        const key = match[1].toLowerCase()
        const value = match[2] !== undefined ? match[2] : (match[3] || '')
        challenge[key] = value
      }
    }

    if (!challenge.realm || !challenge.nonce) {
      return null
    }

    const stale = challenge.stale === 'true' || challenge.stale === 'TRUE'

    return {
      realm: challenge.realm,
      nonce: challenge.nonce,
      qop: challenge.qop,
      opaque: challenge.opaque,
      algorithm: challenge.algorithm ? challenge.algorithm.toUpperCase() : 'MD5',
      stale,
    }
  }

  setChallenge(challenge: DigestChallenge): void {
    if (!this.lastChallenge || this.lastChallenge.nonce !== challenge.nonce) {
      this.lastChallenge = challenge
      this.nc = 0
    } else if (challenge.stale) {
      this.lastChallenge = challenge
      this.nc = 0
    }
  }

  hasChallenge(): boolean {
    return this.lastChallenge !== null
  }

  generateAuthorizationHeader(
    method: string,
    uri: string,
    creds: DigestCredentials
  ): string | null {
    if (!this.lastChallenge) {
      return null
    }

    const { realm, nonce, qop, opaque, algorithm = 'MD5' } = this.lastChallenge
    const algo = algorithm.toUpperCase()

    if (algo !== 'MD5' && algo !== 'SHA-256') {
      // Unsupported algorithm
      return null
    }

    this.nc++
    const ncString = this.nc.toString(16).padStart(8, '0')
    const cnonce = crypto.randomBytes(8).toString('hex')

    const hashFn = (str: string): string => {
      const hash = crypto.createHash(algo === 'SHA-256' ? 'sha256' : 'md5')
      hash.update(str)
      return hash.digest('hex')
    }

    // HA1 = H(username:realm:password)
    const ha1 = hashFn(`${creds.username}:${realm}:${creds.password}`)

    // HA2 = H(method:digestURI)
    const ha2 = hashFn(`${method.toUpperCase()}:${uri}`)

    let response: string
    if (qop && qop.includes('auth')) {
      // response = H(HA1:nonce:nc:cnonce:qop:HA2)
      response = hashFn(`${ha1}:${nonce}:${ncString}:${cnonce}:auth:${ha2}`)
    } else {
      // response = H(HA1:nonce:HA2)
      response = hashFn(`${ha1}:${nonce}:${ha2}`)
    }

    const parts: string[] = [
      `username="${creds.username}"`,
      `realm="${realm}"`,
      `nonce="${nonce}"`,
      `uri="${uri}"`,
      `algorithm=${algo}`,
      `response="${response}"`,
    ]

    if (opaque) {
      parts.push(`opaque="${opaque}"`)
    }

    if (qop && qop.includes('auth')) {
      parts.push(`qop=auth`)
      parts.push(`nc=${ncString}`)
      parts.push(`cnonce="${cnonce}"`)
    }

    return `Digest ${parts.join(', ')}`
  }

  reset(): void {
    this.lastChallenge = null
    this.nc = 0
  }
}

