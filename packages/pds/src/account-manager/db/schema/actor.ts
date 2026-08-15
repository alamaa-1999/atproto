import type { Selectable } from 'kysely'
import type { DidString, HandleString } from '@atproto/syntax'

export type Role = 'striker' | 'catcher'
export type AccountType = 'person' | 'institution'

export interface Actor {
  did: DidString
  handle: HandleString | null
  createdAt: string
  takedownRef: string | null
  deactivatedAt: string | null
  deleteAfter: string | null
  role: Role
  accountType: AccountType
}

export type ActorEntry = Selectable<Actor>

export const tableName = 'actor'

export type PartialDB = { [tableName]: Actor }
