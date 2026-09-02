import type {
  AccessDeviceAdapter,
  DeviceAccessResult,
  DeviceCredentialEvent,
  DeviceDirection,
  DeviceHealth,
  DeviceHealthState,
} from './adapter-types'
import {
  type HikvisionAdapterConfig,
  type ReaderMapping,
  HikvisionConfigValidator,
} from './hikvision-config'
import { HikvisionDigestAuth } from './hikvision-digest'
import { HikvisionStreamParser } from './hikvision-stream-parser'
import { HikvisionXmlParser } from './hikvision-xml'

interface DedupRecord {
  timestamp: number
  serialNo?: string
}

export class HikvisionIsapiAdapter implements AccessDeviceAdapter {
  public static readonly MAX_CONCURRENT_IN_FLIGHT = 32
  public static readonly MAX_DEDUP_CACHE_SIZE = 1000

  public readonly deviceId: string
  public readonly accessPointId: string
  public readonly direction: DeviceDirection

  private readonly config: HikvisionAdapterConfig
  private readonly digestAuth: HikvisionDigestAuth
  private readonly streamParser: HikvisionStreamParser
  private readonly readerMappings: Map<number, ReaderMapping>
  private readonly defaultDoorNo: number
  private readonly defaultReaderNo: number
  private readonly fetchFn: typeof fetch
  private readonly dedupWindowMs: number
  private readonly dedupCache: Map<string, DedupRecord>

  private credentialHandler: ((event: DeviceCredentialEvent) => Promise<DeviceAccessResult>) | null = null
  private isRunning: boolean = false
  private healthState: DeviceHealthState = 'STOPPED'
  private lastSeenAt?: string
  private lastError?: string
  private inFlightCount: number = 0

  private abortController: AbortController | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectDelay: number = 1000
  private activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null

  constructor(config: HikvisionAdapterConfig) {
    const validation = HikvisionConfigValidator.validate(config)
    if (!validation.valid) {
      throw new Error(`INVALID_HIKVISION_CONFIG: ${validation.errors.join(', ')}`)
    }

    // Defensive deep copying and freezing (D1-003)
    this.deviceId = config.deviceId
    this.accessPointId = config.accessPointId
    this.direction = config.direction || 'entry'

    this.defaultDoorNo = config.defaultDoorNo || 1
    this.defaultReaderNo = config.defaultReaderNo || 1
    this.fetchFn = config.customFetch || fetch
    this.dedupWindowMs = config.dedupWindowMs || 1500

    this.digestAuth = new HikvisionDigestAuth()
    this.streamParser = new HikvisionStreamParser(config.maxBufferSize || 65536)
    this.dedupCache = new Map()
    this.readerMappings = new Map()

    if (config.readerMappings) {
      for (const [key, val] of Object.entries(config.readerMappings)) {
        const readerNo = Number(key)
        const frozenMapping: Readonly<ReaderMapping> = Object.freeze({
          accessPointId: String(val.accessPointId),
          direction: val.direction === 'exit' ? 'exit' : 'entry',
          doorNo: Number(val.doorNo),
        })
        this.readerMappings.set(readerNo, frozenMapping)
      }
    } else {
      this.readerMappings.set(
        this.defaultReaderNo,
        Object.freeze({
          accessPointId: this.accessPointId,
          direction: this.direction,
          doorNo: this.defaultDoorNo,
        })
      )
    }

    const mappingsSnapshot: Record<number, ReaderMapping> = {}
    for (const [k, v] of this.readerMappings.entries()) {
      mappingsSnapshot[k] = { ...v }
    }

    this.config = Object.freeze({
      ...config,
      deviceId: this.deviceId,
      accessPointId: this.accessPointId,
      direction: this.direction,
      defaultDoorNo: this.defaultDoorNo,
      defaultReaderNo: this.defaultReaderNo,
      readerMappings: Object.freeze(mappingsSnapshot),
    })
  }

  onCredential(handler: (event: DeviceCredentialEvent) => Promise<DeviceAccessResult>): void {
    this.credentialHandler = handler
  }

  health(): DeviceHealth {
    return {
      state: this.healthState,
      lastSeenAt: this.lastSeenAt,
      errorDetails: this.lastError,
      inFlightCount: this.inFlightCount,
    }
  }

  private async getPassword(): Promise<string> {
    if (typeof this.config.password === 'function') {
      return this.config.password()
    }
    return this.config.password
  }

