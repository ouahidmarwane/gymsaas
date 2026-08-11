// lib/branch-server.ts
export type Branch = 'sbata' | 'rachad'

export function getActiveBranchFromRequestCookies(
  cookies: { get?: (name: string) => { value: string } | undefined } | undefined,
  profileBranch: Branch | null | undefined = null,
): Branch {
  if (profileBranch) return profileBranch
  const cookieValue = cookies?.get?.('active-branch')?.value ?? null
  return cookieValue === 'rachad' ? 'rachad' : 'sbata'
}