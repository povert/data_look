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
 * 匹配核心 —— 与参考实现 scripts/filter_ref.py 行为一致（用户勾选的"正确语义"）。
 *  - 值统一用 pyStr() 字符串化（list/dict 取 Python repr 格式：含逗号后空格、单引号；
 *    bool -> True/False；顶层 null -> ''），而非递归叶子匹配 —— 这样 errors=[] 能被
 *    `\[\]` 命中、值里的 [ ] / { } 括号也可被正则匹配，与 Python str() 一致。
 *  - 空值搜索用 Python 真值（null / 0 / 0.0 / False / '' / [] / {} 均视为"空"）。
 *      UI 约定：留空框 = 该列不筛选；输入 "" / '' / ∅ = 找空值（对应 Python search=None/''）。
 *  - 不区分大小写(cs=false)时，仅把 value 转小写、search 保持原样 —— 与 Python 一致
 *      （Python `re.compile(search)` 不加 re.I，只对 parten 做 .lower()）。注意：大小写不敏感
 *      时若搜索词含大写字母，需小写才能命中（Python 的同款行为）。
 *  - 反向(!)：每个筛选框各自取反后按 AND 组合。__opt.notByCol[key] 为真则该框"不匹配"才命中。
 *  where.__opt = { cs: 区分大小写, re: 正则, notByCol: {key: true} }；非法正则回退为字面子串。
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function pyNum(n) {
  if (Number.isNaN(n)) return 'nan'
  if (n === Infinity) return 'inf'
  if (n === -Infinity) return '-inf'
  if (Number.isInteger(n)) return String(n)
  return String(n) // 与 Python str(1.5) 一致；整数浮点如 1.0 会得 '1'（罕见, 可接受）
}

// Python 字符串 repr 的选引号启发式：含 ' 但不含 " 时用 " 包裹，否则用 ' 包裹并转义 '
function pyQuote(s) {
  if (s.indexOf("'") !== -1 && s.indexOf('"') === -1) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
  }
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

// 容器内部元素用 repr（字符串加引号、None -> 'None' 等）
function pyRepr(v) {
  if (v == null) return 'None' // 容器内 None；顶层 None 由 pyStr 转为 ''
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return pyNum(v)
  if (typeof v === 'string') return pyQuote(v)
  if (Array.isArray(v)) return '[' + v.map(pyRepr).join(', ') + ']'
  if (typeof v === 'object') {
    return '{' + Object.keys(v).map(k => pyRepr(k) + ': ' + pyRepr(v[k])).join(', ') + '}'
  }
  return String(v)
}

// 顶层 str()：None -> ''（与参考的 `if parten is None: parten = ''` 一致）;
// list/dict 的 str 与 repr 相同；string 为其自身；bool -> True/False。
function pyStr(v) {
  if (v == null) return ''
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return pyNum(v)
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return '[' + v.map(pyRepr).join(', ') + ']'
  if (typeof v === 'object') {
    return '{' + Object.keys(v).map(k => pyRepr(k) + ': ' + pyRepr(v[k])).join(', ') + '}'
  }
  return String(v)
}

// Python 真值：null/0/0.0/False/''/[]/{} 为假，其余为真（与 `not parten` 等价）
function pyTruthy(v) {
  if (v == null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return !!v
}

/** 空值查询 token：输入 "" / '' / ∅ 表示"找空值"（对应 Python search=None/''） */
function isEmptyToken(q) {
  const s = String(q == null ? '' : q).trim()
  return s === '""' || s === "''" || s === '∅'
}

// 单框单值"是否命中"（不含反向；反向由 itemMatches 用 neg 套用）。
// 空值搜索：is_ex=false -> 命中空值；is_ex=true(由 neg 体现) -> 命中非空值。
// 非空搜索：子串/正则搜 pyStr(value)；大小写不敏感时只把 value 转小写、search 保持原样。
function valueHits(value, search, opt) {
  if (isEmptyToken(search)) return !pyTruthy(value)
  const s = pyStr(value)
  const ci = !opt || !opt.cs
  // 不区分大小写：value 与 search 都转小写后比较（修正：搜索词也要小写，避免大写 pattern 在小写 haystack 里漏匹配）
  const hay = ci ? s.toLowerCase() : s
  const needle = ci ? String(search).toLowerCase() : search
  if (opt && opt.re) {
    try {
      return new RegExp(needle).test(hay) // 待搜串已全小写，pattern 无需 'i' 旗标
    } catch {
      return hay.indexOf(needle) !== -1 // 非法正则回退为字面子串
    }
  }
  return hay.indexOf(needle) !== -1
}

function itemMatches(item, where, cols) {
  if (!where) return true
  const opt = where.__opt || {}
  // 按筛选框({列名}/"*" 全局)各自取反：notByCol[key] 为真则该框"不匹配"才命中
  const notByCol = opt.notByCol || {}
  const nameMap = {}
  for (const c of cols) nameMap[c.name] = c
  // 全局 '*'：与 Python 一致 —— 任一顶层 key 的值(pyStr)命中即保留
  const gq = where['*']
  if (gq != null && String(gq).trim()) {
    const neg = !!notByCol['*']
    let hit = false
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const k of Object.keys(item)) {
        if (valueHits(item[k], gq, opt)) { hit = true; break }
      }
    } else {
      hit = valueHits(item, gq, opt)
    }
    if (neg ? hit : !hit) return false
  }
  // 逐列(各自可反向),AND 组合
  for (const [k, v] of Object.entries(where)) {
    if (k === '*' || k === '__opt' || v == null || !String(v).trim()) continue
    const neg = !!notByCol[k]
    const c = nameMap[k]
    const val = c ? colValue(item, c) : null
    const hit = valueHits(val, v, opt)
    if (neg ? hit : !hit) return false
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
