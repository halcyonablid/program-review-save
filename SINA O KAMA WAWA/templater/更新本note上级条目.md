<%*
/**
 * 自动查找当前笔记的上级条目（如编号结构：ATOM@121.001.007.002.205.003，取掉最后一节为上级）
 * 并更新/写入 YAML "上级条目" 字段，保留其它字段不变
 */
const file = tp.file;
const currentFile = file.find_tfile(file.title);
if (!currentFile) {
  await tp.system.prompt("未找到当前文件");
  return;
}
const content = await file.content;

// ———自动编号&父条目推断———
const currentCode = file.title.split('- ')[0].trim();
const lastDotIndex = currentCode.lastIndexOf('.');
const parentCode = lastDotIndex === -1 ? null : currentCode.slice(0, lastDotIndex);

function findFileByCode(code) {
  // 用 Obsidian 的 Vault 方法查找所有 md 文件是否有匹配编号
  return app.vault.getMarkdownFiles().find(f => f.basename.split('- ')[0].trim() === code);
}

// 构造父条目链接
let parentLink = null;
if (parentCode) {
  const parentFile = findFileByCode(parentCode);
  if (parentFile) parentLink = `[[${parentFile.basename}]]`;
}

// ———处理 YAML———
const yamlMatch = content.match(/^---\n([\s\S]*?)\n---\n?/);
let yaml = yamlMatch ? yamlMatch[1] : "";
let restOfContent = yamlMatch ? content.slice(yamlMatch[0].length) : content;

let yamlLines = yaml ? yaml.split('\n').filter(x => x.trim() !== '') : [];
let updated = false;
yamlLines = yamlLines.map(line => {
  if (/^上级条目\s*:/.test(line)) {
    updated = true;
    return `上级条目: ${parentLink ? `"${parentLink.replace(/"/g, '\\"')}"` : 'null'}`;
  }
  return line;
});
if (!updated && parentLink) {
  yamlLines.push(`上级条目: "${parentLink.replace(/"/g, '\\"')}"`);
}

const newYaml = yamlLines.length ? `---\n${yamlLines.join('\n')}\n---\n` : '';
const newContent = `${newYaml}${restOfContent}`;

// 覆盖保存
await app.vault.modify(currentFile, newContent);
await tp.system.prompt("『上级条目』已自动更新！", { title: "完成", placeholder: '' });
%>