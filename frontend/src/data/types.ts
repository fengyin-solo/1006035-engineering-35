/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  /** 异常标记：负向动作（撤销/作废/拒绝…）打上后保留，是事实字段，不从状态反推。 */
  abnormal: boolean
  [field: string]: string | number | boolean
}

/** 取数侧看到的行：pending 由元数据末态实时派生，不持久化。 */
export type DerivedEntryRow = EntryRow & {
  pending: boolean
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
}

/** 持久化信封：带版本号与迁移进度，支持断点续跑。 */
export type PersistedEnvelope = {
  version: number
  modules: Record<string, EntryRow[]>
  /** 已完成的模块级迁移步骤，形如 "0001-baseline:flight"。 */
  appliedMigrations: string[]
}

export type PageResult = {
  items: DerivedEntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type ModuleStats = {
  key: string
  name: string
  created: number
  pending: number
  abnormal: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: ModuleStats[]
}
