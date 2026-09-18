/** Excel (.xlsx/.xls): SheetJS 解析;根为 object，sheet 名=键 */

const fs = require('node:fs')
const XLSX = require('xlsx')
const nodes = require('../nodes')
const { parsePath } = require('../paths')

function colLetter(i) {
  let s = ''
  i = i + 1
  while (i > 0) {
    const r = (i - 1) % 26
    s = String.fromCharCode(65 + r) + s
    i = Math.floor((i - 1) / 26)
  }
  return s
}

class ExcelBackend {
  constructor(filePath, size, mtime) {
    this.category = 'excel'
    this.path = filePath
    this.size = size
    this.mtime = mtime
    this._wb = null
    this._meta = null
    this._filterCache = new Map()
  }

  _ensureWb() {
    if (this._wb) return this._wb
    const buf = fs.readFileSync(this.path)
    this._wb = XLSX.read(buf, {
      type: 'buffer',
      cellStyles: true,
      cellNF: true,
      cellDates: true,
      cellHTML: false,
      sheetStubs: false,
    })
    return this._wb
  }

  _cellVal(cell) {
    if (!cell) return null
    const v = cell.v
    if (v === undefined) return null
    if (v instanceof Date) return v.toISOString()
    return v
  }

  _ensureMeta() {
    if (this._meta) return this._meta
    const wb = this._ensureWb()
    const sheets = {}
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name]
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
      const headerRow = []
      const colNames = []
      const sample = []
      const header0 = range.s.r
      const usedNm = new Set()
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = colLetter(c) + String(header0 + 1)
        const cell = ws[addr]
        const v = this._cellVal(cell)
        headerRow.push(v)
        const base = v != null && String(v).trim() ? String(v) : `col${c - range.s.c}`
        // 表头可能重复（如两个「详细说明」），需唯一化，否则对象键互相覆盖、列错位
        let nm = base
        let n = 2
        while (usedNm.has(nm)) {
          nm = `${base}_${n++}`
        }
        usedNm.add(nm)
        colNames.push(nm)
      }
      const dataCount = Math.max(0, range.e.r - range.s.r)
      const SAMPLE = nodes.SAMPLE_N
      for (let r = range.s.r + 1; r <= Math.min(range.e.r, range.s.r + SAMPLE); r++) {
        const d = {}
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = colLetter(c) + String(r + 1)
          d[colNames[c - range.s.c]] = this._cellVal(ws[addr])
        }
        sample.push(d)
      }
      const cols = sample.length ? nodes.inferCols(sample) : colNames.map(n => ({ name: n, type: 'string' }))
      const ncols = cols.length
      // merges
      const merges = []
      for (const mr of (ws['!merges'] || [])) {
        // mr.s.r is absolute sheet row; data row = mr.s.r - (header0+1)
        if (mr.s.r <= header0) continue
        merges.push({
          r: mr.s.r - header0 - 1,
          c: mr.s.c - range.s.c,
          r1: mr.e.r - header0 - 1,
          c1: mr.e.c - range.s.c,
        })
      }
      // cell decorations for rich:只同步链接/备注/合并,不同步背景填充色
      // (背景色多为原表为区别主题而设的浅色,深色模式与插件主题不符)。仅保留 link/comment。
      const cells = {}
      if (dataCount <= 5000) {
        for (let r = header0 + 1; r <= range.e.r; r++) {
          const ri = r - header0 - 1
          for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = ws[colLetter(c) + String(r + 1)]
            if (!cell) continue
            const d = {}
            if (cell.l && (cell.l.Target || cell.l)) {
              d.link = cell.l.Target || cell.l
            }
            if (cell.c && cell.c.length) {
              const tx = (cell.c[0].t || '').trim()
              if (tx) d.comment = tx
            }
            if (d.link || d.comment) {
              cells[`${ri},${c - range.s.c}`] = d
            }
          }
        }
      }
      sheets[name] = {
        rich: true,
        count: dataCount,
        cols,
        merges,
        cells,
        range: { sCol: range.s.c, sRow: range.s.r },
      }
    }
    this._meta = { kind: 'excel', sheets, sheetnames: wb.SheetNames, rich: true }
    return this._meta
  }

  _rows(sheet, limit, offset) {
    const wb = this._ensureWb()
    const m = this._ensureMeta()
    const sinfo = m.sheets[sheet]
    const ws = wb.Sheets[sheet]
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    const cols = sinfo.cols.map(c => c.name)
    const out = []
    const start = range.s.r + 1 + offset
    const end = Math.min(range.e.r, start + limit - 1)
    for (let r = start; r <= end && r >= start; r++) {
      if (r > range.e.r) break
      const d = {}
      for (let c = range.s.c; c <= range.e.c; c++) {
        const k = c - range.s.c
        if (k >= cols.length) break
        d[cols[k]] = this._cellVal(ws[colLetter(c) + String(r + 1)])
      }
      out.push(d)
      if (out.length >= limit) break
    }
    return out
  }

  _allRows(sheet) {
    const wb = this._ensureWb()
    const m = this._ensureMeta()
    const sinfo = m.sheets[sheet]
    const ws = wb.Sheets[sheet]
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    const cols = sinfo.cols.map(c => c.name)
    const out = []
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const d = {}
      for (let c = range.s.c; c <= range.e.c; c++) {
        const k = c - range.s.c
        if (k >= cols.length) break
        d[cols[k]] = this._cellVal(ws[colLetter(c) + String(r + 1)])
      }
      out.push(d)
    }
    return out
  }

  _matchedIdxes(sheet, where, cols) {
    const key = sheet + '|' + JSON.stringify(where)
    if (this._filterCache.has(key)) return this._filterCache.get(key)
    const arr = this._allRows(sheet)
    const out = []
    for (let i = 0; i < arr.length; i++) {
      if (nodes.itemMatches(arr[i], where, cols)) out.push(i)
    }
    if (this._filterCache.size > 16) this._filterCache.clear()
    this._filterCache.set(key, out)
    return out
  }

  rootNode() {
    const m = this._ensureMeta()
    const keys = m.sheetnames.map(name => {
      const cnt = (m.sheets[name] || {}).count || 0
      return { name, type: 'array', preview: `Array(${cnt})`, clickable: true }
    })
    return { type: 'object', count: keys.length, keys }
  }

  node(path) {
    const m = this._ensureMeta()
    const segs = parsePath(path)
    if (!segs.length) return this.rootNode()
    const sheet = segs[0]
    const sinfo = m.sheets[sheet]
    if (!sinfo) return { type: 'scalar', value: null, vtype: 'null' }
    if (segs.length === 1) {
      return { type: 'array', count: sinfo.count, cols: sinfo.cols }
    }
    if (typeof segs[1] === 'number') {
      const rows = this._rows(sheet, 1, segs[1])
      if (rows.length) return nodes.nodeInfo(rows[0])
      return { type: 'scalar', value: null, vtype: 'null' }
    }
    return { type: 'scalar', value: null, vtype: 'null' }
  }

  page(path, limit, offset, where, extraCols) {
    const m = this._ensureMeta()
    const segs = parsePath(path)
    if (!segs.length || typeof segs[0] !== 'string') {
      return { rows: [], total: 0, cols: [], limit, offset, path }
    }
    const sheet = segs[0]
    const sinfo = m.sheets[sheet]
    if (!sinfo) {
      return { rows: [], total: 0, cols: [], limit, offset, path }
    }
    const cols = sinfo.cols.concat(extraCols || [])
    const hasFilter = where && Object.keys(where).some(k => String(where[k] || '').trim())
    if (hasFilter) {
      const idxes = this._matchedIdxes(sheet, where, cols)
      const total = idxes.length
      const sel = idxes.slice(offset, offset + limit)
      const all = this._allRows(sheet)
      const rows = sel.map(i => nodes.rowOf(all[i], cols, i))
      return { rows, total, cols, limit, offset, path, filtered: true }
    }
    const rowsRaw = this._rows(sheet, limit, offset)
    const rows = rowsRaw.map((r, k) => nodes.rowOf(r, cols, offset + k))
    const out = { rows, total: sinfo.count, cols, limit, offset, path }
    if (sinfo.rich) {
      out.rich = true
      out.merges = sinfo.merges
      out.cells = sinfo.cells
    }
    return out
  }

  record(path) {
    const m = this._ensureMeta()
    const segs = parsePath(path)
    if (!segs.length) {
      return {
        value: { __summary: 'object', sheets: m.sheetnames },
        type: 'object',
        truncated: false,
      }
    }
    if (typeof segs[0] === 'string') {
      const sinfo = m.sheets[segs[0]]
      if (!sinfo) return { value: null, type: 'null', truncated: false }
      if (segs.length === 1) {
        return { value: { __summary: 'array', count: sinfo.count }, type: 'array', truncated: false }
      }
      if (typeof segs[1] === 'number') {
        const rows = this._rows(segs[0], 1, segs[1])
        if (!rows.length) return { value: null, type: 'null', truncated: false }
        const rest = segs.slice(2)
        const val = rest.length ? nodes.resolve(rows[0], rest) : rows[0]
        return nodes.boundedRecord(val)
      }
    }
    return { value: null, type: 'null', truncated: false }
  }
}

module.exports = ExcelBackend