  private getBaseUrl(): string {
    const protocol = this.config.useHttps ? 'https' : 'http'
    const port = this.config.controllerPort
      ? `:${this.config.controllerPort}`
      : this.config.useHttps
      ? ':443'
      : ':80'
    return `${protocol}://${this.config.controllerHost}${port}`
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true
    this.healthState = 'STARTING'
    this.reconnectDelay = this.config.reconnectInitialDelayMs || 1000

    this.startAlertStream()
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return
    this.isRunning = false
    this.healthState = 'STOPPED'

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.activeReader) {
      try {
        await this.activeReader.cancel()
      } catch {}
      this.activeReader = null
    }

    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }

    this.streamParser.reset()
    this.digestAuth.reset()
    this.dedupCache.clear()
  }

  private scheduleReconnect(): void {
    if (!this.isRunning || this.reconnectTimer) return

    const maxDelay = this.config.reconnectMaxDelayMs || 30000
    // Add jitter
    const jitter = Math.floor(Math.random() * 200)
    const delay = Math.min(this.reconnectDelay + jitter, maxDelay)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.isRunning) {
        this.startAlertStream()
      }
    }, delay)

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, maxDelay)
  }

  private async startAlertStream(): Promise<void> {
    if (!this.isRunning) return

    this.abortController = new AbortController()
    const signal = this.abortController.signal
    const url = `${this.getBaseUrl()}/ISAPI/Event/notification/alertStream`
    const path = '/ISAPI/Event/notification/alertStream'

    try {
      const password = await this.getPassword()
      const headers: Record<string, string> = {
        Accept: 'multipart/mixed, application/xml',
      }

      if (this.digestAuth.hasChallenge()) {
        const authHeader = this.digestAuth.generateAuthorizationHeader('GET', path, {
          username: this.config.username,
          password,
        })
        if (authHeader) {
          headers['Authorization'] = authHeader
        }
      }

      const timeoutMs = this.config.requestTimeoutMs || 5000
      const timeoutId = setTimeout(() => {
        // Initial connection timeout
        if (this.healthState === 'STARTING') {
          this.abortController?.abort()
        }
      }, timeoutMs)

      const response = await this.fetchFn(url, {
        method: 'GET',
        headers,
        signal,
      })

      clearTimeout(timeoutId)

      if (response.status === 401) {
        const wwwAuth = response.headers.get('WWW-Authenticate') || response.headers.get('www-authenticate')
        if (wwwAuth) {
          const challenge = HikvisionDigestAuth.parseChallenge(wwwAuth)
          if (challenge) {
            this.digestAuth.setChallenge(challenge)
            // Retry stream connection with new challenge
            return this.startAlertStream()
          }
        }
        this.healthState = 'ERROR'
        this.lastError = 'DIGEST_AUTHENTICATION_FAILED'
        this.scheduleReconnect()
        return
      }

      if (!response.ok) {
        this.healthState = 'DEGRADED'
        this.lastError = `ALERT_STREAM_HTTP_${response.status}`
        this.scheduleReconnect()
        return
      }

      // Stream successfully established
      this.healthState = 'READY'
      this.lastSeenAt = new Date().toISOString()
      this.lastError = undefined
      const contentType = response.headers.get('content-type') || ''
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/i)
      if (boundaryMatch && boundaryMatch[1]) {
        this.streamParser.setBoundary(boundaryMatch[1])
      }

      if (!response.body) {
        throw new Error('NO_STREAM_BODY')
      }

      const reader = response.body.getReader()
      this.activeReader = reader
      const decoder = new TextDecoder()

      while (this.isRunning) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) {
          const chunkStr = typeof value === 'string' ? value : decoder.decode(value, { stream: true })
          const events = this.streamParser.feed(chunkStr)
          for (const xml of events) {
            this.handleStreamXml(xml)
          }
        }
      }
    } catch (err: unknown) {
      if (!this.isRunning) return
      const message = err instanceof Error ? err.message : String(err)
      if (message !== 'The user aborted a request.' && message !== 'AbortError') {
        this.healthState = 'DEGRADED'
        this.lastError = message
      }
    } finally {
      this.activeReader = null
      if (this.isRunning) {
        this.scheduleReconnect()
      }
    }
  }

  private handleStreamXml(xml: string): void {
    this.lastSeenAt = new Date().toISOString()

    try {
      const parsed = HikvisionXmlParser.parseEvent(xml)
      if (parsed.eventType !== 'AccessControllerEvent') {
        return
      }

      // If no card number present, ignore (e.g. door open sensor event)
      if (!parsed.cardNo) {
        return
      }

      const readerNo = parsed.cardReaderNo || this.defaultReaderNo
      const mapping = this.readerMappings.get(readerNo)
      if (!mapping) {
        // Unknown unmapped reader, ignore
        return
      }

      // Deduplication check
      const dedupKey = `${parsed.cardNo}:${readerNo}`
      const now = Date.now()

      // Prune expired dedup records first
      this.pruneDedupCache(now)

      const existing = this.dedupCache.get(dedupKey)
      if (existing && now - existing.timestamp < this.dedupWindowMs) {
        // Drop duplicate within active window
        return
      }

      // If new unseen key and cache is at maximum capacity, fail closed:
      // Drop new event to preserve replay protection for active cached credentials.
      if (!existing && this.dedupCache.size >= HikvisionIsapiAdapter.MAX_DEDUP_CACHE_SIZE) {
        this.healthState = 'DEGRADED'
        this.lastError = 'DEDUP_CACHE_CAPACITY_EXCEEDED'
        return
      }

      this.dedupCache.set(dedupKey, { timestamp: now, serialNo: parsed.serialNo })

      // In-flight concurrency capacity check: fail-closed at limit to prevent async promise exhaustion
      if (this.inFlightCount >= HikvisionIsapiAdapter.MAX_CONCURRENT_IN_FLIGHT) {
        this.healthState = 'DEGRADED'
        this.lastError = 'CONCURRENT_IN_FLIGHT_CAPACITY_EXCEEDED'
        return
      }

      // Dispatch to controller
      if (this.credentialHandler) {
        this.inFlightCount++
        const event: DeviceCredentialEvent = {
          credential: parsed.cardNo,
          credentialType: 'rfid',
          provider: null,
          occurredAt: new Date().toISOString(),
          rawMetadata: {
            cardReaderNo: readerNo,
            doorNo: mapping.doorNo,
            serialNo: parsed.serialNo,
            t0ReceivedMs: performance.now(),
          },
        }

        try {
          const promise = this.credentialHandler(event)
          Promise.resolve(promise)
            .then((res: DeviceAccessResult) => {
              if (res && res.decision === 'allow' && res.unlocked) {
                return this.sendRemoteOpen(mapping.doorNo)
              }
            })
            .catch((err) => {
              this.lastError = err instanceof Error ? err.message : String(err)
            })
            .finally(() => {
              this.inFlightCount = Math.max(0, this.inFlightCount - 1)
            })
        } catch (err) {
          this.lastError = err instanceof Error ? err.message : String(err)
          this.inFlightCount = Math.max(0, this.inFlightCount - 1)
        }
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
    }
  }

  private pruneDedupCache(now: number): void {
    for (const [key, record] of this.dedupCache.entries()) {
      if (now - record.timestamp > this.dedupWindowMs * 2) {
        this.dedupCache.delete(key)
      }
    }
  }

  async actuate(result: DeviceAccessResult): Promise<void> {
    if (result.decision === 'allow' && result.unlocked) {
      await this.sendRemoteOpen(this.defaultDoorNo)
    }
  }

  private async sendRemoteOpen(doorNo: number): Promise<boolean> {
    const url = `${this.getBaseUrl()}/ISAPI/AccessControl/RemoteControl/door/${doorNo}`
    const path = `/ISAPI/AccessControl/RemoteControl/door/${doorNo}`
    const xmlBody = `<RemoteControlDoor version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">\n    <cmd>open</cmd>\n</RemoteControlDoor>`

    try {
      const password = await this.getPassword()
      const headers: Record<string, string> = {
        'Content-Type': 'application/xml',
      }

      if (this.digestAuth.hasChallenge()) {
        const authHeader = this.digestAuth.generateAuthorizationHeader('PUT', path, {
          username: this.config.username,
          password,
        })
        if (authHeader) {
          headers['Authorization'] = authHeader
        }
      }

      const response = await this.fetchFn(url, {
        method: 'PUT',
        headers,
        body: xmlBody,
      })

      if (response.status === 401) {
        const wwwAuth = response.headers.get('WWW-Authenticate') || response.headers.get('www-authenticate')
        if (wwwAuth) {
          const challenge = HikvisionDigestAuth.parseChallenge(wwwAuth)
          if (challenge) {
            this.digestAuth.setChallenge(challenge)
            // Retry once with new challenge
            const retryHeader = this.digestAuth.generateAuthorizationHeader('PUT', path, {
              username: this.config.username,
              password,
            })
            if (retryHeader) {
              headers['Authorization'] = retryHeader
              const retryRes = await this.fetchFn(url, {
                method: 'PUT',
                headers,
                body: xmlBody,
              })
              return retryRes.ok
            }
          }
        }
        return false
      }

      if (!response.ok) {
        this.lastError = `ACTUATION_HTTP_${response.status}`
        return false
      }

      const resText = await response.text()
      try {
        const status = HikvisionXmlParser.parseResponseStatus(resText)
        return status.statusCode === 1 || status.statusString === 'OK'
      } catch {
        return true
      }
    } catch (err) {
      // Ambiguous failure: record error and do NOT blindly retry
      this.lastError = err instanceof Error ? err.message : String(err)
      return false
    }
  }
}

