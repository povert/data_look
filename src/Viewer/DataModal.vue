<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import JsonTree from './JsonTree.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '原始内容' },
  pathLabel: { type: String, default: '(根)' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  value: { type: null, default: null },
  valueType: { type: String, default: '' },
  truncated: { type: Boolean, default: false },
  comment: { type: String, default: '' },
  link: { type: String, default: '' },
  /** 与主界面全局搜索同步：{ cs: 区分大小写, re: 正则 } */
  searchOpts: { type: Object, default: () => ({ cs: false, re: false }) },
})

const emit = defineEmits(['close', 'drill', 'toggle-opt'])

const searchQ = ref('')
const matchCount = ref(-1)
const matchIdx = ref(-1) // 当前高亮项,1-based; -1=未定位
const treeForce = ref(null) // null | 'open' | 'closed'
let hitMarks = [] // 高亮 <mark> 元素列表(按 DOM 顺序)

const canDrill = computed(() => props.valueType === 'array' || props.valueType === 'object')

function expandAll() {
  treeForce.value = 'open'
  // 展开后 DOM 变更,下一拍重做高亮
  nextTick(() => applySearch(searchQ.value))
}

function collapseAll() {
  treeForce.value = 'closed'
  clearHits()
}

function onManualToggle() {
  // 搜索态下保持全展开(否则命中落在折叠区将不可见);无搜索时才恢复交互态
  if (searchQ.value && searchQ.value.trim()) {
    nextTick(() => reHighlight())
    return
  }
  treeForce.value = null
}

// 仅重做高亮,不改变展开态(用于手动折叠后刷新可见命中)
function reHighlight() {
  clearHits()
  const body = document.querySelector('.jm-body')
  if (!body) return
  if (!searchQ.value || !searchQ.value.trim()) return
  doHighlight(body, searchQ.value.trim(), false)
}

const isLeafValue = computed(() => {
  const v = props.value
  if (v === null || v === undefined) return true
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return true
  if (v && typeof v === 'object' && v.__truncated) return true
  return false
})

const leafText = computed(() => {
  const v = props.value
  if (v && typeof v === 'object' && v.__truncated) return v.preview
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return v
  return String(v)
})

watch(() => props.open, (v) => {
  if (v) {
    searchQ.value = ''
    matchCount.value = -1
    matchIdx.value = -1
    hitMarks = []
    treeForce.value = null
  }
})

// 全局切换 cs/re 时，弹窗内已有搜索词则按新规则重搜
watch(() => [props.searchOpts.cs, props.searchOpts.re], () => {
  if (!props.open) return
  if (searchQ.value && searchQ.value.trim()) {
    nextTick(() => applySearch(searchQ.value, { gotoFirst: true }))
  }
})

function onBackdrop(e) {
  if (e.target === e.currentTarget) emit('close')
}

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}

function clearHits() {
  hitMarks.forEach(m => {
    const p = m.parentNode
    if (!p) return
    p.replaceChild(document.createTextNode(m.textContent || ''), m)
    p.normalize()
  })
  hitMarks = []
  matchCount.value = -1
  matchIdx.value = -1
}

function applySearch(q, { gotoFirst = false } = {}) {
  clearHits()
  const body = document.querySelector('.jm-body')
  if (!body) return
  if (!q || !q.trim()) return
  const needle = q.trim()

  if (!isLeafValue.value && treeForce.value !== 'open') {
    treeForce.value = 'open'
    nextTick(() => doHighlight(body, needle, gotoFirst))
    return
  }
  doHighlight(body, needle, gotoFirst)
}

/** 按 searchOpts 构建匹配器。
 * 正则 + 未开大小写 → flags 含 i（不区分大小写）
 * 正则 + 开了大小写 → 不加 i
 */
function makeMatcher(needle) {
  const cs = !!(props.searchOpts && props.searchOpts.cs)
  const re = !!(props.searchOpts && props.searchOpts.re)
  if (re) {
    try {
      return { regex: new RegExp(needle, cs ? 'g' : 'gi') }
    } catch { /* invalid regex → literal below */ }
  }
  const lit = cs ? needle : needle.toLowerCase()
  return { lit, cs }
}

