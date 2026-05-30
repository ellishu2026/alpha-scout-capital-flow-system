# AlphaScout Capital Flow System V1.0 项目文书

> 项目状态：V1.0 启动前基准文档  
> 文档日期：2026-05-29  
> 项目定位：全新系统，独立于既有 AlphaScout / RSI / HeatWatch / FlowWatch 项目  
> 备注：项目名称已统一修正为 **Capital**，后续代码、页面和文档均使用该正式名称。

---

## 1. 项目初心

**AlphaScout Capital Flow System V1.0** 的核心初心是：

> 建立一个以“资金驱动 + 财报改善 + 现金流质量”为核心的美股短线强势标的选择系统，帮助从美股市场中筛选出最值得进入观察池的 11 只股票。

该系统不是直接下单系统，也不是完整买卖点系统，而是 **AI Trading Operating System by Ellis** 的前置模块之一，主要解决：

1. 哪些股票正在被资金选择？
2. 哪些股票不仅价格强，而且财务质量有改善？
3. 哪些股票值得进入下一步技术买点、风控和交易计划验证？

系统的长期目标是：

```text
市场全池扫描
→ 资金驱动 Top 11
→ 技术买点确认
→ 风控判断
→ Paper Trading / 小资金验证
→ 复盘迭代
→ 半自动 / 自动交易系统
```

---

## 2. 项目边界

### 2.1 V1.0 做什么

V1.0 聚焦于 **每日收盘快照型选股系统**：

- 建立独立网页系统
- 自动筛选候选池
- 自动获取行情、价格、成交量、市值等数据
- 计算资本流入 proxy
- 接入或预留财报数据结构
- 计算利润率、FCF、资本流入三类评分
- 输出综合分 Top 11
- 每个美股交易日收盘后自动刷新
- 支持公网访问和后续多电脑维护

### 2.2 V1.0 暂不做什么

V1.0 不做：

- 秒级 real-time 行情
- 高频交易
- 自动下单
- 实盘策略参数自动修改
- 未经人工确认的风控绕过
- 复杂机器学习模型
- 分钟级买卖点系统

---

## 3. 核心业务逻辑

### 3.1 筛选池定义

候选池来自两个独立条件：

#### Pool A：中大型成长 / 强势池

```text
总市值：50B–300B USD
```

意义：

- 公司规模足够大
- 流动性通常较好
- 机构参与度较高
- 相比 mega-cap 仍可能有较强弹性

#### Pool B：高股价强势池

```text
全市场股价 > 800 USD
```

意义：

- 高价股往往代表市场长期认可
- 可能包含高质量龙头
- 有利于发现强势价格结构标的

#### Pool C：交叉池

如果某个股票同时满足：

```text
市值 50B–300B
且
股价 > 800 USD
```

则标记为：

```text
Overlap / Both
```

注意：Pool A 和 Pool B 是两个独立筛选条件，不是二选一，也不是必须同时满足。

---

## 4. Top 11 筛选逻辑

系统最终从候选池中筛选出 11 只股票。

综合分由三部分组成：

| 模块 | 权重 | 核心意义 |
|---|---:|---|
| 利润率变化 | 30% | 判断盈利能力是否改善 |
| FCF 现金流变化 | 40% | 判断经营质量和真实现金创造能力 |
| 资本流入 | 30% | 判断市场资金是否正在选择该股票 |

综合分公式：

```text
Composite Score = Margin Score × 30% + FCF Score × 40% + Capital Flow Score × 30%
```

其中现金流权重最高，因为系统认为：

> 短线强势可以由情绪推动，但能够持续走强的股票，通常需要现金流或财务质量改善作为支撑。

---

## 5. 关键指标定义

### 5.1 利润率变化

优先使用财报数据。

建议第一版使用：

```text
Operating Margin
```

原因：

- 比毛利率更能反映经营效率
- 比净利率更少受一次性税务、投资收益影响

计算方式：

```text
Margin QoQ Change = Current Quarter Operating Margin - Previous Quarter Operating Margin
```

### 5.2 FCF 现金流

自由现金流定义：

```text
FCF = Operating Cash Flow - Capital Expenditure
```

变化率：

