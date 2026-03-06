<%*
const PLUGIN_ID = "mononote";
const PLUGIN_NAME = "MonoNote";
const pm = app.plugins;

if (!pm.manifests[PLUGIN_ID]) {
    new Notice(`❌ 未安装: ${PLUGIN_NAME}`);
    return;
}

// === 诊断逻辑 ===
// 1. 配置层面是否开启？
const configEnabled = pm.enabledPlugins.has(PLUGIN_ID);
// 2. 内存层面是否有实例？(这才是插件真的在跑的标志)
const instanceRunning = !!pm.plugins[PLUGIN_ID];

// 综合判断：只要配置开了，或者实例在跑，都算"开启状态"
// 这样能避免"配置关了但实例还在"的假死状态干扰判断
const isAlive = configEnabled || instanceRunning;

try {
    if (isAlive) {
        // === 正在运行 -> 关掉它 ===
        await pm.disablePlugin(PLUGIN_ID);
        
        // 既然关了，就应该确保实例也没了，虽然 disablePlugin 会做，但我们确认一下
        if (pm.plugins[PLUGIN_ID]) {
            // 这一步通常不需要手动做，但为了保险...
            // await pm.unloadPlugin(PLUGIN_ID); // 有风险，通常交给 disablePlugin 即可
        }
        
        new Notice(`🔴 ${PLUGIN_NAME} 已禁用`);

    } else {
        // === 没在运行 -> 开启它 ===
        await pm.enablePlugin(PLUGIN_ID);
        
        // 强制加载逻辑
        if (!pm.plugins[PLUGIN_ID]) {
            await pm.loadPlugin(PLUGIN_ID);
        }
        
        new Notice(`🟢 ${PLUGIN_NAME} 已启用`);
    }
} catch (e) {
    new Notice(`❌ 错误: ${e.message}`);
    console.error(e);
}
-%>
