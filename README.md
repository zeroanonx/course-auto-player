# 课程与考试助手

基于 `plasmo-template` 重构的 Chrome / Edge Manifest V3 扩展，用于
`https://hbnun.lsedu.vip`：

- 课程视频自动连播、章节展开、单节完成和刷新续播。
- 考试 / 作业题库作答、DeepSeek 辅助作答、答案预览和目标分数控制。
- 扩展弹窗集中管理 API key、课程偏好和答案库。

## 开发与构建

```bash
pnpm install
pnpm dev
```

生产构建：

```bash
pnpm typecheck
pnpm test
pnpm build
```

构建产物位于 `build/chrome-mv3-prod`。在 `chrome://extensions/` 或
`edge://extensions/` 开启开发者模式，选择“加载已解压的扩展程序”，加载该目录。

## 目录结构

```text
src/
├── background.ts                 # DeepSeek 后台代理
├── content.tsx                   # 注入站点的主 UI
├── popup.tsx                     # 扩展弹窗
├── components/
│   ├── base/                     # 工作台、课程、考试、设置
│   └── ui/                       # shadcn 风格基础组件
├── constants/                    # 题型、接口和存储键
├── features/
│   ├── course/                   # 课程自动连播控制器
│   ├── exam/                     # 试卷、答案、目标分数、批改和接口
│   └── settings/                 # 新旧版本设置迁移
├── hooks/                        # React 外部状态订阅
├── types/                        # 共享业务类型
└── utils/                        # 样式类合并
```

## 考试流程

1. 拉取试卷、作答次数和历史批改记录。
2. 按“标准答案 → 本地题库 → AI → 随机”的优先级生成答案。
3. 启用目标分数时，按整张试卷总分压低预期成绩，并计算随机题全部猜对时的分数上界。
4. 默认打开预览层，可以逐题调整答案，确认后才提交。
5. 提交前记录已有批改历史，只接受本次提交产生的新批改记录。
6. 从新批改结果吸收标准答案到 `chrome.storage.local`。

DeepSeek 请求由 `src/background.ts` 发送，内容脚本只通过
`chrome.runtime.sendMessage` 通信，避免目标页面 CORS 限制。

## 数据与权限

扩展申请以下权限：

- `storage`：保存答案库、API key 和课程偏好。
- `tabs`：从扩展弹窗打开或聚焦站点页面。
- `hbnun.lsedu.vip`：页面 UI 与站点登录态。
- `adulteduapi.lsedu.vip`：读取试卷、提交和查询批改。
- `api.deepseek.com`：后台代理 AI 请求。

API key 保存在浏览器扩展的本地存储中，不会写入仓库。旧版的
`examAiConfig`、`capSettings` 配置和 `examAnswerBank` 答案库会在使用时迁移或继续复用。

## 已知限制

- AI 答案的准确性取决于 DeepSeek 返回结果，提交前仍应核对。
- 主观题不会自动作答。
- 目标分数只能压低可控题目的得分；未作答主观题和随机题会影响最终结果。
- 平台未公开标准答案时，题库路线无法继续吸收答案。
- 原有站点 DOM、接口和真实登录流程仍需在浏览器中做回归验证。

本项目会执行自动播放和答题操作，是否符合课程平台规则需使用者自行判断。
