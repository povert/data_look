/** JSONL / NDJSON: 每行一元素;行偏移索引 → O(1) 任意页 */

const fs = require('node:fs')
const nodes = require('../nodes')
const { parsePath } = require('../paths')

function lineOffsets(filePath) {
  const offs = []
  const fd = fs.openSync(filePath, 'r')
  try {
    const size = fs.fstatSync(fd).size
    const CHUNK = 1024 * 256
    const buf = Buffer.allocUnsafe(CHUNK)
    let pos = 0
    let lineStart = 0
    let atLineStart = true
    let sawContent = false
    while (pos < size) {
      const toRead = Math.min(CHUNK, size - pos)
      const bytes = fs.readSync(fd, buf, 0, toRead, pos)
      if (bytes <= 0) break
      for (let i = 0; i < bytes; i++) {
        const ch = buf[i]
        if (ch === 10) {
          if (sawContent) offs.push(lineStart)
          lineStart = pos + i + 1
          sawContent = false
        } else if (ch !== 13 && ch !== 32 && ch !== 9) {
          sawContent = true
        }
      }
      pos += bytes
    }
    if (sawContent && lineStart < size) offs.push(lineStart)
  } finally {
    fs.closeSync(fd)
  }
  return offs
}

class JsonlBackend {
  constructor(filePath, size, mtime) {
    this.category = 'jsonl'
    this.path = filePath
    this.size = size
    this.mtime = mtime
    this._offsets = null
    this._meta = null
    this._filterCache = new Map()
  }

  _ensureIndex() {
    if (this._offsets) return
    this._offsets = lineOffsets(this.path)
  }

  _readLineAt(fd, off) {
    const stats = fs.fstatSync(fd)
    const len = Math.min(64 * 1024 * 1024, stats.size - off)
    if (len <= 0) return null
    const buf = Buffer.allocUnsafe(len)
    fs.readSync(fd, buf, 0, len, off)
    const nl = buf.indexOf(10)
    const line = (nl === -1 ? buf : buf.subarray(0, nl)).toString('utf8')
    try { return JSON.parse(line) } catch { return null }
  }

  _readRange(start, end) {
    this._ensureIndex()
    const out = []
    const fd = fs.openSync(this.path, 'r')
    try {
      for (let i = start; i < end; i++) {
        out.push(this._readLineAt(fd, this._offsets[i]))
      }
    } finally {
      fs.closeSync(fd)
    }
    return out
  }

  _ensureMeta() {
    if (this._meta) return this._meta
    this._ensureIndex()
    const n = Math.min(nodes.SAMPLE_N, this._offsets.length)
    const sample = this._readRange(0, n)
    this._meta = {
      kind: 'jsonl',
      cols: nodes.inferCols(sample),
      count: this._offsets.length,
      size: this.size,
      mtime: this.mtime,
    }
    return this._meta
  }

  _matchedIdxes(where, cols) {
    const wkey = JSON.stringify(where, Object.keys(where).sort())
    if (this._filterCache.has(wkey)) return this._filterCache.get(wkey)
    this._ensureIndex()
    const out = []
    const fd = fs.openSync(this.path, 'r')
    try {
      for (let i = 0; i < this._offsets.length; i++) {
        const it = this._readLineAt(fd, this._offsets[i])
        if (nodes.itemMatches(it, where, cols)) out.push(i)
      }
    } finally {
      fs.closeSync(fd)
    }
    if (this._filterCache.size > 16) this._filterCache.clear()
    this._filterCache.set(wkey, out)
    return out
  }

  rootNode() {
    const m = this._ensureMeta()
    return { type: 'array', count: m.count, cols: m.cols }
  }

  node(path) {
    const segs = parsePath(path)
    if (!segs.length) return this.rootNode()
    this._ensureIndex()
    const idx = segs[0]
    const rest = segs.slice(1)
    if (typeof idx !== 'number' || idx < 0 || idx >= this._offsets.length) {
      return { type: 'scalar', value: null, vtype: 'null' }
    }
    const fd = fs.openSync(this.path, 'r')
    let elem
    try { elem = this._readLineAt(fd, this._offsets[idx]) } finally { fs.closeSync(fd) }
    return nodes.nodeInfo(nodes.resolve(elem, rest))
  }

  page(path, limit, offset, where, extraCols) {
    const extra = extraCols || []
    const segs = parsePath(path)
    if (!segs.length) {
      const m = this._ensureMeta()
      const cols = m.cols.concat(extra)
      if (where && Object.keys(where).some(k => String(where[k] || '').trim())) {
        const idxes = this._matchedIdxes(where, cols)
        const total = idxes.length
        const sel = idxes.slice(offset, offset + limit)
        const fd = fs.openSync(this.path, 'r')
        let rows
        try {
          rows = sel.map(i => nodes.rowOf(this._readLineAt(fd, this._offsets[i]), cols, i))
        } finally { fs.closeSync(fd) }
        return { rows, total, cols, limit, offset, path, filtered: true }
      }
      const total = m.count
      const end = Math.min(offset + limit, total)
      const items = this._readRange(offset, end)
      const rows = items.map((it, k) => nodes.rowOf(it, cols, offset + k))
      return { rows, total, cols, limit, offset, path }
    }
    // nested array under one element
    const idx = segs[0]
    const rest = segs.slice(1)
    this._ensureIndex()
    if (typeof idx !== 'number' || idx < 0 || idx >= this._offsets.length) {
      return { rows: [], total: 0, cols: [], limit, offset, path }
    }
    const fd = fs.openSync(this.path, 'r')
    let elem
    try { elem = this._readLineAt(fd, this._offsets[idx]) } finally { fs.closeSync(fd) }
    const arr = nodes.resolve(elem, rest)
    if (!Array.isArray(arr)) {
      return { rows: [], total: 0, cols: [], limit, offset, path }
    }
    const cols = nodes.inferCols(arr).concat(extra)
    const hasFilter = where && Object.keys(where).some(k => String(where[k] || '').trim())
    const idxes = hasFilter
      ? arr.map((it, i) => (nodes.itemMatches(it, where, cols) ? i : -1)).filter(i => i >= 0)
      : arr.map((_, i) => i)
    const total = idxes.length
    const sel = idxes.slice(offset, offset + limit)
    const rows = sel.map(i => nodes.rowOf(arr[i], cols, i))
    return { rows, total, cols, limit, offset, path, filtered: !!hasFilter }
  }

  record(path) {
    const segs = parsePath(path)
    if (!segs.length) {
      const m = this._ensureMeta()
      return { value: { __summary: 'array', count: m.count }, type: 'array', truncated: false }
    }
    this._ensureIndex()
    const idx = segs[0]
    const rest = segs.slice(1)
    if (typeof idx !== 'number' || idx < 0 || idx >= this._offsets.length) {
      return { value: null, type: 'null', truncated: false }
    }
    const fd = fs.openSync(this.path, 'r')
    let elem
    try { elem = this._readLineAt(fd, this._offsets[idx]) } finally { fs.closeSync(fd) }
    return nodes.boundedRecord(nodes.resolve(elem, rest))
  }
}

module.exports = JsonlBackend
