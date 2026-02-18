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
    if (!method) return;



    // 生成新的编号
    let newCode = await generateNewCode(tp, currentCode, method);

 // === 这里改动：弹出“苹果风格”的命名输入框 ===
    // 默认标题用当前笔记去掉编号后的部分，如果没有就给一个柔和的占位
    const defaultTitle = currentName || "新的想法";

    const newName = await tp.system.prompt(
        "为这条新卡片取一个名字",
        {
            title: "命名新卡片",
            placeholder: "例如：关于螃蟹卡农的一个分支思考",
            defaultValue: defaultTitle
        }
    );

    // 如果用户取消输入（Esc 或关闭），就终止
    if (newName === null || newName === undefined) return;

    // 创建新文件名：编号 + 标题
    const newFileName = `${newCode}- ${newName.trim() || defaultTitle}`;

    // --- 新增和修改的核心逻辑开始 ---

    // 1. 获取当前笔记的元数据和 YAML frontmatter
    const metadata = app.metadataCache.getFileCache(currentFile);
    const frontmatter = metadata ? metadata.frontmatter : null;
    
    // --- 🦀 计算螃蟹系统的日期（新增部分）---
    const nextReviewDate = moment().add(7, 'days').format("YYYY-MM-DD");

    // 2. 构建新笔记的基础 YAML 属性
    const newYaml = {
        qishiriqidate: tp.date.now("YYYY-MM-DD"),
        qishiriqitime: tp.date.now("HH:mm:ss"),
        atomle: true,
        antinet: 'atom',
        '树的结构': true,
        crab_canon: [10, 7, nextReviewDate, null]  // 🦀 新增
    };

    // 3. 检查并继承 "所属块" 属性
    if (frontmatter && frontmatter['所属块']) {
        newYaml['所属块'] = frontmatter['所属块'];
    }

    const parentLink = buildParentLink(newCode);
    if (parentLink) {
        newYaml['上级条目'] = parentLink;
    }

    // 4. 将 YAML 对象转换为字符串
    let newYamlString = '---\n';
    for (const key in newYaml) {
        const value = newYaml[key];
        
        // 🦀 特殊处理数组类型（新增逻辑）
        if (Array.isArray(value)) {
            const arrayString = JSON.stringify(value).replace(/,/g, ', '); 
            newYamlString += `${key}: ${arrayString}\n`;
        } 
        else if (typeof value === 'string') {
            const escaped = value.replace(/"/g, '\\"');
            const needsQuotes = key === '上级条目' || /[:\[\]\{\}]/.test(value);
            newYamlString += `${key}: ${needsQuotes ? `"${escaped}"` : value}\n`;
        } else {
            newYamlString += `${key}: ${value}\n`;
        }
    }
    newYamlString += '---\n\n';

    // 5. 创建新文件的完整内容
    const inlineSection = inlineFields.length ? inlineFields.join('\n') : '';
    const newContent = inlineSection ? `${newYamlString}${inlineSection}` : newYamlString;

    // --- 新增和修改的核心逻辑结束 ---

    // 创建新文件
    const newFile = await tp.file.create_new(newContent, newFileName);

    // 在新标签页打开文件
    const newLeaf = app.workspace.getLeaf('tab');
    await newLeaf.openFile(newFile);

    // [后续的 Breadcrumbs 插件刷新逻辑保持不变]
    setTimeout(async () => {
        const breadcrumbsPlugin = app.plugins.plugins.breadcrumbs;
        if (breadcrumbsPlugin && breadcrumbsPlugin.api) {
            await breadcrumbsPlugin.api.refreshIndex();
            const treeView = breadcrumbsPlugin.view;
            if (treeView && treeView.draw) {
                await treeView.draw();
                setTimeout(() => {
                    const contentEl = treeView.contentEl;
                    const newNoteEl = contentEl.querySelector(`[data-path="${newFile.path}"]`) ||
                                      contentEl.querySelector(`[data-file-path="${newFile.path}"]`) ||
                                      contentEl.querySelector(`[title="${newFile.basename}"]`);
                    if (newNoteEl) {
                        newNoteEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        let parent = newNoteEl.closest('.tree-item');
                        while (parent) {
                            const collapseEl = parent.querySelector('.collapse-icon');
                            if (collapseEl && collapseEl.classList.contains('is-collapsed')) {
                                collapseEl.click();
                            }
                            parent = parent.parentElement.closest('.tree-item');
                        }
                        newNoteEl.classList.add('is-active');
                    }
                }, 500);
            }
        }
    }, 500);

    return newFile;
}


// [下面的所有辅助函数保持原样 - 一个字都没改]
async function generateNewCode(tp, currentCode, method) {
    let process = `原始编号: ${currentCode}\n`;
    let conflictNote = '';
    if (method === "B") {
        const newCode = `${currentCode}.001`;
        process += `执行方法B: 添加.001\n最终编号: ${newCode}`;
        new Notice(`生成编号: ${newCode}`);
        return newCode;
    }
    let newCode = currentCode;
    let isUnique = false;
    let attempts = 0;
    newCode = incrementCode(newCode);
    process += `执行方法2 (递增): ${newCode}\n`;
    isUnique = await isCodeUnique(tp, newCode);
    if (!isUnique) {
        conflictNote = getConflictingNoteName(tp, newCode);
        process += `编号重复，与已有笔记: ${conflictNote}\n`;
    }
    if (!isUnique) {
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
    new Notice(`生成编号: ${newCode}`);
    return newCode;
}

function incrementCode(code) {
    const match = code.match(/(\d{3}|[A-Z])$/);
    if (match) {
        const lastPart = match[0];
        if (/^\d{3}$/.test(lastPart)) {
            const newNumber = (parseInt(lastPart) + 1).toString().padStart(3, '0');
            return code.slice(0, -3) + newNumber;
        } else if (/^[A-Z]$/.test(lastPart)) {
            const newLetter = String.fromCharCode(lastPart.charCodeAt(0) + 1);
            return code.slice(0, -1) + newLetter;
        }
    }
    return code;
}

function extendCode(code) {
    const match = code.match(/(\d{3}|[A-Z])$/);
    if (match) {
        const lastPart = match[0];
        if (/^\d{3}$/.test(lastPart)) {
            return `${code}A`;
        } else {
            return `${code}001`;
        }
    }
    return code;
}

async function isCodeUnique(tp, code) {
    return !findFileByCode(code);
}

function getConflictingNoteName(tp, code) {
    const conflictFile = findFileByCode(code);
    return conflictFile ? conflictFile.basename : '未知笔记';
}

function buildParentLink(code) {
    const parentCode = getParentCode(code);
    if (!parentCode) return null;
    const parentFile = findFileByCode(parentCode);
    return parentFile ? `[[${parentFile.basename}]]` : null;
}

function getParentCode(code) {
    const lastDotIndex = code.lastIndexOf('.');
    return lastDotIndex === -1 ? null : code.slice(0, lastDotIndex);
}

function findFileByCode(code) {
    const files = app.vault.getMarkdownFiles();
    return files.find(file => file.basename.split('- ')[0].trim() === code);
}

module.exports = createSimilarNote;
