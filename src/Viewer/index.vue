<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import DataModal from './DataModal.vue'

const props = defineProps({
  enterAction: { type: Object, default: () => ({}) },
})

const file = ref(null)
const node = ref(null)
const page = ref(null)
const loading = ref(false)
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

async function load() {
  if (!file.value) return
  loading.value = true
  error.value = ''
  stopTimer()
  loadSecs.value = 0
  loadTimer = setInterval(() => { loadSecs.value += 1 }, 1000)
  clearSel()
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
    load()
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

function navigateTo(list) {
  segs.value = list.slice()
  resetColState()
  load()
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
  if (cleanWhere()) load()
}

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

/** 保底：非空单元格一律可点开看全文（允许“其实没截断也能点”，不允许漏点） */
function isExpandable(v) {
  if (v === null || v === undefined) return false
  if (typeof v === 'string' && v === '') return false
  return true
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

/* ---- CSS 截断后补可点：宁可多可点，不接受漏点 ---- */
function markTruncated() {
  const host = tableWrap.value
  if (!host) return
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;pointer-events:none'
  host.appendChild(probe)
  host.querySelectorAll('td[data-cp]:not([data-cell])').forEach(td => {
    const sp = td.querySelector('span.cell-str, span.cell-num, span.cell-bool, span.cell-null')
    if (!sp) return
    // scrollWidth > clientWidth：CSS 已经截断
    if (td.scrollWidth > td.clientWidth + 1) {
      td.setAttribute('data-cell', td.getAttribute('data-cp'))
      return
    }
    if (sp.scrollWidth > sp.clientWidth + 1) {
      td.setAttribute('data-cell', td.getAttribute('data-cp'))
      return
    }
    const cs = getComputedStyle(td)
    probe.style.fontFamily = cs.fontFamily
    probe.style.fontSize = cs.fontSize
    probe.style.fontWeight = cs.fontWeight
    probe.style.letterSpacing = cs.letterSpacing
    probe.textContent = sp.textContent || ''
    const padX = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0')
    const contentW = td.clientWidth - padX
    // 阈值放宽到 0.72，接受「其实没截断也能点」
    if (contentW > 0 && probe.offsetWidth > contentW * 0.72) {
      td.setAttribute('data-cell', td.getAttribute('data-cp'))
    }
  })
  probe.remove()
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
  e.preventDefault()
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

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('mouseup', onMouseUpGlobal)
  document.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('mouseup', onMouseUpGlobal)
  document.removeEventListener('keydown', onKeyDown)
  stopTimer()
})
</script>

<template>
  <div class="viewer">
    <div class="topbar">
      <div class="file-meta">
        <template v-if="file">
          <span class="fname" :title="file.file">{{ file.name }}</span>
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
        <div>选择 JSON / JSONL / CSV / Excel 文件开始查看</div>
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
            <div class="search-box">
              <input
                class="input sm"
                style="width:150px"
                placeholder='全局搜索（回车；"" 空值）'
                :value="where['*'] || ''"
                @input="setGlobal($event.target.value)"
                @keydown="filterKey($event, '*')"
              />
              <button
                type="button"
                class="opt-btn"
                :class="{ on: searchOpts.cs }"
                title="区分大小写"
                @click="toggleSearchOpt('cs')"
              >Aa</button>
              <button
                type="button"
                class="opt-btn"
                :class="{ on: searchOpts.re }"
                title="使用正则"
                @click="toggleSearchOpt('re')"
              >.*</button>
            </div>
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
          <div v-if="loading" class="loading">
            <span class="spin" />
            <span>
              {{ loadSecs < 8 ? '加载中…' : `正在分析大文件结构，已 ${loadSecs}s（首次较慢）` }}
            </span>
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
                          placeholder='筛选（回车；"" 空值）…'
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
                        :class="{
                          clickable: isExpandable(r[c.name]),
                          'cell-sel': isCellSelected(ri, ci),
                        }"
                        @mousedown="onTdMouseDown($event, ri, ci)"
                        @click="isExpandable(r[c.name]) ? openModal(parsePath(cellClickPath(r, c))) : null"
                      >
                        <template v-if="r[c.name] && typeof r[c.name] === 'object' && r[c.name].__c === 'array'">
                          <span class="badge-obj">Array({{ r[c.name].len ?? 0 }})</span>
                        </template>
                        <template v-else-if="r[c.name] && typeof r[c.name] === 'object' && r[c.name].__c === 'object'">
                          <span class="badge-obj">Object</span>
                        </template>
                        <template v-else-if="r[c.name] && typeof r[c.name] === 'object' && '__s' in r[c.name]">
                          <span class="cell-str">{{ trunc(flatten(r[c.name].__s), 80) }}…</span>
                        </template>
                        <template v-else-if="r[c.name] === null || r[c.name] === undefined">
                          <span class="cell-null">null</span>
                        </template>
                        <template v-else-if="typeof r[c.name] === 'boolean'">
                          <span class="cell-bool">{{ r[c.name] }}</span>
                        </template>
                        <template v-else-if="typeof r[c.name] === 'number'">
                          <span class="cell-num">{{ r[c.name] }}</span>
                        </template>
                        <template v-else-if="typeof r[c.name] === 'string'">
                          <span v-if="r[c.name] === ''" class="cell-null">(空)</span>
                          <span v-else class="cell-str" :title="r[c.name]">{{ trunc(flatten(r[c.name]), 80) }}</span>
                        </template>
                        <template v-else>{{ r[c.name] }}</template>
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
                      <th class="rownum" :style="page.header_bg ? { background: page.header_bg } : undefined">#</th>
                      <th
                        v-for="c in visibleCols"
                        :key="c.name"
                        :style="page.header_bg ? { background: page.header_bg } : undefined"
                      >
                        <div class="col-tools">
                          <span :title="c.name">{{ c.name }}</span>
                          <span class="tag type">{{ c.type }}</span>
                          <span class="col-toggle" title="隐藏该列" @click="hideCol(c.name)">⊘</span>
                        </div>
                        <input
                          class="col-search"
                          placeholder='筛选（回车；"" 空值）…'
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
                        :style="page.header_bg ? { background: page.header_bg } : undefined"
                        @click="openModal(parsePath(rowClickPath(r)))"
                      >{{ r._idx }}</td>
                      <template v-for="(c, ci) in richLayout.cols" :key="c.name">
                        <td
                          v-if="!richLayout.occupied.has(`${ri},${ci}`)"
                          :data-ri="ri"
                          :data-ci="ci"
                          :data-cp="cellClickPath(r, c)"
                          :rowspan="richLayout.anchors[`${ri},${ci}`]?.rr"
                          :colspan="richLayout.anchors[`${ri},${ci}`]?.cc"
                          :class="{
                            clickable: isExpandable(r[c.name]) || !!cellDeco(r, c.name),
                            'has-bg': !!(cellDeco(r, c.name)?.bg),
                            'has-cmt': !!cellCommentOf(r, c.name),
                            'cell-sel': isCellSelected(ri, ci),
                          }"
                          :style="cellDeco(r, c.name)?.bg ? { background: cellDeco(r, c.name).bg } : undefined"
                          :title="cellCommentOf(r, c.name) || undefined"
                          @mousedown="onTdMouseDown($event, ri, ci)"
                          @click="openModal(parsePath(cellClickPath(r, c)), { comment: cellCommentOf(r, c.name) })"
                        >
                          <template v-if="cellDeco(r, c.name)?.link && (r[c.name] == null || typeof r[c.name] !== 'object')">
                            <span class="cell-link" :title="cellDeco(r, c.name).link">
                              {{ trunc(flatten(String(cellTxt(r[c.name]))), 80) }}
                            </span>
                          </template>
                          <template v-else-if="r[c.name] && typeof r[c.name] === 'object' && r[c.name].__c === 'array'">
                            <span class="badge-obj">Array({{ r[c.name].len ?? 0 }})</span>
                          </template>
                          <template v-else-if="r[c.name] && typeof r[c.name] === 'object' && r[c.name].__c === 'object'">
                            <span class="badge-obj">Object</span>
                          </template>
                          <template v-else-if="r[c.name] && typeof r[c.name] === 'object' && '__s' in r[c.name]">
                            <span class="cell-str">{{ trunc(flatten(r[c.name].__s), 80) }}…</span>
                          </template>
                          <template v-else-if="r[c.name] === null || r[c.name] === undefined">
                            <span class="cell-null">null</span>
                          </template>
                          <template v-else-if="typeof r[c.name] === 'boolean'">
                            <span class="cell-bool">{{ r[c.name] }}</span>
                          </template>
                          <template v-else-if="typeof r[c.name] === 'number'">
                            <span class="cell-num">{{ r[c.name] }}</span>
                          </template>
                          <template v-else-if="typeof r[c.name] === 'string'">
                            <span v-if="r[c.name] === ''" class="cell-null">(空)</span>
                            <span v-else class="cell-str" :title="r[c.name]">{{ trunc(flatten(r[c.name]), 80) }}</span>
                          </template>
                          <template v-else>{{ r[c.name] }}</template>
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
      @close="closeModal"
      @drill="drillFromModal"
    />
  </div>
