<%*
async function updateNoteNameByHash() {
    // 获取用户输入的哈希值
    let targetHash = await tp.system.prompt("请输入要查找的哈希值：");
    targetHash = parseInt(targetHash);

    // 获取所有markdown文件
    const files = app.vault.getMarkdownFiles();

    // 查找匹配哈希值的文件
    async function findFileByHash() {
        for (const file of files) {
            const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
            if (frontmatter && frontmatter.哈希 === targetHash) {
                return file;
            }
        }
        return null;
    }

    // 更新目标文件的YAML
    async function updateTargetYAML(fileName) {
        // 获取目标笔记
        const targetNote = app.vault.getAbstractFileByPath('项目/18-战略视图迭代/18E-GTD夹子/18E1-下一步代办事项清单文件夹/下一步代办的liner chain/本格视图不闪闪.md');
        
        if (!targetNote) {
            new Notice('未找到目标笔记');
            return;
        }

        try {
            // 读取目标笔记内容
            const content = await app.vault.read(targetNote);
            
            // 更新YAML
            let newContent;
            if (content.startsWith('---')) {
                const yamlEndIndex = content.indexOf('---', 3);
                if (yamlEndIndex !== -1) {
                    const yamlContent = content.substring(0, yamlEndIndex);
                    const restContent = content.substring(yamlEndIndex);
                    
                    if (yamlContent.includes('笔记名:')) {
                        newContent = yamlContent.replace(/笔记名:.*$/m, `笔记名: ${fileName}`) + restContent;
                    } else {
                        newContent = yamlContent.trim() + `\n笔记名: ${fileName}\n` + restContent;
                    }
                }
            } else {
                newContent = `---\n笔记名: ${fileName}\n---\n${content}`;
            }

            // 写入更新后的内容
            await app.vault.modify(targetNote, newContent);
            new Notice(`已更新笔记名属性为：${fileName}`);

        } catch (error) {
            console.error('Error:', error);
            new Notice(`更新YAML时发生错误：${error.message}`);
        }
    }

    // 在新标签页打开找到的文件
    async function openFileInNewTab(file) {
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file);
    }

    // 执行主流程
    try {
        const foundFile = await findFileByHash();
        if (foundFile) {
            await updateTargetYAML(foundFile.basename);
            await openFileInNewTab(foundFile);
        } else {
            new Notice(`未找到哈希值为 ${targetHash} 的笔记。`);
        }
    } catch (error) {
        console.error('Error:', error);
        new Notice(`执行过程中发生错误：${error.message}`);
    }
}

// 执行主函数
await updateNoteNameByHash();
%>