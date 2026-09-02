// Portable signed wire contract for GymFlow Access Gateways.
// This version is intentionally independent from the tenant SQLite schema
// migration number so consumers can reject unsupported formats explicitly.

export const ACCESS_SNAPSHOT_SCHEMA_VERSION = 2 as const

export type SnapshotCredential = {
  lookupHash: string
  memberId: string
  status: 'active' | 'revoked' | 'lost' | 'disabled'
}

export type SnapshotMember = {
  id: string
  status: 'active' | 'inactive' | 'archived'
  subscriptionExpiresAt: string | null
  disciplineId: string | null
  disciplineActive: boolean | null
}

export type SnapshotAccessPoint = {
  id: string
  direction: 'entry' | 'exit' | 'bidirectional'
  status: 'active' | 'disabled'
  deviceStatus: 'pending' | 'online' | 'offline' | 'disabled'
  gatewayStatus: 'pending' | 'provisioned' | 'online' | 'offline' | 'revoked' | 'disabled'
}

export type SnapshotRule = {
  id: string
  accessPointId: string | null
  memberId: string | null
  disciplineId: string | null
  effect: 'allow' | 'deny'
  priority: number
  daysMask: number
  startTime: string | null
  endTime: string | null
  validFrom: string | null
  validUntil: string | null
}

export type AccessAuthorizationSnapshot = {
  snapshotSchemaVersion: typeof ACCESS_SNAPSHOT_SCHEMA_VERSION
  revision: number
  generatedAt: string
  validUntil: string
  branchId: string
  branchActive: boolean
  timezone: string
  accessPoints: SnapshotAccessPoint[]
  credentials: SnapshotCredential[]
  members: SnapshotMember[]
  rules: SnapshotRule[]
}
