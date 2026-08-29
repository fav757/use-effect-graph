import type { Activity, User, UserStatus } from '../types'

const users: User[] = [
  {
    id: 1,
    name: 'Avery Chen',
    email: 'avery@example.com',
    role: 'Admin',
    team: 'Platform',
    status: 'active',
  },
  {
    id: 2,
    name: 'Maya Patel',
    email: 'maya@example.com',
    role: 'Designer',
    team: 'Product',
    status: 'active',
  },
  {
    id: 3,
    name: 'Noah Williams',
    email: 'noah@example.com',
    role: 'Analyst',
    team: 'Risk',
    status: 'invited',
  },
  {
    id: 4,
    name: 'Sofia Garcia',
    email: 'sofia@example.com',
    role: 'Engineer',
    team: 'Platform',
    status: 'active',
  },
  {
    id: 5,
    name: 'Leo Martin',
    email: 'leo@example.com',
    role: 'Manager',
    team: 'Support',
    status: 'suspended',
  },
  {
    id: 6,
    name: 'Amara Okafor',
    email: 'amara@example.com',
    role: 'Researcher',
    team: 'Product',
    status: 'active',
  },
  {
    id: 7,
    name: 'Oliver Smith',
    email: 'oliver@example.com',
    role: 'Agent',
    team: 'Support',
    status: 'invited',
  },
  {
    id: 8,
    name: 'Yuki Tanaka',
    email: 'yuki@example.com',
    role: 'Engineer',
    team: 'Security',
    status: 'active',
  },
  {
    id: 9,
    name: 'Elena Rossi',
    email: 'elena@example.com',
    role: 'Auditor',
    team: 'Risk',
    status: 'suspended',
  },
  {
    id: 10,
    name: 'Sam Wilson',
    email: 'sam@example.com',
    role: 'Developer',
    team: 'Security',
    status: 'active',
  },
]

const activityDescriptions = [
  ['login', 'Signed in from a recognized device'],
  ['profile', 'Updated profile information'],
  ['security', 'Changed two-factor authentication settings'],
  ['export', 'Exported a workspace report'],
] as const

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      window.clearTimeout(timeoutId)
      reject(new DOMException('Request aborted', 'AbortError'))
    })
  })
}

export async function fetchUsers(
  query: string,
  status: UserStatus | 'all',
  signal: AbortSignal,
): Promise<User[]> {
  await delay(350, signal)
  const normalizedQuery = query.trim().toLowerCase()

  return users.filter((user) => {
    const matchesQuery =
      !normalizedQuery ||
      [user.name, user.email, user.role, user.team].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      )
    return matchesQuery && (status === 'all' || user.status === status)
  })
}

export async function fetchActivity(
  userId: number,
  signal: AbortSignal,
): Promise<Activity[]> {
  await delay(450, signal)
  const now = Date.now()

  return activityDescriptions.map(([kind, description], index) => ({
    id: `${userId}-${kind}`,
    kind,
    description,
    occurredAt: new Date(
      now - (userId * 7 + index * 19) * 60_000,
    ).toISOString(),
  }))
}
