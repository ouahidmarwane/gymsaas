import * as http from 'node:http'
import * as crypto from 'node:crypto'
import { HikvisionDigestAuth } from './hikvision-digest'

export interface MockServerOptions {
  username?: string
  password?: string
  realm?: string
}

export interface ReceivedUnlockCommand {
  doorId: number
  body: string
  timestamp: string
}

export class MockHikvisionServer {
  private server: http.Server | null = null
  private port: number = 0
  private readonly username: string
  private readonly password: string
  private readonly realm: string
  private currentNonce: string

  private streamClients: Set<http.ServerResponse> = new Set()
  private receivedUnlockCommands: ReceivedUnlockCommand[] = []

  // Fault injection flags
  private dropConnectionOnUnlock: boolean = false
  private rejectAuth: boolean = false
  private customUnlockResponse: { statusCode: number; body: string } | null = null

  constructor(options: MockServerOptions = {}) {
    this.username = options.username || 'gymflow_api'
    this.password = options.password || 'SecureGymFlow2026!'
    this.realm = options.realm || 'Hikvision'
    this.currentNonce = crypto.randomBytes(16).toString('hex')
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res)
      })

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address()
        if (addr && typeof addr === 'object') {
          this.port = addr.port
          resolve(this.port)
        } else {
          reject(new Error('FAILED_TO_GET_PORT'))
        }
      })
    })
  }

  async stop(): Promise<void> {
    for (const client of this.streamClients) {
      try {
        client.destroy()
      } catch {}
    }
    this.streamClients.clear()

    return new Promise((resolve) => {
      if (this.server) {
        if (typeof (this.server as any).closeAllConnections === 'function') {
          ;(this.server as any).closeAllConnections()
        }
        this.server.close(() => {
          this.server = null
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  getPort(): number {
    return this.port
  }

  getReceivedUnlockCommands(): ReceivedUnlockCommand[] {
    return [...this.receivedUnlockCommands]
  }

  clearReceivedUnlockCommands(): void {
    this.receivedUnlockCommands = []
  }

  setDropConnectionOnUnlock(drop: boolean): void {
    this.dropConnectionOnUnlock = drop
  }

  setRejectAuth(reject: boolean): void {
    this.rejectAuth = reject
  }

  setCustomUnlockResponse(response: { statusCode: number; body: string } | null): void {
    this.customUnlockResponse = response
  }

  pushEvent(xmlPayload: string): void {
    const boundary = 'MIME_boundary_123'
    const chunk = `--${boundary}\r\nContent-Type: application/xml; charset="UTF-8"\r\nContent-Length: ${Buffer.byteLength(
      xmlPayload,
      'utf8'
    )}\r\n\r\n${xmlPayload}\r\n`

    for (const client of this.streamClients) {
      try {
        client.write(chunk)
      } catch {}
    }
  }

  pushRawChunk(rawChunk: string): void {
    for (const client of this.streamClients) {
      try {
        client.write(rawChunk)
      } catch {}
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url || ''
    const method = req.method || 'GET'
    const authHeader = req.headers['authorization'] || ''

    if (this.rejectAuth || !this.validateDigestAuth(method, url, authHeader)) {
      res.writeHead(401, {
        'WWW-Authenticate': `Digest realm="${this.realm}", nonce="${this.currentNonce}", qop="auth", algorithm="MD5"`,
        'Content-Type': 'application/xml',
      })
      res.end('<ResponseStatus><statusCode>4</statusCode><statusString>Unauthorized</statusString></ResponseStatus>')
      return
    }

    if (url.startsWith('/ISAPI/Event/notification/alertStream') && method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'multipart/mixed; boundary=MIME_boundary_123',
        'Transfer-Encoding': 'chunked',
        Connection: 'keep-alive',
      })
      if (typeof (res as any).flushHeaders === 'function') {
        ;(res as any).flushHeaders()
      }

      this.streamClients.add(res)

      req.on('close', () => {
        this.streamClients.delete(res)
      })
      return
    }

    if (url.startsWith('/ISAPI/AccessControl/RemoteControl/door/') && method === 'PUT') {
      const match = url.match(/\/door\/(\d+)/)
      const doorId = match && match[1] ? parseInt(match[1], 10) : 1

      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })

      req.on('end', () => {
        this.receivedUnlockCommands.push({
          doorId,
          body,
          timestamp: new Date().toISOString(),
        })

        if (this.dropConnectionOnUnlock) {
          req.destroy()
          res.destroy()
          return
        }

        if (this.customUnlockResponse) {
          res.writeHead(this.customUnlockResponse.statusCode, { 'Content-Type': 'application/xml' })
          res.end(this.customUnlockResponse.body)
          return
        }

        res.writeHead(200, { 'Content-Type': 'application/xml' })
        res.end(
          `<ResponseStatus version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">\n` +
            `    <requestURL>${url}</requestURL>\n` +
            `    <statusCode>1</statusCode>\n` +
            `    <statusString>OK</statusString>\n` +
            `    <subStatusCode>ok</subStatusCode>\n` +
            `</ResponseStatus>`
        )
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }

  private validateDigestAuth(method: string, uri: string, authHeader: string): boolean {
    if (!authHeader || !authHeader.startsWith('Digest ')) {
      return false
    }

    // Extract client digest parameters
    const usernameMatch = authHeader.match(/username="([^"]+)"/i)
    const realmMatch = authHeader.match(/realm="([^"]+)"/i)
    const nonceMatch = authHeader.match(/nonce="([^"]+)"/i)
    const uriMatch = authHeader.match(/uri="([^"]+)"/i)
    const responseMatch = authHeader.match(/response="([a-f0-9]+)"/i)
    const ncMatch = authHeader.match(/nc=([a-f0-9]+)/i)
    const cnonceMatch = authHeader.match(/cnonce="([^"]+)"/i)
    const qopMatch = authHeader.match(/qop=([^,\s]+)/i)

    if (!usernameMatch || !responseMatch || !nonceMatch || !usernameMatch[1] || !responseMatch[1] || !nonceMatch[1]) {
      return false
    }

    const username = usernameMatch[1]
    const clientNonce = nonceMatch[1]
    const clientResponse = responseMatch[1]

    if (username !== this.username || clientNonce !== this.currentNonce) {
      return false
    }

    // Compute HA1, HA2
    const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex')
    const ha1 = md5(`${this.username}:${this.realm}:${this.password}`)
    const ha2 = md5(`${method.toUpperCase()}:${uri}`)

    let expectedResp: string
    if (qopMatch && ncMatch && ncMatch[1] && cnonceMatch && cnonceMatch[1]) {
      expectedResp = md5(`${ha1}:${this.currentNonce}:${ncMatch[1]}:${cnonceMatch[1]}:auth:${ha2}`)
    } else {
      expectedResp = md5(`${ha1}:${this.currentNonce}:${ha2}`)
    }

    return clientResponse.toLowerCase() === expectedResp.toLowerCase()
  }
}

