/**
 * 数据查看大师 — preload
 * 暴露 window.services：view / record / openFile / getFileInfo
 */
const fs = require('node:fs')
const path = require('node:path')

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
        out.__opt = { cs: !!v.cs, re: !!v.re }
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

function closeHandle(filePath) {
  try {
    handles.delete(path.resolve(filePath))
  } catch { /* ignore */ }
}

window.services = {
  view,
  record,
  getFileInfo,
  isSupported,
  pickDataFile,
  closeHandle,
  SUPPORTED_EXTS,
  humanSize,
}
