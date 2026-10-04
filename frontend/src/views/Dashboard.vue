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
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.key">
          <td>
            <RouterLink :to="`/${row.key}`" class="link">{{ row.name }}</RouterLink>
          </td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器，按模块元数据的状态机实时统计；旧结构数据首次打开自动迁移，不影响已有改动</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const errorMessage = ref('')

function refresh() {
  errorMessage.value = ''
  try {
    // 概览只遍历已登记模块，缺数据按空模块计 0；取数链路本身不向页面抛错。
    const payload = loadOverview()
    cards.value = payload.cards
    moduleRows.value = payload.modules
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '概览统计失败，已保留上一次结果'
  }
}

onMounted(refresh)
</script>
