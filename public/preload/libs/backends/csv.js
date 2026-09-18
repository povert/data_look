/** CSV / TSV: 第一行表头;行偏移索引;单元值为字符串 */

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

function splitCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = false
      } else cur += ch
    } else if (ch === '"') {
      inQ = true
    } else if (ch === ',') {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function splitTsvLine(line) {
  return line.split('\t')
}

class CsvBackend {
  constructor(filePath, size, mtime) {
    this.category = 'csv'
    this.path = filePath
    this.size = size
    this.mtime = mtime
    this._offsets = null
    this._meta = null
    this._filterCache = new Map()
    this._delimiter = filePath.toLowerCase().endsWith('.tsv') ? 'tsv' : 'csv'
  }

  _ensureIndex() {
    if (this._offsets) return
    this._offsets = lineOffsets(this.path)
  }

  _parseRow(lineIdx) {
    this._ensureIndex()
    if (lineIdx < 0 || lineIdx >= this._offsets.length) return []
    const fd = fs.openSync(this.path, 'r')
    try {
      const stats = fs.fstatSync(fd)
      const off = this._offsets[lineIdx]
      const len = Math.min(8 * 1024 * 1024, stats.size - off)
      if (len <= 0) return []
      const buf = Buffer.allocUnsafe(len)
      fs.readSync(fd, buf, 0, len, off)
      const nl = buf.indexOf(10)
      let line = (nl === -1 ? buf : buf.subarray(0, nl)).toString('utf8')
      if (line.endsWith('\r')) line = line.slice(0, -1)
      return this._delimiter === 'tsv' ? splitTsvLine(line) : splitCsvLine(line)
    } finally {
      fs.closeSync(fd)
    }
  }

  _ensureMeta() {
    if (this._meta) return this._meta
    this._ensureIndex()
    const header = this._parseRow(0)
    const sample = []
    for (let i = 1; i < Math.min(1 + nodes.SAMPLE_N, this._offsets.length); i++) {
      try {
        const fields = this._parseRow(i)
        const d = {}
        for (let k = 0; k < header.length; k++) {
          d[header[k] || `col${k}`] = fields[k] !== undefined ? fields[k] : null
        }
        sample.push(d)
      } catch { /* skip bad sample rows */ }
    }
    const cols = sample.length
      ? nodes.inferCols(sample)
      : header.map((h, i) => ({ name: h || `col${i}`, type: 'string' }))
    this._meta = { kind: 'csv', cols, count: Math.max(0, this._offsets.length - 1) }
    return this._meta
  }

  _dataRow(j) {
    const m = this._ensureMeta()
    if (j < 0 || j >= m.count) return null
    const header = m.cols.map(c => c.name)
    const fields = this._parseRow(j + 1)
    const row = {}
    for (let i = 0; i < header.length; i++) {
      row[header[i]] = i < fields.length ? fields[i] : null
    }
    return row
  }

  _matchedIdxes(where, cols) {
    const wkey = JSON.stringify(where)
    if (this._filterCache.has(wkey)) return this._filterCache.get(wkey)
    const m = this._ensureMeta()
    const out = []
    for (let j = 0; j < m.count; j++) {
      const r = this._dataRow(j)
      if (r && nodes.itemMatches(r, where, cols)) out.push(j)
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
    const m = this._ensureMeta()
    const segs = parsePath(path)
    if (!segs.length) return this.rootNode()
    if (typeof segs[0] === 'number') {
      const row = this._dataRow(segs[0])
      if (!row) return { type: 'scalar', value: null, vtype: 'null' }
      return nodes.nodeInfo(row)
    }
    return { type: 'scalar', value: null, vtype: 'null' }
  }

  page(path, limit, offset, where, extraCols) {
    const m = this._ensureMeta()
    const cols = m.cols.concat(extraCols || [])
    const segs = parsePath(path)
    if (segs.length) {
      return { rows: [], total: 0, cols: [], limit, offset, path }
    }
    const hasFilter = where && Object.keys(where).some(k => String(where[k] || '').trim())
    if (hasFilter) {
      const idxes = this._matchedIdxes(where, cols)
      const total = idxes.length
      const sel = idxes.slice(offset, offset + limit)
      const rows = sel.map(j => nodes.rowOf(this._dataRow(j), cols, j))
      return { rows, total, cols, limit, offset, path, filtered: true }
    }
    const total = m.count
    const end = Math.min(offset + limit, total)
    const rows = []
    for (let j = offset; j < end; j++) {
      const r = this._dataRow(j)
      if (r) rows.push(nodes.rowOf(r, cols, j))
    }
    return { rows, total, cols, limit, offset, path }
  }

  record(path) {
    const m = this._ensureMeta()
    const segs = parsePath(path)
    if (!segs.length) {
      return { value: { __summary: 'array', count: m.count }, type: 'array', truncated: false }
    }
    if (typeof segs[0] === 'number') {
      const row = this._dataRow(segs[0])
      if (!row) return { value: null, type: 'null', truncated: false }
      const rest = segs.slice(1)
      const val = rest.length ? nodes.resolve(row, rest) : row
      return nodes.boundedRecord(val)
    }
    return { value: null, type: 'null', truncated: false }
  }
}

module.exports = CsvBackend
