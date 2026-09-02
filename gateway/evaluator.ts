import type {
  AccessAuthorizationSnapshot,
  AccessReason,
  SnapshotAccessPoint,
  SnapshotCredential,
  SnapshotMember,
  SnapshotRule,
} from './types'

export interface EvaluationInput {
  lookupHash: string
  accessPointId: string
  occurredAt?: string
}

export interface EvaluationOutput {
  decision: 'allow' | 'deny'
  reasonCode: AccessReason
  memberId?: string
}

export class OfflineAuthorizationEvaluator {
  private readonly snapshot: AccessAuthorizationSnapshot
  private readonly accessPointsMap = new Map<string, SnapshotAccessPoint>()
  private readonly credentialsMap = new Map<string, SnapshotCredential>()
  private readonly membersMap = new Map<string, SnapshotMember>()
  private readonly rulesList: SnapshotRule[] = []

  constructor(snapshot: AccessAuthorizationSnapshot) {
    this.snapshot = snapshot
    for (const point of snapshot.accessPoints) {
      this.accessPointsMap.set(point.id, point)
    }
    for (const cred of snapshot.credentials) {
      this.credentialsMap.set(cred.lookupHash, cred)
    }
    for (const member of snapshot.members) {
      this.membersMap.set(member.id, member)
    }
    // Sort rules by priority DESC, then id
    this.rulesList = [...snapshot.rules].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return a.id.localeCompare(b.id)
    })
  }

  get revision(): number {
    return this.snapshot.revision
  }

  get branchId(): string {
    return this.snapshot.branchId
  }

  get validUntil(): string {
    return this.snapshot.validUntil
  }

  evaluate(input: EvaluationInput): EvaluationOutput {
    const occurredAt = input.occurredAt || new Date().toISOString()
    const point = this.accessPointsMap.get(input.accessPointId)

    let reason: AccessReason = 'SYSTEM_ERROR'

    if (!point) {
      reason = 'ACCESS_POINT_UNKNOWN'
    } else if (!this.snapshot.branchActive) {
      reason = 'WRONG_BRANCH'
    } else if (point.gatewayStatus !== 'online') {
      reason = 'GATEWAY_DISABLED'
    } else if (point.deviceStatus !== 'online') {
      reason = 'DEVICE_DISABLED'
    } else if (point.status !== 'active') {
      reason = 'ACCESS_POINT_DISABLED'
    } else {
      const credential = this.credentialsMap.get(input.lookupHash)

      if (!credential) {
        reason = 'CREDENTIAL_UNKNOWN'
      } else if (credential.status === 'revoked') {
        reason = 'CREDENTIAL_REVOKED'
      } else if (credential.status === 'lost') {
        reason = 'CREDENTIAL_LOST'
      } else if (credential.status === 'disabled') {
        reason = 'CREDENTIAL_DISABLED'
      } else {
        const member = this.membersMap.get(credential.memberId)

        if (!member || member.status !== 'active') {
          reason = 'MEMBER_INACTIVE'
        } else if (member.disciplineId && member.disciplineActive !== true) {
          reason = 'WRONG_DISCIPLINE'
        } else {
          // Derive local date, time, weekday using snapshot.timezone
          let localDate: string
          let localTime: string
          let localWeekday: number

          try {
            const dateObj = new Date(occurredAt)
            const formatter = new Intl.DateTimeFormat('en-CA', {
              timeZone: this.snapshot.timezone,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hourCycle: 'h23',
              weekday: 'short',
            })
            const parts = formatter.formatToParts(dateObj)
            const part = (kind: string) => parts.find(p => p.type === kind)?.value ?? ''
            const weekdays: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
            const wd = weekdays[part('weekday')]

            if (wd === undefined) {
              return { decision: 'deny', reasonCode: 'SYSTEM_ERROR' }
            }

            localWeekday = wd
            localDate = `${part('year')}-${part('month')}-${part('day')}`
            localTime = `${part('hour')}:${part('minute')}`
          } catch {
            return { decision: 'deny', reasonCode: 'SYSTEM_ERROR' }
          }

          if (member.subscriptionExpiresAt && member.subscriptionExpiresAt < localDate) {
            reason = 'SUBSCRIPTION_EXPIRED'
          } else {
            // Rule evaluation matching point, member, discipline
            let allow = false
            let deny = false
            let outside = false

            for (const rule of this.rulesList) {
              const matchesPoint = rule.accessPointId === null || rule.accessPointId === point.id
              const matchesMember = rule.memberId === null || rule.memberId === member.id
              const matchesDiscipline = rule.disciplineId === null || rule.disciplineId === member.disciplineId

              if (!matchesPoint || !matchesMember || !matchesDiscipline) {
                continue
              }

              const appliesDate = (!rule.validFrom || String(rule.validFrom) <= occurredAt) &&
                                  (!rule.validUntil || String(rule.validUntil) > occurredAt)
              const appliesDay = (Number(rule.daysMask) & (1 << localWeekday)) !== 0
              const appliesTime = !rule.startTime || (String(rule.startTime) <= localTime && localTime < String(rule.endTime))

              if (appliesDate && appliesDay && appliesTime) {
                if (rule.effect === 'deny') {
                  deny = true
                } else {
                  allow = true
                }
              } else if (rule.effect === 'allow') {
                outside = true
              }
            }

            reason = deny
              ? 'ACCESS_RULE_DENIED'
              : allow
                ? 'ACCESS_GRANTED'
                : outside
                  ? 'OUTSIDE_ALLOWED_HOURS'
                  : 'ACCESS_RULE_DENIED'
          }
        }
      }
    }

    const decision = reason === 'ACCESS_GRANTED' ? 'allow' : 'deny'
    const memberId = (decision === 'allow' && input.lookupHash && this.credentialsMap.get(input.lookupHash)?.memberId) || undefined

    return {
      decision,
      reasonCode: reason,
      ...(memberId ? { memberId } : {}),
    }
  }
}

