<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  value: { type: null, default: null },
  nodeKey: { type: [String, Number], default: null },
  depth: { type: Number, default: 0 },
  /** null=交互模式; 'open'=强制全展开; 'closed'=强制全收起 */
  forceMode: { type: String, default: null },
})

const emit = defineEmits(['manual-toggle'])

const MAX = 2000
const folded = ref(props.depth >= 1)

const isFolded = computed(() => {
  if (props.forceMode === 'open') return false
  if (props.forceMode === 'closed') return true
  return folded.value
})

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

function isContainer(v) {
  return Array.isArray(v) || isObj(v)
}

function entries(v) {
  if (Array.isArray(v)) return v.map((vv, i) => [i, vv])
  if (isObj(v)) return Object.entries(v)
  return []
}

function keyLabel(k) {
  if (k == null) return null
  return typeof k === 'number' ? String(k) : JSON.stringify(String(k))
}

function scalarHtml(v) {
  if (v === null || v === undefined) return { cls: 'null', text: 'null' }
  if (typeof v === 'boolean') return { cls: 'bool', text: String(v) }
  if (typeof v === 'number') return { cls: 'num', text: String(v) }
  if (typeof v === 'string') {
    const t = v.length > 20000 ? v.slice(0, 20000) + '…(截断)' : v
    return { cls: 'str', text: JSON.stringify(t) }
  }
  return { cls: 'str', text: String(v) }
}

function toggle() {
  emit('manual-toggle')
  folded.value = !isFolded.value
}

const pad = () => props.depth * 16 + 'px'
</script>

<template>
  <template v-if="!isContainer(value)">
    <div class="jt-row jt-lf" :style="{ paddingLeft: pad() }">
      <template v-if="nodeKey != null">
        <span class="jt-key" :class="{ idx: typeof nodeKey === 'number' }">{{ keyLabel(nodeKey) }}</span>
        <span class="jt-colon">: </span>
      </template>
      <span :class="'jt-' + scalarHtml(value).cls">{{ scalarHtml(value).text }}</span>
    </div>
  </template>
  <div v-else-if="entries(value).length === 0" class="jt-row" :style="{ paddingLeft: pad() }">
    <template v-if="nodeKey != null">
      <span class="jt-key" :class="{ idx: typeof nodeKey === 'number' }">{{ keyLabel(nodeKey) }}</span>
      <span class="jt-colon">: </span>
    </template>
    <span class="jt-open">{{ Array.isArray(value) ? '[]' : '{}' }}</span>
  </div>
  <div v-else class="jt-node" :class="{ folded: isFolded }">
    <div class="jt-row jt-head" :style="{ paddingLeft: pad() }" @click="toggle">
      <span class="jt-caret" :class="{ open: !isFolded }">▸</span>
      <template v-if="nodeKey != null">
        <span class="jt-key" :class="{ idx: typeof nodeKey === 'number' }">{{ keyLabel(nodeKey) }}</span>
        <span class="jt-colon">: </span>
      </template>
      <span class="jt-open">{{ Array.isArray(value) ? '[' : '{' }}</span>
      <span v-if="isFolded" class="jt-folded">
        {{ Array.isArray(value) ? `… ${value.length} 项]` : `… ${Object.keys(value).length} 键}` }}
      </span>
    </div>
    <div v-show="!isFolded" class="jt-children">
      <template v-for="(e, i) in entries(value).slice(0, MAX)" :key="i">
        <JsonTree
          :value="e[1]"
          :node-key="e[0]"
          :depth="depth + 1"
          :force-mode="forceMode"
          @manual-toggle="emit('manual-toggle')"
        />
      </template>
      <div
        v-if="entries(value).length > MAX"
        class="jt-row faint"
        :style="{ paddingLeft: (depth + 1) * 16 + 'px' }"
      >
        … 还有 {{ entries(value).length - MAX }} 项未渲染
      </div>
      <div class="jt-row jt-close" :style="{ paddingLeft: pad() }">
        {{ Array.isArray(value) ? ']' : '}' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.jt-row {
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.35;
  color: var(--text);
  padding-right: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.jt-head { cursor: pointer; border-radius: 3px; }
.jt-head:hover { background: var(--panel2); }
.jt-caret {
  display: inline-block;
  width: 10px;
  color: var(--faint);
  text-align: center;
  font-size: 9px;
  transition: transform 0.12s;
}
.jt-caret.open { transform: rotate(90deg); }
.jt-key { color: var(--accent); }
.jt-key.idx { color: var(--faint); }
.jt-colon, .jt-open, .jt-close, .jt-folded { color: var(--muted); }
.jt-str { color: var(--ok); white-space: pre-wrap; word-break: break-word; }
.jt-num { color: #e0833a; }
.jt-bool { color: #c084fc; }
.jt-null { color: var(--faint); font-style: italic; }
</style>
