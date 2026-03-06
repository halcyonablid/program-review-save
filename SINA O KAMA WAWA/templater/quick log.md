<%*
// 只改目标目录即可，其余照搬
const DAILY_NOTE_FOLDER = "项目/35-给日程安排的文件夹/35C-日记的文件夹";
const TARGET_HEADING = "# 今天的记录";
const userInput = await tp.system.prompt("请输入今天的记录内容（单行）");

if (!userInput || userInput.trim() === "") {
  new Notice("未输入内容，操作已取消");
  return;
}

const timestamp = tp.date.now("HH:mm");
const contentToAppend = `- ${timestamp} ${userInput.trim()}`;
const today = tp.date.now("YYYY-MM-DD");
const dailyNotePath = `${DAILY_NOTE_FOLDER}/${today}.md`;

let file = app.vault.getAbstractFileByPath(dailyNotePath);

if (!file) {
  new Notice(`新建日记: ${today}.md`);
  const fileContent = `# ${today}\n\n${TARGET_HEADING}\n${contentToAppend}\n`;
  await app.vault.create(dailyNotePath, fileContent);
  new Notice("记录已成功保存！");
  return;
}

let fileContent = await app.vault.read(file);
const lines = fileContent.split('\n');
let headingIndex = lines.findIndex(line => line.trim() === TARGET_HEADING.trim());

if (headingIndex !== -1) {
  // 找到目标标题后，从该标题下方收集到下一个标题或文件末尾全部内容
  let insertPos = headingIndex + 1;
  // 查找下一个标题的位置
  let nextHeadingIndex = lines.slice(insertPos).findIndex(line => line.trim().startsWith("#") && line.trim() !== TARGET_HEADING.trim());
  if (nextHeadingIndex !== -1) {
    // 有下一个标题，插入到前面
    insertPos = headingIndex + 1 + nextHeadingIndex;
  } else {
    // 没有下一个标题，插入到文末
    insertPos = lines.length;
  }
  lines.splice(insertPos, 0, contentToAppend);
  const newContent = lines.join('\n');
  await app.vault.modify(file, newContent);
  new Notice("记录已成功追加！");
} else {
  // 找不到目标标题则直接在文末追加
  const newContent = `${fileContent.trim()}\n\n${TARGET_HEADING}\n${contentToAppend}\n`;
  await app.vault.modify(file, newContent);
  new Notice("记录已成功追加！");
}
%>