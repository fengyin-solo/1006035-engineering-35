<template>
  <section class="page" data-module="apron">
    <header class="page-head">
      <div>
        <h2>机坪安全巡查管理</h2>
        <p class="page-desc">维护巡查记录，围绕巡查编号、巡查区域、巡查人员、发现问题数做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡查记录</button>
        <button class="btn" type="button" @click="exportRows">导出机坪安全巡查清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

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
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无机坪安全巡查数据，可先登记巡查记录</td>
        </tr>
      </tbody>
    </table>

    <section class="todo-panel">
      <h3>待办清单</h3>
      <p v-if="!todos.length" class="empty-state">暂无待处理记录</p>
      <ul v-else class="todo-list">
        <li v-for="todo in todos" :key="String(todo.id)" class="todo-item">
          <span class="todo-summary">{{ todo.summary }}</span>
          <span class="todo-status">{{ todo.status }}</span>
          <button
            v-if="todo.nextAction"
            class="link"
            type="button"
            @click="runTodoAction(todo)"
          >
            {{ todo.nextAction }}
          </button>
        </li>
      </ul>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条机坪安全巡查记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  moduleTodos,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, TodoItem } from '@/data/types'

const meta = moduleMeta('apron')
const columns = ["巡查编号", "巡查区域", "巡查人员", "发现问题数", "整改单号", "巡查时间", "复查日期", "巡查状态"]
const actions = ["开始巡查", "提交整改", "确认复查"]
const statuses = ["待巡查", "巡查中", "待整改", "已复查"]
const summary = ref({ created: 0, pending: 0, abnormal: 0 })
const todos = ref<TodoItem[]>([])
const stats = computed(() => [
  { label: '登记总量', value: summary.value.created },
  { label: '待处理', value: summary.value.pending },
  { label: '异常量', value: summary.value.abnormal },
])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡查记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function runTodoAction(todo: TodoItem) {
  runAction(todo.nextAction, { id: todo.id } as EntryRow)
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    const todoPayload = moduleTodos(meta.key)
    summary.value = todoPayload.stats
    todos.value = todoPayload.todos
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '机坪安全巡查列表读取失败'
  }
}

onMounted(reload)
</script>
