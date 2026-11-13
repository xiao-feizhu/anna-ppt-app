# PPT 工坊（ppt-studio）

基于 Anna 平台的 AI PPT 制作 App：输入主题，AI 先生成**可编辑的大纲**，确认后一次性生成全部页面的要点与演讲备注，支持逐页修改、单页重新生成，最终导出**真正的 .pptx 文件**，在 PowerPoint / WPS 中继续完善。

## 设计理念

- **大纲先行**：把「结构决策」和「内容撰写」拆成两次调用，用户在中间可以增删、排序、改写每一页，避免一次性黑盒生成后整份返工。
- **成本可控**：一份 PPT 只需 2 次主调用（大纲 + 正文），单页重生成才追加小调用；顶栏实时显示 AI 调用次数与 token 用量。
- **输出可用**：导出为标准 .pptx（PptxGenJS 纯前端生成），自动附封面、结尾页与演讲者备注，而不是只能在网页里看的演示。
- **零额度开发**：支持官方 `anna-app dev --llm mock`，另内置本地静态预览 mock 模式，UI、交互、导出全流程可离线验证。

## 功能清单

- 主题 / 内容页数（4–12）/ 目标受众 / 语言风格 / 补充资料输入
- AI 大纲生成：页标题 + 要点，支持编辑、增删、上下移动
- AI 正文生成：每页 3–5 条要点 + 80–150 字演讲备注，与大纲逐页对齐，缺页自动兜底
- 幻灯片 16:9 实时预览，左侧缩略图导航；标题 / 要点 / 备注编辑即时联动
- 单页重新生成（独立小调用）
- 三种版式配色（商务藏青 / 学术墨绿 / 活力暖橙），预览与导出共用同一主题
- 一键导出 .pptx（封面 + 内容页 + 结尾页，备注写入演讲者备注，页码与页脚齐全）
- 草稿自动保存（Anna KV storage），刷新 / 重开自动恢复；「新建」清空草稿
- 支持聊天中 `#ppt-studio` 唤起时通过 `entryPayload.topic` 预填主题
- 异常处理：JSON 解析失败自动重试 1 次、输出截断提示、额度不足友好提示、网络错误不盲目重试（避免重复计费）

## 技术架构

无构建、原生 ES Module 静态 SPA，完全匹配 Anna App 的 iframe bundle 形态，不依赖任何后端与本地设备权限。

```
anna-ppt-app/
├── manifest.json          # schema 4：UI bundle + view + #mention 提示词
├── app.json               # 商店 listing 元数据（亦可在 Console 网页填写）
└── bundle/
    ├── index.html         # 入口（manifest.ui.bundle.entry）
    ├── styles.css         # 全部样式
    ├── app.js             # 状态机与三阶段 UI（输入 → 大纲 → 正文/导出）
    ├── llm.js             # prompt 设计、JSON 提取与结构校验、调用封装
    ├── pptx.js            # 主题定义与 PptxGenJS 导出（浏览器/Node 通用）
    ├── mock-runtime.js    # 本地静态预览 mock（演示数据，不耗额度）
    └── vendor/
        └── pptxgen.bundle.js  # PptxGenJS 4.0.1（MIT），随包上传避免 CSP 外部依赖
```

关键平台决策：

- AI 调用只使用 `anna.llm.complete`；正文生成 `maxTokens: 12000`，SDK ≥ 0.17 时自动经流式通道传输，规避同步路径 8192 token 上限。
- `required_executas` 为空（bundle-only App），不声明任何 `host_api` 权限，安装即用、审核面最小。
- 草稿存入 `runtimeState`（`storage.set`，≤256 KB），保存前防抖 800ms。

## 本地开发

前置：Node 22+、[uv](https://astral.sh/uv)、`npm i -g @anna-ai/cli`。

```bash
anna-app doctor          # 环境检查
anna-app dev             # 官方调试台（生产同款 dispatcher，热更新）
anna-app dev --llm mock  # AI 调用走 mock，零额度开发
anna-app dev --llm real  # 接真实模型（需配置 PAT，见官方 local-dev-llm 文档）
anna-app validate        # 发布前校验（manifest / UI / tool_id）
```

**纯静态快速预览**（无需 CLI）：直接用任意静态服务器打开 `bundle/`，例如：

```bash
cd bundle && python3 -m http.server 8321
# 浏览器打开 http://localhost:8321/
```

此时无法连接 Anna 宿主 SDK，自动进入「本地预览模式」：AI 返回演示数据、草稿存 localStorage，可完整走通生成 → 编辑 → 导出流程，不消耗任何额度。

## 发布到 Anna staging

1. `anna-app validate` 全绿。
2. Developer Console（`/developer`）创建 App，Listing 页填写名称、slug（`ppt-studio`）、分类、tagline、logo、截图。
3. Versions 页创建 `1.0.0`，粘贴 `manifest.json`，点 Validate 确认 `valid: true`。
4. `anna-app apps push` / `apps cut` 上传 UI bundle（init → PUT → finalize，CLI 自动完成），确认 `bundle_ready`。
5. 自己安装并端到端实测一遍（官方 pre-flight 要求）。
6. Versions 页 Submit for review → 管理员审批 → Publish，状态变为 `PUBLISHED` 后他人可见可装。

文档：https://staging.anna.partners/developers

## 已验证 / 待联调

已验证（本地 mock 环境）：

- 全流程端到端：输入 → 大纲生成与编辑 → 正文生成 → 逐页编辑联动 → 单页重生成 → 导出 → 草稿刷新恢复 → 新建重置
- 导出文件为标准 .pptx，页数 = 内容页 + 2，备注写入正常（Node 与浏览器双环境验证）
- 全部 JS 通过语法检查，浏览器无 JS 运行时错误

待在真实平台联调：

- 真实模型的 JSON 输出稳定性（prompt 已做强约束 + 校验重试，可能需按实际模型微调）
- `anna-app dev --llm real` 与平台内真实额度消耗核对
- 聊天 `#ppt-studio` 唤起与 `entryPayload` 注入
- 商店 logo、截图等 listing 素材

## 范围说明（有意不做）

- AI 配图：图片生成额度成本高、风格不可控，以留白 + 文字版式替代
- 在线协作、动画、模板市场：超出「快速起草可修改的 PPT」这一核心场景

## 第三方依赖

- [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) 4.0.1（MIT License），已随包内置于 `bundle/vendor/`。
