/**
 * 数据层行为验证（不是单测框架，零依赖）：
 * 用内存 KV 模拟 localStorage，覆盖旧结构迁移、幂等重跑、断点续跑、
 * 缺模块/损坏数据容错、概览与待办同口径等关键结论。
 * 运行：npm run verify:data（经 esbuild 转译后用 node 执行）。
 */
import { bindKV, listRows, resetAll, storageKey } from '../src/data/local-store'
import { runMigrations, MIGRATION_STATE_KEY, CORRUPT_BACKUP_KEY, CURRENT_VERSION } from '../src/data/migrations'
import { MODULES } from '../src/data/modules'
import { computeModuleStats } from '../src/data/stats'
import { loadOverview, moduleTodos, runAction } from '../src/api/local-service'
import type { EntryRow } from '../src/data/types'

class MemoryKV {
  private map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
  keys(): string[] {
    return [...this.map.keys()]
  }
}

let passed = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    console.error(`  ✗ ${name} ${detail}`)
    process.exitCode = 1
  }
}

const KEY = storageKey()

// --- 1. 旧结构（无版本信封 + 布尔位 + 重复 id + 非法状态）迁移 ---
{
  console.log('1. 旧结构迁移到状态机口径')
  const kv = new MemoryKV()
  kv.setItem(KEY, JSON.stringify({
    flight: [
      { id: 1, status: '待接收', pending: true, abnormal: false, 保障编号: 'F-1' },
      { id: 2, status: '保障中', pending: true, abnormal: true, 保障编号: 'F-2' },
      { id: 2, status: '保障中', pending: true, abnormal: true, 保障编号: 'F-2-重复' },
      { id: 3, status: '已终止', pending: false, abnormal: false, 保障编号: 'F-3' },
      { id: 4, status: '某个旧版本状态', pending: true, 保障编号: 'F-4' },
    ],
    // 元数据里已删除的遗留模块
    legacyModule: [{ id: 1, status: 'x', pending: true }],
  }))
  bindKV(kv)
  const rows = listRows('flight')
  check('重复 id 去重保留第一条', rows.length === 4 && rows[1]['保障编号'] === 'F-2', `len=${rows.length}`)
  check('非法状态回退到首状态，不猜旧布尔位', rows[3].status === '待接收', `got=${rows[3].status}`)
  check('合法状态原样保留、不覆盖已有改动', rows[2].status === '已终止')
  check('pending/abnormal 布尔位已移除',
    rows.every((r) => !('pending' in r) && !('abnormal' in r)))
  check('业务字段不动', rows[0]['保障编号'] === 'F-1')
  const envelope = JSON.parse(kv.getItem(KEY)!)
  check('信封版本号写到当前版本', envelope.version === CURRENT_VERSION)
  check('遗留模块不进模块统计但数据未丢', Array.isArray(envelope.rows.legacyModule))
}

// --- 2. 重复执行迁移：无重复记录、不覆盖改动 ---
{
  console.log('2. 迁移可重复执行')
  const kv = new MemoryKV()
  kv.setItem(KEY, JSON.stringify({ flight: [
    { id: 1, status: '待接收', pending: true, 保障编号: 'F-1' },
    { id: 2, status: '保障中', pending: false, 保障编号: 'F-2' },
  ] }))
  bindKV(kv)
  const before = listRows('flight')
  const once = JSON.stringify(before)
  // 模拟用户改动
  runAction('flight', 1, '接收任务')
  const afterUserAction = JSON.parse(kv.getItem(KEY)!).rows.flight
  // 再跑一次迁移（已是最新版本，应完全 no-op）
  const env = runMigrations(kv, KEY, MODULES)
  check('二次迁移不新增记录', env.rows.flight.length === 2)
  check('二次迁移不覆盖用户改动',
    afterUserAction.find((r: EntryRow) => r.id === 1).status === '保障中' &&
    env.rows.flight.find((r) => r.id === 1).status === '保障中')
  check('二次迁移结果稳定', JSON.stringify(env.rows.flight) === JSON.stringify(afterUserAction))
  void once
}

