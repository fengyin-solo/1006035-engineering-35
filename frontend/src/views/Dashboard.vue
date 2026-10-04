<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th><th>待办清单</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.key">
          <td>
            <RouterLink class="link" :to="`/${row.key}`">{{ row.name }}</RouterLink>
          </td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
          <td>
            <RouterLink class="link" :to="`/${row.key}`">
              {{ row.pending > 0 ? `去处理 ${row.pending} 条` : '无待办' }}
            </RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里：首次打开使用示例数据，之后以本机改动为准，清除缓存才会重新播种</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import { loadOverview } from '@/api/local-service'
import { storeVersion } from '@/data/local-store'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
}

// 任何模块写入（动作流转、重置、跨标签页同步）后自动重算，待处理数与各模块待办同源。
watch(storeVersion, refresh, { immediate: true })
</script>
