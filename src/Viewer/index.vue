<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import DataModal from './DataModal.vue'

const props = defineProps({
  enterAction: { type: Object, default: () => ({}) },
})

const file = ref(null)
const node = ref(null)
const page = ref(null)
const fnameRef = ref(null)
const loading = ref(false)
// 仅打开文件/钻取等重操作显示全屏加载；翻页/筛选静默，避免闪烁
const heavyLoad = ref(false)
const error = ref('')
const loadSecs = ref(0)
let loadTimer = null

const segs = ref([])
const limit = ref(50)
const offset = ref(0)
const where = reactive({})
const extraPaths = ref([])
const hidden = ref(new Set())

const extInput = ref('')
const showColPop = ref(false)
const colPopEl = ref(null)
const tableWrap = ref(null)
const editPathMode = ref(false)
const editPathValue = ref('')
const editPathEl = ref(null)

// 全局搜索选项：区分大小写 / 正则（对全局 + 所有列筛选生效）
const searchOpts = reactive({ cs: false, re: false })

const modal = reactive({
  open: false,
  loading: false,
  error: '',
  title: '原始内容',
  pathLabel: '',
  value: null,
  valueType: '',
  truncated: false,
  comment: '',
  link: '',
  segs: null,
})

const selState = reactive({
  down: false,
  active: false,
  dragMoved: false,
  r0: 0, c0: 0, r1: 0, c1: 0,
  sx: 0, sy: 0,
})

const toast = reactive({ show: false, msg: '' })
let toastTimer = null

function services() {
  if (!window.services) throw new Error('preload 未加载，请在 uTools 中打开本插件')
  return window.services
}

function parsePath(s) {
  s = String(s || '').trim()
  const out = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '.') { i++; continue }
    if (c === '[') {
      const j = s.indexOf(']', i)
      if (j === -1) { out.push(s.slice(i)); break }
      out.push(parseInt(s.slice(i + 1, j), 10))
      i = j + 1
      continue
    }
    let j = i
    while (j < s.length && s[j] !== '.' && s[j] !== '[') j++
    out.push(s.slice(i, j))
    i = j
  }
  return out
}

function serializePath(list) {
  const parts = []
  for (const s of list) {
    if (typeof s === 'number') parts.push(`[${s}]`)
    else {
      if (parts.length) parts.push('.')
      parts.push(String(s))
    }
  }
  return parts.join('')
}

function typeIcon(t) {
  return ({ object: '{}', array: '[ ]', string: '“”', number: '#', boolean: '◆', null: '∅' })[t] || '•'
}

function typeLabel(cat) {
  return ({ json: 'JSON', jsonl: 'JSONL', csv: 'CSV', excel: 'Excel' })[cat] || cat || ''
}

function humanSize(n) {
  if (n == null) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

function resetColState() {
  for (const k of Object.keys(where)) delete where[k]
  extraPaths.value = []
  hidden.value = new Set()
  offset.value = 0
  editPathMode.value = false
  clearSel()
}

function stopTimer() {
  if (loadTimer) { clearInterval(loadTimer); loadTimer = null }
}

function cleanWhere() {
  const out = {}
  let any = false
  for (const [k, v] of Object.entries(where)) {
    if (v != null && String(v).trim()) {
      out[k] = String(v)
      any = true
    }
  }
  if (any || searchOpts.cs || searchOpts.re) {
    out.__opt = { cs: searchOpts.cs, re: searchOpts.re }
  }
  return any ? out : null
}

async function load(opts) {
  if (!file.value) return
  const heavy = !!(opts && opts.heavy)
  heavyLoad.value = heavy
  loading.value = true
  error.value = ''
  stopTimer()
  loadSecs.value = 0
  if (heavy) {
    loadTimer = setInterval(() => { loadSecs.value += 1 }, 1000)
  }
  clearSel()
  // 重操作先渲染盖层再干活；轻量翻页不闪盖层
  if (heavy) {
    await nextTick()
    await new Promise(r => setTimeout(r, 16))
  }
  try {
    const data = services().view(
      file.value.file,
      serializePath(segs.value),
      limit.value,
      offset.value,
      cleanWhere(),
      extraPaths.value.slice(),
    )
    node.value = data.node
    page.value = data.page
    await nextTick()
    ensureResizeWatch()
    markTruncated()
  } catch (e) {
    error.value = e.message || String(e)
    node.value = null
    page.value = null
  } finally {
    stopTimer()
    loading.value = false
  }
}

function openFile(path, opts) {
  opts = opts || {}
  try {
    const info = services().getFileInfo(path)
    file.value = info
    segs.value = opts.segs ? opts.segs.slice() : []
    resetColState()
    if (opts.where) Object.assign(where, opts.where)
    load({ heavy: true })
  } catch (e) {
    error.value = e.message || String(e)
    file.value = null
    node.value = null
    page.value = null
  }
}

function handleOpenDialog() {
  try {
    const p = services().pickDataFile()
    if (!p) return
    openFile(p)
  } catch (e) {
    error.value = e.message || String(e)
  }
}

/* ---- 拖拽打开文件 ---- */
const dragOver = ref(false)
let dragDepth = 0

const DROP_EXTS = new Set(['json', 'jsonl', 'ndjson', 'csv', 'tsv', 'xlsx', 'xls'])

function filePathOfDropped(file) {
  if (!file) return ''
  // Electron / uTools：File 上带绝对路径
  if (file.path) return String(file.path)
  // 新版 Chromium
  try {
    if (typeof window.webUtils?.getPathForFile === 'function') {
      const p = window.webUtils.getPathForFile(file)
      if (p) return String(p)
    }
  } catch { /* ignore */ }
  // uTools 兼容
  try {
    if (typeof window.utools?.getFileSystemPath === 'function') {
      const p = window.utools.getFileSystemPath(file)
      if (p) return String(p)
    }
  } catch { /* ignore */ }
  return ''
}

function isSupportedDropPath(p) {
  const ext = String(p).split('.').pop().toLowerCase()
  return DROP_EXTS.has(ext)
}

function onDragEnter(e) {
  e.preventDefault()
  dragDepth += 1
  if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
    dragOver.value = true
  }
}

function onDragOver(e) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragOver.value = true
}

function onDragLeave(e) {
  e.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragOver.value = false
}

