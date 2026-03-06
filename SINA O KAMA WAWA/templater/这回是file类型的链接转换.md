<%*
async function convertLinks(input) {
    // 检查输入是否为空
    if (!input) return "未提供输入。";

    // 检查链接类型并调用相应的转换函数
    if (input.includes('file:///')) {
        return convertFileLink(input);
    } else if (input.includes('about:SuperMemoElementNo=')) {
        return convertAboutLink(input);
    } else {
        return "无法识别的链接格式。";
    }
}

function convertFileLink(input) {
    const startBracket = input.indexOf('[');
    const endBracket = input.indexOf(']');
    
    if (startBracket === -1 || endBracket === -1) {
        return "输入格式无效。请确保文本包含方括号 []。";
    }

    const bracketContent = input.substring(startBracket + 1, endBracket);

    const elementNoStart = input.indexOf('SuperMemoElementNo=(');
    const elementNoEnd = input.indexOf(')', elementNoStart);
    
    if (elementNoStart === -1 || elementNoEnd === -1) {
        return "输入格式无效。请确保文本包含 SuperMemoElementNo。";
    }

    const elementNo = input.substring(elementNoStart + 20, elementNoEnd);

    const timestampStart = bracketContent.lastIndexOf(' ') + 1;
    const timestamp = bracketContent.substring(timestampStart);

    const formattedTimestamp = timestamp.slice(0, 8) + timestamp.slice(8);

    const textWithoutTimestamp = bracketContent.substring(0, timestampStart - 1);

    return `<a href="SuperMemoElementNo=(${elementNo})">${textWithoutTimestamp} ${formattedTimestamp}</a>`;
}

function convertAboutLink(input) {
    let result = input;
    let startIndex = result.indexOf('[');
    let endIndex = result.indexOf('](about:SuperMemoElementNo=(', startIndex);
    
    if (startIndex !== -1 && endIndex !== -1) {
        let closeIndex = result.indexOf(')', endIndex);
        if (closeIndex !== -1) {
            let title = result.substring(startIndex + 1, endIndex);
            let elementNo = result.substring(endIndex + 28, closeIndex);
            let newLink = `<a href="SuperMemoElementNo=(${elementNo})">${title}</a>`;
            result = newLink + result.substring(closeIndex + 1);
            // 去掉多余的右括号
            result = result.replace('</a>)', '</a>');
        }
    }
    return result;
}

// 弹出输入框
let inputText = await tp.system.prompt("请输入要转换的文本：");

if (inputText) {
    // 转换文本
    const convertedText = await convertLinks(inputText);
    
    // 在当前光标位置插入转换后的文本
    let editor = this.app.workspace.activeLeaf.view.editor;
    if (editor) {
        let cursor = editor.getCursor();
        editor.replaceRange(convertedText, cursor);
        new Notice("转换完成，结果已插入到光标位置");
    } else {
        new Notice("无法访问编辑器");
    }
} else {
    new Notice("未输入文本，转换取消");
}
%>
