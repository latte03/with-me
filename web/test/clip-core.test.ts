import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyClipDownload,
  buildClipMeta,
  clipHasPendingMedia,
  clipPendingIndices,
  clipSearchText,
  clipViewerItems,
  extractXHSLink,
} from '../src/clip-core.ts'
import type { ParsedClip } from '../src/types.ts'

const parsed: ParsedClip = {
  platform: 'xhs',
  note_id: 'note-1',
  source_url: 'https://www.xiaohongshu.com/discovery/item/note-1?xsec_token=t',
  note_type: 'image',
  title: '标题',
  body: '正文第一段\n正文第二段',
  author: { user_id: 'u1', name: '作者' },
  published_at: '2026-11-08T00:00:00Z',
  stats: { likes: '1', collects: '2', comments: '3', shares: '4' },
  tags: ['tag1', 'tag2'],
  images: [
    { file_id: 'f1', width: 100, height: 200, live: true, live_size: 1000 },
    { file_id: 'f2', width: 100, height: 200 },
  ],
}

test('extractXHSLink picks the first link and counts unique URLs', () => {
  const text = 'Copy 小红书 https://xhslink.cn/o/abc，看看 https://xhslink.cn/o/def 。'
  const found = extractXHSLink(text)
  assert.equal(found?.url, 'https://xhslink.cn/o/abc')
  assert.equal(found?.count, 2)
})

test('extractXHSLink ignores non-XHS links and trailing punctuation', () => {
  assert.equal(extractXHSLink('https://example.com/a'), null)
  const found = extractXHSLink('https://www.xiaohongshu.com/explore/123?xsec_token=x).')
  assert.equal(found?.url, 'https://www.xiaohongshu.com/explore/123?xsec_token=x')
})

test('buildClipMeta keeps only selected media and marks them pending', () => {
  const meta = buildClipMeta(parsed, { title: ' 新标题 ', body: '新正文', imageIndices: [0], video: false })
  assert.equal(meta.title, '新标题')
  assert.equal(meta.body, '新正文')
  assert.equal(meta.media.length, 1)
  assert.equal(meta.media[0].file_id, 'f1')
  assert.equal(meta.media[0].status, 'pending')
  assert.equal(meta.media[0].live_status, 'pending')
  assert.equal(meta.media[0].source_index, 0)
})

test('applyClipDownload maps hashes back to selected media', () => {
  const meta = buildClipMeta(parsed, { title: 't', body: 'b', imageIndices: [1], video: false })
  const updated = applyClipDownload(meta, {
    images: [{ index: 1, status: 'ok', hash: 'h1', live_status: 'skipped' }],
  })
  assert.equal(updated.media[0].hash, 'h1')
  assert.equal(updated.media[0].status, 'ok')
  assert.equal(clipHasPendingMedia(updated), false)
  assert.deepEqual(clipViewerItems(updated), [{ hash: 'h1', liveHash: undefined }])
})

test('clipPendingIndices returns failed and pending image source indices', () => {
  const meta = buildClipMeta(parsed, { title: 't', body: 'b', imageIndices: [0, 1], video: false })
  const failed = applyClipDownload(meta, {
    images: [
      { index: 0, status: 'failed', error: 'x' },
      { index: 1, status: 'ok', hash: 'h1' },
    ],
  })
  assert.deepEqual(clipPendingIndices(failed), [0])
})

test('clipSearchText includes title, body, author, tags and source', () => {
  const meta = buildClipMeta(parsed, { title: 't', body: 'b', imageIndices: [], video: false })
  const text = clipSearchText(meta)
  assert.match(text, /^t\nb\n作者：作者\n话题：tag1 tag2\nhttps:\/\//)
})