```text
FCF QoQ % = (Current Quarter FCF - Previous Quarter FCF) / abs(Previous Quarter FCF)
```

特殊处理建议：

| 情况 | 处理建议 |
|---|---|
| 上季 FCF > 0，本季 FCF > 0 | 正常计算 QoQ |
| 上季 FCF < 0，本季 FCF > 0 | 给较高分 |
| 上季 FCF > 0，本季 FCF < 0 | 明显降分 |
| 两季都为负 | 看亏损是否收窄 |
| 上季 FCF 接近 0 | 避免直接用极端百分比，采用保护逻辑 |

### 5.3 资本流入 Proxy

V1.0 不直接购买或接入昂贵 real-time 资金流数据，而是使用公开行情数据构建 capital flow proxy。

基础逻辑：

```text
Daily Capital Flow Proxy = Close Price × Volume × Direction
```

Direction 规则：

```text
if close > previous close:
    flow = close × volume
elif close < previous close:
    flow = -close × volume
else:
    flow = 0
```

计算窗口：

```text
3D  = last 3 trading days
5D  = last 5 trading days
9D  = last 9 trading days
3W  = last 15 trading days
5W  = last 25 trading days
```

资本流入评分建议：

```text
Capital Flow Score =
3D Flow Rank × 30%
+ 5D Flow Rank × 25%
+ 9D Flow Rank × 20%
+ 3W Flow Rank × 15%
+ 5W Flow Rank × 10%
```

这样可以让系统更偏短线，同时保留中短期资金趋势。

---

## 6. 页面显示逻辑

### 6.1 页面标题

```text
AlphaScout Capital Flow System V1.0
```

建议副标题：

```text
Daily Close Snapshot · Margin 30% · FCF 40% · Capital Flow 30%
```

### 6.2 顶部摘要区域

显示：

- Last Updated
- Data Mode: Daily Close Snapshot
- Refresh Mode: Auto Daily Refresh
- Universe: Market Cap $50B–$300B + Price > $800
- Selected: Top 11
- Scoring: Margin 30% · FCF 40% · Capital Flow 30%
- Last Refresh Status

### 6.3 筛选 Tabs

建议保留：

```text
All
Market Cap $50B–$300B
Price > $800
Overlap
```

### 6.4 主表格字段

默认按照 Composite Score 从高到低排序，只显示 Top 11。

字段建议：

| 字段 | 含义 |
|---|---|
| Rank | 排名 |
| Ticker | 股票代码 |
| Pool | 来源池子 |
| Market Cap | 总市值 |
| Price | 当前股价 |
| FCF | 最新自由现金流 |
| FCF QoQ % | FCF 环比变化率 |
| Capital Flow 3D | 3日资本净流入 proxy |
| Capital Flow 5D | 5日资本净流入 proxy |
| Capital Flow 9D | 9日资本净流入 proxy |
| Capital Flow 3W | 3周资本净流入 proxy |
| Capital Flow 5W | 5周资本净流入 proxy |
| Composite Score | 综合分 |
| Margin Change | 利润率变化值 |
| FCF Change % | 现金流变化比例 |
| Capital Flow Change % | 资本流入变化比例 |
| Signal | 最终观察信号 |
| Data Status | 数据质量状态 |

### 6.5 信号定义

建议第一版信号：

| Composite Score | Signal |
|---:|---|
| ≥85 | Strong Candidate |
| 75–85 | Watch |
| 65–75 | Neutral |
| <65 | Weak / Avoid |

也可以进一步结合资金与财务关系：

```text
Strong Flow + Improving Fundamentals
Flow Strong, Fundamentals Mixed
Fundamentals Strong, Flow Weak
Weak / Avoid
```

### 6.6 数据质量状态

建议必须保留 Data Status：

| 状态 | 含义 |
|---|---|
| HIGH | 财报 + 行情数据较完整 |
| MID | 行情完整，财报部分估算 |
| LOW | 主要依赖行情 proxy 或 fallback |
| FALLBACK | API 异常时使用 mock / cached fallback |

---

## 7. 数据刷新频率定义

V1.0 不做 real-time。

正式定义：

```text
Data Mode: Daily Close Snapshot
Refresh Mode: Auto Daily Refresh
```

系统在每个美股交易日收盘后刷新一次。