function onDrop(e) {
  e.preventDefault()
  dragDepth = 0
  dragOver.value = false
  const files = e.dataTransfer?.files
  if (!files || !files.length) return
  const f = files[0]
  const p = filePathOfDropped(f)
  if (!p) {
    error.value = '无法获取文件路径，请改用「打开文件」选择'
    return
  }
  if (!isSupportedDropPath(p)) {
    error.value = '不支持的文件类型，支持：json / jsonl / csv / tsv / xlsx / xls'
    return
  }
  openFile(p)
}

function navigateTo(list) {
  segs.value = list.slice()
  resetColState()
  load({ heavy: true })
}

function back() {
  if (segs.value.length) navigateTo(segs.value.slice(0, -1))
}

function goRoot() {
  navigateTo([])
}

function enterEditPath() {
  editPathValue.value = serializePath(segs.value)
  editPathMode.value = true
  nextTick(() => {
    if (editPathEl.value) {
      editPathEl.value.focus()
      editPathEl.value.select()
    }
  })
}

function commitEditPath() {
  const v = (editPathValue.value || '').trim()
  editPathMode.value = false
  if (v !== serializePath(segs.value)) {
    navigateTo(parsePath(v))
  }
}

function cancelEditPath() {
  editPathMode.value = false
}

function toggleSearchOpt(key) {
  searchOpts[key] = !searchOpts[key]
  offset.value = 0
  // 有任意筛选词时立刻重查（全局 + 所有列共用同一套 cs/re）
  if (cleanWhere()) load()
}

const searchOptHint = computed(() => {
  const scope = '全局 + 所有列筛选 + 单元格弹窗'
  if (searchOpts.cs && searchOpts.re) return `区分大小写 · 正则 · 作用于${scope}`
  if (searchOpts.cs) return `区分大小写 · 作用于${scope}`
  if (searchOpts.re) return `正则匹配 · 作用于${scope}`
  return `不区分大小写 · 子串匹配 · 作用于${scope}`
})

const colFilterPlaceholder = computed(() => {
  if (searchOpts.re && searchOpts.cs) return '筛选·正则·区分大小写(回车)'
  if (searchOpts.re) return '筛选·正则(回车；"" 空值)'
  if (searchOpts.cs) return '筛选·区分大小写(回车；"" 空值)'
  return '筛选(回车；"" 空值)…'
})

const globalSearchPlaceholder = computed(() => {
  if (searchOpts.re && searchOpts.cs) return '全局·正则·区分大小写(回车)'
  if (searchOpts.re) return '全局搜索·正则(回车)'
  if (searchOpts.cs) return '全局搜索·区分大小写(回车)'
  return '全局搜索（回车；"" 空值）'
})

function setLimit(v) {
  limit.value = parseInt(v, 10) || 50
  offset.value = 0
  load()
}

function goPageOffset(off) {
  offset.value = Math.max(0, off)
  load()
}

function goPageNum(v) {
  const p = Math.max(1, parseInt(v, 10) || 1)
  offset.value = (p - 1) * limit.value
  load()
}

function setColFilter(name, val) {
  where[name] = val
  offset.value = 0
}

function setGlobal(val) {
  where['*'] = val
  offset.value = 0
}

function filterKey(e, name) {
  if (e.key === 'Enter') {
    e.preventDefault()
    load()
  } else if (e.key === 'Escape') {
    where[name] = ''
    e.target.value = ''
    load()
  }
}

function clearFilters() {
  for (const k of Object.keys(where)) delete where[k]
  offset.value = 0
  load()
}

function hideCol(name) {
  const s = new Set(hidden.value)
  s.add(name)
  hidden.value = s
  nextTick(() => markTruncated())
}

function toggleCol(name) {
  const s = new Set(hidden.value)
  if (s.has(name)) s.delete(name)
  else s.add(name)
  hidden.value = s
  nextTick(() => markTruncated())
}

function showAllCols() {
  hidden.value = new Set()
  nextTick(() => markTruncated())
}

function addExtractPath(p) {
  p = String(p || '').trim()
  if (!p) return
  if (!extraPaths.value.includes(p)) extraPaths.value = [...extraPaths.value, p]
  offset.value = 0
  load()
}

function removeExtract(p) {
  extraPaths.value = extraPaths.value.filter(x => x !== p)
  delete where[p]
  offset.value = 0
  load()
}

function extEnterBar(e) {
  if (e.key !== 'Enter') return
  e.preventDefault()
  addExtractPath(extInput.value)
  extInput.value = ''
}

function toggleColPopover(e) {
  e && e.stopPropagation()
  showColPop.value = !showColPop.value
}

function flatten(s) {
  return String(s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function trunc(s, n) {
  s = String(s)
  return s.length <= n ? s : s.slice(0, n) + '…'
}

const DISPLAY_TRUNC = 80
/** 保底：显示宽度（汉字算 2）≥ 该值即可点开看全文 */
const EXPAND_WIDTH = 38

/** 显示宽度：汉字/全角算 2，其余算 1 */
function displayWidth(s) {
  s = String(s == null ? '' : s)
  let w = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    // CJK、全角、常见中文标点
    if (
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xff00 && c <= 0xffef) ||
      (c >= 0x3000 && c <= 0x303f)
    ) {
      w += 2
    } else {
      w += 1
    }
  }
  return w
}

/** 单元格原文（用于像素测宽；不要用已截断的显示文案） */
function fullTextOf(v) {
  if (v && typeof v === 'object' && '__c' in v) return String(v.p || '')
  if (v && typeof v === 'object' && '__s' in v) return flatten(String(v.__s || ''))
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return flatten(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return String(v) }
}

/** 可点开：对象标记，或显示宽度 ≥38（汉字×2） */
function isExpandable(v) {
  if (v && typeof v === 'object' && ('__c' in v || '__s' in v)) return true
  if (typeof v === 'string' && v !== '') {
    return displayWidth(flatten(v)) >= EXPAND_WIDTH
  }
  return false
}

/** 点击时现场判断是否被裁切（不依赖事前标记，窗口/布局变化后仍准） */
function isVisuallyTruncated(td) {
  if (!td) return false
  if (td.getAttribute('data-cell')) return true
  const clip = td.querySelector('.cell-clip')
  if (clip && clip.scrollWidth > clip.clientWidth + 1) return true
  if (td.scrollWidth > td.clientWidth + 1) return true
  return false
}

function onCellClick(e, row, col) {
  if (selState.dragMoved) {
    selState.dragMoved = false
    return
  }
  if (!isExpandable(row[col.name]) && !isVisuallyTruncated(e.target.closest('td'))) {
    return
  }
  openModal(parsePath(cellClickPath(row, col)))
}

