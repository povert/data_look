/**
 * JSON backend
 * - ≤ MEM_LOAD_LIMIT（默认 2GB）：整文件解析，筛选/随机访问最快
 * - 更大文件：流式扫描根结构 + 元素偏移索引，分页/钻取按需读单条
 */
const fs = require('node:fs')
const nodes = require('../nodes')
const { parsePath } = require('../paths')
const stream = require('../json-stream')

const MEM_LOAD_LIMIT = (function () {
  const env = parseInt(process.env.JSON_MEM_LIMIT || '', 10)
  return Number.isFinite(env) && env > 0 ? env : 2 * 1024 * 1024 * 1024
})()

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
    this._filterCache = new Map()
    this._stream = null // large-file index
    this._mode = 'memory'

    if (size <= MEM_LOAD_LIMIT) {
      try {
        const buf = fs.readFileSync(filePath)
        this._val = JSON.parse(stripBom(buf.toString('utf8')))
        this._mode = 'memory'
      } catch (e) {
        this._val = null
        this._loadError = e && e.message ? e.message : String(e)
      }
    } else {
      this._mode = 'stream'
      try {
        this._stream = stream.scanJsonFile(filePath, nodes.SAMPLE_N, true)
      } catch (e) {
        this._stream = null
        this._loadError = e && e.message ? e.message : String(e)
      }
    }
  }

  get loaded() { return this._mode === 'memory' && this._val !== null }

  _ensureMeta() {
    if (this._meta) return this._meta

    if (this._mode === 'memory') {
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

    // stream mode
    if (!this._stream) {
      this._meta = { kind: 'json', root: 'error', error: this._loadError || '流式索引失败' }
      return this._meta
    }
    const s = this._stream
    if (s.root === 'array') {
      const cols = nodes.inferCols(s.sample || [])
      this._meta = {
        kind: 'json',
        root: 'array',
        count: s.count,
        cols,
        mode: 'stream',
      }
      return this._meta
    }
    if (s.root === 'object') {
      const arrays = {}
      const scalars = {}
      const keys = (s.keys || []).map(k => {
        if (k.type === 'array') {
          const idx = s.arrays[k.name]
          const sample = []
          if (idx && idx.offsets) {
            const fd = fs.openSync(this.path, 'r')
            try {
              const n = Math.min(nodes.SAMPLE_N, idx.offsets.length)
              for (let i = 0; i < n; i++) {
                sample.push(stream.readElementAt(fd, this.size, idx.offsets, i))
              }
            } finally {
              fs.closeSync(fd)
            }
          }
          arrays[k.name] = {
            count: idx ? idx.count : 0,
            cols: nodes.inferCols(sample),
            offsets: idx ? idx.offsets : [],
          }
        } else if (k.type === 'scalar') {
          scalars[k.name] = k.value
        }
        return {
          name: k.name,
          type: k.type,
          preview: k.preview,
          clickable: k.clickable,
        }
      })
      this._meta = {
        kind: 'json',
        root: 'object',
        keys,
        arrays,
        scalars,
        mode: 'stream',
      }
      return this._meta
    }
    this._meta = { kind: 'json', root: 'scalar', value: s.value, mode: 'stream' }
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

  _matchedOffsets(offsets, where, cols) {
    const wkey = 'off:' + JSON.stringify(where, Object.keys(where).sort())
    if (this._filterCache.has(wkey)) return this._filterCache.get(wkey)
    const fd = fs.openSync(this.path, 'r')
    const out = []
    try {
      for (let i = 0; i < offsets.length; i++) {
        const it = stream.readElementAt(fd, this.size, offsets, i)
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
    if (m.root === 'object') {
      return { type: 'object', count: (m.keys || []).length, keys: m.keys }
    }
    if (m.root === 'array') {
      return { type: 'array', count: m.count, cols: m.cols || [], mode: m.mode }
    }
    if (m.root === 'error') {
      return {
        type: 'scalar',
        value: null,
        vtype: 'error',
        message: `JSON 读取失败：${m.error}`,
      }
    }
    const val = m.mode === 'stream' ? m.value : this._val
    return { type: 'scalar', value: val, vtype: nodes.typeName(val) }
  }

  node(path) {
    const m = this._ensureMeta()
    if (m.root === 'error') return this.rootNode()
    if (m.root === 'scalar') return this.rootNode()

    const segs = parsePath(path)
    if (!segs.length) return this.rootNode()

    if (this._mode === 'memory') {
      return nodes.nodeInfo(nodes.resolve(this._val, segs))
    }

    // stream: root object / array
    if (m.root === 'array') {
      const idx = segs[0]
      if (typeof idx !== 'number' || !this._stream.offsets || idx < 0 || idx >= this._stream.offsets.length) {
        return { type: 'scalar', value: null, vtype: 'null' }
      }
      const fd = fs.openSync(this.path, 'r')
      let elem
      try {
        elem = stream.readElementAt(fd, this.size, this._stream.offsets, idx)
      } finally {
        fs.closeSync(fd)
      }
      return nodes.nodeInfo(nodes.resolve(elem, segs.slice(1)))
    }

    // object root
    const first = segs[0]
    if (typeof first !== 'string') {
      return { type: 'scalar', value: null, vtype: 'null' }
    }
    if (segs.length === 1) {
      if (first in (m.scalars || {})) {
        return { type: 'scalar', value: m.scalars[first], vtype: nodes.typeName(m.scalars[first]) }
      }
      if (m.arrays && m.arrays[first]) {
        const a = m.arrays[first]
        return { type: 'array', count: a.count, cols: a.cols }
      }
      // object value: materialize whole object value
      const keyInfo = (this._stream.keys || []).find(k => k.name === first)
      if (keyInfo) {
        const fd = fs.openSync(this.path, 'r')
        let val
        try {
          val = stream.readSlice(fd, keyInfo.start, keyInfo.end)
        } finally {
          fs.closeSync(fd)
        }
        return nodes.nodeInfo(val)
      }
      return { type: 'scalar', value: null, vtype: 'null' }
    }
    // deeper under object key
    if (m.arrays && m.arrays[first] && typeof segs[1] === 'number') {
      const a = m.arrays[first]
      const idx = segs[1]
      if (idx < 0 || idx >= a.offsets.length) {
        return { type: 'scalar', value: null, vtype: 'null' }
      }
      const fd = fs.openSync(this.path, 'r')
      let elem
      try {
        elem = stream.readElementAt(fd, this.size, a.offsets, idx)
      } finally {
        fs.closeSync(fd)
      }
      return nodes.nodeInfo(nodes.resolve(elem, segs.slice(2)))
    }
    return { type: 'scalar', value: null, vtype: 'null' }
  }

  page(path, limit, offset, where, extraCols) {
    const extra = extraCols || []
    const segs = parsePath(path)
    const hasFilter = where && Object.keys(where).some(k => k !== '__opt' && String(where[k] || '').trim())

    if (this._mode === 'memory') {
      if (this._val === null) {
        return { rows: [], total: 0, cols: [], limit, offset, path }
      }
      const arr = nodes.resolve(this._val, segs)
      if (!Array.isArray(arr)) {
        return { rows: [], total: 0, cols: [], limit, offset, path }
      }
      const cols = nodes.inferCols(arr).concat(extra)
      const idxes = hasFilter
        ? this._matchedIdxes(arr, where, cols)
        : arr.map((_, i) => i)
      const total = idxes.length
      const sel = idxes.slice(offset, offset + limit)
      const rows = sel.map(i => nodes.rowOf(arr[i], cols, i))
      return { rows, total, cols, limit, offset, path, filtered: !!hasFilter }
    }

    // stream mode
    const m = this._ensureMeta()
    if (m.root === 'error' || m.root === 'scalar') {
      return { rows: [], total: 0, cols: [], limit, offset, path }
    }

    let offsets
    let cols
    if (m.root === 'array' && !segs.length) {
      offsets = this._stream.offsets
      cols = (m.cols || []).concat(extra)
    } else if (m.root === 'object' && segs.length === 1 && typeof segs[0] === 'string') {
      const a = m.arrays[segs[0]]
      if (!a) {
        return { rows: [], total: 0, cols: [], limit, offset, path }
      }
      offsets = a.offsets
      cols = (a.cols || []).concat(extra)
    } else if (
      m.root === 'object' &&
      segs.length >= 2 &&
      typeof segs[0] === 'string' &&
      typeof segs[1] === 'number'
    ) {
      // nested array under one element — materialize that element then memory page
      const a = m.arrays[segs[0]]
      if (!a || segs[1] < 0 || segs[1] >= a.offsets.length) {
        return { rows: [], total: 0, cols: [], limit, offset, path }
      }
      const fd = fs.openSync(this.path, 'r')
      let elem
      try {
        elem = stream.readElementAt(fd, this.size, a.offsets, segs[1])
      } finally {
        fs.closeSync(fd)
      }
      const arr = nodes.resolve(elem, segs.slice(2))
      if (!Array.isArray(arr)) {
        return { rows: [], total: 0, cols: [], limit, offset, path }
      }
      const c2 = nodes.inferCols(arr).concat(extra)
      const idxes = hasFilter
        ? this._matchedIdxes(arr, where, c2)
        : arr.map((_, i) => i)
      const total = idxes.length
      const sel = idxes.slice(offset, offset + limit)
      const rows = sel.map(i => nodes.rowOf(arr[i], c2, i))
      return { rows, total, cols: c2, limit, offset, path, filtered: !!hasFilter }
    } else {
      return { rows: [], total: 0, cols: [], limit, offset, path }
    }

    if (!offsets) {
      return { rows: [], total: 0, cols: [], limit, offset, path }
    }

    let selIdx
    let total
    if (hasFilter) {
      selIdx = this._matchedOffsets(offsets, where, cols)
      total = selIdx.length
      selIdx = selIdx.slice(offset, offset + limit)
    } else {
      total = offsets.length
      selIdx = []
      for (let i = offset; i < Math.min(offset + limit, total); i++) selIdx.push(i)
    }

    const fd = fs.openSync(this.path, 'r')
    let rows
    try {
      rows = selIdx.map(i => nodes.rowOf(stream.readElementAt(fd, this.size, offsets, i), cols, i))
    } finally {
      fs.closeSync(fd)
    }
    return { rows, total, cols, limit, offset, path, filtered: !!hasFilter, mode: 'stream' }
  }

  record(path) {
    const m = this._ensureMeta()
    if (m.root === 'error') {
      return { value: null, type: 'error', truncated: false, message: m.error }
    }
    if (m.root === 'scalar') {
      const val = m.mode === 'stream' ? m.value : this._val
      return nodes.boundedRecord(val)
    }

    if (this._mode === 'memory') {
      return nodes.boundedRecord(nodes.resolve(this._val, parsePath(path)))
    }

    const segs = parsePath(path)
    if (!segs.length) {
      if (m.root === 'array') {
        return { value: { __summary: 'array', count: m.count }, type: 'array', truncated: false }
      }
      return {
        value: { __summary: 'object', keys: (m.keys || []).map(k => k.name) },
        type: 'object',
        truncated: false,
      }
    }

    if (m.root === 'array' && typeof segs[0] === 'number') {
      const fd = fs.openSync(this.path, 'r')
      try {
        const elem = stream.readElementAt(fd, this.size, this._stream.offsets, segs[0])
        return nodes.boundedRecord(nodes.resolve(elem, segs.slice(1)))
      } finally {
        fs.closeSync(fd)
      }
    }

    if (m.root === 'object' && typeof segs[0] === 'string') {
      if (segs.length === 1) {
        if (segs[0] in (m.scalars || {})) {
          return nodes.boundedRecord(m.scalars[segs[0]])
        }
        if (m.arrays && m.arrays[segs[0]]) {
          return {
            value: { __summary: 'array', count: m.arrays[segs[0]].count },
            type: 'array',
            truncated: false,
          }
        }
        const keyInfo = (this._stream.keys || []).find(k => k.name === segs[0])
        if (keyInfo) {
          const fd = fs.openSync(this.path, 'r')
          try {
            return nodes.boundedRecord(stream.readSlice(fd, keyInfo.start, keyInfo.end))
          } finally {
            fs.closeSync(fd)
          }
        }
      }
      if (m.arrays && m.arrays[segs[0]] && typeof segs[1] === 'number') {
        const a = m.arrays[segs[0]]
        const fd = fs.openSync(this.path, 'r')
        try {
          const elem = stream.readElementAt(fd, this.size, a.offsets, segs[1])
          return nodes.boundedRecord(nodes.resolve(elem, segs.slice(2)))
        } finally {
          fs.closeSync(fd)
        }
      }
    }
    return { value: null, type: 'null', truncated: false }
  }
}

module.exports = JsonBackend