建议刷新时间：

```text
UTC: 23:10, Monday–Friday
Cron: 10 23 * * 1-5
```

该时间在美股收盘后，适合基于完整日 K 数据生成快照。

### 7.1 刷新频率表

| 数据模块 | 刷新频率 | 建议时间 |
|---|---:|---|
| 股票池 Universe | 每日 1 次 | 美股收盘后 |
| 价格 / 成交量 / 市值 | 每日 1 次 | 美股收盘后 |
| Capital Flow 3D/5D/9D/3W/5W | 每日 1 次 | 美股收盘后 |
| 财报数据 | 每日 1 次检查 | 美股收盘后 |
| 综合评分 Top 11 | 每日 1 次 | 数据刷新后 |
| 页面展示数据 | 随时读取最新 snapshot | 用户访问时 |

### 7.2 页面读取原则

页面不应每次打开都直接请求外部 API。

推荐逻辑：

```text
Vercel Cron 定时触发
→ 拉取外部数据
→ 清洗数据
→ 计算评分
→ 保存 latest snapshot
→ 页面读取 latest snapshot
```

这样可以减少外部 API 压力，提高页面稳定性。

---

## 8. 数据源策略

### 8.1 行情、市值、价格、成交量

第一版建议：

```text
yahoo-finance2
```

用途：

- quote
- marketCap
- price
- volume
- daily historical candles

注意：yahoo-finance2 是非官方社区 API，需要做好错误处理和 fallback。

### 8.2 财报、FCF、利润率

优先方向：

```text
SEC CompanyFacts API
```

用途：

- Operating Cash Flow
- Capital Expenditure
- Revenue
- Operating Income
- Quarterly financial data

备用方向：

```text
Financial Modeling Prep / 其他免费或低成本 API
```

### 8.3 V1.0 数据现实原则

第一版不追求财报解析一次性完美，而是：

```text
先跑通数据架构和页面
再逐步增强 SEC 财报解析
```

V1.0 可以先采用：

- 行情数据：真实数据
- 资本流入：真实行情 proxy
- 财报数据：部分真实 + fallback
- 页面必须明确显示 Data Status

---

## 9. 技术实现方案

### 9.1 推荐技术栈

```text
Next.js
TypeScript
Tailwind CSS
Vercel
GitHub
Supabase 或 Vercel KV
Codex
Terminal
```

### 9.2 部署原则

项目直接部署在公网，方便任何一台有权限的电脑维护。

推荐结构：

```text
GitHub Repo
+ Vercel Auto Deployment
+ Codex for Coding
+ Terminal for Build / Test / Deploy
```

建议 Repo 名称：

```text
alpha-scout-capital-flow-system
```

### 9.3 存储建议

V1.0 可选：

#### 方案 A：Vercel KV

适合快速上线：

- latest_snapshot
- refresh_log
- last_success_time
- last_error

#### 方案 B：Supabase

更适合长期系统：

- snapshots
- snapshot_items
- symbols
- financials
- refresh_logs

长期更建议 Supabase，因为未来需要：

- 历史 Top 11 变化
- 股票连续入榜天数
- 评分趋势
- 资金流趋势
- 复盘对比

---

## 10. 自动刷新设计

### 10.1 Vercel Cron

新增：

```text
/app/api/cron/refresh/route.ts
```

新增 `vercel.json`：

```json
{
  "crons": [
    {
      "path": "/api/cron/refresh",
      "schedule": "10 23 * * 1-5"
    }
  ]
}
```

### 10.2 安全机制

使用环境变量：

```text
CRON_SECRET
```

Route 校验：

```text
Authorization: Bearer ${process.env.CRON_SECRET}
```

避免外部用户随意触发刷新。

### 10.3 Refresh Route 工作内容

```text
1. 获取 Universe 候选池
2. 筛选 Pool A / Pool B / Overlap
3. 获取 quote、market cap、price、volume、historical candles
4. 计算 capital flow proxy
5. 获取或读取缓存财报数据
6. 计算 margin score、FCF score、capital flow score
7. 计算 composite score
8. 排序并选出 Top 11
9. 保存 latest snapshot
10. 写入 refresh log
11. 返回刷新结果
```

