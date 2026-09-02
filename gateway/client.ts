import type {
  AccessAuthorizationSnapshot,
  GatewayEnrollmentResponse,
  GatewayEventBatchPayload,
  GatewayEventUploadResponse,
  GatewayHeartbeatPayload,
  GatewayHeartbeatResponse,
} from './types'
import type { GatewayM2MSigner } from './signer'

export class GatewayHttpClient {
  private readonly signer?: GatewayM2MSigner
  public readonly fetchFn: typeof fetch

  constructor(
    signer?: GatewayM2MSigner,
    fetchFn: typeof fetch = globalThis.fetch
  ) {
    this.signer = signer
    this.fetchFn = fetchFn
  }

  async enroll(
    serverBaseUrl: string,
    gatewayId: string,
    token: string
  ): Promise<GatewayEnrollmentResponse> {
    const url = `${serverBaseUrl.replace(/\/+$/, '')}/api/access/gateways/enroll`
    const bodyStr = JSON.stringify({ gatewayId, token })

    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: bodyStr,
    })

    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      throw new Error(`ENROLLMENT_FAILED: ${res.status} ${errorText}`)
    }

    const data = (await res.json()) as Partial<GatewayEnrollmentResponse>
    if (
      !data ||
      typeof data !== 'object' ||
      data.gatewayId !== gatewayId ||
      !data.machinePrivateKey ||
      !data.snapshotVerificationKey
    ) {
      throw new Error('ENROLLMENT_INVALID_RESPONSE')
    }

    return {
      gatewayId: data.gatewayId,
      machinePrivateKey: data.machinePrivateKey,
      snapshotVerificationKey: data.snapshotVerificationKey,
    }
  }

  async heartbeat(
    serverBaseUrl: string,
    payload: GatewayHeartbeatPayload,
    clockOffsetMs: number = 0
  ): Promise<{ status: number; data?: GatewayHeartbeatResponse; error?: string }> {
    if (!this.signer) throw new Error('SIGNER_REQUIRED')
    const path = '/api/access/gateway/heartbeat'
    const url = `${serverBaseUrl.replace(/\/+$/, '')}${path}`
    const bodyBytes = new TextEncoder().encode(JSON.stringify(payload))

    const { headers } = await this.signer.signRequest('POST', path, bodyBytes, clockOffsetMs)

    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: headers as unknown as Record<string, string>,
      body: bodyBytes,
    })

    if (res.status === 200) {
      const data = (await res.json()) as GatewayHeartbeatResponse
      return { status: 200, data }
    }

    const error = await res.text().catch(() => '')
    return { status: res.status, error }
  }

  async fetchSnapshot(
    serverBaseUrl: string,
    ifRevision: number | null = null,
    clockOffsetMs: number = 0
  ): Promise<
    | { status: 304 }
    | { status: 200; snapshot: AccessAuthorizationSnapshot; signature: string }
    | { status: number; error: string }
  > {
    if (!this.signer) throw new Error('SIGNER_REQUIRED')
    const path = '/api/access/gateway/snapshot'
    const queryString = ifRevision !== null && ifRevision >= 0 ? `?if_revision=${ifRevision}` : ''
    const url = `${serverBaseUrl.replace(/\/+$/, '')}${path}${queryString}`

    const { headers } = await this.signer.signRequest('GET', path, null, clockOffsetMs)

    const res = await this.fetchFn(url, {
      method: 'GET',
      headers: headers as unknown as Record<string, string>,
    })

    if (res.status === 304) {
      return { status: 304 }
    }

    if (res.status === 200) {
      const body = (await res.json()) as {
        snapshot: AccessAuthorizationSnapshot
        signature: string
      }
      if (!body.snapshot || !body.signature) {
        return { status: 500, error: 'INVALID_SNAPSHOT_RESPONSE' }
      }
      return { status: 200, snapshot: body.snapshot, signature: body.signature }
    }

    const error = await res.text().catch(() => '')
    return { status: res.status, error }
  }

  async uploadEvents(
    serverBaseUrl: string,
    payload: GatewayEventBatchPayload,
    clockOffsetMs: number = 0
  ): Promise<{ status: number; data?: GatewayEventUploadResponse; error?: string }> {
    if (!this.signer) throw new Error('SIGNER_REQUIRED')
    const path = '/api/access/gateway/events'
    const url = `${serverBaseUrl.replace(/\/+$/, '')}${path}`
    const bodyBytes = new TextEncoder().encode(JSON.stringify(payload))

    const { headers } = await this.signer.signRequest('POST', path, bodyBytes, clockOffsetMs)

    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: headers as unknown as Record<string, string>,
      body: bodyBytes,
    })

    if (res.status === 200) {
      const data = (await res.json()) as GatewayEventUploadResponse
      return { status: 200, data }
    }

    const error = await res.text().catch(() => '')
    return { status: res.status, error }
  }
}

