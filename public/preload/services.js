/**
 * 数据查看大师 — preload
 * 暴露 window.services：view / record / suggest / pickDataFile / getFileInfo
 */
const fs = require('node:fs')
const path = require('node:path')

const nodes = require('./libs/nodes')
const { parsePath } = require('./libs/paths')
const JsonlBackend = require('./libs/backends/jsonl')
const JsonBackend = require('./libs/backends/json')
const CsvBackend = require('./libs/backends/csv')
const ExcelBackend = require('./libs/backends/excel')

const EXT_CATEGORY = {
  json: 'json',
  jsonl: 'jsonl',
  ndjson: 'jsonl',
  csv: 'csv',
  tsv: 'csv',
  xlsx: 'excel',
  xls: 'excel',
}

const SUPPORTED_EXTS = Object.keys(EXT_CATEGORY)

function fileCategory(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '')
  return EXT_CATEGORY[ext] || null
}

function humanSize(n) {
  if (n == null) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

// 句柄缓存：同一文件复用已建索引 / 已载入内容
const handles = new Map()

function getHandle(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('缺少文件路径')
  }
  const abs = path.resolve(filePath)
  let st
  try {
    st = fs.statSync(abs)
  } catch {
    throw new Error('文件不存在')
  }
  if (!st.isFile()) throw new Error('不是文件')
  const category = fileCategory(abs)
  if (!category) {
    throw new Error('不支持的文件类型，支持：' + SUPPORTED_EXTS.join(', '))
  }
  const mtime = Math.floor(st.mtimeMs / 1000)
  const existing = handles.get(abs)
  if (existing && existing.size === st.size && existing.mtime === mtime) {
    return existing
  }
  let backend
  if (category === 'jsonl') backend = new JsonlBackend(abs, st.size, mtime)
  else if (category === 'json') backend = new JsonBackend(abs, st.size, mtime)
  else if (category === 'csv') backend = new CsvBackend(abs, st.size, mtime)
  else if (category === 'excel') backend = new ExcelBackend(abs, st.size, mtime)
  else throw new Error('该类型暂未实现查看：' + category)
  backend.category = category
  backend.size = st.size
  backend.mtime = mtime
  backend.name = path.basename(abs)
  handles.set(abs, backend)
  // 只保留最近 4 个句柄，避免内存膨胀
  if (handles.size > 4) {
    const first = handles.keys().next().value
    if (first !== abs) handles.delete(first)
  }
  return backend
}

function cleanWhere(where) {
  if (!where || typeof where !== 'object') return null
  const out = {}
  let any = false
  for (const [k, v] of Object.entries(where)) {
    if (k === '__opt') {
      if (v && typeof v === 'object') {
        const o = { cs: !!v.cs, re: !!v.re }
        if (v.notByCol && typeof v.notByCol === 'object') {
          const nb = {}
          for (const [nk, nv] of Object.entries(v.notByCol)) {
            if (nv) nb[nk] = true
          }
          if (Object.keys(nb).length) o.notByCol = nb
        }
        out.__opt = o
      }
      continue
    }
    if (v == null) continue
    const s = String(v)
    if (!s.trim()) continue
    out[k] = s
    any = true
  }
  return any ? out : null
}

function cleanExtraCols(cols) {
  if (!Array.isArray(cols) || !cols.length) return []
  return cols
    .map(p => String(p || '').trim())
    .filter(Boolean)
    .map(p => ({ name: p, type: 'any', extract: p }))
}

function view(filePath, segPath, limit, offset, where, extraCols) {
  const b = getHandle(filePath)
  const node = b.node(segPath || '')
  let page = null
  if (node.type === 'array') {
    page = b.page(segPath || '', limit || 50, offset || 0, cleanWhere(where), cleanExtraCols(extraCols))
    if (page && page.cols) {
      node.cols = page.cols
    }
  }
  if (node.type === 'scalar' && node.message) {
    // keep message for frontend
  }
  return {
    file: filePath,
    category: b.category,
    name: b.name,
    size: b.size,
    path: segPath || '',
    node,
    page,
  }
}

function record(filePath, segPath) {
  const b = getHandle(filePath)
  return b.record(segPath || '')
}

function getFileInfo(filePath) {
  // 只做 stat，不构造 backend，避免大文件打开时 UI 假死
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('缺少文件路径')
  }
  const abs = path.resolve(filePath)
  let st
  try {
    st = fs.statSync(abs)
  } catch {
    throw new Error('文件不存在')
  }
  if (!st.isFile()) throw new Error('不是文件')
  const category = fileCategory(abs)
  if (!category) {
    throw new Error('不支持的文件类型，支持：' + SUPPORTED_EXTS.join(', '))
  }
  return {
    file: abs,
    category,
    name: path.basename(abs),
    size: st.size,
    sizeText: humanSize(st.size),
  }
}

function isSupported(filePath) {
  try {
    return !!fileCategory(filePath)
  } catch {
    return false
  }
}

