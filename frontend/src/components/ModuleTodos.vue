<template>
  <section v-if="meta" class="todo-panel">
    <header class="todo-head">
      <h3 class="todo-title">{{ meta.name }}待办清单</h3>
      <span class="todo-count">待处理 {{ items.length }} 条</span>
    </header>
    <p v-if="!items.length" class="todo-empty">当前没有待处理的{{ meta.entity }}</p>
    <ul v-else class="todo-list">
      <li v-for="item in items" :key="String(item.row.id)" class="todo-item">
        <span class="todo-ref">{{ item.row[meta.fields[0]] ?? item.row.id }}</span>
        <span class="todo-status">{{ item.row.status }}</span>
        <button
          v-if="item.action"
          class="link"
          type="button"
          @click="$emit('action', item.action, item.row.id)"
        >
          {{ item.action }}
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { storeVersion } from '@/data/local-store'
import { findModuleMeta, nextActionFor, pendingList } from '@/api/local-service'

const props = defineProps<{ moduleKey: string }>()
defineEmits<{ (e: 'action', action: string, id: number): void }>()

const meta = computed(() => findModuleMeta(props.moduleKey))
// 先读 storeVersion：任何模块写入或跨标签页同步都会让待办重算，与概览同源。
const items = computed(() => {
  storeVersion.value
  const current = meta.value
  if (!current) {
    return []
  }
  return pendingList(props.moduleKey).map((row) => ({
    row,
    action: nextActionFor(current, String(row.status)),
  }))
})
</script>

<style scoped>
.todo-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.todo-head { display: flex; justify-content: space-between; align-items: baseline; }
.todo-title { font-size: 14px; margin: 0; }
.todo-count { font-size: 12px; color: var(--brand); }
.todo-empty { margin: 8px 0 0; font-size: 13px; color: var(--muted); }
.todo-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.todo-item { display: flex; gap: 10px; align-items: center; font-size: 13px; }
.todo-ref { min-width: 120px; }
.todo-status {
  color: var(--muted);
  background: #eef2f7;
  border-radius: 999px;
  padding: 1px 10px;
}
</style>
