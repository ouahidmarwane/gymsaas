import type {
  AccessDeviceAdapter,
  AccessDeviceAdapterConfig,
  CredentialType,
  DeviceAccessResult,
  DeviceCredentialEvent,
  DeviceDirection,
  DeviceHealth,
  DeviceHealthState,
  SimulatorHistoryEntry,
  TurnstileState,
} from './adapter-types'
import { CredentialNormalizer } from './credential-normalizer'

export interface TurnstileSimulatorOptions extends AccessDeviceAdapterConfig {
  unlockDurationMs?: number
  maxQueueSize?: number
  maxHistorySize?: number
}

export class TurnstileSimulator implements AccessDeviceAdapter {
  public readonly deviceId: string
  public readonly accessPointId: string
  public readonly direction: DeviceDirection
  public readonly name: string
  public readonly unlockDurationMs: number
  public readonly maxQueueSize: number
  public readonly maxHistorySize: number

  private state: TurnstileState = 'LOCKED'
  private healthState: DeviceHealthState = 'STOPPED'
  private lastSeenAt?: string
  private errorDetails?: string
  private handler: ((event: DeviceCredentialEvent) => Promise<DeviceAccessResult>) | null = null
  private history: SimulatorHistoryEntry[] = []
  private unlockTimer: any = null
  private inFlightCount: number = 0
  private isProcessing: boolean = false
  private queue: Array<{
    event: DeviceCredentialEvent
    resolve: (res: DeviceAccessResult) => void
    reject: (err: unknown) => void
  }> = []

  constructor(options: TurnstileSimulatorOptions) {
    this.deviceId = options.deviceId
    this.accessPointId = options.accessPointId
    this.direction = options.direction || 'entry'
    this.name = options.name || `Turnstile-${this.deviceId.slice(0, 8)}`
    this.unlockDurationMs = Math.max(500, Math.min(10000, options.unlockDurationMs ?? 3000))
    this.maxQueueSize = options.maxQueueSize ?? 50
    this.maxHistorySize = options.maxHistorySize ?? 100
  }

  async start(): Promise<void> {
    this.state = 'LOCKED'
    this.healthState = 'READY'
    this.errorDetails = undefined
    this.lastSeenAt = new Date().toISOString()
    this.recordHistory('actuation', { decision: 'deny', reasonCode: 'SYSTEM_ERROR' })
  }

  async stop(): Promise<void> {
    if (this.unlockTimer) {
      clearTimeout(this.unlockTimer)
      this.unlockTimer = null
    }
    this.state = 'LOCKED'
    this.healthState = 'STOPPED'
    this.lastSeenAt = new Date().toISOString()
  }

  health(): DeviceHealth {
    return {
      state: this.healthState,
      lastSeenAt: this.lastSeenAt,
      errorDetails: this.errorDetails,
      inFlightCount: this.inFlightCount,
    }
  }

  getState(): TurnstileState {
    return this.state
  }

  getHistory(): SimulatorHistoryEntry[] {
    return [...this.history]
  }

  onCredential(handler: (event: DeviceCredentialEvent) => Promise<DeviceAccessResult>): void {
    this.handler = handler
  }

  async actuate(result: DeviceAccessResult): Promise<void> {
    this.lastSeenAt = new Date().toISOString()

    if (result.decision === 'allow' && result.unlocked) {
      if (this.unlockTimer) {
        clearTimeout(this.unlockTimer)
        this.unlockTimer = null
      }
      this.state = 'UNLOCKED'
      this.recordHistory('actuation', {
        decision: result.decision,
        reasonCode: result.reasonCode,
        eventId: result.eventId,
      })

      const duration = result.unlockDurationMs || this.unlockDurationMs
      this.unlockTimer = setTimeout(() => {
        this.state = 'LOCKED'
        this.unlockTimer = null
        this.recordHistory('timeout_relock', {
          decision: 'deny',
          reasonCode: 'SYSTEM_ERROR',
        })
      }, duration)
    } else {
      // Fail-closed: ensure gate is locked
      if (this.state !== 'UNLOCKED') {
        this.state = 'LOCKED'
      }
      this.recordHistory('actuation', {
        decision: result.decision,
        reasonCode: result.reasonCode,
        eventId: result.eventId,
      })
    }
  }

