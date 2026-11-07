export interface User {
  id: string
  username: string
  is_admin: boolean
}

export interface Session {
  token: string
  user: User
  device_id: string
}

export interface Role {
  id: string
  name: string
  avatar: string
  color: string
  pinned: boolean
  hidden: boolean
  created_at: string
  updated_at: string
  deleted?: boolean
}

export type MessageType = 'text' | 'image' | 'todo'

export interface Message {
  id: string
  role_id: string
  type: MessageType
  text: string
  attachment_ref: string
  width?: number
  height?: number
  side: 'right' | 'left'
  todo_done: boolean
  created_at: string
  updated_at: string
  deleted?: boolean
}

export type RoleFields = Partial<Pick<Role, 'name' | 'avatar' | 'color' | 'pinned' | 'hidden'>>
export type MessageFields = { text?: string; todo_done?: boolean }

export type Envelope = {
  op_id: string
  device_id: string
  seq: number
  client_created_at: string
} & (
  | { type: 'role.create'; payload: Omit<Role, 'deleted'> }
  | { type: 'role.update'; payload: { id: string; updated_at: string; fields: RoleFields } }
  | { type: 'role.delete'; payload: { id: string; updated_at: string } }
  | { type: 'message.create'; payload: Omit<Message, 'deleted'> }
  | { type: 'message.update'; payload: { id: string; updated_at: string; fields: MessageFields } }
  | { type: 'message.delete'; payload: { id: string; updated_at: string } }
  | { type: 'todo.set_done'; payload: { id: string; done: boolean; updated_at: string } }
)

export type OpInput = Pick<Envelope, 'type' | 'payload'>
export type PulledOp = Envelope & { cursor: number; accepted_at: string }

export interface Projection {
  roles: Record<string, Role>
  messages: Record<string, Message>
}

export interface BlobRec {
  hash: string
  blob: Blob | null
  thumb: Blob | null
  mime: string
  size: number
  pending: boolean
}

export interface DeviceInfo {
  id: string
  name: string
  last_seen: string
  revoked: boolean
  current: boolean
}

export interface SearchResult {
  message_id: string
  role_id: string
  role_name: string
  text: string
  created_at: string
  snippet: string
}

export interface MeInfo {
  user: User
  device_id: string
  quota_bytes: number
  used_bytes: number
}

export interface AdminUser {
  id: string
  username: string
  is_admin: boolean
  disabled: boolean
  created_at: string
}

export interface PushResult {
  server_cursor: number
  applied: { op_id: string; cursor: number }[]
}

export interface PullResult {
  ops: PulledOp[]
  server_cursor: number
  has_more: boolean
}