import { createRouter, createWebHistory } from 'vue-router'

import { MODULES } from '@/data/modules'
import Dashboard from '@/views/Dashboard.vue'
import ModulePage from '@/views/ModulePage.vue'

// 路由由模块元数据生成：新增模块在 modules.ts 加一条，这里和页面都不用动。
const moduleRoutes = MODULES.map((meta) => ({
  path: `/${meta.key}`,
  name: meta.key,
  component: ModulePage,
  meta: { moduleKey: meta.key },
}))

const router = createRouter(
  {
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: Dashboard },
      ...moduleRoutes,
    ],
  },
)

export default router
