import { UserCog } from 'lucide-react'
import ComingSoon from '@/components/ComingSoon'

export default function Page() {
  return (
    <ComingSoon title="Equipe et droits" icon={<UserCog size={40} strokeWidth={1.6} />}>
      Comptes du personnel, roles et portees. L'API des appartenances est prete ; l'ecran suit.
    </ComingSoon>
  )
}