// --- 3. 断点续跑：处理到一半中断后重跑 ---
{
  console.log('3. 中断后续跑，从失败处同一个模块继续')
  const kv = new MemoryKV()
  // 构造「v1 处理完前 3 个模块就中断」的现场：信封仍 v0（版本最后才提升），
  // 检查点停在第 3 个模块。
  const partialKeys = MODULES.slice(0, 3).map((m) => m.key)
  const partialRows: Record<string, unknown> = {}
  for (const m of MODULES) {
    const row: Record<string, unknown> = { id: 1, status: m.statuses[0], [m.fields[0]]: `${m.key}-1` }
    if (!partialKeys.includes(m.key)) row.pending = true // 未处理模块仍是旧结构
    partialRows[m.key] = [row]
  }
  kv.setItem(KEY, JSON.stringify({ version: 0, rows: partialRows }))
  kv.setItem(MIGRATION_STATE_KEY, JSON.stringify({
    currentVersion: 1,
    doneKeysByVersion: { 1: partialKeys },
  }))
  // 统计迁移过程中的数据写入次数：每个未处理模块 1 次 + 版本收尾 1 次；
  // 已完成模块若被错误重放会多出写入。
  let dataWrites = 0
  const baseSet = kv.setItem.bind(kv)
  kv.setItem = (k: string, v: string) => {
    if (k === KEY) dataWrites += 1
    baseSet(k, v)
  }
  bindKV(kv)
  const env = runMigrations(kv, KEY, MODULES)
  const undoneCount = MODULES.length - partialKeys.length
  check(`续跑只为未处理模块落盘（${undoneCount} 次模块写入 + 1 次版本收尾）`,
    dataWrites === undoneCount + 1, `实际写入 ${dataWrites} 次`)
  check('未处理模块完成迁移',
    MODULES.slice(3).every((m) => !('pending' in (env.rows[m.key][0] as object))))
  check('续跑后版本推进到 v1', env.version === 1)
  const state = JSON.parse(kv.getItem(MIGRATION_STATE_KEY)!)
  check('检查点覆盖全部模块',
    state.doneKeysByVersion[1].length === MODULES.length)
  check('已处理模块的业务数据未变',
    env.rows[MODULES[0].key][0][MODULES[0].fields[0]] === `${MODULES[0].key}-1`)
}

// --- 3b. 真实崩溃模拟：迁移写到第 4 个模块的数据落盘后抛错，再重跑 ---
{
  console.log('3b. 真实写到一半崩溃后重试')
  class CrashAfterWrites extends MemoryKV {
    private countMigrationWrites = false
    constructor(private crashAt: number) {
      super()
    }
    /** 预置完旧数据后调用：之后对数据键的写入才计入崩溃次数。 */
    arm(): void {
      this.countMigrationWrites = true
    }
    override setItem(key: string, value: string): void {
      super.setItem(key, value)
      if (key === KEY && this.countMigrationWrites) {
        this.crashAt -= 1
        if (this.crashAt === 0) throw new Error('模拟浏览器崩溃/页面关闭')
      }
    }
  }
  const rows: Record<string, unknown> = {}
  for (const m of MODULES) {
    rows[m.key] = [{ id: 1, status: m.statuses[0], pending: true, [m.fields[0]]: `${m.key}-1` }]
  }
  const crashKV = new CrashAfterWrites(5)
  crashKV.setItem(KEY, JSON.stringify(rows)) // 预置旧数据（不计入崩溃计数）
  crashKV.arm()
  let crashed = false
  try {
    runMigrations(crashKV, KEY, MODULES)
  } catch (error) {
    crashed = error instanceof Error
  }
  check('迁移在第 5 个模块数据落盘后被打断（前 4 个已带检查点）', crashed)
  const partialState = JSON.parse(crashKV.getItem(MIGRATION_STATE_KEY)!)
  check('检查点真实写成「v1 进行中 + 已完成 4 个模块」',
    partialState.currentVersion === 1 && partialState.doneKeysByVersion[1].length === 4,
    JSON.stringify(partialState))
  // 用同一个 KV 重跑（续跑）
  const env = runMigrations(crashKV, KEY, MODULES)
  check('重试后全部模块迁移完成',
    MODULES.every((m) => !('pending' in (env.rows[m.key][0] as object))))
  check('重试后版本为 v1', env.version === 1)
  // 再跑一次：无任何数据写入（完全 no-op）
  let writes = 0
  const countSet = crashKV.setItem.bind(crashKV)
  crashKV.setItem = (k: string, v: string) => {
    if (k === KEY) writes += 1
    countSet(k, v)
  }
  runMigrations(crashKV, KEY, MODULES)
  check('已是最新版本时重跑零写入', writes === 0, `writes=${writes}`)
}