### 10.4 手动刷新

页面建议保留：

```text
Manual Refresh
```

用于管理员手动触发刷新。

V1.0 可先做保护型手动刷新，后续再接入更完善的权限控制。

---

## 11. 项目搭建步骤

### 11.1 新建项目

```bash
npx create-next-app@latest alpha-scout-capital-flow-system \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*"
```

进入目录：

```bash
cd alpha-scout-capital-flow-system
```

安装依赖：

```bash
npm install yahoo-finance2
```

### 11.2 本地验证

```bash
npm run lint
npm run build
npm run dev
```

### 11.3 Git 初始化

```bash
git init
git add .
git commit -m "Initial AlphaScout Capital Flow System V1.0"
```

### 11.4 Vercel 部署

```bash
vercel
vercel --prod
```

### 11.5 环境变量

至少预留：

```text
CRON_SECRET=
YAHOO_FINANCE_ENABLED=true
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

如果 V1.0 先不用 Supabase，也应保留后续接入位置。

---

## 12. Codex + Terminal 工作方式

项目推荐采用两个窗口为主：

### 窗口一：Codex

负责：

```text
需求理解
代码编写
代码修改
生成 patch
解释变更
输出自检报告
```

### 窗口二：Terminal

负责：

```text
安装依赖
执行 lint
执行 build
运行 dev
git commit
vercel deploy
生产验证
```

### 标准工作流

```text
1. ChatGPT 输出任务单
2. Codex 根据任务单改代码
3. Terminal 执行验证命令
4. 将 Terminal 输出贴回 ChatGPT
5. ChatGPT 判断是否通过
6. 通过后 git commit
7. 部署到 Vercel
8. 记录变更和问题
```

---

## 13. Codex 第一阶段任务单

可直接复制给 Codex：

```text
Project: AlphaScout Capital Flow System V1.0

Please create a brand-new Next.js + TypeScript + Tailwind project for a public Vercel deployment.

Goal:
Build a US stock capital-flow-driven selection dashboard. This is a new system, not a modification of any existing AlphaScout version.

Core requirements:
1. System name: AlphaScout Capital Flow System V1.0
2. Universe:
   - Pool A: US stocks with market cap between $50B and $300B
   - Pool B: US stocks with price above $800
   - The two pools are independent and may overlap.
3. Selection:
   - Merge and deduplicate candidates from both pools.
   - Calculate a composite score:
     Composite Score = Margin Score * 0.30 + FCF Score * 0.40 + Capital Flow Score * 0.30
   - Output Top 11 symbols sorted by Composite Score descending.
4. Dashboard fields:
   - Rank
   - Ticker
   - Pool
   - Market Cap
   - Price
   - FCF
   - FCF QoQ %
   - Capital Flow 3D
   - Capital Flow 5D
   - Capital Flow 9D
   - Capital Flow 3W
   - Capital Flow 5W
   - Composite Score
   - Margin Change
   - FCF Change %
   - Capital Flow Change %
   - Signal
   - Data Status
5. Data source strategy:
   - Use yahoo-finance2 for quote, market cap, price, volume and daily historical candles.
   - Prepare SEC CompanyFacts integration structure for financial data.
   - If financial data is missing, use fallback values and clearly show Data Status.
6. Capital flow proxy:
   - Use signed dollar volume:
     if close > previous close, flow = close * volume
     if close < previous close, flow = -close * volume
     otherwise flow = 0
   - Calculate 3D, 5D, 9D, 3W, 5W flows.
7. Auto refresh:
   - Add /api/cron/refresh
   - Add vercel.json cron config: 10 23 * * 1-5
   - Protect the route with CRON_SECRET
   - Save latest snapshot and refresh log
8. Snapshot API:
   - Add /api/snapshot/latest
   - Dashboard should read from latest snapshot, not from external APIs directly.
9. UI:
   - Clean white dashboard style.
   - Top summary section.
   - Pool filter tabs: All, Market Cap $50B–$300B, Price > $800, Overlap.
   - Main table sorted by Composite Score.
   - Mobile responsive layout.
10. Engineering:
   - Add clear TypeScript types.
   - Add scoring utility functions.
   - Add mock fallback data so the page can render even if API fails.
   - Run npm run lint and npm run build.
   - Provide a final change summary and validation result.
