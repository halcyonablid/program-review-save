async function createSimilarNote(tp) {
    const currentFile = tp.file.find_tfile(tp.file.title);
    const currentContent = await tp.file.content;

    // 提取dataview inline fields
    const inlineFields = currentContent.match(/(\w+)::\s*(.+)/g) || [];

    // 解析当前文件名
    const currentNameParts = tp.file.title.split('- ');
    const currentCode = currentNameParts[0].trim();
    const currentName = currentNameParts[1] || '';

    // 询问用户选择方法A或B
    const method = await tp.system.suggester(["方法A (智能编号)", "方法B (添加.001)"], ["A", "B"]);

    // 询问新笔记的名称
    const newName = await tp.system.prompt("请输入新笔记的名称");
    if (!newName) return; // 如果用户取消输入，则终止脚本

    // 生成新的编号
    let newCode = await generateNewCode(tp, currentCode, method);

    // 创建新文件名
    const newFileName = `${newCode}- ${newName}`;

    // --- 新增和修改的核心逻辑开始 ---

    // 1. 获取当前笔记的元数据和 YAML frontmatter
    const metadata = app.metadataCache.getFileCache(currentFile);
    const frontmatter = metadata ? metadata.frontmatter : null;

    // 2. 构建新笔记的基础 YAML 属性
    const newYaml = {
        qishiriqidate: tp.date.now("YYYY-MM-DD"),
        qishiriqitime: tp.date.now("HH:mm:ss"),
        atomle: true,
        antinet: 'atom',
        '树的结构': true
    };

    // 3. 检查并继承 "所属块" 属性
    if (frontmatter && frontmatter['所属块']) {
        newYaml['所属块'] = frontmatter['所属块'];
    }

    // 4. 将 YAML 对象转换为字符串
    let newYamlString = '---\n';
    for (const key in newYaml) {
        // 注意：这里的 key '树的结构' 包含空格，但通常YAML键不建议这么做。不过，我们保持原样。
        // 如果值是字符串，直接输出；否则，让它自动转换。
        const value = newYaml[key];
        newYamlString += `${key}: ${value}\n`;
    }
    newYamlString += '---\n';

    // 5. 创建新文件的完整内容
    const newContent = `${newYamlString}${inlineFields.join('\n')}`;

    // --- 新增和修改的核心逻辑结束 ---

    // 创建新文件
    const newFile = await tp.file.create_new(newContent, newFileName);

    // 在新标签页打开文件
    const newLeaf = app.workspace.getLeaf('tab');
    await newLeaf.openFile(newFile);

    // [后续的 Breadcrumbs 插件刷新逻辑保持不变]
    // 使用 setTimeout 给 Breadcrumbs 一些时间来初始化
    setTimeout(async () => {
        const breadcrumbsPlugin = app.plugins.plugins.breadcrumbs;
        if (breadcrumbsPlugin && breadcrumbsPlugin.api) {
            // 刷新 Breadcrumbs 索引
            await breadcrumbsPlugin.api.refreshIndex();
            // 获取 TreeView
            const treeView = breadcrumbsPlugin.view;
            if (treeView && treeView.draw) {
                // 重新绘制树形视图
                await treeView.draw();
                // 给DOM更新一些时间
                setTimeout(() => {
                    // 尝试滚动到新创建的笔记
                    const contentEl = treeView.contentEl;
                    const newNoteEl = contentEl.querySelector(`[data-path="${newFile.path}"]`) ||
                                      contentEl.querySelector(`[data-file-path="${newFile.path}"]`) ||
                                      contentEl.querySelector(`[title="${newFile.basename}"]`);
                    if (newNoteEl) {
                        newNoteEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        // 尝试展开父节点
                        let parent = newNoteEl.closest('.tree-item');
                        while (parent) {
                            const collapseEl = parent.querySelector('.collapse-icon');
                            if (collapseEl && collapseEl.classList.contains('is-collapsed')) {
                                collapseEl.click();
                            }
                            parent = parent.parentElement.closest('.tree-item');
                        }
                        // 高亮新笔记
                        newNoteEl.classList.add('is-active');
                    }
                }, 500); // 给DOM更新0.5秒时间
            }
        }
    }, 500);

    return newFile;
}

