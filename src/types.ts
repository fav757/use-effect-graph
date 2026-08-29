export type UserStatus = 'active' | 'invited' | 'suspended'

export interface User {
  id: number
  name: string
  email: string
  role: string
  team: string
  status: UserStatus
}

export type ActivityKind = 'login' | 'profile' | 'security' | 'export'

export interface Activity {
  id: string
  kind: ActivityKind
  description: string
  occurredAt: string
}