function textNodeHits(text, m) {
  // 返回 [{start, end}] 命中区间
  const hits = []
  if (m.regex) {
    const re = new RegExp(m.regex.source, m.regex.flags.includes('g') ? m.regex.flags : m.regex.flags + 'g')
    let match
    let guard = 0
    while ((match = re.exec(text)) !== null) {
      if (match[0] === '') { re.lastIndex += 1; continue }
      hits.push({ start: match.index, end: match.index + match[0].length })
      if (++guard > 5000) break
    }
    return hits
  }
  const hay = m.cs ? text : text.toLowerCase()
  const nl = m.cs ? m.lit : m.lit.toLowerCase()
  let k = 0
  while (k < hay.length) {
    const at = hay.indexOf(nl, k)
    if (at < 0) break
    hits.push({ start: at, end: at + nl.length })
    k = at + Math.max(1, nl.length)
    if (hits.length > 5000) break
  }
  return hits
}

function doHighlight(body, needle, gotoFirst) {
  const m = makeMatcher(needle)
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentNode
      if (!p) return NodeFilter.FILTER_REJECT
      if (p.nodeName === 'MARK') return NodeFilter.FILTER_REJECT
      if (!n.nodeValue) return NodeFilter.FILTER_REJECT
      if (!textNodeHits(n.nodeValue, m).length) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const textNodes = []
  let n
  while ((n = walker.nextNode())) textNodes.push(n)

  for (const tn of textNodes) {
    const text = tn.nodeValue
    const hits = textNodeHits(text, m)
    if (!hits.length) continue
    const frag = document.createDocumentFragment()
    let k = 0
    for (const h of hits) {
      if (h.start > k) frag.appendChild(document.createTextNode(text.slice(k, h.start)))
      const mk = document.createElement('mark')
      mk.className = 'jm-hit'
      mk.textContent = text.slice(h.start, h.end)
      frag.appendChild(mk)
      hitMarks.push(mk)
      k = h.end
      if (hitMarks.length > 5000) break
    }
    if (k < text.length) frag.appendChild(document.createTextNode(text.slice(k)))
    tn.parentNode.replaceChild(frag, tn)
  }

  matchCount.value = hitMarks.length
  if (hitMarks.length && gotoFirst) {
    matchIdx.value = 1
    hi()
  } else if (!hitMarks.length) {
    matchIdx.value = -1
  } else if (matchIdx.value > hitMarks.length) {
    matchIdx.value = hitMarks.length
  }
}

function hi() {
  hitMarks.forEach((m, i) => m.classList.toggle('cur', i === matchIdx.value - 1))
  const cur = hitMarks[matchIdx.value - 1]
  if (cur) cur.scrollIntoView({ block: 'center' }) // 不传 behavior = 默认 instant,跳转更快
}

function gotoMatch(delta) {
  if (!hitMarks.length) return
  let n = matchIdx.value + delta
  if (n < 1) n = hitMarks.length
  if (n > hitMarks.length) n = 1
  matchIdx.value = n
  hi()
}

function nextMatch() { gotoMatch(1) }
function prevMatch() { gotoMatch(-1) }
function matchShiftEnter(e) { if (e.shiftKey) prevMatch(); else nextMatch() }

function openLink(url) {
  // uTools/Electron 里 <a target=_blank> 常被静默拦截,改用系统浏览器主动打开
  if (!url) return
  try {
    if (window.utools && typeof window.utools.shellOpenExternal === 'function') {
      window.utools.shellOpenExternal(url)
      return
    }
  } catch { /* fall through */ }
  if (typeof window.open === 'function') window.open(url, '_blank', 'noopener')
}
</script>

