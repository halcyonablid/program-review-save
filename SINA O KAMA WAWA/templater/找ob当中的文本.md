<%*
// 弹出输入框让用户输入搜索文本
const searchText = await tp.system.prompt("请输入要搜索的文本");

if (searchText) {
    // 获取所有Markdown文件
    const files = app.vault.getMarkdownFiles();
    const matchedFiles = [];

    // 搜索包含文本的文件
    for (const file of files) {
        const content = await app.vault.read(file);
        if (content.includes(searchText)) {
            matchedFiles.push(file);
        }
    }

    if (matchedFiles.length > 0) {
        // 打开匹配的笔记
        for (const file of matchedFiles) {
            app.workspace.openLinkText(file.path, "", true);
        }

        // 执行搜索并显示结果
        app.commands.executeCommandById('global-search:open');
        const searchLeaf = app.workspace.getLeavesOfType('search')[0];
        if (searchLeaf) {
            searchLeaf.view.setQuery(searchText);
            // 移除了 searchLeaf.view.search(searchText); 这一行
        }

        // 显示通知
        new Notice(`已打开 ${matchedFiles.length} 个包含 "${searchText}" 的笔记`);
    } else {
        new Notice(`没有找到包含 "${searchText}" 的笔记`);
    }
} else {
    new Notice("未输入搜索文本");
}
%>
