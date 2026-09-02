export const ACCESS_REASONS = [
  'ACCESS_GRANTED', 'ACCESS_POINT_UNKNOWN', 'CREDENTIAL_UNKNOWN', 'CREDENTIAL_REVOKED',
  'CREDENTIAL_LOST', 'CREDENTIAL_DISABLED', 'MEMBER_INACTIVE', 'SUBSCRIPTION_EXPIRED',
  'WRONG_BRANCH', 'WRONG_DISCIPLINE', 'GATEWAY_DISABLED', 'DEVICE_DISABLED',
  'ACCESS_POINT_DISABLED', 'OUTSIDE_ALLOWED_HOURS', 'ACCESS_RULE_DENIED', 'SYSTEM_ERROR',
] as const

export type AccessReason = typeof ACCESS_REASONS[number]
export type AccessScope = { branchId?: string | null; disciplineId?: string | null }
export type AccessActor = { id: string; name: string }
export const ACCESS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function optionalString(value: unknown, max: number, error = 'INVALID_FIELD'): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(error)
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > max) throw new Error(error)
  return trimmed
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  let difference = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0)
  return difference === 0
}

function rulePair(startValue: unknown, endValue: unknown, kind: 'time'|'instant'): [string|null,string|null] {
  const max = kind === 'time' ? 5 : 20
  const start = optionalString(startValue, max, 'INVALID_RULE')
  const end = optionalString(endValue, max, 'INVALID_RULE')
  if (Boolean(start) !== Boolean(end)) throw new Error('INVALID_RULE')
  if (!start) return [null, null]
  if (kind === 'time') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end!) || start >= end!) throw new Error('INVALID_RULE')
  } else {
    const canonical = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z','Z') === value
    if (!canonical(start) || !canonical(end!) || start >= end!) throw new Error('INVALID_RULE')
  }
  return [start, end]
}

export function normalizeCredential(type: string, identifier: string): string {
  const trimmed = identifier.trim()
  if (!trimmed || trimmed.length > 512) throw new Error('INVALID_CREDENTIAL')
  if (type === 'rfid' || type === 'nfc') {
    const value = trimmed.replace(/[-:\s]/g, '').toUpperCase()
    if (!/^[0-9A-F]{4,128}$/.test(value)) throw new Error('INVALID_CREDENTIAL')
    return value
  }
  if (type === 'qr') {
    if (trimmed.length < 8) throw new Error('INVALID_CREDENTIAL')
    return trimmed
  }
  if (trimmed.length > 160) throw new Error('INVALID_CREDENTIAL')
  return trimmed
}

export async function credentialDigest(type: string, provider: string | null, identifier: string): Promise<string> {
  const normalizedProvider = optionalString(provider, 80, 'INVALID_CREDENTIAL')
  const canonical = `gymflow-access-v1\0${type}\0${normalizedProvider ?? ''}\0${normalizeCredential(type, identifier)}`
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))
}

export async function accessRequestDigest(canonicalRequest: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest)))
}

export function maskCredential(identifier: string): string {
  const clean = identifier.replace(/\s/g, '')
  return `${'•'.repeat(4)}${clean.slice(-4)}`.slice(0, 24)
}

type Row = Record<string, SqlStorageValue>

function scopeSql(scope: AccessScope, branchColumn = 'branch_id', disciplineColumn?: string) {
  const clauses: string[] = []
  const params: unknown[] = []
  if (scope.branchId) { clauses.push(`${branchColumn} = ?`); params.push(scope.branchId) }
  if (scope.disciplineId && disciplineColumn) { clauses.push(`${disciplineColumn} = ?`); params.push(scope.disciplineId) }
  return { clauses, params }
}

function pageCursor(cursor?: { val: string; id: string } | null, column = 'created_at') {
  const idColumn = column.includes('.') ? `${column.slice(0, column.lastIndexOf('.') + 1)}id` : 'id'
  return cursor
    ? { clause: `(${column} < ? OR (${column} = ? AND ${idColumn} < ?))`, params: [cursor.val, cursor.val, cursor.id] }
    : { clause: '', params: [] as unknown[] }
}

export function safeTimezone(tz: string | null | undefined): string {
  if (typeof tz !== 'string' || !tz.trim()) return 'Africa/Casablanca'
  const clean = tz.trim()
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: clean }).format(new Date())
    return clean
  } catch {
    return 'Africa/Casablanca'
  }
}

export function isValidDateStr(str: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false
  const [yearStr, monthStr, dayStr] = str.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && (d.getUTCMonth() + 1) === month && d.getUTCDate() === day
}

export function getFollowingDateStr(dateStr: string): string {
  const parts = dateStr.split('-').map(Number)
  const y = parts[0] ?? 1970
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  const dt = new Date(Date.UTC(y, m - 1, d + 1))
  return dt.toISOString().slice(0, 10)
}

export function getPreviousDateStr(dateStr: string): string {
  const parts = dateStr.split('-').map(Number)
  const y = parts[0] ?? 1970
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  const dt = new Date(Date.UTC(y, m - 1, d - 1))
  return dt.toISOString().slice(0, 10)
}

