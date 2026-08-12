import Shell from '@/components/Shell'
import type { ReactNode } from 'react'

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>
}
