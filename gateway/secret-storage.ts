import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { SecretStore } from './types'

export class MemorySecretStore implements SecretStore {
  private key: string | null = null

  async getMachinePrivateKey(): Promise<string | null> {
    return this.key
  }

  async setMachinePrivateKey(key: string): Promise<void> {
    if (!key || typeof key !== 'string' || !/^[A-Za-z0-9_-]{80,512}$/.test(key)) {
      throw new Error('INVALID_MACHINE_PRIVATE_KEY')
    }
    this.key = key
  }

  async clear(): Promise<void> {
    this.key = null
  }
}

export class FsSecretStore implements SecretStore {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async getMachinePrivateKey(): Promise<string | null> {
    try {
      const content = await fs.readFile(this.filePath, 'utf8')
      const trimmed = content.trim()
      if (!trimmed || !/^[A-Za-z0-9_-]{80,512}$/.test(trimmed)) {
        return null
      }
      return trimmed
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  async setMachinePrivateKey(key: string): Promise<void> {
    if (!key || typeof key !== 'string' || !/^[A-Za-z0-9_-]{80,512}$/.test(key)) {
      throw new Error('INVALID_MACHINE_PRIVATE_KEY')
    }
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp.${Date.now()}`
    await fs.writeFile(tempPath, key, { mode: 0o600, encoding: 'utf8' })
    await fs.rename(tempPath, this.filePath)
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath)
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'ENOENT') {
        return
      }
      throw error
    }
  }
}

