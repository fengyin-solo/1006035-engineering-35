<template>
  <section v-if="meta" class="page" :data-module="meta.key">
    <header class="page-head">
      <div>
        <h2>{{ meta.name }}管理</h2>
        <p class="page-desc">{{ meta.desc }}</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记{{ meta.entity }}</button>
        <button class="btn" type="button" @click="exportRows">导出{{ meta.name }}清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <ModuleTodos :module-key="meta.key" @action="runActionById" />

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in meta.fields" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in meta.fields" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in meta.actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="meta.fields.length + 2" class="empty-state">
            暂无{{ meta.name }}数据，可先登记{{ meta.entity }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条{{ meta.entity }}记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
  <section v-else class="page">
    <h2>模块不存在</h2>
    <p class="page-desc">该业务模块尚未登记，页面按空模块处理，不影响其他模块取数。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import ModuleTodos from '@/components/ModuleTodos.vue'
import {
  downloadEntries,
  findModuleMeta,
  listEntries,
  moduleSummary,
  runAction as applyAction,
} from '@/api/local-service'
import { storeVersion } from '@/data/local-store'
import type { DerivedEntryRow } from '@/data/types'

// 一个页面承载所有模块：字段/状态/动作/指标全部来自模块元数据，元数据增减不用改页面。
const route = useRoute()
const moduleKey = computed(() => String(route.meta.moduleKey ?? ''))
const meta = computed(() => findModuleMeta(moduleKey.value))

const rows = ref<DerivedEntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const filterFields = computed(() => meta.value?.fields.slice(0, 3) ?? [])
const statusSummary = computed(() => {
  const current = meta.value
  if (!current) {
    return []
  }
  return current.statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  }))
})

// 指标卡口径与概览完全一致（登记总量/待处理/异常量），不再各写一份恒为 0 的数字。
const stats = computed(() => {
  const summary = moduleSummary(moduleKey.value)
  return [
    { label: '登记总量', value: summary?.created ?? 0 },
    { label: '待处理', value: summary?.pending ?? 0 },
    { label: '异常量', value: summary?.abnormal ?? 0 },
  ]
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  if (!meta.value) {
    return
  }
  downloadEntries(meta.value.key)
}

function openCreate() {
  errorMessage.value = `${meta.value?.entity ?? '业务对象'}登记入口尚未接入审批流`
}

function runActionById(action: string, id: number) {
  const row = rows.value.find((item) => Number(item.id) === id)
  if (row) {
    runAction(action, row)
  }
}

function runAction(action: string, row: DerivedEntryRow) {
  if (!meta.value) {
    return
  }
  errorMessage.value = ''
  const result = applyAction(meta.value.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  if (!meta.value) {
    rows.value = []
    total.value = 0
    return
  }
  try {
    const payload = listEntries(meta.value.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : `${meta.value.name}列表读取失败`
  }
}

watch(moduleKey, () => {
  filters.value = {}
  reload()
})

// storeVersion 变化（动作流转、重置、跨标签页写入）后重取，指标卡与待办同步刷新。
watch(storeVersion, () => reload())

reload()
</script>
