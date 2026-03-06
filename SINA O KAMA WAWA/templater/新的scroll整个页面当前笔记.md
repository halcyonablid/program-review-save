<%*
// 获取当前打开的笔记名称
const currentFileName = tp.file.title;

// 等待一段时间，确保表格已经渲染完成
await new Promise(resolve => setTimeout(resolve, 500));

// 查找所有表格
let tables = document.querySelectorAll('.custom-table');
let found = false;
let totalRowCount = 0;

for (let table of tables) {
    let rows = table.querySelectorAll('tbody tr');
    for (let i = 0; i < rows.length; i++) {
        totalRowCount++;
        let row = rows[i];
        let link = row.querySelector('.filename-column a');
        if (link && link.textContent === currentFileName) {
            // 找到匹配的行，滚动到该位置
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            new Notice(`已找到当前笔记：${currentFileName}（第 ${totalRowCount} 行）`);
            found = true;
            break;
        }
    }
    if (found) break; // 如果找到，退出外层循环
}

if (!found) {
    new Notice(`在编号列表中未找到当前笔记：${currentFileName}`);
}
%>