/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

// 记录的最小稳定结构：只有 id 与 status 是登记项。
// pending / abnormal 不再入库，统一由模块元数据的状态机派生（见 stats.ts），
// 避免本地旧结构里的布尔位与状态演进脱节、概览与待办各数出一份。
export type EntryRow = {
  id: number
  status: string
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  // 领域意义上的异常态（如「异常中止」「已作废」）。异常量只认这份登记，
  // 不读记录上的旧布尔位；模块增减状态后在这里加一项，概览自动跟着变。
  abnormalStatuses?: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: ModuleStats[]
}

// 单个模块的统计结论：概览表和模块页待办清单都从这一份结果取数，
// pending 在整个应用里只有这一个计算入口（computeModuleStats）。
export type ModuleStats = {
  key: string
  name: string
  created: number
  pending: number
  abnormal: number
}

// 待办清单条目：与概览同源，id/status 之外只带页面渲染需要的摘要字段。
export type TodoItem = {
  id: number
  status: string
  summary: string
  nextAction: string
}
