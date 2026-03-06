<%*
// ========== 配置区 ==========
const PLUGIN_ID = "mononote";
const PLUGIN_NAME = "MonoNote";

// 排序用的固定名单
const FIXED_ORDER = [
  "索引和清单.components",
  "树状图以及开展对话使用的.components",
  "视图.components",
  "背后的节点连接关系.md",
  "GTD待办事项管理系统.md",
 "九宫格目标.md",
  "时间统计与评估的视图.md",
  "软件组件们.md"
];

// 延时函数 (毫秒)
const delay = ms => new Promise(res => setTimeout(res, ms));

const pm = app.plugins;

// ============================================================
// 第一步：先关掉 MonoNote (如果开着的话)
// ============================================================
new Notice(`⏳ 步骤 1/3: 正在暂停 ${PLUGIN_NAME}...`);

const wasEnabled = pm.enabledPlugins.has(PLUGIN_ID) || !!pm.plugins[PLUGIN_ID];

if (wasEnabled) {
    await pm.disablePlugin(PLUGIN_ID);
    // 给他 300ms 卸载，稳一点
    await delay(300);
} else {
    // 本来就没开，那就不用关，但为了保险还是等一下
    await delay(100);
}


// ============================================================
// 第二步：执行 Tab 排序 (终极版逻辑：去重 + 归位)
// ============================================================
new Notice(`⏳ 步骤 2/3: 正在整理 Tabs...`);

const rootSplit = app.workspace.rootSplit;
let allRootLeaves = [];

// 1. 获取当前所有 tab
app.workspace.iterateAllLeaves(leaf => {
    if (leaf.getRoot() === rootSplit && leaf.view && leaf.view.file) {
        allRootLeaves.push(leaf);
    }
});

if (allRootLeaves.length > 0) {
    // 2. 构建目标列表
    const fixedFound = [];
    const otherFound = [];
    const seenNames = new Set();

    for (const leaf of allRootLeaves) {
        const name = leaf.view.file.name;
        // 去重逻辑
        if (seenNames.has(name)) continue;
        seenNames.add(name);

        if (FIXED_ORDER.includes(name)) {
            fixedFound.push({ leaf, name, file: leaf.view.file });
        } else {
            otherFound.push({ leaf, name, file: leaf.view.file });
        }
    }

    otherFound.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

    const sortedFixed = [];
    for (const name of FIXED_ORDER) {
        const found = fixedFound.find(item => item.name === name);
        if (found) sortedFixed.push(found);
    }

    const finalTargetList = [...sortedFixed, ...otherFound].map(item => ({
        name: item.name,
        file: item.file,
        pinned: item.leaf.getViewState()?.pinned || false
    }));

    // 3. 找错位点
    let firstWrongIndex = -1;
    let currentLeaves = [];
    app.workspace.iterateAllLeaves(leaf => {
        if (leaf.getRoot() === rootSplit && leaf.view && leaf.view.file) {
            currentLeaves.push(leaf);
        }
    });

    const maxLen = Math.max(currentLeaves.length, finalTargetList.length);
    for (let i = 0; i < maxLen; i++) {
        if (i >= finalTargetList.length || i >= currentLeaves.length || 
            currentLeaves[i].view.file.name !== finalTargetList[i].name) {
            firstWrongIndex = i;
            break;
        }
    }

    // 4. 执行重排
    if (firstWrongIndex !== -1) {
        const leavesToClose = currentLeaves.slice(firstWrongIndex);
        const itemsToReopen = finalTargetList.slice(firstWrongIndex);

        for (const leaf of leavesToClose) leaf.detach();
        
        // 稍微等一下 DOM 刷新
        await delay(100);

        for (const item of itemsToReopen) {
            const newLeaf = app.workspace.getLeaf("tab");
            await newLeaf.openFile(item.file);
            if (item.pinned) newLeaf.setPinned(true);
        }
        // new Notice(`整理完毕，去重重排了 ${itemsToReopen.length} 个`);
    } else {
        // new Notice("顺序完美，无需调整");
    }
}

// 再给排序一点时间稳定下来，防止 MonoNote 上来就捣乱
await delay(500);


// ============================================================
// 第三步：重新开启 MonoNote (暴力加载模式)
// ============================================================
new Notice(`⏳ 步骤 3/3: 正在重启 ${PLUGIN_NAME}...`);

// 1. 先启用配置
await pm.enablePlugin(PLUGIN_ID);

// 2. 等待配置生效
await delay(200);

// 3. 强制加载实例 (如果还没出来)
if (!pm.plugins[PLUGIN_ID]) {
    await pm.loadPlugin(PLUGIN_ID);
}

// 4. 最终确认
if (pm.plugins[PLUGIN_ID]) {
    new Notice(`✅ 全部完成！${PLUGIN_NAME} 已恢复工作`);
} else {
    new Notice(`⚠️ ${PLUGIN_NAME} 启动似乎卡住了，请检查`);
}
-%>