<template>
  <div
    v-if="open"
    class="modal-scrim"
    tabindex="-1"
    @click="onBackdrop"
    @keydown="onKey"
  >
    <div class="jmodal">
      <div class="jm-head">
        <strong>{{ title }}</strong>
        <span class="faint mono path">{{ pathLabel }}</span>
        <span class="grow" />
        <input
          v-model="searchQ"
          class="jm-search"
          :placeholder="searchOpts.re ? '搜索·正则…' : '在内容中搜索…'"
          @input="applySearch(searchQ, { gotoFirst: true })"
          @keydown.enter.prevent="matchShiftEnter($event)"
        />
        <button
          type="button"
          class="opt-btn"
          :class="{ on: searchOpts.cs }"
          title="区分大小写（与全局同步）"
          @click="emit('toggle-opt', 'cs')"
        >Aa</button>
        <button
          type="button"
          class="opt-btn"
          :class="{ on: searchOpts.re }"
          title="使用正则（与全局同步）"
          @click="emit('toggle-opt', 're')"
        >.*</button>
        <span v-if="matchCount >= 0" class="faint jm-count">{{ matchCount ? `${matchIdx > 0 ? matchIdx : '-'}/${matchCount}` : '无匹配' }}</span>
        <template v-if="matchCount > 0">
          <button class="btn sm jm-nav" type="button" title="上一个 (Enter 反向用 Shift+Enter)" @click="prevMatch()">‹</button>
          <button class="btn sm jm-nav" type="button" title="下一个 (Enter)" @click="nextMatch()">›</button>
        </template>
        <template v-if="!isLeafValue">
          <button class="btn sm" type="button" title="全部展开" @click="expandAll">全部展开</button>
          <button class="btn sm" type="button" title="全部收起" @click="collapseAll">全部收起</button>
        </template>
        <button v-if="canDrill" class="btn sm" type="button" @click="emit('drill')">钻取</button>
        <button class="btn sm" type="button" @click="emit('close')">关闭</button>
      </div>
      <div v-if="link" class="jlink-bar">
        <span class="jlink-l">链接</span>
        <span
          class="jlink-a"
          :title="`点击用浏览器打开：${link}`"
          @click.stop="openLink(link)"
        >{{ link }}</span>
      </div>
      <div v-if="comment" class="jcmt-bar">
        <span class="jcmt-l">批注</span>
        <pre class="jcmt-pre">{{ comment }}</pre>
      </div>
      <div class="jm-body">
        <div v-if="loading" class="loading"><span class="spin" />加载…</div>
        <div v-else-if="error" class="err">{{ error }}</div>
        <template v-else>
          <div v-if="truncated" class="trunc-note">内容过大，已截断显示预览</div>
          <pre v-if="isLeafValue" class="jt-leaf">{{ leafText }}</pre>
          <JsonTree
            v-else
            :value="value"
            :depth="0"
            :force-mode="treeForce"
            @manual-toggle="onManualToggle"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 4vh;
}
.jmodal {
  width: min(96vw, 1000px);
  max-height: 90vh;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.jm-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.jm-head .path {
  max-width: 34vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.jm-search {
  width: 160px;
  height: 28px;
  font-size: 12px;
}
.opt-btn {
  min-width: 26px;
  height: 24px;
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
  background: var(--panel2);
}
.opt-btn.on {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  font-weight: 700;
}
.jm-count {
  font-family: var(--mono);
  font-size: 12px;
  white-space: nowrap;
}
.jm-nav {
  padding: 4px 8px;
  font-size: 14px;
  line-height: 1;
}
/* 高亮:所有命中项 + 当前项。注意 ::deep:mark 是 JS 注入的 DOM,scoped 需穿透 */
:deep(mark.jm-hit) {
  background: color-mix(in srgb, var(--warn) 45%, transparent);
  color: inherit;
  border-radius: 3px;
  padding: 0 1px;
}
:deep(mark.jm-hit.cur) {
  background: var(--accent);
  color: #fff;
  outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent);
}
.jm-body {
  flex: 1;
  overflow: auto;
  padding: 14px 18px;
  min-height: 200px;
}
.loading {
  padding: 24px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
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
.err { color: var(--err); }
.btn {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  background: var(--panel);
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--text);
}
.btn:hover { background: var(--panel2); }
.jcmt-bar {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  background: color-mix(in srgb, var(--warn) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
  border-radius: 8px;
  padding: 8px 12px;
  margin: 12px 16px 0;
  max-height: 38vh;
  overflow: auto;
}
.jlink-bar {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  border-radius: 8px;
  padding: 8px 12px;
  margin: 12px 16px 0;
}
.jlink-l {
  flex: none;
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: 5px;
  padding: 1px 7px;
}
.jlink-a {
  flex: 1;
  min-width: 0;
  color: var(--accent);
  text-decoration: none;
  word-break: break-all;
  font-family: var(--mono);
  font-size: 12.5px;
  cursor: pointer;
}
.jlink-a:hover { text-decoration: underline; }
.jcmt-l {
  flex: none;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--warn);
  padding: 1px 7px;
  border-radius: 5px;
}
.jcmt-pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--mono);
  font-size: 12.5px;
  margin: 0;
  flex: 1;
  color: var(--text);
}
.jt-leaf {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.6;
  margin: 0;
}
.trunc-note {
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 8px;
}
</style>
