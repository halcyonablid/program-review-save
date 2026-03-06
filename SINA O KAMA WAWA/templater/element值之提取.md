<%*
// 读取剪贴板内容
let input = await navigator.clipboard.readText();

// 定义提取函数
function extractElementNo(text) {
    let startIndex = text.indexOf("SuperMemoElementNo=(");
    if (startIndex === -1) return null;
    
    startIndex += "SuperMemoElementNo=(".length;
    let endIndex = text.indexOf(")", startIndex);
    if (endIndex === -1) return null;
    
    return text.substring(startIndex, endIndex);
}

// 提取ElementNo
let elementNo = extractElementNo(input);

if (elementNo) {
    // 将提取的ElementNo复制回剪贴板
    await navigator.clipboard.writeText(elementNo);
    
    // 创建弹窗提示
    new Notice(`SuperMemoElementNo ${elementNo} 已提取并复制到剪贴板`, 3000);
} else {
    new Notice("未找到有效的SuperMemoElementNo", 3000);
}

// 在模板中不输出任何内容
tR += "";
%>
