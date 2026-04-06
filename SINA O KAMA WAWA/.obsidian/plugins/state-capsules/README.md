# State Capsules

Obsidian plugin scaffold for saving and restoring work scenes as capsules.

Current scope:
- Save current capsule
- Overwrite active capsule
- Switch to a saved capsule
- Open a capsule manager modal
- Rename and delete capsules from the modal
- Drag to reorder capsules in the manager modal
- Restore Obsidian workspace layout best-effort
- Restore `workspaceCapsuleBridge`
- Restore `gtdCapsuleBridge`

Plugin files:
- `manifest.json`
- `versions.json`
- `main.js`
- `styles.css`

Local install:
1. Copy this folder to your vault `.obsidian/plugins/state-capsules/`
2. Enable Community Plugins in Obsidian
3. Reload Obsidian
4. Enable `State Capsules`
5. In `Settings -> Hotkeys`, bind `State Capsules: Open capsule manager modal`

Recommended usage:
- Press your hotkey to open the capsule manager modal
- Use `保存当前为新胶囊` to capture the current scene
- Drag cards to arrange your preferred order
- Use each capsule card to `切换 / 重命名 / 删除`

Current limitations:
- Main window only
- Best-effort workspace layout restore
- Depends on the target GTD / workspace notes being renderable in the current vault