export function getLocalDateStr(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const y = parts.find(p => p.type === 'year')?.value ?? '1970'
  const m = parts.find(p => p.type === 'month')?.value ?? '01'
  const d = parts.find(p => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}`
}

export function getLocalMidnightUtc(year: number, month: number, day: number, timeZone: string): string {
  let currentMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hourCycle: 'h23',
  })
  for (let iter = 0; iter < 4; iter++) {
    const parts = dtf.formatToParts(new Date(currentMs))
    let y = 0, m = 0, d = 0, h = 0, min = 0, s = 0
    for (const part of parts) {
      if (part.type === 'year') y = Number(part.value)
      else if (part.type === 'month') m = Number(part.value)
      else if (part.type === 'day') d = Number(part.value)
      else if (part.type === 'hour') h = Number(part.value)
      else if (part.type === 'minute') min = Number(part.value)
      else if (part.type === 'second') s = Number(part.value)
    }
    const asUtcMs = Date.UTC(y, m - 1, d, h, min, s, 0)
    const targetAsUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0)
    const diffMs = asUtcMs - targetAsUtcMs
    if (diffMs === 0) break
    currentMs -= diffMs
  }
  return new Date(currentMs).toISOString()
}

export function getLocalDayRange(dateStr: string, timeZone: string): { startUtc: string; nextDayStartUtc: string } {
  const parts = dateStr.split('-').map(Number)
  const y = parts[0] ?? 1970
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  const nextDateStr = getFollowingDateStr(dateStr)
  const nextParts = nextDateStr.split('-').map(Number)
  const ny = nextParts[0] ?? 1970
  const nm = nextParts[1] ?? 1
  const nd = nextParts[2] ?? 1
  return {
    startUtc: getLocalMidnightUtc(y, m, d, timeZone),
    nextDayStartUtc: getLocalMidnightUtc(ny, nm, nd, timeZone),
  }
}

export class AccessStore {
  private sql: SqlStorage
  private storage: DurableObjectStorage

  constructor(sql: SqlStorage, storage: DurableObjectStorage) {
    this.sql = sql
    this.storage = storage
  }

  rateLimit(actorId: string, bucket: string, limit: number, windowSeconds = 60): { allowed: boolean; retryAfter: number } {
    let allowed = false
    let retryAfter = windowSeconds
    this.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM access_rate_limits WHERE updated_at < strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day')`)
      const row = this.sql.exec<{ window_started_at: string; request_count: number }>(
        'SELECT window_started_at, request_count FROM access_rate_limits WHERE actor_id = ? AND bucket = ?', actorId, bucket,
      ).toArray()[0]
      const now = Date.now()
      const began = row ? Date.parse(row.window_started_at) : 0
      if (!row || !Number.isFinite(began) || now - began >= windowSeconds * 1000) {
        this.sql.exec(`INSERT INTO access_rate_limits(actor_id,bucket,window_started_at,request_count,updated_at)
          VALUES(?,?,${NOW},1,${NOW}) ON CONFLICT(actor_id,bucket) DO UPDATE SET window_started_at=${NOW},request_count=1,updated_at=${NOW}`, actorId, bucket)
        allowed = true
      } else if (row.request_count < limit) {
        this.sql.exec(`UPDATE access_rate_limits SET request_count=request_count+1,updated_at=${NOW} WHERE actor_id=? AND bucket=?`, actorId, bucket)
        allowed = true
        retryAfter = Math.max(1, Math.ceil((windowSeconds * 1000 - (now - began)) / 1000))
      } else {
        retryAfter = Math.max(1, Math.ceil((windowSeconds * 1000 - (now - began)) / 1000))
      }
    })
    return { allowed, retryAfter }
  }

  options(kind: 'branches'|'disciplines'|'members'|'gateways'|'devices'|'points', opts: {
    limit: number; cursor?: { val: string; id: string } | null; search?: string | null; scope: AccessScope
  }): { items: Row[]; nextCursor: { val: string; id: string } | null } {
    const definitions = {
      branches: { table: 'branches', alias: 'b', columns: 'b.id,b.name', base: ['b.is_active=1'] },
      disciplines: { table: 'disciplines', alias: 'di', columns: 'di.id,di.name', base: ['di.is_active=1'] },
      members: { table: 'members', alias: 'm', columns: 'm.id,m.name,m.branch_id,m.discipline_id', base: ["m.status!='archived'"] },
      gateways: { table: 'access_gateways', alias: 'g', columns: 'g.id,g.name,g.branch_id,g.status', base: [] },
      devices: { table: 'access_devices', alias: 'd', columns: 'd.id,d.name,d.gateway_id,d.branch_id,d.status', base: [] },
      points: { table: 'access_points', alias: 'p', columns: 'p.id,p.name,p.device_id,p.branch_id,p.status', base: [] },
    } as const
    const definition = definitions[kind]
    const conditions = [...definition.base] as string[]
    const params: unknown[] = []
    if (opts.scope.branchId && kind !== 'disciplines') {
      conditions.push(`${definition.alias}.${kind === 'branches' ? 'id' : 'branch_id'}=?`)
      params.push(opts.scope.branchId)
    }
    if (opts.scope.disciplineId && (kind === 'disciplines' || kind === 'members')) {
      conditions.push(`${definition.alias}.${kind === 'disciplines' ? 'id' : 'discipline_id'}=?`)
      params.push(opts.scope.disciplineId)
    }
    const search = optionalString(opts.search, 80)
    if (search) {
      conditions.push(`${definition.alias}.name LIKE ? ESCAPE '\\'`)
      params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`)
    }
    if (opts.cursor) {
      conditions.push(`(${definition.alias}.name>? OR (${definition.alias}.name=? AND ${definition.alias}.id>?))`)
      params.push(opts.cursor.val, opts.cursor.val, opts.cursor.id)
    }
    const rows = this.sql.exec<Row>(
      `SELECT ${definition.columns} FROM ${definition.table} ${definition.alias}
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY ${definition.alias}.name,${definition.alias}.id LIMIT ?`,
      ...params, opts.limit + 1,
    ).toArray()
    const hasMore = rows.length > opts.limit
    const items = hasMore ? rows.slice(0, opts.limit) : rows
    const last = items.at(-1)
    return { items, nextCursor: hasMore && last ? { val: String(last.name), id: String(last.id) } : null }
  }

  list(kind: 'gateways'|'devices'|'points'|'credentials'|'rules'|'events', opts: {
    limit: number; cursor?: { val: string; id: string } | null; scope: AccessScope
    gatewayId?: string | null; deviceId?: string | null; memberId?: string | null
    decision?: string | null; direction?: string | null; pointId?: string | null; search?: string | null
  }): { items: Row[]; nextCursor: { val: string; id: string } | null } {
    const table = `access_${kind}`
    const aliases = { gateways: 'g', devices: 'd', points: 'p', credentials: 'c', rules: 'r', events: 'e' } as const
    const alias = aliases[kind]
    const time = kind === 'events' ? 'occurred_at' : 'created_at'
    const columns = kind === 'credentials'
      ? 'c.id,c.member_id,c.type,c.identifier_mask,c.provider,c.status,c.revoked_at,c.created_at,c.updated_at,m.name AS member_name,m.branch_id,m.discipline_id'
      : kind === 'events'
        ? 'e.id,e.occurred_at,e.member_id,e.credential_id,e.gateway_id,e.device_id,e.access_point_id,e.branch_id,e.discipline_id,e.direction,e.decision,e.reason_code,e.source,e.created_at,m.name AS member_name,c.type AS credential_type,c.identifier_mask,COALESCE(p.name, e.requested_access_point_id) AS access_point_name,g.name AS gateway_name'
        : `${alias}.*`
    const joins = kind === 'credentials' ? ' JOIN members m ON m.id=c.member_id'
      : kind === 'events' ? ' LEFT JOIN members m ON m.id=e.member_id LEFT JOIN access_credentials c ON c.id=e.credential_id LEFT JOIN access_points p ON p.id=e.access_point_id LEFT JOIN access_gateways g ON g.id=e.gateway_id' : ''
    const conditions: string[] = []
    const params: unknown[] = []
    const scoped = scopeSql(
      opts.scope,
      kind === 'credentials' ? 'm.branch_id' : `${alias}.branch_id`,
      kind === 'credentials' ? 'm.discipline_id' : kind === 'rules' || kind === 'events' ? `${alias}.discipline_id` : undefined,
    )
    conditions.push(...scoped.clauses); params.push(...scoped.params)
    if (kind === 'devices' && opts.gatewayId) { conditions.push('d.gateway_id = ?'); params.push(opts.gatewayId) }
    if (kind === 'points' && opts.deviceId) { conditions.push('p.device_id = ?'); params.push(opts.deviceId) }
    if ((kind === 'credentials' || kind === 'events') && opts.memberId) { conditions.push(`${alias}.member_id = ?`); params.push(opts.memberId) }
    if (kind === 'events' && opts.pointId) { conditions.push('e.access_point_id = ?'); params.push(opts.pointId) }
    if (kind === 'events' && opts.decision) { conditions.push('e.decision = ?'); params.push(opts.decision) }
    if (kind === 'events' && opts.direction) { conditions.push('e.direction = ?'); params.push(opts.direction) }
    const search = optionalString(opts.search, 80)
    if (search && ['gateways','devices','points','rules'].includes(kind)) {
      conditions.push(`${alias}.name LIKE ? ESCAPE '\\'`)
      params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`)
    } else if (search && kind === 'events') {
      conditions.push(`(m.name LIKE ? ESCAPE '\\' OR c.identifier_mask LIKE ? ESCAPE '\\')`)
      params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`, `%${search.replace(/[\\%_]/g, '\\$&')}%`)
    }
    const cursor = pageCursor(opts.cursor, `${alias}.${time}`)
    if (cursor.clause) { conditions.push(cursor.clause); params.push(...cursor.params) }
    const rows = this.sql.exec<Row>(
      `SELECT ${columns} FROM ${table} ${alias}${joins} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY ${alias}.${time} DESC, ${alias}.id DESC LIMIT ?`, ...params, opts.limit + 1,
    ).toArray()
    const hasMore = rows.length > opts.limit
    const items = hasMore ? rows.slice(0, opts.limit) : rows
    const last = items.at(-1)
    return { items, nextCursor: hasMore && last ? { val: String(last[time]), id: String(last.id) } : null }
  }

  createGateway(input: { id?: string; branchId: string; name: string; status: string; version?: string|null; scope?: AccessScope }, actor: AccessActor) {
    const id = input.id ?? crypto.randomUUID()
    if (!ACCESS_UUID.test(id)) throw new Error('INVALID_GATEWAY_ID')
    const version = optionalString(input.version, 64)
    this.mutate('access.gateway.created', 'access_gateway', id, input.name, actor, () => {
      const branch = this.sql.exec('SELECT 1 FROM branches WHERE id=? AND is_active=1', input.branchId).toArray()[0]
      if (!branch || (input.scope?.branchId && input.scope.branchId !== input.branchId)) throw new Error('NOT_FOUND')
      this.sql.exec('INSERT INTO access_gateways(id,branch_id,name,status,version) VALUES(?,?,?,?,?)', id,input.branchId,input.name,input.status,version)
    })
    return { id }
  }

  createDevice(input: { gatewayId:string; name:string; adapterType:string; deviceType:string; status:string; externalDeviceId?:string|null; metadata:Record<string,string>; scope?:AccessScope }, actor: AccessActor) {
    const id=crypto.randomUUID()
    const externalDeviceId=optionalString(input.externalDeviceId,120)
    this.mutate('access.device.created','access_device',id,input.name,actor,()=>{
      const g=this.sql.exec<{branch_id:string}>('SELECT branch_id FROM access_gateways WHERE id=?',input.gatewayId).toArray()[0]
      if(!g || (input.scope?.branchId && input.scope.branchId!==g.branch_id)) throw new Error('NOT_FOUND')
      this.sql.exec('INSERT INTO access_devices(id,gateway_id,branch_id,name,adapter_type,device_type,status,external_device_id,metadata_json) VALUES(?,?,?,?,?,?,?,?,?)',id,input.gatewayId,g.branch_id,input.name,input.adapterType,input.deviceType,input.status,externalDeviceId,JSON.stringify(input.metadata))
    }); return {id}
  }

  createPoint(input:{deviceId:string;name:string;direction:string;status:string;scope?:AccessScope},actor:AccessActor){
    const id=crypto.randomUUID(); this.mutate('access.point.created','access_point',id,input.name,actor,()=>{
      const d=this.sql.exec<{branch_id:string}>('SELECT branch_id FROM access_devices WHERE id=?',input.deviceId).toArray()[0]
      if(!d || (input.scope?.branchId && input.scope.branchId!==d.branch_id)) throw new Error('NOT_FOUND')
      this.sql.exec('INSERT INTO access_points(id,device_id,branch_id,name,direction,status) VALUES(?,?,?,?,?,?)',id,input.deviceId,d.branch_id,input.name,input.direction,input.status)
    }); return {id}
  }

  createCredential(input:{memberId:string;type:string;lookupHash:string;identifierMask:string;provider?:string|null;scope?:AccessScope},actor:AccessActor){
    const id=crypto.randomUUID(),provider=optionalString(input.provider,80,'INVALID_CREDENTIAL')
    if(['fingerprint','face','external'].includes(input.type) && !provider) throw new Error('INVALID_CREDENTIAL')
    this.mutate('access.credential.created','access_credential',id,null,actor,()=>{
      if(!this.sql.exec('SELECT 1 FROM members WHERE id=? AND status!=\'archived\' AND (? IS NULL OR branch_id=?) AND (? IS NULL OR discipline_id=?)',input.memberId,input.scope?.branchId??null,input.scope?.branchId??null,input.scope?.disciplineId??null,input.scope?.disciplineId??null).toArray()[0]) throw new Error('NOT_FOUND')
      this.sql.exec('INSERT INTO access_credentials(id,member_id,type,lookup_hash,identifier_mask,provider) VALUES(?,?,?,?,?,?)',id,input.memberId,input.type,input.lookupHash,input.identifierMask,provider)
    }); return {id,type:input.type,maskedIdentifier:input.identifierMask,status:'active'}
  }

  createRule(input:{branchId:string;accessPointId?:string|null;memberId?:string|null;disciplineId?:string|null;name:string;effect:string;priority:number;daysMask:number;startTime?:string|null;endTime?:string|null;validFrom?:string|null;validUntil?:string|null;status:string;scope?:AccessScope},actor:AccessActor){
    const id=crypto.randomUUID()
    const [startTime,endTime]=rulePair(input.startTime,input.endTime,'time')
    const [validFrom,validUntil]=rulePair(input.validFrom,input.validUntil,'instant')
    this.mutate('access.rule.created','access_rule',id,input.name,actor,()=>{
      if(!this.sql.exec('SELECT 1 FROM branches WHERE id=? AND is_active=1',input.branchId).toArray()[0] || (input.scope?.branchId&&input.scope.branchId!==input.branchId) || (input.scope?.disciplineId&&input.scope.disciplineId!==input.disciplineId)) throw new Error('NOT_FOUND')
      if(input.disciplineId && !this.sql.exec('SELECT 1 FROM disciplines WHERE id=? AND is_active=1',input.disciplineId).toArray()[0]) throw new Error('NOT_FOUND')
      if(input.accessPointId && !this.sql.exec('SELECT 1 FROM access_points WHERE id=? AND branch_id=?',input.accessPointId,input.branchId).toArray()[0]) throw new Error('NOT_FOUND')
      if(input.memberId && !this.sql.exec(`SELECT 1 FROM members
        WHERE id=? AND branch_id=? AND status!='archived'
          AND (? IS NULL OR discipline_id=?)
          AND (? IS NULL OR discipline_id=?)`,input.memberId,input.branchId,input.disciplineId??null,input.disciplineId??null,input.scope?.disciplineId??null,input.scope?.disciplineId??null).toArray()[0]) throw new Error('NOT_FOUND')
      const count=this.sql.exec<{n:number}>('SELECT COUNT(*) n FROM access_rules WHERE branch_id=?',input.branchId).one().n
      if(count>=500) throw new Error('RULE_LIMIT')
      this.sql.exec(`INSERT INTO access_rules(id,branch_id,access_point_id,member_id,discipline_id,name,effect,priority,days_mask,start_time,end_time,valid_from,valid_until,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,id,input.branchId,input.accessPointId??null,input.memberId??null,input.disciplineId??null,input.name,input.effect,input.priority,input.daysMask,startTime,endTime,validFrom,validUntil,input.status)
    }); return {id}
  }

  patch(kind:'gateways'|'devices'|'points'|'credentials'|'rules',id:string,input:Record<string,unknown>,scope:AccessScope,actor:AccessActor):void{
    const clean={...input}
    if(kind==='gateways' && 'version' in clean) clean.version=optionalString(clean.version,64)
    if(kind==='devices' && 'externalDeviceId' in clean) clean.externalDeviceId=optionalString(clean.externalDeviceId,120)
    if(kind==='rules' && ('startTime' in clean || 'endTime' in clean)) {
      if(!('startTime' in clean) || !('endTime' in clean)) throw new Error('INVALID_RULE')
      ;[clean.startTime,clean.endTime]=rulePair(clean.startTime,clean.endTime,'time')
    }
    if(kind==='rules' && ('validFrom' in clean || 'validUntil' in clean)) {
      if(!('validFrom' in clean) || !('validUntil' in clean)) throw new Error('INVALID_RULE')
      ;[clean.validFrom,clean.validUntil]=rulePair(clean.validFrom,clean.validUntil,'instant')
    }
    const maps:Record<string,Record<string,string>>={
      gateways:{name:'name',status:'status',version:'version'}, devices:{name:'name',status:'status',adapterType:'adapter_type',deviceType:'device_type',externalDeviceId:'external_device_id',metadata:'metadata_json'},
      points:{name:'name',status:'status',direction:'direction'}, credentials:{status:'status'},
      rules:{name:'name',effect:'effect',priority:'priority',daysMask:'days_mask',startTime:'start_time',endTime:'end_time',validFrom:'valid_from',validUntil:'valid_until',status:'status'},
    }
    const table=`access_${kind}`; const sets:string[]=[]; const params:unknown[]=[]
    for(const [key,column] of Object.entries(maps[kind]!)) if(key in clean){ sets.push(`${column}=?`); params.push(key==='metadata'?JSON.stringify(clean[key]):clean[key]) }
    if(kind==='credentials' && clean.status==='revoked'){sets.push(`revoked_at=${NOW}`)}
    if(!sets.length) return
    this.mutate(`access.${kind}.updated`,`access_${kind}`,id,null,actor,()=>{
      const row=this.scopedEntity(kind,id,scope); if(!row) throw new Error('NOT_FOUND')
      if(kind==='credentials' && row.status==='revoked' && clean.status!=='revoked') throw new Error('TERMINAL_CREDENTIAL')
      this.sql.exec(`UPDATE ${table} SET ${sets.join(',')},updated_at=${NOW} WHERE id=?`,...params,id)
    })
  }

  disable(kind:'gateways'|'devices'|'points'|'credentials'|'rules',id:string,scope:AccessScope,actor:AccessActor):void{
    const status=kind==='credentials'?'revoked':'disabled'
    this.patch(kind,id,{status},scope,actor)
  }

  evaluate(input:{lookupHash:string;accessPointId:string;externalEventId?:string|null;requestHash?:string|null;scope:AccessScope;occurredAt:string;localDate:string;localTime:string;localWeekday:number}):Record<string, unknown>{
    let result:Record<string, unknown>={}
    const externalEventId=optionalString(input.externalEventId,128)
    const requestHash=optionalString(input.requestHash,64)
    if(externalEventId && (!requestHash || !/^[0-9a-f]{64}$/.test(requestHash))) throw new Error('INVALID_FIELD')
    this.storage.transactionSync(()=>{
      const point=this.sql.exec<Row>(`SELECT p.id,p.branch_id,p.direction,p.status AS point_status,d.id AS device_id,d.status AS device_status,g.id AS gateway_id,g.status AS gateway_status,b.is_active AS branch_active FROM access_points p JOIN access_devices d ON d.id=p.device_id AND d.branch_id=p.branch_id JOIN access_gateways g ON g.id=d.gateway_id AND g.branch_id=d.branch_id JOIN branches b ON b.id=p.branch_id WHERE p.id=?`,input.accessPointId).toArray()[0]
      let reason:AccessReason='SYSTEM_ERROR'
      const credential=this.sql.exec<Row>(`SELECT c.id,c.status,c.member_id,m.status AS member_status,m.sub_expiry,m.branch_id,m.discipline_id,di.is_active AS discipline_active FROM access_credentials c JOIN members m ON m.id=c.member_id LEFT JOIN disciplines di ON di.id=m.discipline_id WHERE c.lookup_hash=?`,input.lookupHash).toArray()[0]
      const replayScopeAuthorized=Boolean(point && (!input.scope.branchId || point.branch_id===input.scope.branchId) && Number(point.branch_active)===1 && (!credential || credential.branch_id===point.branch_id) && (!input.scope.disciplineId || (credential && credential.discipline_id===input.scope.disciplineId && Number(credential.discipline_active)===1)))
      let persistIdempotency=replayScopeAuthorized
      if(replayScopeAuthorized && point && externalEventId){
        const prior=this.sql.exec<Row>('SELECT id,decision,reason_code,member_id,access_point_id,branch_id,discipline_id,occurred_at,request_hash FROM access_events WHERE gateway_id=? AND external_event_id=?',point.gateway_id,externalEventId).toArray()[0]
        const priorInScope=prior && prior.branch_id===point.branch_id && (!input.scope.disciplineId || prior.discipline_id===input.scope.disciplineId)
        if(priorInScope){if(prior.request_hash!==requestHash) throw new Error('IDEMPOTENCY_CONFLICT'); result={eventId:prior.id,decision:prior.decision,reason:prior.reason_code,...(prior.decision==='allow'?{memberId:prior.member_id}:{}),accessPointId:prior.access_point_id,occurredAt:prior.occurred_at,replayed:true};return}
        if(prior) persistIdempotency=false
      }
      if(!point) reason='ACCESS_POINT_UNKNOWN'
      else if(input.scope.branchId && point.branch_id!==input.scope.branchId) reason='WRONG_BRANCH'
      else if(Number(point.branch_active)!==1) reason='WRONG_BRANCH'
      else if(point.gateway_status!=='online') reason='GATEWAY_DISABLED'
      else if(point.device_status!=='online') reason='DEVICE_DISABLED'
      else if(point.point_status!=='active') reason='ACCESS_POINT_DISABLED'
      else {
        if(!credential) reason='CREDENTIAL_UNKNOWN'
        else if(credential.status==='revoked') reason='CREDENTIAL_REVOKED'
        else if(credential.status==='lost') reason='CREDENTIAL_LOST'
        else if(credential.status==='disabled') reason='CREDENTIAL_DISABLED'
        else if(credential.member_status!=='active') reason='MEMBER_INACTIVE'
        else if(input.scope.disciplineId && credential.discipline_id!==input.scope.disciplineId) reason='WRONG_DISCIPLINE'
        else if(credential.discipline_id && Number(credential.discipline_active)!==1) reason='WRONG_DISCIPLINE'
        else if(credential.branch_id!==point.branch_id) reason='WRONG_BRANCH'
        else if(credential.sub_expiry && String(credential.sub_expiry)<input.localDate) reason='SUBSCRIPTION_EXPIRED'
        else {
          const rules=this.sql.exec<Row>(`SELECT effect,start_time,end_time,valid_from,valid_until,days_mask FROM access_rules WHERE branch_id=? AND status='active' AND (access_point_id IS NULL OR access_point_id=?) AND (member_id IS NULL OR member_id=?) AND (discipline_id IS NULL OR discipline_id=?) ORDER BY priority DESC,id`,point.branch_id,point.id,credential.member_id,credential.discipline_id).toArray()
          let allow=false,deny=false,outside=false
          for(const rule of rules){const appliesDate=(!rule.valid_from||String(rule.valid_from)<=input.occurredAt)&&(!rule.valid_until||String(rule.valid_until)>input.occurredAt);const day=(Number(rule.days_mask)&(1<<input.localWeekday))!==0;const time=!rule.start_time||(String(rule.start_time)<=input.localTime&&input.localTime<String(rule.end_time));if(appliesDate&&day&&time){if(rule.effect==='deny')deny=true;else allow=true}else if(rule.effect==='allow')outside=true}
          reason=deny?'ACCESS_RULE_DENIED':allow?'ACCESS_GRANTED':outside?'OUTSIDE_ALLOWED_HOURS':'ACCESS_RULE_DENIED'
        }
      }
      const decision=reason==='ACCESS_GRANTED'?'allow':'deny'; const eventId=crypto.randomUUID()
      this.sql.exec(`INSERT INTO access_events(id,occurred_at,member_id,credential_id,gateway_id,device_id,access_point_id,branch_id,discipline_id,requested_access_point_id,direction,decision,reason_code,source,external_event_id,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'cloud',?,?)`,eventId,input.occurredAt,credential?.member_id??null,credential?.id??null,point?.gateway_id??null,point?.device_id??null,point?.id??null,point?.branch_id??null,credential?.discipline_id??null,input.accessPointId,point?.direction??'bidirectional',decision,reason,persistIdempotency?externalEventId:null,persistIdempotency&&externalEventId?requestHash:null)
      result={eventId,decision,reason,...(decision==='allow'?{memberId:credential?.member_id}:{}),accessPointId:input.accessPointId,occurredAt:input.occurredAt,replayed:false}
    }); return result
  }

  private scopedEntity(kind:string,id:string,scope:AccessScope):Row|undefined{
    if(kind==='credentials') return this.sql.exec<Row>('SELECT c.* FROM access_credentials c JOIN members m ON m.id=c.member_id WHERE c.id=? AND (? IS NULL OR m.branch_id=?) AND (? IS NULL OR m.discipline_id=?)',id,scope.branchId??null,scope.branchId??null,scope.disciplineId??null,scope.disciplineId??null).toArray()[0]
    const discipline=kind==='rules'?'discipline_id':null
    return this.sql.exec<Row>(`SELECT * FROM access_${kind} WHERE id=? AND (? IS NULL OR branch_id=?)${discipline?' AND (? IS NULL OR discipline_id=?)':''}`,id,scope.branchId??null,scope.branchId??null,...(discipline?[scope.disciplineId??null,scope.disciplineId??null]:[])).toArray()[0]
  }

  // Gateway credential management
  createGatewayCredential(input: { gatewayId: string; publicKey: string; }, actor: AccessActor) {
    this.mutate('access.gateway.credential.created', 'access_gateway', input.gatewayId, null, actor, () => {
      const gateway = this.sql.exec('SELECT 1 FROM access_gateways WHERE id=?', input.gatewayId).toArray()[0]
      if (!gateway) throw new Error('NOT_FOUND')
      this.sql.exec('UPDATE access_gateways SET machine_public_key=?, status=\'provisioned\', provisioned_at=${NOW} WHERE id=?', input.publicKey, input.gatewayId)
    })
    return { ok: true }
  }

  setGatewayEnrollmentToken(input: { gatewayId: string; tokenHash: string; expiresAt: string; }, actor: AccessActor) {
    this.mutate('access.gateway.enrollment.set', 'access_gateway', input.gatewayId, null, actor, () => {
      const gateway = this.sql.exec<{ status: string }>('SELECT status FROM access_gateways WHERE id=?', input.gatewayId).toArray()[0]
      if (!gateway) throw new Error('NOT_FOUND')
      if (gateway.status !== 'pending') throw new Error('GATEWAY_NOT_PENDING')
      this.sql.exec('UPDATE access_gateways SET enrollment_token_hash=?, enrollment_expires_at=? WHERE id=?', input.tokenHash, input.expiresAt, input.gatewayId)
    })
    return { ok: true }
  }

  consumeGatewayEnrollmentToken(input: { gatewayId: string; tokenHash: string; publicKey: string }, actor: AccessActor) {
    return this.storage.transactionSync(() => {
      const gateway = this.sql.exec<{ enrollment_token_hash: string; enrollment_expires_at: string; status: string }>(
        'SELECT enrollment_token_hash, enrollment_expires_at, status FROM access_gateways WHERE id=?', input.gatewayId
      ).toArray()[0]

      if (!gateway) throw new Error('NOT_FOUND')
      if (gateway.status !== 'pending') throw new Error('GATEWAY_NOT_PENDING')
      if (!gateway.enrollment_token_hash) throw new Error('NO_ENROLLMENT_TOKEN')
      if (!constantTimeStringEqual(gateway.enrollment_token_hash, input.tokenHash)) throw new Error('INVALID_ENROLLMENT_TOKEN')
      const expiresAt = Date.parse(gateway.enrollment_expires_at)
      if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) throw new Error('ENROLLMENT_TOKEN_EXPIRED')

      // The token consumption and public-key installation are one tenant-local
      // transaction. The machine private key is returned by the caller and is
      // never persisted here.
      this.sql.exec(`UPDATE access_gateways
        SET enrollment_token_hash=NULL,enrollment_expires_at=NULL,machine_public_key=?,
            status='provisioned',provisioned_at=${NOW},updated_at=${NOW}
        WHERE id=?`, input.publicKey, input.gatewayId)
      this.sql.exec('INSERT INTO audit_logs(action,entity,entity_id,entity_name,detail,actor_id,actor_name) VALUES(?,?,?,?,?,?,?)',
        'access.gateway.enrolled', 'access_gateway', input.gatewayId, null, null, actor.id, actor.name)
      return { consumed: true }
    })
  }

  validateGatewayEnrollmentToken(input: { gatewayId: string; tokenHash: string }): void {
    const gateway = this.sql.exec<{ enrollment_token_hash: string | null; enrollment_expires_at: string | null; status: string }>(
      'SELECT enrollment_token_hash,enrollment_expires_at,status FROM access_gateways WHERE id=?', input.gatewayId,
    ).toArray()[0]
    const expiresAt = gateway?.enrollment_expires_at ? Date.parse(gateway.enrollment_expires_at) : Number.NaN
    if (!gateway || gateway.status !== 'pending' || !gateway.enrollment_token_hash || !Number.isFinite(expiresAt) ||
        !constantTimeStringEqual(gateway.enrollment_token_hash, input.tokenHash) || expiresAt < Date.now()) {
      throw new Error('GATEWAY_ENROLLMENT_DENIED')
    }
  }

  // Gateway nonce management for anti-replay
  createGatewayNonce(input: { gatewayId: string; nonce: string; expiresAt: string; }, actor: AccessActor) {
    this.mutate('access.gateway.nonce.created', 'gateway_nonces', input.nonce, null, actor, () => {
      // Clean up expired nonces first
      this.sql.exec('DELETE FROM gateway_nonces WHERE expires_at < ${NOW}')
      // Insert the new nonce
      this.sql.exec('INSERT INTO gateway_nonces(gateway_id, nonce, expires_at) VALUES(?,?,?)',
        input.gatewayId, input.nonce, input.expiresAt)
    })
    return { ok: true }
  }

  registerGatewayNonce(input: { gatewayId: string; nonce: string; expiresAt: string }) {
    return this.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM gateway_nonces WHERE expires_at < ${NOW}`)
      const inserted = this.sql.exec<{ nonce: string }>(
        `INSERT INTO gateway_nonces(gateway_id,nonce,expires_at) VALUES(?,?,?)
         ON CONFLICT(gateway_id,nonce) DO NOTHING RETURNING nonce`,
        input.gatewayId, input.nonce, input.expiresAt,
      ).toArray()[0]
      return { consumed: Boolean(inserted) }
    })
  }

  summary(scope: AccessScope, dateIso?: string, timezone?: string) {
    const tz = safeTimezone(timezone)
    let todayStr: string
    if (dateIso !== undefined && dateIso !== null && dateIso !== '') {
      if (!isValidDateStr(dateIso)) {
        throw new Error('INVALID_DATE')
      }
      todayStr = dateIso
    } else {
      todayStr = getLocalDateStr(new Date(), tz)
    }

    const yesterdayStr = getPreviousDateStr(todayStr)
    const todayRange = getLocalDayRange(todayStr, tz)
    const yesterdayRange = getLocalDayRange(yesterdayStr, tz)

    const buildWhere = (startUtc: string, nextDayStartUtc: string) => {
      const conds = ['e.occurred_at >= ?', 'e.occurred_at < ?']
      const p: unknown[] = [startUtc, nextDayStartUtc]
      const s = scopeSql(scope, 'e.branch_id', 'e.discipline_id')
      conds.push(...s.clauses)
      p.push(...s.params)
      return { where: `WHERE ${conds.join(' AND ')}`, params: p }
    }

    const todayFilter = buildWhere(todayRange.startUtc, todayRange.nextDayStartUtc)
    const yesterdayFilter = buildWhere(yesterdayRange.startUtc, yesterdayRange.nextDayStartUtc)

    const todayStats = this.sql.exec<{
      total: number
      allowed: number
      denied: number
      members: number
      sub_expired: number
      mem_inactive: number
      cred_unknown: number
      cred_lost_rev: number
      infra_error: number
    }>(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN e.decision = 'allow' THEN 1 ELSE 0 END), 0) AS allowed,
        COALESCE(SUM(CASE WHEN e.decision = 'deny' THEN 1 ELSE 0 END), 0) AS denied,
        COUNT(DISTINCT CASE WHEN e.decision = 'allow' AND e.member_id IS NOT NULL THEN e.member_id ELSE NULL END) AS members,
        COALESCE(SUM(CASE WHEN e.reason_code = 'SUBSCRIPTION_EXPIRED' THEN 1 ELSE 0 END), 0) AS sub_expired,
        COALESCE(SUM(CASE WHEN e.reason_code = 'MEMBER_INACTIVE' THEN 1 ELSE 0 END), 0) AS mem_inactive,
        COALESCE(SUM(CASE WHEN e.reason_code = 'CREDENTIAL_UNKNOWN' THEN 1 ELSE 0 END), 0) AS cred_unknown,
        COALESCE(SUM(CASE WHEN e.reason_code IN ('CREDENTIAL_LOST', 'CREDENTIAL_REVOKED') THEN 1 ELSE 0 END), 0) AS cred_lost_rev,
        COALESCE(SUM(CASE WHEN e.reason_code IN ('GATEWAY_DISABLED', 'DEVICE_DISABLED', 'ACCESS_POINT_DISABLED', 'ACCESS_POINT_UNKNOWN') THEN 1 ELSE 0 END), 0) AS infra_error
       FROM access_events e
       ${todayFilter.where}`,
      ...todayFilter.params,
    ).toArray()[0] ?? { total: 0, allowed: 0, denied: 0, members: 0, sub_expired: 0, mem_inactive: 0, cred_unknown: 0, cred_lost_rev: 0, infra_error: 0 }

    const yestStats = this.sql.exec<{
      total: number
      allowed: number
      denied: number
      members: number
    }>(
      `SELECT
        COUNT(*) AS total,
        COALESCE(SUM(CASE WHEN e.decision = 'allow' THEN 1 ELSE 0 END), 0) AS allowed,
        COALESCE(SUM(CASE WHEN e.decision = 'deny' THEN 1 ELSE 0 END), 0) AS denied,
        COUNT(DISTINCT CASE WHEN e.decision = 'allow' AND e.member_id IS NOT NULL THEN e.member_id ELSE NULL END) AS members
       FROM access_events e
       ${yesterdayFilter.where}`,
      ...yesterdayFilter.params,
    ).toArray()[0] ?? { total: 0, allowed: 0, denied: 0, members: 0 }

    const pctDelta = (curr: number, prev: number) => {
      if (prev === 0) return curr > 0 ? 100 : 0
      return Math.round(((curr - prev) / prev) * 100)
    }

    const utcHourlyRows = this.sql.exec<{ utc_hour: string; count: number }>(
      `SELECT
        substr(e.occurred_at, 1, 13) || ':00:00.000Z' AS utc_hour,
        COUNT(*) AS count
       FROM access_events e
       ${todayFilter.where}
       GROUP BY substr(e.occurred_at, 1, 13)
       ORDER BY utc_hour ASC`,
      ...todayFilter.params,
    ).toArray()

    const hourlyMap = new Map<string, number>()
    for (let h = 0; h < 24; h++) {
      hourlyMap.set(String(h).padStart(2, '0'), 0)
    }

    const hourDtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      hourCycle: 'h23',
    })

    for (const r of utcHourlyRows) {
      try {
        const parts = hourDtf.formatToParts(new Date(r.utc_hour))
        const localHour = (parts.find(p => p.type === 'hour')?.value ?? '').padStart(2, '0')
        if (hourlyMap.has(localHour)) {
          hourlyMap.set(localHour, (hourlyMap.get(localHour) ?? 0) + r.count)
        }
      } catch {
        // Safe fallback
      }
    }

    const hourlyRows = Array.from(hourlyMap.entries()).map(([hour, count]) => ({ hour, count }))

    const topPoints = this.sql.exec<{ name: string; count: number }>(
      `SELECT
        COALESCE(p.name, e.requested_access_point_id) AS name,
        COUNT(*) AS count
       FROM access_events e
       LEFT JOIN access_points p ON p.id = e.access_point_id
       ${todayFilter.where}
       GROUP BY e.access_point_id
       ORDER BY count DESC
       LIMIT 5`,
      ...todayFilter.params,
    ).toArray()

    const gwConds: string[] = []
    const gwP: unknown[] = []
    if (scope.branchId) { gwConds.push('branch_id = ?'); gwP.push(scope.branchId) }
    const gwWhere = gwConds.length ? `WHERE ${gwConds.join(' AND ')}` : ''
    const gwList = this.sql.exec<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM access_gateways ${gwWhere} GROUP BY status`,
      ...gwP,
    ).toArray()
    const gwTotal = gwList.reduce((acc, r) => acc + r.count, 0)
    const gwOnline = gwList.find(r => r.status === 'online')?.count ?? 0
    const gwOffline = gwList.find(r => r.status === 'offline')?.count ?? 0

    const devConds: string[] = []
    const devP: unknown[] = []
    if (scope.branchId) { devConds.push('branch_id = ?'); devP.push(scope.branchId) }
    const devWhere = devConds.length ? `WHERE ${devConds.join(' AND ')}` : ''
    const devList = this.sql.exec<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM access_devices ${devWhere} GROUP BY status`,
      ...devP,
    ).toArray()
    const devTotal = devList.reduce((acc, r) => acc + r.count, 0)
    const devActive = devList.filter(r => r.status === 'online' || r.status === 'pending').reduce((acc, r) => acc + r.count, 0)

    return {
      today: {
        totalAttempts: todayStats.total,
        allowedCount: todayStats.allowed,
        deniedCount: todayStats.denied,
        uniqueMembers: todayStats.members,
        deltaAttemptsPct: pctDelta(todayStats.total, yestStats.total),
        deltaAllowedPct: pctDelta(todayStats.allowed, yestStats.allowed),
        deltaDeniedPct: pctDelta(todayStats.denied, yestStats.denied),
        deltaMembersPct: pctDelta(todayStats.members, yestStats.members),
      },
      securityBreakdown: {
        deniedTotal: todayStats.denied,
        subscriptionExpired: todayStats.sub_expired,
        memberInactive: todayStats.mem_inactive,
        credentialUnknown: todayStats.cred_unknown,
        credentialLostOrRevoked: todayStats.cred_lost_rev,
        infrastructureDenied: todayStats.infra_error,
      },
      hourly: hourlyRows,
      topPoints,
      infrastructure: {
        gatewaysTotal: gwTotal,
        gatewaysOnline: gwOnline,
        gatewaysOffline: gwOffline,
        devicesTotal: devTotal,
        devicesActive: devActive,
      },
    }
  }

  memberSummary(memberId: string, scope: AccessScope, nowIso?: string): {
    memberId: string
    visitsLast30Days: number
    averageVisitsPerWeek: number
    lastEntryAt: string | null
    windowStart: string
    windowEnd: string
  } {
    const memConds = ["id = ?", "status != 'archived'"]
    const memParams: unknown[] = [memberId]
    if (scope.branchId) {
      memConds.push('branch_id = ?')
      memParams.push(scope.branchId)
    }
    if (scope.disciplineId) {
      memConds.push('discipline_id = ?')
      memParams.push(scope.disciplineId)
    }
    const member = this.sql.exec<Row>(
      `SELECT id, name, branch_id, discipline_id FROM members WHERE ${memConds.join(' AND ')}`,
      ...memParams,
    ).toArray()[0]
    if (!member) throw new Error('NOT_FOUND')

    const nowDate = nowIso ? new Date(nowIso) : new Date()
    const windowEnd = nowDate.toISOString()
    const windowStart = new Date(nowDate.getTime() - 30 * 86400000).toISOString()

    // Truthful visit semantics: count inward passages (decision = 'allow' AND direction = 'entry')
    // Upper bound e.occurred_at <= windowEnd guarantees future-dated events are strictly excluded.
    const stats = this.sql.exec<{
      visits: number
      last_entry: string | null
    }>(
      `SELECT
        COUNT(*) AS visits,
        MAX(e.occurred_at) AS last_entry
       FROM access_events e
       WHERE e.member_id = ?
         AND e.occurred_at >= ?
         AND e.occurred_at <= ?
         AND e.decision = 'allow'
         AND e.direction = 'entry'`,
      memberId, windowStart, windowEnd,
    ).toArray()[0] ?? { visits: 0, last_entry: null }

    const visitsLast30Days = stats.visits
    const averageVisitsPerWeek = Math.round((visitsLast30Days / (30 / 7)) * 10) / 10

    return {
      memberId,
      visitsLast30Days,
      averageVisitsPerWeek,
      lastEntryAt: stats.last_entry,
      windowStart,
      windowEnd,
    }
  }

  private mutate(action:string,entity:string,id:string,name:string|null,actor:AccessActor,fn:()=>void):void{
    this.storage.transactionSync(()=>{fn();this.sql.exec('INSERT INTO audit_logs(action,entity,entity_id,entity_name,detail,actor_id,actor_name) VALUES(?,?,?,?,?,?,?)',action,entity,id,name,null,actor.id,actor.name)})
  }

  public audit(action:string,entity:string,id:string,name:string|null,actor:AccessActor,fn:()=>void):void{
    this.mutate(action,entity,id,name,actor,fn);
  }
}