// [下面的所有辅助函数保持不变]
async function generateNewCode(tp, currentCode, method) {
    let process = `原始编号: ${currentCode}\n`;
    let conflictNote = '';
    if (method === "B") {
        // 方法B：直接添加.001
        const newCode = `${currentCode}.001`;
        process += `执行方法B: 添加.001\n最终编号: ${newCode}`;
        await tp.system.prompt(process, { title: "执行过程", placeholder: '' });
        return newCode;
    }
    // 方法A：智能编号
    let newCode = currentCode;
    let isUnique = false;
    let attempts = 0;
    // 先尝试方法2（递增）
    newCode = incrementCode(newCode);
    process += `执行方法2 (递增): ${newCode}\n`;
    // 检查新编号是否唯一
    isUnique = await isCodeUnique(tp, newCode);
    if (!isUnique) {
        conflictNote = getConflictingNoteName(tp, newCode);
        process += `编号重复，与已有笔记: ${conflictNote}\n`;
    }
    if (!isUnique) {
        // 如果方法2失败，使用方法1（扩展）
        newCode = currentCode;
        do {
            newCode = extendCode(newCode);
            process += `执行方法1 (扩展): ${newCode}\n`;
            isUnique = await isCodeUnique(tp, newCode);
            if (!isUnique) {
                conflictNote = getConflictingNoteName(tp, newCode);
                process += `编号重复，与已有笔记: ${conflictNote}\n`;
            }
            attempts++;
        } while (!isUnique && attempts < 5);
        if (isUnique) {
            process += `最终编号: ${newCode}`;
        } else {
            process += `达到最大尝试次数，使用最后生成的编号`;
        }
    } else {
        process += `最终编号: ${newCode}`;
    }
    await tp.system.prompt(process.split('\n').join('\n'), { title: "执行过程", placeholder: '' });
    return newCode;
}

function incrementCode(code) {
    // 使用正则表达式匹配数字或字母结尾的部分
    const match = code.match(/(\d{3}|[A-Z])$/);
    if (match) {
        const lastPart = match[0];
        if (/^\d{3}$/.test(lastPart)) {
            // 如果末尾是三位数字，递增
            const newNumber = (parseInt(lastPart) + 1).toString().padStart(3, '0');
            return code.slice(0, -3) + newNumber;
        } else if (/^[A-Z]$/.test(lastPart)) {
            // 如果末尾是字母，递增
            const newLetter = String.fromCharCode(lastPart.charCodeAt(0) + 1);
            return code.slice(0, -1) + newLetter;
        }
    }
    return code;
}

function extendCode(code) {
    // 使用正则表达式匹配数字或字母结尾的部分
    const match = code.match(/(\d{3}|[A-Z])$/);
    if (match) {
        const lastPart = match[0];
        if (/^\d{3}$/.test(lastPart)) {
            // 如果末尾是三位数字，添加字母A
            return `${code}A`;
        } else {
            // 否则添加001
            return `${code}001`;
        }
    }
    return code;
}

async function isCodeUnique(tp, code) {
    // 检查是否存在具有相同编码的笔记
    const files = app.vault.getMarkdownFiles();
    const existingCodes = files.map(file => file.basename.split('- ')[0].trim());
    return !existingCodes.includes(code);
}

function getConflictingNoteName(tp, code) {
    // 获取与给定编码冲突的笔记名称
    const files = app.vault.getMarkdownFiles();
    const conflictFile = files.find(file => file.basename.split('- ')[0].trim() === code);
    return conflictFile ? conflictFile.basename : '未知笔记';
}

module.exports = createSimilarNote;
