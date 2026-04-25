# Obsidian SMA Client

这是 `obsidian-sma` 项目的 Obsidian 侧最小客户端插件。

当前实现目标：
- 使用插件自己的 `data.json` 维护成员、映射、调度缓存
- 不把 `smId / schedule / sync state` 写回笔记 frontmatter
- 通过本地 SMA bridge 调用：
  - `GET /health`
  - `GET /concepts`
  - `POST /concepts/ensure`
  - `POST /concepts/{smConceptId}/learning-probe`
  - `POST /elements/register`
  - `GET /elements/{smId}`
- 提供最小侧栏面板、命令、设置页

## 当前数据策略

- **唯一状态源**：插件 `data.json`
- **不会自动写入 frontmatter**
- 提供一个“从 `srs: true` 导入成员”的兼容命令，方便迁移旧标记
- Concept 胶囊复用 `supermemo的concept的展示.md` 的 localStorage 数据：
  - key：`supermemo_concepts_final_v3`
  - note 与 concept 的绑定关系仍保存在插件 `data.json`
  - concept 的新增/编辑仍由 `supermemo的concept的展示.md` 专门负责
  - 本插件只读这些 concept，并用于筛选/绑定 note
- SuperMemo 原生 concept 快照与本地 concept → SM concept 映射，也保存在插件 `data.json`
- 本插件不再把共享 concept 写回 `supermemo_concepts_final_v3`
- note 条目现在以 `smConceptId` 作为真实 concept 绑定字段
- Obsidian concept 主要负责专项学习入口与树状导航，不再直接作为条目绑定字段

## 最小使用方式

1. 把本目录作为开发插件放到 Obsidian 插件目录
2. 在设置里填写：
   - `Bridge Base URL`
   - `Bridge Token`
3. 打开命令面板执行：
   - `Obsidian SMA Client: Open SMA panel`
   - `Obsidian SMA Client: Enroll current note`
   - `Obsidian SMA Client: Sync enrolled notes`

## 当前边界

- 当前 `review` 还是 probe，不是真正执行评分；目前用于判断 SMA 侧是 `supports-by-id` 还是 `requires-active-window`
- 当前“今日复习队列”由插件本地 `data.json` 中的 `schedule.nextReview` 计算得出，不依赖 SMA 提供独立 `queue/due` 接口
- 当前 Phase 1 只支持“首次注册 note 时带入主 Concept”
- 已经注册过的条目，如果后来才补 concept 映射，当前只会标记 `pendingConceptSync`，不会直接改写 SMA element
- `concept-learning probe` 当前分为：
  - 安全探测：只做 `SetCurrentConcept`
  - 显式有副作用探测：可尝试推进 SMA 当前学习上下文
- 当前成员进入系统主要靠：
  - 手动 enroll 当前笔记
  - 或一次性导入 `srs: true`