function onRichCellClick(e, row, col) {
  if (selState.dragMoved) {
    selState.dragMoved = false
    return
  }
  const deco = cellDeco(row, col.name)
  const link = deco && deco.link
  const expandable =
    isExpandable(row[col.name]) ||
    !!link ||
    !!(deco && deco.comment) ||
    isVisuallyTruncated(e.target.closest('td'))
  if (!expandable) return
  openModal(parsePath(cellClickPath(row, col)), {
    link: link || '',
    comment: cellCommentOf(row, col.name),
  })
}

const visibleCols = computed(() => {
  const h = hidden.value
  return (node.value?.cols || []).filter(c => !h.has(c.name))
})

const totalPages = computed(() => {
  const total = page.value?.total || 0
  return Math.max(1, Math.ceil(total / limit.value))
})

const curPageNum = computed(() => Math.floor(offset.value / limit.value) + 1)

const isRichTable = computed(() => !!(page.value && page.value.rich))

function cellClickPath(row, col) {
  return serializePath(segs.value.concat([row._idx, col.name]))
}

function rowClickPath(row) {
  return serializePath(segs.value.concat([row._idx]))
}

async function openModal(segsList, opts) {
  opts = opts || {}
  if (selState.dragMoved) {
    selState.dragMoved = false
    return
  }
  modal.open = true
  modal.loading = true
  modal.error = ''
  modal.segs = segsList.slice()
  modal.pathLabel = serializePath(segsList) || '(根)'
  modal.value = null
  modal.valueType = ''
  modal.truncated = false
  modal.comment = opts.comment || ''
  modal.link = opts.link || ''
  try {
    const data = services().record(file.value.file, serializePath(segsList))
    modal.value = data.value
    modal.valueType = data.type
    modal.truncated = !!data.truncated
    modal.title = (data.type === 'array' || data.type === 'object') ? '原始内容 · 折叠树' : '单元格内容'
  } catch (e) {
    modal.error = e.message || String(e)
  } finally {
    modal.loading = false
  }
}

function closeModal() {
  modal.open = false
}

function drillFromModal() {
  if (modal.segs && (modal.valueType === 'array' || modal.valueType === 'object')) {
    navigateTo(modal.segs.slice())
    closeModal()
  }
}

function cellCommentOf(row, colName) {
  if (!page.value || !page.value.rich || !page.value.cells) return ''
  const absC = (node.value?.cols || []).findIndex(c => c.name === colName)
  if (absC < 0) return ''
  const d = page.value.cells[`${row._idx},${absC}`]
  return (d && d.comment) || ''
}

function cellDeco(row, colName) {
  if (!page.value || !page.value.rich || !page.value.cells) return null
  const absC = (node.value?.cols || []).findIndex(c => c.name === colName)
  if (absC < 0) return null
  return page.value.cells[`${row._idx},${absC}`] || null
}

/**
 * 截断检测：以单元格内层 .cell-clip 的固定裁切区为准。
 * 1) clip.scrollWidth > clientWidth → 必被 CSS 裁切
 * 2) canvas 按真实字体量「原文」宽 vs clip 可用宽（窗口缩放后仍准）
 */
function markTruncated() {
  const host = tableWrap.value
  if (!host) return
  requestAnimationFrame(() => {
    if (!tableWrap.value) return
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    tableWrap.value.querySelectorAll('td[data-cp]').forEach(td => {
      const cp = td.getAttribute('data-cp')
      if (!cp) return
      const full = td.getAttribute('data-full')
      if (full == null || full === '') {
        td.removeAttribute('data-cell')
        return
      }
      const clip = td.querySelector('.cell-clip')
      if (clip) {
        if (clip.scrollWidth > clip.clientWidth + 1) {
          td.setAttribute('data-cell', cp)
          return
        }
        const cs = getComputedStyle(clip)
        try {
          ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
          const w = ctx.measureText(full).width
          const avail = clip.clientWidth
          if (avail > 0 && w > avail - 2) {
            td.setAttribute('data-cell', cp)
            return
          }
        } catch { /* ignore */ }
        td.removeAttribute('data-cell')
        return
      }
      if (td.scrollWidth > td.clientWidth + 1) {
        td.setAttribute('data-cell', cp)
      }
    })
  })
}

let resizeObs = null
function ensureResizeWatch() {
  if (typeof ResizeObserver === 'undefined') return
  if (!resizeObs) {
    resizeObs = new ResizeObserver(() => markTruncated())
  }
  if (tableWrap.value) resizeObs.observe(tableWrap.value)
}

/**
 * 文件名自适应字号：太长先缩字号(16→14→12)尽量显示全，仍超则保持 ellipsis 截断。
 * 下限 12px 保证可读；过长 hover title 看全名。
 */
function autoFitFname() {
  const el = fnameRef.value
  if (!el) return
  el.style.fontSize = ''
  const steps = [16, 15, 14, 13, 12]
  for (const px of steps) {
    el.style.fontSize = px + 'px'
    if (el.scrollWidth <= el.clientWidth + 1) return
  }
  el.style.fontSize = '12px'
}

/* ---- Excel 富样式表格行列映射 ---- */
const richLayout = computed(() => {
  if (!isRichTable.value || !page.value) return null
  const all = node.value?.cols || []
  const cols = visibleCols.value
  const allNames = all.map(c => c.name)
  const visAbs = cols.map(c => allNames.indexOf(c.name))
  const off = offset.value
  const rows = page.value.rows || []
  const anchors = {}
  const occupied = new Set()
  for (const mg of (page.value.merges || [])) {
    const visCol = visAbs.indexOf(mg.c)
    if (visCol < 0) continue
    const cc = visAbs.filter(a => a >= mg.c && a <= mg.c1).length
    if (cc < 1) continue
    const rStart = Math.max(mg.r, off)
    const rEnd = Math.min(mg.r1, off + rows.length - 1)
    if (rEnd < rStart) continue
    const rIdx = rStart - off
    const ar = {
      rr: rEnd - rStart + 1,
      cc,
      cont: mg.r < off,
      val: mg.r < off ? mg.anchor_val : null,
      deco: (page.value.cells && page.value.cells[`${mg.r},${mg.c}`]) || null,
    }
    anchors[`${rIdx},${visCol}`] = ar
    for (let ri = 0; ri < ar.rr; ri++) {
      for (let ci = 0; ci < cc; ci++) {
        if (!(ri === 0 && ci === 0)) occupied.add(`${rIdx + ri},${visCol + ci}`)
      }
    }
  }
  return { visAbs, off, rows, anchors, occupied, cols, all }
})

