import type { DeviceDirection } from './adapter-types'
import net from 'node:net'

export interface ReaderMapping {
  accessPointId: string
  direction: DeviceDirection
  doorNo: number
}

export interface HikvisionAdapterConfig {
  deviceId: string
  accessPointId: string
  direction?: DeviceDirection
  name?: string

  controllerHost: string
  controllerPort?: number
  useHttps?: boolean
  username: string
  password: string | (() => Promise<string> | string)

  defaultDoorNo?: number
  defaultReaderNo?: number
  readerMappings?: Record<number, ReaderMapping>

  requestTimeoutMs?: number
  reconnectInitialDelayMs?: number
  reconnectMaxDelayMs?: number
  maxBufferSize?: number
  dedupWindowMs?: number
  customFetch?: typeof fetch
  allowLoopbackForTesting?: boolean
}

export class HikvisionConfigValidator {
  static validate(config: HikvisionAdapterConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!config.deviceId || typeof config.deviceId !== 'string' || config.deviceId.trim().length === 0) {
      errors.push('INVALID_DEVICE_ID')
    }

    if (!config.accessPointId || typeof config.accessPointId !== 'string' || config.accessPointId.trim().length === 0) {
      errors.push('INVALID_ACCESS_POINT_ID')
    }

    if (!config.controllerHost || typeof config.controllerHost !== 'string') {
      errors.push('INVALID_CONTROLLER_HOST')
    } else {
      const host = config.controllerHost.trim()
      const allowLoopback = config.allowLoopbackForTesting === true

      if (!this.isValidControllerHost(host, allowLoopback)) {
        errors.push('MALFORMED_CONTROLLER_HOST')
      }
    }

    if (config.controllerPort !== undefined) {
      if (!Number.isInteger(config.controllerPort) || config.controllerPort < 1 || config.controllerPort > 65535) {
        errors.push('INVALID_CONTROLLER_PORT')
      }
    }

    if (!config.username || typeof config.username !== 'string' || config.username.trim().length === 0 || config.username.length > 64) {
      errors.push('INVALID_USERNAME')
    }

    if (!config.password) {
      errors.push('MISSING_PASSWORD')
    }

    if (config.defaultDoorNo !== undefined) {
      if (!Number.isInteger(config.defaultDoorNo) || config.defaultDoorNo < 1 || config.defaultDoorNo > 64) {
        errors.push('INVALID_DOOR_NO')
      }
    }

    if (config.defaultReaderNo !== undefined) {
      if (!Number.isInteger(config.defaultReaderNo) || config.defaultReaderNo < 1 || config.defaultReaderNo > 64) {
        errors.push('INVALID_READER_NO')
      }
    }

    if (config.readerMappings) {
      for (const [key, mapping] of Object.entries(config.readerMappings)) {
        const readerNum = Number(key)
        if (!Number.isInteger(readerNum) || readerNum < 1 || readerNum > 64) {
          errors.push(`INVALID_READER_MAPPING_KEY_${key}`)
        }
        if (!mapping.accessPointId || typeof mapping.accessPointId !== 'string') {
          errors.push(`INVALID_MAPPING_ACCESS_POINT_${key}`)
        }
        if (mapping.direction !== 'entry' && mapping.direction !== 'exit') {
          errors.push(`INVALID_MAPPING_DIRECTION_${key}`)
        }
        if (!Number.isInteger(mapping.doorNo) || mapping.doorNo < 1 || mapping.doorNo > 64) {
          errors.push(`INVALID_MAPPING_DOOR_${key}`)
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Strictly validates that the controllerHost represents a safe, expected private controller IP.
   * Defends against SSRF, cloud metadata exfiltration, loopback abuse, and DNS rebinding.
   */
  static isValidControllerHost(host: string, allowLoopback: boolean = false): boolean {
    if (!host || typeof host !== 'string') {
      return false
    }

    const trimmed = host.trim()

    // 1. Reject URI confusion, paths, query, fragment, credentials, whitespace, control chars
    if (
      trimmed.includes('://') ||
      trimmed.includes('/') ||
      trimmed.includes('\\') ||
      trimmed.includes('@') ||
      trimmed.includes('?') ||
      trimmed.includes('#') ||
      /\s/.test(trimmed) ||
      /[\x00-\x1F\x7F]/.test(trimmed) ||
      trimmed.length > 255
    ) {
      return false
    }

    // 2. Reject metadata hostnames and localhost explicitly
    const lower = trimmed.toLowerCase()
    if (lower === 'localhost' || lower === 'metadata.google.internal') {
      return allowLoopback && lower === 'localhost'
    }

    // 3. Reject compact / ambiguous integer / octal IP notation (e.g. 127.1, 2130706433, 0177.0.0.1)
    if (/^\d+(\.\d+)*$/.test(trimmed)) {
      const parts = trimmed.split('.')
      if (parts.length !== 4) {
        return false
      }
      for (const p of parts) {
        if (!/^\d+$/.test(p) || (p.length > 1 && p.startsWith('0')) || Number(p) > 255) {
          return false
        }
      }
    }

    // 4. Handle bracketed IPv6 syntax
    let unbracketed = trimmed
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      unbracketed = trimmed.slice(1, -1)
    } else if (trimmed.startsWith('[') || trimmed.endsWith(']')) {
      return false
    }

    const ipVersion = net.isIP(unbracketed)

    if (ipVersion === 4) {
      const octets = unbracketed.split('.').map(Number)
      if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) {
        return false
      }
      const b0 = octets[0]!
      const b1 = octets[1]!
      const b2 = octets[2]!
      const b3 = octets[3]!

      // Loopback 127.0.0.0/8
      if (b0 === 127) {
        return allowLoopback
      }

      // Unspecified 0.0.0.0/8
      if (b0 === 0) {
        return false
      }

      // Link-local 169.254.0.0/16
      if (b0 === 169 && b1 === 254) {
        return false
      }

      // Multicast 224.0.0.0/4
      if (b0 >= 224 && b0 <= 239) {
        return false
      }

      // Limited broadcast 255.255.255.255
      if (b0 === 255 && b1 === 255 && b2 === 255 && b3 === 255) {
        return false
      }

      // Alibaba cloud metadata 100.100.100.200
      if (b0 === 100 && b1 === 100 && b2 === 100 && b3 === 200) {
        return false
      }

      return true
    }

    if (ipVersion === 6) {
      const norm = unbracketed.toLowerCase()

      // Loopback ::1
      if (norm === '::1' || norm === '0:0:0:0:0:0:0:1') {
        return allowLoopback
      }

      // Unspecified ::
      if (norm === '::' || norm === '0:0:0:0:0:0:0:0') {
        return false
      }

      // Link-local fe80::/10
      if (norm.startsWith('fe8') || norm.startsWith('fe9') || norm.startsWith('fea') || norm.startsWith('feb')) {
        return false
      }

      // Multicast ff00::/8
      if (norm.startsWith('ff')) {
        return false
      }

      // IPv4-mapped IPv6 ::ffff:x.x.x.x
      const ipv4MappedMatch = norm.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
      if (ipv4MappedMatch && ipv4MappedMatch[1]) {
        return this.isValidControllerHost(ipv4MappedMatch[1], allowLoopback)
      }

      return false
    }

    // Arbitrary DNS hostnames are rejected to eliminate DNS rebinding risks
    return false
  }
}

