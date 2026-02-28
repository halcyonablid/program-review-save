# EVA Incremental Indexer

一个可直接安装的 Obsidian 插件，用来替代手动执行的 `EVA-JSON BUILDER.md`。

它做的事情：

- 监听 `create / modify / rename / delete`
- 用 `sha256` 内容哈希做笔记级增量判断
- 维护 `dirty queue`，防抖批处理
- 维护两层缓存：
  - `byPath[path] -> noteId`
  - `byNoteId[noteId] -> { path, mtime, size, hash, note, links }`
- 导出：
  - `EVA_Notes.json`
  - `EVA_Links.json`
  - `EVA_Indexes.json`
  - `EVA_Indexer_State.json`

## 安装

把这个目录复制到你的 vault 里的：

`.obsidian/plugins/eva-incremental-indexer/`

需要保留这些文件：

- `manifest.json`
- `main.js`
- `styles.css`
- `versions.json`

然后在 Obsidian 里：

1. 打开 `设置`
2. 打开 `第三方插件`
3. 关闭安全模式（如果还没关）
4. 启用 `EVA Incremental Indexer`

## 首次配置

建议先设置：

- `输出目录`
- `兼容模式`

如果你现有页面仍然依赖旧版 `EVA_Notes.json` 里的 `indexes` 字段，保持 `兼容模式 = 开`。

## 命令

插件提供 3 个命令：

- `EVA Incremental Indexer: full rebuild`
- `EVA Incremental Indexer: flush dirty queue`
- `EVA Incremental Indexer: export current state`

## 说明

- 这个插件默认只索引文件名匹配 `^ATOM@` 的 Markdown 文件。
- `rename` 事件会优先复用已有 entry；如果 `noteId` 没变，只更新 path 映射。
- `modify` 事件会先检查 `mtime + size`，变化后再读取内容计算哈希；如果哈希不变，只更新元数据，不重建 note / links。
- `by_tree_visible` 和 `computed.mermaid.hide_in_tree` 会在导出阶段统一计算，因为它们依赖全局 Mermaid 起始点集合。