function onTdMouseDown(e, ri, ci) {
  if (e.target.closest('input,textarea,.col-toggle')) return
  const td = e.target.closest('td[data-ri]')
  if (!td) return
  selState.down = true
  selState.dragMoved = false
  selState.active = false
  selState.r0 = selState.r1 = ri
  selState.c0 = selState.c1 = ci
  selState.sx = e.clientX
  selState.sy = e.clientY
  // 不用 preventDefault：避免干扰 click，改为 mousemove 超过阈值再进入拖选
}

function onTableMouseMove(e) {
  if (!selState.down) return
  if (!selState.dragMoved && Math.hypot(e.clientX - selState.sx, e.clientY - selState.sy) < 4) return
  selState.dragMoved = true
  selState.active = true
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const td = el && el.closest && el.closest('td[data-ri]')
  if (td && tableWrap.value && tableWrap.value.contains(td)) {
    const ri = parseInt(td.getAttribute('data-ri'), 10)
    const ci = parseInt(td.getAttribute('data-ci'), 10)
    if (ri >= 0 && ci >= 0) {
      selState.r1 = ri
      selState.c1 = ci
    }
  }
}

function onMouseUpGlobal() {
  if (!selState.down) return
  selState.down = false
  if (!selState.dragMoved) {
    if (selState.active) flashToast('已选 1 格 · Ctrl+C 复制')
    return
  }
  const n = selNorm()
  flashToast(`已选 ${n.r1 - n.r0 + 1} 行 × ${n.c1 - n.c0 + 1} 列 · Ctrl+C 复制`)
}

function selNorm() {
  return {
    r0: Math.min(selState.r0, selState.r1),
    r1: Math.max(selState.r0, selState.r1),
    c0: Math.min(selState.c0, selState.c1),
    c1: Math.max(selState.c0, selState.c1),
  }
}

function clearSel() {
  selState.active = false
  selState.dragMoved = false
  selState.down = false
}

function isCellSelected(ri, ci) {
  if (!selState.active) return false
  const n = selNorm()
  return ri >= n.r0 && ri <= n.r1 && ci >= n.c0 && ci <= n.c1
}

function flashToast(msg) {
  toast.show = true
  toast.msg = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.show = false }, 1600)
}

function cellTxt(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) } catch { return String(v) }
}

function cellHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function cellLinkOf(row, colName) {
  const deco = cellDeco(row, colName)
  return (deco && deco.link) || null
}

async function copySelection() {
  if (!selState.active) return
  const n = selNorm()
  const rows = page.value?.rows || []
  const cols = visibleCols.value
  const rLo = Math.max(0, n.r0)
  const rHi = Math.min(rows.length - 1, n.r1)
  const cLo = Math.max(0, n.c0)
  const cHi = Math.min(cols.length - 1, n.c1)
  if (rLo > rHi || cLo > cHi) return

  const mat = []
  for (let ri = rLo; ri <= rHi; ri++) {
    const row = rows[ri]
    const line = []
    for (let ci = cLo; ci <= cHi; ci++) {
      const col = cols[ci]
      const v = row[col.name]
      const link = cellLinkOf(row, col.name)
      if (v && typeof v === 'object' && ('__s' in v || '__c' in v)) {
        line.push({
          rpc: true,
          path: serializePath(segs.value.concat([row._idx, col.name])),
          link,
          val: '',
        })
      } else {
        line.push({ val: cellTxt(v), link })
      }
    }
    mat.push(line)
  }

  const tasks = []
  for (const ln of mat) {
    for (const c of ln) {
      if (c.rpc) {
        tasks.push(
          services().record(file.value.file, c.path).then(d => { c.val = cellTxt(d.value) }).catch(() => { c.val = '' })
        )
      }
    }
  }
  await Promise.all(tasks)

  const tsv = mat.map(ln => ln.map(c => String(c.val == null ? '' : c.val)).join('\t')).join('\n')
  const html = '<table>' + mat.map(ln =>
    '<tr>' + ln.map(c => '<td>' + (c.link
      ? `<a href="${String(c.link).replace(/"/g, '&quot;')}">${cellHtml(c.val)}</a>`
      : cellHtml(c.val)) + '</td>').join('') + '</tr>'
  ).join('') + '</table>'

  const okmsg = `已复制 ${rHi - rLo + 1} 行 × ${cHi - cLo + 1} 列`
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new window.ClipboardItem({
        'text/plain': new Blob([tsv], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })])
    } else {
      await navigator.clipboard.writeText(tsv)
    }
    flashToast(okmsg)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = tsv
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    try {
      document.execCommand('copy')
      flashToast(okmsg + ' (TSV)')
    } catch {
      flashToast('复制失败')
    }
    ta.remove()
  }
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    clearSel()
    return
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
    if (selState.active && !(e.target.closest && e.target.closest('input,textarea'))) {
      e.preventDefault()
      copySelection()
    }
  }
}

function onDocClick(e) {
  if (!showColPop.value) return
  if (colPopEl.value && colPopEl.value.contains(e.target)) return
  if (e.target.closest && e.target.closest('[data-col-pop]')) return
  showColPop.value = false
}

watch(() => props.enterAction, (action) => {
  if (!action || !action.code) return
  if (action.type === 'files' && action.payload && action.payload.length) {
    const p = action.payload[0].path || action.payload[0]
    if (p) openFile(p)
  }
}, { immediate: true })

watch(() => file.value, () => nextTick(autoFitFname))

function onWinResize() { markTruncated(); autoFitFname() }

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('mouseup', onMouseUpGlobal)
  document.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', onWinResize)
  document.addEventListener('dragenter', onDragEnter)
  document.addEventListener('dragover', onDragOver)
  document.addEventListener('dragleave', onDragLeave)
  document.addEventListener('drop', onDrop)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('mouseup', onMouseUpGlobal)
  document.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('resize', onWinResize)
  document.removeEventListener('dragenter', onDragEnter)
  document.removeEventListener('dragover', onDragOver)
  document.removeEventListener('dragleave', onDragLeave)
  document.removeEventListener('drop', onDrop)
  stopTimer()
})
</script>

