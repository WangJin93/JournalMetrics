# JournalMetrics 更新说明（Changelog）

## v1.2.0 — 2025-09-05

### ✨ 新增功能
- **整次检索全量分析**：在 PubMed 检索结果页点击 **Analyze**，可选择
  - *Analyze current page*：对当前页结果做统计；
  - *Analyze all search results*：通过 NCBI E-utilities（esearch + 分批 esummary，≤3 次/秒）抓取整次检索的 PMID 逐一匹配本地期刊库并统计，带进度条与取消按钮。
- **分析数量上限设置**：新增 Analysis Settings → *Max articles for "Analyze all"*，默认 **1000**（可调 1–10000，插件弹窗中即时保存），超出时按 PubMed 默认排序只分析前 N 条并在统计页注明。
- **统计页大幅升级**
  - 摘要卡片区分：已分析总数 / SCI（JCR/CAS 库内）/ 其他已识别期刊 / 未识别 / 平均 IF / 中位 IF，全部标注口径；
  - 新增学科（JCR Class）分布、OA 分布；
  - 期刊表支持点击表头排序、"显示全部期刊"、期刊名一键跳转 PubMed 站内检索；
  - 新增未识别期刊列表（便于反馈补充数据）与其他已识别期刊列表；
  - 一键**复制英文/中文摘要**、**导出 CSV**（Excel 直接打开，含未识别期刊区段）。
- **分析模态框**：显示当前页条数、识别进度、整次检索命中数与分析上限，避免误用。
- 弹窗新增 *恢复默认设置*、*打开 PubMed* 入口。

### 🎚 筛选与展示
- 过滤面板新增 **TOP 期刊** 与 **OA 状态** 筛选，并为 JCR/CAS/TOP/OA 各选项显示实时数量；
- 过滤状态**按检索式隔离**（不再串扰到其他检索），换检索自动清空；
- 徽章开关**即时生效**，无需刷新页面（修复 storage 监听错误导致的设置不生效问题）。

### 🐛 修复
- 修正统计口径：原先 Total 恒等于 SCI，且未匹配期刊被静默丢弃；现在三类分别计数、全部纳入统计；
- 修复 PubMed 命中总数提取错误（旧逻辑按旧版页面 "of N" 文本解析，现改为解析 `.results-amount .value` 与 `data-results-amount`，并校验不小于页面可见条数）；
- 修复 background service worker 因 ES module 声明写法错误（`"module": true` → `"type": "module"`）无法启动、导致点击分析后统计页无法打开的问题；
- 移除 content 隔离世界中的重复指纹伪装与逐条日志；
- 输出内容统一 HTML 转义、外链 URL 做 http(s) scheme 白名单校验。

---

## v1.0.2 — 初始公开版本

- 期刊信息徽章注入（IF / JCR / CAS / TOP / 自引率 / OA / APC 等，可配置显示）；
- 简单结果过滤（IF 区间 / JCR / CAS）；
- 当前页统计（基础汇总与分布）；
- Access Helper（reCAPTCHA 镜像等，规避 NCBI 反爬校验）。
