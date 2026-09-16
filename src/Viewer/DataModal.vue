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
})

const emit = defineEmits(['close', 'drill'])

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
  const needle = searchQ.value.trim()
  const nl = needle.toLowerCase()
  doHighlight(body, needle, nl, false)
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
  const nl = needle.toLowerCase()

  // 对象/树值:命中若在折叠节点里则看不见也滚不动。
  // 搜索时强制全展开,确保所有路径都渲染可见,再下一拍真正高亮+定位。
  // 叶子值(<pre>)无需展开,直接搜。
  if (!isLeafValue.value && treeForce.value !== 'open') {
    treeForce.value = 'open'
    nextTick(() => doHighlight(body, needle, nl, gotoFirst))
    return
  }
  doHighlight(body, needle, nl, gotoFirst)
}

function doHighlight(body, needle, nl, gotoFirst) {
  // TreeWalker 收集所有可见文本节点(<pre> 叶子 + JsonTree 各 span)
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentNode
      if (!p) return NodeFilter.FILTER_REJECT
      // 跳过 <mark> 自身(避免重复处理)
      if (p.nodeName === 'MARK') return NodeFilter.FILTER_REJECT
      if (!n.nodeValue || !n.nodeValue.toLowerCase().includes(nl)) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const textNodes = []
  let n
  while ((n = walker.nextNode())) textNodes.push(n)

  for (const tn of textNodes) {
    const text = tn.nodeValue
    const low = text.toLowerCase()
    const frag = document.createDocumentFragment()
    let changed = false
    let k = 0
    while (k < text.length) {
      const at = low.indexOf(nl, k)
      if (at < 0) {
        frag.appendChild(document.createTextNode(text.slice(k)))
        break
      }
      if (at > k) { frag.appendChild(document.createTextNode(text.slice(k, at))); changed = true }
      changed = true
      const mk = document.createElement('mark')
      mk.className = 'jm-hit'
      mk.textContent = text.slice(at, at + needle.length)
      frag.appendChild(mk)
      hitMarks.push(mk)
      k = at + needle.length
      // 保护:避免极端长文一次性产生海量 mark 拖慢
      if (hitMarks.length > 5000) { frag.appendChild(document.createTextNode(text.slice(k))); break }
    }
    if (changed) tn.parentNode.replaceChild(frag, tn)
  }

  matchCount.value = hitMarks.length
  if (hitMarks.length && gotoFirst) {
    matchIdx.value = 1
    hi()
  } else if (!hitMarks.length) {
    matchIdx.value = -1
  } else {
    // 保留当前位置点,但可能越界
    if (matchIdx.value > hitMarks.length) matchIdx.value = hitMarks.length
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
          placeholder="在内容中搜索…"
          @input="applySearch(searchQ, { gotoFirst: true })"
          @keydown.enter.prevent="matchShiftEnter($event)"
        />
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
  width: 180px;
  height: 28px;
  font-size: 12px;
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