```

---

## 14. V1.0 验收标准

V1.0 完成时，至少满足：

| 验收项 | 标准 |
|---|---|
| 项目独立 | 新 repo / 新 Vercel 项目，不依赖旧页面 |
| 页面可访问 | 公网 Vercel 地址可打开 |
| 标题正确 | 显示 AlphaScout Capital Flow System V1.0 |
| 数据模式明确 | 显示 Daily Close Snapshot |
| 自动刷新 | Vercel Cron 配置完成 |
| 安全保护 | CRON_SECRET 生效 |
| Snapshot API | `/api/snapshot/latest` 可返回最新数据 |
| 表格完整 | 核心字段全部显示 |
| 排序正确 | 按 Composite Score 降序 |
| Top 11 | 默认只输出 11 只 |
| Fallback | API 失败时页面仍可显示 fallback 数据 |
| 构建通过 | `npm run lint` 和 `npm run build` 通过 |
| 可维护 | Codex 可继续基于项目结构修改 |

---

## 15. 后续版本路线

### V1.0

```text
Daily Close Snapshot
自动刷新
Top 11 页面
基础评分逻辑
Fallback 数据
```

### V1.1

```text
完善 SEC CompanyFacts 财报解析
提高 FCF / Margin 数据质量
增加 refresh log 页面
增加手动刷新权限保护
```

### V1.2

```text
增加历史快照
查看过去 30 天 Top 11 变化
跟踪连续入榜天数
```

### V1.3

```text
增加技术买点模块
EMA / RSI / Volume Breakout / Relative Strength
```

### V2.0

```text
盘中预览
每 60 分钟刷新一次预估榜单
正式评分仍以收盘后快照为准
```

### V3.0

```text
接入更高质量或付费数据源
接入 paper trading
进入交易系统闭环
```

---

## 16. 风控原则

本项目必须遵守 AI Trading Operating System by Ellis 的基本风控原则：

1. AI 可以提出策略、评分和参数修改建议。
2. AI 不能直接绕过风控。
3. AI 不能未经确认直接改实盘参数。
4. 真实下单应由确定性交易引擎和 Risk Gate 执行。
5. V1.0 只做选股，不做自动交易。
6. 任何进入交易执行层的逻辑，必须经过 paper trading 和小资金验证。

---

## 17. 项目复盘原则

每次重要修改后，建议记录：

```text
日期
修改内容
修改原因
验证结果
问题
下一步计划
```

建议文件：

```text
docs/01_PROJECT_CHARTER.md
docs/02_TRADING_RULES.md
docs/03_AGENT_TASK_LOG.md
docs/04_CHANGE_APPROVAL.md
docs/05_DATA_SOURCE_NOTES.md
```

本文件可作为：

```text
docs/01_PROJECT_CHARTER.md
```

---

## 18. 项目初心检查清单

后续每次开发时，都要回到以下问题：

1. 这个改动是否有助于更好发现强势标的？
2. 这个数据是否真实、稳定、可解释？
3. 这个评分是否能避免只追涨而忽略质量？
4. 页面是否让人一眼看懂 Top 11 为什么入选？
5. 系统是否仍然保持简单、稳定、可维护？
6. 是否避免了过早追求 real-time 和复杂模型？
7. 是否为后续交易买点和风控模块留下接口？

项目核心不是炫技，而是：

> 用可持续的数据系统，稳定发现美股市场中真正被资金选择、且具备财务改善基础的强势标的。

---

## 19. 明日启动建议

明天正式开干建议顺序：

```text
1. 新建 repo 和 Next.js 项目
2. 搭建白色简洁 UI + mock Top 11
3. 固定字段、标题、筛选 tabs 和评分展示
4. 增加 scoring utilities
5. 增加 /api/snapshot/latest
6. 增加 /api/cron/refresh 框架
7. 接入 yahoo-finance2 基础行情
8. 跑通 lint / build
9. 部署 Vercel
10. 记录第一版变更报告
```

第一天目标不要追求全部真实数据，而是：

```text
页面跑通
结构跑通
自动刷新框架跑通
评分逻辑跑通
部署跑通
```

之后边做边完善，边对标初心。
