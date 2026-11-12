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
  kind?: string
  pinned: boolean
  hidden: boolean
  created_at: string
  updated_at: string
  deleted?: boolean
}

export type MessageType = 'text' | 'image' | 'todo' | 'clip'

export interface ClipStats {
  likes?: string
  collects?: string
  comments?: string
  shares?: string
}

export interface ClipAuthor {
  user_id: string
  name: string
  avatar_url?: string
}

export interface ClipChapter {
  text: string
  time_ms: number
}

export interface ClipImage {
  file_id: string
  width: number
  height: number
  live?: boolean
  live_size?: number
  preview_url?: string
  watermarked?: boolean
}

export interface ClipVideo {
  file_id: string
  width: number
  height: number
  duration_ms: number
  size: number
  cover_file_id?: string
  cover_width?: number
  cover_height?: number
  preview_url?: string
  watermarked?: boolean
}

export interface ClipMeta {
  platform: string
  note_id: string
  source_url: string
  note_type: 'image' | 'video'
  title: string
  body: string
  author: ClipAuthor
  published_at: string
  note_updated_at?: string
  stats: ClipStats
  tags: string[]
  content_declaration?: string
  chapters?: ClipChapter[]
  media: ClipMedia[]
}

export interface ParsedClip {
  platform: string
  note_id: string
  source_url: string
  note_type: 'image' | 'video'
  title: string
  body: string
  author: ClipAuthor
  published_at: string
  note_updated_at?: string
  stats: ClipStats
  tags: string[]
  content_declaration?: string
  chapters?: ClipChapter[]
  images: ClipImage[]
  video?: ClipVideo
}

export interface ClipParseResponse {
  parse_id: string
  existing_message_id?: string
  clip: ParsedClip
}

export interface ClipDownloadImage {
  index: number
  status: 'ok' | 'failed'
  hash?: string
  live_status?: 'ok' | 'failed' | 'skipped'
  live_hash?: string
  error?: string
}

export interface ClipDownloadVideo {
  status: 'ok' | 'failed'
  hash?: string
  cover_hash?: string
  error?: string
}

export interface ClipDownloadResponse {
  images: ClipDownloadImage[]
  video?: ClipDownloadVideo
}

export interface ClipMedia {
  kind: 'image' | 'video'
  file_id: string
  width: number
  height: number
  source_index?: number
  live?: boolean
  live_size?: number
  duration_ms?: number
  size?: number
  cover_file_id?: string
  cover_width?: number
  cover_height?: number
  watermarked?: boolean
  hash?: string
  live_hash?: string
  cover_hash?: string
  status?: 'pending' | 'ok' | 'failed'
  live_status?: 'pending' | 'ok' | 'failed' | 'skipped'
  error?: string
}

export interface Message {
  id: string
  role_id: string
  type: MessageType
  text: string
  attachment_ref: string
  meta?: ClipMeta
  width?: number
  height?: number
  side: 'right' | 'left'
  todo_done: boolean
  created_at: string
  updated_at: string
  deleted?: boolean
}

export type RoleFields = Partial<Pick<Role, 'name' | 'avatar' | 'color' | 'kind' | 'pinned' | 'hidden'>>
export type MessageFields = { text?: string; todo_done?: boolean; meta?: ClipMeta }

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
  fingerprint: string
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