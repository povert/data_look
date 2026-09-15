<script setup>
import { computed, ref, watch } from 'vue'
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
})

const emit = defineEmits(['close', 'drill'])

const searchQ = ref('')
const matchCount = ref(-1)
const treeForce = ref(null) // null | 'open' | 'closed'

const canDrill = computed(() => props.valueType === 'array' || props.valueType === 'object')

function expandAll() {
  treeForce.value = 'open'
}

function collapseAll() {
  treeForce.value = 'closed'
}

function onManualToggle() {
  treeForce.value = null
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
    treeForce.value = null
  }
})

function onBackdrop(e) {
  if (e.target === e.currentTarget) emit('close')
}

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}

function applySearch(q) {
  // count matches in visible text (lightweight)
  const body = document.querySelector('.jm-body')
  if (!body) return
  if (!q || !q.trim()) {
    matchCount.value = -1
    return
  }
  const ql = q.trim().toLowerCase()
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      return n.nodeValue && n.nodeValue.toLowerCase().includes(ql)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT
    },
  })
  let count = 0
  while (walker.nextNode()) count++
  matchCount.value = count
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
          @input="applySearch(searchQ)"
        />
        <span v-if="matchCount >= 0" class="faint">{{ matchCount ? `${matchCount} 处` : '无匹配' }}</span>
        <template v-if="!isLeafValue">
          <button class="btn sm" type="button" title="全部展开" @click="expandAll">全部展开</button>
          <button class="btn sm" type="button" title="全部收起" @click="collapseAll">全部收起</button>
        </template>
        <button v-if="canDrill" class="btn sm" type="button" @click="emit('drill')">钻取</button>
        <button class="btn sm" type="button" @click="emit('close')">关闭</button>
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
}
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