<template>
  <div class="viewer">
    <div v-if="dragOver" class="drop-overlay">
      <div class="drop-card">
        <div class="drop-icon">⇩</div>
        <div class="drop-title">松开以打开文件</div>
        <div class="drop-hint">JSON / JSONL / CSV / TSV / Excel</div>
      </div>
    </div>
    <div class="topbar">
      <div class="file-meta">
        <template v-if="file">
          <span class="fname" ref="fnameRef" :title="file.file">{{ file.name }}</span>
          <span class="tag">{{ typeLabel(file.category) }}</span>
          <span class="faint">{{ humanSize(file.size) }}</span>
        </template>
        <span v-else class="faint">未选择文件</span>
      </div>
      <span class="grow" />
      <button class="btn primary" type="button" @click="handleOpenDialog">打开文件</button>
    </div>

    <div class="body">
      <div v-if="error && !file" class="empty">
        <div class="big">⨯</div>
        <div>{{ error }}</div>
      </div>
      <div v-else-if="!file" class="empty">
        <div class="big">◎</div>
        <div>选择或拖入 JSON / JSONL / CSV / Excel 文件</div>
        <button class="btn primary" style="margin-top:14px" type="button" @click="handleOpenDialog">选择文件</button>
      </div>

      <template v-else>
        <div class="toolbar">
          <button v-if="segs.length" class="btn sm" type="button" @click="back">← 上一级</button>
          <button v-if="segs.length" class="btn sm" type="button" @click="goRoot">根</button>
          <button class="btn sm" type="button" @click="openModal(segs.slice())">查看原始</button>
          <template v-if="node && node.type === 'array'">
            <div class="col-pop-wrap">
              <button class="btn sm" data-col-pop type="button" @click="toggleColPopover">列设置</button>
              <div v-if="showColPop" ref="colPopEl" class="col-popover">
                <div class="cp-head">
                  <b>显示列</b>
                  {{ (node.cols?.length || 0) - hidden.size }}/{{ node.cols?.length || 0 }}
                  <span class="grow" />
                  <button class="btn sm" type="button" @click="showAllCols">全部</button>
                </div>
                <div class="cp-rows">
                  <label
                    v-for="c in node.cols || []"
                    :key="c.name"
                    class="cp-row"
                    :class="{ off: hidden.has(c.name) }"
                    @click.prevent="toggleCol(c.name)"
                  >
                    <input type="checkbox" :checked="!hidden.has(c.name)" />
                    <span>{{ c.name }}</span>
                    <span class="tag">{{ c.type }}</span>
                    <span
                      v-if="extraPaths.includes(c.name)"
                      class="cp-x"
                      @click.stop="removeExtract(c.name)"
                    >✕</span>
                  </label>
                </div>
                <div class="cp-foot">
                  <input
                    class="input"
                    placeholder="提取字段,如 user.id"
                    @keydown.enter.prevent="addExtractPath($event.target.value); $event.target.value = ''"
                  />
                </div>
                <div v-if="extraPaths.length" class="cp-ext">
                  <span
                    v-for="p in extraPaths"
                    :key="p"
                    class="tag blue"
                    style="cursor:pointer"
                    @click="removeExtract(p)"
                  >{{ p }} ✕</span>
                </div>
              </div>
            </div>
            <input
              v-model="extInput"
              class="input sm"
              style="width:180px"
              placeholder="＋ 提取字段,如 user.id"
              @keydown="extEnterBar"
            />
          </template>
          <span class="grow" />
          <template v-if="node && node.type === 'array'">
            <span class="faint hint-sel">拖选 · Ctrl+C 复制</span>
            <div class="search-box" :title="searchOptHint">
              <input
                class="input sm"
                style="width:150px"
                :placeholder="globalSearchPlaceholder"
                :value="where['*'] || ''"
                @input="setGlobal($event.target.value)"
                @keydown="filterKey($event, '*')"
              />
              <button
                type="button"
                class="opt-btn"
                :class="{ on: searchOpts.cs }"
                title="区分大小写（全局 + 所有列筛选）"
                @click="toggleSearchOpt('cs')"
              >Aa</button>
              <button
                type="button"
                class="opt-btn"
                :class="{ on: searchOpts.re }"
                title="使用正则（全局 + 所有列筛选 + 单元格弹窗）"
                @click="toggleSearchOpt('re')"
              >.*</button>
            </div>
            <span class="faint opt-hint" :title="searchOptHint">{{ searchOptHint }}</span>
          </template>
        </div>

        <div class="crumbs" :class="{ editing: editPathMode }" @dblclick="enterEditPath">
          <template v-if="editPathMode">
            <input
              ref="editPathEl"
              v-model="editPathValue"
              class="input path-input"
              placeholder="如 results[0].id"
              @keydown.enter="commitEditPath"
              @keydown.esc="cancelEditPath"
              @blur="commitEditPath"
            />
            <button class="btn sm" type="button" @click="commitEditPath">确定</button>
          </template>
          <template v-else>
            <span class="seg" :class="{ cur: !segs.length }" title="回到根" @click="goRoot">根</span>
            <template v-for="(seg, i) in segs" :key="i">
              <span class="sep">›</span>
              <span
                class="seg"
                :class="{ cur: i === segs.length - 1 }"
                :title="`跳到 ${serializePath(segs.slice(0, i + 1)) || '根'}（双击路径可编辑）`"
                @click="navigateTo(segs.slice(0, i + 1))"
              >{{ typeof seg === 'number' ? `[${seg}]` : seg }}</span>
            </template>
            <button class="crumb-edit" type="button" title="编辑路径" @click="enterEditPath">✎</button>
          </template>
        </div>

        <div class="view-body">
          <div v-if="loading && heavyLoad" class="loading-overlay">
            <div class="loading-card">
              <span class="spin-lg" />
              <div class="ld-title">正在加载数据</div>
              <div class="ld-file" :title="file?.file">{{ file?.name }}</div>
              <div class="ld-hint">
                {{ loadSecs < 3 ? '请稍候…' : (loadSecs < 12 ? `已等待 ${loadSecs}s，大文件首次解析较慢` : `已等待 ${loadSecs}s，请继续等待…`) }}
              </div>
            </div>
          </div>
          <div v-else-if="error" class="empty">
            <div class="big" style="color:var(--err)">⨯</div>
            加载失败：<span class="muted">{{ error }}</span>
          </div>

          <template v-else-if="node">
            <div v-if="node.type === 'scalar'" class="scalar-wrap">
              <template v-if="node.message">
                <div class="muted">{{ node.message }}</div>
              </template>
              <template v-else-if="node.value == null">null</template>
              <template v-else-if="typeof node.value === 'object'">{{ JSON.stringify(node.value, null, 2) }}</template>
              <template v-else>{{ typeof node.value === 'string' ? node.value : JSON.stringify(node.value) }}</template>
            </div>

            <div v-else-if="node.type === 'object'" class="cards">
              <div
                v-for="k in node.keys || []"
                :key="k.name"
                class="card-item"
                :class="{ clickable: k.clickable }"
                @click="k.clickable ? navigateTo(segs.concat([k.name])) : openModal(segs.concat([k.name]))"
              >
                <div class="ci-head">
                  <div class="ci-ic">{{ typeIcon(k.type) }}</div>
                  <div class="ci-key">{{ k.name }}</div>
                  <div class="ci-type">{{ k.type }}</div>
                </div>
                <div class="ci-preview">{{ k.preview }}</div>
              </div>
            </div>

            <template v-else-if="node.type === 'array'">
              <div v-if="!(node.cols || []).length" class="empty">空数组</div>
              <div
                v-else
                ref="tableWrap"
                class="table-wrap"
                @mousemove="onTableMouseMove"
              >
                <!-- 普通表 -->
                <table v-if="!isRichTable" class="d">
                  <thead>
                    <tr>
                      <th class="rownum">#</th>
                      <th v-for="c in visibleCols" :key="c.name">
                        <div class="col-tools">
                          <span :title="c.name">{{ c.name }}</span>
                          <span class="tag type">{{ c.type }}</span>
                          <span class="col-toggle" title="隐藏该列" @click="hideCol(c.name)">⊘</span>
                        </div>
                        <input
                          class="col-search"
                          :class="{ 'opt-on': searchOpts.cs || searchOpts.re }"
                          :placeholder="colFilterPlaceholder"
                          :title="searchOptHint"
                          :value="where[c.name] || ''"
                          @input="setColFilter(c.name, $event.target.value)"
                          @keydown="filterKey($event, c.name)"
                        />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(r, ri) in page?.rows || []" :key="r._idx">
                      <td
                        class="rownum"
                        title="查看整行"
                        @click="openModal(parsePath(rowClickPath(r)))"
                      >{{ r._idx }}</td>
                      <td
                        v-for="(c, ci) in visibleCols"
                        :key="c.name"
                        :data-ri="ri"
                        :data-ci="ci"
                        :data-cp="cellClickPath(r, c)"
                        :data-full="fullTextOf(r[c.name])"
                        :class="{
                          clickable: isExpandable(r[c.name]),
                          'cell-sel': isCellSelected(ri, ci),
                        }"
                        @mousedown="onTdMouseDown($event, ri, ci)"
                        @click="onCellClick($event, r, c)"
                      >
                        <template v-if="r[c.name] && typeof r[c.name] === 'object' && r[c.name].__c === 'array'">
                          <span class="cell-clip"><span class="badge-obj">Array({{ r[c.name].len ?? 0 }})</span></span>
                        </template>
                        <template v-else-if="r[c.name] && typeof r[c.name] === 'object' && r[c.name].__c === 'object'">
                          <span class="cell-clip"><span class="badge-obj">Object</span></span>
                        </template>
                        <template v-else-if="r[c.name] && typeof r[c.name] === 'object' && '__s' in r[c.name]">
                          <span class="cell-clip cell-str">{{ trunc(flatten(r[c.name].__s), 80) }}…</span>
                        </template>
                        <template v-else-if="r[c.name] === null || r[c.name] === undefined">
                          <span class="cell-clip cell-null">null</span>
                        </template>
                        <template v-else-if="typeof r[c.name] === 'boolean'">
                          <span class="cell-clip cell-bool">{{ r[c.name] }}</span>
                        </template>
                        <template v-else-if="typeof r[c.name] === 'number'">
                          <span class="cell-clip cell-num">{{ r[c.name] }}</span>
                        </template>
                        <template v-else-if="typeof r[c.name] === 'string'">
                          <span v-if="r[c.name] === ''" class="cell-clip cell-null">(空)</span>
                          <span v-else class="cell-clip cell-str" :title="r[c.name]">{{ trunc(flatten(r[c.name]), 80) }}</span>
                        </template>
                        <template v-else><span class="cell-clip">{{ r[c.name] }}</span></template>
                      </td>
                    </tr>
                    <tr v-if="!(page?.rows || []).length">
                      <td :colspan="visibleCols.length + 1" class="faint" style="text-align:center;padding:20px">
                        {{ Object.keys(where).some(k => where[k]) ? '无匹配(当前筛选)' : '该层级无数据' }}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <!-- Excel 富样式表 -->
                <table v-else class="d rich">
                  <thead>
                    <tr>
                      <th class="rownum">#</th>
                      <th
                        v-for="c in visibleCols"
                        :key="c.name"
                      >
                        <div class="col-tools">
                          <span :title="c.name">{{ c.name }}</span>
                          <span class="tag type">{{ c.type }}</span>
                          <span class="col-toggle" title="隐藏该列" @click="hideCol(c.name)">⊘</span>
                        </div>
                        <input
                          class="col-search"
                          :class="{ 'opt-on': searchOpts.cs || searchOpts.re }"
                          :placeholder="colFilterPlaceholder"
                          :title="searchOptHint"
                          :value="where[c.name] || ''"
                          @input="setColFilter(c.name, $event.target.value)"
                          @keydown="filterKey($event, c.name)"
                        />
                      </th>
                    </tr>
                  </thead>
                  <tbody v-if="richLayout">
                    <tr v-for="(r, ri) in richLayout.rows" :key="r._idx">
                      <td
                        class="rownum"
                        title="查看整行"
                        @click="openModal(parsePath(rowClickPath(r)))"
                      >{{ r._idx }}</td>
                      <template v-for="(c, ci) in richLayout.cols" :key="c.name">
                        <td
                          v-if="!richLayout.occupied.has(`${ri},${ci}`)"
                          :data-ri="ri"
                          :data-ci="ci"
                          :data-cp="cellClickPath(r, c)"
                          :data-full="fullTextOf(r[c.name])"
                          :rowspan="richLayout.anchors[`${ri},${ci}`]?.rr"
                          :colspan="richLayout.anchors[`${ri},${ci}`]?.cc"
                          :class="{
                            clickable: isExpandable(r[c.name]) || !!(cellDeco(r, c.name)?.link || cellDeco(r, c.name)?.comment),
                            'has-cmt': !!cellCommentOf(r, c.name),
                            'cell-sel': isCellSelected(ri, ci),
                          }"
                          :title="cellCommentOf(r, c.name) || undefined"
                          @mousedown="onTdMouseDown($event, ri, ci)"
                          @click="onRichCellClick($event, r, c)"
                        >
                          <template v-if="cellDeco(r, c.name)?.link && (r[c.name] == null || typeof r[c.name] !== 'object')">
                            <span class="cell-clip cell-link" :title="cellDeco(r, c.name).link">
                              {{ trunc(flatten(String(cellTxt(r[c.name]))), 80) }}
                            </span>
                          </template>
                          <template v-else-if="r[c.name] && typeof r[c.name] === 'object' && r[c.name].__c === 'array'">
                            <span class="cell-clip"><span class="badge-obj">Array({{ r[c.name].len ?? 0 }})</span></span>
                          </template>
                          <template v-else-if="r[c.name] && typeof r[c.name] === 'object' && r[c.name].__c === 'object'">
                            <span class="cell-clip"><span class="badge-obj">Object</span></span>
                          </template>
                          <template v-else-if="r[c.name] && typeof r[c.name] === 'object' && '__s' in r[c.name]">
                            <span class="cell-clip cell-str">{{ trunc(flatten(r[c.name].__s), 80) }}…</span>
                          </template>
                          <template v-else-if="r[c.name] === null || r[c.name] === undefined">
                            <span class="cell-clip cell-null">null</span>
                          </template>
                          <template v-else-if="typeof r[c.name] === 'boolean'">
                            <span class="cell-clip cell-bool">{{ r[c.name] }}</span>
                          </template>
                          <template v-else-if="typeof r[c.name] === 'number'">
                            <span class="cell-clip cell-num">{{ r[c.name] }}</span>
                          </template>
                          <template v-else-if="typeof r[c.name] === 'string'">
                            <span v-if="r[c.name] === ''" class="cell-clip cell-null">(空)</span>
                            <span v-else class="cell-clip cell-str" :title="r[c.name]">{{ trunc(flatten(r[c.name]), 80) }}</span>
                          </template>
                          <template v-else><span class="cell-clip">{{ r[c.name] }}</span></template>
                          <sup v-if="cellCommentOf(r, c.name)" class="cmt-mark">●</sup>
                        </td>
                      </template>
                    </tr>
                    <tr v-if="!richLayout.rows.length">
                      <td :colspan="visibleCols.length + 1" class="faint" style="text-align:center;padding:20px">
                        {{ Object.keys(where).some(k => where[k]) ? '无匹配(当前筛选)' : '该层级无数据' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="pager">
                <span class="info">
                  显示第 {{ page?.total ? offset + 1 : 0 }}–{{ Math.min(offset + (page?.rows?.length || 0), page?.total || 0) }} 条，
                  共 {{ page?.total || 0 }} 条
                  <template v-if="page?.filtered"> · 已筛选</template>
                  <a v-if="Object.keys(where).some(k => where[k])" class="link" @click="clearFilters">清筛选</a>
                </span>
                <select class="page-size" :value="String(limit)" @change="setLimit($event.target.value)">
                  <option>20</option>
                  <option>50</option>
                  <option>100</option>
                </select>
                <button class="page-btn" type="button" :disabled="offset <= 0" @click="goPageOffset(offset - limit)">‹</button>
                <input
                  class="input page-input"
                  :value="curPageNum"
                  @change="goPageNum($event.target.value)"
                />
                <span>/ {{ totalPages }}</span>
                <button
                  class="page-btn"
                  type="button"
                  :disabled="offset + limit >= (page?.total || 0)"
                  @click="goPageOffset(offset + limit)"
                >›</button>
              </div>
            </template>
          </template>
        </div>
      </template>
    </div>

    <div v-if="toast.show" class="copy-toast">{{ toast.msg }}</div>

    <DataModal
      :open="modal.open"
      :title="modal.title"
      :path-label="modal.pathLabel"
      :loading="modal.loading"
      :error="modal.error"
      :value="modal.value"
      :value-type="modal.valueType"
      :truncated="modal.truncated"
      :comment="modal.comment"
      :link="modal.link"
      :search-opts="searchOpts"
      @close="closeModal"
      @drill="drillFromModal"
      @toggle-opt="toggleSearchOpt"
    />
  </div>
</template>

<style scoped>
.viewer {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  border: 2px dashed var(--accent);
  pointer-events: none;
}
.drop-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 40px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
}
.drop-icon {
  font-size: 28px;
  color: var(--accent);
  line-height: 1;
}
.drop-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.drop-hint {
  font-size: 12px;
  color: var(--muted);
}

.topbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
  height: 48px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex: none;
  flex-wrap: nowrap;
}
.topbar .btn.primary {
  flex: none;
  white-space: nowrap;
}
.file-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 14px;
}
.fname {
  font-weight: 600;
  font-size: 16px; /* 默认 16px；JS 按文件名长度自适应到 12px 下限 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  max-width: 100%;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  padding: 6px 11px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text);
}
.btn:hover { background: var(--panel2); }
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.btn.primary:hover { background: var(--accent-d); }
.btn.sm { padding: 4px 8px; font-size: 12px; }
.input.sm { height: 28px; font-size: 12px; padding: 4px 8px; }
.tag {
  font-size: 11px;
  border: 1px solid var(--border);
  color: var(--muted);
  border-radius: 6px;
  padding: 1px 7px;
  background: var(--panel2);
}
.tag.type { font-size: 10px; }
.tag.blue {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
  background: var(--accent-soft);
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 6px 12px 8px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
  flex: none;
}
.hint-sel { font-size: 11px; }
.crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  margin-bottom: 4px;
  font-size: 12px;
  flex: none;
  min-height: 26px;
}
.crumbs .seg {
  padding: 2px 6px;
  border-radius: 5px;
  cursor: pointer;
  color: var(--muted);
  border: 1px solid transparent;
  line-height: 1.4;
}
.crumbs .seg:hover { background: var(--panel2); color: var(--text); }
.crumbs .seg.cur {
  color: var(--accent);
  font-weight: 600;
  background: var(--accent-soft);
}
.crumbs .sep { color: var(--faint); }
.crumbs .edit { display: inline-flex; align-items: center; gap: 6px; margin-left: 6px; }
.crumbs.editing { background: var(--panel2); border-radius: 8px; padding: 4px 6px; }
.crumb-edit {
  margin-left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  color: var(--faint);
  font-size: 11px;
  opacity: 0.55;
}
.crumb-edit:hover {
  opacity: 1;
  color: var(--accent);
  background: var(--accent-soft);
}
.path-input {
  font-family: var(--mono);
  font-size: 12px;
  width: min(420px, 55vw);
}
.search-box {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--panel2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 2px 4px 2px 2px;
}
.search-box .input.sm {
  border: none;
  background: transparent;
  box-shadow: none;
  height: 24px;
  padding: 0 6px;
}
.search-box .input.sm:focus {
  border: none;
  box-shadow: none;
}
.opt-btn {
  min-width: 26px;
  height: 22px;
  padding: 0 4px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--mono);
  color: var(--faint);
  background: transparent;
  border: 1px solid transparent;
}
.opt-btn:hover {
  color: var(--text);
  background: var(--panel);
}
.opt-btn.on {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  font-weight: 700;
}
.opt-hint {
  font-size: 11px;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-search.opt-on {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, var(--panel2));
}

.view-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}
.view-body > .table-wrap {
  flex: 1;
  min-height: 0;
}
.view-body > .cards,
.view-body > .scalar-wrap {
  flex: 1;
  overflow: auto;
}

.table-wrap {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel);
  min-height: 180px;
  user-select: none;
}
table.d {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.d th {
  text-align: left;
  font-weight: 600;
  color: var(--muted);
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  position: sticky;
  top: 0;
  background: var(--panel);
  z-index: 2; /* 表头需高于数据行号列(sticky-left),否则横向滚动时被行号列覆盖 */
}
.d th.rownum {
  left: 0; /* 左上角交叉格:纵向+横向双向锁定 */
  z-index: 3;
}
.d th .col-tools { display: flex; align-items: center; gap: 6px; }
.d th .col-toggle { cursor: pointer; color: var(--faint); font-size: 13px; }
.d th .col-toggle:hover { color: var(--accent); }
.d td {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border2);
  white-space: nowrap;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: top;
}
/* 内层固定裁切区：td 的 max-width 在自动布局里不可靠，用它做截断判定 */
.cell-clip {
  display: block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.d .rownum {
  font-family: var(--mono);
  color: var(--faint);
  font-size: 11px;
  position: sticky;
  left: 0;
  background: var(--panel);
  cursor: pointer;
  z-index: 1;
}
.d .rownum:hover { background: var(--panel2); color: var(--muted); }
.d td.clickable { cursor: pointer; }
.d td[data-cell] { cursor: pointer; }
.d td.clickable:hover,
.d td[data-cell]:hover { background: var(--panel2); }
.d td.cell-sel {
  outline: 1px dashed var(--accent);
  outline-offset: -1px;
  background-color: color-mix(in srgb, var(--accent) 8%, transparent) !important;
}
.col-search {
  width: 100%;
  font-size: 10.5px;
  padding: 3px 6px;
  margin-top: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.cell-null { color: var(--faint); font-style: italic; font-size: 11px; }
.cell-num, .cell-bool { font-family: var(--mono); }
.badge-obj {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  background: var(--panel2);
  padding: 1px 6px;
  border-radius: 5px;
  cursor: pointer;
}
.cell-link {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}
.d td.has-cmt { position: relative; }
.cmt-mark {
  position: absolute;
  top: 2px;
  right: 3px;
  color: #fff;
  background: var(--warn);
  font-size: 9px;
  font-weight: 700;
  border-radius: 9px;
  padding: 0 4px;
  line-height: 1.5;
  cursor: help;
}
.d td[rowspan], .d td[colspan] { vertical-align: middle; }

.col-pop-wrap { position: relative; }
.col-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 40;
  width: 300px;
  max-height: 380px;
  overflow: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  padding: 10px;
}
.cp-head { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.cp-rows { display: flex; flex-direction: column; gap: 2px; max-height: 240px; overflow: auto; }
.cp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.cp-row:hover { background: var(--panel2); }
.cp-row span:nth-child(2) { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-row.off span:nth-child(2) { text-decoration: line-through; color: var(--faint); }
.cp-x { color: var(--err); cursor: pointer; padding: 0 3px; }
.cp-foot { display: flex; gap: 6px; margin-top: 8px; }
.cp-foot .input { flex: 1; font-size: 12px; padding: 5px 8px; }
.cp-ext { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }

.pager {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
  padding: 4px 0 0;
  font-size: 11.5px;
  color: var(--muted);
  flex-wrap: nowrap;
  flex: none;
  line-height: 1;
}
.pager .info {
  margin-right: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 55%;
}
.pager .link { color: var(--accent); cursor: pointer; margin-left: 6px; }
.page-btn {
  min-width: 24px;
  height: 24px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--panel);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
  font-size: 12px;
}
.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.page-input {
  width: 48px;
  height: 24px;
  font-size: 11.5px;
  text-align: center;
  padding: 0 4px;
}
.page-size {
  font-size: 11.5px;
  height: 24px;
  padding: 0 4px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.card-item {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  cursor: default;
}
.card-item.clickable { cursor: pointer; }
.card-item.clickable:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
}
.ci-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.ci-ic {
  width: 26px;
  height: 26px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex: none;
  background: var(--panel2);
  color: var(--muted);
}
.ci-key { font-weight: 600; font-size: 13px; word-break: break-all; flex: 1; }
.ci-type { font-size: 10.5px; color: var(--faint); font-family: var(--mono); }
.ci-preview {
  font-size: 12px;
  color: var(--muted);
  font-family: var(--mono);
  word-break: break-all;
  line-height: 1.5;
  max-height: 4.6em;
  overflow: hidden;
}
.scalar-wrap {
  background: var(--panel2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  font-family: var(--mono);
  font-size: 13px;
  word-break: break-all;
  white-space: pre-wrap;
  max-width: none;
}
.empty {
  text-align: center;
  color: var(--faint);
  padding: 48px 16px;
  font-size: 13px;
}
.empty .big { font-size: 34px; opacity: 0.3; margin-bottom: 8px; }
.loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg) 72%, transparent);
  backdrop-filter: blur(2px);
}
.loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 240px;
  padding: 28px 36px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
}
.spin-lg {
  width: 36px;
  height: 36px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: sp 0.7s linear infinite;
}
.ld-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.ld-file {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--muted);
  font-family: var(--mono);
}
.ld-hint {
  font-size: 12px;
  color: var(--faint);
}
.loading { padding: 24px; text-align: center; color: var(--muted); font-size: 13px; }
.spin {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: sp 0.7s linear infinite;
  vertical-align: -2px;
  margin-right: 6px;
}
@keyframes sp { to { transform: rotate(360deg); } }

.copy-toast {
  position: fixed;
  left: 50%;
  bottom: 48px;
  transform: translateX(-50%);
  background: #1f2937;
  color: #fff;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 12px;
  z-index: 80;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}
</style>
