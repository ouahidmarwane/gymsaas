import type {
  AccessAuthorizationSnapshot,
  SnapshotAccessPoint,
  SnapshotCredential,
  SnapshotMember,
  SnapshotRule,
} from '../src/access-snapshot'

export type {
  AccessAuthorizationSnapshot,
  SnapshotAccessPoint,
  SnapshotCredential,
  SnapshotMember,
  SnapshotRule,
}

export type AccessReason =
  | 'ACCESS_GRANTED'
  | 'ACCESS_POINT_UNKNOWN'
  | 'CREDENTIAL_UNKNOWN'
  | 'CREDENTIAL_REVOKED'
  | 'CREDENTIAL_LOST'
  | 'CREDENTIAL_DISABLED'
  | 'MEMBER_INACTIVE'
  | 'SUBSCRIPTION_EXPIRED'
  | 'WRONG_BRANCH'
  | 'WRONG_DISCIPLINE'
  | 'GATEWAY_DISABLED'
  | 'DEVICE_DISABLED'
  | 'ACCESS_POINT_DISABLED'
  | 'OUTSIDE_ALLOWED_HOURS'
  | 'ACCESS_RULE_DENIED'
  | 'SYSTEM_ERROR'

export type GatewayHealthState =
  | 'UNENROLLED'
  | 'STARTING'
  | 'ONLINE'
  | 'OFFLINE_VALID_SNAPSHOT'
  | 'OFFLINE_NO_VALID_SNAPSHOT'
  | 'AUTH_FAILURE'
  | 'REVOKED'
  | 'DEGRADED_QUEUE'

export interface GatewayIdentity {
  gatewayId: string
  branchId?: string
  snapshotVerificationKey: string
}

export interface SecretStore {
  getMachinePrivateKey(): Promise<string | null>
  setMachinePrivateKey(key: string): Promise<void>
  clear(): Promise<void>
}

export interface AuthorizationRequest {
  lookupHash?: string
  credential?: string
  credentialType?: 'rfid' | 'nfc' | 'qr' | 'fingerprint' | 'face' | 'external'
  accessPointId: string
  occurredAt?: string
}

export interface AuthorizationResult {
  decision: 'allow' | 'deny'
  reasonCode: AccessReason
  eventId: string
  snapshotRevision: number
  occurredAt: string
  memberId?: string
}

export interface QueuedEvent {
  id: string
  occurredAt: string
  credentialLookupHash: string
  accessPointId: string
  decision: 'allow' | 'deny'
  reasonCode: AccessReason
  snapshotRevision: number
  attempts: number
  status: 'pending' | 'in_flight'
  createdAt: string
}

export interface GatewayHeartbeatPayload {
  version: string
  queueDepth: number
  snapshotRevision: number
  health: {
    ok: boolean
    details?: string
  }
}

export interface GatewayHeartbeatResponse {
  serverTime: string
  desiredSnapshotRevision: number
  gatewayStatus: 'pending' | 'provisioned' | 'online' | 'offline' | 'revoked'
  syncRequired: boolean
  rotationHint?: boolean
}

export interface GatewayEventBatchPayload {
  events: Array<{
    id: string
    occurredAt: string
    credentialLookupHash: string
    accessPointId: string
    decision: 'allow' | 'deny'
    reasonCode: AccessReason
    snapshotRevision: number
  }>
}

export interface GatewayEventUploadResponse {
  accepted: number
  duplicates: string[]
  errors: Array<{ index: number; reason: string; eventId: string }>
}

export interface GatewayEnrollmentResponse {
  gatewayId: string
  machinePrivateKey: string
  snapshotVerificationKey: string
}

