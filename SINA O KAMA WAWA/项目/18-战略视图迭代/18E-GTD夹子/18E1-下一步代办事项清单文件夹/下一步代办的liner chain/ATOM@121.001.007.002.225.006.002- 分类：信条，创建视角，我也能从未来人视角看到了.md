---
qishiriqidate: 2026-02-18
qishiriqitime: 17:38:57
atomle: true
antinet: atom
树的结构: true
crab_canon:
  - 10
  - 7
  - 2026-02-25
  - 
上级条目: "[[ATOM@121.001.007.002.225.006- 分类：剧还有电影]]"
关键词管理:
  - M02- mermaid图系列+项目+项目015- 信条电影拆解
所属块: "[[ATOM@121.001.007.002.225.006.002- 分类：信条，创建视角，我也能从未来人视角看到了]]"
---






















```dataviewjs

const CONFIG = {
  targetNode: "ATOM@121.001.007.002.225.006.002", // 目标节点
  maxDepth: 19,               // 最大显示深度
  layout: "LR",               // 图表布局: TB(上到下), LR(左到右)
  debug: false,               // 调试模式
  addInvisibleNodes: true,    // 添加不可见节点控制层级
  showAllDescendants: true,   // 显示所有子孙节点
  showFullIds: true,          // 显示完整的节点ID
  enableZoom: true,           // 启用缩放功能
  initialZoom: 2.0,           // 初始缩放级别
  zoomStep: 0.5               // 缩放步长
};

// ===== 工具函数 =====
// 调试日志 - 改为空函数以提高性能
function debugLog(...args) {
  // 功能已移除以提高性能
}
/**
 * 精确判断一个节点是否为“头领节点”.
 * 头领节点的ID必须以“+XXX”段结尾.
 * @param {string} id - 节点ID.
 * @returns {boolean}
 */
function isLeaderNode(id) {
  if (!id || !id.includes('+')) {
    return false;
  }
  const pureId = id.split('-')[0];
  const lastPlusIndex = pureId.lastIndexOf('+');
  const lastDotIndex = pureId.lastIndexOf('.');
  // 关键：最后一个'+'必须出现在最后一个'.'之后
  return lastDotIndex < lastPlusIndex;
}


// 子图生成调试日志 - 改为空函数以提高性能
function subgraphDebugLog(message) {
  // 功能已移除以提高性能
}
function getPureId(id) {
  const dashIndex = id.indexOf("-");
  return dashIndex > 0 ? id.substring(0, dashIndex) : id;
}

function buildHeadChildrenMap(heads, nodeById) {
  const map = new Map();
  // 每个头领初始化 children 数组
  heads.forEach(h => map.set(h.id, []));
  // 预置 parent 占位（真实的 parent subgraph id 在装配阶段再填）
  heads.forEach(h => map.set("parent:" + h.id, null));

  heads.forEach(h => {
    const pid = getStateTransitionParentId(h.id);
    // 只有当 pid 存在且对应节点也是“头领”时，才建立父子关系
    if (pid && nodeById.has(pid)) {
      const pNode = nodeById.get(pid);
      if (pNode && pNode.hasStateTransition && map.has(pid)) {
        map.get(pid).push(h.id);
        // 具体的 parent 子图ID稍后在 buildStateTransitionGraph 中写入
        map.set("parent:" + h.id, null);
      } else {
        // 父节点不是头领，则该 head 作为顶层子图
        map.set("parent:" + h.id, null);
      }
    } else {
      // 无父（或父不在相关集合）也作为顶层子图
      map.set("parent:" + h.id, null);
    }
  });

  return map;
}

function computeSubgraphNodes(headId, allNodes, childHeadIds) {
  const res = new Set();
  const headPure = getPureId(headId);
  const headPlus = getPlusLevel(headPure);

  // 子头领前缀集合（纯ID）
  const childPrefixes = childHeadIds.map(cid => getPureId(cid));

  // 把 head 本人放入
  res.add(headId);

  allNodes.forEach(n => {
    const pure = getPureId(n.id);
    if (pure.startsWith(headPure + ".")) {
      // 同 plus 层级
      if (getPlusLevel(pure) === headPlus) {
        // 不落入任一子头领前缀
        const underAnyChild = childPrefixes.some(cp => pure === cp || pure.startsWith(cp + "."));
        if (!underAnyChild) {
          res.add(n.id);
        }
      }
    }
  });

  return res;
}
// 新增：判断是否为直接子节点关系（仅通过添加 "." 形成，且为直接一层）
function isChildRelation(parentId, childId) {
  if (!parentId || !childId) return false;
  if (parentId === childId) return false;

  // 仅当 child 以 parent + "." 开头才可能是子节点
  if (!childId.startsWith(parentId + ".")) return false;

  // 取 parent 后面的剩余部分，不能再包含额外的 "."
  const remaining = childId.substring(parentId.length + 1);
  return !remaining.includes(".");
}
/**
 * 查找一个头领节点的“结构性父头领”
 * @param {string} headId - 当前头领节点的ID
 * @param {Map} subgraphMap - 所有头领子图的映射
 * @returns {string | null} - 父头领的子图ID，或null
 */
function findStructuralParentHead(headId, subgraphMap) {
    let currentId = getStateTransitionParentId(headId);
    while (currentId) {
        if (isLeaderNode(currentId) && subgraphMap.has(currentId)) {
            return subgraphMap.get(currentId).id;
        }
        currentId = getParentId(currentId); // 向上追溯
    }
    return null;
}


function getStateTransitionLevel(id) {
  if (!id) return 0;
  const pureId = id.split('-')[0]; // 去除描述部分
  let level = 0;
  let lastCharType = null; // 'dot' 或 'plus'
  let i = 0;
  while (i < pureId.length) {
    if (pureId[i] === '+') {
      // 连续+段
      if (lastCharType !== 'plus') {
        if (lastCharType === 'dot') level++;
        lastCharType = 'plus';
      }
      while (pureId[i] === '+') i++;
    } else if (pureId[i] === '.') {
      // 连续.段
      if (lastCharType !== 'dot') {
        lastCharType = 'dot';
      }
      while (pureId[i] === '.') i++;
    } else {
      i++;
    }
  }
  return level;
}

// 获取节点点号层级
function getDotLevel(id) { 
  if (!id) return 0; 
  return (id.match(/\./g) || []).length; 
}

// 获取节点加号层级
function getPlusLevel(id) { 
  if (!id) return 0; 
  return (id.match(/\+/g) || []).length; 
}

// 安全的节点ID转换
function safeNodeId(id) {
  return "node_" + id.replace(/[@\.+]/g, function(match) {
    if (match === '+') return "_plus_";
    if (match === '.') return "_";
    if (match === '@') return "_";
    return "_";
  });
}

// 从文件名解析节点信息
function parseFileInfo(fileName) {
  const match = fileName.match(/ATOM@(.*?)- (.+)/);
  
  if (!match) {
    return { id: fileName, name: fileName, hasStateTransition: false };
  }
  
  const id = "ATOM@" + match[1].trim();
  const name = match[2].trim();
  
  // 检查是否包含状态转移符号"+"
  const hasStateTransition = id.includes("+");
  
  // 解析状态转移
  let baseState = null;
  if (hasStateTransition) {
    const plusIndex = id.indexOf("+");
    baseState = id.substring(0, plusIndex);
  }
  
  return { id, name, hasStateTransition, baseState };
}

// 修正后的状态转移关系判断函数
function isStateTransitionRelation(sourceId, targetId) {
  // 如果两个ID相同，则不是状态转移关系
  if (sourceId === targetId) return false;
  
  // 获取纯ID（移除可能的描述部分）
  const dashSourceIndex = sourceId.indexOf('-');
  const pureSourceId = dashSourceIndex > 0 ? sourceId.substring(0, dashSourceIndex) : sourceId;
  
  const dashTargetIndex = targetId.indexOf('-');
  const pureTargetId = dashTargetIndex > 0 ? targetId.substring(0, dashTargetIndex) : targetId;
  
  // 情况1: 直接状态转移关系 (如 ATOM@027F.001.002 -> ATOM@027F.001.002+001)
  if (pureTargetId.startsWith(pureSourceId + "+")) {
    const remainingPart = pureTargetId.substring(pureSourceId.length + 1);
    // 确保"+"后面的部分不包含"+"或"." - 关键修改点
    return !remainingPart.includes("+") && !remainingPart.includes(".");
  }
  
  // 情况2: 多级状态转移关系 (如 ATOM@027F.001.002+001 -> ATOM@027F.001.002+001+001)
  if (pureSourceId.includes("+") && pureTargetId.includes("+")) {
    // 源ID中的加号数量
    const sourcePlusCount = (pureSourceId.match(/\+/g) || []).length;
    // 目标ID中的加号数量
    const targetPlusCount = (pureTargetId.match(/\+/g) || []).length;
    
    // 如果目标比源多一个加号，且目标ID是以源ID+"+"开头的
    if (targetPlusCount === sourcePlusCount + 1 && pureTargetId.startsWith(pureSourceId + "+")) {
      const remainingPart = pureTargetId.substring(pureSourceId.length + 1);
      // 确保"+"后面的部分不包含"." - 关键修改点
      return !remainingPart.includes(".");
    }
  }
  
  return false;
}

/**
 * Gets the source parent ID for a state transition node. (Corrected Version: Added robustness check)
 * This finds the ID of the node from which the state transition originated.
 * @param {string | null | undefined} id - The node ID.
 * @returns {string | null} The source parent ID, or null if not a state transition.
 */
function getStateTransitionParentId(id) {
    // CRITICAL FIX: Immediately return null if the id is invalid.
    if (!id || typeof id !== 'string') {
        return null;
    }
    
    const dashIndex = id.indexOf('-');
    const pureId = dashIndex > 0 ? id.substring(0, dashIndex) : id;

    if (!pureId.includes("+")) {
        return null;
    }
    
    // This logic correctly finds the part of the ID *before* the last "+XXX" segment.
    const segments = [];
    let i = 0;
    while (i < pureId.length) {
        if (pureId[i] === '+') {
            let start = i;
            while (i < pureId.length && pureId[i] === '+') i++;
            segments.push(pureId.substring(start, i));
        } else if (pureId[i] === '.') {
            let start = i;
            while (i < pureId.length && pureId[i] === '.') i++;
            segments.push(pureId.substring(start, i));
        } else {
            let start = i;
            while (i < pureId.length && pureId[i] !== '+' && pureId[i] !== '.') i++;
            segments.push(pureId.substring(start, i));
        }
    }
    
    let lastPlusIndex = -1;
    for (let j = segments.length - 1; j >= 0; j--) {
        if (segments[j].startsWith('+')) {
            lastPlusIndex = j;
            break;
        }
    }

    if (lastPlusIndex <= 0) {
        return null;
    }

    let parentId = "";
    for (let k = 0; k < lastPlusIndex; k++) {
        parentId += segments[k];
    }

    if (parentId.endsWith('.') || parentId.endsWith('+')) {
        parentId = parentId.slice(0, -1);
    }
    
    return parentId;
}


// 获取节点的父节点ID
/**
 * Gets the parent ID of a node. (Corrected Version: Added robustness check)
 * This function handles all types of parent-child relationships defined in your ID system.
 * @param {string | null | undefined} id - The node ID.
 * @returns {string | null} The parent ID, or null if it has no parent.
 */
function getParentId(id) {
    // CRITICAL FIX: Immediately return null if the id is invalid.
    if (!id || typeof id !== 'string') {
        return null;
    }

    // Remove the description part ("- ...") to get the pure ID for structural analysis.
    const dashIndex = id.indexOf('-');
    const pureId = dashIndex > 0 ? id.substring(0, dashIndex) : id;

    // Handle multi-level dot paths after a state transition (e.g., ...+001.002.001)
    if (pureId.includes("+") && pureId.substring(pureId.indexOf("+")).includes(".")) {
        const afterPlusPart = pureId.substring(pureId.indexOf("+"));
        const lastDotIndex = afterPlusPart.lastIndexOf(".");
        if (lastDotIndex > 0) {
            return pureId.substring(0, pureId.indexOf("+") + lastDotIndex);
        } else {
            return pureId.substring(0, pureId.indexOf("+") + afterPlusPart.indexOf("."));
        }
    }

    // Handle multiple plus signs (e.g., ...+002+001)
    if (pureId.split("+").length > 2) {
        const lastPlusIndex = pureId.lastIndexOf("+");
        return pureId.substring(0, lastPlusIndex);
    }

    // Handle a single plus sign (e.g., ...001+001)
    if (pureId.includes("+")) {
        return pureId.substring(0, pureId.indexOf("+"));
    }

    // Handle standard hierarchical relationships (dot-separated)
    if (pureId.includes(".")) {
        const lastDotIndex = pureId.lastIndexOf(".");
        const lastPart = pureId.substring(lastDotIndex + 1);
        
        // This handles your rule for peer relationships (e.g., ...001A) vs. child relationships.
        if (/[A-Za-z]/.test(lastPart) && !lastPart.match(/^[0-9]+[A-Za-z]$/)) {
            return pureId.substring(0, lastDotIndex);
        }
        
        return pureId.substring(0, lastDotIndex);
    }

    // If none of the above conditions are met, the node has no parent.
    return null;
}


// 获取节点层级
function getNodeLevel(id) {
  if (!id) return 0;
  
  // 分别计算点号和加号的数量
  const dotCount = (id.match(/\./g) || []).length;
  const plusCount = (id.match(/\+/g) || []).length;
  
  // 总层级是两者之和
  return dotCount + plusCount;
}

// 获取状态转移的编号部分（最后一个+或.后面的部分）
function getNodeNumber(id) {
  if (!id) return "";
  
  // 对于包含+的ID
  if (id.includes("+")) {
    const lastPlusParts = id.split("+");
    const lastPart = lastPlusParts[lastPlusParts.length - 1];
    
    // 如果最后部分还包含点号，取点号后面的部分
    if (lastPart.includes(".")) {
      const lastDotParts = lastPart.split(".");
      return lastDotParts[lastDotParts.length - 1];
    } else {
      // 否则返回最后一个+后面的部分
      return lastPart;
    }
  }
  
  // 对于只包含.的ID
  if (id.includes(".")) {
    const parts = id.split(".");
    return parts[parts.length - 1];
  }
  
  // 无法确定编号
  return id;
}


// ===== 节点点击滚动功能 =====
// 查找并滚动到右侧视图中的指定文件
function findAndScrollToFileInAOTM(fileName) {
  setTimeout(() => {
    try {
      const potentialTables = document.querySelectorAll(
        '.workspace-leaf:not(.mod-active) .view-content table tbody, .workspace-leaf:not(.mod-active) .view-content .custom-table tbody'
      );
      if (!potentialTables || potentialTables.length === 0) {
        throw new Error('未找到可能包含文件列表的表格');
      }

      let targetRow = null;
      let containingTable = null;

      for (const tableBody of potentialTables) {
        const allRows = Array.from(tableBody.querySelectorAll('tr'));
        const foundRow = allRows.find(row => row.textContent.includes(fileName));
        if (foundRow) {
          targetRow = foundRow;
          containingTable = tableBody;
          break;
        }
      }

      if (!targetRow) {
        const allElements = document.querySelectorAll(
          '.workspace-leaf:not(.mod-active) .view-content *'
        );
        for (const element of allElements) {
          if (element.textContent.includes(fileName)) {
            targetRow = element.closest('tr') || element;
            break;
          }
        }
      }

      if (!targetRow) {
        if (window.Notice) {
          new Notice(`在右侧视图中未找到笔记: ${fileName}`);
        } else {
          console.log(`在右侧视图中未找到笔记: ${fileName}`);
        }
        return;
      }

      const scrollContainer =
        targetRow.closest('.workspace-leaf-content') ||
        targetRow.closest('.view-content') ||
        document.querySelector('.workspace-split.mod-vertical.mod-root');

      if (!scrollContainer) {
        throw new Error('未找到可滚动容器');
      }

      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const originalBackground = targetRow.style.backgroundColor;
      const originalTransition = targetRow.style.transition;
      targetRow.style.transition = 'background-color 0.8s';
      targetRow.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';

      setTimeout(() => {
        targetRow.style.backgroundColor = originalBackground;
        targetRow.style.transition = originalTransition;
      }, 3000);

      let noticeMessage;
      if (containingTable) {
        const allRows = Array.from(containingTable.querySelectorAll('tr'));
        const rowIndex = allRows.indexOf(targetRow) + 1;
        noticeMessage = `已找到并滚动到笔记：${fileName}（第 ${rowIndex} 行 / 共 ${allRows.length} 行）`;
      } else {
        noticeMessage = `已找到并滚动到笔记：${fileName}`;
      }

      if (window.Notice) {
        new Notice(noticeMessage);
      } else {
        console.log(noticeMessage);
      }
    } catch (error) {
      console.error('滚动定位错误:', error);
      const errorMessage = `查找或滚动过程中发生错误：${error.message}`;
      if (window.Notice) {
        new Notice(errorMessage);
      } else {
        console.error(errorMessage);
      }
    }
  }, 300);
}

// ===== 节点点击滚动功能 =====
// 查找并滚动到右侧视图中的指定文件
/**
 * [已修正] 查找并滚动到右侧视图中的指定文件
 * - 修正了窗格选择逻辑，不再使用 :not(.mod-active)
 * - 增强了对不同列表类型的兼容性（表格或Div列表）
 */
/**
 * [最终健壮版] 查找并滚动到右侧视图中的指定文件
 * - 统一使用最可靠的窗格和行项目定位逻辑。
 */
/**
 * [最终修正版] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 * - 增加了对目标窗格的“可见性”检查，确保只在活动的分屏中查找。
 */
/**
 * [终极混合版] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 * - 结合了两种策略：优先使用 [data-path]，失败则回退到查找表格行 <tr>。
 * - 增强了ID提取逻辑，确保能从链接或文本中获取ID。
 */





// ===== 数据收集与处理 =====
// 获取所有文件
function getFiles() {
  try {
    // 使用真实数据 - 查询指定前缀的节点
    return dv.pages()
      .where(p => p.file.name.startsWith(CONFIG.targetNode))
      .sort(p => p.file.name, 'asc')
      .map(p => {
        return {
          file: p.file,
          mermaidViewComplete: p["mermaid应用的范式"] === true, // 这是我们上次加的
          mermaidViewBayes: p["mermaid贝叶斯"] === true, // 新增贝叶斯节点
          mermaidViewStandard: p["mermaid批判式标准"] === true, // 新增批判式标准节点
          mermaidViewPending: p["mermaid未闭环"] === true, // 新增未闭环节点
          mermaidViewAI: p["mermaid关键词"] === true, // 新增关键词解释节点
          mermaidViewHighlight: p["mermaid视图重点"] === true, // <<< 增加这一行，用于重点标记
          // --- 新增代码 ---
          isFolded: p['图折叠'] === true // 读取"图折叠"属性，用于控制折叠
          // --- 新增代码结束 ---
        };
      })
      .array();
  } catch (error) {
    return [];
  }
}



// 获取直接状态转移节点
function getDirectStateTransitions(node, allNodes) {
  return allNodes.filter(n => {
    // 跳过自身
    if (n.id === node.id) return false;
    
    // 使用改进后的函数判断状态转移关系
    return isStateTransitionRelation(node.id, n.id);
  });
}

// 获取所有直接子节点 - 通过"."连接的
function getDirectChildren(node, allNodes) {
  return allNodes.filter(potentialChild => {
    // 跳过自身
    if (potentialChild.id === node.id) return false;
    
    // 只检查通过"."连接的子节点
    if (potentialChild.id.startsWith(node.id + ".")) {
      const remainingPart = potentialChild.id.substring(node.id.length + 1);
      // 确保这是直接子节点
      return !remainingPart.includes(".");
    }
    
    return false;
  });
}

// 获取所有直接点号子节点
function getDirectDotChildren(node, allNodes) {
  return allNodes.filter(n => {
    // 跳过自身
    if (n.id === node.id) return false;
    
    // 确保是通过添加"."形成的直接子节点
    if (n.id.startsWith(node.id + ".")) {
      const remainingPart = n.id.substring(node.id.length + 1);
      // 确保这是直接子节点
      return !remainingPart.includes(".");
    }
    
    return false;
  });
}

// 获取所有点号子孙节点
function getAllDotDescendants(node, allNodes) {
  const descendants = [];
  const queue = [node];
  const processed = new Set([node.id]);
  
  while (queue.length > 0) {
    const currentNode = queue.shift();
    
    // 查找当前节点的所有直接点号子节点
    const dotChildren = getDirectDotChildren(currentNode, allNodes);
    
    // 将找到的子节点添加到结果集中
    dotChildren.forEach(child => {
      if (!processed.has(child.id)) {
        descendants.push(child);
        processed.add(child.id);
        queue.push(child); // 将子节点加入队列，继续处理其子节点
      }
    });
  }
  
  return descendants;
}

// 收集相关节点
function collectRelevantNodes(targetNode, allNodes, maxDepth) {
  const result = new Set([targetNode]);
  
  // 辅助函数：递归收集父节点
  function collectParents(node, depth) {
    if (depth >= maxDepth) return;
    if (!node.parentId) return;
    
    const parent = allNodes.find(n => n.id === node.parentId);
    if (parent) {
      result.add(parent);
      collectParents(parent, depth + 1);
    }
  }
  
  // 辅助函数：递归收集子节点
  function collectChildren(nodeId, depth) {
    if (depth >= maxDepth) return;
    
    // 找出所有直接子节点
    const directChildren = allNodes.filter(n => 
      isChildRelation(nodeId, n.id)
    );
    
    // 添加子节点并继续递归
    directChildren.forEach(child => {
      result.add(child);
      
      // 如果配置为显示所有子孙节点，则递归收集
      if (CONFIG.showAllDescendants) {
        collectChildren(child.id, depth + 1);
      }
    });
  }
  
  // 收集父节点
  collectParents(targetNode, 0);
  
  // 收集子节点
  collectChildren(targetNode.id, 0);
  
  // 收集状态转移节点及相关节点
  function collectStateTransitions() {
    const currentSize = result.size;
    
    // 构建直接状态转移关系映射
    const directTransitionMap = new Map();
    allNodes.filter(node => node.hasStateTransition).forEach(node => {
      const sourceId = getStateTransitionParentId(node.id);
      if (sourceId) {
        if (!directTransitionMap.has(sourceId)) {
          directTransitionMap.set(sourceId, []);
        }
        directTransitionMap.get(sourceId).push(node);
      }
    });
    
    // 遍历当前结果集中的所有节点
    Array.from(result).forEach(node => {
      // 如果节点有状态转移子节点，添加它们
      if (directTransitionMap.has(node.id)) {
        directTransitionMap.get(node.id).forEach(stateNode => {
          result.add(stateNode);
          
          // 收集这个状态转移节点的点号子孙节点
          getAllDotDescendants(stateNode, allNodes).forEach(desc => {
            result.add(desc);
          });
        });
      }
      
      // 如果是状态转移节点，确保其基础状态节点也被收集
      if (node.hasStateTransition) {
        const sourceId = getStateTransitionParentId(node.id);
        if (sourceId) {
          const sourceNode = allNodes.find(n => n.id === sourceId);
          if (sourceNode) {
            result.add(sourceNode);
            
            // 收集源节点的点号子孙节点
            getAllDotDescendants(sourceNode, allNodes).forEach(desc => {
              result.add(desc);
            });
          }
        }
      }
    });
    
    // 如果集合大小有变化，继续迭代
    if (currentSize !== result.size) {
      collectStateTransitions();
    }
  }
  
  // 递归收集所有状态转移关系
  collectStateTransitions();
  
  return Array.from(result);
}

// 创建子图 - 修改后正确处理子孙节点
function createSubgraph(nodeId, relevantNodes, graph, graphData) {
  console.log(`createSubgraph called with nodeId: ${nodeId}`);

  const dashIndex = nodeId.indexOf('-');
  const pureNodeId = dashIndex > 0 ? nodeId.substring(0, dashIndex) : nodeId;
  const subgraphId = `state_${pureNodeId.replace(/[@\.+]/g, "_")}`;

  if (graph.processedSubgraphs.has(subgraphId)) {
    console.log(`Subgraph ${subgraphId} already processed`);
    return false;
  }

  const currentNode = relevantNodes.find(node => node.id === nodeId);
  if (!currentNode) {
    console.warn(`Cannot find currentNode for nodeId: ${nodeId}`);
    return false;
  }

  const subgraphNodeIds = [currentNode.id];
  relevantNodes.forEach(node => {
    const childDashIndex = node.id.indexOf('-');
    const pureChildId = childDashIndex > 0 ? node.id.substring(0, childDashIndex) : node.id;

    if (node.id !== currentNode.id && pureChildId.startsWith(pureNodeId + ".")) {
      const childPlusLevel = getPlusLevel(pureChildId);
      const nodePlusLevel = getPlusLevel(pureNodeId);
      if (childPlusLevel === nodePlusLevel) {
        subgraphNodeIds.push(node.id);
      }
    }
  });

  console.log(`Subgraph ${subgraphId} will have ${subgraphNodeIds.length} nodes`);

  const nodeLevelMap = new Map();
  subgraphNodeIds.forEach(id => {
    const idDashIndex = id.indexOf('-');
    const pureId = idDashIndex > 0 ? id.substring(0, idDashIndex) : id;
    const dotLevel = getDotLevel(pureId) - getDotLevel(pureNodeId);
    nodeLevelMap.set(id, dotLevel + 1);
  });

  const internalEdges = [];
  const sortedNodes = [...subgraphNodeIds].sort((a, b) => nodeLevelMap.get(a) - nodeLevelMap.get(b));

  for (const id of sortedNodes) {
    if (id === nodeId) continue;
    const parentId = getParentId(id);
    if (parentId && subgraphNodeIds.includes(parentId)) {
      const sourceSafeId = safeNodeId(parentId);
      const targetSafeId = safeNodeId(id);
      const globalEdgeKey = `${sourceSafeId}->${targetSafeId}`;

      if (!graph.processedEdges) graph.processedEdges = new Set();

      if (!graph.processedEdges.has(globalEdgeKey)) {
        internalEdges.push({ source: parentId, target: id });
        graph.processedEdges.add(globalEdgeKey);
      }
    }
  }

  graphData.subgraphs.push({
    id: subgraphId,
    label: `${nodeId} 状态`,
    nodes: subgraphNodeIds,
    edges: internalEdges,
    baseNode: nodeId,
    nodeLevels: nodeLevelMap
  });

  graph.processedSubgraphs.add(subgraphId);
  console.log(`Subgraph ${subgraphId} created with ${internalEdges.length} internal edges`);
  return true;
}

/**
 * 构建状态转移关系图 (最终修正版)
 * 增加层级比较，以正确处理并列的头领节点。
 * @param {object} targetNode - 起始节点
 * @param {Array} allNodes - 所有相关节点
 * @param {number} maxDepth - 最大深度
 * @returns {object} - 包含节点、子图和边的图数据
 */
/**
 * 构建状态转移关系图 (最终修正版)
 * 通过精确的父子关系判断和层级比较，正确处理并列头领和深度嵌套。
 */
/**
 * 构建状态转移关系图 (最终修正版)
 * 通过精确的父子关系判断和层级比较，正确处理并列头领和深度嵌套。
 */
/**
 * 构建状态转移关系图 (最终修正版)
 * 通过精确的父子关系判断和层级比较，正确处理并列头领和深度嵌套。
 * @param {object} targetNode - 起始节点
 * @param {Array} allNodes - 所有相关节点
 * @param {number} maxDepth - 最大深度
 * @returns {object} - 包含节点、子图和边的图数据
 */
/**
 * 构建状态转移关系图 (最终完美版)
 * 使用“结构性父头领”查找，实现完美的层级嵌套。
 */
/**
 * Builds the state transition graph structure. (Final, Complete Version)
 * This version correctly handles peer leaders, nested subgraphs, and calculates the nesting level for each subgraph.
 * @param {object} targetNode - The starting node for the graph.
 * @param {Array} allNodes - An array of all node objects.
 * @param {number} [maxDepth=10] - The maximum depth for node collection.
 * @returns {object} The complete graph data structure.
 */
/**
 * 构建状态转移关系图 (最终完美版)
 * 集成了“结构性父头领”查找和“隐形节点布局”逻辑。
 */
/**
 * 构建状态转移关系图 (最终完美版)
 * 集成了“结构性父头领”查找和“隐形节点布局”逻辑。
 * @param {object} targetNode - 起始节点
 * @param {Array} allNodes - 所有相关节点
 * @param {number} maxDepth - 最大深度
 * @returns {object} - 包含节点、子图和边的图数据
 */
/**
 * 构建状态转移关系图 (最终完美版)
 * 集成了对“状态转移树父子关系”的隐形节点布局。
 */
/**
 * 构建状态转移关系图 (最终完美版)
 * 集成了最精确的“隐形节点”布局逻辑，从“跳板节点”发起连接。
 */
/**
 * 构建状态转移关系图 (最终完美版)
 * 集成了对“状态转移树父子关系”的隐形节点布局。
 */
/**
 * buildStateTransitionGraph (Final Version with Dual-Connection Logic)
 * Implements the definitive "State Transition Tree" layout, creating both
 * invisible layout links and a direct solid indicator link.
 */
/**
 * buildStateTransitionGraph (Final, Corrected Version)
 * Implements the definitive logic for ST-Tree and nested relationships,
 * including the dual-connection strategy for ST-Tree layout.
 * @param {object} targetNode The starting node for the graph.
 * @param {Array} allNodes An array of all node objects.
 * @param {number} [maxDepth=10] The maximum depth for node collection.
 * @returns {object} The complete graph data structure.
 */
/**
 * buildStateTransitionGraph (最终完美版)
 * 采用最严格的层级比较，彻底解决所有错误的嵌套问题。
 * @param {object} targetNode The starting node for the graph.
 * @param {Array} allNodes An array of all node objects.
 * @param {number} [maxDepth=10] The maximum depth for node collection.
 * @returns {object} The complete graph data structure.
 */
/**
 * buildStateTransitionGraph (最终完美版)
 * 采用最严格的层级比较和父级继承，彻底解决所有错误的嵌套和分离问题。
 * @param {object} targetNode The starting node for the graph.
 * @param {Array} allNodes An array of all node objects.
 * @param {number} [maxDepth=10] The maximum depth for node collection.
 * @returns {object} The complete graph data structure.
 */
/**
 * buildStateTransitionGraph (Final Version with ID Simplification)
 * Generates simplified, human-readable IDs for Mermaid code while
 * maintaining a full map for interactivity.
 */
/**
 * buildStateTransitionGraph (Final, Definitive Version)
 * Implements the "deepest node" logic for perfect layout link origination.
 * @param {object} targetNode The starting node for the graph.
 * @param {Array} allNodes An array of all node objects.
 * @param {number} [maxDepth=10] The maximum depth for node collection.
 * @returns {object} The complete graph data structure.
 */
/**
 * buildStateTransitionGraph (Final, Definitive Version)
 * Implements the recursive "deepest node" logic for perfect layout link origination,
 * ensuring the most robust and visually stable ST-Tree layout.
 * @param {object} targetNode The starting node for the graph.
 * @param {Array} allNodes An array of all node objects.
 * @param {number} [maxDepth=10] The maximum depth for node collection.
 * @returns {object} The complete graph data structure.
 */
/**
 * buildStateTransitionGraph (Final, Definitive Version)
 * Implements the "deepest node" logic for perfect layout link origination by
 * recursively searching through nested subgraphs and ST-Children.
 * @param {object} targetNode The starting node for the graph.
 * @param {Array} allNodes An array of all node objects.
 * @param {number} [maxDepth=10] The maximum depth for node collection.
 * @returns {object} The complete graph data structure.
 */
/**
 * buildStateTransitionGraph (Final, Definitive Version)
 * Implements the ultimate "deepest node" logic by recursively searching
 * through all nested ST-Children to find the true visual bottom of a subgraph,
 * ensuring perfect layout link origination.
 *
 * @param {object} targetNode - The starting node for the graph.
 * @param {Array} allNodes - An array of all node objects.
 * @param {number} [maxDepth=10] - The maximum depth for node collection.
 * @returns {object} The complete graph data structure for rendering.
 */
/**
 * buildStateTransitionGraph (The Absolute Final Version)
 * Implements the definitive "true deepest node" logic by calculating
 * a composite depth score for perfect layout link origination.
 * @param {object} targetNode The starting node for the graph.
 * @param {Array} allNodes An array of all node objects.
 * @param {number} [maxDepth=10] The maximum depth for node collection.
 * @returns {object} The complete graph data structure.
 */
function buildStateTransitionGraph(targetNode, allNodes, maxDepth = 10) {
    const relevantNodes = collectRelevantNodes(targetNode, allNodes, maxDepth);
    const nodeById = new Map(relevantNodes.map(n => [n.id, n]));
    const heads = relevantNodes.filter(n => isLeaderNode(n.id));

    // --- ID Simplification Logic (no changes needed) ---
    const idMap = new Map();
    const simpleIdCounter = { L: 0, M: 0, B: 0 };
    function getSimpleId(node) {
        if (idMap.has(node.id)) return idMap.get(node.id);
        let prefix = isLeaderNode(node.id) ? 'L' : (node.parentId || getStateTransitionParentId(node.id) ? 'M' : 'B');
        const simpleId = prefix + simpleIdCounter[prefix]++;
        idMap.set(node.id, simpleId);
        node.simpleId = simpleId;
        return simpleId;
    }
    relevantNodes.forEach(n => getSimpleId(n));
    // --- End of ID Simplification ---

    const subgraphs = [];
    const subgraphMap = new Map();
    heads.forEach(head => {
        const sg = {
            id: `sg_${head.simpleId}`,
            label: `${head.id} 状态`,
            baseNode: head.id,
            nodes: [], 
            edges: [], 
            parent: null
        };
        subgraphMap.set(head.id, sg);
        subgraphs.push(sg);
    });

    // Parent-child subgraph logic (no changes needed)
    subgraphs.forEach(sg => {
        const sourceId = getStateTransitionParentId(sg.baseNode);
        if (!sourceId || !nodeById.has(sourceId)) return;
        if (!isLeaderNode(sourceId)) {
            let parentCandidateId = sourceId;
            while (parentCandidateId) {
                if (isLeaderNode(parentCandidateId) && subgraphMap.has(parentCandidateId)) {
                    sg.parent = subgraphMap.get(parentCandidateId).id;
                    break;
                }
                parentCandidateId = getParentId(parentCandidateId);
            }
        } else {
            const parentSubgraph = subgraphMap.get(sourceId);
            if (parentSubgraph) {
                sg.parent = parentSubgraph.parent;
            }
        }
    });

    // Populate subgraphs with members (no changes needed)
    heads.forEach(head => {
        const sg = subgraphMap.get(head.id);
        const childHeadIds = subgraphs.filter(csg => csg.parent === sg.id).map(csg => csg.baseNode);
        const sgNodes = computeSubgraphNodes(head.id, relevantNodes, childHeadIds);
        sg.nodes = Array.from(sgNodes);
        sgNodes.forEach(id => {
            const parentId = getParentId(id);
            if (parentId && sgNodes.has(parentId)) {
                sg.edges.push({ source: parentId, target: id });
            }
        });
    });

    // **THE DEFINITIVE HELPER FUNCTION: Get True Deepest Node**
    function getTrueDeepestNode(subgraph) {
        if (!subgraph) return null;

        let deepestNodeId = subgraph.baseNode;
        let maxDepthScore = -1;

        const processedNodes = new Set();

        // Recursive function to traverse and score all nodes within a subgraph's hierarchy
        function traverseAndScore(currentSg) {
            // Score all direct member nodes of this subgraph
            currentSg.nodes.forEach(nodeId => {
                if (processedNodes.has(nodeId)) return;
                
                // The "True Depth Score" is a combination of its own ID depth
                // and the nesting level of its containing subgraph.
                const nodeDotLevel = getDotLevel(nodeId);
                const subgraphNestingLevel = getSubgraphNestingLevel(currentSg);
                const totalScore = nodeDotLevel + subgraphNestingLevel * 10; // Weight nesting heavily

                if (totalScore > maxDepthScore) {
                    maxDepthScore = totalScore;
                    deepestNodeId = nodeId;
                }
                processedNodes.add(nodeId);
            });

            // Recurse into nested child subgraphs
            subgraphs.forEach(childSg => {
                if (childSg.parent === currentSg.id) {
                    traverseAndScore(childSg);
                }
            });
        }

        function getSubgraphNestingLevel(sg) {
            let level = 0;
            let current = sg;
            while (current && current.parent) {
                level++;
                current = subgraphs.find(s => s.id === current.parent);
            }
            return level;
        }

        traverseAndScore(subgraph);
        return deepestNodeId;
    }

    // Create global connections using the definitive logic
    const invisibleNodes = [];
    const edges = [];
    let invisibleCounter = 1;

    heads.forEach(head => {
        const sourceId = getStateTransitionParentId(head.id);
        if (sourceId && nodeById.has(sourceId)) {
            // ST-Tree Relationship
            if (isLeaderNode(sourceId)) {
                const parentSubgraph = subgraphMap.get(sourceId);
                
                // **CRUCIAL CHANGE**: Use the new, perfect helper function
                const layoutSourceNodeId = getTrueDeepestNode(parentSubgraph);
                
                if (layoutSourceNodeId) { // Ensure we found a node
                    const invisibleId = `invisible${invisibleCounter++}`;
                    invisibleNodes.push(invisibleId);
                    edges.push({ source: layoutSourceNodeId, target: invisibleId, type: 'invisible' });
                    edges.push({ source: invisibleId, target: head.id, type: 'invisible' });
                    edges.push({ source: sourceId, target: head.id, type: 'st-indicator' });
                } else {
                    // Fallback to direct connection if no deepest node is found
                    edges.push({ source: sourceId, target: head.id, type: 'st-indicator' });
                }

            } 
            // Nested Relationship
            else {
                edges.push({ source: sourceId, target: head.id, type: 'stateTransition' });
            }
        }
    });

    return {
        nodes: relevantNodes,
        subgraphs: subgraphs,
        edges: edges,
        invisibleNodes: invisibleNodes
    };
}





















// ===== Mermaid代码生成 =====
// 生成Mermaid图表代码
/**
 * 生成最终的Mermaid图表代码
 * @param {object} graph - 由buildStateTransitionGraph生成的图表数据结构
 * @param {function} clickCallback - 节点点击时的回调函数
 * @returns {string} - 完整的Mermaid代码
 */
/**
 * Generates the final Mermaid code for the diagram.
 * This function recursively renders nested subgraphs and ensures correct node and edge definitions.
 * @param {object} graph - The graph data structure from buildStateTransitionGraph.
 * @param {function} clickCallback - The callback function for node clicks.
 * @returns {string} - The complete Mermaid code.
 */
/**
 * 生成最终的Mermaid图表代码 (最终版)
 * @param {object} graph - 由buildStateTransitionGraph生成的图表数据结构
 * @param {function} clickCallback - 节点点击时的回调函数
 * @returns {string} - 完整的Mermaid代码
 */
/**
 * 生成最终的Mermaid图表代码 (最终完整版)
 * 能够处理并列头领、深度嵌套和所有类型的连接。
 * @param {object} graph - 由buildStateTransitionGraph生成的图表数据结构
 * @param {function} clickCallback - 节点点击时的回调函数
 * @returns {string} - 完整的Mermaid代码
 */
/**
 * 生成最终的Mermaid图表代码 (最终重构版)
 * 能够处理并列头领、深度嵌套和所有类型的连接。
 */
/**
 * 生成最终的Mermaid图表代码 (最终重构版)
 * 能够处理并列头领、深度嵌套和所有类型的连接。
 */
/**
 * 生成最终的Mermaid图表代码 (最终完美版)
 * 能够渲染隐形节点以实现精确的层级对齐。
 * @param {object} graph - 图表数据结构
 * @param {function} clickCallback - 节点点击回调
 * @returns {string} - 完整的Mermaid代码
 */
/**
 * 生成最终的Mermaid图表代码 (最终完整版)
 * 能够渲染隐形节点以实现精确的层级对齐。
 * @param {object} graph - 图表数据结构
 * @param {function} clickCallback - 节点点击回调
 * @returns {string} - 完整的Mermaid代码
 */
/**
 * generateMermaidCode (Final Version for Simple IDs)
 * Uses simplified IDs for a clean diagram and correctly maps them for interactivity.
 */
function generateMermaidCode(graph, clickCallback, foldedPrefixes = []) {
    let code = `flowchart ${CONFIG.layout}\n`;
    
    // Style definitions
    code += "  %% 样式定义\n";
    code += "  classDef base fill:#dfd,stroke:#393\n";
    code += "  classDef leader fill:#ffeb99,stroke:#933,stroke-width:1.5px\n";
    code += "  classDef member fill:#ddf,stroke:#333\n";
    code += "  classDef highlighted fill:#F37021,stroke:#C05000,stroke-width:1.5px,color:white\n";
    code += "  classDef bayes fill:#008000,stroke:#C05000,stroke-width:1.5px,color:white\n";
    code += "  classDef Standard fill:#8B5CF6,stroke:#C05000,stroke-width:1.5px,color:white\n";
    code += "  classDef completed fill:#5383AA,stroke:#C05000,stroke-width:1.5px,color:white\n";
    code += "  classDef pending fill:#002FA7,stroke:#C05000,stroke-width:1.5px,color:white\n";
    code += "  classDef AI fill:#E34234,stroke:#C05000,stroke-width:1.5px,color:white\n";
    code += "  classDef invisible fill:none,stroke:none\n";
    // --- 新增: 折叠节点的样式 ---
    code += "  classDef foldedNode fill:#e9ecef,stroke:#adb5bd,stroke-dasharray: 4 4\n";

    // Build indexes
    const nodeIndex = new Map(graph.nodes.map(n => [n.id, n]));
    const subgraphMap = new Map(graph.subgraphs.map(sg => [sg.id, sg]));
    const childrenByParent = new Map([[null, []]]);
    graph.subgraphs.forEach(sg => {
        const parentId = sg.parent || null;
        if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
        childrenByParent.get(parentId).push(sg.id);
    });

    const definedNodes = new Set();
    const renderedEdges = new Set();
    
    // --- 新增: 辅助函数 ---
    function getPureId(id) {
        const dashIndex = id.indexOf('-');
        return dashIndex >= 0 ? id.substring(0, dashIndex) : id;
    }

    function isHidden(nodeId) {
        if (!foldedPrefixes || foldedPrefixes.length === 0) return false;
        const pureNodeId = getPureId(nodeId);
        // 如果节点的 pureId 以任何折叠前缀开头，并且它不等于那个前缀本身，则隐藏它
        return foldedPrefixes.some(prefix => pureNodeId.startsWith(prefix) && pureNodeId !== prefix);
    }
    // --- 辅助函数结束 ---

    function getLabel(nodeId) {
        const node = nodeIndex.get(nodeId);
        if (!node) return nodeId;
        let text = `${node.id}<br>${node.name || ""}`;
        if (text.length > 20) {
            text = text.replace(/(.{15,20})([\s,\.，。;；:：!！？?])/g, '$1$2<br>');
            if (!text.includes('<br>') && text.length > 20) {
                const chunks = [];
                for (let i = 0; i < text.length; i += 20) {
                    chunks.push(text.substring(i, Math.min(i + 20, text.length)));
                }
                text = chunks.join('<br>');
            }
        }
        return text;
    }

    function renderSubgraphRecursive(subgraphId) {
        const sg = subgraphMap.get(subgraphId);
        if (!sg || isHidden(sg.id)) return ""; // 如果子图本身被隐藏，则不渲染
        let subCode = `  subgraph "${sg.label}"\n`;
        
        (sg.nodes || []).forEach(nodeId => {
            if (isHidden(nodeId)) return; // 修改: 跳过被隐藏的节点
            const node = nodeIndex.get(nodeId);
            if (node && !definedNodes.has(node.simpleId)) {
                subCode += `    ${node.simpleId}["${getLabel(nodeId)}"]\n`;
                definedNodes.add(node.simpleId);
            }
        });

        (sg.edges || []).forEach(edge => {
            if (isHidden(edge.source) || isHidden(edge.target)) return; // 修改: 跳过与隐藏节点相关的边
            const sourceNode = nodeIndex.get(edge.source);
            const targetNode = nodeIndex.get(edge.target);
            if (sourceNode && targetNode) {
                const edgeKey = `${sourceNode.simpleId}-->${targetNode.simpleId}`;
                if (!renderedEdges.has(edgeKey)) {
                    subCode += `    ${sourceNode.simpleId} --> ${targetNode.simpleId}\n`;
                    renderedEdges.add(edgeKey);
                }
            }
        });

        (childrenByParent.get(subgraphId) || []).forEach(childId => {
            subCode += renderSubgraphRecursive(childId);
        });
        subCode += `  end\n`;
        return subCode;
    }

    // --- Begin Rendering ---
    
    code += "\n  %% 节点定义\n";
    (graph.invisibleNodes || []).forEach(id => {
        if (isHidden(id)) return; // 修改: 跳过被隐藏的节点
        code += `  ${id}[" "]\n`;
        definedNodes.add(id);
    });
    
    const allSubgraphNodes = new Set(graph.subgraphs.flatMap(sg => sg.nodes));

    graph.nodes.forEach(node => {
        if (!allSubgraphNodes.has(node.id) && !definedNodes.has(node.simpleId)) {
            if (isHidden(node.id)) return; // 修改: 跳过被隐藏的节点
            code += `  ${node.simpleId}["${getLabel(node.id)}"]\n`;
            definedNodes.add(node.simpleId);
        }
    });
    
    (childrenByParent.get(null) || []).forEach(sgId => {
        code += renderSubgraphRecursive(sgId);
    });

    // Render Connections
    code += "\n  %% 连接线定义\n";
    graph.nodes.forEach(node => {
        const parentId = getParentId(node.id);
        if (parentId && nodeIndex.has(parentId) && !allSubgraphNodes.has(node.id) && !allSubgraphNodes.has(parentId)) {
            if (isHidden(node.id) || isHidden(parentId)) return; // 修改: 跳过与隐藏节点相关的边
            const parentNode = nodeIndex.get(parentId);
            const edgeKey = `${parentNode.simpleId}-->${node.simpleId}`;
            if (!renderedEdges.has(edgeKey)) {
                code += `  ${parentNode.simpleId} --> ${node.simpleId}\n`;
                renderedEdges.add(edgeKey);
            }
        }
    });

    (graph.edges || []).forEach(edge => {
        if (isHidden(edge.source) || isHidden(edge.target)) return; // 修改: 跳过与隐藏节点相关的边
        const sourceNode = nodeIndex.get(edge.source) || { simpleId: edge.source };
        const targetNode = nodeIndex.get(edge.target) || { simpleId: edge.target };
        const edgeKey = `${sourceNode.simpleId}-->${targetNode.simpleId}`;
        if (renderedEdges.has(edgeKey) && edge.type !== 'invisible') return;
        
        if (edge.type === 'invisible') {
            code += `  ${sourceNode.simpleId} -.-> ${targetNode.simpleId}\n`;
        } else {
            code += `  ${sourceNode.simpleId} --> ${targetNode.simpleId}\n`;
        }
        renderedEdges.add(edgeKey);
    });

    // ===== Corrected Style Application Logic =====

    code += "\n  %% 样式应用\n";
    graph.nodes.forEach(n => {
        if (isHidden(n.id)) return; // 修改: 不为隐藏节点应用样式
        const sId = n.simpleId;
        const pureId = getPureId(n.id); // 获取纯ID用于判断折叠

        // 优先级：高亮 > 折叠 > 其他
        if (n.mermaidViewHighlight) {
            code += `  class ${sId} highlighted\n`;
        } else if (foldedPrefixes.includes(pureId)) { // 修改: 应用折叠样式
            code += `  class ${sId} foldedNode\n`;
        } else if (n.mermaidViewBayes) {
            code += `  class ${sId} bayes\n`;
        } else if (n.mermaidViewPending) {
            code += `  class ${sId} pending\n`;
        } else if (n.mermaidViewAI) {
            code += `  class ${sId} AI\n`;
        } else if (n.mermaidViewStandard) {
            code += `  class ${sId} Standard\n`;
        } else if (n.mermaidViewComplete) {
            code += `  class ${sId} completed\n`;
        } else if (isLeaderNode(n.id)) {
            code += `  class ${sId} leader\n`;
        } else if (allSubgraphNodes.has(n.id)) {
            code += `  class ${sId} member\n`;
        } else {
            code += `  class ${sId} base\n`;
        }
    });

    (graph.invisibleNodes || []).forEach(id => {
        if (isHidden(id)) return;
        code += `  class ${id} invisible\n`;
    });

    // Bind Click Events
    if (typeof clickCallback === 'function') {
        code += "\n  %% 绑定点击事件\n";
        window.stateTransitionNodeIdMap = {};
        graph.nodes.forEach(n => {
            window.stateTransitionNodeIdMap[n.simpleId] = n;
        });
        
        // 修改: 只为未被隐藏的节点绑定点击事件
        const clickableNodes = graph.nodes
            .filter(n => n.fileName && !isHidden(n.id)) 
            .map(n => n.simpleId);

        if (clickableNodes.length > 0) {
            window.stateTransitionNodeClickCallback = clickCallback;
            code += `  click ${clickableNodes.join(',')} stateTransitionNodeClickCallback\n`;
            code += "  classDef clickable cursor:pointer\n";
            code += `  class ${clickableNodes.join(',')} clickable\n`;
        }
    }

    return code;
}












// ===== UI 和主程序 =====
// 创建用户界面
function createUI(container) {
  // 清除现有内容
  container.empty();
  
  // 标题
  container.createEl("h3", { text: "状态转移节点关系图" });
  
  // 设置面板
  const settingsDiv = container.createEl("div", { cls: "settings-panel" });
  settingsDiv.style.marginBottom = "15px";
  settingsDiv.style.padding = "10px";
  settingsDiv.style.backgroundColor = "#f5f5f5";
  settingsDiv.style.borderRadius = "5px";
  
  // 目标节点输入
  const nodeInput = settingsDiv.createEl("input", { 
    type: "text",
    value: CONFIG.targetNode,
    placeholder: "输入目标节点ID"
  });
  nodeInput.style.width = "200px";
  nodeInput.style.marginRight = "15px";
  
  // 深度设置
  const depthInput = settingsDiv.createEl("input", {
    type: "number",
    value: CONFIG.maxDepth,
    attr: { min: 1, max: 30 }
  });
  depthInput.style.width = "50px";
  depthInput.style.marginRight = "15px";
  
  // 布局选择
  const layoutSelect = settingsDiv.createEl("select");
  ["TB", "LR", "RL", "BT"].forEach(dir => {
    const option = layoutSelect.createEl("option", { text: dir });
    if (dir === CONFIG.layout) option.selected = true;
  });
  layoutSelect.style.marginRight = "15px";
  
  // 添加标签
  settingsDiv.insertBefore(document.createTextNode("目标节点: "), nodeInput);
  settingsDiv.insertBefore(document.createTextNode(" 最大深度: "), depthInput);
  settingsDiv.insertBefore(document.createTextNode(" 布局: "), layoutSelect);
  
  // 创建新行
  settingsDiv.createEl("br");
  
  // 添加不可见节点选项
  const invisibleCheck = settingsDiv.createEl("input", { 
    type: "checkbox",
    checked: CONFIG.addInvisibleNodes
  });
  invisibleCheck.style.marginRight = "5px";
  
  // 显示所有子孙节点选项
  const showAllCheck = settingsDiv.createEl("input", { 
    type: "checkbox",
    checked: CONFIG.showAllDescendants
  });
  showAllCheck.style.marginRight = "5px";
  
  // 显示完整ID选项
  const showFullIdsCheck = settingsDiv.createEl("input", { 
    type: "checkbox",
    checked: CONFIG.showFullIds
  });
  showFullIdsCheck.style.marginRight = "5px";
  
  // 启用缩放选项
  const zoomCheck = settingsDiv.createEl("input", { 
    type: "checkbox",
    checked: CONFIG.enableZoom
  });
  zoomCheck.style.marginRight = "5px";
  
  // 调试模式选项
  const debugCheck = settingsDiv.createEl("input", { 
    type: "checkbox",
    checked: CONFIG.debug
  });
  debugCheck.style.marginRight = "5px";
  
  // 添加标签
  settingsDiv.insertBefore(document.createTextNode("添加不可见节点: "), invisibleCheck);
  settingsDiv.insertBefore(document.createTextNode(" 显示所有子孙节点: "), showAllCheck);
  settingsDiv.insertBefore(document.createTextNode(" 显示完整ID: "), showFullIdsCheck);
  settingsDiv.insertBefore(document.createTextNode(" 启用缩放: "), zoomCheck);
  settingsDiv.insertBefore(document.createTextNode(" 调试模式: "), debugCheck);
  
  // 创建新行
  settingsDiv.createEl("br");
  
  // 更新按钮
  const updateButton = settingsDiv.createEl("button", { text: "更新图表" });
  updateButton.style.marginTop = "10px";
  
  // 说明信息
  const infoDiv = container.createEl("div", { cls: "info-panel" });
  infoDiv.style.marginBottom = "10px";
  infoDiv.style.fontSize = "0.9em";
  infoDiv.style.color = "#666";
  infoDiv.innerHTML = `
    <details>
      <summary style="cursor:pointer;color:#0074d9;">查看使用说明</summary>
      <p><b>节点交互功能:</b></p>
      <ul>
        <li><b>点击节点</b>: 点击图表中的任何节点，会自动滚动右侧边栏到对应的笔记位置</li>
        <li><b>高亮显示</b>: 找到的笔记行会暂时高亮显示，方便识别</li>
        <li><b>状态提示</b>: 点击后会显示操作结果的提示信息</li>
      </ul>
      <p>本图表使用循环迭代方式绘制状态转移关系，绘制逻辑为：</p>
      <ol>
        <li>首先绘制所有不包含"+"的普通节点</li>
        <li>然后按照循环迭代处理带"+"的状态转移节点:
          <ul>
            <li>a. 找到层级最小的尚未绘制的带"+"的节点</li>
            <li>b. 找到它的直接来源节点（最后一个"+"前的部分）</li>
            <li>c. 将来源节点及其所有子孙节点（使用"."连接的）放入一个subgraph中</li>
            <li>d. 用虚线箭头连接来源节点到状态转移节点</li>
            <li>e. 为状态转移节点创建子图，包含其点号子节点</li>
            <li>f. 重复以上步骤，直到所有带"+"的节点都被处理</li>
          </ul>
        </li>
      </ol>
      <p>节点关系说明:</p>
      <ul>
        <li>只有在编号末尾添加<b>新的"."</b>才产生子级节点</li>
        <li>在编号末尾添加<b>字母A</b>或<b>递增数字</b>都是创建<b>并列节点</b>，不是子节点</li>
        <li>添加<b>"+"</b>表示<b>状态转移关系</b></li>
      </ul>
      <p>图例说明:</p>
      <ul>
        <li><b>蓝色背景节点</b>: 普通节点</li>
        <li><b>绿色背景节点</b>: 基础状态节点</li>
        <li><b>黄色背景节点</b>: 状态转移节点(显示为"编号→名称"格式)</li>
        <li><b>实线箭头</b>: 普通层级关系</li>
        <li><b>虚线箭头</b>: 状态转移关系</li>
        <li><b>绿色方框</b>: 包含基础状态及其点号子节点的子图</li>
        <li><b>可点击节点</b>: 鼠标悬停时显示为手型光标，点击可导航到对应笔记</li>
      </ul>
      <p>缩放操作说明:</p>
      <ul>
        <li><b>放大/缩小按钮</b>: 点击按钮放大或缩小图表</li>
        <li><b>重置按钮</b>: 恢复原始大小</li>
        <li><b>键盘+鼠标</b>: Ctrl+滚轮进行图表缩放</li>
        <li><b>拖拽</b>: Alt+左键拖拽或中键拖拽进行平移</li>
      </ul>
    </details>
  `;
  
  // 状态信息
  const statusDiv = container.createEl("div", { cls: "status-info" });
  statusDiv.style.marginBottom = "10px";
  statusDiv.style.fontSize = "0.9em";
  
  // 图表容器
  const diagramContainer = container.createEl("div", { cls: "diagram-container" });
  diagramContainer.style.border = "1px solid #ccc";
  diagramContainer.style.padding = "10px";
  diagramContainer.style.minHeight = "500px";
  diagramContainer.style.position = "relative";
  diagramContainer.style.overflow = "auto";
  diagramContainer.style.maxHeight = "900vh"; // 限制最大高度
  
  // 代码切换按钮
  const toggleButton = container.createEl("button", { text: "显示/隐藏Mermaid代码" });
  toggleButton.style.marginTop = "10px";
  
  // 代码容器
  const codeContainer = container.createEl("div", { cls: "code-container" });
  codeContainer.style.display = "none";
  codeContainer.style.border = "1px solid #ccc";
  codeContainer.style.padding = "10px";
  codeContainer.style.marginTop = "10px";
  codeContainer.style.backgroundColor = "#f8f8f8";
  codeContainer.style.fontFamily = "monospace";
  codeContainer.style.fontSize = "0.9em";
  codeContainer.style.overflow = "auto";
  codeContainer.style.maxHeight = "300px";
  codeContainer.style.whiteSpace = "pre";
  
  // 代码复制按钮
  const copyButton = container.createEl("button", { text: "复制代码" });
  copyButton.style.marginTop = "5px";
  copyButton.style.display = "none";
  
  // 添加缩放控制
  const zoomControls = CONFIG.enableZoom ? setupZoomControls(container, diagramContainer) : null;
  
  // 更新按钮事件
  updateButton.addEventListener("click", () => {
    CONFIG.targetNode = nodeInput.value;
    CONFIG.maxDepth = parseInt(depthInput.value);
    CONFIG.layout = layoutSelect.value;
    CONFIG.addInvisibleNodes = invisibleCheck.checked;
    CONFIG.showAllDescendants = showAllCheck.checked;
    CONFIG.showFullIds = showFullIdsCheck.checked;
    CONFIG.enableZoom = zoomCheck.checked;
    CONFIG.debug = debugCheck.checked;
    
    renderDiagram(container, statusDiv, diagramContainer, codeContainer, zoomControls);
  });
  
  // 切换代码显示
  toggleButton.addEventListener("click", () => {
    if (codeContainer.style.display === "none") {
      codeContainer.style.display = "block";
      copyButton.style.display = "inline-block";
    } else {
      codeContainer.style.display = "none";
      copyButton.style.display = "none";
    }
  });
  
  // 复制代码
  copyButton.addEventListener("click", () => {
    const code = codeContainer.textContent;
    try {
      // 使用clipboard API复制
      navigator.clipboard.writeText(code).then(() => {
        statusDiv.textContent = "代码已复制到剪贴板";
        setTimeout(() => {
          if (statusDiv.textContent === "代码已复制到剪贴板") {
            statusDiv.textContent = "";
          }
        }, 2000);
      });
    } catch (err) {
      statusDiv.textContent = "复制失败: " + err.message;
    }
  });
  
  return { statusDiv, diagramContainer, codeContainer, zoomControls };
}

// 添加缩放功能
// ===== UI 和主程序 =====
// ... (Your other functions remain the same)

/**
 * setupZoomControls (Final Version with State Saving)
 * Sets up zoom and pan controls, and now saves the view state
 * to a global object on every interaction.
 * @param {HTMLElement} container The main container element.
 * @param {HTMLElement} diagramContainer The container for the Mermaid SVG.
 * @returns {object} An object with control functions.
 */
/**
 * setupZoomControls (Final Version)
 * Sets up zoom/pan and saves the view state to a global object.
 * This version is enhanced to correctly initialize from the global state.
 */
/**
 * setupZoomControls (Final, Perfected Version)
 * Implements a smooth, center-focused zoom by dynamically adjusting
 * scroll positions to keep the viewport's center stationary.
 */
function setupZoomControls(container, diagramContainer) {
    // 确保全局状态对象存在,并使用持久化存储
    if (!window.mermaidGraphState) {
        // 尝试从 localStorage 恢复状态
        const storedState = localStorage.getItem('mermaidGraphState');
        if (storedState) {
            try {
                window.mermaidGraphState = JSON.parse(storedState);
                console.log('[状态恢复] 从 localStorage 恢复状态:', window.mermaidGraphState);
            } catch (e) {
                console.warn('[状态恢复] localStorage 解析失败,使用默认值');
                window.mermaidGraphState = {
                    zoom: CONFIG.initialZoom,
                    scrollLeft: 0,
                    scrollTop: 0
                };
            }
        } else {
            window.mermaidGraphState = {
                zoom: CONFIG.initialZoom,
                scrollLeft: 0,
                scrollTop: 0
            };
        }
    }

    // 从保存的状态开始
    let currentZoom = window.mermaidGraphState.zoom || CONFIG.initialZoom;

    // --- UI Element Creation (no changes here) ---
    const zoomControls = container.createEl("div", { cls: "zoom-controls" });
    zoomControls.style.marginTop = "10px";
    zoomControls.style.marginBottom = "10px";
    zoomControls.style.display = "flex";
    zoomControls.style.alignItems = "center";
    const zoomOutBtn = zoomControls.createEl("button", { text: "➖" });
    const zoomResetBtn = zoomControls.createEl("button", { text: "重置" });
    const zoomInBtn = zoomControls.createEl("button", { text: "➕" });
    const zoomDisplay = zoomControls.createEl("span");
    zoomOutBtn.style.margin = "0 5px";
    zoomResetBtn.style.margin = "0 5px";
    zoomInBtn.style.margin = "0 5px";
    zoomDisplay.style.minWidth = "60px";
    zoomDisplay.style.textAlign = "center";

    // This function now *only* handles the visual update of the scale and text
    function updateZoomVisuals() {
        zoomDisplay.textContent = `${Math.round(currentZoom * 100)}%`;
        const svgElement = diagramContainer.querySelector("svg");
        if (svgElement) {
            // The transform-origin is now handled by scroll adjustments,
            // but setting it to top-left ensures consistency.
            svgElement.style.transformOrigin = "top left";
            svgElement.style.transform = `scale(${currentZoom})`;
            
            // Adjust container height to prevent scrollbars from jumping
            const newHeight = svgElement.getBoundingClientRect().height;
            if (newHeight > 0) {
                 diagramContainer.style.height = `${newHeight + 40}px`;
            }
        }
    }

    /**
     * **THE CORE LOGIC FOR CENTERED ZOOM**
     * This function applies the new zoom level and calculates the
     * required scroll offset to keep the view centered.
     */
    function applyZoom(newZoom) {
        // 1. Get viewport center and current scroll position (before zooming)
        const viewportCenterX = diagramContainer.clientWidth / 2;
        const viewportCenterY = diagramContainer.clientHeight / 2;
        const scrollLeftBefore = diagramContainer.scrollLeft;
        const scrollTopBefore = diagramContainer.scrollTop;

        // 2. Calculate which point on the un-scaled SVG is currently at the viewport center
        const pointX = (scrollLeftBefore + viewportCenterX) / currentZoom;
        const pointY = (scrollTopBefore + viewportCenterY) / currentZoom;

        // 3. Update to the new zoom level
        currentZoom = Math.max(0.1, newZoom);
        window.mermaidGraphState.zoom = currentZoom; // Save state
        // 保存到 localStorage
        saveStateToLocalStorage();

        // 4. Apply the visual scale change
        updateZoomVisuals();

        // 5. Calculate the new scroll positions needed to bring the target point back to the center
        const newScrollLeft = (pointX * currentZoom) - viewportCenterX;
        const newScrollTop = (pointY * currentZoom) - viewportCenterY;

        // 6. Apply the new scroll positions
        diagramContainer.scrollLeft = newScrollLeft;
        diagramContainer.scrollTop = newScrollTop;

        // 保存滚动状态
        window.mermaidGraphState.scrollLeft = newScrollLeft;
        window.mermaidGraphState.scrollTop = newScrollTop;
        saveStateToLocalStorage();
    }

    function zoomIn() { applyZoom(currentZoom + CONFIG.zoomStep); }
    function zoomOut() { applyZoom(currentZoom - CONFIG.zoomStep); }
    function resetZoom() { applyZoom(CONFIG.initialZoom); }

    zoomInBtn.addEventListener("click", zoomIn);
    zoomOutBtn.addEventListener("click", zoomOut);
    zoomResetBtn.addEventListener("click", resetZoom);

    // --- Event Listeners (Mouse Wheel, Drag, and Scroll Saving) ---
    // The mouse wheel now uses the same advanced applyZoom logic
    diagramContainer.addEventListener("wheel", (event) => {
        if (event.ctrlKey) {
            event.preventDefault();
            const newZoom = event.deltaY < 0 
                ? currentZoom + CONFIG.zoomStep 
                : currentZoom - CONFIG.zoomStep;
            applyZoom(newZoom);
        }
    }, { passive: false });

    // 保存滚动状态并持久化到 localStorage
    diagramContainer.addEventListener('scroll', () => {
        window.mermaidGraphState.scrollLeft = diagramContainer.scrollLeft;
        window.mermaidGraphState.scrollTop = diagramContainer.scrollTop;
        // 保存到 localStorage
        saveStateToLocalStorage();
    });

    // 辅助函数: 保存状态到 localStorage
    function saveStateToLocalStorage() {
        try {
            localStorage.setItem('mermaidGraphState', JSON.stringify(window.mermaidGraphState));
        } catch (e) {
            console.warn('[状态保存] 无法保存到 localStorage:', e);
        }
    }

    // Panning logic remains unchanged
    let isDragging = false, lastX, lastY;
    diagramContainer.addEventListener("mousedown", (event) => { /* ... */ });
    container.addEventListener("mousemove", (event) => { /* ... */ });
    const stopDragging = () => { /* ... */ };
    container.addEventListener("mouseup", stopDragging);
    container.addEventListener("mouseleave", stopDragging);

    // Final UI setup
    const helpText = zoomControls.createEl("span", { text: "(提示: Ctrl+滚轮缩放, Alt+拖拽移动)" });
    helpText.style.cssText = "font-size: 0.8em; color: #666; margin-left: 15px;";

    // Expose the visual update function for the main renderDiagram call
    return { updateZoomDisplay: updateZoomVisuals };
}




function showToast(message, type = "info") {
  // 移除可能存在的旧提示
  const existingToast = document.getElementById('mermaid-toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  // 创建提示元素
  const toast = document.createElement('div');
  toast.id = 'mermaid-toast';
  toast.textContent = message;
  
  // 样式设置
  toast.style.cssText = `
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    background-color: ${type === 'error' ? '#ff3366' : '#333'};
    color: white;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    z-index: 10000;
    font-size: 14px;
    opacity: 0;
    transition: opacity 0.3s ease;
  `;
  
  // 添加到DOM
  document.body.appendChild(toast);
  
  // 显示提示
  setTimeout(() => {
    toast.style.opacity = '1';
    
    // 3秒后淡出
    setTimeout(() => {
      toast.style.opacity = '0';
      
      // 完全淡出后移除
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3000);
  }, 10);
}











/**
 * [最终修正版] 在图表中查找并聚焦指定节点，包含完整的定位和高亮逻辑。
 * @param {string} nodeId - 要聚焦的节点的简化后 DOM ID (例如 'L2', 'M67')。
 * @param {HTMLElement} container - Mermaid 图所在的 .diagram-container 元素。
 */
/**
 * [最终修复版] 在图表中查找并聚焦指定节点
 * - 使用更健壮的多策略属性选择器来查找节点，以应对Mermaid库可能修改ID的情况。
 */
/**
 * [最终修复版] 在图表中查找并聚焦指定节点
 * - 核心修复：使用灵活的属性选择器 [id*="..."] 来查找被Mermaid修改过的节点ID。
 * - 实现了稳定、居中的滚动逻辑。
 * - 包含一个简洁但有效的高亮效果。
 */
/**
 * [终极内容查找版] 在图表中查找并聚焦指定节点
 * - 接收完整的节点对象。
 * - 优先尝试ID查找，如果失败，则遍历所有节点，通过匹配其显示的文本内容（长ID）来查找。
 * - 实现了稳定、居中的滚动和高亮。
 */
/**
 * [最终内容查找版] 在图表中查找并聚焦指定节点
 * - 接收完整的节点对象。
 * - 优先尝试ID查找，如果失败，则遍历所有节点，通过匹配其显示的文本内容（长ID）来查找。
 * - 实现了稳定、居中的滚动和高亮。
 */
/**
 * [终极智能滚动版] 在图表中查找并聚焦指定节点
 * - 核心修正：使用浏览器内置的 scrollIntoView() 方法，它会自动处理所有父级容器的滚动（包括Obsidian的主纵轴），确保节点可见并居中。
 * - 这解决了之前只在图表内部滚动，而主窗格不滚动的问题。
 */
function focusNodeInChart(nodeObject, container) {
    try {
        const simpleId = nodeObject.simpleId;
        const longId = nodeObject.id;
        console.log(`[focus] 尝试聚焦节点，简化ID: ${simpleId}, 长ID: ${longId}`);
        
        let nodeElement = null;
        let svgContainer = container.querySelector('.mermaid') || container.querySelector('svg.mermaid');

        if (!svgContainer) {
            showToast("错误: 在图表容器中找不到SVG元素", "error");
            return;
        }

        // 查找节点的逻辑保持不变，因为它已经很健壮了
        nodeElement = svgContainer.querySelector(`[id*="${simpleId}"]`);
        if (!nodeElement) {
            console.warn(`[focus] ID查找失败，启动内容查找策略...`);
            const allGraphNodes = svgContainer.querySelectorAll('.node, .cluster');
            for (const graphNode of allGraphNodes) {
                if ((graphNode.textContent || "").includes(longId)) {
                    nodeElement = graphNode;
                    break;
                }
            }
        }
        
        if (!nodeElement) {
            console.error(`[focus] 所有查找策略均失败，无法在DOM中定位节点 ${simpleId}`);
            showToast(`无法在图表中定位节点: ${simpleId}`, "error");
            return;
        }
        console.log('[focus] 成功找到DOM节点:', nodeElement);

        // <<--- 核心修正：使用 scrollIntoView() 代替所有手动计算 ---
        console.log('[focus] 使用 scrollIntoView() 进行智能滚动，以移动主纵轴...');
        nodeElement.scrollIntoView({
            behavior: 'smooth', // 平滑滚动
            block: 'center',    // 垂直方向上居中
            inline: 'center'    // 水平方向上居中
        });
        // --- 修正结束 ---

        // --- 高亮效果保持不变 ---
        const shape = nodeElement.querySelector('rect, circle, polygon, ellipse, path');
        if (shape) {
            const originalStroke = shape.style.stroke;
            const originalStrokeWidth = shape.style.strokeWidth;
            
            shape.style.transition = 'all 0.3s ease-in-out';
            shape.style.stroke = '#F37021'; // 醒目的橙色
            shape.style.strokeWidth = '4px';
            
            setTimeout(() => {
                shape.style.stroke = originalStroke;
                shape.style.strokeWidth = originalStrokeWidth;
            }, 3000);
        }
        
    } catch (error) {
        console.error('聚焦节点时出错:', error);
    }
}







/**
 * 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 */
/**
 * [已修正] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 */
/**
 * [最终修正版] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 */
/**
 * [最终修正版] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 * - 修正了ID提取逻辑，改用更可靠的 data-path 属性。
 * - 增强了日志输出，方便追踪。
 */
/**
 * [最终决定版] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 *  - 修正了ID提取逻辑，确保从 data-path 中获取完整的长ID。
 *  - 实现了正确的“翻译”步骤，使用全局译码本将长ID转换为简化ID。
 *  - 增加了详细的日志，便于追踪每一步的执行情况。
 */
/**
 * [最终修正版] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 * - 修正了容器和行项目的选择器逻辑，使其更加健壮。
 * - 增强了日志输出，方便追踪。
 * - 确保从 data-path 属性中可靠地提取ID。
 */
/**
 * [最终调试版] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 * - 增加了极其详细的日志，用于追踪ID提取和翻译的全过程。
 */
/**
 * [已修正] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 */
/**
 * [已修正] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 */
/**
 * [最终修正版] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 * - 修正了ID提取逻辑，改用更可靠的 data-path 属性。
 * - 增强了日志输出，方便追踪。
 */
/**
 * [最终优化版] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 * - 基于您的可用版本进行修改。
 * - 引入了更可靠的“窗格”和“行项目”定位逻辑。
 * - 保留并增强了您版本中已有的日志和高亮功能。
 */
/**
 * [终极调试版] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 * - 在每一个关键步骤都添加了详细的日志输出。
 */
/**
 * [终极表格版] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 * - 核心逻辑已修改为专门查找表格行 <tr>，不再使用 data-path。
 * - ID 提取逻辑同步修改为从行内的链接 <a> 文本中获取。
 * - 保留了所有详细的调试日志。
 */
/**
 * [最终智能版] 查找右侧列表的中心节点，并在 Mermaid 视图中居中显示。
 * - 无需修改笔记，无需添加 cssclasses。
 * - 智能地查找另一个“可见的”窗格作为列表目标，避免选中隐藏的标签页。
 */
/**
 * [最终精确制导版] 查找指定笔记视图的中心节点，并在 Mermaid 视图中居中。
 * - 通过硬编码的文件路径直接定位列表窗格，不再进行任何自动检测。
 * - 这是最稳定、最可靠的实现方式。
 */
/**
 * [最终精确制导版] 查找指定笔记视图的中心节点，并在 Mermaid 视图中居中。
 * - 通过硬编码的文件路径直接定位列表窗格。
 * - 查找逻辑基于 <tr>，并从 <a> 标签中提取ID。
 * - 调用聚焦函数时传递完整的节点对象，以支持内容查找。
 */
/**
 * [最终智能关联版] 查找并聚焦节点
 * - 核心修正：在通过文件路径找到列表窗格后，再去寻找一个“可见的、非列表的”图表窗格，确保两者正确配对。
 */
function findCenterNoteAndFocus() {
    console.log('[调试] findCenterNoteAndFocus 函数被调用');
    try {
        // ==================== 配置区 ====================
        // 请确保这个路径与您的列表笔记在保险库中的完整路径完全一致！
        const TARGET_LIST_FILE_PATH = '项目/18-战略视图迭代/18E-GTD夹子/18E1-下一步代办事项清单文件夹/下一步代办的liner chain/ATOM视图啦.md';
        // ==============================================

        // --- 精准定位列表窗格 ---
        let listLeaf = null;
        app.workspace.getLeavesOfType('markdown').forEach(leaf => {
            if (leaf.view.file && leaf.view.file.path === TARGET_LIST_FILE_PATH) {
                listLeaf = leaf;
            }
        });

        if (!listLeaf) {
            showToast("错误: 目标列表笔记未打开或路径不匹配", "error");
            console.error(`[调试失败] 未能找到正在显示 "${TARGET_LIST_FILE_PATH}" 的窗格。`);
            return;
        }
        console.log('[调试成功] 1. 精准定位了列表窗格。');

        // --- 核心修正：智能查找与列表配对的“可见”图表窗格 ---
        let diagramContainer = null;
        const allLeaves = Array.from(document.querySelectorAll('.workspace-leaf'));
        for (const leaf of allLeaves) {
            const container = leaf.querySelector('.diagram-container');
            const isVisible = leaf.offsetParent !== null;
            // 关键：检查 leaf.containerEl 是否与我们找到的列表窗格的容器元素相同
            const isNotListLeaf = leaf !== listLeaf.containerEl;

            if (container && isVisible && isNotListLeaf) {
                diagramContainer = container;
                break; 
            }
        }

        if (!diagramContainer) {
            showToast("错误: 未能找到一个可见的图表窗格与列表配对", "error");
            console.error('[调试失败] A. 请确保图表和列表在不同的、且都可见的窗格中。');
            return;
        }
        console.log('[调试成功] A. 智能关联到了可见的图表容器。');
        
        // --- 后续所有逻辑现在都在100%正确的容器内执行 ---
        const listContainer = listLeaf.containerEl.querySelector('.view-content') || listLeaf.containerEl;
        const allRows = Array.from(listContainer.querySelectorAll('tr'));
        
        if (allRows.length === 0) {
            showToast("错误: 在列表窗格中未找到任何表格行(tr)", "error");
            return;
        }
        console.log(`[调试成功] 2. 在目标窗格中找到了 ${allRows.length} 个 <tr> 元素。`);
        
        const containerRect = listContainer.getBoundingClientRect();
        const containerCenter = containerRect.top + containerRect.height / 2;
        let closestRow = null; 
        let minDistance = Infinity;
        for (const row of allRows) {
            const rowRect = row.getBoundingClientRect();
            if (rowRect.height === 0) continue;
            const rowCenter = rowRect.top + rowRect.height / 2;
            const distance = Math.abs(rowCenter - containerCenter);
            if (distance < minDistance) { 
                minDistance = distance; 
                closestRow = row; 
            }
        }

        if (!closestRow) {
            showToast("错误: 无法确定列表中的中心行", "error");
            return;
        }
        console.log('[调试成功] 3. 找到了中心行。');

        let fullNodeId = null;
        const linkElement = closestRow.querySelector('a');
        if (linkElement) {
            const idMatch = (linkElement.textContent || "").match(/ATOM@[A-Z0-9\.\+]+/);
            if (idMatch) {
                fullNodeId = idMatch[0];
            }
        }

        if (!fullNodeId) {
            showToast("错误: 无法从中心行的链接中提取ID", "error");
            return;
        }
        console.log("[调试成功] 4. 提取的长ID是:", fullNodeId);

        let nodeToFocus = null;
        for (const nodeObject of Object.values(window.stateTransitionNodeIdMap)) {
            if (nodeObject.id === fullNodeId) { 
                nodeToFocus = nodeObject; 
                break; 
            }
        }

        if (!nodeToFocus) {
            showToast(`错误: 在映射表中找不到节点对象: ${fullNodeId}`, "error");
            return;
        }
        console.log("[调试成功] 5. 找到了完整的节点对象。");

        showToast(`正在聚焦: ${nodeToFocus.simpleId}`);
        focusNodeInChart(nodeToFocus, diagramContainer);

    } catch (error) {
        console.error("[findCenterNoteAndFocus] 捕获到未知错误:", error);
        showToast(`发生致命错误，请检查控制台。`);
    }
}















/**
 * 设置全局键盘快捷键。
 */
/**
 * 设置全局键盘快捷键（快捷键已改为 'V'）
 */
function setupGlobalKeyboardShortcuts() {
  // 防止重复添加监听器
  if (window.globalMermaidKeyListenerAdded) {
    return;
  }

  const handleKeyDown = (event) => {
    // 当按下 'v' 或 'V' 键时触发
    if (event.key.toLowerCase() === 'v') {
      // 确保事件不是在输入框、文本域或可编辑元素中触发的
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) {
        return;
      }
      
      // 阻止默认行为（例如在页面上输入'v'）
      event.preventDefault();
      
      // 调用核心的聚焦函数
      findCenterNoteAndFocus();
    }
  };

  // 将监听器绑定到 document 上
  document.addEventListener('keydown', handleKeyDown);
  
  // 设置一个全局标志，表示快捷键已成功设置
  window.globalMermaidKeyListenerAdded = true;
  
  console.log("全局快捷键 'V' 已成功激活。");
}











// 渲染图表
async function renderDiagram(container, statusDiv, diagramContainer, codeContainer, zoomControls) {
  statusDiv.textContent = "正在加载文件...";

  // --- 新增: 在渲染前保存当前状态 ---
  const savedState = {
    zoom: window.mermaidGraphState?.zoom || CONFIG.initialZoom,
    scrollLeft: diagramContainer.scrollLeft || 0,
    scrollTop: diagramContainer.scrollTop || 0
  };

  try {
    // 假设 getFiles() 已经被修改，会返回包含 isFolded 属性的对象
    const files = getFiles();
    if (files.length === 0) {
      statusDiv.textContent = "未找到符合条件的文件";
      return;
    }
    // 注意：已将中文逗号修正为英文逗号
    statusDiv.textContent = `找到 ${files.length} 个文件, 正在分析...`;
    
    // --- Graph Building (已修改以包含 isFolded 属性) ---
    const nodes = files.map(file => {
      const fileInfo = parseFileInfo(file.file.name);
      return {
        id: fileInfo.id,
        name: fileInfo.name,
        hasStateTransition: fileInfo.hasStateTransition,
        baseState: fileInfo.baseState,
        fileName: file.file.name,
        path: file.file.path,
        mermaidViewComplete: file.mermaidViewComplete,
        mermaidViewBayes: file.mermaidViewBayes,
        mermaidViewStandard: file.mermaidViewStandard,
        mermaidViewPending: file.mermaidViewPending,
        mermaidViewAI: file.mermaidViewAI,
        mermaidViewHighlight: file.mermaidViewHighlight,
        // --- 新增属性 ---
        isFolded: file.isFolded 
      };
    });

    nodes.forEach(node => {
      node.parentId = getParentId(node.id);
    });

    const targetNode = nodes.find(node => node.id === CONFIG.targetNode);
    if (!targetNode) {
      statusDiv.textContent = `错误: 找不到节点 "${CONFIG.targetNode}"`;
      diagramContainer.innerHTML = `<div style="color:red;padding:10px;">目标节点未找到，请检查节点ID是否正确</div>`;
      return;
    }

    statusDiv.textContent = "正在构建状态转移关系图...";
    const graph = buildStateTransitionGraph(targetNode, nodes, CONFIG.maxDepth);

    // --- 新增: 创建折叠前缀列表 ---
    const foldedPrefixes = nodes
        .filter(n => n.isFolded)
        .map(n => getPureId(n.id)); // 假设 getPureId() 在此作用域可用

    // --- Click Handler (已修改为直接打开笔记) ---
    const handleNodeClick = function(nodeId) {
      if (window.stateTransitionNodeIdMap && window.stateTransitionNodeIdMap[nodeId]) {
        const node = window.stateTransitionNodeIdMap[nodeId];
        if (node.path) {
          console.log(`点击了节点: ${nodeId} -> 打开文件: ${node.path}`);
          // 使用 Obsidian API 直接打开笔记
          app.workspace.openLinkText(node.path, '', false);
          showToast(`正在打开: ${node.name || node.fileName}`, "info");
        } else if (node.fileName) {
          console.log(`点击了节点: ${nodeId} -> 文件名: ${node.fileName}`);
          // 如果没有 path 但有 fileName,尝试通过文件名打开
          app.workspace.openLinkText(node.fileName, '', false);
          showToast(`正在打开: ${node.fileName}`, "info");
        } else {
          showToast(`节点 ${node.name || nodeId} 没有关联的文件`, "info");
        }
      } else {
        showToast(`未找到节点 ${nodeId} 的相关信息`, "error");
        console.warn(`未找到节点 ${nodeId} 的映射信息`);
      }
    };

    // --- Mermaid Code Generation and Rendering (已修改以传入 foldedPrefixes) ---
    statusDiv.textContent = "正在生成图表...";
    // 将 foldedPrefixes 传递给 generateMermaidCode
    const mermaidCode = generateMermaidCode(graph, handleNodeClick, foldedPrefixes); 
    codeContainer.textContent = mermaidCode;
    diagramContainer.innerHTML = `<div class="mermaid">${mermaidCode}</div>`;

    if (window.mermaid) {
      // 您的原始 Mermaid 初始化代码, 非常完美
      window.mermaid.initialize({
        startOnLoad: false,
        theme: "default",
        securityLevel: "loose",
        flowchart: {
          useMaxWidth: true,
          htmlLabels: true,
          curve: "basis"
        }
      });
      
      // 渲染调用保持不变
      await window.mermaid.init(undefined, diagramContainer.querySelector(".mermaid"));
      
      // 渲染后更新状态文本
      statusDiv.textContent = `图表已生成，显示 ${graph.nodes.length} 个节点, ${graph.subgraphs.length} 个子图（可点击节点导航到对应笔记）`;

      // **增强版: 恢复视图状态**
      setTimeout(() => {
          // 1. 确保全局状态对象存在
          if (!window.mermaidGraphState) {
              window.mermaidGraphState = savedState;
          }

          // 2. 恢复缩放: 使用保存的缩放级别
          if (CONFIG.enableZoom && zoomControls) {
              // 更新内部缩放变量（在setupZoomControls作用域内）
              const svgElement = diagramContainer.querySelector("svg");
              if (svgElement) {
                  svgElement.style.transformOrigin = "top left";
                  svgElement.style.transform = `scale(${savedState.zoom})`;
              }
              zoomControls.updateZoomDisplay();
          }

          // 3. 恢复滚动位置: 应用保存的值
          diagramContainer.scrollLeft = savedState.scrollLeft;
          diagramContainer.scrollTop = savedState.scrollTop;

          // 4. 更新全局状态为当前值
          window.mermaidGraphState.zoom = savedState.zoom;
          window.mermaidGraphState.scrollLeft = savedState.scrollLeft;
          window.mermaidGraphState.scrollTop = savedState.scrollTop;

          console.log('[状态恢复] 已恢复视图状态:', savedState);
      }, 150); // 稍微增加延迟以确保SVG完全渲染

    } else {
      statusDiv.textContent = "错误: Mermaid库未加载";
    }
  } catch (error) {
    statusDiv.textContent = `错误: ${error.message}`;
    if (CONFIG.debug) {
      diagramContainer.innerHTML += `<pre style="color:red;padding:10px;overflow:auto">${error.stack}</pre>`;
    }
  }
}




// ===== 主程序入口 =====
// 创建UI并渲染初始图表
const ui = createUI(dv.container);
renderDiagram(dv.container, ui.statusDiv, ui.diagramContainer, ui.codeContainer, ui.zoomControls);
setupGlobalKeyboardShortcuts();

// --- 新增: 监听标签页切换，恢复视图状态 ---
// 当当前笔记被激活时，恢复 Mermaid 图的视图状态
const refreshOnLeafActive = () => {
    // 检查当前激活的 leaf 是否包含我们的图表容器
    const activeLeaf = app.workspace.activeLeaf;
    if (activeLeaf && ui.diagramContainer) {
        // 延迟执行以确保 DOM 已更新
        setTimeout(() => {
            const storedState = localStorage.getItem('mermaidGraphState');
            if (storedState && ui.diagramContainer) {
                try {
                    const state = JSON.parse(storedState);
                    console.log('[标签页切换] 检测到切换，恢复状态:', state);

                    // 恢复滚动位置
                    ui.diagramContainer.scrollLeft = state.scrollLeft || 0;
                    ui.diagramContainer.scrollTop = state.scrollTop || 0;

                    // 恢复缩放
                    const svgElement = ui.diagramContainer.querySelector("svg");
                    if (svgElement && ui.zoomControls) {
                        svgElement.style.transformOrigin = "top left";
                        svgElement.style.transform = `scale(${state.zoom || CONFIG.initialZoom})`;
                        ui.zoomControls.updateZoomDisplay();
                    }

                    // 更新全局状态
                    if (window.mermaidGraphState) {
                        window.mermaidGraphState.zoom = state.zoom;
                        window.mermaidGraphState.scrollLeft = state.scrollLeft;
                        window.mermaidGraphState.scrollTop = state.scrollTop;
                    }
                } catch (e) {
                    console.warn('[标签页切换] 恢复状态失败:', e);
                }
            }
        }, 200);
    }
};

// 注册工作区事件监听器
if (app.workspace) {
    app.workspace.on('active-leaf-change', refreshOnLeafActive);
    console.log('[状态恢复] 已注册 active-leaf-change 事件监听器');
}
```



