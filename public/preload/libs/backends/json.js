/** JSON: 小文件整载内存;大文件仅支持有限浏览(避免 OOM) */

const fs = require('node:fs')
const nodes = require('../nodes')
const { parsePath } = require('../paths')

const MEM_LOAD_LIMIT = 400 * 1024 * 1024

function stripBom(text) {
  if (text && text.charCodeAt(0) === 0xfeff) return text.slice(1)
  return text
}

class JsonBackend {
  constructor(filePath, size, mtime) {
    this.category = 'json'
    this.path = filePath
    this.size = size
    this.mtime = mtime
    this._val = null
    this._meta = null
    this._loadError = null
    this._tooLarge = false
    this._filterCache = new Map()
    if (size > MEM_LOAD_LIMIT) {
      this._tooLarge = true
      return
    }
    try {
      const buf = fs.readFileSync(filePath)
      let text = buf.toString('utf8')
      text = stripBom(text)
      this._val = JSON.parse(text)
    } catch (e) {
      this._val = null
      this._loadError = e && e.message ? e.message : String(e)
    }
  }

  get loaded() { return this._val !== null }

  _ensureMeta() {
    if (this._meta) return this._meta
    if (this._tooLarge) {
      this._meta = { kind: 'json', root: 'too_large', size: this.size }
      return this._meta
    }
    if (this._val === null) {
      this._meta = { kind: 'json', root: 'error', error: this._loadError || '解析失败' }
      return this._meta
    }
    const v = this._val
    if (Array.isArray(v)) {
      this._meta = { kind: 'json', root: 'array', count: v.length, cols: nodes.inferCols(v) }
    } else if (v && typeof v === 'object') {
      const keys = []
      const arrays = {}
      const scalars = {}
      for (const [k, vv] of Object.entries(v)) {
        const t = nodes.typeName(vv)
        keys.push({
          name: String(k),
          type: t,
          preview: nodes.previewOf(vv),
          clickable: (vv && typeof vv === 'object') || Array.isArray(vv),
        })
        if (Array.isArray(vv)) arrays[k] = { count: vv.length, cols: nodes.inferCols(vv) }
        else if (!(vv && typeof vv === 'object')) scalars[k] = vv
      }
      this._meta = { kind: 'json', root: 'object', keys, arrays, scalars }
    } else {
      this._meta = { kind: 'json', root: 'scalar' }
    }
    return this._meta
  }

  _matchedIdxes(arr, where, cols) {
    const wkey = JSON.stringify(where, Object.keys(where).sort())
    if (this._filterCache.has(wkey)) return this._filterCache.get(wkey)
    const out = []
    for (let i = 0; i < arr.length; i++) {
      if (nodes.itemMatches(arr[i], where, cols)) out.push(i)
    }
    if (this._filterCache.size > 16) this._filterCache.clear()
    this._filterCache.set(wkey, out)
    return out
  }

  rootNode() {
    const m = this._ensureMeta()
    if (m.root === 'object') {
      return { type: 'object', count: (m.keys || []).length, keys: m.keys }
    }
    if (m.root === 'array') {
      return { type: 'array', count: m.count, cols: m.cols || [] }
    }
    if (m.root === 'too_large') {
      return {
        type: 'scalar',
        value: null,
        vtype: 'error',
        message: `文件过大（${(m.size / 1024 / 1024).toFixed(1)} MB），请使用 JSONL 或拆分文件`,
      }
    }
    if (m.root === 'error') {
      return {
        type: 'scalar',
        value: null,
        vtype: 'error',
        message: `JSON 解析失败：${m.error}`,
      }
    }
    return { type: 'scalar', value: this._val, vtype: nodes.typeName(this._val) }
  }

  node(path) {
    const m = this._ensureMeta()
    if (this._val === null) return this.rootNode()
    return nodes.nodeInfo(nodes.resolve(this._val, parsePath(path)))
  }

  page(path, limit, offset, where, extraCols) {
    if (this._val === null) {
      return { rows: [], total: 0, cols: [], limit, offset, path }
    }
    const extra = extraCols || []
    const arr = nodes.resolve(this._val, parsePath(path))
    if (!Array.isArray(arr)) {
      return { rows: [], total: 0, cols: [], limit, offset, path }
    }
    const cols = nodes.inferCols(arr).concat(extra)
    const hasFilter = where && Object.keys(where).some(k => String(where[k] || '').trim())
    const idxes = hasFilter
      ? this._matchedIdxes(arr, where, cols)
      : arr.map((_, i) => i)
    const total = idxes.length
    const sel = idxes.slice(offset, offset + limit)
    const rows = sel.map(i => nodes.rowOf(arr[i], cols, i))
    return { rows, total, cols, limit, offset, path, filtered: !!hasFilter }
  }

  record(path) {
    if (this._val === null) {
      return {
        value: null,
        type: 'error',
        truncated: false,
        message: this._tooLarge ? '文件过大，无法读取原始记录' : (this._loadError || '解析失败'),
      }
    }
    return nodes.boundedRecord(nodes.resolve(this._val, parsePath(path)))
  }
}

module.exports = JsonBackend
