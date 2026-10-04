# 机场地面保障作业管理平台

面向航班保障、机位分配、廊桥靠接、摆渡车调度、行李装卸、航油加注、除冰作业与延误处置的一体化机场地面保障作业工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 概览取数链路

数据链路是单向的四个环节，后一环只消费前一环，概览页面本身不算任何业务数：

```text
模块元数据 modules.ts
   │  字段 / 状态表 / 动作流转 / abnormalStatuses 的唯一登记处
   ▼
本地种子 seed.ts（SEED_ROWS 生成原貌，落库前过 NORMALIZED_SEED_ROWS 归一）
   │
   ▼
持久化层 local-store.ts  ──启动时──▶  migrations.ts（版本信封 { version, rows } + 按模块检查点迁移）
   │  缺模块读成空数组；JSON 损坏备份现场后按空库处理，不整页报错
   ▼
统计口径层 stats.ts（computeModuleStats / listModuleTodos 是全应用唯一的 pending/abnormal 计算入口）
   │
   ├──▶ local-service.loadOverview()：四张指标卡 + 按模块统计表
   └──▶ local-service.moduleTodos()：各模块页待办清单（与概览同一口径）
```

模块元数据增减模块或状态后，概览表、指标卡、模块待办自动跟随，不用回头改页面；
存储里多出元数据已删除的遗留模块数据时，它不进统计也不报错，数据仍原样保留在本地。

### 数据口径与迁移裁决

- **以模块元数据的状态机为唯一口径**。记录只持久化 `id / status` 与业务字段；
  `pending`（待处理）= `status` 不是该模块状态表的最后一个（终态）；
  `abnormal`（异常量）= `status` 命中元数据显式登记的 `abnormalStatuses`。
- 旧结构记录上的 `pending / abnormal` 布尔位在 v1 迁移中删除，不再参与统计。
  裁决依据：状态机是全仓库唯一被显式登记、且状态流转也依赖的事实源；布尔位只是派生缓存，
  种子数据里它已经和状态机漂移（如「空闲」被标待处理、「占用中」被标异常），
  留着只会让概览与待办各数一份。业务字段迁移中一律不动。
- 迁移可重复执行、可断点续跑：按模块推进，每处理完一个模块就同时落数据和检查点
  （`airport-ground-ops:migration`），中断后重跑从下一个模块继续；变换本身幂等
  （按 id 去重保留首条、只补缺、删派生位），重跑不产生重复记录、不覆盖用户改动。
- 无法识别的旧状态不猜含义，归一到该模块状态表第一个状态；损坏的存储内容备份到
  `airport-ground-ops:entries-corrupt-backup` 后按空库继续。

数据层行为可用 `cd frontend && npm run verify:data` 验证（内存 KV 模拟 localStorage，
覆盖迁移幂等、断点续跑、容错与概览/待办同口径）。


## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev          # 开发
npm run build        # 类型检查 + 生产构建（dist/）
npm run verify:data  # 数据层取数/迁移行为验证
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。
也可以在仓库根目录用 `make frontend` / `make build`。

生产构建：

```bash
cd frontend
npm run build
```

构建只产出静态资源到 `frontend/dist/`（已被 `.gitignore` 忽略）；数据只存在于访问者浏览器的
localStorage，仓库与构建产物中都不含任何本地运行数据。

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 航班保障 | `flight` | 航班保障任务 | 保障编号、航班号、机型 |
| 机位分配 | `stand` | 停机位 | 机位编号、机位类型、适用机型 |
| 廊桥靠接 | `bridge` | 廊桥作业 | 作业编号、廊桥编号、对应机位 |
| 摆渡车调度 | `shuttle` | 摆渡车 | 车辆编号、核载人数、驾驶员 |
| 行李装卸 | `baggage` | 行李作业 | 作业编号、航班号、行李件数 |
| 机务勤务 | `line` | 勤务任务 | 任务编号、航班号、勤务项目 |
| 航油加注 | `fueling` | 加油作业 | 作业编号、航班号、油品规格 |
| 除冰作业 | `deice` | 除冰任务 | 任务编号、航班号、除冰液型号 |
| 地面电源 | `gpu` | 电源车 | 设备编号、设备类型、功率等级 |
| 航空器牵引 | `tow` | 牵引任务 | 任务编号、航班号、牵引车号 |
| 航空配餐 | `catering` | 配餐作业 | 作业编号、航班号、餐食数量 |
| 客舱清洁 | `cabin` | 清洁作业 | 作业编号、航班号、清洁班组 |
| 保障班组 | `team` | 保障班组 | 班组编号、班组名称、负责区域 |
| 特种车辆维保 | `vehmaint` | 维保记录 | 维保单号、车辆编号、维保类型 |
| 要客保障 | `vip` | 要客保障单 | 保障编号、航班号、要客等级 |
| 延误处置 | `delay` | 延误事件 | 事件编号、航班号、延误原因 |
| 机坪安全巡查 | `apron` | 巡查记录 | 巡查编号、巡查区域、巡查人员 |
| 保障资源调度 | `resplan` | 资源计划 | 计划编号、保障时段、机位需求 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `airport-ground-ops:entries` 这一项，或调用 `resetModule(模块)`。
