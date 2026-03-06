<%*
// 此函数用于解析笔记名称（支持ATOM@和ZL@）
function parseNoteName(name) {
  // 修改正则表达式以匹配ATOM@或ZL@
  const match = name.match(/(ATOM|ZL)@(.*?)- (.+)/);
  if (!match) return null;
  
  const prefix = match[1]; // ATOM或ZL
  const addressPart = match[2];
  const namePart = match[3];
  
  const atIndex = addressPart.lastIndexOf('@');
  if (atIndex !== -1) {
    return {
      prefix: prefix, // 新增：记录前缀类型
      addressType: addressPart.substring(0, atIndex),
      address: addressPart.substring(atIndex + 1),
      name: namePart
    };
  } else {
    return {
      prefix: prefix, // 新增：记录前缀类型
      addressType: '',
      address: addressPart,
      name: namePart
    };
  }
}

// 用于比较地址的函数
function compareAddresses(addr1, addr2) {
  const parts1 = addr1.split('.');
  const parts2 = addr2.split('.');
  const minLen = Math.min(parts1.length, parts2.length);
  
  for (let i = 0; i < minLen; i++) {
    if (parts1[i] !== parts2[i]) {
      if (/^\d+$/.test(parts1[i]) && /^\d+$/.test(parts2[i])) {
        return parseInt(parts1[i]) - parseInt(parts2[i]);
      }
      return parts1[i].localeCompare(parts2[i]);
    }
  }
  return parts1.length - parts2.length;
}

async function openNextStructuredFile() {
  try {
    // 1. 获取当前文件
    const currentFile = app.workspace.getActiveFile();
    
    // 等待页面加载
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // 检查文件名是否以ATOM@或ZL@开头
    if (!currentFile || !(currentFile.basename.startsWith("ATOM@") || currentFile.basename.startsWith("ZL@"))) {
      new Notice("当前文件不是ATOM或ZL笔记，无法执行此操作");
      return;
    }
    
    // 确定当前文件类型（ATOM或ZL）
    const isAtom = currentFile.basename.startsWith("ATOM@");
    const filePrefix = isAtom ? "ATOM" : "ZL";
    
    // 2. 获取所有符合条件的文件
    const files = app.vault.getMarkdownFiles()
      .filter(file => file.basename.startsWith("ATOM@") || file.basename.startsWith("ZL@"));
    
    // 3. 获取文件的前置元数据，筛选出antinet为atom的文件
    const structuredFiles = [];
    for (const file of files) {
      try {
        const fileCache = app.metadataCache.getFileCache(file);
        const frontmatter = fileCache?.frontmatter;
        
        if (frontmatter && frontmatter.antinet === "atom") {
          structuredFiles.push(file);
        }
      } catch (e) {
        console.error("处理文件错误:", file.path, e);
      }
    }
    
    // 4. 按照规则排序
    structuredFiles.sort((a, b) => {
      const infoA = parseNoteName(a.basename);
      const infoB = parseNoteName(b.basename);
      
      if (!infoA || !infoB) return 0;
      
      // 首先按前缀排序（ATOM和ZL分组）
      if (infoA.prefix !== infoB.prefix) {
        return infoA.prefix.localeCompare(infoB.prefix);
      }
      
      // 然后按地址排序
      const fullAddressA = (infoA.addressType ? infoA.addressType + '@' : '') + infoA.address;
      const fullAddressB = (infoB.addressType ? infoB.addressType + '@' : '') + infoB.address;
      
      if (fullAddressA.includes('.') && fullAddressB.includes('.')) {
        return compareAddresses(fullAddressA, fullAddressB);
      }
      
      return a.basename.localeCompare(b.basename);
    });
    
    // 5. 找出当前文件在排序后列表中的位置
    const currentIndex = structuredFiles.findIndex(file => file.path === currentFile.path);
    
    if (currentIndex === -1) {
      new Notice("无法在列表中找到当前文件");
      return;
    }
    
    // 6. 确定下一个文件（如果是最后一个文件则循环到第一个）
    const nextIndex = (currentIndex + 1) % structuredFiles.length;
    const nextFile = structuredFiles[nextIndex];
    
    // 7. 打开下一个文件
    await app.workspace.openLinkText(nextFile.path, "", false);
    
    const fileType = nextFile.basename.startsWith("ATOM@") ? "ATOM" : "ZL";
    
  
  } catch (error) {
    console.error('打开下一个文件时出错:', error);
    new Notice(`打开下一个文件时出错：${error.message}`);
  }
}

// 运行主函数
await openNextStructuredFile();
%>