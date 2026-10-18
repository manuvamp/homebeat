import { DoorClosed } from 'lucide-react'
import { ButtonLink, Card, EmptyState } from '@/components/ui'
import { useApp } from '@/lib/store'
import { possessive } from '@/lib/format'

export default function NotFoundPage() {
  const parent = useApp().today.household.parentName
  return (
    <Card className="mx-auto mt-6 max-w-xl">
      <EmptyState icon={DoorClosed} title="This page isn’t here" body={`The link may be old, or the page has moved. Everything at ${possessive(parent)} is still on Today.`}>
        <ButtonLink to="/" variant="primary">
          Go to Today
        </ButtonLink>
      </EmptyState>
    </Card>
  )
}
