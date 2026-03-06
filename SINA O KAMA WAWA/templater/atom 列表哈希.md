<%*
// 哈希函数：生成六位数哈希值
function generateSixDigitCode(addressCode) {
    const parts = addressCode.split('@');
    const code = parts[parts.length - 1].split('-')[0].trim(); // 获取"- "之前的部分
    let hash = 5381;
    for (let i = 0; i < code.length; i++) {
        hash = ((hash << 5) + hash) + code.charCodeAt(i);
    }
    hash = Math.abs(hash);
    return (hash % 1000000).toString().padStart(6, '0');
}

// 辅助函数：检查文件是否包含 antinet: atom YAML 属性
async function hasAntinetAtomProperty(file) {
    const content = await app.vault.read(file);
    const yamlRegex = /^---\n([\s\S]*?)\n---/;
    const yamlMatch = content.match(yamlRegex);
    if (yamlMatch) {
        const yaml = yamlMatch[1];
        return /antinet:\s*atom/.test(yaml);
    }
    return false;
}

// 获取所有符合条件的文件
const allFiles = app.vault.getMarkdownFiles();
const files = [];

for (const file of allFiles) {
    if (file.name.startsWith("ATOM@") && await hasAntinetAtomProperty(file)) {
        files.push(file);
    }
}

// 按文件名排序
files.sort((a, b) => a.name.localeCompare(b.name));

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
    
    // 生成哈希值
    const hashValue = generateSixDigitCode(file.name);
    
    // 更新或添加哈希属性
    const newYaml = yaml.replace(/^哈希:.*$/m, '').trim() + `\n哈希: ${hashValue}`;
    
    // 构建新的文件内容
    const newContent = `---\n${newYaml.trim()}\n---\n${content.replace(yamlRegex, '')}`;
    
    // 写入更新后的内容
    await app.vault.modify(file, newContent);
    
    // 更新进度条
    updateProgress(i + 1, files.length);
}

// 关闭进度通知
progressNotice.hide();

// 显示完成消息
new Notice(`已更新 ${files.length} 个符合条件的 ATOM@ 文件的哈希值`, 5000);
%>