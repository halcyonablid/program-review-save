<%*
// 辅助函数：检查文件是否包含 parent 内联属性
async function hasParentProperty(file) {
    const content = await app.vault.read(file);
    const parentRegex = /parent::.*?(?:\n|$)/;
    return parentRegex.test(content);
}

// 获取所有符合条件的文件
const allFiles = app.vault.getMarkdownFiles();
const files = [];

for (const file of allFiles) {
    if (file.name.startsWith("ZL@") && await hasParentProperty(file)) {
        files.push(file);
    }
}

// 创建一个可更新的通知作为进度条
let progressNotice = new Notice("处理进度: 0%", 0);

// 更新进度条的函数
function updateProgress(current, total) {
    const percentage = Math.round((current / total) * 100);
    const progressBar = "█".repeat(percentage / 5) + "░".repeat(20 - percentage / 5);
    progressNotice.setMessage(`处理进度: ${percentage}% ${progressBar} (${current}/${total})`);
}

// 遍历文件并更新 YAML 前置元数据
for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const content = await app.vault.read(file);
    
    // 解析现有的 YAML 前置元数据
    let yamlRegex = /^---\n([\s\S]*?)\n---/;
    let yamlMatch = content.match(yamlRegex);
    let yaml = yamlMatch ? yamlMatch[1] : '';
    
    // 检查是否已存在 antinet 属性
    if (!/^antinet:.*$/m.test(yaml)) {
        // 如果不存在，添加 antinet: atom
        yaml = yaml.trim() + '\nantinet: atom';
    }
    
    // 构建新的文件内容
    let newContent;
    if (yamlMatch) {
        // 如果原文件有 YAML 前置元数据，更新它
        newContent = content.replace(yamlRegex, `---\n${yaml.trim()}\n---\n`);
    } else {
        // 如果原文件没有 YAML 前置元数据，添加新的
        newContent = `---\n${yaml.trim()}\n---\n${content}`;
    }
    
    // 写入更新后的内容
    await app.vault.modify(file, newContent);
    
    // 更新进度条
    updateProgress(i + 1, files.length);
}

// 关闭进度通知
progressNotice.hide();

// 显示完成消息
new Notice(`已更新 ${files.length} 个符合条件的 ATOM@ 文件，添加了 antinet: atom 属性`, 5000);
%>