/** 节点模型:类型推断、单元格表示、筛选、记录截断 */

const { parsePath } = require('./paths')

const SAMPLE_N = 200
const CELL_STR_LIMIT = 300
const RECORD_BYTE_LIMIT = 256 * 1024

function resolve(obj, segs) {
  let cur = obj
  for (const s of segs) {
    if (cur == null) return null
    if (typeof s === 'number' && Number.isInteger(s)) {
      if (Array.isArray(cur) && s >= 0 && s < cur.length) cur = cur[s]
      else return null
    } else if (typeof cur === 'object' && !Array.isArray(cur)) {
      cur = cur[s]
    } else {
      return null
    }
  }
  return cur
}

function typeName(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'string') return 'string'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'object') return 'object'
  return 'string'
}

function truncate(s, n = 120) {
  s = String(s)
  return s.length <= n ? s : s.slice(0, n) + '…'
}

function previewOf(v) {
  if (Array.isArray(v)) return `Array(${v.length})`
  if (v && typeof v === 'object') return 'Object'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (v == null) return 'null'
  try {
    return truncate(JSON.stringify(v), 120)
  } catch {
    return truncate(String(v), 120)
  }
}

function unionKeys(items) {
  const keys = []
  const seen = new Set()
  for (const it of items.slice(0, SAMPLE_N)) {
    if (it && typeof it === 'object' && !Array.isArray(it)) {
      for (const k of Object.keys(it)) {
        if (!seen.has(k)) { seen.add(k); keys.push(k) }
      }
    }
  }
  return keys
}

function inferCols(items) {
  const keys = unionKeys(items)
  if (!keys.length) {
    const t = items.length ? typeName(items[0]) : 'null'
    return [{ name: 'value', type: t }]
  }
  const cols = []
  for (const k of keys) {
    let t = null
    for (const it of items.slice(0, SAMPLE_N)) {
      if (it && typeof it === 'object' && !Array.isArray(it) && k in it && it[k] != null) {
        const vt = typeName(it[k])
        t = t === null ? vt : (t === vt ? vt : 'mixed')
        if (t === 'mixed') break
      }
    }
    cols.push({ name: k, type: t || 'null' })
  }
  return cols
}

function cellRepr(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return { __c: 'object', p: previewOf(v) }
  }
  if (Array.isArray(v)) {
    return { __c: 'array', len: v.length, p: previewOf(v) }
  }
  if (typeof v === 'string' && v.length > CELL_STR_LIMIT) {
    return { __s: v.slice(0, CELL_STR_LIMIT), __trunc: true, len: v.length }
  }
  if (v === undefined) return null
  return v
}

function colValue(item, c) {
  if (c.extract) return resolve(item, parsePath(c.extract))
  if (item && typeof item === 'object' && !Array.isArray(item)) return item[c.name]
  return c.name === 'value' ? item : null
}

function rowOf(item, cols, idx) {
  const row = { _idx: idx }
  for (const c of cols) {
    row[c.name] = cellRepr(colValue(item, c))
  }
  return row
}

function cellStr(v) {
  if (v == null) return ''
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(v)
}

/**
 * 子串/正则匹配。
 * where.__opt = { cs: 区分大小写, re: 正则 }；非法正则回退为字面子串。
 */
function compileQuery(q, opt) {
  const s = String(q)
  const cs = !!(opt && opt.cs)
  const re = !!(opt && opt.re)
  if (re) {
    try {
      return { re: new RegExp(s, cs ? '' : 'i') }
    } catch {
      // fall through to literal
    }
  }
  const needle = cs ? s : s.toLowerCase()
  return { lit: needle, cs }
}

function textMatches(text, compiled) {
  const t = String(text == null ? '' : text)
  if (compiled.re) return compiled.re.test(t)
  const hay = compiled.cs ? t : t.toLowerCase()
  return hay.includes(compiled.lit)
}

/** 空值查询 token：输入 "" 或 '' 或 ∅ 匹配 null / 空串 / 空数组 / 空对象 */
function isEmptyToken(q) {
  const s = String(q == null ? '' : q).trim()
  return s === '""' || s === "''" || s === '∅'
}

function isEmptyVal(v) {
  if (v == null) return true
  if (typeof v === 'string' && v === '') return true
  if (Array.isArray(v) && v.length === 0) return true
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return true
  return false
}

function queryHits(textOrVal, q, opt) {
  if (isEmptyToken(q)) return isEmptyVal(textOrVal)
  return textMatches(cellStr(textOrVal), compileQuery(q, opt))
}

function itemMatches(item, where, cols) {
  if (!where) return true
  const opt = where.__opt || {}
  const nameMap = {}
  for (const c of cols) nameMap[c.name] = c
  const gq = where['*']
  if (gq && String(gq).trim()) {
    if (!queryHits(item, gq, opt)) return false
  }
  for (const [k, v] of Object.entries(where)) {
    if (k === '*' || k === '__opt' || v == null || !String(v).trim()) continue
    const c = nameMap[k]
    const val = c ? colValue(item, c) : null
    if (!queryHits(val, v, opt)) return false
  }
  return true
}

function nodeInfo(val) {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const keys = []
    for (const [k, v] of Object.entries(val)) {
      keys.push({
        name: String(k),
        type: typeName(v),
        preview: previewOf(v),
        clickable: (v && typeof v === 'object') || Array.isArray(v),
      })
    }
    return { type: 'object', keys, count: keys.length }
  }
  if (Array.isArray(val)) {
    return { type: 'array', count: val.length, cols: inferCols(val) }
  }
  return { type: 'scalar', value: val === undefined ? null : val, vtype: typeName(val) }
}

function boundedRecord(val) {
  const t = typeName(val)
  let s
  try { s = JSON.stringify(val) } catch { s = String(val) }
  if ((typeof val === 'object' || Array.isArray(val)) && val != null && s.length > RECORD_BYTE_LIMIT) {
    return {
      value: { __truncated: true, bytes: s.length, preview: s.slice(0, RECORD_BYTE_LIMIT) },
      type: t,
      truncated: true,
    }
  }
  return { value: val === undefined ? null : val, type: t, truncated: false }
}

module.exports = {
  SAMPLE_N,
  CELL_STR_LIMIT,
  RECORD_BYTE_LIMIT,
  resolve,
  typeName,
  previewOf,
  unionKeys,
  inferCols,
  cellRepr,
  colValue,
  rowOf,
  cellStr,
  itemMatches,
  nodeInfo,
  boundedRecord,
}
