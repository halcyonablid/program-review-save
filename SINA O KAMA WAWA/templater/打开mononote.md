<%*
const PLUGIN_ID = "mononote";
const PLUGIN_NAME = "MonoNote";
const pm = app.plugins;

// 1. 先检查是否安装
if (!pm.manifests[PLUGIN_ID]) {
    new Notice(`❌ 找不到插件：${PLUGIN_NAME}`);
    return;
}

try {
    // 2. 无论当前是否 enable，先强制 disable 一次，清理状态
    // 注意：如果你想做纯“开启”脚本，这一步可以保留，
    // 因为“先关再开”是解决“假死”状态的最好办法。
    if (pm.enabledPlugins.has(PLUGIN_ID)) {
        await pm.disablePlugin(PLUGIN_ID);
        // 给一点点时间让它卸载
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    // 3. 启用插件 (只是修改配置，把开关打开)
    await pm.enablePlugin(PLUGIN_ID);

    // 4. 【关键一步】强制加载插件实例
    // 有时候 enablePlugin 只是把 ID 加到了白名单，没去加载 main.js
    // 我们手动触发 loadPlugin
    if (!pm.plugins[PLUGIN_ID]) {
        await pm.loadPlugin(PLUGIN_ID);
    }

    // 5. 再次检查实例是否存在，确保真的活了
    if (pm.plugins[PLUGIN_ID]) {
        new Notice(`🟢 ${PLUGIN_NAME} 启动成功 (已重载)`);
    } else {
        new Notice(`⚠️ ${PLUGIN_NAME} 已启用但加载失败，请重启 Obsidian`);
    }

} catch (e) {
    new Notice(`❌ 错误: ${e.message}`);
    console.error(e);
}
-%>