  simulatePassage(): boolean {
    this.lastSeenAt = new Date().toISOString()

    if (this.state === 'UNLOCKED') {
      if (this.unlockTimer) {
        clearTimeout(this.unlockTimer)
        this.unlockTimer = null
      }
      this.state = 'PASSAGE_DETECTED'
      this.recordHistory('passage', {})

      // Immediately relock after passage
      this.state = 'LOCKED'
      this.recordHistory('actuation', {})
      return true
    }

    // Attempted passage while locked
    this.recordHistory('error', { error: 'PASSAGE_DENIED_WHILE_LOCKED' })
    return false
  }

  async scanCredential(
    credential: string,
    type: CredentialType = 'rfid',
    occurredAt?: string,
    provider: string | null = null
  ): Promise<DeviceAccessResult> {
    this.lastSeenAt = new Date().toISOString()

    if (this.healthState === 'STOPPED') {
      const denyRes: DeviceAccessResult = {
        decision: 'deny',
        reasonCode: 'DEVICE_DISABLED',
        eventId: crypto.randomUUID(),
        unlocked: false,
        occurredAt: occurredAt || new Date().toISOString(),
      }
      this.recordHistory('error', {
        maskedCredential: CredentialNormalizer.mask(credential),
        credentialType: type,
        error: 'DEVICE_STOPPED',
      })
      return denyRes
    }

    if (this.inFlightCount >= this.maxQueueSize) {
      this.healthState = 'DEGRADED'
      this.errorDetails = 'QUEUE_OVERFLOW'
      const denyRes: DeviceAccessResult = {
        decision: 'deny',
        reasonCode: 'SYSTEM_ERROR',
        eventId: crypto.randomUUID(),
        unlocked: false,
        occurredAt: occurredAt || new Date().toISOString(),
      }
      this.recordHistory('error', {
        maskedCredential: CredentialNormalizer.mask(credential),
        credentialType: type,
        error: 'QUEUE_OVERFLOW',
      })
      return denyRes
    }

    const event: DeviceCredentialEvent = {
      credential,
      credentialType: type,
      provider,
      occurredAt: occurredAt || new Date().toISOString(),
    }

    return new Promise<DeviceAccessResult>((resolve, reject) => {
      this.inFlightCount++
      this.queue.push({ event, resolve, reject })
      this.processQueue()
    })
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return
    this.isProcessing = true

    while (this.queue.length > 0) {
      const item = this.queue.shift()!
      try {
        const { event, resolve } = item
        this.healthState = this.inFlightCount > 10 ? 'BUSY' : 'READY'

        this.recordHistory('scan', {
          maskedCredential: CredentialNormalizer.mask(event.credential),
          credentialType: event.credentialType,
        })

        let result: DeviceAccessResult

        if (!this.handler) {
          result = {
            decision: 'deny',
            reasonCode: 'SYSTEM_ERROR',
            eventId: crypto.randomUUID(),
            unlocked: false,
            occurredAt: event.occurredAt || new Date().toISOString(),
          }
        } else {
          try {
            result = await this.handler(event)
          } catch (handlerErr: unknown) {
            const errorMsg = handlerErr instanceof Error ? handlerErr.message : 'HANDLER_ERROR'
            result = {
              decision: 'deny',
              reasonCode: 'SYSTEM_ERROR',
              eventId: crypto.randomUUID(),
              unlocked: false,
              occurredAt: event.occurredAt || new Date().toISOString(),
            }
            this.recordHistory('error', { error: errorMsg })
          }
        }

        await this.actuate(result)
        resolve(result)
      } catch (err: unknown) {
        item.reject(err)
      } finally {
        this.inFlightCount--
      }
    }

    this.isProcessing = false
    if (this.healthState === 'BUSY' && this.inFlightCount === 0) {
      this.healthState = 'READY'
    }
  }

  private recordHistory(
    type: SimulatorHistoryEntry['type'],
    details: SimulatorHistoryEntry['details']
  ): void {
    const entry: SimulatorHistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      state: this.state,
      details,
    }
    this.history.push(entry)
    if (this.history.length > this.maxHistorySize) {
      this.history.shift()
    }
  }

  reset(): void {
    if (this.unlockTimer) {
      clearTimeout(this.unlockTimer)
      this.unlockTimer = null
    }
    this.state = 'LOCKED'
    this.healthState = 'STOPPED'
    this.errorDetails = undefined
    this.inFlightCount = 0
    this.isProcessing = false
    this.queue = []
    this.history = []
  }
}

