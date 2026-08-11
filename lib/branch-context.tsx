'use client'

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { Profile } from '@/types'
import { Branch } from '@/lib/branch-server'
const ACTIVE_BRANCH_COOKIE_NAME = 'active-branch'

function isBranch(value: string | null | undefined): value is Branch {
  return value === 'sbata' || value === 'rachad'
}

function readBranchCookie(): Branch | null {
  if (typeof document === 'undefined') {
    return null
  }

  const match = document.cookie
    .split('; ')
    .map((cookie) => cookie.split('='))
    .find(([name]) => name === ACTIVE_BRANCH_COOKIE_NAME)

  const value = match?.[1] ?? null
  return isBranch(value) ? value : null
}

function writeBranchCookie(branch: Branch) {
  document.cookie = `${ACTIVE_BRANCH_COOKIE_NAME}=${branch}; path=/; max-age=31536000; sameSite=Lax`
}

interface BranchContextValue {
  activeBranch: Branch
  setActiveBranch: (branch: Branch) => void
  profileBranch: Branch | null
  profileRole: string
  canSwitchBranch: boolean
}

const BranchContext = createContext<BranchContextValue | undefined>(undefined)

export function BranchProvider({ children, profile }: { children: ReactNode; profile: Profile }) {
  const profileBranch = profile.branch ?? null
  const profileRole = profile.role
  const defaultBranch = profileBranch ?? 'sbata'
  const [activeBranch, setActiveBranchState] = useState<Branch>(defaultBranch)

  const canSwitchBranch = profile.role === 'admin' || profileBranch === null

  useEffect(() => {
    if (profileBranch) {
      setActiveBranchState(profileBranch)
      writeBranchCookie(profileBranch)
      return
    }

    const cookieBranch = readBranchCookie()
    if (cookieBranch) {
      setActiveBranchState(cookieBranch)
      return
    }

    writeBranchCookie(defaultBranch)
  }, [defaultBranch, profileBranch])

  const setActiveBranch = (branch: Branch) => {
    if (!canSwitchBranch) return
    setActiveBranchState(branch)
    writeBranchCookie(branch)
  }

  const value = useMemo(
    () => ({ activeBranch, setActiveBranch, profileBranch, profileRole, canSwitchBranch }),
    [activeBranch, canSwitchBranch, profileBranch, profileRole],
  )

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
}

export function useBranch() {
  const context = useContext(BranchContext)
  if (!context) {
    throw new Error('useBranch must be used within BranchProvider')
  }
  return context
}