// --- 4. 损坏数据 / 缺模块 / 空存储：绝不整页报错 ---
{
  console.log('4. 容错：损坏、缺模块、空存储')
  const kv = new MemoryKV()
  kv.setItem(KEY, '{不是合法JSON,,,')
  bindKV(kv)
  let overview: ReturnType<typeof loadOverview> | null = null
  let threw = false
  try {
    overview = loadOverview()
  } catch {
    threw = true
  }
  check('损坏数据下概览不抛错', !threw)
  check('损坏数据现场被备份', kv.getItem(CORRUPT_BACKUP_KEY) !== null)
  check('所有模块按空模块计 0',
    overview!.modules.length === MODULES.length &&
    overview!.cards.every((c) => c.label === '业务模块' ? c.value === MODULES.length : c.value === 0))
  check('缺模块 listRows 返回空数组', Array.isArray(listRows('不存在的模块')) && listRows('不存在的模块').length === 0)
  check('缺模块统计安全', computeModuleStats(MODULES[0], undefined).created === 0)
}

// --- 5. 概览与待办同口径 ---
{
  console.log('5. 待处理数全应用只有一份（概览 == 模块待办）')
  bindKV(new MemoryKV()) // 空存储 -> 首次播种
  const overview = loadOverview()
  for (const mod of overview.modules) {
    const { stats, todos } = moduleTodos(mod.key)
    check(`模块 ${mod.key} 待办条数 == 概览待处理数`, todos.length === mod.pending,
      `${todos.length} != ${mod.pending}`)
    check(`模块 ${mod.key} 统计与概览一致`,
      stats.pending === mod.pending && stats.abnormal === mod.abnormal && stats.created === mod.created)
  }
  const totalPending = overview.modules.reduce((s, m) => s + m.pending, 0)
  check('卡片待处理 = 各模块求和',
    overview.cards.find((c) => c.label === '待处理')!.value === totalPending)
  // 待办动作走真实流转，流转后两边同步变化
  const firstTodo = moduleTodos('flight').todos[0]
  runAction('flight', firstTodo.id, firstTodo.nextAction)
  const overview2 = loadOverview()
  const after = moduleTodos('flight')
  check('流转后概览与待办同步减少',
    after.todos.length === after.stats.pending &&
    after.stats.pending === overview2.modules.find((m) => m.key === 'flight')!.pending)
  // 异常口径：bridge 的「异常中止」是登记的异常态
  const bridgeMeta = MODULES.find((m) => m.key === 'bridge')!
  check('异常量只认登记的异常态',
    computeModuleStats(bridgeMeta, [{ id: 1, status: '异常中止' }] as EntryRow[]).abnormal === 1 &&
    computeModuleStats(bridgeMeta, [{ id: 1, status: '已靠桥' }] as EntryRow[]).abnormal === 0)
}

// --- 6. 元数据增删模块，统计自动跟着变 ---
{
  console.log('6. 统计只遍历元数据，不回头改页面')
  resetAll()
  const overview = loadOverview()
  check('模块行数 == 元数据模块数', overview.modules.length === MODULES.length)
  check('每个模块都可点进待办（带 key）', overview.modules.every((m) => typeof m.key === 'string'))
}

console.log(`\n${passed} 项检查通过`)
if (process.exitCode) {
  console.error('存在失败项')
} else {
  console.log('全部通过')
}
