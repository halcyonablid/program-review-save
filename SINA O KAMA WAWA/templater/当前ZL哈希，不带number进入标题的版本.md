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

// 获取当前打开的文件
const currentFile = app.workspace.getActiveFile();

if (currentFile && currentFile.name.startsWith("ZL@")) {
    // 读取文件内容
    const content = await app.vault.read(currentFile);
    
    // 解析现有的 YAML 前置元数据
    let yamlRegex = /^---\n([\s\S]*?)\n---/;
    let yamlMatch = content.match(yamlRegex);
    let yaml = yamlMatch ? yamlMatch[1] : '';
    
    // 检查是否包含 antinet: atom
    if (!/antinet:\s*atom/.test(yaml)) {
        new Notice("当前文件不包含 antinet: atom 属性，无法处理。", 3000);
        return;
    }
    
    // 生成哈希值
    const hashValue = generateSixDigitCode(currentFile.name);
    
    // 更新或添加哈希属性
    const newYaml = yaml.replace(/^哈希:.*$/m, '').trim() + `\n哈希: ${hashValue}`;
    
    // 构建新的文件内容
    const newContent = `---\n${newYaml.trim()}\n---\n${content.replace(yamlRegex, '')}`;
    
    // 写入更新后的内容
    await app.vault.modify(currentFile, newContent);
    
    new Notice(`已更新文件 ${currentFile.name} 的哈希值为 ${hashValue}`, 3000);
} else {
    new Notice("当前没有打开的文件或文件名不以 ZL@ 开头", 3000);
}
%>