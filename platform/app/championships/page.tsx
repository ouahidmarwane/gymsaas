import { Trophy } from 'lucide-react'
import ComingSoon from '@/components/ComingSoon'

export default function Page() {
  return (
    <ComingSoon title="Championnats" icon={<Trophy size={40} strokeWidth={1.6} />}>
      Competitions, categories, poids et podiums. La structure de donnees existe deja cote club ; il reste l'interface.
    </ComingSoon>
  )
}