function pickDataFile() {
  if (!window.utools || !window.utools.showOpenDialog) {
    throw new Error('需要在 uTools 中运行')
  }
  const files = window.utools.showOpenDialog({
    title: '选择数据文件',
    properties: ['openFile'],
    filters: [
      { name: '数据文件', extensions: SUPPORTED_EXTS },
      { name: 'JSON', extensions: ['json'] },
      { name: 'JSONL / NDJSON', extensions: ['jsonl', 'ndjson'] },
      { name: 'CSV / TSV', extensions: ['csv', 'tsv'] },
      { name: 'Excel', extensions: ['xlsx', 'xls'] },
    ],
  })
  if (!files || !files.length) return null
  return files[0]
}

function cleanExtraCols(cols) {
  if (!Array.isArray(cols) || !cols.length) return []
  return cols
    .map(p => String(p || '').trim())
    .filter(Boolean)
    .map(p => ({ name: p, type: 'any', extract: p }))
}

/**
 * 提取字段·路径自动补全建议。
 * 相对表格视图(segPath)逐行解析:输入 "user." → 各行 user 的子键并集;
 * 输入 "user.na" → 同上并按 na 过滤。行内是数组值时提示 "[0]"。
 * 结果按 (文件,segPath,input) 缓存,连续击键/重复弹层直接复用。
 * 返回 { before, typed, items:[{name,type,len?}] }
 */
const suggestCache = new Map()

function suggest(filePath, segPath, input) {
  const key = filePath + '|' + (segPath || '') + '|' + input
  if (suggestCache.has(key)) {
    // 句柄按 size+mtime 失效,建议缓存须同步失效(文件变化后建议不能是旧的)
    const hit = suggestCache.get(key)
    if (hit && hit._sig) {
      const b = getHandle(filePath)
      if (b.size === hit._sig.size && b.mtime === hit._sig.mtime) return hit
      suggestCache.clear()
    } else {
      return hit
    }
  }
  const res = _suggest(filePath, segPath, input)
  const b2 = getHandle(filePath)
  res._sig = { size: b2.size, mtime: b2.mtime }
  if (suggestCache.size > 128) suggestCache.clear()
  suggestCache.set(key, res)
  return res
}

function _suggest(filePath, segPath, input) {
  const b = getHandle(filePath)
  const s = String(input == null ? '' : input)
  const lastChar = s.length ? s[s.length - 1] : ''
  let before, typed
  if (lastChar === '.') {
    before = s
    typed = ''
  } else if (typedHasUnclosedBracket(s)) {
    // 用户正输入索引("tags[0"),不提示
    return { before: s, typed: '[', items: [] }
  } else {
    // "user.na" → before="user.", typed="na"
    let idx = -1
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] === '.') { idx = i; break }
    }
    before = idx >= 0 ? s.slice(0, idx + 1) : ''
    typed = idx >= 0 ? s.slice(idx + 1) : s
  }

  // segPath 的行样本
  let items = b.sampleItems(segPath || '', nodes.SAMPLE_N)
  if (!Array.isArray(items)) items = []

  // 按已输入前缀逐行 resolve(nodes.resolve 语义:对象取键,数组取下标)
  if (before) {
    // 去掉尾随 '.' — parsePath 会把它当空段
    const basePath = before.replace(/\.+$/, '')
    const segs = basePath ? parsePath(basePath) : []
    if (segs.length) {
      const vals = []
      for (const it of items.slice(0, nodes.SAMPLE_N)) {
        if (it == null) continue
        const v = nodes.resolve(it, segs)
        if (v !== null && v !== undefined) vals.push(v)
      }
      items = vals
    }
  }

  // 候选 keys
  const seen = new Set()
  const cands = []
  for (const it of items.slice(0, nodes.SAMPLE_N)) {
    if (!it) continue
    if (Array.isArray(it)) {
      if (it.length && !seen.has('[0]')) {
        seen.add('[0]')
        cands.push({ name: '[0]', type: 'array', len: it.length })
      }
      continue
    }
    if (it && typeof it === 'object') {
      for (const [k, v] of Object.entries(it)) {
        if (seen.has(k)) continue
        seen.add(k)
        cands.push({ name: k, type: nodes.typeName(v) })
      }
    }
  }
  if (typed) {
    const t = typed.toLowerCase()
    for (const c of cands) if (c.name.toLowerCase().indexOf(t) === -1) c.__muted = true
  }
  return { before, typed, items: cands.filter(c => !c.__muted).slice(0, 50) }
}

// 输入里有未闭合的 '['（索引段书写中）→ 不提示
function typedHasUnclosedBracket(s) {
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === ']') return false
    if (s[i] === '[') return true
  }
  return false
}

function closeHandle(filePath) {
  try {
    handles.delete(path.resolve(filePath))
  } catch { /* ignore */ }
}

window.services = {
  view,
  record,
  getFileInfo,
  suggest,
  isSupported,
  pickDataFile,
  closeHandle,
  SUPPORTED_EXTS,
  humanSize,
}
