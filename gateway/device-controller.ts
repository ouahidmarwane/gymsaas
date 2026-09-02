import type { AccessDeviceAdapter, DeviceAccessResult, DeviceCredentialEvent } from './adapter-types'
import { CredentialNormalizer } from './credential-normalizer'
import type { AccessGatewayRuntime } from './runtime'
import type { AuthorizationResult } from './types'

export class AccessDeviceController {
  public readonly adapter: AccessDeviceAdapter
  public readonly runtime: AccessGatewayRuntime
  private isRunning: boolean = false

  constructor(adapter: AccessDeviceAdapter, runtime: AccessGatewayRuntime) {
    this.adapter = adapter
    this.runtime = runtime
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    this.adapter.onCredential(async (event: DeviceCredentialEvent) => {
      return this.handleCredentialEvent(event)
    })
    await this.adapter.start()
    this.isRunning = true
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return
    await this.adapter.stop()
    this.isRunning = false
  }

  private async handleCredentialEvent(event: DeviceCredentialEvent): Promise<DeviceAccessResult> {
    const occurredAt = event.occurredAt || new Date().toISOString()
    const type = event.credentialType || 'rfid'

    try {
      // 1. Validate credential format
      const validation = CredentialNormalizer.validate(type, event.credential)
      if (!validation.valid) {
        // Enqueue fail-closed event into Gateway queue
        const eventId = crypto.randomUUID()
        const denyResult: DeviceAccessResult = {
          decision: 'deny',
          reasonCode: 'CREDENTIAL_UNKNOWN',
          eventId,
          unlocked: false,
          occurredAt,
        }

        this.runtime.eventQueue.enqueue({
          id: eventId,
          occurredAt,
          credentialLookupHash: '0'.repeat(64),
          accessPointId: this.adapter.accessPointId,
          decision: 'deny',
          reasonCode: 'CREDENTIAL_UNKNOWN',
          snapshotRevision: this.runtime.getActiveRevision(),
        })

        return denyResult
      }

      // 2. Compute canonical lookup hash
      const lookupHash = await CredentialNormalizer.computeLookupHash(
        type,
        event.credential,
        event.provider ?? null
      )

      // 3. Authoritative Gateway evaluation
      const authResult: AuthorizationResult = await this.runtime.authorizeCredential({
        lookupHash,
        accessPointId: this.adapter.accessPointId,
        occurredAt,
      })

      // 4. Map to actuation result
      const isAllowed = authResult.decision === 'allow'
      const deviceResult: DeviceAccessResult = {
        decision: authResult.decision,
        reasonCode: authResult.reasonCode,
        eventId: authResult.eventId,
        unlocked: isAllowed,
        unlockDurationMs: isAllowed ? 3000 : undefined,
        occurredAt: authResult.occurredAt,
        memberId: authResult.memberId,
      }

      return deviceResult
    } catch {
      // Fail closed on unexpected exception
      const eventId = crypto.randomUUID()
      const fallbackResult: DeviceAccessResult = {
        decision: 'deny',
        reasonCode: 'SYSTEM_ERROR',
        eventId,
        unlocked: false,
        occurredAt,
      }

      this.runtime.eventQueue.enqueue({
        id: eventId,
        occurredAt,
        credentialLookupHash: '0'.repeat(64),
        accessPointId: this.adapter.accessPointId,
        decision: 'deny',
        reasonCode: 'SYSTEM_ERROR',
        snapshotRevision: this.runtime.getActiveRevision(),
      })

      return fallbackResult
    }
  }
}