</template>

<style scoped>
.viewer {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  font-size: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 52vw;
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
  padding: 10px 14px 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
  flex: none;
}
.hint-sel { font-size: 11px; }
.crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 8px;
  font-size: 12.5px;
  flex: none;
}
.crumbs .seg {
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--muted);
  border: 1px solid transparent;
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
  margin-left: 6px;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--faint);
  font-size: 12px;
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
  color: var(--accent);
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}

.view-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  padding: 8px 11px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  position: sticky;
  top: 0;
  background: var(--panel);
  z-index: 1;
}
.d th .col-tools { display: flex; align-items: center; gap: 6px; }
.d th .col-toggle { cursor: pointer; color: var(--faint); font-size: 13px; }
.d th .col-toggle:hover { color: var(--accent); }
.d td {
  padding: 8px 11px;
  border-bottom: 1px solid var(--border2);
  white-space: nowrap;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: top;
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
.d td.clickable:hover { background: var(--panel2); }
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
  gap: 8px;
  justify-content: flex-end;
  padding: 8px 0 0;
  font-size: 12px;
  color: var(--muted);
  flex-wrap: wrap;
  flex: none;
}
.pager .info { margin-right: auto; }
.pager .link { color: var(--accent); cursor: pointer; margin-left: 8px; }
.page-btn {
  min-width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--panel);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
}
.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.page-input { width: 64px; height: 30px; font-size: 12px; text-align: center; }
.page-size { font-size: 12px; }

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
