<%*
// 配置：日记目录与引用目标标题
const DAILY_NOTE_FOLDER = "项目/35-给日程安排的文件夹/35C-日记的文件夹";
const QUOTE_HEADING = "# 想要引用的文件们";

// 1. 当前文件的 Wiki 链接格式
const currentNoteLink = `[[${tp.file.title}]]`;

// 2. 今日日记路径
const today = tp.date.now("YYYY-MM-DD");
const dailyNotePath = `${DAILY_NOTE_FOLDER}/${today}.md`;

// 3. 获取/新建当日日记文件
let file = app.vault.getAbstractFileByPath(dailyNotePath);
if (!file) {
  // 若不存在，直接生成新日记并插入目标一级标题和链接
  const content = `# 每天延续的内容\n\n[[时间统计与评估的视图]]\n\n# 今天的记录\n\n\n${QUOTE_HEADING}\n${currentNoteLink}\n`;
  await app.vault.create(dailyNotePath, content);
  new Notice("已新建今日日记并添加引用！");
  return;
}

// 4. 已存在则读取内容，并查找/追加引用
let content = await app.vault.read(file);
let lines = content.split('\n');
let headingIndex = lines.findIndex(
  line => line.trim() === QUOTE_HEADING.trim()
);

if (headingIndex !== -1) {
  // 找到目标标题，从该标题下到下一个一级标题前，插入到结尾
  let insertPos = headingIndex + 1;
  // 查是否已存在同名链接，避免重复
  const nextHeadingIndex = lines
    .slice(insertPos)
    .findIndex(line => line.trim().startsWith('#'));
  // 只在区域内加
  let blockEnd = nextHeadingIndex === -1
    ? lines.length
    : headingIndex + 1 + nextHeadingIndex;
  // 不重复就插入
  if (!lines.slice(insertPos, blockEnd).includes(currentNoteLink)) {
    lines.splice(blockEnd, 0, currentNoteLink);
    await app.vault.modify(file, lines.join('\n'));
    new Notice("文件链接已添加到『想要引用的文件们』末尾！");
  } else {
    new Notice("该文件链接已存在，不重复添加~");
  }
} else {
  // 没有该一级标题，在文末追加标题和链接
  content = content.trim() + `\n\n${QUOTE_HEADING}\n${currentNoteLink}\n`;
  await app.vault.modify(file, content);
  new Notice("已新建『想要引用的文件们』并添加链接！");
}
%>