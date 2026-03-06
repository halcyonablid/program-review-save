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

// 辅助函数：获取所有符合条件的文件并排序
async function getSortedFiles() {
    const allFiles = app.vault.getMarkdownFiles();
    const files = [];
    for (const file of allFiles) {
        if (file.name.startsWith("ATOM@") && await hasAntinetAtomProperty(file)) {
            files.push(file);
        }
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
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

// 获取当前打开的文件
const currentFile = app.workspace.getActiveFile();

if (currentFile && currentFile.name.startsWith("ATOM@")) {
    // 检查文件是否包含 antinet: atom 属性
    if (!(await hasAntinetAtomProperty(currentFile))) {
        new Notice("当前文件不包含 antinet: atom 属性，无法处理。", 3000);
        return;
    }

    // 读取文件内容
    const content = await app.vault.read(currentFile);
    
    // 解析现有的 YAML 前置元数据
    let yamlRegex = /^---\n([\s\S]*?)\n---/;
    let yamlMatch = content.match(yamlRegex);
    let yaml = yamlMatch ? yamlMatch[1] : '';
    
    // 生成哈希值
    const hashValue = generateSixDigitCode(currentFile.name);
    
    // 获取所有符合条件的文件并排序
    const sortedFiles = await getSortedFiles();
    
    // 计算当前文件的 number 值
    const currentNumber = sortedFiles.findIndex(file => file.path === currentFile.path) + 1;
    
    // 更新或添加哈希和 number 属性
    const newYaml = yaml.replace(/^哈希:.*$/m, '')
                        .replace(/^number:.*$/m, '')
                        .trim() + `\n哈希: ${hashValue}\nnumber: ${currentNumber}`;
    
    // 构建新的文件内容
    const newContent = `---\n${newYaml.trim()}\n---\n${content.replace(yamlRegex, '')}`;
    
    // 写入更新后的内容
    await app.vault.modify(currentFile, newContent);
    
    // 更新文件名（保留 .md 后缀）
    const currentName = currentFile.name;
    const newName = currentName.replace(/\s*\(\d+\)\.md$/, '').replace(/\.md$/, '') + ` (${currentNumber}).md`;
    await app.fileManager.renameFile(currentFile, newName);
    
    new Notice(`已更新文件 ${newName}\n哈希值: ${hashValue}\n编号: ${currentNumber}`, 5000);
} else {
    new Notice("当前没有打开的文件或文件名不以 ATOM@ 开头", 3000);
}
%>
