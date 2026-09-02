import type { AccessReason } from './types'

export type DeviceDirection = 'entry' | 'exit'

export type DeviceHealthState =
  | 'STOPPED'
  | 'STARTING'
  | 'READY'
  | 'BUSY'
  | 'DEGRADED'
  | 'ERROR'

export interface DeviceHealth {
  state: DeviceHealthState
  lastSeenAt?: string
  errorDetails?: string
  inFlightCount: number
}

export type CredentialType = 'rfid' | 'nfc' | 'qr' | 'fingerprint' | 'face' | 'external'

export interface DeviceCredentialEvent {
  credential: string
  credentialType?: CredentialType
  provider?: string | null
  occurredAt?: string
  rawMetadata?: Record<string, unknown>
}

export interface DeviceAccessResult {
  decision: 'allow' | 'deny'
  reasonCode: AccessReason
  eventId: string
  unlocked: boolean
  unlockDurationMs?: number
  occurredAt: string
  memberId?: string
}

export interface AccessDeviceAdapterConfig {
  deviceId: string
  accessPointId: string
  direction?: DeviceDirection
  name?: string
}

export interface AccessDeviceAdapter {
  readonly deviceId: string
  readonly accessPointId: string
  readonly direction: DeviceDirection

  start(): Promise<void>
  stop(): Promise<void>
  health(): DeviceHealth

  onCredential(
    handler: (event: DeviceCredentialEvent) => Promise<DeviceAccessResult>
  ): void

  actuate(result: DeviceAccessResult): Promise<void>
}

export type TurnstileState =
  | 'LOCKED'
  | 'UNLOCKED'
  | 'PASSAGE_DETECTED'
  | 'RELOCKED'

export interface SimulatorHistoryEntry {
  id: string
  timestamp: string
  type: 'scan' | 'decision' | 'actuation' | 'passage' | 'timeout_relock' | 'error'
  state: TurnstileState
  details: {
    maskedCredential?: string
    credentialType?: string
    decision?: 'allow' | 'deny'
    reasonCode?: AccessReason
    eventId?: string
    error?: string
  }
}

