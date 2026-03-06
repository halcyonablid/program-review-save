<%*
async function findAndScrollToNoteCentered() {
    const currentFileName = tp.file.title;
    // 等待页面加载
    await new Promise(resolve => setTimeout(resolve, 300));
    
    try {
        // 查找自定义表格
        const customTable = document.querySelector('.custom-table tbody');
        if (!customTable) {
            throw new Error('未找到编号列表表格');
        }
        
        // 查找目标行
        const allRows = Array.from(customTable.querySelectorAll('tr'));
        const targetRow = allRows.find(row => {
            const link = row.querySelector('.filename-column a');
            return link && link.textContent === currentFileName;
        });
        
        if (!targetRow) {
            new Notice(`在编号列表中未找到当前笔记: ${currentFileName}`);
            return;
        }
        
        // 使用原始脚本中的滚动容器定位方式
        const scrollContainer = document.querySelector('.workspace-leaf-content');
        if (!scrollContainer) {
            throw new Error('未找到可滚动容器');
        }
        
        // 执行滚动，使目标行居中
        targetRow.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' // 这会确保元素在视口中居中
        });
        
        // 添加视觉效果：暂时高亮目标行
        const originalBackground = targetRow.style.backgroundColor;
        targetRow.style.transition = 'background-color 0.8s';
        targetRow.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';  // 黄色高亮
        
        // 3秒后恢复原来的背景色
        setTimeout(() => {
            targetRow.style.backgroundColor = originalBackground;
        }, 3000);
        
        // 显示通知
        const rowIndex = allRows.indexOf(targetRow) + 1;
        new Notice(`已找到并滚动到笔记：${currentFileName}（第 ${rowIndex} 行 / 共 ${allRows.length} 行）`);
        
    } catch (error) {
        console.error('滚动定位错误:', error);
        new Notice(`查找或滚动过程中发生错误：${error.message}`);
    }
}

// 运行主函数
await findAndScrollToNoteCentered();
%>