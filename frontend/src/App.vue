<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">机场地面保障作业管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向航班保障、机位分配、廊桥靠接、摆渡车调度、行李装卸、航油加注、除冰作业与延误处置的一体化机场地面保障作业工作台。</span>
        <span class="head-user">当前值班：{{ store.operator }} · {{ store.shiftLabel }}</span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { MODULES } from '@/data/modules'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

// 导航由模块元数据生成，模块增减后自动跟着变，不用回头改页面。
const navItems = [
  { label: '运营概览', path: '/' },
  ...MODULES.map((meta) => ({ label: meta.name, path: `/${meta.key}` })),
]
</script>
