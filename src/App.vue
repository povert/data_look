<script setup>
import { onMounted, ref } from 'vue'
import Viewer from './Viewer/index.vue'

const route = ref('')
const enterAction = ref({})
const bootError = ref('')

onMounted(() => {
  try {
    if (!window.utools) {
      bootError.value = '未检测到 uTools API。请通过 uTools 开发者工具打开本插件，不要用浏览器直接访问。'
      return
    }
    window.utools.onPluginEnter((action) => {
      route.value = action.code
      enterAction.value = action || {}
    })
    window.utools.onPluginOut(() => {
      route.value = ''
    })
  } catch (e) {
    bootError.value = e && e.message ? e.message : String(e)
  }
})
</script>

<template>
  <div v-if="bootError" class="boot-error">
    <div class="card">
      <strong>插件启动失败</strong>
      <p>{{ bootError }}</p>
    </div>
  </div>
  <Viewer v-else :enter-action="enterAction" />
</template>

<style scoped>
.boot-error {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg, #f6f7f9);
  color: var(--text, #1f2937);
}
.card {
  max-width: 480px;
  background: var(--panel, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 12px;
  padding: 20px;
}
.card p {
  margin: 10px 0 0;
  color: var(--muted, #6b7280);
  line-height: 1.6;
  font-size: 13px;
}
</style>
