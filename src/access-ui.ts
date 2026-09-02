export type AccessUiScope = { mode?: string | null; canWrite?: boolean | null }

export function canViewAccessUi(scope: AccessUiScope, role: string | null | undefined): boolean {
  return scope.mode === 'support' || ['owner','admin','staff'].includes(role ?? '')
}

export function canManageAccessUi(scope: AccessUiScope, role: string | null | undefined): boolean {
  return scope.mode === 'support' ? Boolean(scope.canWrite) : ['owner','admin'].includes(role ?? '')
}

export function accessNavigationRole(scope: AccessUiScope, role: string | null | undefined): string | null {
  return scope.mode === 'support' ? 'admin' : role ?? null
}
