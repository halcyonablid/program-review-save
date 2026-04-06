const { ItemView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } = require("obsidian");

const VIEW_TYPE_WORKSPACE_MOUNT = "workspace-mount-view";
const ROOT_KEY = "__root__";
const DEFAULT_TAB_ID = "tab_default";
const UNCATEGORIZED_PARADIGM_GROUP_ID = "__uncategorized__";
const DEFAULT_PARADIGM_TAG_COLOR = "#3498db";
const PARADIGM_TAG_COLOR_PALETTE = [
  "#3498db",
  "#1abc9c",
  "#f39c12",
  "#9b59b6",
  "#e74c3c",
  "#16a085",
  "#d35400",
  "#2ecc71",
  "#34495e",
  "#7f8c8d",
];
const PARADIGM_TRANSFER_LOG_TITLE = "📥 共通范式迁入记录";
const EVA_NOTES_CANDIDATE_PATHS = [
  "EVA_Notes.json",
  "data/EVA_Notes.json",
];
const WORKSPACE_SCHEMA_VERSION = "2.6";
const WORKSPACE_CAPSULE_BRIDGE_VERSION = 1;
const WORKSPACE_SCRIPT_VERSION = "plugin-vertical-slice.1";
const JSON_FILENAME = "Workspace_Items.json";
const TASK_NOTE_BINDINGS_FILENAME = "Workspace_TaskNoteBindings.json";
const TASK_COMMENTS_FILENAME = "Workspace_TaskComments.json";
const TASK_NOTE_BINDINGS_SCHEMA_VERSION = 1;
const TASK_COMMENTS_SCHEMA_VERSION = 1;
const ATTACHMENTS_FOLDER = "attachments";
const DEFAULT_SETTINGS = {
  defaultSourceNotePath: "④workspace挂载.md",
};

function nowString() {
  return new Date().toISOString();
}

function sanitizeText(value, fallback = "") {
  const text = String(value == null ? "" : value).trim();
  return text || fallback;
}

function isObjectLike(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepClone(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return fallback;
  }
}

function parentKey(parentId) {
  const value = sanitizeText(parentId, "");
  return value || ROOT_KEY;
}

function tabParentKey(tabId, parentId) {
  const ownerId = sanitizeText(tabId, DEFAULT_TAB_ID) || DEFAULT_TAB_ID;
  return `${ownerId}::${parentKey(parentId)}`;
}

function paradigmParentKey(paradigmId, parentId) {
  return `${sanitizeText(paradigmId, "")}::${parentKey(parentId)}`;
}

function paradigmTreeKey(parentParadigmId) {
  return parentKey(parentParadigmId);
}

function paradigmCategoryTreeKey(parentCategoryId) {
  return parentKey(parentCategoryId);
}

function paradigmCopyTreeKey(hostParadigmId) {
  return parentKey(hostParadigmId);
}

function makeParadigmMountMapKey(tabId, mountScopeId, paradigmItemId) {
  return `${sanitizeText(tabId, "")}::${sanitizeText(mountScopeId, "")}@@${sanitizeText(paradigmItemId, "")}`;
}

function parseParadigmMountMapKey(rawKey) {
  const raw = sanitizeText(rawKey, "");
  const parsed = splitScopedKey(raw);
  const suffix = sanitizeText(parsed.parent, "");
  const sep = suffix.indexOf("@@");
  if (sep < 0) {
    return { tabId: parsed.ownerId, mountScopeId: "", paradigmItemId: suffix };
  }
  return {
    tabId: parsed.ownerId,
    mountScopeId: sanitizeText(suffix.slice(0, sep), ""),
    paradigmItemId: sanitizeText(suffix.slice(sep + 2), ""),
  };
}

function ensureUniqueIds(listLike) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(listLike) ? listLike : []) {
    const id = sanitizeText(raw, "");
    if (!id || seen.has(id)) continue;
    out.push(id);
    seen.add(id);
  }
  return out;
}

function removeIdFromSimpleChildrenMap(childrenMap, id) {
  Object.keys(childrenMap || {}).forEach((key) => {
    const list = Array.isArray(childrenMap[key]) ? childrenMap[key] : [];
    childrenMap[key] = list.filter((x) => x !== id);
  });
}

function buildTransferMarkerLine(meta) {
  const sourceTabId = sanitizeText(meta?.sourceTabId, "");
  const sourceItemId = sanitizeText(meta?.sourceItemId, "");
  const sourceParadigmId = sanitizeText(meta?.sourceParadigmId, "");
  return `[workspace-transfer] sourceTabId=${sourceTabId};sourceItemId=${sourceItemId};sourceParadigmId=${sourceParadigmId};`;
}

function parseTransferMarkerLine(text) {
  const raw = String(text || "");
  const match = raw.match(/\[workspace-transfer\]\s*sourceTabId=([^;\n]+);sourceItemId=([^;\n]+);sourceParadigmId=([^;\n]+);/);
  if (!match) return null;
  return {
    sourceTabId: sanitizeText(match[1], ""),
    sourceItemId: sanitizeText(match[2], ""),
    sourceParadigmId: sanitizeText(match[3], ""),
  };
}

function normalizeTransferredCommentLayout(text) {
  const raw = String(text || "").trim();
  if (!raw || !parseTransferMarkerLine(raw)) return raw;
  const lines = raw.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => /\[workspace-transfer\]/.test(line));
  if (markerIndex < 0) return raw;
  const transferStart = Math.max(0, markerIndex - 3);
  const transferBlock = lines.slice(transferStart, markerIndex + 1).join("\n").trim();
  const remaining = lines.slice(0, transferStart).concat(lines.slice(markerIndex + 1)).join("\n").trim();
  return remaining ? `${remaining}\n\n${transferBlock}` : transferBlock;
}

function composeTransferredItemComment(meta, originalComment = "") {
  const sourceTabName = sanitizeText(meta?.sourceTabName, sanitizeText(meta?.sourceTabId, ""));
  const sourceParadigmName = sanitizeText(meta?.sourceParadigmName, sanitizeText(meta?.sourceParadigmId, ""));
  const sourceItemTitle = sanitizeText(meta?.sourceItemTitle, sanitizeText(meta?.sourceItemId, ""));
  const sourceItemId = sanitizeText(meta?.sourceItemId, "");
  const transferBlock = [
    `转自 Tab：${sourceTabName}${meta?.sourceTabId ? ` (${meta.sourceTabId})` : ""}`,
    `来源范式：${sourceParadigmName}`,
    `来源条目：${sourceItemTitle}${sourceItemId ? ` (${sourceItemId})` : ""}`,
    buildTransferMarkerLine(meta),
  ].join("\n");
  const cleanOriginal = normalizeTransferredCommentLayout(originalComment);
  return cleanOriginal ? `${cleanOriginal}\n\n${transferBlock}` : transferBlock;
}

function createId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeTabEmoji(value) {
  return sanitizeText(value, "").slice(0, 8);
}

function normalizeTabAccentColor(value) {
  const raw = sanitizeText(value, "");
  if (!raw) return "";
  const prefixed = raw.startsWith("#") ? raw : `#${raw}`;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(prefixed)) return prefixed.toLowerCase();
  return "";
}

function getReadableTextColor(hexColor) {
  const normalized = normalizeTabAccentColor(hexColor);
  if (!normalized) return "var(--text-on-accent)";
  const full = normalized.length === 4
    ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
    : normalized;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
  return luminance >= 150 ? "#1f2328" : "#ffffff";
}

function getDefaultParadigmTagColor(seed = "") {
  const text = sanitizeText(seed, "") || "paradigm-tag";
  const hash = hashString(text);
  return PARADIGM_TAG_COLOR_PALETTE[Math.abs(hash) % PARADIGM_TAG_COLOR_PALETTE.length] || DEFAULT_PARADIGM_TAG_COLOR;
}

function hashString(value) {
  const text = sanitizeText(value, "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildParadigmPalette(seed) {
  const hue = hashString(seed) % 360;
  return {
    accent: `hsl(${hue} 58% 42%)`,
    border: `hsla(${hue}, 58%, 42%, 0.34)`,
    bg: `hsla(${hue}, 72%, 52%, 0.08)`,
    bgStrong: `hsla(${hue}, 72%, 52%, 0.14)`,
    chipBg: `hsla(${hue}, 78%, 50%, 0.12)`,
    chipBorder: `hsla(${hue}, 58%, 42%, 0.22)`,
  };
}

function getBindingLabel(noteBinding) {
  if (!noteBinding) return "";
  if (typeof noteBinding === "string") return sanitizeText(noteBinding, "");
  if (typeof noteBinding === "object") {
    const path = sanitizeText(noteBinding.path, "");
    if (path) return path.split("/").pop() || path;
  }
  return "";
}

function getCommentSummary(commentText) {
  const text = sanitizeText(commentText, "");
  if (!text) return "";
  return text.length > 48 ? `${text.slice(0, 48)}...` : text;
}

function getLevelBackground(level) {
  const palette = [
    "rgba(52, 152, 219, 0.06)",
    "rgba(46, 204, 113, 0.08)",
    "rgba(241, 196, 15, 0.09)",
    "rgba(230, 126, 34, 0.09)",
    "rgba(231, 76, 60, 0.08)",
    "rgba(155, 89, 182, 0.08)",
    "rgba(26, 188, 156, 0.08)",
    "rgba(52, 73, 94, 0.08)",
    "rgba(127, 140, 141, 0.08)",
    "rgba(243, 156, 18, 0.08)",
    "rgba(233, 30, 99, 0.07)",
    "rgba(63, 81, 181, 0.07)",
  ];
  if (!Number.isFinite(level) || level < 0) return palette[0];
  return palette[level % palette.length];
}

function normalizeImageRef(imageRef) {
  const raw = sanitizeText(imageRef, "");
  if (!raw) return "";
  const withoutBang = raw.replace(/^!\[\[/, "[[").trim();
  const wikiMatch = withoutBang.match(/^\[\[(.+?)\]\]$/);
  if (wikiMatch) return sanitizeText(wikiMatch[1], "");
  return raw;
}

function isExternalImageRef(value) {
  return /^(https?:\/\/|data:image\/|file:\/\/|app:\/\/)/i.test(String(value || "").trim());
}

function sanitizeShortcutTargetInput(raw) {
  let text = String(raw || "").trim();
  if (!text) return "";
  const markdownLinkMatch = text.match(/^!?\[[^\]]*]\((.*?)\)$/);
  if (markdownLinkMatch && markdownLinkMatch[1]) text = markdownLinkMatch[1].trim();
  if (/^!?\[\[.*\]\]$/.test(text)) text = text.replace(/^!?\[\[/, "").replace(/\]\]$/, "").trim();
  if (text.startsWith("<") && text.endsWith(">")) text = text.slice(1, -1).trim();
  const cleaned = text.split("|")[0].split("#")[0].trim();
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/(?!\/)|https?:\/\/|file:\/\/|obsidian:\/\/)/i.test(cleaned)) return cleaned;
  return cleaned.replace(/^\/+/, "");
}

function normalizeShortcutLabel(value) {
  return String(value || "").trim();
}

function normalizeShortcutEntries(entriesLike) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(entriesLike) ? entriesLike : []) {
    const entry = raw && typeof raw === "object" ? raw : {};
    const path = sanitizeShortcutTargetInput(entry.path || entry.targetPath || entry.filePath || entry.file_path || entry.href || "");
    if (!path) continue;
    const pathKey = path.toLowerCase();
    if (seen.has(pathKey)) continue;
    seen.add(pathKey);
    out.push({
      id: String(entry.id || `shortcut_${createId("sc")}`).trim() || `shortcut_${createId("sc")}`,
      path,
      label: normalizeShortcutLabel(entry.label || entry.name || ""),
      ctime: Number.isFinite(entry.ctime) ? Number(entry.ctime) : null,
      createdAt: entry.createdAt || nowString(),
      updatedAt: entry.updatedAt || nowString(),
    });
  }
  return out;
}

class WorkspaceTextInputModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options;
    this.result = null;
    this.didExplicitCancel = false;
    this.textareaEl = null;
    this.waiter = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  onOpen() {
    const { contentEl } = this;
    const {
      title = "输入内容",
      description = "",
      value = "",
      placeholder = "",
      confirmText = "保存",
      allowEmpty = false,
    } = this.options;
    this.result = null;
    this.didExplicitCancel = false;
    this.textareaEl = null;
    this.result = null;
    this.didExplicitCancel = false;
    this.textareaEl = null;
    contentEl.empty();
    contentEl.createEl("h3", { text: title });
    if (description) contentEl.createEl("div", { text: description, cls: "workspace-modal-desc" });
    const input = contentEl.createEl("input", {
      type: "text",
      cls: "workspace-modal-input",
      attr: { placeholder },
    });
    input.value = value;
    const actions = contentEl.createDiv({ cls: "workspace-modal-actions" });
    const cancelBtn = actions.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => {
      this.didExplicitCancel = true;
      this.close();
    };
    const confirmBtn = actions.createEl("button", { text: confirmText, cls: "mod-cta" });
    const submit = () => {
      const nextValue = String(input.value || "");
      if (!allowEmpty && !sanitizeText(nextValue, "")) return;
      this.result = nextValue;
      this.close();
    };
    confirmBtn.onclick = submit;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  onClose() {
    this.contentEl.empty();
    this._resolve(this.result);
  }

  waitForResult() {
    this.open();
    return this.waiter;
  }
}

class WorkspaceImageEditorModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options;
    this.result = null;
    this.didExplicitCancel = false;
    this.textareaEl = null;
    this.waiter = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  onOpen() {
    const { contentEl } = this;
    const {
      title = "图片设置",
      value = "",
      shortcutEntries = [],
      resolvePreview = () => ({ url: "", file: null }),
      openImagePreview = () => {},
      savePastedImage = async () => null,
      resolveShortcutEntryFromRawInput = () => null,
      resolveShortcutEntryFromDrop = () => null,
      getShortcutDisplayLabel = () => "未命名快捷方式",
      getShortcutPreviewMeta = async () => ({ title: "", subtitle: "", detail: "" }),
      openShortcutPreview = async () => {},
    } = this.options;
    this.shortcutEntries = normalizeShortcutEntries(shortcutEntries);
    contentEl.empty();
    this.modalEl.style.maxWidth = "760px";
    this.modalEl.style.width = "86vw";
    contentEl.createEl("h3", { text: title });
    contentEl.createEl("div", {
      text: "你可以手动填图片引用，或直接在下方区域 Ctrl/Cmd+V 粘贴剪贴板图片。",
      cls: "workspace-modal-desc",
    });
    const input = contentEl.createEl("input", {
      type: "text",
      cls: "workspace-modal-input",
      attr: { placeholder: "支持 ![[附件]] / [[附件]] / 图片 URL" },
    });
    input.value = value || "";
    const previewBox = contentEl.createDiv({ cls: "workspace-image-preview" });
    const previewTitle = previewBox.createEl("div", {
      text: "当前图片预览",
      cls: "workspace-modal-desc",
    });
    const previewWrap = previewBox.createDiv({ cls: "workspace-image-preview-stage" });
    const previewActions = previewBox.createDiv({ cls: "workspace-modal-actions" });
    const previewBtn = previewActions.createEl("button", { text: "查看大图" });
    const renderPreview = () => {
      previewWrap.empty();
      const imageRef = sanitizeText(input.value, "");
      if (!imageRef) {
        previewTitle.textContent = "当前图片预览";
        previewWrap.createDiv({ text: "暂无图片引用", cls: "workspace-empty" });
        previewBtn.disabled = true;
        return;
      }
      const preview = resolvePreview(imageRef);
      if (!preview?.url) {
        previewTitle.textContent = "当前图片预览（未解析）";
        previewWrap.createDiv({ text: "当前引用未解析成可预览图片", cls: "workspace-empty" });
        previewBtn.disabled = true;
        return;
      }
      previewTitle.textContent = "当前图片预览";
      previewBtn.disabled = false;
      previewBtn.onclick = () => openImagePreview(imageRef);
      const img = previewWrap.createEl("img", { cls: "workspace-image-preview-img" });
      img.src = preview.url;
      img.alt = imageRef;
      img.style.cursor = "zoom-in";
      img.onclick = () => openImagePreview(imageRef);
    };
    renderPreview();
    input.addEventListener("input", renderPreview);

    contentEl.createEl("div", {
      text: "粘贴区（自动保存到 /attachments 并生成 ![[Pasted image ...]]）",
      cls: "workspace-modal-desc",
    });
    const pasteStatus = contentEl.createEl("div", {
      text: "等待粘贴，或直接修改上面的图片引用后点保存。",
      cls: "workspace-modal-desc",
    });
    const pasteZone = contentEl.createEl("div", {
      cls: "workspace-image-paste-zone",
      text: "在这里粘贴图片",
    });
    pasteZone.setAttr("contenteditable", "true");
    pasteZone.addEventListener("paste", async (event) => {
      event.preventDefault();
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((it) => typeof it?.type === "string" && it.type.startsWith("image/"));
      if (!imageItem) {
        pasteStatus.textContent = "未检测到图片，请复制图片后再粘贴。";
        return;
      }
      const file = imageItem.getAsFile();
      if (!file) {
        pasteStatus.textContent = "读取剪贴板图片失败，请重试。";
        return;
      }
      pasteStatus.textContent = "正在保存图片...";
      try {
        const saved = await savePastedImage(file);
        input.value = saved?.embedLink || "";
        pasteStatus.textContent = `已生成并填入: ${saved?.embedLink || ""}`;
        renderPreview();
      } catch (error) {
        console.error("[Workspace Mount] save pasted image failed:", error);
        pasteStatus.textContent = `保存失败: ${error.message}`;
      }
    });

    const shortcutWrap = contentEl.createDiv({ cls: "workspace-shortcut-panel" });
    shortcutWrap.createEl("div", { text: "快捷方式", cls: "workspace-shortcut-title" });
    shortcutWrap.createEl("div", {
      text: "把笔记链接、网页链接或文件/快捷方式拖到下面区域，或手动输入后添加。",
      cls: "workspace-modal-desc",
    });
    const shortcutStatus = shortcutWrap.createEl("div", {
      text: this.shortcutEntries.length > 0 ? `当前已挂 ${this.shortcutEntries.length} 个快捷方式` : "当前还没有快捷方式",
      cls: "workspace-modal-desc",
    });
    const shortcutDropZone = shortcutWrap.createEl("div", {
      cls: "workspace-shortcut-drop-zone",
      text: "拖拽快捷方式到这里",
    });
    const shortcutPasteRow = shortcutWrap.createDiv({ cls: "workspace-shortcut-input-row" });
    const shortcutPasteInput = shortcutPasteRow.createEl("input", {
      type: "text",
      cls: "workspace-modal-input",
      attr: { placeholder: "也可粘贴 URL / 文件路径 / Obsidian 链接后点添加" },
    });
    const shortcutPasteBtn = shortcutPasteRow.createEl("button", { text: "添加" });
    const shortcutList = shortcutWrap.createDiv({ cls: "workspace-shortcut-list" });
    const appendShortcutEntry = (entry, successPrefix = "已添加快捷方式") => {
      if (!entry) return false;
      const next = normalizeShortcutEntries(this.shortcutEntries.concat([entry]));
      if (next.length === this.shortcutEntries.length) {
        shortcutStatus.textContent = `已存在同一路径快捷方式：${getShortcutDisplayLabel(entry)}`;
        return false;
      }
      this.shortcutEntries = next;
      shortcutStatus.textContent = `${successPrefix}：${getShortcutDisplayLabel(entry)}`;
      renderShortcutList();
      return true;
    };
    const addShortcutFromPaste = () => {
      const entry = resolveShortcutEntryFromRawInput(shortcutPasteInput.value);
      if (!entry) {
        shortcutStatus.textContent = "没有识别到可用的 URL 或快捷方式";
        return;
      }
      const added = appendShortcutEntry(entry, "已粘贴添加快捷方式");
      if (added) {
        shortcutPasteInput.value = "";
        shortcutPasteInput.focus();
      }
    };
    const renderShortcutList = () => {
      shortcutList.empty();
      shortcutStatus.textContent = this.shortcutEntries.length > 0
        ? `当前已挂 ${this.shortcutEntries.length} 个快捷方式`
        : "当前还没有快捷方式";
      if (this.shortcutEntries.length === 0) {
        shortcutList.createDiv({ text: "暂无快捷方式", cls: "workspace-empty" });
        return;
      }
      this.shortcutEntries.forEach((entry) => {
        const row = shortcutList.createDiv({ cls: "workspace-shortcut-row" });
        const meta = row.createDiv({ cls: "workspace-shortcut-meta" });
        const titleEl = meta.createEl("div", { text: `↗ ${getShortcutDisplayLabel(entry)}`, cls: "workspace-shortcut-label" });
        const subtitleEl = meta.createEl("div", { text: "正在识别预览信息…", cls: "workspace-shortcut-subtitle" });
        const pathEl = meta.createEl("div", { text: entry.path, cls: "workspace-shortcut-path" });
        void getShortcutPreviewMeta(entry).then((metaInfo) => {
          if (!row.isConnected) return;
          titleEl.textContent = `↗ ${metaInfo.title || getShortcutDisplayLabel(entry)}`;
          subtitleEl.textContent = metaInfo.subtitle || "";
          pathEl.textContent = metaInfo.detail || entry.path;
        }).catch(() => {
          if (!row.isConnected) return;
          subtitleEl.textContent = "";
        });
        const actionsWrap = row.createDiv({ cls: "workspace-shortcut-row-actions" });
        const previewShortcutBtn = actionsWrap.createEl("button", { text: "预览" });
        previewShortcutBtn.onclick = async () => { await openShortcutPreview(entry); };
        const removeBtn = actionsWrap.createEl("button", { text: "移除" });
        removeBtn.onclick = () => {
          this.shortcutEntries = this.shortcutEntries.filter((it) => it.id !== entry.id);
          renderShortcutList();
        };
      });
    };
    shortcutDropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      shortcutDropZone.classList.add("is-drag-over");
    });
    shortcutDropZone.addEventListener("dragleave", () => shortcutDropZone.classList.remove("is-drag-over"));
    shortcutDropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      shortcutDropZone.classList.remove("is-drag-over");
      const entry = resolveShortcutEntryFromDrop(event.dataTransfer);
      if (!entry) {
        shortcutStatus.textContent = "没有识别到可用的快捷方式";
        return;
      }
      appendShortcutEntry(entry);
    });
    shortcutPasteBtn.onclick = addShortcutFromPaste;
    shortcutPasteInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      addShortcutFromPaste();
    });
    renderShortcutList();

    const actions = contentEl.createDiv({ cls: "workspace-modal-actions" });
    const clearBtn = actions.createEl("button", { text: "清除图片" });
    clearBtn.onclick = () => {
      this.result = { action: "clear", value: "", shortcuts: this.shortcutEntries.slice() };
      this.close();
    };
    const cancelBtn = actions.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => {
      this.didExplicitCancel = true;
      this.close();
    };
    const saveBtn = actions.createEl("button", { text: "保存", cls: "mod-cta" });
    saveBtn.onclick = () => {
      this.result = { action: "save", value: sanitizeText(input.value, ""), shortcuts: this.shortcutEntries.slice() };
      this.close();
    };
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  onClose() {
    this.contentEl.empty();
    this._resolve(this.result);
  }

  waitForResult() {
    this.open();
    return this.waiter;
  }
}

class WorkspaceCommentEditorModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options;
    this.result = null;
    this.didExplicitCancel = false;
    this.textareaEl = null;
    this.waiter = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  onOpen() {
    const { contentEl } = this;
    const {
      title = "评论",
      value = "",
    } = this.options;
    this.result = null;
    this.didExplicitCancel = false;
    this.textareaEl = null;
    contentEl.empty();
    this.modalEl.style.maxWidth = "1100px";
    this.modalEl.style.width = "92vw";
    this.modalEl.style.height = "78vh";
    contentEl.style.display = "flex";
    contentEl.style.flexDirection = "column";
    contentEl.style.height = "100%";
    contentEl.style.gap = "10px";
    contentEl.createEl("h3", { text: title });
    contentEl.createEl("div", {
      text: "可写长评论，列表中展示前 100 字摘要。",
      cls: "workspace-modal-desc",
    });
    const textarea = contentEl.createEl("textarea", {
      text: value,
      cls: "workspace-comment-textarea",
    });
    this.textareaEl = textarea;
    textarea.placeholder = "记录思路、补充信息、执行细节...";
    textarea.focus();
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.value.length;
    const counter = contentEl.createEl("div", { cls: "workspace-comment-counter" });
    const updateCounter = () => {
      counter.textContent = `${textarea.value.length} 字`;
    };
    textarea.addEventListener("input", updateCounter);
    updateCounter();
    const actions = contentEl.createDiv({ cls: "workspace-modal-actions" });
    const clearBtn = actions.createEl("button", { text: "清空评论" });
    clearBtn.onclick = () => {
      this.result = { action: "clear" };
      this.close();
    };
    const cancelBtn = actions.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => {
      this.didExplicitCancel = true;
      this.close();
    };
    const saveBtn = actions.createEl("button", { text: "保存评论", cls: "mod-cta" });
    saveBtn.onclick = () => {
      this.result = { action: "save", value: textarea.value };
      this.close();
    };
  }

  onClose() {
    if (!this.result && !this.didExplicitCancel) {
      this.result = {
        action: "save",
        value: String(this.textareaEl?.value || ""),
      };
    }
    this.modalEl.style.maxWidth = "";
    this.modalEl.style.width = "";
    this.modalEl.style.height = "";
    this.contentEl.style.display = "";
    this.contentEl.style.flexDirection = "";
    this.contentEl.style.height = "";
    this.contentEl.style.gap = "";
    this.textareaEl = null;
    this.contentEl.empty();
    this._resolve(this.result);
  }

  waitForResult() {
    this.open();
    return this.waiter;
  }
}

class WorkspaceNoteBindingModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options;
    this.result = null;
    this.waiter = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  onOpen() {
    const { contentEl } = this;
    const {
      title = "绑定笔记",
      value = "",
      noteIndex = [],
      onOpenCurrent = null,
    } = this.options;
    this.filtered = [];
    this.activeIndex = 0;
    contentEl.empty();
    this.modalEl.style.maxWidth = "1100px";
    this.modalEl.style.width = "92vw";
    this.modalEl.style.height = "80vh";
    contentEl.style.display = "flex";
    contentEl.style.flexDirection = "column";
    contentEl.style.height = "100%";
    contentEl.style.gap = "8px";
    contentEl.createEl("h3", { text: title });
    contentEl.createEl("div", {
      text: "已有笔记会直接列出来；也可以手动输入文件名或路径绑定。",
      cls: "workspace-modal-desc",
    });
    if (value) {
      const currentWrap = contentEl.createDiv({ cls: "workspace-note-picker-current" });
      currentWrap.createEl("div", { text: "当前绑定", cls: "workspace-shortcut-title" });
      currentWrap.createEl("div", { text: value, cls: "workspace-shortcut-path" });
      const currentActions = currentWrap.createDiv({ cls: "workspace-modal-actions" });
      if (typeof onOpenCurrent === "function") {
        const openBtn = currentActions.createEl("button", { text: "打开当前绑定" });
        openBtn.onclick = () => { onOpenCurrent(); };
      }
      const clearCurrentBtn = currentActions.createEl("button", { text: "清除绑定" });
      clearCurrentBtn.onclick = () => {
        this.result = { action: "clear", value: "" };
        this.close();
      };
    }
    const input = contentEl.createEl("input", {
      type: "text",
      cls: "workspace-modal-input",
      attr: { placeholder: "输入关键词筛选，或直接输入文件名/路径后绑定" },
    });
    input.value = value || "";
    const stat = contentEl.createEl("div", { text: "", cls: "workspace-modal-desc" });
    const listEl = contentEl.createDiv({ cls: "workspace-note-picker-list" });
    const actions = contentEl.createDiv({ cls: "workspace-modal-actions" });
    const syncActiveRows = () => {
      Array.from(listEl.children).forEach((child, idx) => {
        if (!(child instanceof HTMLElement)) return;
        child.classList.toggle("is-active", idx === this.activeIndex);
      });
    };
    const renderList = () => {
      const q = String(input.value || "").trim().toLowerCase();
      const terms = q ? q.split(/\s+/).filter(Boolean) : [];
      const matched = !terms.length
        ? noteIndex.slice(0, 240)
        : noteIndex.filter((item) => {
          const hay = `${item.search || ""} ${item.basenameLower || ""} ${item.pathLower || ""}`.toLowerCase();
          return terms.every((term) => hay.includes(term));
        }).slice(0, 240);
      this.filtered = matched;
      if (this.activeIndex >= matched.length) this.activeIndex = Math.max(0, matched.length - 1);
      stat.textContent = `共 ${matched.length} 条结果`;
      listEl.empty();
      if (matched.length === 0) {
        listEl.createDiv({ text: "无匹配笔记", cls: "workspace-empty" });
        return;
      }
      matched.forEach((item, idx) => {
        const row = listEl.createDiv({ cls: `workspace-note-picker-row ${idx === this.activeIndex ? "is-active" : ""}`.trim() });
        row.createEl("div", { text: `📝 ${item.basename}`, cls: "workspace-shortcut-label" });
        row.createEl("div", { text: item.path, cls: "workspace-shortcut-path" });
        row.onclick = () => {
          this.result = { action: "save", value: item.path };
          this.close();
        };
        row.onmouseenter = () => {
          this.activeIndex = idx;
          syncActiveRows();
        };
      });
    };
    input.addEventListener("input", () => {
      this.activeIndex = 0;
      renderList();
    });
    const clearBtn = actions.createEl("button", { text: "清除绑定" });
    clearBtn.onclick = () => {
      this.result = { action: "clear", value: "" };
      this.close();
    };
    const cancelBtn = actions.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => this.close();
    const saveBtn = actions.createEl("button", { text: "绑定输入内容", cls: "mod-cta" });
    const submit = () => {
      this.result = { action: "save", value: sanitizeText(input.value, "") };
      this.close();
    };
    saveBtn.onclick = submit;
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (this.activeIndex < this.filtered.length - 1) this.activeIndex += 1;
        syncActiveRows();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (this.activeIndex > 0) this.activeIndex -= 1;
        syncActiveRows();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const selected = this.filtered[this.activeIndex];
        if (selected) {
          this.result = { action: "save", value: selected.path };
          this.close();
        } else {
          submit();
        }
      }
    });
    renderList();
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  }

  onClose() {
    this.modalEl.style.maxWidth = "";
    this.modalEl.style.width = "";
    this.modalEl.style.height = "";
    this.contentEl.style.display = "";
    this.contentEl.style.flexDirection = "";
    this.contentEl.style.height = "";
    this.contentEl.style.gap = "";
    this.contentEl.empty();
    this._resolve(this.result);
  }

  waitForResult() {
    this.open();
    return this.waiter;
  }
}

class WorkspaceParadigmPickerModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options;
    this.result = null;
    this.waiter = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  onOpen() {
    const { contentEl } = this;
    const {
      title = "选择范式",
      description = "",
      items = [],
    } = this.options;
    this.filtered = [];
    this.activeIndex = 0;
    contentEl.empty();
    this.modalEl.style.maxWidth = "1100px";
    this.modalEl.style.width = "92vw";
    this.modalEl.style.height = "80vh";
    contentEl.style.display = "flex";
    contentEl.style.flexDirection = "column";
    contentEl.style.height = "100%";
    contentEl.style.gap = "8px";
    contentEl.createEl("h3", { text: title });
    if (description) contentEl.createEl("div", { text: description, cls: "workspace-modal-desc" });
    const input = contentEl.createEl("input", {
      type: "text",
      cls: "workspace-modal-input",
      attr: { placeholder: "输入范式名称、ID 或定义源筛选" },
    });
    const stat = contentEl.createEl("div", { text: "", cls: "workspace-modal-desc" });
    const listEl = contentEl.createDiv({ cls: "workspace-note-picker-list" });
    const actions = contentEl.createDiv({ cls: "workspace-modal-actions" });
    const syncActiveRows = () => {
      Array.from(listEl.children).forEach((child, idx) => {
        if (!(child instanceof HTMLElement)) return;
        child.classList.toggle("is-active", idx === this.activeIndex);
      });
    };
    const renderList = () => {
      const q = String(input.value || "").trim().toLowerCase();
      const terms = q ? q.split(/\s+/).filter(Boolean) : [];
      const matched = !terms.length
        ? items.slice(0, 240)
        : items.filter((item) => {
          const hay = String(item.search || "").toLowerCase();
          return terms.every((term) => hay.includes(term));
        }).slice(0, 240);
      this.filtered = matched;
      if (this.activeIndex >= matched.length) this.activeIndex = Math.max(0, matched.length - 1);
      stat.textContent = `共 ${matched.length} 条结果`;
      listEl.empty();
      if (matched.length === 0) {
        listEl.createDiv({ text: "无匹配范式", cls: "workspace-empty" });
        return;
      }
      matched.forEach((item, idx) => {
        const row = listEl.createDiv({ cls: `workspace-note-picker-row ${idx === this.activeIndex ? "is-active" : ""}`.trim() });
        row.createEl("div", { text: item.name || item.id, cls: "workspace-shortcut-label" });
        row.createEl("div", { text: item.meta || item.id, cls: "workspace-shortcut-path" });
        row.onclick = () => {
          this.result = item.id;
          this.close();
        };
        row.onmouseenter = () => {
          this.activeIndex = idx;
          syncActiveRows();
        };
      });
    };
    input.addEventListener("input", () => {
      this.activeIndex = 0;
      renderList();
    });
    const cancelBtn = actions.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => this.close();
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (this.activeIndex < this.filtered.length - 1) this.activeIndex += 1;
        renderList();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (this.activeIndex > 0) this.activeIndex -= 1;
        renderList();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const selected = this.filtered[this.activeIndex];
        if (!selected) return;
        this.result = selected.id;
        this.close();
      }
    });
    renderList();
    window.setTimeout(() => input.focus(), 0);
  }

  onClose() {
    this.modalEl.style.maxWidth = "";
    this.modalEl.style.width = "";
    this.modalEl.style.height = "";
    this.contentEl.style.display = "";
    this.contentEl.style.flexDirection = "";
    this.contentEl.style.height = "";
    this.contentEl.style.gap = "";
    this.contentEl.empty();
    this._resolve(this.result);
  }

  waitForResult() {
    this.open();
    return this.waiter;
  }
}

class WorkspaceTabPickerModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options;
    this.result = null;
    this.waiter = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  onOpen() {
    const { contentEl } = this;
    const {
      title = "选择 Tab",
      description = "",
      items = [],
    } = this.options;
    this.filtered = [];
    this.activeIndex = 0;
    contentEl.empty();
    this.modalEl.style.maxWidth = "1100px";
    this.modalEl.style.width = "92vw";
    this.modalEl.style.height = "80vh";
    contentEl.style.display = "flex";
    contentEl.style.flexDirection = "column";
    contentEl.style.height = "100%";
    contentEl.style.gap = "8px";
    contentEl.createEl("h3", { text: title });
    if (description) contentEl.createEl("div", { text: description, cls: "workspace-modal-desc" });
    const input = contentEl.createEl("input", {
      type: "text",
      cls: "workspace-modal-input",
      attr: { placeholder: "输入 Tab 名称、ID 或 emoji 筛选" },
    });
    const stat = contentEl.createEl("div", { text: "", cls: "workspace-modal-desc" });
    const listEl = contentEl.createDiv({ cls: "workspace-note-picker-list" });
    const actions = contentEl.createDiv({ cls: "workspace-modal-actions" });
    const syncActiveRows = () => {
      Array.from(listEl.children).forEach((child, idx) => {
        if (!(child instanceof HTMLElement)) return;
        child.classList.toggle("is-active", idx === this.activeIndex);
      });
    };
    const renderList = () => {
      const q = String(input.value || "").trim().toLowerCase();
      const terms = q ? q.split(/\s+/).filter(Boolean) : [];
      const matched = !terms.length
        ? items.slice(0, 240)
        : items.filter((item) => {
          const hay = String(item.search || "").toLowerCase();
          return terms.every((term) => hay.includes(term));
        }).slice(0, 240);
      this.filtered = matched;
      if (this.activeIndex >= matched.length) this.activeIndex = Math.max(0, matched.length - 1);
      stat.textContent = `共 ${matched.length} 条结果`;
      listEl.empty();
      if (matched.length === 0) {
        listEl.createDiv({ text: "无匹配 Tab", cls: "workspace-empty" });
        return;
      }
      matched.forEach((item, idx) => {
        const row = listEl.createDiv({ cls: `workspace-note-picker-row ${idx === this.activeIndex ? "is-active" : ""}`.trim() });
        row.createEl("div", { text: item.name || item.id, cls: "workspace-shortcut-label" });
        row.createEl("div", { text: item.meta || item.id, cls: "workspace-shortcut-path" });
        row.onclick = () => {
          this.result = item.id;
          this.close();
        };
        row.onmouseenter = () => {
          this.activeIndex = idx;
          syncActiveRows();
        };
      });
    };
    input.addEventListener("input", () => {
      this.activeIndex = 0;
      renderList();
    });
    const cancelBtn = actions.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => this.close();
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (this.activeIndex < this.filtered.length - 1) this.activeIndex += 1;
        renderList();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (this.activeIndex > 0) this.activeIndex -= 1;
        renderList();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const selected = this.filtered[this.activeIndex];
        if (!selected) return;
        this.result = selected.id;
        this.close();
      }
    });
    renderList();
    window.setTimeout(() => input.focus(), 0);
  }

  onClose() {
    this.modalEl.style.maxWidth = "";
    this.modalEl.style.width = "";
    this.modalEl.style.height = "";
    this.contentEl.style.display = "";
    this.contentEl.style.flexDirection = "";
    this.contentEl.style.height = "";
    this.contentEl.style.gap = "";
    this.contentEl.empty();
    this._resolve(this.result);
  }

  waitForResult() {
    this.open();
    return this.waiter;
  }
}

class WorkspaceParadigmTagPickerModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options;
    this.query = "";
    this.result = null;
    this.waiter = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  getTagById(tagId) {
    return this.options.tagsById?.[sanitizeText(tagId, "")] || null;
  }

  getSortedChildrenIds(parentTagId = null) {
    return Object.values(this.options.tagsById || {})
      .filter((tag) => !!tag && (tag.parentTagId || null) === (parentTagId || null))
      .sort((a, b) => {
        const orderA = Number.isFinite(a?.order) ? a.order : Number.MAX_SAFE_INTEGER;
        const orderB = Number.isFinite(b?.order) ? b.order : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return sanitizeText(a?.label, a?.id).localeCompare(sanitizeText(b?.label, b?.id), "zh");
      })
      .map((tag) => tag.id);
  }

  getTagPathLabel(tagOrId) {
    const tag = typeof tagOrId === "string" ? this.getTagById(tagOrId) : tagOrId;
    if (!tag) return sanitizeText(tagOrId, "");
    const parts = [];
    const seen = new Set();
    let cursor = tag;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      parts.unshift(sanitizeText(cursor.label, cursor.id) || cursor.id);
      cursor = cursor.parentTagId ? this.getTagById(cursor.parentTagId) : null;
    }
    return parts.join(" / ");
  }

  tagMatchesQuery(tagId) {
    const tag = this.getTagById(tagId);
    if (!tag) return false;
    const q = sanitizeText(this.query, "").toLowerCase();
    if (!q) return true;
    const hay = [tag.id, tag.label, this.getTagPathLabel(tag.id)].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  }

  branchMatchesQuery(tagId) {
    if (this.tagMatchesQuery(tagId)) return true;
    return this.getSortedChildrenIds(tagId).some((childId) => this.branchMatchesQuery(childId));
  }

  toggleTag(tagId) {
    const normalizedId = sanitizeText(tagId, "");
    if (!normalizedId || !this.getTagById(normalizedId)) return;
    if (this.selected.has(normalizedId)) this.selected.delete(normalizedId);
    else this.selected.add(normalizedId);
    this.renderBody();
  }

  renderSelectedPreview() {
    this.previewEl.empty();
    const selectedIds = Array.from(this.selected).filter((id) => !!this.getTagById(id));
    if (selectedIds.length === 0) {
      this.previewEl.createEl("div", {
        text: "当前未选择标签",
        attr: { style: "font-size:12px;color:var(--text-muted);" },
      });
      return toc;
    }
    const wrap = this.previewEl.createDiv({ cls: "workspace-paradigm-tag-summary" });
    selectedIds
      .sort((a, b) => this.getTagPathLabel(a).localeCompare(this.getTagPathLabel(b), "zh"))
      .forEach((tagId) => {
        const tag = this.getTagById(tagId);
        if (!tag) return;
        const chip = wrap.createEl("button", {
          cls: "workspace-paradigm-tag-chip is-filter is-active",
          attr: { type: "button", title: "点击移除这个标签" },
        });
        chip.createEl("span", {
          cls: "workspace-paradigm-tag-chip-dot",
          attr: { style: `background:${sanitizeText(tag.color, "") || DEFAULT_PARADIGM_TAG_COLOR};` },
        });
        chip.createEl("span", { text: sanitizeText(tag.label, tag.id) || tag.id });
        chip.onclick = () => this.toggleTag(tag.id);
      });
    this.previewEl.createEl("div", {
      text: `已选 ${selectedIds.length} 个标签`,
      attr: { style: "font-size:12px;color:var(--text-muted);margin-top:8px;" },
    });
  }

  renderTreeBranch(container, parentTagId = null, level = 0) {
    const childIds = this.getSortedChildrenIds(parentTagId).filter((tagId) => this.branchMatchesQuery(tagId));
    childIds.forEach((tagId) => {
      const tag = this.getTagById(tagId);
      if (!tag) return;
      const childTagIds = this.getSortedChildrenIds(tag.id).filter((childId) => this.branchMatchesQuery(childId));
      const row = container.createEl("label", {
        attr: {
          style: `display:flex;align-items:flex-start;gap:10px;padding:8px 10px;margin-left:${level * 18}px;margin-bottom:8px;border:1px solid var(--background-modifier-border);border-radius:10px;background:var(--background-primary);cursor:pointer;`,
        },
      });
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = this.selected.has(tag.id);
      checkbox.onchange = (e) => {
        e.stopPropagation();
        this.toggleTag(tag.id);
      };
      const meta = row.createEl("div", {
        attr: { style: "display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 auto;" },
      });
      const title = meta.createEl("div", {
        attr: { style: "display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap;" },
      });
      title.createEl("span", {
        cls: "workspace-paradigm-tag-chip-dot",
        attr: { style: `background:${sanitizeText(tag.color, "") || DEFAULT_PARADIGM_TAG_COLOR};width:10px;height:10px;flex:0 0 10px;` },
      });
      title.createEl("span", { text: sanitizeText(tag.label, tag.id) || tag.id, attr: { style: "font-weight:600;" } });
      meta.createEl("small", {
        text: `${tag.id}${childTagIds.length > 0 ? ` · 子标签 ${childTagIds.length}` : ""}`,
        attr: { style: "color:var(--text-muted);" },
      });
      row.addEventListener("click", (e) => {
        if (e.target === checkbox) return;
        e.preventDefault();
        this.toggleTag(tag.id);
      });
      if (childTagIds.length > 0) this.renderTreeBranch(container, tag.id, level + 1);
    });
  }

  renderBody() {
    this.renderSelectedPreview();
    this.listEl.empty();
    const tagsById = this.options.tagsById || {};
    if (Object.keys(tagsById).length === 0) {
      this.listEl.createEl("div", {
        text: "还没有范式标签，请先创建一些标签。",
        attr: { style: "padding:18px;color:var(--text-muted);text-align:center;" },
      });
      this.statEl.textContent = "共 0 个标签";
      return;
    }
    const visibleTopLevelIds = this.getSortedChildrenIds(null).filter((tagId) => this.branchMatchesQuery(tagId));
    this.statEl.textContent = `显示 ${visibleTopLevelIds.length} 个顶层标签`;
    if (visibleTopLevelIds.length === 0) {
      this.listEl.createEl("div", {
        text: "没有匹配标签",
        attr: { style: "padding:18px;color:var(--text-muted);text-align:center;" },
      });
      return;
    }
    this.renderTreeBranch(this.listEl, null, 0);
  }

  onOpen() {
    const { contentEl } = this;
    const {
      title = "设置范式标签",
      selectedIds = [],
    } = this.options;
    this.selected = new Set(normalizeParadigmTagIds(selectedIds, this.options.tagsById || {}));
    contentEl.empty();
    this.modalEl.style.maxWidth = "820px";
    this.modalEl.style.width = "88vw";
    this.modalEl.style.height = "78vh";
    contentEl.style.display = "flex";
    contentEl.style.flexDirection = "column";
    contentEl.style.height = "100%";
    contentEl.style.gap = "10px";

    contentEl.createEl("h3", { text: title });
    contentEl.createEl("div", {
      text: "这里只设置范式自身的标签，不会改 Tab 里的条目显示。",
      cls: "workspace-modal-desc",
    });
    const searchInput = contentEl.createEl("input", {
      type: "text",
      cls: "workspace-modal-input",
      attr: { placeholder: "输入标签名称或 ID 筛选" },
    });
    searchInput.addEventListener("input", () => {
      this.query = searchInput.value || "";
      this.renderBody();
    });
    this.previewEl = contentEl.createEl("div", {
      attr: { style: "padding:10px;border:1px solid var(--background-modifier-border);border-radius:10px;background:var(--background-secondary);" },
    });
    this.statEl = contentEl.createEl("div", {
      text: "",
      cls: "workspace-modal-desc",
    });
    this.listEl = contentEl.createEl("div", {
      attr: { style: "flex:1;overflow:auto;border:1px solid var(--background-modifier-border);border-radius:10px;padding:10px;background:var(--background-secondary);" },
    });
    const actions = contentEl.createDiv({ cls: "workspace-modal-actions" });
    const clearBtn = actions.createEl("button", { text: "清空选择" });
    clearBtn.onclick = () => {
      this.selected.clear();
      this.renderBody();
    };
    const cancelBtn = actions.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => {
      this.result = null;
      this.close();
    };
    const saveBtn = actions.createEl("button", { text: "保存标签", cls: "mod-cta" });
    saveBtn.onclick = () => {
      this.result = Array.from(this.selected).filter((id) => !!this.getTagById(id));
      this.close();
    };
    this.renderBody();
    window.setTimeout(() => searchInput.focus(), 0);
  }

  onClose() {
    this.modalEl.style.maxWidth = "";
    this.modalEl.style.width = "";
    this.modalEl.style.height = "";
    this.contentEl.style.display = "";
    this.contentEl.style.flexDirection = "";
    this.contentEl.style.height = "";
    this.contentEl.style.gap = "";
    this.contentEl.empty();
    this._resolve(this.result);
  }

  waitForResult() {
    this.open();
    return this.waiter;
  }
}

class WorkspaceParadigmTagDefinitionModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options;
    this.result = null;
    this.waiter = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  onOpen() {
    const { contentEl } = this;
    const {
      tagId = "",
      defaultLabel = "",
      presetParentTagId = null,
      tagsById = {},
      getTagPathLabel = (value) => sanitizeText(value, ""),
      getDescendantIds = () => [],
    } = this.options;
    const currentTagId = sanitizeText(tagId, "");
    const tag = currentTagId ? tagsById[currentTagId] || null : null;
    const initialLabel = sanitizeText(tag?.label, defaultLabel);
    const initialColor = normalizeTabAccentColor(tag?.color) || getDefaultParadigmTagColor(initialLabel || currentTagId || "paradigm-tag");
    const initialParentId = sanitizeText(tag?.parentTagId, "") || sanitizeText(presetParentTagId, "") || "";
    const excluded = new Set();
    if (currentTagId) {
      excluded.add(currentTagId);
      getDescendantIds(currentTagId).forEach((id) => excluded.add(id));
    }
    const availableParents = Object.values(tagsById || {})
      .filter((entry) => !!entry && !excluded.has(entry.id))
      .sort((a, b) => getTagPathLabel(a.id).localeCompare(getTagPathLabel(b.id), "zh"));

    contentEl.empty();
    this.modalEl.style.maxWidth = "640px";
    this.modalEl.style.width = "88vw";
    contentEl.style.display = "flex";
    contentEl.style.flexDirection = "column";
    contentEl.style.gap = "10px";

    contentEl.createEl("h3", { text: currentTagId ? "编辑范式标签" : "新建范式标签" });
    contentEl.createEl("div", {
      text: currentTagId ? `标签 ID: ${currentTagId}` : "标签会自动生成 ID；这里主要配置名称、颜色和父级。",
      cls: "workspace-modal-desc",
    });

    const form = contentEl.createDiv({
      attr: {
        style: "display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--background-modifier-border);border-radius:10px;background:var(--background-primary);",
      },
    });

    const labelRow = form.createEl("label", {
      attr: { style: "display:flex;flex-direction:column;gap:6px;" },
    });
    labelRow.createEl("span", { text: "名称", attr: { style: "font-size:12px;color:var(--text-muted);" } });
    const labelInput = labelRow.createEl("input", {
      type: "text",
      value: initialLabel,
      attr: {
        placeholder: "例如：学习方法、复盘框架、问题拆解",
        style: "width:100%;padding:8px 10px;border:1px solid var(--background-modifier-border);border-radius:8px;background:var(--background-secondary);color:var(--text-normal);",
      },
    });

    const colorRow = form.createEl("label", {
      attr: { style: "display:flex;flex-direction:column;gap:6px;" },
    });
    colorRow.createEl("span", { text: "颜色", attr: { style: "font-size:12px;color:var(--text-muted);" } });
    const colorWrap = colorRow.createDiv({
      attr: { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap;" },
    });
    const colorInput = colorWrap.createEl("input", {
      type: "color",
      value: initialColor,
      attr: { style: "width:52px;height:34px;padding:2px;border:none;background:transparent;" },
    });
    const preview = colorWrap.createDiv({ cls: "workspace-paradigm-tag-chip" });
    const previewDot = preview.createEl("span", {
      cls: "workspace-paradigm-tag-chip-dot",
      attr: { style: `background:${initialColor};` },
    });
    const previewText = preview.createEl("span", { text: initialLabel || "标签预览" });
    const updatePreview = () => {
      const label = sanitizeText(labelInput.value, "") || "标签预览";
      previewDot.style.background = normalizeTabAccentColor(colorInput.value) || getDefaultParadigmTagColor(label);
      previewText.textContent = label;
    };
    labelInput.addEventListener("input", updatePreview);
    colorInput.addEventListener("input", updatePreview);

    const parentRow = form.createEl("label", {
      attr: { style: "display:flex;flex-direction:column;gap:6px;" },
    });
    parentRow.createEl("span", { text: "父标签", attr: { style: "font-size:12px;color:var(--text-muted);" } });
    const parentSelect = parentRow.createEl("select", {
      attr: {
        style: "width:100%;padding:8px 10px;border:1px solid var(--background-modifier-border);border-radius:8px;background:var(--background-secondary);color:var(--text-normal);",
      },
    });
    const topOption = parentSelect.createEl("option", { text: "顶层标签", value: "" });
    if (!initialParentId) topOption.selected = true;
    availableParents.forEach((entry) => {
      const option = parentSelect.createEl("option", {
        text: getTagPathLabel(entry.id),
        value: entry.id,
      });
      if (entry.id === initialParentId) option.selected = true;
    });

    const actions = contentEl.createDiv({ cls: "workspace-modal-actions" });
    const cancelBtn = actions.createEl("button", { text: "取消" });
    cancelBtn.onclick = () => this.close();
    const saveBtn = actions.createEl("button", {
      text: currentTagId ? "保存" : "创建",
      cls: "mod-cta",
    });
    const submit = () => {
      const label = sanitizeText(labelInput.value, "");
      if (!label) {
        new Notice("⚠️ 请输入标签名称");
        return;
      }
      this.result = {
        label,
        color: normalizeTabAccentColor(colorInput.value) || getDefaultParadigmTagColor(label),
        parentTagId: sanitizeText(parentSelect.value, "") || null,
      };
      this.close();
    };
    saveBtn.onclick = submit;
    labelInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    });
    window.setTimeout(() => {
      labelInput.focus();
      labelInput.selectionStart = labelInput.value.length;
      labelInput.selectionEnd = labelInput.value.length;
    }, 0);
  }

  onClose() {
    this.modalEl.style.maxWidth = "";
    this.modalEl.style.width = "";
    this.contentEl.style.display = "";
    this.contentEl.style.flexDirection = "";
    this.contentEl.style.gap = "";
    this.contentEl.empty();
    this._resolve(this.result);
  }

  waitForResult() {
    this.open();
    return this.waiter;
  }
}

function normalizeBoundParadigmIds(tabLike) {
  const fromArray = Array.isArray(tabLike?.boundParadigmIds) ? tabLike.boundParadigmIds : [];
  const legacy = sanitizeText(tabLike?.boundParadigmId, "") ? [sanitizeText(tabLike.boundParadigmId, "")] : [];
  return ensureUniqueIds([].concat(fromArray, legacy).map((x) => sanitizeText(x, "")).filter(Boolean));
}

function setTabBoundParadigmIds(tabObj, idsLike) {
  const ids = ensureUniqueIds((Array.isArray(idsLike) ? idsLike : []).map((x) => sanitizeText(x, "")).filter(Boolean));
  tabObj.boundParadigmIds = ids;
  tabObj.boundParadigmId = ids[0] || null;
  return ids;
}

function normalizeBoundParadigmItemKeys(tabLike) {
  return ensureUniqueIds((Array.isArray(tabLike?.boundParadigmItemKeys) ? tabLike.boundParadigmItemKeys : [])
    .map((x) => sanitizeText(x, ""))
    .filter((key) => {
      const parsed = splitScopedKey(key);
      return !!parsed.ownerId && parsed.parent !== ROOT_KEY;
    }));
}

function setTabBoundParadigmItemKeys(tabObj, keysLike) {
  const keys = normalizeBoundParadigmItemKeys({ boundParadigmItemKeys: keysLike });
  tabObj.boundParadigmItemKeys = keys;
  return keys;
}

function normalizeParadigmTagIds(tagIdsLike, tagsById = {}) {
  return ensureUniqueIds((Array.isArray(tagIdsLike) ? tagIdsLike : [])
    .map((id) => sanitizeText(id, ""))
    .filter((id) => !!id && !!tagsById?.[id]));
}

function flattenTabTree(childrenMap, parentId = null, chain = new Set()) {
  const key = parentKey(parentId);
  const ids = ensureUniqueIds(childrenMap?.[key] || []);
  const ordered = [];
  ids.forEach((id) => {
    if (!id || chain.has(id)) return;
    ordered.push(id);
    const next = new Set(chain);
    next.add(id);
    ordered.push(...flattenTabTree(childrenMap, id, next));
  });
  return ordered;
}

function rebuildTabOrderFromData(data) {
  const nextOrder = flattenTabTree(data.tabChildrenByParent || {}, null);
  Object.keys(data.tabsById || {}).forEach((id) => {
    if (!nextOrder.includes(id)) nextOrder.push(id);
  });
  data.tabOrder = nextOrder;
}

function splitScopedKey(scoped, fallbackId = "") {
  const text = sanitizeText(scoped, "");
  if (!text) return { ownerId: fallbackId, parent: ROOT_KEY };
  const idx = text.indexOf("::");
  if (idx < 0) return { ownerId: fallbackId, parent: text || ROOT_KEY };
  const ownerId = sanitizeText(text.slice(0, idx), fallbackId);
  const parent = sanitizeText(text.slice(idx + 2), ROOT_KEY);
  return { ownerId, parent };
}

function ensureTabHierarchyState(data) {
  if (!isObjectLike(data.tabChildrenByParent)) data.tabChildrenByParent = {};
  if (!Array.isArray(data.tabChildrenByParent[ROOT_KEY])) data.tabChildrenByParent[ROOT_KEY] = [];
  Object.keys(data.tabsById || {}).forEach((tabId) => {
    const tab = data.tabsById[tabId];
    if (!tab) return;
    if (tab.parentTabId && !data.tabsById[tab.parentTabId]) tab.parentTabId = null;
    const key = parentKey(tab.parentTabId);
    if (!Array.isArray(data.tabChildrenByParent[key])) data.tabChildrenByParent[key] = [];
    if (!data.tabChildrenByParent[key].includes(tabId)) data.tabChildrenByParent[key].push(tabId);
  });
  rebuildTabOrderFromData(data);
}

function applyTabOrderToHierarchy(data, desiredOrderLike) {
  ensureTabHierarchyState(data);
  const desiredOrder = ensureUniqueIds(desiredOrderLike).filter((id) => !!data.tabsById?.[id]);
  if (desiredOrder.length === 0) return;
  const rank = new Map(desiredOrder.map((id, index) => [id, index]));
  Object.keys(data.tabChildrenByParent || {}).forEach((key) => {
    const list = ensureUniqueIds(data.tabChildrenByParent[key]).filter((id) => !!data.tabsById?.[id]);
    list.sort((a, b) => {
      const ra = rank.has(a) ? rank.get(a) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b) ? rank.get(b) : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return String(a).localeCompare(String(b));
    });
    data.tabChildrenByParent[key] = list;
  });
  rebuildTabOrderFromData(data);
}

function getChildParadigmIdsFromData(data, parentParadigmId = null) {
  const key = paradigmTreeKey(parentParadigmId);
  return ensureUniqueIds(data.childParadigmIdsByParent?.[key] || []).filter((id) => !!data.paradigmsById?.[id]);
}

function getChildParadigmCategoryIdsFromData(data, parentCategoryId = null) {
  const key = paradigmCategoryTreeKey(parentCategoryId);
  return ensureUniqueIds(data.childParadigmCategoryIdsByParent?.[key] || []).filter((id) => !!data.paradigmCategoriesById?.[id]);
}

function getChildParadigmTagIdsFromData(data, parentTagId = null) {
  return Object.values(data.paradigmTagsById || {})
    .filter((tag) => !!tag && (tag.parentTagId || null) === (parentTagId || null))
    .map((tag) => tag.id);
}

function normalizeParadigmTagOrdersInData(data) {
  const groups = new Map();
  Object.keys(data.paradigmTagsById || {}).forEach((tagId) => {
    const parentId = data.paradigmTagsById?.[tagId]?.parentTagId || ROOT_KEY;
    if (!groups.has(parentId)) groups.set(parentId, []);
    groups.get(parentId).push(tagId);
  });
  groups.forEach((tagIds) => {
    tagIds.sort((a, b) => {
      const tagA = data.paradigmTagsById?.[a];
      const tagB = data.paradigmTagsById?.[b];
      const orderA = Number.isFinite(tagA?.order) ? tagA.order : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(tagB?.order) ? tagB.order : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return sanitizeText(tagA?.label, a).localeCompare(sanitizeText(tagB?.label, b), "zh");
    });
    tagIds.forEach((tagId, index) => {
      if (data.paradigmTagsById?.[tagId]) data.paradigmTagsById[tagId].order = index;
    });
  });
}

function ensureParadigmTagState(data) {
  if (!isObjectLike(data.paradigmTagsById)) data.paradigmTagsById = {};
  const normalizedTagsById = {};
  Object.keys(data.paradigmTagsById || {}).forEach((rawId) => {
    const id = sanitizeText(rawId, "");
    if (!id) return;
    const tag = isObjectLike(data.paradigmTagsById[rawId]) ? data.paradigmTagsById[rawId] : {};
    const parentTagIdRaw = sanitizeText(tag.parentTagId, "") || null;
    normalizedTagsById[id] = {
      id,
      label: sanitizeText(tag.label, id),
      color: normalizeTabAccentColor(tag.color) || getDefaultParadigmTagColor(sanitizeText(tag.label, id) || id),
      parentTagId: parentTagIdRaw,
      order: Number.isFinite(tag.order) ? Number(tag.order) : Number.MAX_SAFE_INTEGER,
      createdAt: sanitizeText(tag.createdAt, nowString()),
      updatedAt: sanitizeText(tag.updatedAt, nowString()),
    };
  });
  data.paradigmTagsById = normalizedTagsById;
  Object.keys(data.paradigmTagsById || {}).forEach((tagId) => {
    const tag = data.paradigmTagsById[tagId];
    if (!tag) return;
    if (tag.parentTagId && !data.paradigmTagsById?.[tag.parentTagId]) tag.parentTagId = null;
    if (tag.parentTagId === tag.id) tag.parentTagId = null;
  });
  normalizeParadigmTagOrdersInData(data);
  Object.values(data.paradigmsById || {}).forEach((paradigm) => {
    if (!paradigm) return;
    paradigm.tagIds = normalizeParadigmTagIds(paradigm.tagIds, data.paradigmTagsById || {});
  });
}

function wouldCreateParadigmTagCycleInData(data, draggedTagId, nextParentTagId) {
  let cursor = sanitizeText(nextParentTagId, "") || null;
  const seen = new Set([sanitizeText(draggedTagId, "")]);
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = sanitizeText(data.paradigmTagsById?.[cursor]?.parentTagId, "") || null;
  }
  return false;
}

function getParadigmCategoryDescendantIdsFromData(data, categoryId) {
  const out = [];
  const seen = new Set();
  const stack = getChildParadigmCategoryIdsFromData(data, categoryId);
  while (stack.length > 0) {
    const current = sanitizeText(stack.pop(), "");
    if (!current || seen.has(current) || !data.paradigmCategoriesById?.[current]) continue;
    seen.add(current);
    out.push(current);
    getChildParadigmCategoryIdsFromData(data, current).slice().reverse().forEach((childId) => stack.push(childId));
  }
  return out;
}

function isParadigmCopyInData(data, paradigmId) {
  return !!sanitizeText(data.paradigmsById?.[paradigmId]?.sourceParadigmId, "");
}

function getParadigmSourceIdInData(data, paradigmId) {
  const paradigm = data.paradigmsById?.[paradigmId];
  if (!paradigm) return "";
  return sanitizeText(paradigm.sourceParadigmId, "") || sanitizeText(paradigm.id, "");
}

function getEffectiveChildParadigmIdsFromData(data, paradigmId) {
  const paradigm = data.paradigmsById?.[paradigmId];
  if (!paradigm) return [];
  return getChildParadigmIdsFromData(data, paradigm.id);
}

function getParadigmDescendantIdsFromData(data, paradigmId) {
  const out = [];
  const seen = new Set();
  const stack = getEffectiveChildParadigmIdsFromData(data, paradigmId);
  while (stack.length > 0) {
    const current = sanitizeText(stack.pop(), "");
    if (!current || seen.has(current) || !data.paradigmsById?.[current]) continue;
    seen.add(current);
    out.push(current);
    getEffectiveChildParadigmIdsFromData(data, current).slice().reverse().forEach((childId) => stack.push(childId));
  }
  return out;
}

function ensureParadigmHierarchyState(data) {
  if (!isObjectLike(data.paradigmsById)) data.paradigmsById = {};
  if (!isObjectLike(data.childParadigmIdsByParent)) data.childParadigmIdsByParent = {};
  if (!Array.isArray(data.childParadigmIdsByParent[ROOT_KEY])) data.childParadigmIdsByParent[ROOT_KEY] = [];
  Object.keys(data.paradigmsById || {}).forEach((paradigmId) => {
    const paradigm = data.paradigmsById[paradigmId];
    if (!paradigm) return;
    if (paradigm.parentParadigmId && !data.paradigmsById[paradigm.parentParadigmId]) paradigm.parentParadigmId = null;
    const key = paradigmTreeKey(paradigm.parentParadigmId);
    if (!Array.isArray(data.childParadigmIdsByParent[key])) data.childParadigmIdsByParent[key] = [];
    if (!data.childParadigmIdsByParent[key].includes(paradigmId)) data.childParadigmIdsByParent[key].push(paradigmId);
  });
}

function ensureParadigmCategoryHierarchyState(data) {
  if (!isObjectLike(data.paradigmCategoriesById)) data.paradigmCategoriesById = {};
  if (!isObjectLike(data.childParadigmCategoryIdsByParent)) data.childParadigmCategoryIdsByParent = {};
  if (!Array.isArray(data.childParadigmCategoryIdsByParent[ROOT_KEY])) data.childParadigmCategoryIdsByParent[ROOT_KEY] = [];
  Object.keys(data.paradigmCategoriesById || {}).forEach((categoryId) => {
    const category = data.paradigmCategoriesById[categoryId];
    if (!category) return;
    if (category.parentCategoryId && !data.paradigmCategoriesById[category.parentCategoryId]) category.parentCategoryId = null;
    const key = paradigmCategoryTreeKey(category.parentCategoryId);
    if (!Array.isArray(data.childParadigmCategoryIdsByParent[key])) data.childParadigmCategoryIdsByParent[key] = [];
    if (!data.childParadigmCategoryIdsByParent[key].includes(categoryId)) data.childParadigmCategoryIdsByParent[key].push(categoryId);
  });
  Object.values(data.paradigmsById || {}).forEach((paradigm) => {
    if (!paradigm) return;
    const categoryId = sanitizeText(paradigm.categoryId, "") || null;
    paradigm.categoryId = categoryId && data.paradigmCategoriesById?.[categoryId] ? categoryId : null;
  });
  ensureParadigmTagState(data);
}

function wouldCreateParadigmTreeCycleInData(data, draggedParadigmId, nextParentParadigmId) {
  let cursor = nextParentParadigmId;
  const seen = new Set([draggedParadigmId]);
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = data.paradigmsById?.[cursor]?.parentParadigmId || null;
  }
  return false;
}

function assignParadigmCategoryInData(data, paradigmId, nextCategoryId = null, options = {}) {
  const normalizedCategoryId = nextCategoryId && data.paradigmCategoriesById?.[nextCategoryId] ? nextCategoryId : null;
  const paradigm = data.paradigmsById?.[paradigmId];
  if (!paradigm) return;
  ensureParadigmHierarchyState(data);
  ensureParadigmCategoryHierarchyState(data);
  const subtreeIds = [paradigmId].concat(getParadigmDescendantIdsFromData(data, paradigmId));
  const now = nowString();
  if (options.detachFromParent || (paradigm.parentParadigmId && (data.paradigmsById?.[paradigm.parentParadigmId]?.categoryId || null) !== normalizedCategoryId)) {
    removeIdFromSimpleChildrenMap(data.childParadigmIdsByParent, paradigmId);
    paradigm.parentParadigmId = null;
    if (!Array.isArray(data.childParadigmIdsByParent[ROOT_KEY])) data.childParadigmIdsByParent[ROOT_KEY] = [];
    if (!data.childParadigmIdsByParent[ROOT_KEY].includes(paradigmId)) data.childParadigmIdsByParent[ROOT_KEY].push(paradigmId);
  }
  subtreeIds.forEach((id) => {
    const node = data.paradigmsById?.[id];
    if (!node) return;
    node.categoryId = normalizedCategoryId;
    node.updatedAt = now;
  });
}

function getPanelRowDropPosition(rowEl, event) {
  const rect = rowEl.getBoundingClientRect();
  const childThreshold = 56;
  return (event.clientX - rect.left) > childThreshold
    ? "child"
    : ((event.clientY - rect.top) < rect.height / 2 ? "before" : "after");
}

function getParadigmTocDropPosition(element, event) {
  const rect = element.getBoundingClientRect();
  return (event.clientY - rect.top) < rect.height / 2 ? "before" : "after";
}

function getParadigmCategoryTocDropPosition(element, event) {
  const rect = element.getBoundingClientRect();
  const ratioX = (event.clientX - rect.left) / Math.max(rect.width, 1);
  if (ratioX > 0.72) return "child";
  return (event.clientY - rect.top) < rect.height / 2 ? "before" : "after";
}

function wouldCreateParadigmCategoryCycleInData(data, draggedCategoryId, nextParentCategoryId) {
  let cursor = sanitizeText(nextParentCategoryId, "") || null;
  const seen = new Set([sanitizeText(draggedCategoryId, "")]);
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = sanitizeText(data.paradigmCategoriesById?.[cursor]?.parentCategoryId, "") || null;
  }
  return false;
}

function materializeInheritedParadigmBindingsInData(data, tabId = null) {
  ensureParadigmHierarchyState(data);
  const targetTabIds = tabId ? [sanitizeText(tabId, "")] : Object.keys(data.tabsById || {});
  targetTabIds.forEach((currentTabId) => {
    if (!currentTabId || !data.tabsById?.[currentTabId]) return;
    const tab = data.tabsById[currentTabId];
    const beforeIds = normalizeBoundParadigmIds(tab).filter((paradigmId) => !!data.paradigmsById?.[paradigmId]);
    const explicitSet = new Set(beforeIds);
    const nextIds = beforeIds.filter((paradigmId) => {
      let cursor = data.paradigmsById?.[paradigmId]?.parentParadigmId || null;
      while (cursor) {
        if (explicitSet.has(cursor)) return false;
        cursor = data.paradigmsById?.[cursor]?.parentParadigmId || null;
      }
      return true;
    });
    setTabBoundParadigmIds(tab, nextIds);
  });
}

function removeIdFromChildrenMap(childrenMap, id, onlyTabId = null) {
  Object.keys(childrenMap || {}).forEach((scopedKey) => {
    if (onlyTabId) {
      const parsed = splitScopedKey(scopedKey);
      if (parsed.ownerId !== onlyTabId) return;
    }
    const list = Array.isArray(childrenMap[scopedKey]) ? childrenMap[scopedKey] : [];
    childrenMap[scopedKey] = list.filter((x) => x !== id);
  });
}

function getDirectChildIdsFromData(data, parentId, tabId) {
  return ensureUniqueIds(data.childrenByParentByTab?.[tabParentKey(tabId, parentId)] || [])
    .filter((id) => !!data.itemsById?.[id] && data.itemsById[id].tabId === tabId);
}

function ensureLocalItemInserted(data, tabId, parentId, itemId) {
  const scoped = tabParentKey(tabId, parentId);
  if (!isObjectLike(data.childrenByParentByTab)) data.childrenByParentByTab = {};
  if (!Array.isArray(data.childrenByParentByTab[scoped])) data.childrenByParentByTab[scoped] = [];
  const siblings = data.childrenByParentByTab[scoped];
  if (siblings.includes(itemId)) return;
  const insertAt = siblings.findIndex((siblingId) => data.itemsById?.[siblingId]?.sourceType === "paradigm");
  if (insertAt < 0) siblings.push(itemId);
  else siblings.splice(insertAt, 0, itemId);
}

function ensureParadigmTransferLogRootInData(data, tabId) {
  const existing = getDirectChildIdsFromData(data, null, tabId)
    .map((id) => data.itemsById?.[id])
    .find((item) => !!item && item.sourceType === "tab" && item.title === PARADIGM_TRANSFER_LOG_TITLE);
  if (existing) return existing.id;
  const id = createId("item");
  data.itemsById[id] = {
    id,
    title: PARADIGM_TRANSFER_LOG_TITLE,
    parentId: null,
    tabId,
    sourceType: "tab",
    sourceParadigmId: null,
    sourceParadigmItemId: null,
    sourceParadigmBindingRootId: null,
    sourceParadigmMountScopeId: null,
    sourceParadigmCopyRefId: null,
    sourceParadigmMountMode: "direct",
    isCollapsed: true,
    imageRef: "",
    shortcuts: [],
    comment: "自动记录每次“共通范式迁入”的执行结果。",
    noteBinding: null,
    orphaned: false,
    createdAt: nowString(),
    updatedAt: nowString(),
  };
  ensureLocalItemInserted(data, tabId, null, id);
  return id;
}

function getChildTabIdsFromData(data, parentTabId = null) {
  const key = parentKey(parentTabId);
  return ensureUniqueIds(data.tabChildrenByParent?.[key] || [])
    .filter((id) => !!data.tabsById?.[id]);
}

function getTabDescendantIdsFromData(data, tabId) {
  const normalized = sanitizeText(tabId, "");
  if (!normalized || !data.tabsById?.[normalized]) return [];
  const out = [];
  const seen = new Set();
  const stack = getChildTabIdsFromData(data, normalized).slice().reverse();
  while (stack.length > 0) {
    const current = sanitizeText(stack.pop(), "");
    if (!current || seen.has(current) || !data.tabsById?.[current]) continue;
    seen.add(current);
    out.push(current);
    getChildTabIdsFromData(data, current).slice().reverse().forEach((childId) => stack.push(childId));
  }
  return out;
}

function convertBoundParadigmItemsToLocal(data, tabId, paradigmId = null) {
  Object.values(data.itemsById || {}).forEach((item) => {
    if (!item || item.tabId !== tabId) return;
    if (item.sourceType === "paradigm" && (!paradigmId || item.sourceParadigmMountScopeId === paradigmId)) {
      item.sourceType = "tab";
      item.sourceParadigmId = null;
      item.sourceParadigmItemId = null;
      item.sourceParadigmBindingRootId = null;
      item.sourceParadigmMountScopeId = null;
      item.sourceParadigmCopyRefId = null;
      item.sourceParadigmMountMode = "direct";
      item.orphaned = true;
      item.updatedAt = nowString();
    }
  });
  Object.keys(data.paradigmToTabItemMapByTab || {}).forEach((scoped) => {
    const parsed = parseParadigmMountMapKey(scoped);
    if (parsed.tabId !== tabId) return;
    if (paradigmId && parsed.mountScopeId !== paradigmId) return;
    delete data.paradigmToTabItemMapByTab[scoped];
  });
}

function collectMountedSourceParadigmMapForTab(data, tabId) {
  const rootMapInfo = collectBoundParadigmRootMapForTab(data, tabId);
  const mountBySourceParadigmId = new Map();
  const ambiguousBySourceParadigmId = new Map();
  Array.from(rootMapInfo.rootMap.keys()).forEach((mountNodeId) => {
    const sourceParadigmId = getParadigmSourceIdInData(data, mountNodeId);
    if (!sourceParadigmId) return;
    if (!mountBySourceParadigmId.has(sourceParadigmId)) {
      mountBySourceParadigmId.set(sourceParadigmId, mountNodeId);
      return;
    }
    const current = mountBySourceParadigmId.get(sourceParadigmId);
    if (current === mountNodeId) return;
    const list = ambiguousBySourceParadigmId.get(sourceParadigmId) || [current];
    if (!list.includes(mountNodeId)) list.push(mountNodeId);
    ambiguousBySourceParadigmId.set(sourceParadigmId, list);
  });
  return {
    rootMapInfo,
    mountBySourceParadigmId,
    ambiguousBySourceParadigmId,
  };
}

function collectBoundParadigmRootMapForTab(data, tabId) {
  const tab = data.tabsById?.[tabId];
  if (!tab) return { explicitBoundIds: [], rootMap: new Map() };
  ensureParadigmHierarchyState(data);
  const explicitBoundIds = normalizeBoundParadigmIds(tab).filter((paradigmId) => !!data.paradigmsById?.[paradigmId]);
  const explicitSet = new Set(explicitBoundIds);
  const includedIds = new Set();
  explicitBoundIds.forEach((paradigmId) => {
    includedIds.add(paradigmId);
    getParadigmDescendantIdsFromData(data, paradigmId).forEach((childId) => includedIds.add(childId));
  });
  const rootMap = new Map();
  includedIds.forEach((paradigmId) => {
    let cursor = paradigmId;
    while (cursor) {
      if (explicitSet.has(cursor)) {
        rootMap.set(paradigmId, cursor);
        break;
      }
      cursor = data.paradigmsById?.[cursor]?.parentParadigmId || null;
    }
  });
  return { explicitBoundIds, rootMap };
}

function getOrderedParadigmMountRootIdsForTabData(data, tabId) {
  const rootMapInfo = collectBoundParadigmRootMapForTab(data, tabId);
  const includedParadigmIds = Array.from(rootMapInfo.rootMap.keys());
  const includedParadigmIdSet = new Set(includedParadigmIds);
  const rootParadigmIds = rootMapInfo.explicitBoundIds.filter((paradigmId) => {
    const parentId = data.paradigmsById?.[paradigmId]?.parentParadigmId || null;
    return !parentId || !includedParadigmIdSet.has(parentId);
  });
  includedParadigmIds.forEach((paradigmId) => {
    const parentId = data.paradigmsById?.[paradigmId]?.parentParadigmId || null;
    const isRoot = !parentId || !includedParadigmIdSet.has(parentId);
    if (isRoot && !rootParadigmIds.includes(paradigmId)) rootParadigmIds.push(paradigmId);
  });
  return { rootMapInfo, includedParadigmIds, includedParadigmIdSet, rootParadigmIds };
}

function syncParadigmToTabInData(data, tabId) {
  if (!data.tabsById?.[tabId]) return;
  if (!isObjectLike(data.paradigmToTabItemMapByTab)) data.paradigmToTabItemMapByTab = {};
  if (!isObjectLike(data.childrenByParentByTab)) data.childrenByParentByTab = {};
  materializeInheritedParadigmBindingsInData(data, tabId);
  const map = data.paradigmToTabItemMapByTab;
  const now = nowString();
  const { explicitBoundIds, rootMap } = collectBoundParadigmRootMapForTab(data, tabId);
  const mountedEntries = [];

  Array.from(rootMap.keys()).forEach((mountNodeId) => {
    const sourceParadigmId = getParadigmSourceIdInData(data, mountNodeId);
    if (!sourceParadigmId) return;
    Object.values(data.paradigmItemsById || {}).forEach((pgItem) => {
      if (!pgItem || pgItem.paradigmId !== sourceParadigmId) return;
      mountedEntries.push({
        mountNodeId,
        sourceParadigmId,
        pgItem,
        bindingRootParadigmId: rootMap.get(mountNodeId) || mountNodeId,
        mountMode: (rootMap.get(mountNodeId) || mountNodeId) === mountNodeId ? "direct" : "inherited",
        isCopyScope: isParadigmCopyInData(data, mountNodeId),
      });
    });
  });

  const validMountKeys = new Set(mountedEntries.map((entry) => makeParadigmMountMapKey(tabId, entry.mountNodeId, entry.pgItem.id)));

  Object.values(data.itemsById || {}).forEach((item) => {
    if (!item || item.tabId !== tabId || item.sourceType !== "paradigm") return;
    const mapKey = item.sourceParadigmItemId
      ? makeParadigmMountMapKey(tabId, item.sourceParadigmMountScopeId || item.sourceParadigmId || "", item.sourceParadigmItemId)
      : "";
    if (!item.sourceParadigmItemId || !validMountKeys.has(mapKey)) {
      item.sourceType = "tab";
      item.sourceParadigmId = null;
      item.sourceParadigmItemId = null;
      item.sourceParadigmBindingRootId = null;
      item.sourceParadigmMountScopeId = null;
      item.sourceParadigmCopyRefId = null;
      item.sourceParadigmMountMode = "direct";
      item.orphaned = true;
      item.updatedAt = now;
    }
  });

  Object.keys(map).forEach((scoped) => {
    const parsed = parseParadigmMountMapKey(scoped);
    if (parsed.tabId !== tabId) return;
    const canonical = makeParadigmMountMapKey(parsed.tabId, parsed.mountScopeId || "", parsed.paradigmItemId || "");
    if (!validMountKeys.has(canonical)) delete map[scoped];
  });

  mountedEntries.forEach((entry) => {
    const scoped = makeParadigmMountMapKey(tabId, entry.mountNodeId, entry.pgItem.id);
    let itemId = map[scoped];
    let mounted = itemId ? data.itemsById[itemId] : null;
    const bindingRootParadigmId = entry.bindingRootParadigmId;
    if (!mounted || mounted.tabId !== tabId) {
      itemId = createId("pgMount");
      while (data.itemsById[itemId]) itemId = createId("pgMount");
      mounted = {
        id: itemId,
        title: entry.pgItem.title,
        parentId: null,
        tabId,
        sourceType: "paradigm",
        sourceParadigmId: entry.sourceParadigmId,
        sourceParadigmItemId: entry.pgItem.id,
        sourceParadigmBindingRootId: bindingRootParadigmId,
        sourceParadigmMountScopeId: entry.mountNodeId,
        sourceParadigmCopyRefId: entry.isCopyScope ? entry.mountNodeId : null,
        sourceParadigmMountMode: entry.mountMode,
        isCollapsed: false,
        imageRef: sanitizeText(entry.pgItem.imageRef, ""),
        shortcuts: Array.isArray(entry.pgItem.shortcuts) ? deepClone(entry.pgItem.shortcuts, []) : [],
        comment: typeof entry.pgItem.comment === "string" ? entry.pgItem.comment : "",
        noteBinding: deepClone(entry.pgItem.noteBinding, null),
        orphaned: false,
        createdAt: now,
        updatedAt: now,
      };
      data.itemsById[itemId] = mounted;
      map[scoped] = itemId;
    } else {
      let changed = false;
      const nextImageRef = sanitizeText(entry.pgItem.imageRef, "");
      const nextShortcuts = Array.isArray(entry.pgItem.shortcuts) ? deepClone(entry.pgItem.shortcuts, []) : [];
      const nextComment = typeof entry.pgItem.comment === "string" ? entry.pgItem.comment : "";
      const nextNoteBinding = deepClone(entry.pgItem.noteBinding, null);
      const assign = (key, value) => {
        if (JSON.stringify(mounted[key]) === JSON.stringify(value)) return;
        mounted[key] = value;
        changed = true;
      };
      assign("title", entry.pgItem.title);
      assign("tabId", tabId);
      assign("sourceType", "paradigm");
      assign("sourceParadigmId", entry.sourceParadigmId);
      assign("sourceParadigmItemId", entry.pgItem.id);
      assign("sourceParadigmBindingRootId", bindingRootParadigmId);
      assign("sourceParadigmMountScopeId", entry.mountNodeId);
      assign("sourceParadigmCopyRefId", entry.isCopyScope ? entry.mountNodeId : null);
      assign("sourceParadigmMountMode", entry.mountMode);
      assign("imageRef", nextImageRef);
      assign("shortcuts", nextShortcuts);
      assign("comment", nextComment);
      assign("noteBinding", nextNoteBinding);
      assign("orphaned", false);
      if (changed) mounted.updatedAt = now;
    }
  });

  const validInstanceIds = new Set();
  mountedEntries.forEach((entry) => {
    const itemId = map[makeParadigmMountMapKey(tabId, entry.mountNodeId, entry.pgItem.id)];
    if (itemId && data.itemsById[itemId]) validInstanceIds.add(itemId);
  });

  validInstanceIds.forEach((id) => removeIdFromChildrenMap(data.childrenByParentByTab, id, tabId));

  const desiredByParent = new Map();
  const pushDesired = (parentTabItemId, childTabItemId) => {
    const key = parentTabItemId || null;
    if (!desiredByParent.has(key)) desiredByParent.set(key, []);
    desiredByParent.get(key).push(childTabItemId);
  };

  const placeParadigmItemBranch = (mountNodeId, sourceParadigmId, pgItemId, parentTabItemId = null) => {
    const tabItemId = map[makeParadigmMountMapKey(tabId, mountNodeId, pgItemId)];
    if (!tabItemId || !data.itemsById[tabItemId]) return;
    data.itemsById[tabItemId].parentId = parentTabItemId;
    pushDesired(parentTabItemId, tabItemId);
    const childPgItems = (data.paradigmChildrenByParent?.[paradigmParentKey(sourceParadigmId, pgItemId)] || []).slice();
    childPgItems.forEach((childPgItemId) => placeParadigmItemBranch(mountNodeId, sourceParadigmId, childPgItemId, tabItemId));
  };

  const placedParadigms = new Set();
  const placeParadigmScope = (mountNodeId) => {
    if (!rootMap.has(mountNodeId) || placedParadigms.has(mountNodeId)) return;
    placedParadigms.add(mountNodeId);
    const sourceParadigmId = getParadigmSourceIdInData(data, mountNodeId);
    const rootPgItems = (data.paradigmChildrenByParent?.[paradigmParentKey(sourceParadigmId, null)] || []).slice();
    rootPgItems.forEach((pgItemId) => placeParadigmItemBranch(mountNodeId, sourceParadigmId, pgItemId, null));
    getEffectiveChildParadigmIdsFromData(data, mountNodeId).forEach((childParadigmId) => {
      if (rootMap.has(childParadigmId)) placeParadigmScope(childParadigmId);
    });
  };
  explicitBoundIds.forEach((paradigmId) => placeParadigmScope(paradigmId));

  desiredByParent.forEach((desiredIds, parentTabItemId) => {
    const scoped = tabParentKey(tabId, parentTabItemId);
    const existing = Array.isArray(data.childrenByParentByTab[scoped]) ? data.childrenByParentByTab[scoped] : [];
    const withoutParadigm = existing.filter((id) => !validInstanceIds.has(id));
    const parentTabItem = parentTabItemId ? data.itemsById?.[parentTabItemId] : null;
    const mergedOrder = parentTabItem && parentTabItem.sourceType === "paradigm"
      ? [].concat(withoutParadigm, desiredIds)
      : [].concat(desiredIds, withoutParadigm);
    data.childrenByParentByTab[scoped] = ensureUniqueIds(mergedOrder);
  });

  const rootKey = tabParentKey(tabId, null);
  if (!Array.isArray(data.childrenByParentByTab[rootKey])) data.childrenByParentByTab[rootKey] = [];
}

function syncParadigmAcrossTabsInData(data) {
  Object.values(data.tabsById || {}).forEach((tab) => {
    syncParadigmToTabInData(data, tab.id);
  });
}

function defaultWorkspaceData() {
  const timestamp = nowString();
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    lastModified: timestamp,
    activeTabId: DEFAULT_TAB_ID,
    tabsById: {
      [DEFAULT_TAB_ID]: {
        id: DEFAULT_TAB_ID,
        name: "默认工作区",
        emoji: "",
        accentColor: "",
        kind: "project",
        parentTabId: null,
        boundParadigmIds: [],
        boundParadigmItemKeys: [],
        boundParadigmId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
    tabOrder: [DEFAULT_TAB_ID],
    tabChildrenByParent: { [ROOT_KEY]: [DEFAULT_TAB_ID] },
    itemsById: {},
    childrenByParentByTab: {},
    paradigmsById: {},
    childParadigmIdsByParent: { [ROOT_KEY]: [] },
    paradigmCopiesById: {},
    childParadigmCopyIdsByParent: { [ROOT_KEY]: [] },
    paradigmCategoriesById: {},
    childParadigmCategoryIdsByParent: { [ROOT_KEY]: [] },
    paradigmTagsById: {},
    paradigmItemsById: {},
    paradigmChildrenByParent: {},
    paradigmToTabItemMapByTab: {},
    collapsedById: {},
    tabTreeCollapsedById: {},
    pinnedScrollByViewKey: {},
    paradigmTreeCollapsedById: {},
    paradigmEditorScopeCollapsedById: {},
    paradigmCategoryCollapsedById: {},
    paradigmMountGroupCollapsedByKey: {},
    paradigmMountCollectionCollapsedByTab: {},
    snapshotsById: {},
    snapshotOrderByTab: {},
  };
}

function normalizeWorkspaceData(raw) {
  const base = defaultWorkspaceData();
  const src = isObjectLike(raw) ? deepClone(raw, {}) : {};
  const data = Object.assign({}, src);
  data.schemaVersion = sanitizeText(src.schemaVersion, base.schemaVersion);
  data.lastModified = sanitizeText(src.lastModified, base.lastModified);
  data.itemsById = isObjectLike(src.itemsById) ? src.itemsById : {};
  data.childrenByParentByTab = isObjectLike(src.childrenByParentByTab) ? src.childrenByParentByTab : {};
  data.paradigmsById = isObjectLike(src.paradigmsById) ? src.paradigmsById : {};
  data.childParadigmIdsByParent = isObjectLike(src.childParadigmIdsByParent) ? src.childParadigmIdsByParent : {};
  data.paradigmCopiesById = isObjectLike(src.paradigmCopiesById) ? src.paradigmCopiesById : {};
  data.childParadigmCopyIdsByParent = isObjectLike(src.childParadigmCopyIdsByParent) ? src.childParadigmCopyIdsByParent : {};
  data.paradigmCategoriesById = isObjectLike(src.paradigmCategoriesById) ? src.paradigmCategoriesById : {};
  data.childParadigmCategoryIdsByParent = isObjectLike(src.childParadigmCategoryIdsByParent) ? src.childParadigmCategoryIdsByParent : {};
  data.paradigmTagsById = isObjectLike(src.paradigmTagsById) ? src.paradigmTagsById : {};
  data.paradigmItemsById = isObjectLike(src.paradigmItemsById) ? src.paradigmItemsById : {};
  data.paradigmChildrenByParent = isObjectLike(src.paradigmChildrenByParent) ? src.paradigmChildrenByParent : {};
  data.paradigmToTabItemMapByTab = isObjectLike(src.paradigmToTabItemMapByTab) ? src.paradigmToTabItemMapByTab : {};
  data.collapsedById = isObjectLike(src.collapsedById) ? src.collapsedById : {};
  data.tabTreeCollapsedById = isObjectLike(src.tabTreeCollapsedById) ? src.tabTreeCollapsedById : {};
  data.pinnedScrollByViewKey = isObjectLike(src.pinnedScrollByViewKey) ? src.pinnedScrollByViewKey : {};
  data.paradigmTreeCollapsedById = isObjectLike(src.paradigmTreeCollapsedById) ? src.paradigmTreeCollapsedById : {};
  data.paradigmEditorScopeCollapsedById = isObjectLike(src.paradigmEditorScopeCollapsedById) ? src.paradigmEditorScopeCollapsedById : {};
  data.paradigmCategoryCollapsedById = isObjectLike(src.paradigmCategoryCollapsedById) ? src.paradigmCategoryCollapsedById : {};
  data.paradigmMountGroupCollapsedByKey = isObjectLike(src.paradigmMountGroupCollapsedByKey) ? src.paradigmMountGroupCollapsedByKey : {};
  data.paradigmMountCollectionCollapsedByTab = isObjectLike(src.paradigmMountCollectionCollapsedByTab) ? src.paradigmMountCollectionCollapsedByTab : {};
  data.snapshotsById = isObjectLike(src.snapshotsById) ? src.snapshotsById : {};
  data.snapshotOrderByTab = isObjectLike(src.snapshotOrderByTab) ? src.snapshotOrderByTab : {};
  data.tabChildrenByParent = isObjectLike(src.tabChildrenByParent) ? src.tabChildrenByParent : {};
  data.tabsById = {};

  if (isObjectLike(src.tabsById)) {
    Object.keys(src.tabsById).forEach((rawId) => {
      const id = sanitizeText(rawId, "");
      if (!id) return;
      const tab = isObjectLike(src.tabsById[rawId]) ? src.tabsById[rawId] : {};
      data.tabsById[id] = Object.assign({}, tab, {
        id,
        name: sanitizeText(tab.name, `Tab-${id.slice(-4)}`),
        parentTabId: sanitizeText(tab.parentTabId, "") || null,
        boundParadigmIds: normalizeBoundParadigmIds(tab),
        boundParadigmItemKeys: normalizeBoundParadigmItemKeys(tab),
        boundParadigmId: normalizeBoundParadigmIds(tab)[0] || null,
        createdAt: sanitizeText(tab.createdAt, nowString()),
        updatedAt: sanitizeText(tab.updatedAt, nowString()),
      });
    });
  }

  if (Object.keys(data.tabsById).length === 0) {
    data.tabsById = deepClone(base.tabsById, {});
  }

  Object.keys(data.itemsById || {}).forEach((itemId) => {
    const item = data.itemsById[itemId];
    if (!isObjectLike(item)) return;
    item.id = sanitizeText(item.id, itemId) || itemId;
    item.title = sanitizeText(item.title || item.content || item.name, item.id);
    item.tabId = sanitizeText(item.tabId, DEFAULT_TAB_ID) || DEFAULT_TAB_ID;
    item.parentId = sanitizeText(item.parentId, "") || null;
    item.sourceType = item.sourceType === "paradigm" ? "paradigm" : "tab";
    item.sourceParadigmId = sanitizeText(item.sourceParadigmId, "") || null;
    item.sourceParadigmItemId = sanitizeText(item.sourceParadigmItemId, "") || null;
    item.sourceParadigmBindingRootId = sanitizeText(item.sourceParadigmBindingRootId, "") || null;
    item.sourceParadigmMountScopeId = sanitizeText(item.sourceParadigmMountScopeId, "") || null;
    item.sourceParadigmCopyRefId = sanitizeText(item.sourceParadigmCopyRefId, "") || null;
    item.sourceParadigmMountMode = item.sourceParadigmMountMode === "inherited" ? "inherited" : "direct";
    item.shortcuts = Array.isArray(item.shortcuts) ? item.shortcuts : [];
    item.noteBinding = item.noteBinding ?? null;
    item.comment = typeof item.comment === "string" ? item.comment : "";
    item.imageRef = sanitizeText(item.imageRef || item.image, "");
    item.isCollapsed = item.isCollapsed === true;
    item.orphaned = item.orphaned === true;
  });

  Object.keys(data.itemsById || {}).forEach((itemId) => {
    const item = data.itemsById[itemId];
    if (!isObjectLike(item)) return;
    const hasItemCollapsed = Object.prototype.hasOwnProperty.call(item, "isCollapsed");
    const collapsedFromMap = Object.prototype.hasOwnProperty.call(data.collapsedById || {}, itemId)
      ? !!data.collapsedById[itemId]
      : false;
    item.isCollapsed = hasItemCollapsed ? !!item.isCollapsed : collapsedFromMap;
  });
  const normalizedCollapsedById = {};
  Object.keys(data.itemsById || {}).forEach((itemId) => {
    normalizedCollapsedById[itemId] = !!data.itemsById[itemId]?.isCollapsed;
  });
  data.collapsedById = normalizedCollapsedById;

  Object.keys(data.tabsById || {}).forEach((tabId) => {
    const tab = data.tabsById[tabId];
    if (!tab) return;
    setTabBoundParadigmIds(tab, normalizeBoundParadigmIds(tab).filter((paradigmId) => !!data.paradigmsById?.[paradigmId]));
    setTabBoundParadigmItemKeys(tab, normalizeBoundParadigmItemKeys(tab));
  });

  ensureTabHierarchyState(data);
  ensureParadigmHierarchyState(data);
  materializeInheritedParadigmBindingsInData(data);
  data.activeTabId = sanitizeText(src.activeTabId, "") || data.tabOrder[0] || DEFAULT_TAB_ID;
  if (!data.tabsById[data.activeTabId]) data.activeTabId = data.tabOrder[0] || DEFAULT_TAB_ID;
  return data;
}

function normalizeVisibleUiState(state = {}) {
  const rawMode = sanitizeText(state?.paradigmTocMode, "");
  return {
    showParadigmPanel: state?.showParadigmPanel === true,
    showSnapshotPanel: state?.showSnapshotPanel === true,
    showTagManager: state?.showTagManager === true,
    paradigmTocCollapsed: state?.paradigmTocCollapsed === true,
    paradigmTocMode: rawMode === "tab"
      ? "tab"
      : (rawMode === "panel" ? "panel" : (rawMode === "paradigm" ? "panel" : "panel")),
    paradigmTagFilters: ensureUniqueIds(Array.isArray(state?.paradigmTagFilters) ? state.paradigmTagFilters : [])
      .map((id) => sanitizeText(id, ""))
      .filter(Boolean),
  };
}

class WorkspaceMountSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Workspace Mount" });

    new Setting(containerEl)
      .setName("Default source note path")
      .setDesc("Path or basename of the original DataviewJS workspace note.")
      .addText((text) => {
        text.setPlaceholder(DEFAULT_SETTINGS.defaultSourceNotePath);
        text.setValue(this.plugin.settings.defaultSourceNotePath);
        text.onChange(async (value) => {
          this.plugin.settings.defaultSourceNotePath = sanitizeText(value, DEFAULT_SETTINGS.defaultSourceNotePath);
          await this.plugin.saveSettings();
        });
      });
  }
}

class WorkspaceMountView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.sourceNotePath = "";
    this.sourceFile = null;
    this.dataPaths = null;
    this.workspaceData = defaultWorkspaceData();
    this.taskNoteBindings = {};
    this.taskComments = {};
    this.visibleUiState = normalizeVisibleUiState({});
    this.lastLoadWarning = "";
    this.draggedTabId = "";
    this.draggedItemId = "";
    this.draggedParadigmId = "";
    this.draggedParadigmTagId = "";
    this.draggedParadigmTocState = null;
    this.activeParadigmEditorId = "";
    this.selectedSnapshotId = "";
    this.expandedParadigmReferenceSourceIds = {};
    this.pendingParadigmFocus = null;
    this.paradigmTocScrollTop = 0;
    this.floatingPinCleanup = null;
    this.shouldRestorePinnedScrollAfterRender = false;
    this.vaultNoteIndexCache = { items: [], builtAt: 0, source: "none", sourcePath: null };
    this.evaNoteAliasMap = new Map();
    this.resolvedNoteFileCache = { builtAt: 0, map: new Map() };
    this.bridge = {
      bridgeName: "workspace-capsule-bridge",
      bridgeVersion: WORKSPACE_CAPSULE_BRIDGE_VERSION,
      scriptVersion: WORKSPACE_SCRIPT_VERSION,
      isReady: () => this.isBoundToRealSource() && !!this.workspaceData?.tabsById,
      getCapabilities: () => [
        "capture-state",
        "apply-state",
        "active-tab",
        "tab-order",
        "collapsed-state",
        "pinned-scroll",
        "rerender",
        "snapshot-metadata",
      ],
      getState: () => this.getBridgeState(),
      applyState: async (state, options = {}) => this.applyBridgeState(state, options),
      getActiveTabId: () => this.getActiveTabId(),
      setActiveTabId: async (tabId, options = {}) => this.setActiveTabId(tabId, {
        ...options,
        restorePinnedScroll: options?.restorePinnedScroll !== false,
      }),
      rerender: async (options = {}) => this.rerenderFromBridge(options),
    };
  }

  getViewType() {
    return VIEW_TYPE_WORKSPACE_MOUNT;
  }

  getDisplayText() {
    return "Workspace Mount";
  }

  getIcon() {
    return "layout-dashboard";
  }

  getState() {
    return {
      sourceNotePath: this.sourceNotePath,
    };
  }

  async setState(state) {
    const nextSource = sanitizeText(state?.sourceNotePath, this.plugin.getDefaultSourceNotePath());
    const changed = nextSource !== this.sourceNotePath;
    this.sourceNotePath = nextSource;
    if (changed || !this.sourceFile) {
      await this.reloadWorkspace();
      return;
    }
    await this.render();
  }

  async onOpen() {
    this.contentEl.addClass("workspace-mount-view");
    const nextState = this.leaf.getViewState()?.state || {};
    await this.setState(nextState);
  }

  async onClose() {
    this.draggedTabId = "";
    if (typeof this.floatingPinCleanup === "function") {
      try { this.floatingPinCleanup(); } catch (_) {}
      this.floatingPinCleanup = null;
    }
    this.contentEl.empty();
  }

  getActiveTabId() {
    return sanitizeText(this.workspaceData?.activeTabId, "") || this.workspaceData?.tabOrder?.[0] || DEFAULT_TAB_ID;
  }

  getScrollPinViewKey(tabId = this.getActiveTabId()) {
    const normalizedTabId = sanitizeText(tabId, "") || DEFAULT_TAB_ID;
    const normalizedPath = sanitizeText(this.sourceFile?.path || this.sourceNotePath, "") || "__current__";
    return `${normalizedPath}::${normalizedTabId}`;
  }

  getPinnedScrollEntry(tabId = this.getActiveTabId()) {
    return this.workspaceData?.pinnedScrollByViewKey?.[this.getScrollPinViewKey(tabId)] || null;
  }

  getActiveTab() {
    return this.workspaceData?.tabsById?.[this.getActiveTabId()] || null;
  }

  getTabById(tabId) {
    const id = sanitizeText(tabId, "");
    return id ? (this.workspaceData?.tabsById?.[id] || null) : null;
  }

  getTabChildrenIds(parentTabId = null) {
    const key = parentKey(parentTabId);
    return ensureUniqueIds(this.workspaceData?.tabChildrenByParent?.[key] || []).filter((id) => !!this.workspaceData?.tabsById?.[id]);
  }

  getTabLineageLabel(tabId) {
    const normalized = sanitizeText(tabId, "");
    if (!normalized || !this.getTabById(normalized)) return "";
    const segments = [];
    const seen = new Set();
    let cursor = normalized;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const tab = this.getTabById(cursor);
      if (!tab) break;
      segments.push(sanitizeText(tab.name, cursor) || cursor);
      cursor = sanitizeText(tab.parentTabId, "") || null;
    }
    return segments.reverse().join(" / ");
  }

  getVisibleTabIds(tabId = this.getActiveTabId()) {
    const normalized = sanitizeText(tabId, "");
    if (!normalized || !this.getTabById(normalized)) return [];
    const out = [];
    const stack = [normalized];
    const seen = new Set();
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || seen.has(current) || !this.getTabById(current)) continue;
      seen.add(current);
      out.push(current);
      this.getTabChildrenIds(current).slice().reverse().forEach((childId) => stack.push(childId));
    }
    return out;
  }

  getWorkspaceTabPickerItems(options = {}) {
    const excludedIds = new Set(ensureUniqueIds(options.excludeIds || []));
    const activeId = sanitizeText(options.activeTabId, this.getActiveTabId());
    const orderedIds = Array.isArray(this.workspaceData?.tabOrder) && this.workspaceData.tabOrder.length > 0
      ? this.workspaceData.tabOrder
      : Object.keys(this.workspaceData?.tabsById || {});
    const duplicateCounts = {};
    orderedIds
      .map((tabId) => this.getTabById(tabId))
      .filter((tab) => !!tab && !excludedIds.has(tab.id))
      .forEach((tab) => {
        const key = sanitizeText(tab.name, "");
        duplicateCounts[key] = (duplicateCounts[key] || 0) + 1;
      });
    return orderedIds
      .map((tabId) => this.getTabById(tabId))
      .filter((tab) => !!tab && !excludedIds.has(tab.id))
      .map((tab) => {
        const boundCount = normalizeBoundParadigmIds(tab).length;
        const childCount = this.getTabChildrenIds(tab.id).length;
        const lineage = this.getTabLineageLabel(tab.id);
        const hasDuplicateName = duplicateCounts[sanitizeText(tab.name, "")] > 1;
        const duplicateHint = hasDuplicateName ? ` · 同名Tab · ${tab.id}` : "";
        return {
          id: tab.id,
          name: `${tab.id === activeId ? "● " : ""}${normalizeTabEmoji(tab.emoji || "") ? `${normalizeTabEmoji(tab.emoji || "")} ` : ""}${tab.name}`,
          meta: `${lineage || tab.id}${duplicateHint} · 已绑定范式 ${boundCount} · 子Tab ${childCount}${tab.id === activeId ? " · 当前Tab" : ""}`,
          search: [
            tab.id,
            tab.name,
            lineage,
            tab.emoji || "",
            tab.kind || "",
            hasDuplicateName ? "同名 duplicate" : "",
            tab.id === activeId ? "当前 tab active current" : "",
          ].join(" "),
        };
      });
  }

  async pickWorkspaceTab(options = {}) {
    const modal = new WorkspaceTabPickerModal(this.app, {
      title: options.title || "选择 Tab",
      description: options.description || "",
      items: this.getWorkspaceTabPickerItems(options),
    });
    return await modal.waitForResult();
  }

  isTabTreeCollapsed(tabId) {
    return this.workspaceData?.tabTreeCollapsedById?.[sanitizeText(tabId, "")] === true;
  }

  async toggleTabTreeCollapsed(tabId) {
    const normalized = sanitizeText(tabId, "");
    if (!normalized) return;
    await this.updateWorkspaceData((data) => {
      if (!isObjectLike(data.tabTreeCollapsedById)) data.tabTreeCollapsedById = {};
      data.tabTreeCollapsedById[normalized] = data.tabTreeCollapsedById[normalized] !== true;
    });
  }

  wouldCreateTabCycle(draggedId, nextParentId) {
    let cursor = nextParentId;
    const seen = new Set([draggedId]);
    while (cursor) {
      if (seen.has(cursor)) return true;
      seen.add(cursor);
      const parent = this.workspaceData?.tabsById?.[cursor]?.parentTabId || null;
      cursor = parent;
    }
    return false;
  }

  removeIdFromSimpleChildrenMap(childrenMap, id) {
    Object.keys(childrenMap || {}).forEach((key) => {
      const list = Array.isArray(childrenMap[key]) ? childrenMap[key] : [];
      childrenMap[key] = list.filter((x) => x !== id);
    });
  }

  removeIdFromScopedChildrenMap(childrenMap, id, onlyTabId = null) {
    Object.keys(childrenMap || {}).forEach((scopedKey) => {
      if (onlyTabId) {
        const parsed = splitScopedKey(scopedKey);
        if (parsed.ownerId !== onlyTabId) return;
      }
      const list = Array.isArray(childrenMap[scopedKey]) ? childrenMap[scopedKey] : [];
      childrenMap[scopedKey] = list.filter((x) => x !== id);
    });
  }

  getItemById(itemId) {
    const id = sanitizeText(itemId, "");
    return id ? (this.workspaceData?.itemsById?.[id] || null) : null;
  }

  getChildrenIds(parentId = null, tabId = this.getActiveTabId()) {
    const scopedKey = tabParentKey(tabId, parentId);
    return ensureUniqueIds(this.workspaceData?.childrenByParentByTab?.[scopedKey] || [])
      .filter((id) => !!this.workspaceData?.itemsById?.[id] && this.workspaceData.itemsById[id].tabId === tabId);
  }

  getDirectItemCount(tabId) {
    return Object.values(this.workspaceData?.itemsById || {}).filter((item) => item?.tabId === tabId).length;
  }

  getParadigmById(paradigmId) {
    const id = sanitizeText(paradigmId, "");
    return id ? (this.workspaceData?.paradigmsById?.[id] || null) : null;
  }

  getParadigmCategoryById(categoryId) {
    const id = sanitizeText(categoryId, "");
    return id ? (this.workspaceData?.paradigmCategoriesById?.[id] || null) : null;
  }

  getParadigmTagById(tagId) {
    const id = sanitizeText(tagId, "");
    return id ? (this.workspaceData?.paradigmTagsById?.[id] || null) : null;
  }

  getChildParadigmTagIds(parentTagId = null) {
    return Object.values(this.workspaceData?.paradigmTagsById || {})
      .filter((tag) => !!tag && (tag.parentTagId || null) === (parentTagId || null))
      .map((tag) => tag.id);
  }

  getSortedParadigmTagChildrenIds(parentTagId = null) {
    return this.getChildParadigmTagIds(parentTagId).sort((a, b) => {
      const tagA = this.getParadigmTagById(a);
      const tagB = this.getParadigmTagById(b);
      const orderA = Number.isFinite(tagA?.order) ? tagA.order : Number.MAX_SAFE_INTEGER;
      const orderB = Number.isFinite(tagB?.order) ? tagB.order : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return sanitizeText(tagA?.label, a).localeCompare(sanitizeText(tagB?.label, b), "zh");
    });
  }

  getParadigmTagDescendantIds(tagId) {
    const out = [];
    const seen = new Set();
    const stack = this.getSortedParadigmTagChildrenIds(tagId);
    while (stack.length > 0) {
      const current = sanitizeText(stack.pop(), "");
      if (!current || seen.has(current) || !this.getParadigmTagById(current)) continue;
      seen.add(current);
      out.push(current);
      this.getSortedParadigmTagChildrenIds(current).slice().reverse().forEach((childId) => stack.push(childId));
    }
    return out;
  }

  getParadigmTagPathLabel(tagOrId) {
    const tag = typeof tagOrId === "string" ? this.getParadigmTagById(tagOrId) : tagOrId;
    if (!tag) return sanitizeText(tagOrId, "");
    const parts = [];
    const seen = new Set();
    let cursor = tag;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      parts.unshift(sanitizeText(cursor.label, cursor.id) || cursor.id);
      cursor = cursor.parentTagId ? this.getParadigmTagById(cursor.parentTagId) : null;
    }
    return parts.join(" / ");
  }

  getParadigmOwnTagIds(paradigmOrId) {
    const paradigm = typeof paradigmOrId === "string" ? this.getParadigmById(paradigmOrId) : paradigmOrId;
    if (!paradigm) return [];
    return normalizeParadigmTagIds(paradigm.tagIds, this.workspaceData?.paradigmTagsById || {});
  }

  getChildParadigmCategoryIds(parentCategoryId = null) {
    return getChildParadigmCategoryIdsFromData(this.workspaceData, parentCategoryId);
  }

  getParadigmCategoryDescendantIds(categoryId) {
    return getParadigmCategoryDescendantIdsFromData(this.workspaceData, categoryId);
  }

  getParadigmCategoryScopeIds(categoryId) {
    const id = sanitizeText(categoryId, "");
    if (!id || !this.getParadigmCategoryById(id)) return [];
    return [id].concat(this.getParadigmCategoryDescendantIds(id));
  }

  getParadigmCategoryPathLabel(categoryId) {
    const labels = [];
    let cursor = this.getParadigmCategoryById(categoryId);
    const seen = new Set();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      labels.unshift(sanitizeText(cursor.name, cursor.id) || cursor.id);
      cursor = cursor.parentCategoryId ? this.getParadigmCategoryById(cursor.parentCategoryId) : null;
    }
    return labels.join(" / ");
  }

  getParadigmCategoryAncestorIds(categoryId) {
    const out = [];
    let cursor = this.getParadigmCategoryById(categoryId)?.parentCategoryId || null;
    const seen = new Set();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (!this.getParadigmCategoryById(cursor)) break;
      out.unshift(cursor);
      cursor = this.getParadigmCategoryById(cursor)?.parentCategoryId || null;
    }
    return out;
  }

  getParadigmTagIds(paradigmOrId) {
    const paradigm = typeof paradigmOrId === "string" ? this.getParadigmById(paradigmOrId) : paradigmOrId;
    if (!paradigm) return [];
    const sourceParadigm = this.getParadigmSourceParadigm(paradigm) || paradigm;
    return normalizeParadigmTagIds(sourceParadigm?.tagIds, this.workspaceData?.paradigmTagsById || {});
  }

  getDirectParadigmTagUsageCount(tagId) {
    return Object.values(this.workspaceData?.paradigmsById || {})
      .filter((paradigm) => !!paradigm && !isParadigmCopyInData(this.workspaceData, paradigm.id))
      .filter((paradigm) => this.getParadigmOwnTagIds(paradigm).includes(tagId))
      .length;
  }

  getParadigmTagFilters() {
    const normalized = normalizeParadigmTagIds(this.visibleUiState?.paradigmTagFilters, this.workspaceData?.paradigmTagsById || {});
    if ((this.visibleUiState?.paradigmTagFilters || []).length !== normalized.length) {
      this.visibleUiState.paradigmTagFilters = normalized.slice();
    }
    return normalized;
  }

  setParadigmTagFilters(filtersLike) {
    this.visibleUiState.paradigmTagFilters = normalizeParadigmTagIds(filtersLike, this.workspaceData?.paradigmTagsById || {});
    return this.visibleUiState.paradigmTagFilters.slice();
  }

  paradigmMatchesTagFilters(paradigmOrId, filterIds = this.getParadigmTagFilters()) {
    const normalizedFilters = normalizeParadigmTagIds(filterIds, this.workspaceData?.paradigmTagsById || {});
    if (normalizedFilters.length === 0) return true;
    const tagSet = new Set(this.getParadigmTagIds(paradigmOrId));
    if (tagSet.size === 0) return false;
    return normalizedFilters.some((filterId) => {
      if (tagSet.has(filterId)) return true;
      return this.getParadigmTagDescendantIds(filterId).some((descId) => tagSet.has(descId));
    });
  }

  createParadigmPanelVisibilityApi(activeFilterIds = this.getParadigmTagFilters()) {
    const normalizedFilters = normalizeParadigmTagIds(activeFilterIds, this.workspaceData?.paradigmTagsById || {});
    const directMemo = new Map();
    const descendantMemo = new Map();
    const ancestorMemo = new Map();
    const visibleMemo = new Map();
    const categoryMemo = new Map();
    const directMatch = (paradigmId) => {
      const normalizedId = sanitizeText(paradigmId, "");
      if (!normalizedId || !this.getParadigmById(normalizedId)) return false;
      if (normalizedFilters.length === 0) return true;
      if (directMemo.has(normalizedId)) return directMemo.get(normalizedId);
      const matched = this.paradigmMatchesTagFilters(normalizedId, normalizedFilters);
      directMemo.set(normalizedId, matched);
      return matched;
    };
    const descendantMatch = (paradigmId, chain = new Set()) => {
      const normalizedId = sanitizeText(paradigmId, "");
      const currentParadigm = this.getParadigmById(normalizedId);
      if (!normalizedId || !currentParadigm) return false;
      if (normalizedFilters.length === 0) return false;
      if (descendantMemo.has(normalizedId)) return descendantMemo.get(normalizedId);
      if (chain.has(normalizedId)) return false;
      const nextChain = new Set(chain);
      nextChain.add(normalizedId);
      const ownCategoryId = currentParadigm.categoryId || null;
      const matched = this.getCategoryParadigmChildIds(normalizedId, ownCategoryId).some((childId) => {
        return directMatch(childId) || descendantMatch(childId, nextChain);
      });
      descendantMemo.set(normalizedId, matched);
      return matched;
    };
    const ancestorMatch = (paradigmId) => {
      const normalizedId = sanitizeText(paradigmId, "");
      const currentParadigm = this.getParadigmById(normalizedId);
      if (!normalizedId || !currentParadigm) return false;
      if (normalizedFilters.length === 0) return false;
      if (ancestorMemo.has(normalizedId)) return ancestorMemo.get(normalizedId);
      const seen = new Set([normalizedId]);
      let cursor = currentParadigm.parentParadigmId || null;
      let matched = false;
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        if (directMatch(cursor)) {
          matched = true;
          break;
        }
        cursor = this.getParadigmById(cursor)?.parentParadigmId || null;
      }
      ancestorMemo.set(normalizedId, matched);
      return matched;
    };
    const visible = (paradigmId, chain = new Set()) => {
      const normalizedId = sanitizeText(paradigmId, "");
      if (!normalizedId || !this.getParadigmById(normalizedId)) return false;
      if (normalizedFilters.length === 0) return true;
      if (visibleMemo.has(normalizedId)) return visibleMemo.get(normalizedId);
      if (chain.has(normalizedId)) return false;
      const nextChain = new Set(chain);
      nextChain.add(normalizedId);
      const isVisible = directMatch(normalizedId) || ancestorMatch(normalizedId) || descendantMatch(normalizedId, nextChain);
      visibleMemo.set(normalizedId, isVisible);
      return isVisible;
    };
    const categoryVisible = (categoryId) => {
      const normalizedId = sanitizeText(categoryId, "");
      if (!normalizedId || !this.getParadigmCategoryById(normalizedId)) return false;
      if (normalizedFilters.length === 0) return true;
      if (categoryMemo.has(normalizedId)) return categoryMemo.get(normalizedId);
      const isVisible = this.getCategoryParadigmRootIds(normalizedId).some((paradigmId) => visible(paradigmId))
        || this.getChildParadigmCategoryIds(normalizedId).some((childId) => categoryVisible(childId));
      categoryMemo.set(normalizedId, isVisible);
      return isVisible;
    };
    return {
      activeFilterIds: normalizedFilters,
      activeFilterSet: new Set(normalizedFilters),
      directMatch,
      descendantMatch,
      ancestorMatch,
      visible,
      categoryVisible,
    };
  }

  getParadigmItemById(paradigmItemId) {
    const id = sanitizeText(paradigmItemId, "");
    return id ? (this.workspaceData?.paradigmItemsById?.[id] || null) : null;
  }

  getParadigmChildrenIds(paradigmId, parentParadigmItemId = null) {
    const sourceParadigmId = sanitizeText(paradigmId, "");
    if (!sourceParadigmId) return [];
    return ensureUniqueIds(this.workspaceData?.paradigmChildrenByParent?.[paradigmParentKey(sourceParadigmId, parentParadigmItemId)] || [])
      .filter((itemId) => {
        const item = this.workspaceData?.paradigmItemsById?.[itemId];
        return !!item && sanitizeText(item.paradigmId, "") === sourceParadigmId;
      });
  }

  getCategoryParadigmChildIds(paradigmId, currentCategoryId = null) {
    return getEffectiveChildParadigmIdsFromData(this.workspaceData, paradigmId)
      .filter((childId) => (this.getParadigmById(childId)?.categoryId || null) === (currentCategoryId || null));
  }

  getCategoryParadigmRootIds(categoryId = null) {
    const targetCategoryId = categoryId || null;
    const orderedRootIds = ensureUniqueIds(this.workspaceData?.childParadigmIdsByParent?.[ROOT_KEY] || [])
      .filter((paradigmId) => {
        const paradigm = this.getParadigmById(paradigmId);
        if (!paradigm) return false;
        const ownCategoryId = paradigm.categoryId || null;
        const parent = paradigm.parentParadigmId ? this.getParadigmById(paradigm.parentParadigmId) : null;
        return ownCategoryId === targetCategoryId && (!parent || (parent.categoryId || null) !== ownCategoryId);
      });
    const fallbackIds = Object.values(this.workspaceData?.paradigmsById || {})
      .filter((paradigm) => {
        if (!paradigm) return false;
        const ownCategoryId = paradigm.categoryId || null;
        if (ownCategoryId !== targetCategoryId) return false;
        const parent = paradigm.parentParadigmId ? this.getParadigmById(paradigm.parentParadigmId) : null;
        return !parent || (parent.categoryId || null) !== ownCategoryId;
      })
      .map((paradigm) => paradigm.id);
    return ensureUniqueIds(orderedRootIds.concat(fallbackIds));
  }

  getParadigmCountForCategoryScope(categoryId = null) {
    const scopeIds = categoryId ? new Set(this.getParadigmCategoryScopeIds(categoryId)) : new Set();
    return Object.values(this.workspaceData?.paradigmsById || {}).filter((paradigm) => {
      const ownCategoryId = paradigm?.categoryId || null;
      if (!categoryId) return ownCategoryId === null;
      return ownCategoryId ? scopeIds.has(ownCategoryId) : false;
    }).length;
  }

  getParadigmAncestorIds(paradigmId) {
    const out = [];
    let cursor = this.getParadigmById(paradigmId)?.parentParadigmId || null;
    const seen = new Set();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (!this.getParadigmById(cursor)) break;
      out.unshift(cursor);
      cursor = this.getParadigmById(cursor)?.parentParadigmId || null;
    }
    return out;
  }

  getParadigmScopeIds(paradigmId) {
    const normalized = sanitizeText(paradigmId, "");
    if (!normalized || !this.getParadigmById(normalized)) return [];
    return [normalized].concat(getParadigmDescendantIdsFromData(this.workspaceData, normalized));
  }

  getParadigmSourceParadigm(paradigmOrId) {
    const paradigm = typeof paradigmOrId === "string" ? this.getParadigmById(paradigmOrId) : paradigmOrId;
    if (!paradigm) return null;
    const sourceId = getParadigmSourceIdInData(this.workspaceData, paradigm.id);
    return this.getParadigmById(sourceId) || paradigm;
  }

  getParadigmNodeLabel(paradigmOrId) {
    const paradigm = typeof paradigmOrId === "string" ? this.getParadigmById(paradigmOrId) : paradigmOrId;
    if (!paradigm) return sanitizeText(paradigmOrId, "");
    return sanitizeText(paradigm.name, paradigm.id) || paradigm.id;
  }

  getParadigmMountPathLabel(paradigmOrId) {
    const paradigm = typeof paradigmOrId === "string" ? this.getParadigmById(paradigmOrId) : paradigmOrId;
    if (!paradigm) return sanitizeText(paradigmOrId, "");
    const parts = [];
    const seen = new Set();
    let cursor = paradigm;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      parts.unshift(this.getParadigmNodeLabel(cursor));
      cursor = cursor.parentParadigmId ? this.getParadigmById(cursor.parentParadigmId) : null;
    }
    return parts.filter(Boolean).join(" / ");
  }

  getParadigmCopyReferenceEntries(sourceParadigmId) {
    const sourceId = sanitizeText(sourceParadigmId, "");
    if (!sourceId) return [];
    return Object.values(this.workspaceData?.paradigmsById || {})
      .filter((paradigm) => !!paradigm && sanitizeText(paradigm.sourceParadigmId, "") === sourceId)
      .map((copyParadigm) => {
        const hostParadigm = copyParadigm.parentParadigmId ? this.getParadigmById(copyParadigm.parentParadigmId) : null;
        return {
          copyParadigm,
          hostParadigm,
          hostLabel: hostParadigm ? `${this.getParadigmNodeLabel(hostParadigm)} (${hostParadigm.id})` : "根层",
        };
      })
      .sort((a, b) => a.hostLabel.localeCompare(b.hostLabel, "zh"));
  }

  summarizeParadigmCopyReferences(sourceParadigmId, maxCount = 4) {
    const entries = this.getParadigmCopyReferenceEntries(sourceParadigmId);
    if (entries.length === 0) return "";
    const preview = entries
      .slice(0, maxCount)
      .map((entry) => `${entry.hostLabel} / ${entry.copyParadigm.id}`)
      .join("、");
    return `被引用于 ${entries.length} 处：${preview}${entries.length > maxCount ? ` 等 ${entries.length} 处` : ""}`;
  }

  isParadigmTreeCollapsed(paradigmId) {
    return this.workspaceData?.paradigmTreeCollapsedById?.[sanitizeText(paradigmId, "")] === true;
  }

  async toggleParadigmTreeCollapsed(paradigmId) {
    const normalized = sanitizeText(paradigmId, "");
    if (!normalized) return;
    await this.updateWorkspaceData((data) => {
      if (!isObjectLike(data.paradigmTreeCollapsedById)) data.paradigmTreeCollapsedById = {};
      data.paradigmTreeCollapsedById[normalized] = data.paradigmTreeCollapsedById[normalized] !== true;
    });
  }

  isParadigmCategoryTreeCollapsed(categoryId) {
    return this.workspaceData?.paradigmCategoryCollapsedById?.[sanitizeText(categoryId, "")] === true;
  }

  async toggleParadigmCategoryTreeCollapsed(categoryId) {
    const normalized = sanitizeText(categoryId, "");
    if (!normalized) return;
    await this.updateWorkspaceData((data) => {
      if (!isObjectLike(data.paradigmCategoryCollapsedById)) data.paradigmCategoryCollapsedById = {};
      data.paradigmCategoryCollapsedById[normalized] = data.paradigmCategoryCollapsedById[normalized] !== true;
    });
  }

  isParadigmEditorScopeCollapsed(paradigmId) {
    return this.workspaceData?.paradigmEditorScopeCollapsedById?.[sanitizeText(paradigmId, "")] === true;
  }

  async toggleParadigmEditorScopeCollapsed(paradigmId) {
    const normalized = sanitizeText(paradigmId, "");
    if (!normalized) return;
    await this.updateWorkspaceData((data) => {
      if (!isObjectLike(data.paradigmEditorScopeCollapsedById)) data.paradigmEditorScopeCollapsedById = {};
      data.paradigmEditorScopeCollapsedById[normalized] = data.paradigmEditorScopeCollapsedById[normalized] !== true;
    });
  }

  setVisibleUiState(nextState = {}) {
    this.visibleUiState = normalizeVisibleUiState({ ...(this.visibleUiState || {}), ...(nextState || {}) });
  }

  getSnapshotById(snapshotId) {
    const normalized = sanitizeText(snapshotId, "");
    if (!normalized) return null;
    return this.workspaceData?.snapshotsById?.[normalized] || null;
  }

  getSnapshotIdsForTab(tabId = this.getActiveTabId()) {
    const normalizedTabId = sanitizeText(tabId, "");
    return ensureUniqueIds(this.workspaceData?.snapshotOrderByTab?.[normalizedTabId] || [])
      .filter((snapshotId) => !!this.getSnapshotById(snapshotId));
  }

  getSelectedSnapshotId(tabId = this.getActiveTabId()) {
    const selectedId = sanitizeText(this.selectedSnapshotId, "");
    if (!selectedId) return "";
    const snapshot = this.getSnapshotById(selectedId);
    const normalizedTabId = sanitizeText(tabId, "");
    if (!snapshot || (normalizedTabId && sanitizeText(snapshot.tabId, "") !== normalizedTabId)) {
      this.selectedSnapshotId = "";
      return "";
    }
    return selectedId;
  }

  setSelectedSnapshotId(snapshotId = "") {
    this.selectedSnapshotId = sanitizeText(snapshotId, "");
  }

  async toggleParadigmPanel() {
    this.setVisibleUiState({ showParadigmPanel: !this.visibleUiState?.showParadigmPanel });
    await this.render();
  }

  async toggleSnapshotPanel() {
    this.setVisibleUiState({ showSnapshotPanel: !this.visibleUiState?.showSnapshotPanel });
    await this.render();
  }

  async toggleParadigmTocCollapsed() {
    this.setVisibleUiState({ paradigmTocCollapsed: !this.visibleUiState?.paradigmTocCollapsed });
    await this.render();
  }

  async setParadigmTocMode(mode) {
    this.setVisibleUiState({ paradigmTocMode: mode === "tab" ? "tab" : "panel" });
    await this.render();
  }

  async moveParadigmOrder(draggedIdRaw, targetIdRaw, position = "after") {
    const draggedId = sanitizeText(draggedIdRaw, "");
    const targetId = sanitizeText(targetIdRaw, "");
    if (!draggedId || !targetId || draggedId === targetId) return;
    const targetParadigm = this.getParadigmById(targetId);
    if (!this.getParadigmById(draggedId) || !targetParadigm) return;
    const nextParentId = position === "child" ? targetId : (targetParadigm.parentParadigmId || null);
    if (wouldCreateParadigmTreeCycleInData(this.workspaceData, draggedId, nextParentId)) {
      new Notice("不能把范式拖到自己的子级下面。");
      return;
    }
    await this.updateWorkspaceData((data) => {
      ensureParadigmHierarchyState(data);
      ensureParadigmCategoryHierarchyState(data);
      const dragged = data.paradigmsById?.[draggedId];
      const target = data.paradigmsById?.[targetId];
      if (!dragged || !target) return;
      const parentId = position === "child" ? target.id : (target.parentParadigmId || null);
      if (wouldCreateParadigmTreeCycleInData(data, dragged.id, parentId)) return;
      removeIdFromSimpleChildrenMap(data.childParadigmIdsByParent, dragged.id);
      dragged.parentParadigmId = parentId;
      dragged.updatedAt = nowString();
      const key = paradigmTreeKey(parentId);
      if (!Array.isArray(data.childParadigmIdsByParent[key])) data.childParadigmIdsByParent[key] = [];
      const siblings = data.childParadigmIdsByParent[key];
      if (position === "child") {
        siblings.unshift(dragged.id);
      } else {
        const targetIndex = siblings.indexOf(target.id);
        if (targetIndex < 0) siblings.push(dragged.id);
        else siblings.splice(position === "before" ? targetIndex : targetIndex + 1, 0, dragged.id);
      }
      assignParadigmCategoryInData(data, dragged.id, target.categoryId || null);
    });
  }

  async moveParadigmCategoryOrder(draggedIdRaw, targetIdRaw, position = "after") {
    const draggedId = sanitizeText(draggedIdRaw, "");
    const targetId = sanitizeText(targetIdRaw, "");
    if (!draggedId || !targetId || draggedId === targetId) return;
    const targetCategory = this.getParadigmCategoryById(targetId);
    if (!this.getParadigmCategoryById(draggedId) || !targetCategory) return;
    const nextParentId = position === "child" ? targetId : (targetCategory.parentCategoryId || null);
    if (wouldCreateParadigmCategoryCycleInData(this.workspaceData, draggedId, nextParentId)) {
      new Notice("不能把分类拖到自己的子级下面。");
      return;
    }
    await this.updateWorkspaceData((data) => {
      ensureParadigmCategoryHierarchyState(data);
      const dragged = data.paradigmCategoriesById?.[draggedId];
      const target = data.paradigmCategoriesById?.[targetId];
      if (!dragged || !target) return;
      const parentId = position === "child" ? target.id : (target.parentCategoryId || null);
      if (wouldCreateParadigmCategoryCycleInData(data, dragged.id, parentId)) return;
      removeIdFromSimpleChildrenMap(data.childParadigmCategoryIdsByParent, dragged.id);
      dragged.parentCategoryId = parentId;
      dragged.updatedAt = nowString();
      const key = paradigmCategoryTreeKey(parentId);
      if (!Array.isArray(data.childParadigmCategoryIdsByParent[key])) data.childParadigmCategoryIdsByParent[key] = [];
      const siblings = data.childParadigmCategoryIdsByParent[key];
      if (position === "child") {
        siblings.unshift(dragged.id);
      } else {
        const targetIndex = siblings.indexOf(target.id);
        if (targetIndex < 0) siblings.push(dragged.id);
        else siblings.splice(position === "before" ? targetIndex : targetIndex + 1, 0, dragged.id);
      }
    });
  }

  async moveTopLevelParadigmMountOrder(tabId, draggedParadigmId, targetParadigmId, position = "after") {
    const normalizedTabId = sanitizeText(tabId, "");
    const draggedId = sanitizeText(draggedParadigmId, "");
    const targetId = sanitizeText(targetParadigmId, "");
    if (!normalizedTabId || !draggedId || !targetId || draggedId === targetId) return;
    const currentOrderInfo = getOrderedParadigmMountRootIdsForTabData(this.workspaceData, normalizedTabId);
    if (!currentOrderInfo.rootParadigmIds.includes(draggedId) || !currentOrderInfo.rootParadigmIds.includes(targetId)) return;
    await this.updateWorkspaceData((data) => {
      const tab = data.tabsById?.[normalizedTabId];
      if (!tab) return;
      const nextOrderInfo = getOrderedParadigmMountRootIdsForTabData(data, normalizedTabId);
      const currentRootOrder = nextOrderInfo.rootParadigmIds.slice();
      if (!currentRootOrder.includes(draggedId) || !currentRootOrder.includes(targetId)) return;
      const reorderedRootIds = currentRootOrder.filter((id) => id !== draggedId);
      const targetIndex = reorderedRootIds.indexOf(targetId);
      if (targetIndex < 0) return;
      reorderedRootIds.splice(position === "before" ? targetIndex : targetIndex + 1, 0, draggedId);
      const rootSet = new Set(currentRootOrder);
      const remainder = normalizeBoundParadigmIds(tab).filter((id) => !rootSet.has(id));
      setTabBoundParadigmIds(tab, reorderedRootIds.concat(remainder));
      tab.updatedAt = nowString();
    });
  }

  async assignParadigmCategory(paradigmId, categoryId = null, options = {}) {
    const normalizedParadigmId = sanitizeText(paradigmId, "");
    if (!normalizedParadigmId || !this.getParadigmById(normalizedParadigmId)) return false;
    const normalizedCategoryId = categoryId && this.getParadigmCategoryById(categoryId) ? sanitizeText(categoryId, "") : null;
    return await this.updateWorkspaceData((data) => {
      assignParadigmCategoryInData(data, normalizedParadigmId, normalizedCategoryId, options);
    });
  }

  async createParadigmCategory(parentCategoryId = null) {
    const normalizedParentId = parentCategoryId && this.getParadigmCategoryById(parentCategoryId)
      ? sanitizeText(parentCategoryId, "")
      : null;
    const parentCategory = normalizedParentId ? this.getParadigmCategoryById(normalizedParentId) : null;
    const name = await this.promptForText({
      title: normalizedParentId ? "新建子分类" : "新建分类",
      description: normalizedParentId
        ? `将在 ${sanitizeText(parentCategory?.name, normalizedParentId)} 下创建子分类`
        : "创建新的范式分类节点",
      placeholder: "输入分类名称",
      confirmText: "创建",
    });
    const normalizedName = sanitizeText(name, "");
    if (!normalizedName) return false;
    const categoryId = `pgCat_${createId("cat")}`;
    const ok = await this.updateWorkspaceData((data) => {
      ensureParadigmCategoryHierarchyState(data);
      if (!isObjectLike(data.paradigmCategoriesById)) data.paradigmCategoriesById = {};
      if (!isObjectLike(data.childParadigmCategoryIdsByParent)) data.childParadigmCategoryIdsByParent = {};
      const parentId = normalizedParentId && data.paradigmCategoriesById?.[normalizedParentId] ? normalizedParentId : null;
      const key = paradigmCategoryTreeKey(parentId);
      if (!Array.isArray(data.childParadigmCategoryIdsByParent[key])) data.childParadigmCategoryIdsByParent[key] = [];
      data.paradigmCategoriesById[categoryId] = {
        id: categoryId,
        name: normalizedName,
        parentCategoryId: parentId,
        createdAt: nowString(),
        updatedAt: nowString(),
      };
      data.childParadigmCategoryIdsByParent[key].unshift(categoryId);
      if (parentId) {
        if (!isObjectLike(data.paradigmCategoryCollapsedById)) data.paradigmCategoryCollapsedById = {};
        data.paradigmCategoryCollapsedById[parentId] = false;
      }
    });
    if (ok) new Notice("✅ 范式分类已创建");
    return ok;
  }

  async renameParadigmCategory(categoryId) {
    const normalizedCategoryId = sanitizeText(categoryId, "");
    const category = this.getParadigmCategoryById(normalizedCategoryId);
    if (!category) return false;
    const name = await this.promptForText({
      title: "重命名分类",
      description: `当前分类：${sanitizeText(category.name, category.id)}`,
      value: sanitizeText(category.name, ""),
      placeholder: "输入新名称",
      confirmText: "保存",
    });
    const normalizedName = sanitizeText(name, "");
    if (!normalizedName) return false;
    const ok = await this.updateWorkspaceData((data) => {
      const target = data.paradigmCategoriesById?.[normalizedCategoryId];
      if (!target) return;
      target.name = normalizedName;
      target.updatedAt = nowString();
    });
    if (ok) new Notice("✅ 范式分类已重命名");
    return ok;
  }

  async deleteParadigmCategory(categoryId) {
    const normalizedCategoryId = sanitizeText(categoryId, "");
    const category = this.getParadigmCategoryById(normalizedCategoryId);
    if (!category) return false;
    const okToDelete = window.confirm(
      `确定删除分类「${sanitizeText(category.name, category.id)}」吗？其子分类会上移，范式会并入上级分类。`,
    );
    if (!okToDelete) return false;
    const ok = await this.updateWorkspaceData((data) => {
      ensureParadigmCategoryHierarchyState(data);
      const target = data.paradigmCategoriesById?.[normalizedCategoryId];
      if (!target) return;
      const parentCategoryId = sanitizeText(target.parentCategoryId, "") || null;
      const childKey = paradigmCategoryTreeKey(normalizedCategoryId);
      const nextParentKey = paradigmCategoryTreeKey(parentCategoryId);
      const childCategoryIds = Array.isArray(data.childParadigmCategoryIdsByParent?.[childKey])
        ? data.childParadigmCategoryIdsByParent[childKey].slice()
        : [];
      const timestamp = nowString();
      Object.values(data.paradigmsById || {}).forEach((paradigm) => {
        if (!paradigm || sanitizeText(paradigm.categoryId, "") !== normalizedCategoryId) return;
        paradigm.categoryId = parentCategoryId;
        paradigm.updatedAt = timestamp;
      });
      removeIdFromSimpleChildrenMap(data.childParadigmCategoryIdsByParent, normalizedCategoryId);
      if (!Array.isArray(data.childParadigmCategoryIdsByParent[nextParentKey])) data.childParadigmCategoryIdsByParent[nextParentKey] = [];
      childCategoryIds.forEach((childId) => {
        const child = data.paradigmCategoriesById?.[childId];
        if (!child) return;
        child.parentCategoryId = parentCategoryId;
        child.updatedAt = timestamp;
        if (!data.childParadigmCategoryIdsByParent[nextParentKey].includes(childId)) {
          data.childParadigmCategoryIdsByParent[nextParentKey].push(childId);
        }
      });
      if (isObjectLike(data.paradigmCategoryCollapsedById)) delete data.paradigmCategoryCollapsedById[normalizedCategoryId];
      delete data.childParadigmCategoryIdsByParent[childKey];
      delete data.paradigmCategoriesById[normalizedCategoryId];
    });
    if (ok) new Notice("🗑️ 范式分类已删除");
    return ok;
  }

  async promptParadigmCategoryAssignment(paradigmId) {
    const normalizedParadigmId = sanitizeText(paradigmId, "");
    const paradigm = this.getParadigmById(normalizedParadigmId);
    if (!paradigm) return false;
    const currentCategory = paradigm.categoryId ? this.getParadigmCategoryById(paradigm.categoryId) : null;
    const uncategorizedSentinel = "__uncategorized__";
    const categoryItems = [{
      id: uncategorizedSentinel,
      name: "未分类",
      meta: "移出当前分类",
      search: "未分类 uncategorized 清除 移出 分类",
    }].concat(
      Object.values(this.workspaceData?.paradigmCategoriesById || {})
        .filter((item) => !!item)
        .map((item) => ({
          id: item.id,
          name: this.getParadigmCategoryPathLabel(item),
          meta: `${item.id}${item.parentCategoryId ? ` · 上级 ${this.getParadigmCategoryById(item.parentCategoryId)?.name || item.parentCategoryId}` : " · 顶层分类"}`,
          search: [
            item.id,
            item.name,
            this.getParadigmCategoryPathLabel(item),
            item.parentCategoryId,
            this.getParadigmCategoryById(item.parentCategoryId)?.name || "",
          ].filter(Boolean).join(" ").toLowerCase(),
        }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh")),
    );
    const selectedId = await this.pickParadigm({
      title: "设置范式分类",
      description: `当前：${currentCategory ? this.getParadigmCategoryPathLabel(currentCategory) : "未分类"}。输入分类名称或 ID 筛选。`,
      items: categoryItems,
    });
    if (selectedId === null) return false;
    const nextCategoryId = selectedId === uncategorizedSentinel ? null : selectedId;
    const ok = await this.assignParadigmCategory(normalizedParadigmId, nextCategoryId, { detachFromParent: !nextCategoryId });
    if (ok) new Notice(nextCategoryId ? "🏷️ 已调整范式分类" : "🏷️ 已移出分类");
    return ok;
  }

  async createParadigm(categoryId = null) {
    const normalizedCategoryId = categoryId && this.getParadigmCategoryById(categoryId)
      ? sanitizeText(categoryId, "")
      : null;
    const category = normalizedCategoryId ? this.getParadigmCategoryById(normalizedCategoryId) : null;
    const name = await this.promptForText({
      title: "新建范式",
      description: normalizedCategoryId
        ? `将在分类 ${this.getParadigmCategoryPathLabel(category)} 下创建根范式`
        : "创建新的根范式",
      placeholder: "输入范式名称",
      confirmText: "创建",
    });
    const normalizedName = sanitizeText(name, "");
    if (!normalizedName) return false;
    const paradigmId = `pg_${createId("node")}`;
    const ok = await this.updateWorkspaceData((data) => {
      ensureParadigmHierarchyState(data);
      ensureParadigmCategoryHierarchyState(data);
      if (!Array.isArray(data.childParadigmIdsByParent[ROOT_KEY])) data.childParadigmIdsByParent[ROOT_KEY] = [];
      data.paradigmsById[paradigmId] = {
        id: paradigmId,
        name: normalizedName,
        sourceParadigmId: null,
        parentParadigmId: null,
        categoryId: normalizedCategoryId && data.paradigmCategoriesById?.[normalizedCategoryId] ? normalizedCategoryId : null,
        createdAt: nowString(),
        updatedAt: nowString(),
      };
      data.childParadigmIdsByParent[ROOT_KEY].unshift(paradigmId);
      if (!isObjectLike(data.paradigmChildrenByParent)) data.paradigmChildrenByParent = {};
      if (!Array.isArray(data.paradigmChildrenByParent[paradigmParentKey(paradigmId, null)])) {
        data.paradigmChildrenByParent[paradigmParentKey(paradigmId, null)] = [];
      }
      if (normalizedCategoryId) {
        if (!isObjectLike(data.paradigmCategoryCollapsedById)) data.paradigmCategoryCollapsedById = {};
        data.paradigmCategoryCollapsedById[normalizedCategoryId] = false;
      }
    });
    if (ok) new Notice("✅ 范式已创建");
    return ok;
  }

  async renameParadigm(paradigmId) {
    const normalizedParadigmId = sanitizeText(paradigmId, "");
    const targetParadigm = this.getParadigmById(normalizedParadigmId);
    if (!targetParadigm) return false;
    const name = await this.promptForText({
      title: "重命名范式",
      description: `当前范式：${sanitizeText(targetParadigm.name, targetParadigm.id)}`,
      value: sanitizeText(targetParadigm.name, ""),
      placeholder: "输入新名称",
      confirmText: "保存",
    });
    const normalizedName = sanitizeText(name, "");
    if (!normalizedName) return false;
    const ok = await this.updateWorkspaceData((data) => {
      const target = data.paradigmsById?.[normalizedParadigmId];
      if (!target) return;
      target.name = normalizedName;
      target.updatedAt = nowString();
    });
    if (ok) new Notice("✅ 范式已重命名");
    return ok;
  }

  resolveParadigmCandidateFromInput(rawValue, options = {}) {
    const query = sanitizeText(rawValue, "").toLowerCase();
    const excludeIds = new Set(ensureUniqueIds(options?.excludeIds || []));
    const paradigms = Object.values(this.workspaceData?.paradigmsById || {}).filter((paradigm) => !!paradigm && !excludeIds.has(paradigm.id));
    if (!query) return { match: null, matches: [] };
    const exactId = paradigms.find((paradigm) => paradigm.id.toLowerCase() === query);
    if (exactId) return { match: exactId, matches: [exactId] };
    const exactName = paradigms.find((paradigm) => sanitizeText(paradigm.name, "").toLowerCase() === query);
    if (exactName) return { match: exactName, matches: [exactName] };
    const matches = paradigms.filter((paradigm) => {
      const source = this.getParadigmSourceParadigm(paradigm);
      const hay = [
        paradigm.id,
        paradigm.name,
        source?.id,
        source?.name,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(query);
    });
    return {
      match: matches.length === 1 ? matches[0] : null,
      matches,
    };
  }

  async createParadigmChild(parentParadigmId) {
    const parentParadigm = this.getParadigmById(parentParadigmId);
    if (!parentParadigm) return;
    const name = await this.promptForText({
      title: "新建子范式",
      description: `将在 ${sanitizeText(parentParadigm.name, parentParadigm.id)} 下创建子范式`,
      placeholder: "输入子范式名称",
      confirmText: "创建",
    });
    if (!sanitizeText(name, "")) return;
    const paradigmId = `pg_${createId("node")}`;
    await this.updateWorkspaceData((data) => {
      ensureParadigmHierarchyState(data);
      const parent = data.paradigmsById?.[parentParadigmId];
      if (!parent) return;
      const key = paradigmTreeKey(parent.id);
      if (!Array.isArray(data.childParadigmIdsByParent[key])) data.childParadigmIdsByParent[key] = [];
      data.paradigmsById[paradigmId] = {
        id: paradigmId,
        name: sanitizeText(name, "未命名范式"),
        sourceParadigmId: null,
        parentParadigmId: parent.id,
        categoryId: parent.categoryId || null,
        createdAt: nowString(),
        updatedAt: nowString(),
      };
      data.childParadigmIdsByParent[key].unshift(paradigmId);
      if (!isObjectLike(data.paradigmChildrenByParent)) data.paradigmChildrenByParent = {};
      if (!Array.isArray(data.paradigmChildrenByParent[paradigmParentKey(paradigmId, null)])) data.paradigmChildrenByParent[paradigmParentKey(paradigmId, null)] = [];
    });
    new Notice(`已在 ${sanitizeText(parentParadigm.name, parentParadigm.id)} 下创建子范式`);
  }

  async createParadigmCopy(hostParadigmId, sourceParadigmIdRaw = "") {
    const hostParadigm = this.getParadigmById(hostParadigmId);
    if (!hostParadigm) return;
    let selectedParadigm = null;
    const initialQuery = sanitizeText(sourceParadigmIdRaw, "");
    if (initialQuery) {
      const resolved = this.resolveParadigmCandidateFromInput(initialQuery, { excludeIds: [hostParadigm.id] });
      selectedParadigm = resolved.match;
      if (!selectedParadigm) {
        new Notice(resolved.matches.length > 1 ? "匹配到多个范式，请输入更精确的名称或 ID。" : "没有找到要引用的范式。");
        return;
      }
    } else {
      const selectableParadigms = Object.values(this.workspaceData?.paradigmsById || {})
        .filter((paradigm) => !!paradigm && paradigm.id !== hostParadigm.id)
        .map((paradigm) => {
          const source = this.getParadigmSourceParadigm(paradigm);
          const sourceName = sanitizeText(source?.name, source?.id || "");
          const isCopy = isParadigmCopyInData(this.workspaceData, paradigm.id);
          const tag = isCopy ? `引用副本 -> ${sourceName}` : "定义源";
          return {
            id: paradigm.id,
            name: this.getParadigmNodeLabel(paradigm),
            meta: `${paradigm.id} · ${tag}`,
            search: [
              paradigm.id,
              paradigm.name,
              this.getParadigmNodeLabel(paradigm),
              sourceName,
              source?.id,
              tag,
            ].filter(Boolean).join(" ").toLowerCase(),
          };
        })
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh"));
      const selectedId = await this.pickParadigm({
        title: "添加引用副本",
        description: `宿主：${sanitizeText(hostParadigm.name, hostParadigm.id)}。只引用该范式自身条目，不自动带入它原有的子范式树。`,
        items: selectableParadigms,
      });
      if (!sanitizeText(selectedId, "")) return;
      selectedParadigm = this.getParadigmById(selectedId);
    }
    const sourceRootParadigmId = getParadigmSourceIdInData(this.workspaceData, selectedParadigm.id);
    if (!sourceRootParadigmId || sourceRootParadigmId === hostParadigm.id) {
      new Notice("不能把当前范式引用为自己的副本。");
      return;
    }
    if (this.getParadigmScopeIds(sourceRootParadigmId).includes(hostParadigm.id)) {
      new Notice("该引用会形成循环层级。");
      return;
    }
    const copyId = `pg_${createId("copy")}`;
    await this.updateWorkspaceData((data) => {
      ensureParadigmHierarchyState(data);
      const host = data.paradigmsById?.[hostParadigmId];
      const source = data.paradigmsById?.[sourceRootParadigmId];
      if (!host || !source) return;
      const key = paradigmTreeKey(host.id);
      if (!Array.isArray(data.childParadigmIdsByParent[key])) data.childParadigmIdsByParent[key] = [];
      data.paradigmsById[copyId] = {
        id: copyId,
        name: sanitizeText(source.name, source.id),
        sourceParadigmId: sourceRootParadigmId,
        parentParadigmId: host.id,
        categoryId: host.categoryId || null,
        createdAt: nowString(),
        updatedAt: nowString(),
      };
      data.childParadigmIdsByParent[key].unshift(copyId);
    });
    new Notice(`已在 ${sanitizeText(hostParadigm.name, hostParadigm.id)} 下添加 ${sanitizeText(this.getParadigmSourceParadigm(selectedParadigm)?.name, selectedParadigm.name || selectedParadigm.id)} 的引用副本`);
  }

  async deleteParadigm(paradigmIdRaw) {
    const paradigmId = sanitizeText(paradigmIdRaw, "");
    const paradigm = this.getParadigmById(paradigmId);
    if (!paradigm) return false;
    const copyIds = Object.values(this.workspaceData?.paradigmsById || {})
      .filter((pg) => !!pg && sanitizeText(pg.sourceParadigmId, "") === paradigmId)
      .map((pg) => pg.id);
    const isCopyParadigm = !!sanitizeText(paradigm.sourceParadigmId, "");
    if (!isCopyParadigm && copyIds.length > 0) {
      new Notice(`⚠️ 请先删除引用这个范式的 ${copyIds.length} 个引用副本`);
      return false;
    }
    const ok = window.confirm(
      isCopyParadigm
        ? `确定删除引用副本「${sanitizeText(paradigm.name, paradigm.id)}」吗？定义源与其他引用不会受影响。`
        : `确定删除范式「${sanitizeText(paradigm.name, paradigm.id)}」吗？已挂载实例会转为普通条目。`
    );
    if (!ok) return false;
    const removed = await this.updateWorkspaceData((data) => {
      ensureParadigmHierarchyState(data);
      const targetParadigm = data.paradigmsById?.[paradigmId];
      if (!targetParadigm) return;
      const parentParadigmId = sanitizeText(targetParadigm.parentParadigmId, "") || null;
      const childParadigmIds = Array.isArray(data.childParadigmIdsByParent?.[paradigmTreeKey(paradigmId)])
        ? data.childParadigmIdsByParent[paradigmTreeKey(paradigmId)].slice()
        : [];
      Object.values(data.tabsById || {}).forEach((tab) => {
        if (!tab) return;
        const boundIds = normalizeBoundParadigmIds(tab);
        setTabBoundParadigmIds(tab, boundIds.filter((id) => id !== paradigmId));
        tab.updatedAt = nowString();
        convertBoundParadigmItemsToLocal(data, tab.id, paradigmId);
      });
      if (!isCopyParadigm) {
        Object.keys(data.paradigmItemsById || {}).forEach((id) => {
          if (data.paradigmItemsById[id]?.paradigmId === paradigmId) delete data.paradigmItemsById[id];
        });
        Object.keys(data.paradigmChildrenByParent || {}).forEach((scoped) => {
          const parsed = splitScopedKey(scoped);
          if (parsed.ownerId === paradigmId) delete data.paradigmChildrenByParent[scoped];
        });
      }
      removeIdFromSimpleChildrenMap(data.childParadigmIdsByParent, paradigmId);
      const nextParentKey = paradigmTreeKey(parentParadigmId);
      if (!Array.isArray(data.childParadigmIdsByParent[nextParentKey])) data.childParadigmIdsByParent[nextParentKey] = [];
      childParadigmIds.forEach((childId) => {
        if (!data.paradigmsById?.[childId]) return;
        data.paradigmsById[childId].parentParadigmId = parentParadigmId;
        if (!data.childParadigmIdsByParent[nextParentKey].includes(childId)) data.childParadigmIdsByParent[nextParentKey].push(childId);
      });
      delete data.childParadigmIdsByParent[paradigmTreeKey(paradigmId)];
      delete data.paradigmsById[paradigmId];
    });
    if (!removed) return false;
    if (this.activeParadigmEditorId === paradigmId) this.activeParadigmEditorId = "";
    if (this.expandedParadigmReferenceSourceIds) delete this.expandedParadigmReferenceSourceIds[paradigmId];
    return true;
  }

  async bindParadigmToCurrentTab(paradigmId) {
    const tab = this.getActiveTab();
    const paradigm = this.getParadigmById(paradigmId);
    if (!tab || !paradigm) return;
    const alreadyBound = normalizeBoundParadigmIds(tab).includes(paradigm.id);
    await this.updateWorkspaceData((data) => {
      const targetTab = data.tabsById?.[tab.id];
      if (!targetTab) return;
      const nextIds = normalizeBoundParadigmIds(targetTab);
      if (!nextIds.includes(paradigm.id)) nextIds.push(paradigm.id);
      setTabBoundParadigmIds(targetTab, nextIds);
      targetTab.updatedAt = nowString();
    });
    const scopeCount = this.getParadigmScopeIds(paradigm.id).length;
    new Notice(alreadyBound ? `已绑定范式：${sanitizeText(paradigm.name, paradigm.id)}` : `已绑定范式：${sanitizeText(paradigm.name, paradigm.id)}（含 ${scopeCount} 个范式层级）`);
  }

  async unbindParadigmFromCurrentTab(paradigmId = null) {
    const tab = this.getActiveTab();
    if (!tab) return;
    const currentIds = normalizeBoundParadigmIds(tab);
    if (currentIds.length === 0) return;
    const targetId = sanitizeText(paradigmId, "") || null;
    const idsToRemove = targetId
      ? currentIds.filter((id) => id === targetId || this.getParadigmScopeIds(targetId).includes(id))
      : currentIds.slice();
    if (idsToRemove.length === 0) return;
    await this.updateWorkspaceData((data) => {
      const targetTab = data.tabsById?.[tab.id];
      if (!targetTab) return;
      const boundIds = normalizeBoundParadigmIds(targetTab);
      setTabBoundParadigmIds(targetTab, boundIds.filter((id) => !idsToRemove.includes(id)));
      targetTab.updatedAt = nowString();
    });
    new Notice(targetId ? "已解绑该范式，相关挂载实例已转为普通条目" : "已解绑当前 Tab 全部范式，相关挂载实例已转为普通条目");
  }

  getMountedParadigmSourceItem(itemOrId) {
    const item = typeof itemOrId === "string" ? this.getItemById(itemOrId) : itemOrId;
    if (!this.isParadigmMountedItem(item)) return null;
    return this.getParadigmItemById(item.sourceParadigmItemId);
  }

  getMountedParadigmOwnerInfo(itemOrId) {
    const item = typeof itemOrId === "string" ? this.getItemById(itemOrId) : itemOrId;
    if (!this.isParadigmMountedItem(item)) return { paradigmId: "", paradigm: null };
    const paradigmId = sanitizeText(item.sourceParadigmMountScopeId || item.sourceParadigmBindingRootId || item.sourceParadigmId, "");
    return {
      paradigmId,
      paradigm: this.getParadigmById(paradigmId),
    };
  }

  async confirmMountedParadigmWriteback(itemOrId, actionLabel, options = {}) {
    const mountedItem = typeof itemOrId === "string" ? this.getItemById(itemOrId) : itemOrId;
    if (!this.isParadigmMountedItem(mountedItem)) return null;
    const sourceItem = this.getMountedParadigmSourceItem(mountedItem);
    if (!sourceItem) {
      new Notice("未找到引用挂载对应的定义源。");
      return null;
    }
    const ownerInfo = this.getMountedParadigmOwnerInfo(mountedItem);
    const paradigmName = sanitizeText(ownerInfo.paradigm?.name, ownerInfo.paradigmId || "未知范式");
    const message = [
      `当前操作会把“${sanitizeText(mountedItem.title, mountedItem.id)}”的${actionLabel}写回范式管理。`,
      `范式：${paradigmName}`,
      `定义源条目：${sanitizeText(sourceItem.title, sourceItem.id)} (${sourceItem.id})`,
      sanitizeText(options?.extraMessage, "") || "写回后，其他引用这个范式条目的地方也会一起变化。",
    ].join("\n");
    return window.confirm(message) ? sourceItem : null;
  }

  collectParadigmSubtreeItemIds(paradigmId, startParadigmItemId) {
    const out = [];
    const seen = new Set();
    const stack = [sanitizeText(startParadigmItemId, "")];
    const normalizedParadigmId = sanitizeText(paradigmId, "");
    while (stack.length > 0) {
      const current = sanitizeText(stack.pop(), "");
      if (!current || seen.has(current)) continue;
      const item = this.getParadigmItemById(current);
      if (!item || sanitizeText(item.paradigmId, "") !== normalizedParadigmId) continue;
      seen.add(current);
      out.push(current);
      this.getParadigmChildrenIds(normalizedParadigmId, current).forEach((childId) => stack.push(childId));
    }
    return out;
  }

  wouldCreateParadigmItemCycle(paradigmId, movedItemId, nextParentId) {
    const normalizedParadigmId = sanitizeText(paradigmId, "");
    let cursor = sanitizeText(nextParentId, "") || null;
    while (cursor) {
      if (cursor === movedItemId) return true;
      const item = this.getParadigmItemById(cursor);
      if (!item || sanitizeText(item.paradigmId, "") !== normalizedParadigmId) break;
      cursor = sanitizeText(item.parentId, "") || null;
    }
    return false;
  }

  async addParadigmItem(paradigmId, parentParadigmItemId = null) {
    const paradigm = this.getParadigmById(paradigmId);
    if (!paradigm) return;
    const title = await this.promptForText({
      title: parentParadigmItemId ? "添加范式子条目" : "添加范式根条目",
      placeholder: "输入条目名称",
      confirmText: "创建",
    });
    if (!sanitizeText(title, "")) return;
    const itemId = `pgItem_${createId("node")}`;
    await this.updateWorkspaceData((data) => {
      if (!data.paradigmsById?.[paradigmId]) return;
      if (!isObjectLike(data.paradigmItemsById)) data.paradigmItemsById = {};
      if (!isObjectLike(data.paradigmChildrenByParent)) data.paradigmChildrenByParent = {};
      data.paradigmItemsById[itemId] = {
        id: itemId,
        paradigmId,
        title: sanitizeText(title, "未命名范式条目"),
        parentId: sanitizeText(parentParadigmItemId, "") || null,
        order: Date.now(),
        imageRef: "",
        shortcuts: [],
        comment: "",
        noteBinding: null,
        createdAt: nowString(),
        updatedAt: nowString(),
      };
      const scoped = paradigmParentKey(paradigmId, parentParadigmItemId);
      if (!Array.isArray(data.paradigmChildrenByParent[scoped])) data.paradigmChildrenByParent[scoped] = [];
      data.paradigmChildrenByParent[scoped].unshift(itemId);
      if (data.paradigmsById?.[paradigmId]) data.paradigmsById[paradigmId].updatedAt = nowString();
    });
    new Notice(parentParadigmItemId ? "已写回新增范式子条目" : "已写回新增范式根条目");
  }

  async renameParadigmItem(paradigmItemId) {
    const item = this.getParadigmItemById(paradigmItemId);
    if (!item) return;
    const nextTitle = await this.promptForText({
      title: "重命名范式条目",
      value: item.title || "",
      placeholder: "输入条目名称",
      confirmText: "保存",
    });
    if (!sanitizeText(nextTitle, "")) return;
    await this.updateWorkspaceData((data) => {
      const target = data.paradigmItemsById?.[paradigmItemId];
      if (!target) return;
      target.title = sanitizeText(nextTitle, target.title || paradigmItemId);
      target.updatedAt = nowString();
      if (data.paradigmsById?.[target.paradigmId]) data.paradigmsById[target.paradigmId].updatedAt = nowString();
    });
    new Notice("已写回范式条目重命名");
  }

  async editParadigmItemImage(paradigmItemId) {
    const item = this.getParadigmItemById(paradigmItemId);
    if (!item) return;
    const result = await this.editImageRefModal({
      title: `🖼️ 范式图片：${item.title || item.id}`,
      value: item.imageRef || "",
      shortcutEntries: item.shortcuts || [],
    });
    if (!result) return;
    const nextShortcuts = normalizeShortcutEntries(result.shortcuts || []);
    await this.updateWorkspaceData((data) => {
      const target = data.paradigmItemsById?.[paradigmItemId];
      if (!target) return;
      target.imageRef = result.action === "clear" ? "" : sanitizeText(result.value, "");
      target.shortcuts = nextShortcuts;
      target.updatedAt = nowString();
      if (data.paradigmsById?.[target.paradigmId]) data.paradigmsById[target.paradigmId].updatedAt = nowString();
    });
    new Notice("已写回范式图片/快捷方式");
  }

  async editParadigmItemNoteBinding(paradigmItemId) {
    const item = this.getParadigmItemById(paradigmItemId);
    if (!item) return;
    const currentBinding = item.noteBinding ? deepClone(item.noteBinding, null) : null;
    const currentValue = typeof currentBinding === "string"
      ? currentBinding
      : sanitizeText(currentBinding?.path, "");
    const result = await this.editNoteBindingModal({
      title: `绑定范式笔记：${item.title || item.id}`,
      value: currentValue,
      onOpenCurrent: async () => {
        await this.openBoundNote(currentBinding);
      },
    });
    if (!result) return;
    if (result.action === "clear") {
      await this.updateWorkspaceData((data) => {
        const target = data.paradigmItemsById?.[paradigmItemId];
        if (!target) return;
        target.noteBinding = null;
        target.updatedAt = nowString();
        if (data.paradigmsById?.[target.paradigmId]) data.paradigmsById[target.paradigmId].updatedAt = nowString();
      });
      new Notice("已清除范式笔记绑定");
      return;
    }
    const normalized = sanitizeText(result.value, "");
    const file = this.resolveExistingNoteFile(normalized);
    if (!(file instanceof TFile)) {
      new Notice("没有找到这个 Obsidian 笔记，请输入库内真实路径。");
      return;
    }
    const bindingValue = { path: file.path, ctime: Number(file?.stat?.ctime) || null };
    await this.updateWorkspaceData((data) => {
      const target = data.paradigmItemsById?.[paradigmItemId];
      if (!target) return;
      target.noteBinding = bindingValue;
      target.updatedAt = nowString();
      if (data.paradigmsById?.[target.paradigmId]) data.paradigmsById[target.paradigmId].updatedAt = nowString();
    });
    new Notice("已写回范式笔记绑定");
  }

  async deleteParadigmItem(paradigmItemId) {
    const item = this.getParadigmItemById(paradigmItemId);
    if (!item) return;
    const idsToDelete = this.collectParadigmSubtreeItemIds(item.paradigmId, paradigmItemId);
    if (idsToDelete.length === 0) return;
    const ok = window.confirm(`确定删除「${sanitizeText(item.title, item.id)}」及其 ${Math.max(0, idsToDelete.length - 1)} 个子条目吗？`);
    if (!ok) return;
    await this.updateWorkspaceData((data) => {
      idsToDelete.forEach((id) => {
        this.removeIdFromSimpleChildrenMap(data.paradigmChildrenByParent, id);
        delete data.paradigmItemsById?.[id];
      });
      Object.keys(data.paradigmToTabItemMapByTab || {}).forEach((scopedKey) => {
        const parsed = parseParadigmMountMapKey(scopedKey);
        if (idsToDelete.includes(parsed.paradigmItemId)) delete data.paradigmToTabItemMapByTab[scopedKey];
      });
      if (data.paradigmsById?.[item.paradigmId]) data.paradigmsById[item.paradigmId].updatedAt = nowString();
    });
    new Notice("已删除范式条目；原挂载处将转为普通条目");
  }

  async moveParadigmItem(draggedParadigmItemId, targetParadigmItemId, position = "after") {
    const dragged = this.getParadigmItemById(draggedParadigmItemId);
    const target = this.getParadigmItemById(targetParadigmItemId);
    if (!dragged || !target || dragged.id === target.id) return;
    if (dragged.paradigmId !== target.paradigmId) {
      new Notice("引用挂载只能在同一范式定义内调整层级。");
      return;
    }
    const nextParentId = position === "child" ? target.id : (target.parentId || null);
    if (this.wouldCreateParadigmItemCycle(dragged.paradigmId, dragged.id, nextParentId)) {
      new Notice("不能把范式条目移动到自己的子级下面。");
      return;
    }
    await this.updateWorkspaceData((data) => {
      const draggedItem = data.paradigmItemsById?.[dragged.id];
      const targetItem = data.paradigmItemsById?.[target.id];
      if (!draggedItem || !targetItem) return;
      this.removeIdFromSimpleChildrenMap(data.paradigmChildrenByParent, dragged.id);
      draggedItem.parentId = nextParentId;
      draggedItem.updatedAt = nowString();
      const scoped = paradigmParentKey(dragged.paradigmId, nextParentId);
      if (!Array.isArray(data.paradigmChildrenByParent[scoped])) data.paradigmChildrenByParent[scoped] = [];
      const siblings = data.paradigmChildrenByParent[scoped];
      if (position === "child") {
        siblings.unshift(dragged.id);
      } else {
        const targetIndex = siblings.indexOf(target.id);
        if (targetIndex < 0) siblings.push(dragged.id);
        else siblings.splice(position === "before" ? targetIndex : targetIndex + 1, 0, dragged.id);
      }
      if (data.paradigmsById?.[dragged.paradigmId]) data.paradigmsById[dragged.paradigmId].updatedAt = nowString();
    });
    new Notice("已写回范式条目层级调整");
  }

  async moveParadigmItemToRoot(paradigmItemId, paradigmId = null) {
    const item = this.getParadigmItemById(paradigmItemId);
    if (!item) return;
    const normalizedParadigmId = sanitizeText(paradigmId, item.paradigmId || "");
    if (!normalizedParadigmId || item.paradigmId !== normalizedParadigmId || item.parentId === null) return;
    await this.updateWorkspaceData((data) => {
      const target = data.paradigmItemsById?.[paradigmItemId];
      if (!target) return;
      this.removeIdFromSimpleChildrenMap(data.paradigmChildrenByParent, paradigmItemId);
      target.parentId = null;
      target.updatedAt = nowString();
      const rootKey = paradigmParentKey(normalizedParadigmId, null);
      if (!Array.isArray(data.paradigmChildrenByParent[rootKey])) data.paradigmChildrenByParent[rootKey] = [];
      data.paradigmChildrenByParent[rootKey].push(paradigmItemId);
      if (data.paradigmsById?.[normalizedParadigmId]) data.paradigmsById[normalizedParadigmId].updatedAt = nowString();
    });
    new Notice("已写回范式条目到根层");
  }

  getParadigmBindingSummaryForTab(tabId) {
    const { rootMapInfo, includedParadigmIds, includedParadigmIdSet, rootParadigmIds } = getOrderedParadigmMountRootIdsForTabData(this.workspaceData, tabId);
    const directRootIds = rootMapInfo.explicitBoundIds.filter((paradigmId) => {
      const parentId = this.workspaceData?.paradigmsById?.[paradigmId]?.parentParadigmId || null;
      return !parentId || !includedParadigmIdSet.has(parentId);
    });
    return {
      rootParadigmIds,
      directRootIds,
      directRootSet: new Set(directRootIds),
      includedParadigmIds,
      includedParadigmIdSet,
      rootMap: rootMapInfo.rootMap,
    };
  }

  pulseFocusTarget(element) {
    if (!element) return;
    element.classList.add("is-focus-pending");
    window.setTimeout(() => element.classList.remove("is-focus-pending"), 1800);
  }

  captureParadigmTocScrollPosition() {
    const toc = this.contentEl?.querySelector?.(".workspace-paradigm-panel-toc");
    if (!toc) return;
    this.paradigmTocScrollTop = Math.max(0, Math.round(Number(toc.scrollTop) || 0));
  }

  restoreParadigmTocScrollPosition(toc) {
    if (!toc) return;
    const nextTop = Math.max(0, Math.round(Number(this.paradigmTocScrollTop) || 0));
    if (nextTop <= 0) return;
    toc.scrollTop = nextTop;
  }

  getWorkspaceScrollContainer() {
    let node = this.contentEl;
    while (node) {
      const overflowY = window.getComputedStyle(node).overflowY;
      if (["auto", "scroll", "overlay"].includes(overflowY) && node.scrollHeight > node.clientHeight + 8) {
        return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement || document.body || null;
  }

  scrollWorkspaceElementToGoldenPoint(targetEl, options = {}) {
    if (!targetEl) return false;
    const scroller = this.getWorkspaceScrollContainer();
    if (!scroller) return false;
    const viewportRatio = Number.isFinite(options.viewportRatio) ? options.viewportRatio : (1 / 3);
    const scrollerIsDocument = scroller === document.scrollingElement
      || scroller === document.documentElement
      || scroller === document.body;
    const scrollerRect = scrollerIsDocument
      ? { top: 0, height: window.innerHeight || document.documentElement.clientHeight || 0 }
      : scroller.getBoundingClientRect();
    const currentScrollTop = Number(scroller.scrollTop) || 0;
    const targetRect = targetEl.getBoundingClientRect();
    const targetTop = currentScrollTop + (targetRect.top - scrollerRect.top);
    const desiredScrollTop = Math.max(0, targetTop - (scrollerRect.height * viewportRatio));
    scroller.scrollTo({
      top: Math.round(desiredScrollTop),
      behavior: options.behavior || "smooth",
    });
    return true;
  }

  restorePinnedScrollPosition(tabId = this.getActiveTabId()) {
    const entry = this.getPinnedScrollEntry(tabId);
    if (!entry) return false;
    const scroller = this.getWorkspaceScrollContainer();
    if (!scroller) return false;
    const maxScrollTop = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
    const nextTop = Math.min(Math.max(0, Number(entry.scrollTop) || 0), maxScrollTop);
    if (Math.abs((scroller.scrollTop || 0) - nextTop) < 2) return true;
    scroller.scrollTo({ top: nextTop, behavior: "auto" });
    return true;
  }

  schedulePinnedScrollRestore(tabId = this.getActiveTabId()) {
    if (this.pendingParadigmFocus) return;
    [0, 120, 360, 900, 1800, 3200].forEach((delay) => {
      window.setTimeout(() => {
        if (this.pendingParadigmFocus) return;
        window.requestAnimationFrame(() => {
          this.restorePinnedScrollPosition(tabId);
        });
      }, delay);
    });
  }

  async pinCurrentScrollPosition(tabId = this.getActiveTabId()) {
    const scroller = this.getWorkspaceScrollContainer();
    if (!scroller) {
      new Notice("未找到可记录的位置容器");
      return;
    }
    const key = this.getScrollPinViewKey(tabId);
    const scrollTop = Math.max(0, Math.round(Number(scroller.scrollTop) || 0));
    this.shouldRestorePinnedScrollAfterRender = true;
    await this.updateWorkspaceData((data) => {
      if (!isObjectLike(data.pinnedScrollByViewKey)) data.pinnedScrollByViewKey = {};
      data.pinnedScrollByViewKey[key] = {
        scrollTop,
        updatedAt: nowString(),
      };
    });
    new Notice(`📌 已固定当前位置：${scrollTop}px`);
  }

  mountFloatingPinButton(tabId = this.getActiveTabId()) {
    if (typeof this.floatingPinCleanup === "function") {
      try { this.floatingPinCleanup(); } catch (_) {}
      this.floatingPinCleanup = null;
    }
    const paneEl = this.contentEl.closest(".view-content")
      || this.contentEl.closest(".workspace-mount-view")
      || this.contentEl.parentElement
      || this.contentEl;
    if (!paneEl || !document.body) return;
    const currentPinnedEntry = this.getPinnedScrollEntry(tabId);
    const btn = document.body.createEl("button", {
      text: currentPinnedEntry ? "📌 已固定" : "📌 Pin",
      cls: `workspace-pin-btn ${currentPinnedEntry ? "is-active" : ""}`.trim(),
      attr: {
        type: "button",
        title: currentPinnedEntry
          ? `已固定当前页面位置：${currentPinnedEntry.scrollTop}px\n点击可更新为当前位置`
          : "把当前页面滚动位置固定到这里；之后重渲染或状态恢复会自动回到这里",
      },
    });
    const updatePosition = () => {
      if (!btn.isConnected) return;
      const rect = paneEl.getBoundingClientRect();
      const visibleWidth = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
      const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      if (visibleWidth < 120 || visibleHeight < 120) {
        btn.style.display = "none";
        return;
      }
      btn.style.display = "";
      const margin = 18;
      const left = Math.max(rect.left + margin, Math.min(window.innerWidth - btn.offsetWidth - margin, rect.right - btn.offsetWidth - margin));
      const top = Math.max(rect.top + margin, Math.min(window.innerHeight - btn.offsetHeight - margin, rect.bottom - btn.offsetHeight - margin));
      btn.style.left = `${Math.round(left)}px`;
      btn.style.top = `${Math.round(top)}px`;
    };
    const onClick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await this.pinCurrentScrollPosition(tabId);
    };
    const onWindowChange = () => updatePosition();
    btn.addEventListener("click", onClick);
    window.addEventListener("resize", onWindowChange, { passive: true });
    window.addEventListener("scroll", onWindowChange, { passive: true, capture: true });
    updatePosition();
    this.floatingPinCleanup = () => {
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange, true);
      btn.removeEventListener("click", onClick);
      if (btn.isConnected) btn.remove();
    };
  }

  flushPendingParadigmFocus() {
    const pending = this.pendingParadigmFocus;
    if (!pending) return;
    this.pendingParadigmFocus = null;
    window.setTimeout(() => {
      let targetEl = null;
      let focusEl = null;
      if (pending.kind === "mount-group") {
        targetEl = Array.from(this.contentEl.querySelectorAll("[data-workspace-paradigm-mount-id]"))
          .find((el) => el.getAttribute("data-workspace-paradigm-mount-id") === pending.paradigmId
            && el.getAttribute("data-workspace-paradigm-mount-tab-id") === pending.tabId) || null;
        focusEl = targetEl?.classList?.contains("workspace-paradigm-mount-group")
          ? targetEl.querySelector(".workspace-paradigm-mount-group-head")
          : targetEl;
      } else if (pending.kind === "tab-section") {
        targetEl = Array.from(this.contentEl.querySelectorAll("[data-workspace-tab-section-id]"))
          .find((el) => el.getAttribute("data-workspace-tab-section-id") === pending.tabId) || null;
        focusEl = targetEl?.querySelector?.(".workspace-tab-section-head") || targetEl;
      } else if (pending.kind === "panel-paradigm") {
        targetEl = Array.from(this.contentEl.querySelectorAll("[data-workspace-paradigm-panel-id]"))
          .find((el) => el.getAttribute("data-workspace-paradigm-panel-id") === pending.paradigmId) || null;
        focusEl = targetEl;
      } else if (pending.kind === "panel-category") {
        targetEl = Array.from(this.contentEl.querySelectorAll("[data-workspace-paradigm-category-id]"))
          .find((el) => el.getAttribute("data-workspace-paradigm-category-id") === pending.categoryId) || null;
        focusEl = targetEl;
      }
      if (!targetEl) return;
      this.scrollWorkspaceElementToGoldenPoint(focusEl || targetEl, { behavior: "smooth", viewportRatio: 1 / 3 });
      this.pulseFocusTarget(targetEl);
    }, 0);
  }

  async revealParadigmMountTarget(tabId, paradigmId) {
    const normalizedTabId = sanitizeText(tabId, "");
    const normalizedParadigmId = sanitizeText(paradigmId, "");
    if (!normalizedTabId || !normalizedParadigmId || !this.getTabById(normalizedTabId) || !this.getParadigmById(normalizedParadigmId)) return false;
    const summary = this.getParadigmBindingSummaryForTab(normalizedTabId);
    if (!summary.includedParadigmIdSet.has(normalizedParadigmId)) {
      new Notice("当前 Tab 没有挂入这个范式。");
      return false;
    }
    this.pendingParadigmFocus = { kind: "mount-group", tabId: normalizedTabId, paradigmId: normalizedParadigmId };
    const expandIds = this.getParadigmAncestorIds(normalizedParadigmId).concat(normalizedParadigmId);
    await this.updateWorkspaceData((data) => {
      data.activeTabId = normalizedTabId;
      if (!isObjectLike(data.paradigmMountCollectionCollapsedByTab)) data.paradigmMountCollectionCollapsedByTab = {};
      data.paradigmMountCollectionCollapsedByTab[normalizedTabId] = false;
      if (!isObjectLike(data.paradigmMountGroupCollapsedByKey)) data.paradigmMountGroupCollapsedByKey = {};
      expandIds.forEach((id) => {
        data.paradigmMountGroupCollapsedByKey[`${normalizedTabId}::${id}`] = false;
      });
    });
    return true;
  }

  async revealWorkspaceTabSection(tabId) {
    const normalizedTabId = sanitizeText(tabId, "");
    if (!normalizedTabId || !this.getTabById(normalizedTabId)) return false;
    this.pendingParadigmFocus = { kind: "tab-section", tabId: normalizedTabId };
    if (!this.getVisibleTabIds(this.getActiveTabId()).includes(normalizedTabId)) {
      await this.setActiveTabId(normalizedTabId);
      return true;
    }
    await this.render();
    return true;
  }

  async revealParadigmPanelTarget(paradigmId) {
    const normalizedParadigmId = sanitizeText(paradigmId, "");
    const paradigm = this.getParadigmById(normalizedParadigmId);
    if (!paradigm) return false;
    this.pendingParadigmFocus = { kind: "panel-paradigm", paradigmId: normalizedParadigmId };
    this.setVisibleUiState({ showParadigmPanel: true, paradigmTocMode: "panel" });
    const categoryExpandIds = paradigm.categoryId
      ? this.getParadigmCategoryAncestorIds(paradigm.categoryId).concat(paradigm.categoryId)
      : [];
    const paradigmExpandIds = this.getParadigmAncestorIds(normalizedParadigmId);
    await this.updateWorkspaceData((data) => {
      if (!isObjectLike(data.paradigmCategoryCollapsedById)) data.paradigmCategoryCollapsedById = {};
      categoryExpandIds.forEach((id) => {
        data.paradigmCategoryCollapsedById[id] = false;
      });
      if (!isObjectLike(data.paradigmTreeCollapsedById)) data.paradigmTreeCollapsedById = {};
      paradigmExpandIds.forEach((id) => {
        data.paradigmTreeCollapsedById[id] = false;
      });
    });
    return true;
  }

  async revealParadigmCategoryTarget(categoryId) {
    const normalizedCategoryId = sanitizeText(categoryId, "");
    const targetCategoryId = normalizedCategoryId || UNCATEGORIZED_PARADIGM_GROUP_ID;
    if (targetCategoryId !== UNCATEGORIZED_PARADIGM_GROUP_ID && !this.getParadigmCategoryById(targetCategoryId)) return false;
    this.pendingParadigmFocus = { kind: "panel-category", categoryId: targetCategoryId };
    this.setVisibleUiState({ showParadigmPanel: true, paradigmTocMode: "panel" });
    const expandIds = targetCategoryId === UNCATEGORIZED_PARADIGM_GROUP_ID
      ? []
      : this.getParadigmCategoryAncestorIds(targetCategoryId).concat(targetCategoryId);
    await this.updateWorkspaceData((data) => {
      if (!isObjectLike(data.paradigmCategoryCollapsedById)) data.paradigmCategoryCollapsedById = {};
      expandIds.forEach((id) => {
        data.paradigmCategoryCollapsedById[id] = false;
      });
    });
    return true;
  }

  getParadigmDisplayInfo(itemOrParadigmId) {
    const directId = typeof itemOrParadigmId === "string" ? sanitizeText(itemOrParadigmId, "") : "";
    const item = directId ? null : itemOrParadigmId;
    const scopeId = directId || sanitizeText(item?.sourceParadigmMountScopeId || item?.sourceParadigmBindingRootId || item?.sourceParadigmId, "");
    const sourceId = directId || sanitizeText(item?.sourceParadigmId || "", "");
    const scopeParadigm = this.getParadigmById(scopeId);
    const sourceParadigm = this.getParadigmById(sourceId);
    const displayParadigm = scopeParadigm || sourceParadigm;
    return {
      scopeId,
      sourceId,
      scopeParadigm,
      sourceParadigm,
      displayParadigm,
      displayName: sanitizeText(displayParadigm?.name, "") || scopeId || sourceId || "未命名范式",
      paletteSeed: sanitizeText(displayParadigm?.id, "") || scopeId || sourceId || "paradigm",
    };
  }

  applyParadigmPalette(element, itemOrParadigmId) {
    if (!element) return;
    const info = this.getParadigmDisplayInfo(itemOrParadigmId);
    const palette = buildParadigmPalette(info.paletteSeed);
    element.style.setProperty("--workspace-paradigm-accent", palette.accent);
    element.style.setProperty("--workspace-paradigm-border", palette.border);
    element.style.setProperty("--workspace-paradigm-bg", palette.bg);
    element.style.setProperty("--workspace-paradigm-bg-strong", palette.bgStrong);
    element.style.setProperty("--workspace-paradigm-chip-bg", palette.chipBg);
    element.style.setProperty("--workspace-paradigm-chip-border", palette.chipBorder);
    return info;
  }

  isParadigmMountedItem(item) {
    return !!item && item.sourceType === "paradigm" && !!sanitizeText(item.sourceParadigmId, "") && !!sanitizeText(item.sourceParadigmItemId, "");
  }

  isReadonlyParadigmMountedItem(item) {
    return this.isParadigmMountedItem(item);
  }

  isParadigmMountGroupCollapsed(tabId, paradigmId) {
    return this.workspaceData?.paradigmMountGroupCollapsedByKey?.[`${sanitizeText(tabId, "")}::${sanitizeText(paradigmId, "")}`] === true;
  }

  isParadigmMountCollectionCollapsed(tabId) {
    return this.workspaceData?.paradigmMountCollectionCollapsedByTab?.[sanitizeText(tabId, "")] === true;
  }

  async toggleParadigmMountGroupCollapsed(tabId, paradigmId) {
    const tabKey = sanitizeText(tabId, "");
    const paradigmKey = sanitizeText(paradigmId, "");
    if (!tabKey || !paradigmKey) return;
    await this.updateWorkspaceData((data) => {
      if (!isObjectLike(data.paradigmMountGroupCollapsedByKey)) data.paradigmMountGroupCollapsedByKey = {};
      const scopedKey = `${tabKey}::${paradigmKey}`;
      data.paradigmMountGroupCollapsedByKey[scopedKey] = data.paradigmMountGroupCollapsedByKey[scopedKey] !== true;
    });
  }

  async toggleParadigmMountCollectionCollapsed(tabId) {
    const tabKey = sanitizeText(tabId, "");
    if (!tabKey) return;
    await this.updateWorkspaceData((data) => {
      if (!isObjectLike(data.paradigmMountCollectionCollapsedByTab)) data.paradigmMountCollectionCollapsedByTab = {};
      data.paradigmMountCollectionCollapsedByTab[tabKey] = data.paradigmMountCollectionCollapsedByTab[tabKey] !== true;
    });
  }

  resolveBoundFile(noteBinding) {
    if (!noteBinding) return null;
    const path = typeof noteBinding === "string"
      ? sanitizeText(noteBinding, "")
      : sanitizeText(noteBinding?.path, "");
    if (!path) return null;
    return this.resolveExistingNoteFile(path);
  }

  resolveImageFile(imageRef) {
    const normalized = normalizeImageRef(imageRef);
    if (!normalized) return null;
    if (/^https?:\/\//i.test(normalized)) return { url: normalized, file: null };
    const exact = this.app.vault.getAbstractFileByPath(normalized);
    if (exact instanceof TFile) return { url: this.app.vault.getResourcePath(exact), file: exact };
    const files = this.app.vault.getFiles();
    const basename = normalized.split("/").pop() || normalized;
    const match = files.find((file) => file.path === normalized || file.name === basename);
    if (match instanceof TFile) return { url: this.app.vault.getResourcePath(match), file: match };
    return { url: "", file: null };
  }

  getCurrentFolderPath() {
    return sanitizeText(this.sourceFile?.parent?.path, "");
  }

  resolveExistingVaultFile(rawPath) {
    const clean = sanitizeShortcutTargetInput(rawPath);
    if (!clean) return null;
    const normalizedClean = clean.replace(/^\/+/, "");
    const currentFolderPath = this.getCurrentFolderPath()
      ? `${this.getCurrentFolderPath()}/${normalizedClean}`.replace(/^\/+/, "")
      : "";
    const sourcePath = sanitizeText(this.sourceFile?.path, "");
    const exact = this.app.vault.getAbstractFileByPath(normalizedClean);
    if (exact instanceof TFile) return exact;
    if (currentFolderPath) {
      const local = this.app.vault.getAbstractFileByPath(currentFolderPath);
      if (local instanceof TFile) return local;
    }
    const linked = this.app.metadataCache.getFirstLinkpathDest(normalizedClean, sourcePath);
    if (linked instanceof TFile) return linked;
    const noExt = normalizedClean.replace(/\.md$/i, "");
    const linkedNoExt = this.app.metadataCache.getFirstLinkpathDest(noExt, sourcePath);
    if (linkedNoExt instanceof TFile) return linkedNoExt;
    const basename = normalizedClean.split(/[\\/]/).pop()?.toLowerCase() || "";
    return this.app.vault.getFiles().find((file) => file.name.toLowerCase() === basename) || null;
  }

  resolveExistingNoteFile(rawPath) {
    const clean = sanitizeShortcutTargetInput(rawPath);
    if (!clean) return null;
    const normalizedClean = clean.replace(/\\/g, "/").replace(/^\/+/, "");
    const noExt = normalizedClean.replace(/\.md$/i, "");
    const withExt = normalizedClean.endsWith(".md") ? normalizedClean : `${normalizedClean}.md`;
    const lowerClean = normalizedClean.toLowerCase();
    const lowerNoExt = noExt.toLowerCase();
    const lowerWithExt = withExt.toLowerCase();
    if (!this.resolvedNoteFileCache || (Date.now() - this.resolvedNoteFileCache.builtAt) > 30000) {
      this.resolvedNoteFileCache = { builtAt: Date.now(), map: new Map() };
    }
    const resolvedCache = this.resolvedNoteFileCache.map;
    const cacheKey = lowerWithExt || lowerClean;
    if (resolvedCache.has(cacheKey)) return resolvedCache.get(cacheKey);
    const aliasedPath = this.evaNoteAliasMap.get(lowerClean)
      || this.evaNoteAliasMap.get(lowerWithExt)
      || this.evaNoteAliasMap.get(lowerNoExt)
      || this.evaNoteAliasMap.get(lowerNoExt.split("/").pop() || lowerNoExt)
      || normalizedClean;
    const aliasedNoExt = aliasedPath.replace(/\.md$/i, "");
    const sourcePath = sanitizeText(this.sourceFile?.path, "");
    const hit = this.app.vault.getAbstractFileByPath(normalizedClean)
      || this.app.vault.getAbstractFileByPath(withExt)
      || this.app.vault.getAbstractFileByPath(aliasedPath)
      || this.app.metadataCache.getFirstLinkpathDest(normalizedClean, sourcePath)
      || this.app.metadataCache.getFirstLinkpathDest(noExt, sourcePath)
      || this.app.metadataCache.getFirstLinkpathDest(noExt.split("/").pop() || noExt, sourcePath)
      || this.app.metadataCache.getFirstLinkpathDest(aliasedNoExt, sourcePath)
      || null;
    const resolved = hit instanceof TFile && hit.extension === "md" ? hit : null;
    resolvedCache.set(cacheKey, resolved);
    return resolved;
  }

  resolveExistingNotePath(rawPath) {
    const file = this.resolveExistingNoteFile(rawPath);
    return file ? file.path : null;
  }

  isLikelyAbsoluteFsPath(value) {
    return /^(?:[a-zA-Z]:[\\/]|\\\\|\/(?!\/))/.test(String(value || "").trim());
  }

  isLikelyExternalUrl(value) {
    return /^(?:https?:\/\/|file:\/\/)/i.test(String(value || "").trim());
  }

  resolveShortcutNoteFile(rawValue) {
    let text = String(rawValue || "").trim();
    if (!text) return null;
    if (/^obsidian:\/\/open\?/i.test(text)) {
      try {
        const url = new URL(text);
        const fileParam = url.searchParams.get("file") || url.searchParams.get("path") || "";
        if (fileParam) text = decodeURIComponent(fileParam);
      } catch (_) {}
    }
    if (/^file:\/\//i.test(text)) {
      try {
        text = decodeURIComponent(text.replace(/^file:\/\/\/?/i, ""));
      } catch (_) {
        text = text.replace(/^file:\/\/\/?/i, "");
      }
    }
    return this.resolveExistingNoteFile(sanitizeShortcutTargetInput(text));
  }

  getShortcutDisplayLabel(entryLike) {
    const entry = entryLike && typeof entryLike === "object" ? entryLike : {};
    const explicit = normalizeShortcutLabel(entry.label || "");
    if (explicit) return explicit;
    const cleanPath = sanitizeShortcutTargetInput(entry.path || "");
    if (!cleanPath) return "未命名快捷方式";
    const last = cleanPath.split(/[\\/]/).pop() || cleanPath;
    return last.replace(/\.(md|lnk|url)$/i, "") || cleanPath;
  }

  buildShortcutEntryFromFile(file, previous = null) {
    if (!(file instanceof TFile)) return null;
    return {
      id: String(previous?.id || `shortcut_${createId("sc")}`).trim() || `shortcut_${createId("sc")}`,
      path: file.path,
      label: normalizeShortcutLabel(previous?.label || file.basename || ""),
      ctime: Number.isFinite(file?.stat?.ctime) ? Number(file.stat.ctime) : null,
      createdAt: previous?.createdAt || nowString(),
      updatedAt: nowString(),
    };
  }

  buildShortcutEntryFromExternalPath(rawPath, previous = null) {
    const clean = String(rawPath || "").trim();
    if (!clean) return null;
    const fallbackLabel = clean.split(/[\\/]/).pop()?.replace(/\.(md|lnk|url)$/i, "") || clean;
    return {
      id: String(previous?.id || `shortcut_${createId("sc")}`).trim() || `shortcut_${createId("sc")}`,
      path: clean,
      label: normalizeShortcutLabel(previous?.label || fallbackLabel),
      ctime: null,
      createdAt: previous?.createdAt || nowString(),
      updatedAt: nowString(),
    };
  }

  resolveShortcutEntryFromRawInput(rawValue) {
    const text = String(rawValue || "").trim();
    if (!text) return null;
    const noteFile = this.resolveShortcutNoteFile(text);
    if (noteFile) return this.buildShortcutEntryFromFile(noteFile);
    const vaultFile = this.resolveExistingVaultFile(text);
    if (vaultFile) return this.buildShortcutEntryFromFile(vaultFile);
    if (this.isLikelyExternalUrl(text) || this.isLikelyAbsoluteFsPath(text)) {
      return this.buildShortcutEntryFromExternalPath(text);
    }
    return null;
  }

  resolveShortcutEntryFromDrop(dataTransfer) {
    if (!dataTransfer) return null;
    const uriText = String(dataTransfer.getData("text/uri-list") || "").trim();
    const plainText = String(dataTransfer.getData("text/plain") || "").trim();
    const candidates = []
      .concat(uriText ? uriText.split(/\r?\n/) : [])
      .concat(plainText ? plainText.split(/\r?\n/) : [])
      .concat(Array.from(dataTransfer.files || []).map((file) => String(file?.path || file?.name || "").trim()))
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    for (const candidate of candidates) {
      const entry = this.resolveShortcutEntryFromRawInput(candidate);
      if (entry) return entry;
    }
    return null;
  }

  async getShortcutPreviewMeta(entryLike) {
    const entry = entryLike && typeof entryLike === "object" ? entryLike : {};
    const rawPath = String(entry.path || "").trim();
    if (!rawPath) {
      return { kind: "unknown", title: "未识别快捷方式", subtitle: "", detail: "" };
    }
    const noteFile = this.resolveShortcutNoteFile(rawPath);
    if (noteFile) {
      return {
        kind: "note",
        title: noteFile.basename || this.getShortcutDisplayLabel(entry),
        subtitle: `笔记文件：${noteFile.name}`,
        detail: noteFile.path,
      };
    }
    const vaultFile = this.resolveExistingVaultFile(rawPath);
    if (vaultFile) {
      return {
        kind: "file",
        title: this.getShortcutDisplayLabel(entry),
        subtitle: `文件名：${vaultFile.name}`,
        detail: vaultFile.path,
      };
    }
    if (this.isLikelyExternalUrl(rawPath)) {
      let hostname = "";
      try { hostname = new URL(rawPath).hostname || ""; } catch (_) {}
      return {
        kind: "web",
        title: this.getShortcutDisplayLabel(entry),
        subtitle: hostname ? `网页链接 · ${hostname}` : "网页链接",
        detail: rawPath,
      };
    }
    return {
      kind: "file",
      title: this.getShortcutDisplayLabel(entry),
      subtitle: "文件快捷方式",
      detail: rawPath,
    };
  }

  async openShortcutPreview(entryLike) {
    const entry = entryLike && typeof entryLike === "object" ? entryLike : {};
    const meta = await this.getShortcutPreviewMeta(entry);
    const previewModal = new Modal(this.app);
    previewModal.modalEl.style.maxWidth = "680px";
    previewModal.modalEl.style.width = "84vw";
    previewModal.contentEl.createEl("h3", { text: `快捷方式预览：${this.getShortcutDisplayLabel(entry)}` });
    const summary = previewModal.contentEl.createDiv({ cls: "workspace-shortcut-preview" });
    summary.createEl("div", { text: meta.title || this.getShortcutDisplayLabel(entry), cls: "workspace-shortcut-label" });
    summary.createEl("div", { text: meta.subtitle || "", cls: "workspace-shortcut-subtitle" });
    summary.createEl("div", { text: meta.detail || entry.path || "", cls: "workspace-shortcut-path" });
    const actions = previewModal.contentEl.createDiv({ cls: "workspace-modal-actions" });
    const openBtn = actions.createEl("button", { text: "打开", cls: "mod-cta" });
    openBtn.onclick = async () => { await this.activateShortcutEntry(entry); };
    const closeBtn = actions.createEl("button", { text: "关闭" });
    closeBtn.onclick = () => previewModal.close();
    previewModal.open();
  }

  async activateShortcutEntry(entryLike) {
    const entry = entryLike && typeof entryLike === "object" ? entryLike : null;
    if (!entry?.path) {
      new Notice("快捷方式缺少目标路径");
      return false;
    }
    const noteFile = this.resolveShortcutNoteFile(entry.path);
    if (noteFile) {
      await this.app.workspace.getLeaf(true).openFile(noteFile);
      return true;
    }
    if (this.isLikelyExternalUrl(entry.path)) {
      window.open?.(entry.path, "_blank", "noopener");
      return true;
    }
    const vaultFile = this.resolveExistingVaultFile(entry.path);
    if (vaultFile && typeof this.app.openWithDefaultApp === "function") {
      await this.app.openWithDefaultApp(vaultFile);
      return true;
    }
    new Notice(`当前环境无法打开快捷方式：${entry.path}`);
    return false;
  }

  async activateShortcutEntries(title, entriesLike) {
    const entries = normalizeShortcutEntries(entriesLike || []);
    if (entries.length === 0) {
      new Notice("这个条目还没有快捷方式，请先到图片弹窗里拖入");
      return;
    }
    if (entries.length === 1) {
      await this.activateShortcutEntry(entries[0]);
      return;
    }
    const modal = new Modal(this.app);
    modal.modalEl.style.maxWidth = "720px";
    modal.modalEl.style.width = "84vw";
    modal.contentEl.createEl("h3", { text: title || "快捷方式" });
    modal.contentEl.createEl("div", {
      text: `选择要激活的快捷方式（共 ${entries.length} 个）`,
      cls: "workspace-modal-desc",
    });
    const list = modal.contentEl.createDiv({ cls: "workspace-shortcut-list" });
    for (const entry of entries) {
      const row = list.createDiv({ cls: "workspace-shortcut-row" });
      const meta = row.createDiv({ cls: "workspace-shortcut-meta" });
      meta.createEl("div", {
        text: `↗ ${this.getShortcutDisplayLabel(entry)}`,
        cls: "workspace-shortcut-label",
      });
      const metaInfo = await this.getShortcutPreviewMeta(entry);
      if (metaInfo?.subtitle) {
        meta.createEl("div", {
          text: metaInfo.subtitle,
          cls: "workspace-shortcut-subtitle",
        });
      }
      meta.createEl("div", {
        text: metaInfo?.detail || sanitizeText(entry?.path, ""),
        cls: "workspace-shortcut-path",
      });
      const actions = row.createDiv({ cls: "workspace-shortcut-row-actions" });
      const previewBtn = actions.createEl("button", { text: "预览" });
      previewBtn.onclick = async () => {
        await this.openShortcutPreview(entry);
      };
      const openBtn = actions.createEl("button", { text: "打开", cls: "mod-cta" });
      openBtn.onclick = async () => {
        await this.activateShortcutEntry(entry);
        modal.close();
      };
    }
    const actions = modal.contentEl.createDiv({ cls: "workspace-modal-actions" });
    const closeBtn = actions.createEl("button", { text: "关闭" });
    closeBtn.onclick = () => modal.close();
    modal.open();
  }

  async activateParadigmItemShortcuts(paradigmItemId) {
    const item = this.getParadigmItemById(paradigmItemId);
    if (!item) return;
    await this.activateShortcutEntries(`快捷方式：${item.title || item.id}`, this.getParadigmItemShortcutEntries(item));
  }

  async savePastedImage(file) {
    const mime = String(file?.type || "").toLowerCase();
    const ext = mime.includes("png")
      ? "png"
      : (mime.includes("jpeg") || mime.includes("jpg"))
        ? "jpg"
        : mime.includes("webp")
          ? "webp"
          : mime.includes("gif")
            ? "gif"
            : "png";
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const baseName = `Pasted image ${stamp}`;
    if (!await this.app.vault.adapter.exists(ATTACHMENTS_FOLDER)) {
      await this.app.vault.createFolder(ATTACHMENTS_FOLDER);
    }
    let finalName = `${baseName}.${ext}`;
    let finalPath = `${ATTACHMENTS_FOLDER}/${finalName}`;
    let idx = 1;
    while (await this.app.vault.adapter.exists(finalPath)) {
      finalName = `${baseName}-${idx}.${ext}`;
      finalPath = `${ATTACHMENTS_FOLDER}/${finalName}`;
      idx += 1;
    }
    const buffer = await file.arrayBuffer();
    await this.app.vault.createBinary(finalPath, buffer);
    return { fileName: finalName, filePath: finalPath, embedLink: `![[${finalName}]]` };
  }

  openImagePreview(imageRef) {
    const preview = this.resolveImageFile(imageRef);
    if (!preview?.url) {
      new Notice("当前图片引用无法解析为可预览图片");
      return;
    }
    const previewModal = new Modal(this.app);
    previewModal.modalEl.style.maxWidth = "92vw";
    previewModal.modalEl.style.width = "92vw";
    previewModal.modalEl.style.height = "88vh";
    previewModal.contentEl.style.height = "100%";
    previewModal.contentEl.style.display = "flex";
    previewModal.contentEl.style.flexDirection = "column";
    previewModal.contentEl.style.gap = "10px";
    previewModal.contentEl.createEl("h3", { text: "查看图片" });
    previewModal.contentEl.createEl("div", { text: String(imageRef || "").trim(), cls: "workspace-shortcut-path" });
    const wrap = previewModal.contentEl.createDiv({ cls: "workspace-image-preview-full" });
    const img = wrap.createEl("img", { cls: "workspace-image-preview-full-img" });
    img.src = preview.url;
    img.alt = String(imageRef || "").trim();
    const actions = previewModal.contentEl.createDiv({ cls: "workspace-modal-actions" });
    const closeBtn = actions.createEl("button", { text: "关闭", cls: "mod-cta" });
    closeBtn.onclick = () => previewModal.close();
    previewModal.open();
  }

  buildVaultIndexFromFiles(files) {
    return (Array.isArray(files) ? files : []).map((file) => ({
      path: file.path,
      basename: file.basename,
      basenameLower: file.basename.toLowerCase(),
      pathLower: file.path.toLowerCase(),
      search: `${file.basename} ${file.path}`.toLowerCase(),
    })).sort((a, b) => a.basename.localeCompare(b.basename, "zh"));
  }

  buildVaultIndexFromEvaNotes(evaNotes) {
    const items = [];
    Object.values(evaNotes || {}).forEach((note) => {
      const path = typeof note?.file_path === "string" ? note.file_path : null;
      if (!path) return;
      const fileName = typeof note?.file_name === "string" ? note.file_name : path.split("/").pop();
      const basename = (fileName || path).replace(/\.md$/i, "");
      const title = typeof note?.title === "string" ? note.title : "";
      const pathLower = path.toLowerCase();
      const basenameLower = basename.toLowerCase();
      items.push({
        path,
        basename,
        basenameLower,
        pathLower,
        search: `${basenameLower} ${pathLower} ${title.toLowerCase()}`.trim(),
      });
    });
    return items.sort((a, b) => a.basename.localeCompare(b.basename, "zh"));
  }

  async loadEvaNoteIndex() {
    const localFolder = sanitizeText(this.sourceFile?.parent?.path, "");
    const localPath = (filename) => (localFolder ? `${localFolder}/${filename}` : filename);
    const candidates = [localPath("EVA_Notes.json")].concat(EVA_NOTES_CANDIDATE_PATHS);
    const seen = new Set();
    for (const path of candidates) {
      const normalized = sanitizeText(path, "");
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      try {
        if (!await this.app.vault.adapter.exists(normalized)) continue;
        const content = await this.app.vault.adapter.read(normalized);
        const parsed = JSON.parse(content);
        if (parsed && parsed.notes && typeof parsed.notes === "object") {
          const items = this.buildVaultIndexFromEvaNotes(parsed.notes);
          if (items.length > 0) {
            const aliasMap = new Map();
            for (const item of items) {
              const full = sanitizeText(item.path, "").replace(/^\/+/, "");
              const noExt = full.replace(/\.md$/i, "");
              const base = noExt.split("/").pop() || noExt;
              if (!full) continue;
              aliasMap.set(full.toLowerCase(), full);
              aliasMap.set(noExt.toLowerCase(), full);
              aliasMap.set(base.toLowerCase(), full);
            }
            this.evaNoteAliasMap = aliasMap;
            return { path: normalized, items };
          }
        }
      } catch (error) {
        console.error("[Workspace Mount] load EVA_Notes.json failed:", normalized, error);
      }
    }
    return null;
  }

  async getVaultNoteIndex() {
    const cache = this.vaultNoteIndexCache || { items: [], builtAt: 0, source: "none", sourcePath: null };
    const now = Date.now();
    if (cache.items.length > 0 && (now - cache.builtAt) <= 30000) return cache.items;
    const eva = await this.loadEvaNoteIndex();
    if (eva && eva.items.length > 0) {
      this.vaultNoteIndexCache = {
        items: eva.items,
        builtAt: now,
        source: "eva",
        sourcePath: eva.path,
      };
      return eva.items;
    }
    this.evaNoteAliasMap = new Map();
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const items = this.buildVaultIndexFromFiles(markdownFiles);
    this.vaultNoteIndexCache = {
      items,
      builtAt: now,
      source: "vault",
      sourcePath: null,
    };
    return items;
  }

  getItemNoteBinding(itemOrId) {
    const item = typeof itemOrId === "string" ? this.getItemById(itemOrId) : itemOrId;
    const itemId = sanitizeText(typeof itemOrId === "string" ? itemOrId : item?.id, "");
    const inlineBinding = item?.noteBinding ? deepClone(item.noteBinding, null) : null;
    if (inlineBinding) return inlineBinding;
    return itemId ? deepClone(this.taskNoteBindings?.[itemId], null) : null;
  }

  getItemComment(itemOrId) {
    const item = typeof itemOrId === "string" ? this.getItemById(itemOrId) : itemOrId;
    const itemId = sanitizeText(typeof itemOrId === "string" ? itemOrId : item?.id, "");
    const inlineComment = typeof item?.comment === "string" ? item.comment : "";
    if (inlineComment) return inlineComment;
    return itemId ? sanitizeText(this.taskComments?.[itemId], "") : "";
  }

  getParadigmItemNoteBinding(itemOrId) {
    const item = typeof itemOrId === "string" ? this.getParadigmItemById(itemOrId) : itemOrId;
    return item?.noteBinding ? deepClone(item.noteBinding, null) : null;
  }

  getParadigmItemComment(itemOrId) {
    const item = typeof itemOrId === "string" ? this.getParadigmItemById(itemOrId) : itemOrId;
    return typeof item?.comment === "string" ? item.comment : "";
  }

  getParadigmItemShortcutEntries(itemOrId) {
    const item = typeof itemOrId === "string" ? this.getParadigmItemById(itemOrId) : itemOrId;
    return normalizeShortcutEntries(item?.shortcuts || []);
  }

  async promptForText(options = {}) {
    const modal = new WorkspaceTextInputModal(this.app, options);
    return await modal.waitForResult();
  }

  async editImageRefModal(options = {}) {
    const modal = new WorkspaceImageEditorModal(this.app, {
      ...options,
      shortcutEntries: normalizeShortcutEntries(options?.shortcutEntries || []),
      resolvePreview: (imageRef) => this.resolveImageFile(imageRef),
      openImagePreview: (imageRef) => this.openImagePreview(imageRef),
      savePastedImage: async (file) => await this.savePastedImage(file),
      resolveShortcutEntryFromRawInput: (rawValue) => this.resolveShortcutEntryFromRawInput(rawValue),
      resolveShortcutEntryFromDrop: (dataTransfer) => this.resolveShortcutEntryFromDrop(dataTransfer),
      getShortcutDisplayLabel: (entry) => this.getShortcutDisplayLabel(entry),
      getShortcutPreviewMeta: async (entry) => await this.getShortcutPreviewMeta(entry),
      openShortcutPreview: async (entry) => await this.openShortcutPreview(entry),
    });
    return await modal.waitForResult();
  }

  async editNoteBindingModal(options = {}) {
    const modal = new WorkspaceNoteBindingModal(this.app, {
      ...options,
      noteIndex: await this.getVaultNoteIndex(),
    });
    return await modal.waitForResult();
  }

  async editCommentModal(options = {}) {
    const modal = new WorkspaceCommentEditorModal(this.app, options);
    return await modal.waitForResult();
  }

  async pickParadigm(options = {}) {
    const modal = new WorkspaceParadigmPickerModal(this.app, options);
    return await modal.waitForResult();
  }

  async editParadigmTagsModal(options = {}) {
    const modal = new WorkspaceParadigmTagPickerModal(this.app, {
      ...options,
      tagsById: this.workspaceData?.paradigmTagsById || {},
      selectedIds: normalizeParadigmTagIds(options?.selectedIds || [], this.workspaceData?.paradigmTagsById || {}),
    });
    return await modal.waitForResult();
  }

  async openBoundNote(noteBinding) {
    const file = this.resolveBoundFile(noteBinding);
    if (!(file instanceof TFile)) {
      new Notice("未找到绑定笔记。");
      return;
    }
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  wouldCreateItemCycle(draggedId, nextParentId) {
    let cursor = sanitizeText(nextParentId, "") || null;
    const seen = new Set([draggedId]);
    while (cursor) {
      if (seen.has(cursor)) return true;
      seen.add(cursor);
      cursor = sanitizeText(this.workspaceData?.itemsById?.[cursor]?.parentId, "") || null;
    }
    return false;
  }

  async updateWorkspaceData(operationFn) {
    if (!this.isBoundToRealSource()) {
      new Notice("Workspace Mount is not bound to a real source note yet.");
      return false;
    }
    const next = normalizeWorkspaceData(this.workspaceData);
    operationFn(next);
    syncParadigmAcrossTabsInData(next);
    this.workspaceData = await this.plugin.saveWorkspaceData(this.dataPaths?.dataPath, next);
    await this.render();
    return true;
  }

  setParadigmTagIdsInData(data, paradigmId, nextTagIds = []) {
    ensureParadigmTagState(data);
    const sourceParadigmId = getParadigmSourceIdInData(data, paradigmId);
    const target = data.paradigmsById?.[sourceParadigmId];
    if (!target) return;
    target.tagIds = normalizeParadigmTagIds(nextTagIds, data.paradigmTagsById || {});
    target.updatedAt = nowString();
  }

  async setParadigmTagsForParadigm(paradigmId, nextTagIds = []) {
    const paradigm = this.getParadigmById(paradigmId);
    if (!paradigm) return false;
    const ok = await this.updateWorkspaceData((data) => {
      this.setParadigmTagIdsInData(data, paradigm.id, nextTagIds);
    });
    if (ok) new Notice("✅ 范式标签已更新");
    return ok;
  }

  async promptParadigmTagAssignment(paradigmId) {
    const paradigm = this.getParadigmById(paradigmId);
    if (!paradigm) return false;
    const selected = await this.editParadigmTagsModal({
      title: `设置范式标签：${this.getParadigmNodeLabel(paradigm)}`,
      selectedIds: this.getParadigmTagIds(paradigm),
    });
    if (selected === null) return false;
    return await this.setParadigmTagsForParadigm(paradigm.id, selected);
  }

  async editParadigmTagDefinition(options = {}) {
    const modal = new WorkspaceParadigmTagDefinitionModal(this.app, {
      ...options,
      tagsById: this.workspaceData?.paradigmTagsById || {},
      getTagPathLabel: (tagId) => this.getParadigmTagPathLabel(tagId),
      getDescendantIds: (tagId) => this.getParadigmTagDescendantIds(tagId),
    });
    const result = await modal.waitForResult();
    if (result === null) return false;
    const editingTagId = sanitizeText(options.tagId, "");
    let cycleDetected = false;
    const ok = await this.updateWorkspaceData((data) => {
      ensureParadigmTagState(data);
      const now = nowString();
      const nextParentTagId = result.parentTagId && data.paradigmTagsById?.[result.parentTagId] ? result.parentTagId : null;
      const tagId = editingTagId || `pgTag_${createId("tag")}`;
      const existing = data.paradigmTagsById?.[tagId] || null;
      if (nextParentTagId && wouldCreateParadigmTagCycleInData(data, tagId, nextParentTagId)) {
        cycleDetected = true;
        return;
      }
      if (!isObjectLike(data.paradigmTagsById)) data.paradigmTagsById = {};
      const siblingCount = getChildParadigmTagIdsFromData(data, nextParentTagId).filter((id) => id !== tagId).length;
      data.paradigmTagsById[tagId] = {
        id: tagId,
        label: result.label,
        color: normalizeTabAccentColor(result.color) || getDefaultParadigmTagColor(result.label || tagId),
        parentTagId: nextParentTagId,
        order: existing && existing.parentTagId === nextParentTagId && Number.isFinite(existing.order) ? existing.order : siblingCount,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      ensureParadigmTagState(data);
    });
    if (cycleDetected) {
      new Notice("⚠️ 不能把标签移动到自己的子标签下面");
      return false;
    }
    if (!ok) return false;
    new Notice(editingTagId ? "✅ 范式标签已更新" : "✅ 范式标签已创建");
    return true;
  }

  async moveParadigmTagOrder(draggedIdRaw, targetIdRaw = null, position = "after") {
    const draggedId = sanitizeText(draggedIdRaw, "");
    const targetId = sanitizeText(targetIdRaw, "");
    if (!draggedId || !this.getParadigmTagById(draggedId)) return false;
    if (targetId && (!this.getParadigmTagById(targetId) || targetId === draggedId)) return false;
    const nextParentTagId = !targetId
      ? null
      : (position === "child" ? targetId : (this.getParadigmTagById(targetId)?.parentTagId || null));
    if (nextParentTagId && wouldCreateParadigmTagCycleInData(this.workspaceData, draggedId, nextParentTagId)) {
      new Notice("⚠️ 不能把标签拖到自己的子标签下面");
      return false;
    }
    return await this.updateWorkspaceData((data) => {
      ensureParadigmTagState(data);
      const dragged = data.paradigmTagsById?.[draggedId];
      if (!dragged) return;
      if (nextParentTagId && wouldCreateParadigmTagCycleInData(data, draggedId, nextParentTagId)) return;
      const siblingIds = getChildParadigmTagIdsFromData(data, nextParentTagId).filter((id) => id !== draggedId);
      dragged.parentTagId = nextParentTagId;
      dragged.updatedAt = nowString();
      if (!targetId) siblingIds.push(draggedId);
      else if (position === "child") siblingIds.unshift(draggedId);
      else {
        const targetIndex = siblingIds.indexOf(targetId);
        if (targetIndex < 0) siblingIds.push(draggedId);
        else siblingIds.splice(position === "before" ? targetIndex : targetIndex + 1, 0, draggedId);
      }
      siblingIds.forEach((id, idx) => {
        if (data.paradigmTagsById?.[id]) data.paradigmTagsById[id].order = idx;
      });
      ensureParadigmTagState(data);
    });
  }

  async deleteParadigmTag(tagIdRaw) {
    const tagId = sanitizeText(tagIdRaw, "");
    const tag = this.getParadigmTagById(tagId);
    if (!tag) return false;
    const childCount = this.getSortedParadigmTagChildrenIds(tag.id).length;
    const usageCount = this.getDirectParadigmTagUsageCount(tag.id);
    if (childCount > 0) {
      new Notice("⚠️ 请先移动或删除它的子标签");
      return false;
    }
    if (usageCount > 0) {
      new Notice(`⚠️ 该标签仍被 ${usageCount} 个范式使用，请先移除`);
      return false;
    }
    const ok = window.confirm(`确定删除标签 "${sanitizeText(tag.label, tag.id)}" 吗？`);
    if (!ok) return false;
    const removed = await this.updateWorkspaceData((data) => {
      ensureParadigmTagState(data);
      delete data.paradigmTagsById?.[tagId];
      Object.values(data.paradigmsById || {}).forEach((paradigm) => {
        if (!paradigm) return;
        paradigm.tagIds = normalizeParadigmTagIds((paradigm.tagIds || []).filter((id) => id !== tagId), data.paradigmTagsById || {});
      });
      ensureParadigmTagState(data);
    });
    if (!removed) return false;
    this.setParadigmTagFilters(this.getParadigmTagFilters().filter((id) => id !== tagId));
    await this.render();
    new Notice("🗑️ 范式标签已删除");
    return true;
  }

  isBoundToRealSource() {
    return this.sourceFile instanceof TFile && !!sanitizeText(this.dataPaths?.dataPath, "");
  }

  resolveDataPaths(sourceFile) {
    const folderPath = sanitizeText(sourceFile?.parent?.path, "");
    const build = (filename) => (folderPath ? `${folderPath}/${filename}` : filename);
    return {
      dataPath: build(JSON_FILENAME),
      bindingsPath: build(TASK_NOTE_BINDINGS_FILENAME),
      commentsPath: build(TASK_COMMENTS_FILENAME),
    };
  }

  async reloadWorkspace() {
    this.lastLoadWarning = "";
    this.sourceFile = this.plugin.resolveSourceFile(this.sourceNotePath);
    if (!(this.sourceFile instanceof TFile)) {
      this.dataPaths = null;
      this.workspaceData = defaultWorkspaceData();
      this.taskNoteBindings = {};
      this.taskComments = {};
      this.lastLoadWarning = `Source note not found: ${this.sourceNotePath}`;
      await this.render();
      return;
    }

    this.sourceNotePath = this.sourceFile.path;
    this.dataPaths = this.resolveDataPaths(this.sourceFile);
    this.workspaceData = await this.plugin.loadWorkspaceData(this.dataPaths.dataPath);
    this.taskNoteBindings = await this.plugin.loadTaskNoteBindings(this.dataPaths.bindingsPath);
    this.taskComments = await this.plugin.loadTaskComments(this.dataPaths.commentsPath);
    syncParadigmAcrossTabsInData(this.workspaceData);
    await this.render();
  }

  getBridgeState() {
    return {
      schemaVersion: 1,
      notePath: this.sourceNotePath,
      dataPath: this.dataPaths?.dataPath || "",
      capturedAt: nowString(),
      activeTabId: this.getActiveTabId(),
      tabOrder: ensureUniqueIds(this.workspaceData?.tabOrder || []).filter((id) => !!this.workspaceData?.tabsById?.[id]),
      tabTreeCollapsedById: deepClone(this.workspaceData?.tabTreeCollapsedById || {}, {}),
      collapsedById: deepClone(this.workspaceData?.collapsedById || {}, {}),
      pinnedScrollByViewKey: deepClone(this.workspaceData?.pinnedScrollByViewKey || {}, {}),
      visibleUiState: normalizeVisibleUiState(this.visibleUiState),
      tabState: {
        tabsById: deepClone(this.workspaceData?.tabsById || {}, {}),
        childrenByParentByTab: deepClone(this.workspaceData?.childrenByParentByTab || {}, {}),
      },
      snapshotMeta: {
        snapshotOrderByTab: deepClone(this.workspaceData?.snapshotOrderByTab || {}, {}),
        snapshotIds: Object.keys(this.workspaceData?.snapshotsById || {}),
      },
      meta: {
        bridgeVersion: WORKSPACE_CAPSULE_BRIDGE_VERSION,
        scriptVersion: WORKSPACE_SCRIPT_VERSION,
        host: "workspace-mount-plugin",
      },
    };
  }

  async applyBridgeState(rawState = {}, options = {}) {
    if (!this.isBoundToRealSource()) {
      return {
        ok: false,
        applied: [],
        skipped: ["workspaceMount"],
        warnings: ["Workspace Mount view is not bound to a real source note."],
      };
    }
    const normalized = {
      activeTabId: sanitizeText(rawState?.activeTabId, "") || null,
      tabOrder: ensureUniqueIds(rawState?.tabOrder || []),
      tabTreeCollapsedById: isObjectLike(rawState?.tabTreeCollapsedById) ? deepClone(rawState.tabTreeCollapsedById, {}) : null,
      collapsedById: isObjectLike(rawState?.collapsedById) ? deepClone(rawState.collapsedById, {}) : null,
      pinnedScrollByViewKey: isObjectLike(rawState?.pinnedScrollByViewKey) ? deepClone(rawState.pinnedScrollByViewKey, {}) : null,
      visibleUiState: isObjectLike(rawState?.visibleUiState) ? normalizeVisibleUiState(rawState.visibleUiState) : null,
    };
    const applied = [];
    const skipped = [];
    const warnings = [];
    const next = normalizeWorkspaceData(this.workspaceData);

    if (normalized.activeTabId && next.tabsById?.[normalized.activeTabId]) {
      next.activeTabId = normalized.activeTabId;
      applied.push("activeTabId");
    } else if (normalized.activeTabId) {
      warnings.push(`Missing target tab: ${normalized.activeTabId}`);
    } else {
      skipped.push("activeTabId");
    }

    if (normalized.tabOrder.length > 0) {
      applyTabOrderToHierarchy(next, normalized.tabOrder);
      applied.push("tabOrder");
    } else {
      skipped.push("tabOrder");
    }

    if (normalized.tabTreeCollapsedById) {
      next.tabTreeCollapsedById = normalized.tabTreeCollapsedById;
      applied.push("tabTreeCollapsedById");
    } else {
      skipped.push("tabTreeCollapsedById");
    }

    if (normalized.collapsedById) {
      next.collapsedById = normalized.collapsedById;
      Object.keys(next.itemsById || {}).forEach((itemId) => {
        if (!isObjectLike(next.itemsById[itemId])) return;
        next.itemsById[itemId].isCollapsed = !!normalized.collapsedById[itemId];
      });
      applied.push("collapsedById");
    } else {
      skipped.push("collapsedById");
    }

    if (normalized.pinnedScrollByViewKey) {
      next.pinnedScrollByViewKey = normalized.pinnedScrollByViewKey;
      applied.push("pinnedScrollByViewKey");
    } else {
      skipped.push("pinnedScrollByViewKey");
    }

    if (normalized.visibleUiState) {
      this.visibleUiState = normalized.visibleUiState;
      applied.push("visibleUiState");
    } else {
      skipped.push("visibleUiState");
    }

    syncParadigmAcrossTabsInData(next);
    this.workspaceData = await this.plugin.saveWorkspaceData(this.dataPaths?.dataPath, next);
    if (options?.rerender !== false) {
      this.shouldRestorePinnedScrollAfterRender = options?.restorePinnedScroll !== false;
      await this.render();
      applied.push("rerender");
    } else {
      skipped.push("rerender");
    }

    return { ok: true, applied, skipped, warnings };
  }

  async setActiveTabId(tabId, options = {}) {
    const nextTabId = sanitizeText(tabId, "");
    if (!nextTabId || !this.workspaceData?.tabsById?.[nextTabId]) return false;
    if (options?.restorePinnedScroll === true) {
      this.shouldRestorePinnedScrollAfterRender = true;
    }
    const updated = await this.updateWorkspaceData((data) => {
      data.activeTabId = nextTabId;
    });
    if (!updated) return false;
    this.getSelectedSnapshotId(nextTabId);
    if (options?.rerender === false) return true;
    return true;
  }

  async rerenderFromBridge(options = {}) {
    this.shouldRestorePinnedScrollAfterRender = options?.restorePinnedScroll !== false;
    await this.render();
    return true;
  }

  async cloneTabParadigmBindingsIncrementally(sourceTabIdRaw, targetTabIdRaw) {
    const sourceTabId = sanitizeText(sourceTabIdRaw, "");
    const targetTabId = sanitizeText(targetTabIdRaw, "");
    if (!sourceTabId || !targetTabId || sourceTabId === targetTabId) {
      new Notice("⚠️ 请选择不同的源 Tab 和目标 Tab");
      return false;
    }
    const sourceTab = this.getTabById(sourceTabId);
    const targetTab = this.getTabById(targetTabId);
    if (!sourceTab || !targetTab) {
      new Notice("⚠️ 未找到源 Tab 或目标 Tab");
      return false;
    }
    const ok = window.confirm(
      `确定将「${sourceTab.name || sourceTabId}」当前已绑定/纳入的范式集合，增量同步到「${targetTab.name || targetTabId}」吗？\n\n只会补齐目标 Tab 缺失的范式绑定，不会复制本地条目，也不会覆盖目标 Tab 已有条目或范式。`
    );
    if (!ok) return false;

    let summary = null;
    const updated = await this.updateWorkspaceData((data) => {
      ensureTabHierarchyState(data);
      materializeInheritedParadigmBindingsInData(data, sourceTabId);
      materializeInheritedParadigmBindingsInData(data, targetTabId);

      const sourceTabData = data.tabsById?.[sourceTabId];
      const targetTabData = data.tabsById?.[targetTabId];
      if (!sourceTabData || !targetTabData) return;

      const sourceBoundIds = normalizeBoundParadigmIds(sourceTabData).filter((paradigmId) => !!data.paradigmsById?.[paradigmId]);
      const targetBoundIds = normalizeBoundParadigmIds(targetTabData).filter((paradigmId) => !!data.paradigmsById?.[paradigmId]);
      const nextBoundIds = targetBoundIds.slice();
      const targetSeen = new Set(targetBoundIds);
      const addedParadigmIds = [];
      const skippedParadigmIds = [];

      sourceBoundIds.forEach((paradigmId) => {
        if (targetSeen.has(paradigmId)) {
          skippedParadigmIds.push(paradigmId);
          return;
        }
        targetSeen.add(paradigmId);
        nextBoundIds.push(paradigmId);
        addedParadigmIds.push(paradigmId);
      });

      setTabBoundParadigmIds(targetTabData, nextBoundIds);
      if (addedParadigmIds.length > 0) targetTabData.updatedAt = nowString();
      syncParadigmToTabInData(data, targetTabId);

      summary = {
        sourceTabName: sourceTabData.name || sourceTabId,
        targetTabName: targetTabData.name || targetTabId,
        sourceBoundCount: sourceBoundIds.length,
        targetBeforeCount: targetBoundIds.length,
        targetAfterCount: nextBoundIds.length,
        addedCount: addedParadigmIds.length,
        skippedCount: skippedParadigmIds.length,
      };
    });

    if (!updated || !summary) return false;
    new Notice(
      summary.addedCount > 0
        ? `🧬 已将 ${summary.sourceTabName} 的 ${summary.addedCount} 个缺失范式增量同步到 ${summary.targetTabName}`
        : `ℹ️ ${summary.targetTabName} 已覆盖 ${summary.sourceTabName} 的范式集合，没有新增绑定`
    );
    return true;
  }

  async promptCloneTabParadigmBindingsIncrementally() {
    const tabs = Object.values(this.workspaceData?.tabsById || {}).filter(Boolean);
    if (tabs.length < 2) {
      new Notice("⚠️ 至少需要两个 Tab 才能执行范式同构迁入");
      return false;
    }
    const activeId = this.getActiveTabId();
    const sourceId = await this.pickWorkspaceTab({
      activeTabId: activeId,
      title: "选择源 Tab",
      description: "输入源 Tab 名称或 ID 筛选",
    });
    if (!sourceId) return false;
    const targetId = await this.pickWorkspaceTab({
      activeTabId: activeId,
      excludeIds: [sourceId],
      title: "选择目标 Tab",
      description: "输入目标 Tab 名称或 ID 筛选",
    });
    if (!targetId) return false;
    return await this.cloneTabParadigmBindingsIncrementally(sourceId, targetId);
  }

  describeAmbiguousParadigmSources(data, ambiguousMap, limit = 4) {
    const entries = Array.from(ambiguousMap.entries()).slice(0, limit).map(([sourceParadigmId, mountIds]) => {
      const sourceParadigm = data.paradigmsById?.[sourceParadigmId];
      const label = sanitizeText(sourceParadigm?.name, sourceParadigmId) || sourceParadigmId;
      return `${label} (${sourceParadigmId})`;
    });
    return entries.join("、");
  }

  buildCommonParadigmTransferPreview(data, sourceTabIdRaw, targetTabIdRaw) {
    const sourceTabId = sanitizeText(sourceTabIdRaw, "");
    const targetTabId = sanitizeText(targetTabIdRaw, "");
    const result = {
      sourceTabIds: [],
      commonParadigmCount: 0,
      touchedParadigmItemCount: 0,
      directLocalItemCount: 0,
      recursiveLocalItemCount: 0,
      sourceAmbiguousLabel: "",
      targetAmbiguousLabel: "",
    };
    if (!sourceTabId || !targetTabId || sourceTabId === targetTabId) return result;

    const sourceTabIds = [sourceTabId].concat(getTabDescendantIdsFromData(data, sourceTabId));
    result.sourceTabIds = sourceTabIds.slice();
    sourceTabIds.forEach((id) => {
      if (!data.tabsById?.[id]) return;
      syncParadigmToTabInData(data, id);
    });
    syncParadigmToTabInData(data, targetTabId);

    const countLocalTabSubtree = (tabId, itemId) => {
      let total = 0;
      getDirectChildIdsFromData(data, itemId, tabId).forEach((childId) => {
        const child = data.itemsById?.[childId];
        if (!child || child.sourceType !== "tab") return;
        total += 1;
        total += countLocalTabSubtree(tabId, childId);
      });
      return total;
    };

    const targetMapInfo = collectMountedSourceParadigmMapForTab(data, targetTabId);
    if (targetMapInfo.ambiguousBySourceParadigmId.size > 0) {
      result.targetAmbiguousLabel = this.describeAmbiguousParadigmSources(data, targetMapInfo.ambiguousBySourceParadigmId);
      return result;
    }

    const commonParadigmSet = new Set();
    const touchedParadigmItemSet = new Set();

    sourceTabIds.forEach((currentSourceTabId) => {
      const sourceMapInfo = collectMountedSourceParadigmMapForTab(data, currentSourceTabId);
      if (sourceMapInfo.ambiguousBySourceParadigmId.size > 0) {
        if (!result.sourceAmbiguousLabel) {
          result.sourceAmbiguousLabel = this.describeAmbiguousParadigmSources(data, sourceMapInfo.ambiguousBySourceParadigmId);
        }
        return;
      }
      const commonParadigmSourceIds = Array.from(sourceMapInfo.mountBySourceParadigmId.keys())
        .filter((sourceParadigmId) => targetMapInfo.mountBySourceParadigmId.has(sourceParadigmId));
      commonParadigmSourceIds.forEach((sourceParadigmId) => {
        const sourceMountNodeId = sourceMapInfo.mountBySourceParadigmId.get(sourceParadigmId);
        const targetMountNodeId = targetMapInfo.mountBySourceParadigmId.get(sourceParadigmId);
        if (!sourceMountNodeId || !targetMountNodeId) return;
        commonParadigmSet.add(sourceParadigmId);
        Object.values(data.paradigmItemsById || {})
          .filter((pgItem) => !!pgItem && pgItem.paradigmId === sourceParadigmId)
          .forEach((pgItem) => {
            const sourceMountedTabItemId = data.paradigmToTabItemMapByTab?.[makeParadigmMountMapKey(currentSourceTabId, sourceMountNodeId, pgItem.id)];
            const targetMountedTabItemId = data.paradigmToTabItemMapByTab?.[makeParadigmMountMapKey(targetTabId, targetMountNodeId, pgItem.id)];
            if (!sourceMountedTabItemId || !targetMountedTabItemId) return;
            const directLocalChildIds = getDirectChildIdsFromData(data, sourceMountedTabItemId, currentSourceTabId)
              .filter((childId) => data.itemsById?.[childId]?.sourceType === "tab");
            if (directLocalChildIds.length === 0) return;
            touchedParadigmItemSet.add(`${currentSourceTabId}::${sourceParadigmId}::${pgItem.id}`);
            result.directLocalItemCount += directLocalChildIds.length;
            directLocalChildIds.forEach((sourceLocalChildId) => {
              result.recursiveLocalItemCount += 1 + countLocalTabSubtree(currentSourceTabId, sourceLocalChildId);
            });
          });
      });
    });

    result.commonParadigmCount = commonParadigmSet.size;
    result.touchedParadigmItemCount = touchedParadigmItemSet.size;
    return result;
  }

  async transferCommonParadigmItemsBetweenTabs(sourceTabIdRaw, targetTabIdRaw) {
    const sourceTabId = sanitizeText(sourceTabIdRaw, "");
    const targetTabId = sanitizeText(targetTabIdRaw, "");
    if (!sourceTabId || !targetTabId || sourceTabId === targetTabId) {
      new Notice("⚠️ 请选择不同的源 Tab 和目标 Tab");
      return false;
    }
    const sourceTab = this.getTabById(sourceTabId);
    const targetTab = this.getTabById(targetTabId);
    if (!sourceTab || !targetTab) {
      new Notice("⚠️ 未找到源 Tab 或目标 Tab");
      return false;
    }
    const preview = this.buildCommonParadigmTransferPreview(normalizeWorkspaceData(this.workspaceData), sourceTabId, targetTabId);
    const ok = window.confirm(
      [
        `确定将「${sourceTab.name || sourceTabId}」及其子 Tab 里共通范式下的本地条目，递归增量迁入「${targetTab.name || targetTabId}」吗？`,
        "",
        `源 Tab：${sourceTab.name || sourceTabId} (${sourceTabId})`,
        `目标 Tab：${targetTab.name || targetTabId} (${targetTabId})`,
        `源 Tab 范围预估：${preview.sourceTabIds.length} 个`,
        `共同范式预估：${preview.commonParadigmCount} 个`,
        `命中范式条目预估：${preview.touchedParadigmItemCount} 个`,
        `直接普通子条目预估：${preview.directLocalItemCount} 个`,
        `递归可迁入条目预估：${preview.recursiveLocalItemCount} 个`,
        preview.sourceAmbiguousLabel ? `源 Tab 歧义：${preview.sourceAmbiguousLabel}` : "",
        preview.targetAmbiguousLabel ? `目标 Tab 歧义：${preview.targetAmbiguousLabel}` : "",
        "",
        "系统会自动匹配源 Tab 树与目标 Tab 的共通范式；目标 Tab 已有内容不会被覆盖，只会新增缺失条目，并给新增条目标明具体转自哪个 Tab。"
      ].filter(Boolean).join("\n")
    );
    if (!ok) return false;

    const next = normalizeWorkspaceData(this.workspaceData);
    const sourceTabIds = [sourceTabId].concat(getTabDescendantIdsFromData(next, sourceTabId));
    sourceTabIds.forEach((id) => {
      if (!next.tabsById?.[id]) return;
      syncParadigmToTabInData(next, id);
    });
    syncParadigmToTabInData(next, targetTabId);

    const targetMapInfo = collectMountedSourceParadigmMapForTab(next, targetTabId);
    if (targetMapInfo.ambiguousBySourceParadigmId.size > 0) {
      new Notice(`⚠️ 目标 Tab 存在同定义源多挂载根歧义：${this.describeAmbiguousParadigmSources(next, targetMapInfo.ambiguousBySourceParadigmId)}`);
      return false;
    }

    const stats = {
      sourceTabCount: sourceTabIds.length,
      commonParadigmCount: 0,
      touchedParadigmItemCount: 0,
      createdItemCount: 0,
      reusedItemCount: 0,
      sourceTabNames: sourceTabIds.map((id) => next.tabsById?.[id]?.name || id),
      commonParadigmNames: [],
      touchedParadigmItemLabels: [],
    };
    const commonParadigmSet = new Set();
    const touchedParadigmItemSet = new Set();

    const cloneLocalSubtreeIntoTarget = (sourceItemId, targetParentId, sourceContext, transferMetaBase) => {
      const sourceItem = next.itemsById?.[sourceItemId];
      if (!sourceItem || sourceItem.tabId !== sourceContext.id || sourceItem.sourceType !== "tab") return null;
      const sourceComment = sanitizeText(this.taskComments?.[sourceItemId], "") || sanitizeText(sourceItem.comment, "");
      const sourceNoteBinding = deepClone(sourceItem.noteBinding || this.taskNoteBindings?.[sourceItemId] || null, null);
      const transferMeta = {
        ...transferMetaBase,
        sourceItemId: sourceItem.id,
        sourceItemTitle: sourceItem.title,
      };
      const markerLine = buildTransferMarkerLine(transferMeta);
      const existingChild = getDirectChildIdsFromData(next, targetParentId, targetTabId)
        .map((id) => next.itemsById?.[id])
        .find((item) => {
          if (!item || item.tabId !== targetTabId || item.sourceType !== "tab") return false;
          const marker = parseTransferMarkerLine(item.comment || "");
          return !!marker && marker.sourceTabId === sourceContext.id && marker.sourceItemId === sourceItem.id;
        });
      let targetItemId = existingChild?.id || "";
      if (targetItemId) {
        stats.reusedItemCount += 1;
      } else {
        targetItemId = createId("item");
        while (next.itemsById?.[targetItemId]) targetItemId = createId("item");
        next.itemsById[targetItemId] = {
          id: targetItemId,
          title: sourceItem.title,
          parentId: targetParentId,
          tabId: targetTabId,
          sourceType: "tab",
          sourceParadigmId: null,
          sourceParadigmItemId: null,
          sourceParadigmBindingRootId: null,
          sourceParadigmMountScopeId: null,
          sourceParadigmCopyRefId: null,
          sourceParadigmMountMode: "direct",
          isCollapsed: !!sourceItem.isCollapsed,
          imageRef: sanitizeText(sourceItem.imageRef, ""),
          shortcuts: normalizeShortcutEntries(sourceItem.shortcuts || []),
          comment: composeTransferredItemComment(transferMeta, sourceComment),
          noteBinding: sourceNoteBinding,
          orphaned: false,
          createdAt: nowString(),
          updatedAt: nowString(),
        };
        ensureLocalItemInserted(next, targetTabId, targetParentId, targetItemId);
        stats.createdItemCount += 1;
      }
      const targetItem = next.itemsById?.[targetItemId];
      if (targetItem) {
        targetItem.parentId = targetParentId;
        if (!String(targetItem.comment || "").includes(markerLine)) {
          targetItem.comment = composeTransferredItemComment(transferMeta, targetItem.comment || sourceComment);
        } else {
          targetItem.comment = normalizeTransferredCommentLayout(targetItem.comment || "");
        }
        targetItem.updatedAt = nowString();
      }
      getDirectChildIdsFromData(next, sourceItem.id, sourceContext.id).forEach((childId) => {
        const childItem = next.itemsById?.[childId];
        if (!childItem || childItem.sourceType !== "tab") return;
        cloneLocalSubtreeIntoTarget(childId, targetItemId, sourceContext, transferMetaBase);
      });
      return targetItemId;
    };

    for (const currentSourceTabId of sourceTabIds) {
      const currentSourceTab = next.tabsById?.[currentSourceTabId];
      if (!currentSourceTab) continue;
      const sourceMapInfo = collectMountedSourceParadigmMapForTab(next, currentSourceTabId);
      if (sourceMapInfo.ambiguousBySourceParadigmId.size > 0) {
        new Notice(`⚠️ 源 Tab「${currentSourceTab.name || currentSourceTabId}」存在同定义源多挂载根歧义：${this.describeAmbiguousParadigmSources(next, sourceMapInfo.ambiguousBySourceParadigmId)}`);
        return false;
      }
      const commonParadigmSourceIds = Array.from(sourceMapInfo.mountBySourceParadigmId.keys())
        .filter((sourceParadigmId) => targetMapInfo.mountBySourceParadigmId.has(sourceParadigmId));
      commonParadigmSourceIds.forEach((sourceParadigmId) => {
        const sourceMountNodeId = sourceMapInfo.mountBySourceParadigmId.get(sourceParadigmId);
        const targetMountNodeId = targetMapInfo.mountBySourceParadigmId.get(sourceParadigmId);
        if (!sourceMountNodeId || !targetMountNodeId) return;
        const sourceParadigm = next.paradigmsById?.[sourceParadigmId];
        const paradigmName = sanitizeText(sourceParadigm?.name, sourceParadigmId) || sourceParadigmId;
        if (!commonParadigmSet.has(sourceParadigmId)) {
          commonParadigmSet.add(sourceParadigmId);
          stats.commonParadigmNames.push(paradigmName);
        }
        const paradigmItemIds = Object.values(next.paradigmItemsById || {})
          .filter((pgItem) => !!pgItem && pgItem.paradigmId === sourceParadigmId)
          .map((pgItem) => pgItem.id);
        paradigmItemIds.forEach((paradigmItemId) => {
          const sourceMountedTabItemId = next.paradigmToTabItemMapByTab?.[makeParadigmMountMapKey(currentSourceTabId, sourceMountNodeId, paradigmItemId)];
          const targetMountedTabItemId = next.paradigmToTabItemMapByTab?.[makeParadigmMountMapKey(targetTabId, targetMountNodeId, paradigmItemId)];
          if (!sourceMountedTabItemId || !targetMountedTabItemId) return;
          const directLocalChildIds = getDirectChildIdsFromData(next, sourceMountedTabItemId, currentSourceTabId)
            .filter((childId) => next.itemsById?.[childId]?.sourceType === "tab");
          if (directLocalChildIds.length === 0) return;
          const touchedKey = `${currentSourceTabId}::${sourceParadigmId}::${paradigmItemId}`;
          if (!touchedParadigmItemSet.has(touchedKey)) {
            touchedParadigmItemSet.add(touchedKey);
            stats.touchedParadigmItemCount += 1;
            const paradigmItem = next.paradigmItemsById?.[paradigmItemId];
            stats.touchedParadigmItemLabels.push(`${currentSourceTab.name || currentSourceTabId} / ${paradigmName} / ${sanitizeText(paradigmItem?.title, paradigmItemId)}`);
          }
          directLocalChildIds.forEach((sourceLocalChildId) => {
            cloneLocalSubtreeIntoTarget(sourceLocalChildId, targetMountedTabItemId, {
              id: currentSourceTabId,
              name: currentSourceTab.name || currentSourceTabId,
            }, {
              sourceTabId: currentSourceTabId,
              sourceTabName: currentSourceTab.name || currentSourceTabId,
              sourceParadigmId,
              sourceParadigmName: paradigmName,
            });
          });
        });
      });
    }

    stats.commonParadigmCount = commonParadigmSet.size;
    const logRootId = ensureParadigmTransferLogRootInData(next, targetTabId);
    let logItemId = createId("item");
    while (next.itemsById?.[logItemId]) logItemId = createId("item");
    const previewSourceTabs = stats.sourceTabNames.slice(0, 8).join("、");
    const previewParadigms = stats.commonParadigmNames.slice(0, 8).join("、");
    const previewTouched = stats.touchedParadigmItemLabels.slice(0, 12).join("\n");
    next.itemsById[logItemId] = {
      id: logItemId,
      title: `${nowString()} 从 ${sourceTab.name || sourceTabId}（含子Tab）增量迁入 ${stats.createdItemCount} 条`,
      parentId: logRootId,
      tabId: targetTabId,
      sourceType: "tab",
      sourceParadigmId: null,
      sourceParadigmItemId: null,
      sourceParadigmBindingRootId: null,
      sourceParadigmMountScopeId: null,
      sourceParadigmCopyRefId: null,
      sourceParadigmMountMode: "direct",
      isCollapsed: false,
      imageRef: "",
      shortcuts: [],
      comment: [
        `源 Tab 根节点：${sourceTab.name || sourceTabId} (${sourceTabId})`,
        `源 Tab 范围：${stats.sourceTabCount} 个`,
        `目标 Tab：${targetTab.name || targetTabId} (${targetTabId})`,
        `共同范式：${stats.commonParadigmCount} 个`,
        `命中范式条目：${stats.touchedParadigmItemCount} 个`,
        `新增条目：${stats.createdItemCount} 个`,
        `复用既有迁移条目：${stats.reusedItemCount} 个`,
        previewSourceTabs ? `参与源Tab：${previewSourceTabs}` : "参与源Tab：无",
        previewParadigms ? `共同范式列表：${previewParadigms}` : "共同范式列表：无",
        previewTouched ? `命中范式条目：\n${previewTouched}` : "命中范式条目：无",
      ].join("\n"),
      noteBinding: null,
      orphaned: false,
      createdAt: nowString(),
      updatedAt: nowString(),
    };
    ensureLocalItemInserted(next, targetTabId, logRootId, logItemId);
    if (next.itemsById?.[logRootId]) next.itemsById[logRootId].updatedAt = nowString();
    if (next.tabsById?.[targetTabId]) next.tabsById[targetTabId].updatedAt = nowString();
    next.activeTabId = targetTabId;

    syncParadigmAcrossTabsInData(next);
    this.workspaceData = await this.plugin.saveWorkspaceData(this.dataPaths?.dataPath, next);
    await this.render();
    new Notice(
      stats.createdItemCount > 0
        ? `📥 已从 ${sourceTab.name || sourceTabId}（含子Tab ${stats.sourceTabCount} 个）向 ${targetTab.name || targetTabId} 增量迁入 ${stats.createdItemCount} 条，共同范式 ${stats.commonParadigmCount} 个`
        : `ℹ️ 已检查 ${sourceTab.name || sourceTabId}（含子Tab ${stats.sourceTabCount} 个） -> ${targetTab.name || targetTabId}，共同范式 ${stats.commonParadigmCount} 个，没有新增条目`
    );
    return true;
  }

  async promptTransferCommonParadigmItemsBetweenTabs() {
    const tabs = Object.values(this.workspaceData?.tabsById || {}).filter(Boolean);
    if (tabs.length < 2) {
      new Notice("⚠️ 至少需要两个 Tab 才能执行共通范式迁入");
      return false;
    }
    const activeId = this.getActiveTabId();
    const sourceId = await this.pickWorkspaceTab({
      activeTabId: activeId,
      title: "选择源 Tab",
      description: "输入源 Tab 名称或 ID 筛选",
    });
    if (!sourceId) return false;
    const targetId = await this.pickWorkspaceTab({
      activeTabId: activeId,
      excludeIds: [sourceId],
      title: "选择目标 Tab",
      description: "输入目标 Tab 名称或 ID 筛选",
    });
    if (!targetId) return false;
    return await this.transferCommonParadigmItemsBetweenTabs(sourceId, targetId);
  }

  async createTab() {
    const name = await this.promptForText({
      title: "新建 Tab",
      placeholder: "输入 Tab 名称（项目/任务/对象）",
      confirmText: "创建",
    });
    if (!sanitizeText(name, "")) return;
    const tabId = `tab_${createId("ws")}`;
    await this.updateWorkspaceData((data) => {
      ensureTabHierarchyState(data);
      data.tabsById[tabId] = {
        id: tabId,
        name: sanitizeText(name, "新建工作区"),
        emoji: "",
        accentColor: "",
        kind: "project",
        parentTabId: null,
        boundParadigmIds: [],
        boundParadigmItemKeys: [],
        boundParadigmId: null,
        createdAt: nowString(),
        updatedAt: nowString(),
      };
      if (!Array.isArray(data.tabChildrenByParent[ROOT_KEY])) data.tabChildrenByParent[ROOT_KEY] = [];
      data.tabChildrenByParent[ROOT_KEY].push(tabId);
      rebuildTabOrderFromData(data);
      data.activeTabId = tabId;
    });
    new Notice("Workspace Tab 已创建");
  }

  async addItem(parentId = null, tabId = this.getActiveTabId()) {
    return await this.addItemWithMode(parentId, tabId, "local");
  }

  async addItemWithMode(parentId = null, tabId = this.getActiveTabId(), mode = "local") {
    const targetTabId = sanitizeText(tabId, "") || this.getActiveTabId();
    if (!targetTabId || !this.getTabById(targetTabId)) return;
    const parentItem = parentId ? this.getItemById(parentId) : null;
    if (parentItem && this.isParadigmMountedItem(parentItem) && mode === "paradigm") {
      const sourceItem = await this.confirmMountedParadigmWriteback(parentItem, "新增子条目");
      if (!sourceItem) return;
      await this.addParadigmItem(sourceItem.paradigmId, sourceItem.id);
      return;
    }
    const title = await this.promptForText({
      title: parentId ? "添加子条目" : "添加根条目",
      placeholder: "输入条目名称",
      confirmText: "创建",
    });
    if (!sanitizeText(title, "")) return;
    const itemId = createId("item");
    await this.updateWorkspaceData((data) => {
      data.itemsById[itemId] = {
        id: itemId,
        title: sanitizeText(title, "未命名条目"),
        parentId: sanitizeText(parentId, "") || null,
        tabId: targetTabId,
        sourceType: "tab",
        sourceParadigmId: null,
        sourceParadigmItemId: null,
        sourceParadigmMountScopeId: null,
        sourceParadigmCopyRefId: null,
        isCollapsed: false,
        imageRef: "",
        shortcuts: [],
        comment: "",
        noteBinding: null,
        orphaned: false,
        createdAt: nowString(),
        updatedAt: nowString(),
      };
      const scopedKey = tabParentKey(targetTabId, parentId);
      if (!Array.isArray(data.childrenByParentByTab[scopedKey])) data.childrenByParentByTab[scopedKey] = [];
      data.childrenByParentByTab[scopedKey].unshift(itemId);
    });
  }

  async renameItem(itemId) {
    const item = this.getItemById(itemId);
    if (!item) return;
    if (this.isParadigmMountedItem(item)) {
      const sourceItem = await this.confirmMountedParadigmWriteback(item, "重命名");
      if (!sourceItem) return;
      await this.renameParadigmItem(sourceItem.id);
      return;
    }
    const nextTitle = await this.promptForText({
      title: "重命名条目",
      value: item.title || "",
      placeholder: "输入条目名称",
      confirmText: "保存",
    });
    if (!sanitizeText(nextTitle, "")) return;
    await this.updateWorkspaceData((data) => {
      const target = data.itemsById?.[itemId];
      if (!target) return;
      target.title = sanitizeText(nextTitle, target.title || itemId);
      target.updatedAt = nowString();
    });
  }

  async editItemImage(itemId) {
    const item = this.getItemById(itemId);
    if (!item) return;
    if (this.isParadigmMountedItem(item)) {
      const sourceItem = await this.confirmMountedParadigmWriteback(item, "修改图片或快捷方式");
      if (!sourceItem) return;
      await this.editParadigmItemImage(sourceItem.id);
      return;
    }
    const result = await this.editImageRefModal({
      title: `🖼️ 图片设置：${item.title || item.id}`,
      value: item.imageRef || "",
      shortcutEntries: item.shortcuts || [],
    });
    if (!result) return;
    const nextShortcuts = normalizeShortcutEntries(result.shortcuts || []);
    await this.updateWorkspaceData((data) => {
      const target = data.itemsById?.[itemId];
      if (!target) return;
      target.imageRef = result.action === "clear" ? "" : sanitizeText(result.value, "");
      target.shortcuts = nextShortcuts;
      target.updatedAt = nowString();
    });
  }

  async editItemNoteBinding(itemId) {
    const item = this.getItemById(itemId);
    if (!item) return;
    if (this.isParadigmMountedItem(item)) {
      const sourceItem = await this.confirmMountedParadigmWriteback(item, "修改笔记绑定");
      if (!sourceItem) return;
      await this.editParadigmItemNoteBinding(sourceItem.id);
      return;
    }
    const currentBinding = this.getItemNoteBinding(item);
    const currentValue = typeof currentBinding === "string"
      ? currentBinding
      : sanitizeText(currentBinding?.path, "");
    const result = await this.editNoteBindingModal({
      title: `绑定笔记：${item.title || item.id}`,
      value: currentValue,
      onOpenCurrent: async () => {
        await this.openBoundNote(currentBinding);
      },
    });
    if (!result) return;
    if (result.action === "clear") {
      const nextBindings = { ...(this.taskNoteBindings || {}) };
      delete nextBindings[itemId];
      await this.plugin.saveTaskNoteBindings(this.dataPaths?.bindingsPath, nextBindings);
      this.taskNoteBindings = nextBindings;
      await this.updateWorkspaceData((data) => {
        const target = data.itemsById?.[itemId];
        if (!target) return;
        target.noteBinding = null;
        target.updatedAt = nowString();
      });
      new Notice("已清除笔记绑定");
      return;
    }
    const normalized = sanitizeText(result.value, "");
    const file = this.resolveExistingNoteFile(normalized);
    if (!(file instanceof TFile)) {
      new Notice("没有找到这个 Obsidian 笔记，请输入库内真实路径。");
      return;
    }
    const bindingValue = { path: file.path, ctime: Number(file?.stat?.ctime) || null };
    const nextBindings = {
      ...(this.taskNoteBindings || {}),
      [itemId]: bindingValue,
    };
    await this.plugin.saveTaskNoteBindings(this.dataPaths?.bindingsPath, nextBindings);
    this.taskNoteBindings = nextBindings;
    await this.updateWorkspaceData((data) => {
      const target = data.itemsById?.[itemId];
      if (!target) return;
      target.noteBinding = bindingValue;
      target.updatedAt = nowString();
    });
    new Notice(`已绑定笔记：${file.basename || file.path}`);
  }

  async editParadigmItemComment(paradigmItemId) {
    const paradigmItem = this.getParadigmItemById(paradigmItemId);
    if (!paradigmItem) return;
    const currentComment = typeof paradigmItem.comment === "string" ? paradigmItem.comment : "";
    const result = await this.editCommentModal({
      title: `🗒️ 范式评论：${paradigmItem.title || paradigmItem.id}`,
      value: currentComment,
    });
    if (!result) return;
    await this.updateWorkspaceData((data) => {
      const target = data.paradigmItemsById?.[paradigmItemId];
      if (!target) return;
      if (result.action === "clear") target.comment = "";
      if (result.action === "save") target.comment = String(result.value || "");
      target.updatedAt = nowString();
    });
    new Notice("💾 范式评论已更新");
  }

  async editItemComment(itemId) {
    const item = this.getItemById(itemId);
    if (!item) return;
    if (this.isParadigmMountedItem(item)) {
      const sourceItem = await this.confirmMountedParadigmWriteback(item, "修改评论");
      if (!sourceItem) return;
      await this.editParadigmItemComment(sourceItem.id);
      return;
    }
    const currentComment = this.getItemComment(item);
    const result = await this.editCommentModal({
      title: `🗒️ 评论：${item.title || item.id}`,
      value: currentComment,
    });
    if (!result) return;
    if (result.action === "clear") {
      const nextComments = { ...(this.taskComments || {}) };
      delete nextComments[itemId];
      await this.plugin.saveTaskComments(this.dataPaths?.commentsPath, nextComments);
      this.taskComments = nextComments;
      await this.updateWorkspaceData((data) => {
        const target = data.itemsById?.[itemId];
        if (!target) return;
        target.comment = "";
        target.updatedAt = nowString();
      });
      new Notice("🧹 已清空评论");
      return;
    }
    if (result.action === "save") {
      const finalText = String(result.value || "");
      if (!finalText.trim()) {
        const nextComments = { ...(this.taskComments || {}) };
        delete nextComments[itemId];
        await this.plugin.saveTaskComments(this.dataPaths?.commentsPath, nextComments);
        this.taskComments = nextComments;
        await this.updateWorkspaceData((data) => {
          const target = data.itemsById?.[itemId];
          if (!target) return;
          target.comment = "";
          target.updatedAt = nowString();
        });
        new Notice("🧹 评论为空，已清空");
      } else {
        const nextComments = {
          ...(this.taskComments || {}),
          [itemId]: finalText,
        };
        await this.plugin.saveTaskComments(this.dataPaths?.commentsPath, nextComments);
        this.taskComments = nextComments;
        await this.updateWorkspaceData((data) => {
          const target = data.itemsById?.[itemId];
          if (!target) return;
          target.comment = finalText;
          target.updatedAt = nowString();
        });
        new Notice("💾 评论已保存");
      }
    }
  }

  async deleteItem(itemId) {
    const item = this.getItemById(itemId);
    if (!item) return;
    if (this.isParadigmMountedItem(item)) {
      const sourceItem = await this.confirmMountedParadigmWriteback(item, "删除", {
        extraMessage: "删除后会从范式定义源移除；原挂载位置会保留为普通条目，便于你后续手动整理。",
      });
      if (!sourceItem) return;
      await this.deleteParadigmItem(sourceItem.id);
      return;
    }
    const childIds = this.getChildrenIds(item.id, item.tabId);
    if (childIds.length > 0) {
      new Notice(`请先处理完它下面的 ${childIds.length} 个子条目。`);
      return;
    }
    const ok = window.confirm(`确定删除条目「${item.title || item.id}」吗？`);
    if (!ok) return;
    await this.updateWorkspaceData((data) => {
      this.removeIdFromScopedChildrenMap(data.childrenByParentByTab, itemId, item.tabId);
      delete data.childrenByParentByTab[tabParentKey(item.tabId, itemId)];
      delete data.itemsById[itemId];
      if (isObjectLike(data.collapsedById)) delete data.collapsedById[itemId];
    });
  }

  async toggleItemCollapsed(itemId) {
    const item = this.getItemById(itemId);
    if (!item) return;
    await this.updateWorkspaceData((data) => {
      const target = data.itemsById?.[itemId];
      if (!target) return;
      target.isCollapsed = !target.isCollapsed;
      if (!isObjectLike(data.collapsedById)) data.collapsedById = {};
      data.collapsedById[itemId] = !!target.isCollapsed;
      target.updatedAt = nowString();
    });
  }

  async moveItemToRoot(itemId) {
    const item = this.getItemById(itemId);
    if (!item) return;
    if (this.isParadigmMountedItem(item)) {
      const sourceItem = await this.confirmMountedParadigmWriteback(item, "移动到根层", {
        extraMessage: "这次操作会把该范式条目移动到定义源根层，并同步影响其他挂载位置。",
      });
      if (!sourceItem) return;
      await this.moveParadigmItemToRoot(sourceItem.id, sourceItem.paradigmId);
      return;
    }
    await this.updateWorkspaceData((data) => {
      const target = data.itemsById?.[itemId];
      if (!target) return;
      this.removeIdFromScopedChildrenMap(data.childrenByParentByTab, itemId, item.tabId);
      target.parentId = null;
      target.updatedAt = nowString();
      const rootScopedKey = tabParentKey(item.tabId, null);
      if (!Array.isArray(data.childrenByParentByTab[rootScopedKey])) data.childrenByParentByTab[rootScopedKey] = [];
      data.childrenByParentByTab[rootScopedKey].push(itemId);
    });
  }

  async moveItem(draggedIdRaw, targetIdRaw, position = "after") {
    const draggedId = sanitizeText(draggedIdRaw, "");
    const targetId = sanitizeText(targetIdRaw, "");
    if (!draggedId || !targetId || draggedId === targetId) return;
    const draggedItem = this.getItemById(draggedId);
    const targetItem = this.getItemById(targetId);
    if (!draggedItem || !targetItem) return;
    if (this.isParadigmMountedItem(draggedItem)) {
      if (!this.isParadigmMountedItem(targetItem)) {
        new Notice("引用挂载只能与其他范式挂载条目调整相对位置。");
        return;
      }
      const draggedSource = await this.confirmMountedParadigmWriteback(draggedItem, "调整层级", {
        extraMessage: "这次拖拽会改动范式定义源里的条目层级，并同步影响其他挂载位置。",
      });
      const targetSource = this.getMountedParadigmSourceItem(targetItem);
      if (!draggedSource || !targetSource) {
        new Notice("未找到引用挂载对应的定义源。");
        return;
      }
      if (draggedSource.paradigmId !== targetSource.paradigmId) {
        new Notice("引用挂载只能在同一范式定义内调整层级。");
        return;
      }
      await this.moveParadigmItem(draggedSource.id, targetSource.id, position);
      return;
    }
    if (draggedItem.tabId !== targetItem.tabId) {
      new Notice("暂不支持跨 Tab 拖拽条目。");
      return;
    }
    const nextParentId = position === "child" ? targetItem.id : (targetItem.parentId || null);
    if (this.wouldCreateItemCycle(draggedId, nextParentId)) {
      new Notice("不能把条目拖到自己的子级下面。");
      return;
    }
    await this.updateWorkspaceData((data) => {
      const dragged = data.itemsById?.[draggedId];
      const target = data.itemsById?.[targetId];
      if (!dragged || !target) return;
      this.removeIdFromScopedChildrenMap(data.childrenByParentByTab, dragged.id, dragged.tabId);
      dragged.parentId = nextParentId;
      dragged.updatedAt = nowString();
      const scopedKey = tabParentKey(dragged.tabId, nextParentId);
      if (!Array.isArray(data.childrenByParentByTab[scopedKey])) data.childrenByParentByTab[scopedKey] = [];
      const siblings = data.childrenByParentByTab[scopedKey];
      if (position === "child") {
        siblings.unshift(dragged.id);
      } else {
        const targetIndex = siblings.indexOf(target.id);
        if (targetIndex < 0) siblings.push(dragged.id);
        else siblings.splice(position === "before" ? targetIndex : targetIndex + 1, 0, dragged.id);
      }
    });
  }

  async renameCurrentTab() {
    const tab = this.getActiveTab();
    if (!tab) return;
    const name = window.prompt("重命名 Tab", tab.name || "");
    if (!sanitizeText(name, "")) return;
    await this.updateWorkspaceData((data) => {
      const target = data.tabsById?.[tab.id];
      if (!target) return;
      target.name = sanitizeText(name, target.name || tab.id);
      target.updatedAt = nowString();
    });
    new Notice("Tab 已重命名");
  }

  async editCurrentTabAppearance() {
    const tab = this.getActiveTab();
    if (!tab) return;
    const emoji = window.prompt("输入 Tab emoji，留空表示清除", tab.emoji || "");
    if (emoji === null) return;
    const accentColor = window.prompt("输入 Tab 颜色，例如 #3498db，留空表示清除", tab.accentColor || "");
    if (accentColor === null) return;
    await this.updateWorkspaceData((data) => {
      const target = data.tabsById?.[tab.id];
      if (!target) return;
      target.emoji = normalizeTabEmoji(emoji || "");
      target.accentColor = normalizeTabAccentColor(accentColor || "");
      target.updatedAt = nowString();
    });
    new Notice("Tab 特征已更新");
  }

  async closeCurrentTab() {
    const tab = this.getActiveTab();
    if (!tab) return;
    const tabs = this.workspaceData?.tabOrder || [];
    if (tabs.length <= 1) {
      new Notice("至少保留一个 Tab");
      return;
    }
    const ok = window.confirm(`确定关闭 Tab「${tab.name || tab.id}」吗？`);
    if (!ok) return;
    await this.updateWorkspaceData((data) => {
      ensureTabHierarchyState(data);
      const closingTab = data.tabsById?.[tab.id];
      if (!closingTab) return;
      const parentTabId = closingTab.parentTabId || null;
      const childTabIds = Array.isArray(data.tabChildrenByParent?.[parentKey(tab.id)])
        ? data.tabChildrenByParent[parentKey(tab.id)].slice()
        : [];
      const itemIdsToDelete = Object.values(data.itemsById || {})
        .filter((item) => item?.tabId === tab.id)
        .map((item) => item.id);
      itemIdsToDelete.forEach((itemId) => {
        delete data.itemsById[itemId];
      });
      Object.keys(data.childrenByParentByTab || {}).forEach((scopedKey) => {
        const parsed = splitScopedKey(scopedKey);
        if (parsed.ownerId === tab.id) delete data.childrenByParentByTab[scopedKey];
      });
      Object.keys(data.paradigmToTabItemMapByTab || {}).forEach((scopedKey) => {
        const parsed = parseParadigmMountMapKey(scopedKey);
        if (parsed.tabId === tab.id) delete data.paradigmToTabItemMapByTab[scopedKey];
      });
      const removedSnapIds = Array.isArray(data.snapshotOrderByTab?.[tab.id])
        ? data.snapshotOrderByTab[tab.id].slice()
        : [];
      removedSnapIds.forEach((snapshotId) => {
        if (isObjectLike(data.snapshotsById)) delete data.snapshotsById[snapshotId];
      });
      if (isObjectLike(data.snapshotOrderByTab)) delete data.snapshotOrderByTab[tab.id];
      this.removeIdFromSimpleChildrenMap(data.tabChildrenByParent, tab.id);
      const nextParentKey = parentKey(parentTabId);
      if (!Array.isArray(data.tabChildrenByParent[nextParentKey])) data.tabChildrenByParent[nextParentKey] = [];
      childTabIds.forEach((childId) => {
        if (!data.tabsById?.[childId]) return;
        data.tabsById[childId].parentTabId = parentTabId;
        if (!data.tabChildrenByParent[nextParentKey].includes(childId)) data.tabChildrenByParent[nextParentKey].push(childId);
      });
      delete data.tabChildrenByParent[parentKey(tab.id)];
      delete data.tabsById[tab.id];
      itemIdsToDelete.forEach((itemId) => {
        if (isObjectLike(data.collapsedById)) delete data.collapsedById[itemId];
      });
      rebuildTabOrderFromData(data);
      if (data.activeTabId === tab.id) data.activeTabId = data.tabOrder[0] || DEFAULT_TAB_ID;
    });
    new Notice("Tab 已关闭");
  }

  async createSnapshot() {
    const tab = this.getActiveTab();
    if (!tab) return false;
    const name = await this.promptForText({
      title: "保存快照",
      placeholder: "输入快照名称",
      confirmText: "保存",
    });
    const normalizedName = sanitizeText(name, "");
    if (!normalizedName) return false;
    const ok = await this.updateWorkspaceData((data) => {
      const tabId = sanitizeText(tab.id, "");
      const targetTab = data.tabsById?.[tabId];
      if (!tabId || !targetTab) return;
      if (!isObjectLike(data.snapshotsById)) data.snapshotsById = {};
      if (!isObjectLike(data.snapshotOrderByTab)) data.snapshotOrderByTab = {};
      if (!Array.isArray(data.snapshotOrderByTab[tabId])) data.snapshotOrderByTab[tabId] = [];
      const snapshotId = `snap_${createId("snap")}`;
      const itemIds = Object.values(data.itemsById || {})
        .filter((item) => item?.tabId === tabId)
        .map((item) => item.id);
      const itemSet = new Set(itemIds);
      const snapshotItemsById = {};
      itemIds.forEach((itemId) => {
        if (!data.itemsById?.[itemId]) return;
        snapshotItemsById[itemId] = deepClone(data.itemsById[itemId], {});
      });
      const snapshotChildrenByParentByTab = {};
      Object.keys(data.childrenByParentByTab || {}).forEach((scopedKey) => {
        const parsed = splitScopedKey(scopedKey);
        if (parsed.ownerId !== tabId) return;
        snapshotChildrenByParentByTab[scopedKey] = ensureUniqueIds(data.childrenByParentByTab[scopedKey] || [])
          .filter((itemId) => itemSet.has(itemId));
      });
      const snapshotCollapsedById = {};
      itemIds.forEach((itemId) => {
        snapshotCollapsedById[itemId] = !!data.itemsById?.[itemId]?.isCollapsed;
      });
      const boundParadigmIds = normalizeBoundParadigmIds(targetTab);
      data.snapshotsById[snapshotId] = {
        id: snapshotId,
        tabId,
        name: normalizedName,
        createdAt: nowString(),
        boundParadigmIds,
        boundParadigmId: boundParadigmIds[0] || null,
        itemsById: snapshotItemsById,
        childrenByParentByTab: snapshotChildrenByParentByTab,
        collapsedById: snapshotCollapsedById,
      };
      data.snapshotOrderByTab[tabId] = [snapshotId].concat(
        ensureUniqueIds(data.snapshotOrderByTab[tabId] || []).filter((id) => id !== snapshotId),
      );
    });
    if (!ok) return false;
    new Notice("💾 快照已保存");
    return true;
  }

  async restoreSnapshotAsNewTab(snapshotId) {
    const snapshot = this.getSnapshotById(snapshotId);
    if (!snapshot) return false;
    const okToRestore = window.confirm(`确定将快照「${sanitizeText(snapshot.name, snapshot.id)}」恢复为新 Tab 吗？`);
    if (!okToRestore) return false;
    let restoredTabId = "";
    const ok = await this.updateWorkspaceData((data) => {
      const liveSnapshot = data.snapshotsById?.[sanitizeText(snapshotId, "")];
      if (!liveSnapshot) return;
      ensureTabHierarchyState(data);
      const sourceTabId = sanitizeText(liveSnapshot.tabId, "");
      const newTabId = `tab_${createId("ws")}`;
      restoredTabId = newTabId;
      data.tabsById[newTabId] = {
        id: newTabId,
        name: `${sanitizeText(liveSnapshot.name, "快照")}（恢复）`,
        emoji: "",
        accentColor: "",
        kind: "project",
        parentTabId: null,
        boundParadigmIds: [],
        boundParadigmItemKeys: [],
        boundParadigmId: null,
        createdAt: nowString(),
        updatedAt: nowString(),
      };
      if (!Array.isArray(data.tabChildrenByParent[ROOT_KEY])) data.tabChildrenByParent[ROOT_KEY] = [];
      data.tabChildrenByParent[ROOT_KEY].push(newTabId);
      const snapshotItems = isObjectLike(liveSnapshot.itemsById) ? liveSnapshot.itemsById : {};
      const snapshotCollapsedById = isObjectLike(liveSnapshot.collapsedById) ? liveSnapshot.collapsedById : {};
      const snapshotChildren = isObjectLike(liveSnapshot.childrenByParentByTab) ? liveSnapshot.childrenByParentByTab : {};
      const idMap = {};
      Object.keys(snapshotItems).forEach((oldId) => {
        let newId = createId("item");
        while (data.itemsById?.[newId]) newId = createId("item");
        idMap[oldId] = newId;
      });
      const remappedCollapsedById = {};
      Object.keys(snapshotItems).forEach((oldId) => {
        const oldItem = deepClone(snapshotItems[oldId], {});
        const newId = idMap[oldId];
        if (!newId) return;
        const isCollapsed = Object.prototype.hasOwnProperty.call(snapshotCollapsedById, oldId)
          ? !!snapshotCollapsedById[oldId]
          : !!oldItem.isCollapsed;
        data.itemsById[newId] = {
          ...oldItem,
          id: newId,
          tabId: newTabId,
          parentId: null,
          sourceType: "tab",
          sourceParadigmId: null,
          sourceParadigmItemId: null,
          sourceParadigmBindingRootId: null,
          sourceParadigmMountScopeId: null,
          sourceParadigmCopyRefId: null,
          sourceParadigmMountMode: "direct",
          orphaned: false,
          isCollapsed,
          createdAt: nowString(),
          updatedAt: nowString(),
        };
        remappedCollapsedById[newId] = isCollapsed;
      });
      const rootScopedKey = tabParentKey(newTabId, null);
      const sourceRootScopedKey = tabParentKey(sourceTabId, null);
      const fallbackRootIds = Object.keys(snapshotItems)
        .filter((oldId) => !sanitizeText(snapshotItems[oldId]?.parentId, ""));
      const rootChildIds = ensureUniqueIds(
        (snapshotChildren[sourceRootScopedKey] || []).concat(fallbackRootIds),
      )
        .map((oldId) => idMap[oldId] || null)
        .filter(Boolean);
      data.childrenByParentByTab[rootScopedKey] = ensureUniqueIds(
        (Array.isArray(data.childrenByParentByTab[rootScopedKey]) ? data.childrenByParentByTab[rootScopedKey] : []).concat(rootChildIds),
      );
      rootChildIds.forEach((itemId) => {
        if (data.itemsById?.[itemId]) data.itemsById[itemId].parentId = null;
      });
      Object.keys(snapshotChildren).forEach((scopedKey) => {
        const parsed = splitScopedKey(scopedKey, sourceTabId);
        if (parsed.ownerId !== sourceTabId || parsed.parent === ROOT_KEY) return;
        const newParentId = idMap[parsed.parent] || null;
        if (!newParentId) return;
        const remappedChildIds = ensureUniqueIds(snapshotChildren[scopedKey] || [])
          .map((oldId) => idMap[oldId] || null)
          .filter(Boolean);
        const newScopedKey = tabParentKey(newTabId, newParentId);
        data.childrenByParentByTab[newScopedKey] = ensureUniqueIds(
          (Array.isArray(data.childrenByParentByTab[newScopedKey]) ? data.childrenByParentByTab[newScopedKey] : []).concat(remappedChildIds),
        );
        remappedChildIds.forEach((itemId) => {
          if (data.itemsById?.[itemId]) data.itemsById[itemId].parentId = newParentId;
        });
      });
      if (!isObjectLike(data.collapsedById)) data.collapsedById = {};
      Object.assign(data.collapsedById, remappedCollapsedById);
      rebuildTabOrderFromData(data);
      data.activeTabId = newTabId;
    });
    if (!ok) return false;
    this.getSelectedSnapshotId(restoredTabId || this.getActiveTabId());
    new Notice("✅ 快照已恢复为新 Tab");
    return true;
  }

  async deleteSnapshot(snapshotId) {
    const snapshot = this.getSnapshotById(snapshotId);
    if (!snapshot) return false;
    const okToDelete = window.confirm(`确定删除快照「${sanitizeText(snapshot.name, snapshot.id)}」吗？`);
    if (!okToDelete) return false;
    const normalizedSnapshotId = sanitizeText(snapshotId, "");
    const ok = await this.updateWorkspaceData((data) => {
      if (isObjectLike(data.snapshotsById)) delete data.snapshotsById[normalizedSnapshotId];
      Object.keys(data.snapshotOrderByTab || {}).forEach((tabId) => {
        data.snapshotOrderByTab[tabId] = ensureUniqueIds(data.snapshotOrderByTab[tabId] || [])
          .filter((id) => id !== normalizedSnapshotId);
      });
    });
    if (!ok) return false;
    if (sanitizeText(this.selectedSnapshotId, "") === normalizedSnapshotId) this.setSelectedSnapshotId("");
    new Notice("🗑️ 快照已删除");
    return true;
  }

  async moveTabOrder(draggedIdRaw, targetIdRaw, position = "after") {
    const draggedId = sanitizeText(draggedIdRaw, "");
    const targetId = sanitizeText(targetIdRaw, "");
    if (!draggedId || !targetId || draggedId === targetId) return;
    const targetTab = this.getTabById(targetId);
    if (!this.getTabById(draggedId) || !targetTab) return;
    const nextParentId = position === "child" ? targetId : (targetTab.parentTabId || null);
    if (this.wouldCreateTabCycle(draggedId, nextParentId)) {
      new Notice("不能把 Tab 拖到自己的子级下面");
      return;
    }
    await this.updateWorkspaceData((data) => {
      ensureTabHierarchyState(data);
      const dragged = data.tabsById?.[draggedId];
      const target = data.tabsById?.[targetId];
      if (!dragged || !target) return;
      const parentId = position === "child" ? target.id : (target.parentTabId || null);
      this.removeIdFromSimpleChildrenMap(data.tabChildrenByParent, dragged.id);
      dragged.parentTabId = parentId;
      dragged.updatedAt = nowString();
      const key = parentKey(parentId);
      if (!Array.isArray(data.tabChildrenByParent[key])) data.tabChildrenByParent[key] = [];
      const siblings = data.tabChildrenByParent[key];
      if (position === "child") {
        siblings.unshift(dragged.id);
      } else {
        const targetIndex = siblings.indexOf(target.id);
        if (targetIndex < 0) siblings.push(dragged.id);
        else siblings.splice(position === "before" ? targetIndex : targetIndex + 1, 0, dragged.id);
      }
      rebuildTabOrderFromData(data);
    });
  }

  renderTabButton(container, tabId) {
    const tab = this.workspaceData?.tabsById?.[tabId];
    if (!tab) return;
    const isActive = tabId === this.getActiveTabId();
    const button = container.createEl("button", {
      cls: `workspace-mount-tab-btn ${isActive ? "is-active" : ""}`.trim(),
      attr: { type: "button" },
    });
    button.createEl("div", {
      text: `${sanitizeText(tab.emoji, "") ? `${tab.emoji} ` : ""}${tab.name || tab.id}`,
      cls: "workspace-mount-tab-name",
    });
    button.createEl("div", {
      text: `${tab.id}${tab.parentTabId ? ` · parent ${tab.parentTabId}` : " · root"}`,
      cls: "workspace-mount-tab-meta",
    });
    button.onclick = async () => {
      const changed = await this.setActiveTabId(tabId);
      if (changed) new Notice(`Workspace active tab -> ${tab.name || tab.id}`);
    };
  }

  renderTabCapsule(container, tabId, activeTabId) {
    const tab = this.getTabById(tabId);
    if (!tab) return;
    const childIds = this.getTabChildrenIds(tab.id);
    const hasChildren = childIds.length > 0;
    const collapsed = hasChildren ? this.isTabTreeCollapsed(tab.id) : false;
    const tabEmoji = normalizeTabEmoji(tab.emoji || "");
    const tabAccentColor = normalizeTabAccentColor(tab.accentColor || "");
    const tabAccentTextColor = tabAccentColor ? getReadableTextColor(tabAccentColor) : "var(--text-on-accent)";
    const wrapper = container.createEl("div", {
      cls: `${hasChildren ? "workspace-mount-tab-capsule" : "workspace-mount-tab-leaf"} ${tab.id === activeTabId ? "is-current" : ""}`.trim(),
    });
    if (tabAccentColor) {
      wrapper.style.setProperty("--workspace-tab-frame-border", `${tabAccentColor}52`);
      wrapper.style.setProperty("--workspace-tab-frame-border-hover", `${tabAccentColor}88`);
      wrapper.style.setProperty("--workspace-tab-frame-border-current", `${tabAccentColor}78`);
      wrapper.style.setProperty("--workspace-tab-frame-bg-strong", `${tabAccentColor}18`);
      wrapper.style.setProperty("--workspace-tab-frame-bg-soft", `${tabAccentColor}08`);
    }
    wrapper.draggable = true;
    wrapper.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      this.draggedTabId = tab.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tab.id);
      window.setTimeout(() => wrapper.classList.add("is-dragging"), 0);
    });
    wrapper.addEventListener("dragend", (e) => {
      e.stopPropagation();
      this.draggedTabId = "";
      wrapper.classList.remove("is-dragging", "drag-over-before", "drag-over-after", "drag-over-child");
    });
    wrapper.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const draggedId = this.draggedTabId;
      if (!draggedId || draggedId === tab.id) return;
      const rect = wrapper.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / Math.max(rect.width, 1);
      wrapper.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
      if (ratio < 0.25) wrapper.classList.add("drag-over-before");
      else if (ratio > 0.75) wrapper.classList.add("drag-over-after");
      else wrapper.classList.add("drag-over-child");
    });
    wrapper.addEventListener("dragleave", (e) => {
      e.stopPropagation();
      wrapper.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
    });
    wrapper.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const draggedId = this.draggedTabId;
      wrapper.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
      if (!draggedId || draggedId === tab.id) return;
      const rect = wrapper.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / Math.max(rect.width, 1);
      const position = ratio < 0.25 ? "before" : (ratio > 0.75 ? "after" : "child");
      await this.moveTabOrder(draggedId, tab.id, position);
    });

    const headRow = hasChildren
      ? wrapper.createEl("div", { cls: "workspace-mount-tab-capsule-head" })
      : wrapper;
    if (hasChildren) {
      const collapseBtn = headRow.createEl("button", {
        cls: `workspace-mount-tab-collapse-toggle ${collapsed ? "is-collapsed" : ""}`,
        text: collapsed ? "▶" : "▼",
        attr: { type: "button" },
      });
      collapseBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.toggleTabTreeCollapsed(tab.id);
      };
    }
    const tabBtn = headRow.createEl("button", {
      cls: `workspace-mount-tab-pill ${tab.id === activeTabId ? "active" : ""}`.trim(),
      attr: { type: "button", title: "点击切换；拖拽可调整为前 / 后 / 子级" },
    });
    if (tabAccentColor) {
      tabBtn.style.setProperty("--workspace-tab-active-bg", tabAccentColor);
      tabBtn.style.setProperty("--workspace-tab-active-border", tabAccentColor);
      tabBtn.style.setProperty("--workspace-tab-active-fg", tabAccentTextColor);
    }
    tabBtn.createEl("span", {
      text: `${tab.id === activeTabId ? "● " : ""}${tabEmoji ? `${tabEmoji} ` : ""}${tab.name}`,
    });
    tabBtn.onclick = async () => {
      await this.setActiveTabId(tab.id);
    };
    if (hasChildren && !collapsed) {
      const childWrap = wrapper.createEl("div", { cls: "workspace-mount-tab-children" });
      childIds.forEach((childId) => this.renderTabCapsule(childWrap, childId, activeTabId));
    }
  }

  renderItemBranch(container, itemId, tabId, level = 0, trail = new Set()) {
    const item = this.getItemById(itemId);
    if (!item || item.tabId !== tabId) return;
    if (trail.has(itemId)) {
      container.createDiv({ text: `循环引用: ${item.title || item.id}`, cls: "workspace-loop-warn" });
      return;
    }
    const nextTrail = new Set(trail);
    nextTrail.add(itemId);
    const childIds = this.getChildrenIds(item.id, tabId);
    const hasKids = childIds.length > 0;
    const noteBinding = this.getItemNoteBinding(item);
    const boundFile = this.resolveBoundFile(noteBinding);
    const bindingLabel = getBindingLabel(noteBinding);
    const commentText = this.getItemComment(item);
    const commentSummary = getCommentSummary(commentText);
    const imageInfo = this.resolveImageFile(item.imageRef);
    const isMountedReadonly = this.isReadonlyParadigmMountedItem(item);
    const paradigmInfo = isMountedReadonly ? this.getParadigmDisplayInfo(item) : null;
    const levelBg = getLevelBackground(level);
    const mountModeLabel = isMountedReadonly
      ? (item.sourceParadigmMountMode === "inherited" ? "继承挂入" : "直接挂入")
      : "";
    const branch = container.createDiv({
      cls: `workspace-item-branch ${isMountedReadonly && hasKids ? "is-paradigm-group" : ""}`.trim(),
      attr: { style: `margin-left:${level * 26}px;` },
    });
    if (hasKids && item.isCollapsed) branch.classList.add("is-collapsed");
    if (isMountedReadonly && hasKids) {
      this.applyParadigmPalette(branch, paradigmInfo?.paletteSeed || item);
      branch.style.border = "1px solid var(--workspace-paradigm-border)";
      branch.style.borderRadius = "12px";
      branch.style.padding = "6px 6px 8px 6px";
      branch.style.marginBottom = "8px";
      branch.style.background = "linear-gradient(180deg, var(--workspace-paradigm-bg) 0%, rgba(255,255,255,0) 100%)";
      branch.style.boxShadow = "inset 0 0 0 1px var(--workspace-paradigm-bg-strong)";
    }
    const line = branch.createDiv({
      cls: `workspace-item-line ${item.sourceType === "paradigm" ? "is-paradigm" : "is-tab-item"} ${isMountedReadonly ? "is-mounted-readonly" : ""} ${hasKids && item.isCollapsed ? "is-collapsed" : ""}`.trim(),
      attr: { style: `--workspace-item-level-bg:${levelBg};` },
    });
    if (isMountedReadonly) {
      this.applyParadigmPalette(line, paradigmInfo?.paletteSeed || item);
    }
    line.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const draggedId = this.draggedItemId;
      if (!draggedId || draggedId === item.id) return;
      const rect = line.getBoundingClientRect();
      const childThreshold = 56;
      line.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
      if ((e.clientX - rect.left) > childThreshold) line.classList.add("drag-over-child");
      else if ((e.clientY - rect.top) < rect.height / 2) line.classList.add("drag-over-top");
      else line.classList.add("drag-over-bottom");
    });
    line.addEventListener("dragleave", (e) => {
      e.stopPropagation();
      line.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
    });
    line.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const draggedId = this.draggedItemId;
      line.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
      if (!draggedId || draggedId === item.id) return;
      const rect = line.getBoundingClientRect();
      const childThreshold = 56;
      const position = (e.clientX - rect.left) > childThreshold
        ? "child"
        : ((e.clientY - rect.top) < rect.height / 2 ? "before" : "after");
      await this.moveItem(draggedId, item.id, position);
    });

    const thumbBtn = line.createEl("button", {
      cls: `workspace-item-thumb ${imageInfo?.url ? "has-image" : "is-empty"}`,
      attr: {
        type: "button",
        title: item.imageRef ? `图片: ${normalizeImageRef(item.imageRef)}` : "暂无图片",
      },
    });
    if (imageInfo?.url) {
      const thumbImg = thumbBtn.createEl("img", { cls: "workspace-item-thumb-img" });
      thumbImg.src = imageInfo.url;
      thumbImg.alt = `${item.title || item.id} image`;
    } else {
      thumbBtn.createEl("span", { text: "🖼️", cls: "workspace-item-thumb-placeholder" });
    }
    thumbBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await this.editItemImage(item.id);
    };

    const left = line.createDiv({ cls: "workspace-line-left" });
    const dragHandle = left.createEl("span", {
      cls: "workspace-drag-handle",
      text: item.sourceType === "paradigm" ? "📐" : "⋮⋮",
      attr: { title: item.sourceType === "paradigm" ? "拖拽调整引用挂载位置（写回定义源）" : "拖拽调整位置" },
    });
    dragHandle.draggable = true;
    dragHandle.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      this.draggedItemId = item.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", item.id);
      window.setTimeout(() => line.classList.add("is-dragging"), 0);
    });
    dragHandle.addEventListener("dragend", (e) => {
      e.stopPropagation();
      this.draggedItemId = "";
      line.classList.remove("is-dragging", "drag-over-top", "drag-over-bottom", "drag-over-child");
    });
    const collapseBtn = left.createEl("span", {
      cls: `workspace-collapse ${hasKids ? "clickable" : "dot"} ${hasKids && item.isCollapsed ? "is-collapsed" : ""}`.trim(),
      text: hasKids ? (item.isCollapsed ? "▶" : "▼") : "·",
    });
    if (hasKids) {
      collapseBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.toggleItemCollapsed(item.id);
      };
    }

    const content = line.createDiv({ cls: "workspace-line-content" });
    if (boundFile) {
      const titleBtn = content.createEl("a", {
        cls: "workspace-title-link is-bound",
        text: sanitizeText(item.title || item.content || item.name, item.id),
        attr: {
          href: boundFile.path,
          title: `打开 ${boundFile.path}`,
        },
      });
      titleBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.openBoundNote(noteBinding);
      };
    } else {
      content.createEl("div", {
        cls: "workspace-title-link is-static",
        text: sanitizeText(item.title || item.content || item.name, item.id),
        attr: {
          title: sanitizeText(item.title || item.id, item.id),
        },
      });
    }
    content.createEl("span", {
      cls: "workspace-origin-badge",
      text: item.tabId === this.getActiveTabId() ? `当前Tab ${this.getTabById(item.tabId)?.name || item.tabId}` : `下级Tab ${this.getTabById(item.tabId)?.name || item.tabId}`,
    });
    if (isMountedReadonly) {
      content.createEl("span", { cls: "workspace-origin-badge is-readonly", text: "写回定义源" });
      content.createEl("span", {
        cls: `workspace-origin-badge ${item.sourceParadigmMountMode === "inherited" ? "is-inherited" : "is-direct"}`.trim(),
        text: mountModeLabel,
      });
      content.createEl("span", {
        cls: "workspace-origin-badge is-paradigm-name",
        text: `范式 · ${paradigmInfo?.displayName || "未命名范式"}`,
      });
      if (item.sourceParadigmCopyRefId) {
        content.createEl("span", { cls: "workspace-origin-badge is-copy-scope", text: "副本 Scope" });
      }
    }
    if (bindingLabel) content.createEl("span", { cls: "workspace-bound-label", text: `🔗 ${bindingLabel}`, attr: { title: boundFile?.path || bindingLabel } });
    if (commentSummary) content.createEl("span", { cls: "workspace-comment-summary", text: `💬 ${commentSummary}`, attr: { title: commentText } });
    if (item.imageRef) content.createEl("span", { cls: "workspace-origin-badge", text: "有图片" });
    if (Array.isArray(item.shortcuts) && item.shortcuts.length > 0) {
      content.createEl("span", { cls: "workspace-origin-badge", text: `↗ ${item.shortcuts.length}` });
    }
    if (item.sourceType === "paradigm") {
      content.createEl("span", { cls: "workspace-origin-badge", text: "引用挂载" });
    }
    if (item.orphaned) content.createEl("span", { cls: "workspace-origin-badge orphaned", text: "游离" });
    if (hasKids && item.isCollapsed) {
      content.createEl("span", { cls: "workspace-origin-badge collapsed", text: "已折叠" });
    }
    content.createEl("div", {
      cls: "workspace-item-meta",
      text: `${item.id}${item.updatedAt ? ` · 更新 ${String(item.updatedAt).slice(0, 10)}` : ""}${item.createdAt ? ` · 建于 ${String(item.createdAt).slice(0, 10)}` : ""}`,
    });

    const actions = line.createDiv({ cls: "workspace-line-actions" });
    if (isMountedReadonly) {
      const addLocalBtn = actions.createEl("span", {
        cls: "workspace-action-btn",
        text: "＋",
        attr: { title: "添加本地子条目" },
      });
      addLocalBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.addItemWithMode(item.id, tabId, "local");
      };
      const addParadigmBtn = actions.createEl("span", {
        cls: "workspace-action-btn",
        text: "📐＋",
        attr: { title: "添加范式子条目（写回定义源）" },
      });
      addParadigmBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.addItemWithMode(item.id, tabId, "paradigm");
      };
    } else {
      const addBtn = actions.createEl("span", {
        cls: "workspace-action-btn",
        text: "＋",
        attr: { title: "添加子条目" },
      });
      addBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.addItemWithMode(item.id, tabId, "local");
      };
    }
    const renameBtn = actions.createEl("span", {
      cls: "workspace-action-btn",
      text: "✏️",
      attr: { title: isMountedReadonly ? "重命名并写回范式" : "重命名" },
    });
    renameBtn.onclick = async (e) => {
      e.stopPropagation();
      await this.renameItem(item.id);
    };
    const imageBtn = actions.createEl("span", {
      cls: "workspace-action-btn",
      text: "🖼️",
      attr: { title: isMountedReadonly ? "修改图片并写回范式" : (item.imageRef ? "修改图片" : "添加图片") },
    });
    imageBtn.onclick = async (e) => {
      e.stopPropagation();
      await this.editItemImage(item.id);
    };
    const bindBtn = actions.createEl("span", {
      cls: "workspace-action-btn",
      text: noteBinding ? "🔗" : "📝",
      attr: { title: isMountedReadonly ? "修改/清除绑定并写回范式" : (noteBinding ? "修改/清除绑定" : "绑定 Obsidian 笔记") },
    });
    bindBtn.onclick = async (e) => {
      e.stopPropagation();
      await this.editItemNoteBinding(item.id);
    };
    const commentBtn = actions.createEl("span", {
      cls: "workspace-action-btn",
      text: commentText ? "💬" : "🗒️",
      attr: { title: isMountedReadonly ? "编辑评论并写回范式" : (commentText ? "编辑评论" : "添加评论") },
    });
    commentBtn.onclick = async (e) => {
      e.stopPropagation();
      await this.editItemComment(item.id);
    };
    if (boundFile) {
      const openBtn = actions.createEl("span", {
        cls: "workspace-action-btn",
        text: "🔗",
        attr: { title: "打开绑定笔记" },
      });
      openBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.openBoundNote(noteBinding);
      };
    }
    const deleteBtn = actions.createEl("span", {
      cls: "workspace-action-btn",
      text: "🗑️",
      attr: { title: isMountedReadonly ? "删除并写回范式，挂载处会变成原范式普通条目" : "删除" },
    });
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      await this.deleteItem(item.id);
    };

    if (hasKids && !item.isCollapsed) {
      if (isMountedReadonly) {
        const localChildIds = [];
        const paradigmChildIds = [];
        childIds.forEach((childId) => {
          const childItem = this.getItemById(childId);
          if (!childItem || childItem.tabId !== tabId) return;
          if (this.isParadigmMountedItem(childItem)) paradigmChildIds.push(childId);
          else localChildIds.push(childId);
        });
        localChildIds.forEach((childId) => this.renderItemBranch(branch, childId, tabId, level + 1, nextTrail));
        if (localChildIds.length > 0 && paradigmChildIds.length > 0) {
          branch.createDiv({
            cls: "workspace-branch-separator is-paradigm-children",
            text: "↓ 以下为范式预设子节点",
            attr: { style: `margin-left:${(level + 1) * 26}px;` },
          });
        }
        paradigmChildIds.forEach((childId) => this.renderItemBranch(branch, childId, tabId, level + 1, nextTrail));
      } else {
        childIds.forEach((childId) => this.renderItemBranch(branch, childId, tabId, level + 1, nextTrail));
      }
    }
  }

  renderParadigmMountGroup(container, tabId, paradigmNodeId, paradigmRootItemIdsById, includedParadigmIdSet, rootMap, level = 0, trail = new Set()) {
    const groupParadigm = this.getParadigmById(paradigmNodeId);
    if (!groupParadigm) return;
    const groupedItems = (paradigmRootItemIdsById.get(paradigmNodeId) || [])
      .map((id) => this.getItemById(id))
      .filter((item) => !!item && item.tabId === tabId && this.isParadigmMountedItem(item) && item.sourceParadigmMountScopeId === paradigmNodeId);
    const childParadigmIds = getEffectiveChildParadigmIdsFromData(this.workspaceData, paradigmNodeId)
      .filter((childId) => includedParadigmIdSet.has(childId));
    if (groupedItems.length === 0 && childParadigmIds.length === 0) return;
    const collapsed = this.isParadigmMountGroupCollapsed(tabId, paradigmNodeId);
    const bindingRootParadigmId = rootMap.get(paradigmNodeId) || paradigmNodeId;
    const bindingRootParadigm = this.getParadigmById(bindingRootParadigmId);
    const isInherited = bindingRootParadigmId !== paradigmNodeId;
    const sourceParadigm = this.getParadigmById(getParadigmSourceIdInData(this.workspaceData, paradigmNodeId)) || groupParadigm;
    const isCopyNode = isParadigmCopyInData(this.workspaceData, paradigmNodeId);

    const branch = container.createDiv({
      cls: "workspace-paradigm-mount-group",
      attr: {
        style: `margin-left:${level * 26}px;`,
        "data-workspace-paradigm-mount-id": paradigmNodeId,
        "data-workspace-paradigm-mount-tab-id": tabId,
      },
    });
    const groupInfo = this.applyParadigmPalette(branch, paradigmNodeId);
    if (collapsed) branch.classList.add("is-collapsed");

    const head = branch.createDiv({
      cls: "workspace-paradigm-mount-group-head",
      attr: {
        "data-workspace-paradigm-mount-id": paradigmNodeId,
        "data-workspace-paradigm-mount-tab-id": tabId,
      },
    });
    const left = head.createDiv({ cls: "workspace-paradigm-mount-group-left" });
    const collapseBtn = left.createEl("button", {
      text: collapsed ? "▶" : "▼",
      cls: `workspace-paradigm-collapse clickable ${collapsed ? "is-collapsed" : ""}`.trim(),
      attr: { type: "button" },
    });
    collapseBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await this.toggleParadigmMountGroupCollapsed(tabId, paradigmNodeId);
    };

    const meta = left.createDiv({ cls: "workspace-paradigm-mount-group-meta" });
    meta.createEl("div", {
      text: `范式挂载 · ${groupInfo?.displayName || sourceParadigm?.name || groupParadigm?.name || paradigmNodeId}${isCopyNode ? " · 引用副本" : ""}`,
      cls: "workspace-paradigm-mount-group-title",
    });
    meta.createEl("div", {
      text: isInherited
        ? `根条目 ${groupedItems.length} 个 · 子范式 ${childParadigmIds.length} 个 · 继承自 ${bindingRootParadigm?.name || bindingRootParadigmId}`
        : `根条目 ${groupedItems.length} 个 · 子范式 ${childParadigmIds.length} 个 · 当前Tab引用挂载`,
      cls: "workspace-paradigm-mount-group-subtitle",
    });

    const badgeRow = head.createDiv({ cls: "workspace-paradigm-badge-row" });
    badgeRow.createEl("span", {
      text: "写回定义源",
      cls: "workspace-origin-badge is-readonly",
    });
    badgeRow.createEl("span", {
      text: isInherited ? "继承挂入" : "当前Tab直接引用",
      cls: `workspace-origin-badge ${isInherited ? "is-inherited" : "is-direct"}`.trim(),
    });
    badgeRow.createEl("span", {
      text: groupInfo?.displayName || "未命名范式",
      cls: "workspace-origin-badge is-paradigm-name",
    });
    if (isCopyNode) {
      badgeRow.createEl("span", {
        text: "副本 Scope",
        cls: "workspace-origin-badge is-copy-scope",
      });
    }
    if (collapsed) {
      badgeRow.createEl("span", {
        text: "已折叠",
        cls: "workspace-origin-badge collapsed",
      });
    }

    if (!collapsed) {
      const childWrap = branch.createDiv({ cls: "workspace-paradigm-mount-group-children" });
      groupedItems.forEach((item) => this.renderItemBranch(childWrap, item.id, tabId, 0, trail));
      childParadigmIds.forEach((childParadigmId) => {
        this.renderParadigmMountGroup(childWrap, tabId, childParadigmId, paradigmRootItemIdsById, includedParadigmIdSet, rootMap, 1, trail);
      });
    }
  }

  renderParadigmMountCollection(container, tabId, paradigmRootItemIdsById, level = 0, trail = new Set()) {
    const { rootMapInfo, includedParadigmIds, includedParadigmIdSet, rootParadigmIds } = getOrderedParadigmMountRootIdsForTabData(this.workspaceData, tabId);
    if (rootParadigmIds.length === 0) return;
    const collapsed = this.isParadigmMountCollectionCollapsed(tabId);
    const totalRootItems = Array.from(paradigmRootItemIdsById.values()).reduce((sum, ids) => sum + ids.length, 0);
    const totalParadigmCount = includedParadigmIds.length;

    const branch = container.createDiv({
      cls: "workspace-paradigm-mount-collection",
      attr: { style: `margin-left:${level * 26}px;` },
    });
    if (collapsed) branch.classList.add("is-collapsed");
    const head = branch.createDiv({ cls: "workspace-paradigm-mount-collection-head" });
    const left = head.createDiv({ cls: "workspace-paradigm-mount-collection-left" });
    const collapseBtn = left.createEl("button", {
      text: collapsed ? "▶" : "▼",
      cls: `workspace-paradigm-collapse clickable ${collapsed ? "is-collapsed" : ""}`.trim(),
      attr: { type: "button" },
    });
    collapseBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await this.toggleParadigmMountCollectionCollapsed(tabId);
    };
    const meta = left.createDiv({ cls: "workspace-paradigm-mount-group-meta" });
    meta.createEl("div", {
      text: `范式挂载集合 · ${totalParadigmCount} 个范式节点`,
      cls: "workspace-paradigm-mount-group-title",
    });
    meta.createEl("div", {
      text: `根条目 ${totalRootItems} 个 · 支持写回定义源`,
      cls: "workspace-paradigm-mount-group-subtitle",
    });
    const badgeRow = head.createDiv({ cls: "workspace-paradigm-badge-row" });
    badgeRow.createEl("span", {
      text: "写回定义源",
      cls: "workspace-origin-badge is-readonly",
    });
    badgeRow.createEl("span", {
      text: "物化同步",
      cls: "workspace-origin-badge is-direct",
    });
    if (!collapsed) {
      const childWrap = branch.createDiv({ cls: "workspace-paradigm-mount-group-children" });
      rootParadigmIds.forEach((paradigmId) => {
        this.renderParadigmMountGroup(childWrap, tabId, paradigmId, paradigmRootItemIdsById, includedParadigmIdSet, rootMapInfo.rootMap, 0, trail);
      });
    }
  }

  renderParadigmTagChipGroup(container, tagIds, options = {}) {
    const normalizedTagIds = normalizeParadigmTagIds(tagIds, this.workspaceData?.paradigmTagsById || {});
    if (normalizedTagIds.length === 0) {
      if (options.emptyText) {
        container.createDiv({ text: options.emptyText, cls: "workspace-paradigm-tag-filter-empty" });
      }
      return null;
    }
    const activeSet = options.activeSet instanceof Set
      ? options.activeSet
      : new Set(normalizeParadigmTagIds(options.activeSet || [], this.workspaceData?.paradigmTagsById || {}));
    const wrapper = container.createDiv({
      cls: `workspace-paradigm-tag-summary ${options.groupClass || ""}`.trim(),
    });
    normalizedTagIds
      .slice()
      .sort((a, b) => this.getParadigmTagPathLabel(a).localeCompare(this.getParadigmTagPathLabel(b), "zh"))
      .forEach((tagId) => {
        const tag = this.getParadigmTagById(tagId);
        if (!tag) return;
        const tagColor = sanitizeText(tag.color, "") || DEFAULT_PARADIGM_TAG_COLOR;
        const chipTag = options.onClick ? "button" : "div";
        const chip = wrapper.createEl(chipTag, {
          cls: `workspace-paradigm-tag-chip ${activeSet.has(tagId) ? "is-active" : ""} ${options.onClick ? "is-filter" : ""}`.trim(),
          attr: options.onClick ? { type: "button" } : {},
        });
        chip.createEl("span", {
          cls: "workspace-paradigm-tag-chip-dot",
          attr: { style: `background:${tagColor};` },
        });
        chip.createEl("span", {
          text: options.showPath ? this.getParadigmTagPathLabel(tag.id) : (sanitizeText(tag.label, tag.id) || tag.id),
        });
        if (options.onClick) chip.onclick = () => options.onClick(tag.id);
      });
    return wrapper;
  }

  renderParadigmTagFilterTree(container, activeFilterIds = [], onToggle = null) {
    const activeSet = new Set(normalizeParadigmTagIds(activeFilterIds, this.workspaceData?.paradigmTagsById || {}));
    const topLevelTagIds = this.getSortedParadigmTagChildrenIds(null);
    const getDropPosition = (wrapper, event) => {
      const rect = wrapper.getBoundingClientRect();
      const ratio = (event.clientX - rect.left) / Math.max(rect.width, 1);
      if (ratio < 0.25) return "before";
      if (ratio > 0.75) return "after";
      return "child";
    };
    if (topLevelTagIds.length === 0) {
      container.createDiv({
        cls: "workspace-paradigm-tag-filter-empty",
        text: "还没有范式标签，先给范式打一些标签再筛选。",
      });
      return;
    }
    const rootDropZone = container.createDiv({
      cls: "workspace-paradigm-tag-root-drop",
      text: "↥ 拖到这里设为顶层标签",
    });
    rootDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!this.draggedParadigmTagId) return;
      rootDropZone.classList.add("drag-over");
    });
    rootDropZone.addEventListener("dragleave", () => rootDropZone.classList.remove("drag-over"));
    rootDropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      rootDropZone.classList.remove("drag-over");
      const draggedId = sanitizeText(this.draggedParadigmTagId, "");
      if (!draggedId) return;
      await this.moveParadigmTagOrder(draggedId, null, "after");
    });
    const topWrap = container.createDiv({ cls: "workspace-paradigm-tag-capsule-group" });
    const renderBranch = (parent, tagId) => {
      const tag = this.getParadigmTagById(tagId);
      if (!tag) return;
      const tagColor = sanitizeText(tag.color, "") || DEFAULT_PARADIGM_TAG_COLOR;
      const childTagIds = this.getSortedParadigmTagChildrenIds(tag.id);
      const hasChildren = childTagIds.length > 0;
      const isActive = activeSet.has(tag.id);
      const wrapper = parent.createDiv({
        cls: hasChildren
          ? `workspace-paradigm-tag-capsule ${isActive ? "is-active" : ""}`.trim()
          : `workspace-paradigm-tag-leaf ${isActive ? "is-active" : ""}`.trim(),
      });
      wrapper.draggable = true;
      wrapper.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        this.draggedParadigmTagId = tag.id;
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", tag.id);
        }
        window.setTimeout(() => wrapper.classList.add("is-dragging"), 0);
      });
      wrapper.addEventListener("dragend", (e) => {
        e.stopPropagation();
        this.draggedParadigmTagId = "";
        wrapper.classList.remove("is-dragging", "drag-over-before", "drag-over-after", "drag-over-child");
      });
      wrapper.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedId = sanitizeText(this.draggedParadigmTagId, "");
        if (!draggedId || draggedId === tag.id) return;
        const position = getDropPosition(wrapper, e);
        wrapper.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
        if (position === "before") wrapper.classList.add("drag-over-before");
        else if (position === "after") wrapper.classList.add("drag-over-after");
        else wrapper.classList.add("drag-over-child");
      });
      wrapper.addEventListener("dragleave", (e) => {
        e.stopPropagation();
        wrapper.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
      });
      wrapper.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedId = sanitizeText(this.draggedParadigmTagId, "");
        wrapper.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
        if (!draggedId || draggedId === tag.id) return;
        const position = getDropPosition(wrapper, e);
        await this.moveParadigmTagOrder(draggedId, tag.id, position);
      });
      const head = hasChildren
        ? wrapper.createDiv({ cls: "workspace-paradigm-tag-capsule-head" })
        : wrapper;
      const chip = head.createEl("button", {
        cls: `workspace-paradigm-tag-filter-chip ${isActive ? "is-active" : ""}`.trim(),
        attr: { type: "button", title: `${this.getDirectParadigmTagUsageCount(tag.id)} 个范式` },
      });
      chip.createEl("span", {
        cls: "workspace-paradigm-tag-chip-dot",
        attr: { style: `background:${tagColor};` }
      });
      chip.createEl("span", {
        text: sanitizeText(tag.label, tag.id) || tag.id,
      });
      if (onToggle) {
        chip.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle(tag.id);
        };
      }
      const actionWrap = head.createDiv({ cls: "workspace-paradigm-tag-inline-actions" });
      const addSiblingBtn = actionWrap.createEl("button", {
        text: "＋",
        cls: "workspace-paradigm-tag-mini-btn",
        attr: { type: "button", title: "新建同级标签" },
      });
      addSiblingBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.editParadigmTagDefinition({ presetParentTagId: tag.parentTagId || null });
      };
      const addChildBtn = actionWrap.createEl("button", {
        text: "↳",
        cls: "workspace-paradigm-tag-mini-btn",
        attr: { type: "button", title: "新建子标签" },
      });
      addChildBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.editParadigmTagDefinition({ presetParentTagId: tag.id });
      };
      const editBtn = actionWrap.createEl("button", {
        text: "✏",
        cls: "workspace-paradigm-tag-mini-btn",
        attr: { type: "button", title: "编辑标签" },
      });
      editBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.editParadigmTagDefinition({ tagId: tag.id });
      };
      const deleteBtn = actionWrap.createEl("button", {
        text: "🗑",
        cls: "workspace-paradigm-tag-mini-btn danger",
        attr: { type: "button", title: "删除标签" },
      });
      deleteBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.deleteParadigmTag(tag.id);
      };
      if (childTagIds.length > 0) {
        const childWrap = wrapper.createDiv({ cls: "workspace-paradigm-tag-children-capsules" });
        childTagIds.forEach((childId) => renderBranch(childWrap, childId));
      }
    };
    topLevelTagIds.forEach((tagId) => renderBranch(topWrap, tagId));
  }

  renderParadigmTagManager(container) {
    const wrapper = container.createDiv({ cls: "workspace-paradigm-tag-manager" });
    const head = wrapper.createDiv({ cls: "workspace-paradigm-tag-manager-head" });
    const headLeft = head.createDiv();
    headLeft.createEl("div", { text: "🏷️ 标签管理", cls: "workspace-panel-title" });
    headLeft.createEl("div", {
      text: "拖拽可调整层级；支持新建同级和子标签；这里只影响范式管理面板。",
      cls: "workspace-subtitle",
    });
    const actions = head.createDiv({ cls: "workspace-main-actions" });
    const createBtn = actions.createEl("button", {
      text: "＋ 新建标签",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    createBtn.onclick = async () => {
      await this.editParadigmTagDefinition();
    };

    const tagCount = Object.keys(this.workspaceData?.paradigmTagsById || {}).length;
    const topLevelCount = this.getSortedParadigmTagChildrenIds(null).length;
    wrapper.createEl("div", {
      cls: "workspace-paradigm-hint",
      text: `共 ${tagCount} 个标签；顶层 ${topLevelCount} 个。拖到顶部拖放区可设为顶层标签。`,
    });

    const rootDropZone = wrapper.createDiv({
      cls: "workspace-paradigm-tag-root-drop",
      text: "↥ 拖到这里设为顶层标签",
    });
    rootDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!this.draggedParadigmTagId) return;
      rootDropZone.classList.add("drag-over");
    });
    rootDropZone.addEventListener("dragleave", () => rootDropZone.classList.remove("drag-over"));
    rootDropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      rootDropZone.classList.remove("drag-over");
      const draggedId = sanitizeText(this.draggedParadigmTagId, "");
      if (!draggedId) return;
      await this.moveParadigmTagOrder(draggedId, null, "after");
    });

    const tree = wrapper.createDiv({ cls: "workspace-paradigm-tag-tree" });
    const getDropPosition = (row, event) => {
      const rect = row.getBoundingClientRect();
      const ratioX = (event.clientX - rect.left) / Math.max(rect.width, 1);
      if (ratioX > 0.68) return "child";
      return (event.clientY - rect.top) < rect.height / 2 ? "before" : "after";
    };
    const renderTagBranch = (parent, tagId, level = 0) => {
      const tag = this.getParadigmTagById(tagId);
      if (!tag) return;
      const childTagIds = this.getSortedParadigmTagChildrenIds(tag.id);
      const usageCount = this.getDirectParadigmTagUsageCount(tag.id);
      const branch = parent.createDiv({
        cls: "workspace-paradigm-tag-row-wrap",
        attr: { style: `margin-left:${level * 18}px;` },
      });
      const row = branch.createDiv({ cls: "workspace-paradigm-tag-row" });
      row.draggable = true;
      row.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        this.draggedParadigmTagId = tag.id;
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", tag.id);
        }
        window.setTimeout(() => row.classList.add("is-dragging"), 0);
      });
      row.addEventListener("dragend", (e) => {
        e.stopPropagation();
        this.draggedParadigmTagId = "";
        row.classList.remove("is-dragging", "drag-over-top", "drag-over-bottom", "drag-over-child");
      });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedId = sanitizeText(this.draggedParadigmTagId, "");
        row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
        if (!draggedId || draggedId === tag.id) return;
        const position = getDropPosition(row, e);
        if (position === "child") row.classList.add("drag-over-child");
        else if (position === "before") row.classList.add("drag-over-top");
        else row.classList.add("drag-over-bottom");
      });
      row.addEventListener("dragleave", (e) => {
        e.stopPropagation();
        row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
      });
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedId = sanitizeText(this.draggedParadigmTagId, "");
        row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
        if (!draggedId || draggedId === tag.id) return;
        const position = getDropPosition(row, e);
        await this.moveParadigmTagOrder(draggedId, tag.id, position);
      });

      const left = row.createDiv({ cls: "workspace-paradigm-tag-row-left" });
      left.createEl("span", {
        cls: "workspace-paradigm-tag-chip-dot",
        attr: { style: `background:${sanitizeText(tag.color, "") || DEFAULT_PARADIGM_TAG_COLOR};width:10px;height:10px;flex:0 0 10px;margin-top:6px;` },
      });
      const meta = left.createDiv({ cls: "workspace-paradigm-tag-row-meta" });
      meta.createEl("div", {
        text: sanitizeText(tag.label, tag.id) || tag.id,
        cls: "workspace-paradigm-tag-row-title",
      });
      meta.createEl("div", {
        text: `${tag.id} · 子标签 ${childTagIds.length} · 直接使用 ${usageCount} 个范式`,
        cls: "workspace-paradigm-tag-row-subtitle",
      });

      const rowActions = row.createDiv({ cls: "workspace-paradigm-tag-row-actions" });
      const addSiblingBtn = rowActions.createEl("button", {
        text: "＋ 同级",
        cls: "workspace-sub-btn",
        attr: { type: "button" },
      });
      addSiblingBtn.onclick = async () => {
        await this.editParadigmTagDefinition({ presetParentTagId: tag.parentTagId || null });
      };
      const addChildBtn = rowActions.createEl("button", {
        text: "＋ 子标签",
        cls: "workspace-sub-btn",
        attr: { type: "button" },
      });
      addChildBtn.onclick = async () => {
        await this.editParadigmTagDefinition({ presetParentTagId: tag.id });
      };
      const editBtn = rowActions.createEl("button", {
        text: "编辑",
        cls: "workspace-sub-btn",
        attr: { type: "button" },
      });
      editBtn.onclick = async () => {
        await this.editParadigmTagDefinition({ tagId: tag.id });
      };
      const deleteBtn = rowActions.createEl("button", {
        text: "删除",
        cls: "workspace-sub-btn",
        attr: { type: "button" },
      });
      deleteBtn.onclick = async () => {
        await this.deleteParadigmTag(tag.id);
      };

      if (childTagIds.length > 0) {
        const childWrap = branch.createDiv({ cls: "workspace-paradigm-tag-children" });
        childTagIds.forEach((childId) => renderTagBranch(childWrap, childId, level + 1));
      }
    };

    const topLevelTagIds = this.getSortedParadigmTagChildrenIds(null);
    if (topLevelTagIds.length === 0) {
      tree.createDiv({ text: "_暂无范式标签_", cls: "workspace-empty" });
      return wrapper;
    }
    topLevelTagIds.forEach((tagId) => renderTagBranch(tree, tagId, 0));
    return wrapper;
  }

  renderParadigmTocNode(container, panelContext, paradigmId, level = 0, trail = new Set()) {
    const paradigm = this.getParadigmById(paradigmId);
    if (!paradigm || trail.has(paradigmId) || !panelContext.includedParadigmIdSet.has(paradigmId)) return;
    const nextTrail = new Set(trail);
    nextTrail.add(paradigmId);
    const childIds = getEffectiveChildParadigmIdsFromData(this.workspaceData, paradigmId)
      .filter((childId) => panelContext.includedParadigmIdSet.has(childId));
    const isTopLevelSortable = level === 0 && panelContext.rootParadigmIds.includes(paradigmId);
    const row = container.createEl("button", {
      cls: `workspace-paradigm-toc-btn ${panelContext.directRootSet.has(paradigmId) ? "is-direct" : "is-included"} ${isTopLevelSortable ? "is-sortable" : ""}`.trim(),
      attr: {
        type: "button",
        title: isTopLevelSortable
          ? `跳转到范式：${paradigm.name || paradigm.id}；拖拽可调整「${this.getTabById(panelContext.tabId)?.name || panelContext.tabId}」里的顶层范式顺序`
          : `跳转到范式：${paradigm.name || paradigm.id}`,
      },
    });
    row.style.setProperty("--workspace-paradigm-toc-indent", `${level * 18}px`);
    this.applyParadigmPalette(row, paradigmId);
    const rootId = panelContext.rootMap.get(paradigmId) || paradigmId;
    const isInherited = rootId !== paradigmId;
    row.createEl("span", {
      text: `${panelContext.directRootSet.has(paradigmId) ? "●" : "◦"} ${paradigm.name || paradigm.id}`,
      cls: "workspace-paradigm-toc-btn-title",
    });
    row.createEl("span", {
      text: isInherited ? `继承自 ${this.getParadigmById(rootId)?.name || rootId}` : "当前Tab直接引用",
      cls: "workspace-paradigm-toc-btn-meta",
    });
    if (isTopLevelSortable) {
      row.draggable = true;
      row.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        this.draggedParadigmTocState = {
          kind: "mount",
          tabId: panelContext.tabId,
          paradigmId,
        };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", `${panelContext.tabId}::${paradigmId}`);
        window.setTimeout(() => row.classList.add("is-dragging"), 0);
      });
      row.addEventListener("dragend", () => {
        this.draggedParadigmTocState = null;
        row.removeAttribute("data-drop-position");
        row.classList.remove("is-dragging", "drag-over-before", "drag-over-after");
      });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dragState = this.draggedParadigmTocState;
        if (!dragState || dragState.kind !== "mount" || dragState.tabId !== panelContext.tabId || dragState.paradigmId === paradigmId) return;
        const position = getParadigmTocDropPosition(row, e);
        row.setAttribute("data-drop-position", position);
        row.classList.remove("drag-over-before", "drag-over-after");
        row.classList.add(position === "before" ? "drag-over-before" : "drag-over-after");
      });
      row.addEventListener("dragleave", () => {
        row.removeAttribute("data-drop-position");
        row.classList.remove("drag-over-before", "drag-over-after");
      });
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dragState = this.draggedParadigmTocState;
        const position = getParadigmTocDropPosition(row, e);
        row.removeAttribute("data-drop-position");
        row.classList.remove("drag-over-before", "drag-over-after");
        if (!dragState || dragState.kind !== "mount" || dragState.tabId !== panelContext.tabId || dragState.paradigmId === paradigmId) return;
        await this.moveTopLevelParadigmMountOrder(panelContext.tabId, dragState.paradigmId, paradigmId, position);
      });
    }
    row.onclick = async () => {
      await this.revealParadigmMountTarget(panelContext.tabId, paradigmId);
    };
    childIds.forEach((childId) => this.renderParadigmTocNode(container, panelContext, childId, level + 1, nextTrail));
  }

  renderTabParadigmTocGroup(container, rootTabId, groupTabId) {
    const groupTab = this.getTabById(groupTabId);
    if (!groupTab) return;
    const summary = this.getParadigmBindingSummaryForTab(groupTabId);
    const groupWrap = container.createDiv({ cls: "workspace-paradigm-toc-group" });
    const groupLabel = groupWrap.createDiv({
      cls: `workspace-paradigm-toc-group-label ${groupTabId !== rootTabId ? "is-child" : ""}`.trim(),
    });
    const groupBtn = groupLabel.createEl("button", {
      text: `${groupTabId === rootTabId ? "当前Tab" : "子Tab"} · ${groupTab.name || groupTab.id}`,
      cls: "workspace-paradigm-toc-tab-btn",
      attr: { type: "button" },
    });
    groupBtn.onclick = async () => {
      await this.revealWorkspaceTabSection(groupTabId);
    };
    groupLabel.createEl("span", {
      text: summary.includedParadigmIds.length > 0 ? `${summary.includedParadigmIds.length} 个范式` : "无范式",
      cls: "workspace-paradigm-toc-group-meta",
    });
    if (summary.rootParadigmIds.length === 0) {
      groupWrap.createDiv({ text: "当前 Tab 没有可见根范式。", cls: "workspace-empty" });
      return;
    }
    summary.rootParadigmIds.forEach((paradigmId) => {
      this.renderParadigmTocNode(groupWrap, {
        tabId: groupTabId,
        rootParadigmIds: summary.rootParadigmIds,
        directRootIds: summary.directRootIds,
        directRootSet: summary.directRootSet,
        includedParadigmIds: summary.includedParadigmIds,
        includedParadigmIdSet: summary.includedParadigmIdSet,
        rootMap: summary.rootMap,
      }, paradigmId, 0, new Set());
    });
  }

  renderParadigmPanelTocParadigmNode(container, panelContext, paradigmId, level = 0, currentCategoryId = null, trail = new Set()) {
    const paradigm = this.getParadigmById(paradigmId);
    if (!paradigm || trail.has(paradigmId)) return;
    if (panelContext?.tagVisibilityApi?.activeFilterIds?.length && !panelContext.tagVisibilityApi.visible(paradigmId)) return;
    const nextTrail = new Set(trail);
    nextTrail.add(paradigmId);
    const childIds = this.getCategoryParadigmChildIds(paradigm.id, currentCategoryId)
      .filter((childId) => !panelContext?.tagVisibilityApi || panelContext.tagVisibilityApi.visible(childId));
    const row = container.createEl("button", {
      cls: "workspace-paradigm-toc-btn is-panel-mode",
      attr: { type: "button" },
    });
    row.style.setProperty("--workspace-paradigm-toc-indent", `${level * 18}px`);
    this.applyParadigmPalette(row, paradigm.id);
    row.createEl("span", {
      text: `◦ ${paradigm.name || paradigm.id}`,
      cls: "workspace-paradigm-toc-btn-title",
    });
    row.createEl("span", {
      text: paradigm.categoryId ? `分类 ${this.getParadigmCategoryPathLabel(paradigm.categoryId) || paradigm.categoryId}` : "未分类",
      cls: "workspace-paradigm-toc-btn-meta",
    });
    row.onclick = async () => {
      await this.revealParadigmPanelTarget(paradigm.id);
    };
    childIds.forEach((childId) => this.renderParadigmPanelTocParadigmNode(container, panelContext, childId, level + 1, currentCategoryId, nextTrail));
  }

  renderParadigmPanelTocCategoryNode(container, panelContext, categoryId, level = 0, trail = new Set()) {
    const category = this.getParadigmCategoryById(categoryId);
    if (!category || trail.has(categoryId)) return;
    if (panelContext?.tagVisibilityApi?.activeFilterIds?.length && !panelContext.tagVisibilityApi.categoryVisible(category.id)) return;
    const nextTrail = new Set(trail);
    nextTrail.add(categoryId);
    const childCategoryIds = this.getChildParadigmCategoryIds(category.id)
      .filter((childId) => !panelContext?.tagVisibilityApi || panelContext.tagVisibilityApi.categoryVisible(childId));
    const paradigmRootIds = this.getCategoryParadigmRootIds(category.id)
      .filter((paradigmId) => !panelContext?.tagVisibilityApi || panelContext.tagVisibilityApi.visible(paradigmId));
    const row = container.createEl("button", {
      cls: "workspace-paradigm-toc-btn is-panel-mode is-category is-sortable",
      attr: {
        type: "button",
        title: `跳转到分类：${this.getParadigmCategoryPathLabel(category.id)}；拖拽可调整分类前后或子分类层级`,
      },
    });
    row.style.setProperty("--workspace-paradigm-toc-indent", `${level * 18}px`);
    this.applyParadigmPalette(row, category.id);
    row.createEl("span", {
      text: `📚 ${category.name || category.id}`,
      cls: "workspace-paradigm-toc-btn-title",
    });
    row.createEl("span", {
      text: `子分类 ${childCategoryIds.length} · 直属范式 ${paradigmRootIds.length}`,
      cls: "workspace-paradigm-toc-btn-meta",
    });
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      this.draggedParadigmTocState = {
        kind: "category",
        categoryId: category.id,
      };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", category.id);
      window.setTimeout(() => row.classList.add("is-dragging"), 0);
    });
    row.addEventListener("dragend", () => {
      this.draggedParadigmTocState = null;
      row.removeAttribute("data-drop-position");
      row.classList.remove("is-dragging", "drag-over-before", "drag-over-after", "drag-over-child");
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dragState = this.draggedParadigmTocState;
      if (!dragState || dragState.kind !== "category" || dragState.categoryId === category.id) return;
      const position = getParadigmCategoryTocDropPosition(row, e);
      row.setAttribute("data-drop-position", position);
      row.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
      if (position === "child") row.classList.add("drag-over-child");
      else row.classList.add(position === "before" ? "drag-over-before" : "drag-over-after");
    });
    row.addEventListener("dragleave", () => {
      row.removeAttribute("data-drop-position");
      row.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
    });
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dragState = this.draggedParadigmTocState;
      const position = getParadigmCategoryTocDropPosition(row, e);
      row.removeAttribute("data-drop-position");
      row.classList.remove("drag-over-before", "drag-over-after", "drag-over-child");
      if (!dragState || dragState.kind !== "category" || dragState.categoryId === category.id) return;
      await this.moveParadigmCategoryOrder(dragState.categoryId, category.id, position);
    });
    row.onclick = async () => {
      await this.revealParadigmCategoryTarget(category.id);
    };
    childCategoryIds.forEach((childId) => this.renderParadigmPanelTocCategoryNode(container, panelContext, childId, level + 1, nextTrail));
    paradigmRootIds.forEach((paradigmId) => this.renderParadigmPanelTocParadigmNode(container, panelContext, paradigmId, level + 1, category.id, new Set()));
  }

  renderParadigmItemTree(container, sourceParadigmId, parentParadigmItemId = null, level = 0, trail = new Set()) {
    const childIds = this.getParadigmChildrenIds(sourceParadigmId, parentParadigmItemId);
    childIds.forEach((itemId) => {
      const item = this.getParadigmItemById(itemId);
      if (!item || trail.has(itemId)) return;
      const nextTrail = new Set(trail);
      nextTrail.add(itemId);
      const childCount = this.getParadigmChildrenIds(sourceParadigmId, item.id).length;
      const noteBinding = this.getParadigmItemNoteBinding(item);
      const boundFile = this.resolveBoundFile(noteBinding);
      const bindingLabel = getBindingLabel(noteBinding);
      const commentText = this.getParadigmItemComment(item);
      const commentSummary = getCommentSummary(commentText);
      const imageRef = sanitizeText(item.imageRef, "");
      const imageInfo = this.resolveImageFile(imageRef);
      const shortcutEntries = this.getParadigmItemShortcutEntries(item);
      const line = container.createDiv({
        cls: "workspace-paradigm-item-line is-editable",
        attr: { style: `margin-left:${level * 22}px;` },
      });
      this.applyParadigmPalette(line, sourceParadigmId);
      const content = line.createDiv({ cls: "workspace-line-content" });
      line.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedId = sanitizeText(this.draggedParadigmItemId, "");
        if (!draggedId || draggedId === item.id || sanitizeText(this.draggedParadigmItemParadigmId, "") !== sourceParadigmId) return;
        const rect = line.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const childThreshold = Math.max(42, contentRect.left - rect.left + 16);
        line.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
        if ((e.clientX - rect.left) > childThreshold) line.classList.add("drag-over-child");
        else if ((e.clientY - rect.top) < rect.height / 2) line.classList.add("drag-over-top");
        else line.classList.add("drag-over-bottom");
      });
      line.addEventListener("dragleave", (e) => {
        e.stopPropagation();
        line.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
      });
      line.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedId = sanitizeText(this.draggedParadigmItemId, "");
        line.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
        if (!draggedId || draggedId === item.id || sanitizeText(this.draggedParadigmItemParadigmId, "") !== sourceParadigmId) return;
        const rect = line.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        const childThreshold = Math.max(42, contentRect.left - rect.left + 16);
        const position = (e.clientX - rect.left) > childThreshold
          ? "child"
          : ((e.clientY - rect.top) < rect.height / 2 ? "before" : "after");
        await this.moveParadigmItem(draggedId, item.id, position);
      });
      if (boundFile) {
        const titleBtn = content.createEl("a", {
          cls: "workspace-title-link is-bound workspace-paradigm-item-title",
          text: `📐 ${sanitizeText(item.title || item.id, item.id)}`,
          attr: { href: boundFile.path, title: `打开 ${boundFile.path}` },
        });
        titleBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await this.openBoundNote(noteBinding);
        };
      } else {
        content.createEl("div", {
          cls: "workspace-title-link is-static workspace-paradigm-item-title",
          text: `📐 ${sanitizeText(item.title || item.id, item.id)}`,
          attr: { title: sanitizeText(item.title || item.id, item.id) },
        });
      }
      content.createEl("span", { text: `#${item.id}`, cls: "workspace-origin-badge" });
      content.createEl("span", { text: "定义源", cls: "workspace-origin-badge is-paradigm-name" });
      if (bindingLabel) {
        content.createEl("span", {
          text: `🔗 ${boundFile ? boundFile.basename : bindingLabel}`,
          cls: "workspace-bound-label",
          attr: { title: boundFile?.path || bindingLabel },
        });
      }
      if (commentSummary) {
        content.createEl("span", {
          text: `💬 ${commentSummary}`,
          cls: "workspace-comment-summary",
          attr: { title: commentText },
        });
      }
      if (imageRef) content.createEl("span", { text: "🖼️", cls: "workspace-origin-badge", attr: { title: imageRef } });
      if (shortcutEntries.length > 0) {
        content.createEl("span", {
          text: `↗ ${shortcutEntries.length}`,
          cls: "workspace-origin-badge",
          attr: { title: `已挂 ${shortcutEntries.length} 个快捷方式` },
        });
      }
      content.createEl("div", {
        cls: "workspace-item-meta",
        text: `${item.paradigmId}${item.updatedAt ? ` · 更新 ${String(item.updatedAt).slice(0, 10)}` : ""}${item.createdAt ? ` · 建于 ${String(item.createdAt).slice(0, 10)}` : ""}`,
      });
      const actions = line.createDiv({ cls: "workspace-line-actions" });
      const dragBtn = actions.createEl("span", {
        text: "⋮⋮",
        cls: "workspace-action-btn",
        attr: { title: "拖拽调整层级" },
      });
      dragBtn.draggable = true;
      dragBtn.style.cursor = "grab";
      dragBtn.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        this.draggedParadigmItemId = item.id;
        this.draggedParadigmItemParadigmId = sourceParadigmId;
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", item.id);
        }
        window.setTimeout(() => line.classList.add("is-dragging"), 0);
      });
      dragBtn.addEventListener("dragend", (e) => {
        e.stopPropagation();
        this.draggedParadigmItemId = "";
        this.draggedParadigmItemParadigmId = "";
        line.classList.remove("is-dragging", "drag-over-top", "drag-over-bottom", "drag-over-child");
      });
      const addBtn = actions.createEl("span", {
        text: "＋",
        cls: "workspace-action-btn",
        attr: { title: "添加子条目" },
      });
      addBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.addParadigmItem(sourceParadigmId, item.id);
      };
      const renameBtn = actions.createEl("span", {
        text: "✏️",
        cls: "workspace-action-btn",
        attr: { title: "重命名范式条目" },
      });
      renameBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.renameParadigmItem(item.id);
      };
      const imageBtn = actions.createEl("span", {
        text: imageInfo?.url || imageRef ? "🖼️" : "🖼",
        cls: "workspace-action-btn",
        attr: { title: "范式图片设置" },
      });
      imageBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.editParadigmItemImage(item.id);
      };
      const shortcutBtn = actions.createEl("span", {
        text: "↗",
        cls: "workspace-action-btn",
        attr: { title: shortcutEntries.length > 0 ? `激活快捷方式（${shortcutEntries.length} 个）` : "激活快捷方式（当前为空）" },
      });
      shortcutBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.activateParadigmItemShortcuts(item.id);
      };
      const bindBtn = actions.createEl("span", {
        text: bindingLabel ? "🔗" : "📝",
        cls: "workspace-action-btn",
        attr: { title: "范式笔记绑定" },
      });
      bindBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.editParadigmItemNoteBinding(item.id);
      };
      const openBtn = actions.createEl("span", {
        text: "📂",
        cls: `workspace-action-btn ${bindingLabel ? "" : "is-disabled"}`.trim(),
        attr: { title: "打开范式绑定笔记" },
      });
      openBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!bindingLabel) {
          new Notice("该范式条目尚未绑定笔记");
          return;
        }
        await this.openBoundNote(noteBinding);
      };
      const commentBtn = actions.createEl("span", {
        text: commentText ? "💬" : "🗒️",
        cls: "workspace-action-btn",
        attr: { title: "范式评论" },
      });
      commentBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.editParadigmItemComment(item.id);
      };
      const toRootBtn = actions.createEl("span", {
        text: "⇡",
        cls: `workspace-action-btn ${parentParadigmItemId ? "" : "is-disabled"}`.trim(),
        attr: { title: "移动到根层" },
      });
      toRootBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!parentParadigmItemId) return;
        await this.moveParadigmItemToRoot(item.id, sourceParadigmId);
      };
      const delBtn = actions.createEl("span", {
        text: "🗑️",
        cls: "workspace-action-btn",
        attr: { title: "删除范式条目（含子树）" },
      });
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.deleteParadigmItem(item.id);
      };
      if (childCount > 0) {
        this.renderParadigmItemTree(container, sourceParadigmId, item.id, level + 1, nextTrail);
      }
    });
  }

  renderParadigmEditorPanel(container, paradigmNodeId) {
    const paradigmNode = this.getParadigmById(paradigmNodeId);
    if (!paradigmNode) return;
    const sourceParadigmId = getParadigmSourceIdInData(this.workspaceData, paradigmNodeId) || paradigmNodeId;
    const sourceParadigm = this.getParadigmById(sourceParadigmId) || paradigmNode;
    const childNodeIds = getEffectiveChildParadigmIdsFromData(this.workspaceData, paradigmNode.id);
    const roots = this.getParadigmChildrenIds(sourceParadigmId, null);
    const isCopyNode = isParadigmCopyInData(this.workspaceData, paradigmNode.id);
    const isCollapsed = roots.length > 0 ? this.isParadigmEditorScopeCollapsed(paradigmNode.id) : false;

    const editor = container.createDiv({
      cls: `workspace-paradigm-editor-scope ${isCopyNode ? "is-copy" : ""} ${isCollapsed ? "is-collapsed" : ""}`.trim(),
    });
    this.applyParadigmPalette(editor, sourceParadigmId);
    const head = editor.createDiv({ cls: "workspace-paradigm-editor-head" });
    const headLeft = head.createDiv({ cls: "workspace-paradigm-editor-head-left" });
    const collapseBtn = headLeft.createEl("button", {
      text: roots.length > 0 ? (isCollapsed ? "▶" : "▼") : "•",
      cls: `workspace-paradigm-collapse ${roots.length > 0 ? "clickable" : "dot"} ${isCollapsed ? "is-collapsed" : ""}`.trim(),
      attr: { type: "button" },
    });
    if (roots.length > 0) {
      collapseBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.toggleParadigmEditorScopeCollapsed(paradigmNode.id);
      };
    }
    const meta = headLeft.createDiv({ cls: "workspace-paradigm-panel-meta" });
    meta.createEl("div", {
      text: `🛠 当前范式条目：${this.getParadigmNodeLabel(paradigmNode)}`,
      cls: "workspace-panel-title",
    });
    meta.createEl("div", {
      text: `${paradigmNode.id}${isCopyNode ? ` · 本体位置 ${this.getParadigmMountPathLabel(paradigmNode)}` : " · 定义源"} · 子范式 ${childNodeIds.length} 个`,
      cls: "workspace-panel-row-subtitle",
    });
    if (isCopyNode) {
      meta.createEl("div", {
        text: "这个节点是引用副本：这里展示和编辑的条目会写回定义源。",
        cls: "workspace-panel-row-hint",
      });
      meta.createEl("div", {
        text: "规则：这里只显示这个副本对应范式自身的条目；定义源下面原有的子范式不会因为该副本存在而自动出现在这里。",
        cls: "workspace-panel-row-hint",
      });
    }
    if (childNodeIds.length > 0) {
      meta.createEl("div", {
        text: "这里只显示当前范式自己的条目；子范式条目请在对应子范式上单独点击“管理条目”查看。",
        cls: "workspace-panel-row-hint",
      });
    }
    const actions = head.createDiv({ cls: "workspace-main-actions" });
    const syncBtn = actions.createEl("button", {
      text: "同步到已绑定Tab",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    syncBtn.onclick = async () => {
      await this.updateWorkspaceData((data) => {
        syncParadigmAcrossTabsInData(data);
        if (data.paradigmsById?.[sourceParadigmId]) data.paradigmsById[sourceParadigmId].updatedAt = nowString();
      });
      new Notice("✅ 已同步到所有绑定 Tab");
    };
    const addRootBtn = actions.createEl("button", {
      text: "＋ 根条目",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    addRootBtn.onclick = async () => {
      await this.addParadigmItem(sourceParadigmId, null);
    };
    if (isCollapsed) {
      actions.createEl("span", {
        text: "已折叠",
        cls: "workspace-origin-badge collapsed",
        attr: { title: "该范式条目段当前处于折叠状态" },
      });
    }
    meta.createEl("div", {
      text: "拖分类到上下边缘可排序；拖到右侧收纳区可变成子分类；把范式拖到这里可归入此类",
      cls: "workspace-panel-row-hint",
    });
    if (false) {
    const categoryActions = row.createDiv({ cls: "workspace-paradigm-badge-row" });
    const addChildCategoryBtn = categoryActions.createEl("button", {
      text: "＋ 子分类",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    addChildCategoryBtn.onclick = async () => {
      await this.createParadigmCategory(category.id);
    };
    const addParadigmBtn = categoryActions.createEl("button", {
      text: "＋ 范式",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    addParadigmBtn.onclick = async () => {
      await this.createParadigm(category.id);
    };
    const renameCategoryBtn = categoryActions.createEl("button", {
      text: "重命名",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    renameCategoryBtn.onclick = async () => {
      await this.renameParadigmCategory(category.id);
    };
    const deleteCategoryBtn = categoryActions.createEl("button", {
      text: "删除",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    deleteCategoryBtn.onclick = async () => {
      await this.deleteParadigmCategory(category.id);
    };
    }
    if (!isCollapsed) {
      const rootDropZone = editor.createDiv({
        cls: "workspace-root-drop-zone",
        text: `↥ 拖拽到这里设为 ${sourceParadigm.name || sourceParadigm.id} 的根条目（顶层）`,
      });
      rootDropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!sanitizeText(this.draggedParadigmItemId, "") || sanitizeText(this.draggedParadigmItemParadigmId, "") !== sourceParadigmId) return;
        rootDropZone.classList.add("drag-over");
      });
      rootDropZone.addEventListener("dragleave", () => {
        rootDropZone.classList.remove("drag-over");
      });
      rootDropZone.addEventListener("drop", async (e) => {
        e.preventDefault();
        rootDropZone.classList.remove("drag-over");
        const draggedId = sanitizeText(this.draggedParadigmItemId, "");
        if (!draggedId || sanitizeText(this.draggedParadigmItemParadigmId, "") !== sourceParadigmId) return;
        await this.moveParadigmItemToRoot(draggedId, sourceParadigmId);
      });
      const tree = editor.createDiv({ cls: "workspace-paradigm-editor-children" });
      if (roots.length === 0) {
        tree.createDiv({ text: "_暂无范式条目_", cls: "workspace-empty" });
      } else {
        this.renderParadigmItemTree(tree, sourceParadigmId, null, 0, new Set());
      }
    }
  }

  renderParadigmToc(container, panelContext) {
    const tagVisibilityApi = panelContext.mode === "panel"
      ? this.createParadigmPanelVisibilityApi(this.getParadigmTagFilters())
      : null;
    const toc = container.createDiv({
      cls: `workspace-paradigm-panel-toc ${this.visibleUiState?.paradigmTocCollapsed ? "is-collapsed" : ""}`.trim(),
    });
    const tocHead = toc.createDiv({ cls: "workspace-paradigm-panel-toc-head" });
    const headMain = tocHead.createDiv({ cls: "workspace-paradigm-toc-head-main" });
    headMain.createEl("div", {
      text: panelContext.mode === "tab" ? "当前视图范式 TOC" : "范式分类 TOC",
      cls: "workspace-paradigm-toc-title",
    });
    const switchRow = headMain.createDiv({ cls: "workspace-paradigm-toc-mode-switch" });
    const panelBtn = switchRow.createEl("button", {
      text: "范式面板",
      cls: `workspace-paradigm-toc-mode-btn ${panelContext.mode === "panel" ? "is-active" : ""}`.trim(),
      attr: { type: "button" },
    });
    panelBtn.onclick = async () => this.setParadigmTocMode("panel");
    const tabBtn = switchRow.createEl("button", {
      text: "Tab里面",
      cls: `workspace-paradigm-toc-mode-btn ${panelContext.mode === "tab" ? "is-active" : ""}`.trim(),
      attr: { type: "button" },
    });
    tabBtn.onclick = async () => this.setParadigmTocMode("tab");
    const tocToggleBtn = tocHead.createEl("button", {
      text: this.visibleUiState?.paradigmTocCollapsed ? "◀" : "▶",
      cls: "workspace-paradigm-toc-toggle",
      attr: { type: "button", title: this.visibleUiState?.paradigmTocCollapsed ? "展开 TOC" : "折叠 TOC" },
    });
    tocToggleBtn.onclick = async () => this.toggleParadigmTocCollapsed();
    if (this.visibleUiState?.paradigmTocCollapsed) return toc;
    const currentBox = toc.createDiv({ cls: "workspace-paradigm-toc-current" });
    currentBox.createEl("div", {
      text: panelContext.mode === "tab" ? (this.getTabById(panelContext.tabId)?.name || "未选中 Tab") : "范式管理视图",
      attr: { style: "font-weight:700;" },
    });
    currentBox.createEl("div", {
      text: panelContext.mode === "tab"
        ? `${this.getVisibleTabIds(panelContext.tabId).length} 个 Tab 视图 · ${this.getVisibleTabIds(panelContext.tabId).reduce((sum, candidateTabId) => sum + this.getParadigmBindingSummaryForTab(candidateTabId).includedParadigmIds.length, 0)} 个范式 · 点击可滚动定位`
        : `${Object.keys(this.workspaceData?.paradigmCategoriesById || {}).length} 个分类节点 · ${Object.keys(this.workspaceData?.paradigmsById || {}).length} 个范式节点 · 点击可滚动定位`,
      cls: "workspace-tab-section-subtitle",
    });
    const controlRow = toc.createDiv({ cls: "workspace-paradigm-toc-controls" });
    const panelToggleBtn = controlRow.createEl("button", {
      text: this.visibleUiState?.showParadigmPanel ? "Panel-" : "Panel+",
      cls: "workspace-paradigm-toc-toggle",
      attr: {
        type: "button",
        title: this.visibleUiState?.showParadigmPanel ? "Hide paradigm panel" : "Show paradigm panel",
      },
    });
    panelToggleBtn.onclick = async () => this.toggleParadigmPanel();
    const tocBody = toc.createDiv({ cls: "workspace-paradigm-toc-list" });
    if (panelContext.mode === "panel") {
      const panelTocContext = { ...panelContext, tagVisibilityApi };
      const rootCategoryIds = this.getChildParadigmCategoryIds(null)
        .filter((categoryId) => !tagVisibilityApi || tagVisibilityApi.categoryVisible(categoryId));
      rootCategoryIds.forEach((categoryId) => this.renderParadigmPanelTocCategoryNode(tocBody, panelTocContext, categoryId, 0, new Set()));
      const uncategorizedRootIds = this.getCategoryParadigmRootIds(null)
        .filter((paradigmId) => !tagVisibilityApi || tagVisibilityApi.visible(paradigmId));
      if (uncategorizedRootIds.length > 0) {
        const uncategorizedBtn = tocBody.createEl("button", {
          cls: "workspace-paradigm-toc-btn is-panel-mode is-category",
          attr: { type: "button" },
        });
        uncategorizedBtn.createEl("span", { text: "🗂 未分类", cls: "workspace-paradigm-toc-btn-title" });
        uncategorizedBtn.createEl("span", {
          text: `直属范式 ${uncategorizedRootIds.length}`,
          cls: "workspace-paradigm-toc-btn-meta",
        });
        uncategorizedBtn.onclick = async () => {
          await this.revealParadigmCategoryTarget(null);
        };
        uncategorizedRootIds.forEach((paradigmId) => this.renderParadigmPanelTocParadigmNode(tocBody, panelTocContext, paradigmId, 1, null, new Set()));
      }
      if (tocBody.childElementCount === 0) {
        tocBody.createDiv({
          text: tagVisibilityApi?.activeFilterIds?.length ? "当前筛选下没有可见分类或范式。" : "当前没有可见分类",
          cls: "workspace-empty",
        });
      }
      return toc;
    }
    this.getVisibleTabIds(panelContext.tabId).forEach((groupTabId) => {
      this.renderTabParadigmTocGroup(tocBody, panelContext.tabId, groupTabId);
    });
    if (tocBody.childElementCount === 0) {
      tocBody.createDiv({ text: "当前视图没有可见 Tab", cls: "workspace-empty" });
    }
    return toc;
  }

  renderParadigmPanelParadigmRow(container, panelContext, paradigmId, level = 0, currentCategoryId = null, trail = new Set()) {
    const paradigm = this.getParadigmById(paradigmId);
    if (!paradigm || trail.has(paradigmId)) return;
    const nextTrail = new Set(trail);
    nextTrail.add(paradigmId);
    const tagVisibilityApi = panelContext?.tagVisibilityApi || null;
    const childIds = this.getCategoryParadigmChildIds(paradigm.id, currentCategoryId)
      .filter((childId) => !tagVisibilityApi || tagVisibilityApi.visible(childId));
    const directTagMatch = tagVisibilityApi ? tagVisibilityApi.directMatch(paradigm.id) : true;
    const descendantTagMatch = tagVisibilityApi ? tagVisibilityApi.descendantMatch(paradigm.id) : false;
    const ancestorTagMatch = tagVisibilityApi ? tagVisibilityApi.ancestorMatch(paradigm.id) : false;
    if (tagVisibilityApi?.activeFilterIds?.length > 0 && !directTagMatch && !ancestorTagMatch && childIds.length === 0) return;
    const hasChildren = childIds.length > 0;
    const isCollapsed = hasChildren ? this.isParadigmTreeCollapsed(paradigm.id) : false;
    const isDirect = panelContext.directRootSet.has(paradigm.id);
    const isIncluded = panelContext.includedParadigmIdSet.has(paradigm.id);
    const bindingRootId = panelContext.rootMap.get(paradigm.id) || null;
    const isInherited = isIncluded && !!bindingRootId && bindingRootId !== paradigm.id;
    const isCopy = isParadigmCopyInData(this.workspaceData, paradigm.id);
    const tagIds = this.getParadigmTagIds(paradigm);
    const sourceParadigm = this.getParadigmSourceParadigm(paradigm) || paradigm;
    const copyReferenceEntries = !isCopy ? this.getParadigmCopyReferenceEntries(paradigm.id) : [];
    const copyReferenceExpanded = !isCopy && !!this.expandedParadigmReferenceSourceIds?.[paradigm.id];
    const incomingCopyRefSummary = !isCopy ? this.summarizeParadigmCopyReferences(paradigm.id) : "";

    const branch = container.createDiv({
      cls: `workspace-paradigm-panel-branch ${hasChildren ? "has-children" : ""} ${isIncluded ? "is-included" : ""} ${isIncluded ? "is-mounted-current-tab" : ""}`.trim(),
      attr: { style: `margin-left:${level * 18}px;` },
    });
    const paletteInfo = this.applyParadigmPalette(branch, paradigm.id);
    const row = branch.createDiv({
      cls: `workspace-panel-row workspace-paradigm-panel-row ${isIncluded ? "is-mounted-current-tab" : ""} ${isDirect ? "is-directly-bound" : ""} ${isInherited ? "is-inherited-mounted" : ""}`.trim(),
      attr: { "data-workspace-paradigm-panel-id": paradigm.id },
    });
    if (isIncluded) {
      const palette = buildParadigmPalette(paletteInfo?.paletteSeed || paradigm.id);
      const mountedAccent = palette?.accent || (isDirect ? "#16a34a" : "#3498db");
      const mountedBranchBg = palette?.bg || (isDirect ? "rgba(46, 204, 113, 0.10)" : "rgba(52, 152, 219, 0.10)");
      branch.style.setProperty("--workspace-mounted-accent", mountedAccent);
      branch.style.setProperty("--workspace-mounted-branch-bg", mountedBranchBg);
      branch.style.setProperty("--workspace-mounted-branch-ring", `${mountedAccent}18`);
      row.style.setProperty("--workspace-mounted-accent", mountedAccent);
      row.style.setProperty("--workspace-mounted-row-bg", isDirect ? `${mountedAccent}26` : `${mountedAccent}16`);
      row.style.setProperty("--workspace-mounted-row-glow", isDirect ? `${mountedAccent}1f` : `${mountedAccent}14`);
    }
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      this.draggedParadigmId = paradigm.id;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", paradigm.id);
      }
      window.setTimeout(() => row.classList.add("is-dragging"), 0);
    });
    row.addEventListener("dragend", (e) => {
      e.stopPropagation();
      this.draggedParadigmId = "";
      row.classList.remove("is-dragging", "drag-over-top", "drag-over-bottom", "drag-over-child");
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const draggedId = sanitizeText(this.draggedParadigmId, "");
      if (!draggedId || draggedId === paradigm.id) return;
      const position = getPanelRowDropPosition(row, e);
      row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
      if (position === "child") row.classList.add("drag-over-child");
      else if (position === "before") row.classList.add("drag-over-top");
      else row.classList.add("drag-over-bottom");
    });
    row.addEventListener("dragleave", (e) => {
      e.stopPropagation();
      row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
    });
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const draggedId = sanitizeText(this.draggedParadigmId, "");
      row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
      if (!draggedId || draggedId === paradigm.id) return;
      const position = getPanelRowDropPosition(row, e);
      await this.moveParadigmOrder(draggedId, paradigm.id, position);
    });
    const rowHead = row.createDiv({ cls: "workspace-panel-row-left" });
    const collapseBtn = rowHead.createEl("button", {
      text: hasChildren ? (isCollapsed ? "▶" : "▼") : "•",
      cls: `workspace-paradigm-collapse ${hasChildren ? "clickable" : "dot"} ${isCollapsed ? "is-collapsed" : ""}`.trim(),
      attr: { type: "button" },
    });
    if (hasChildren) {
      collapseBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.toggleParadigmTreeCollapsed(paradigm.id);
      };
    }
    const meta = rowHead.createDiv({ cls: "workspace-paradigm-panel-meta" });
    meta.createEl("div", {
      text: paradigm.name || paradigm.id,
      cls: "workspace-panel-row-title",
    });
    meta.createEl("div", {
      text: [
        paradigm.id,
        paradigm.categoryId ? `分类 ${this.getParadigmCategoryPathLabel(paradigm.categoryId) || paradigm.categoryId}` : "未分类",
        tagIds.length > 0 ? `标签 ${tagIds.length}` : "无标签",
      ].join(" · "),
      cls: "workspace-panel-row-subtitle",
    });
    if (tagIds.length > 0) {
      this.renderParadigmTagChipGroup(meta, tagIds, {
        activeSet: tagVisibilityApi?.activeFilterSet || new Set(),
      });
    }
    meta.createEl("div", {
      text: isCopy
        ? "这是引用副本：节点位置可调整，但条目定义读取定义源。"
        : "向右拖入可设为子范式；拖到分类行可归类。",
      cls: "workspace-panel-row-hint",
    });
    if (isCopy) {
      meta.createEl("div", {
        text: `本体位置 ${this.getParadigmMountPathLabel(paradigm)} · 定义源 ${this.getParadigmNodeLabel(sourceParadigm)} (${sourceParadigm.id})`,
        cls: "workspace-panel-row-hint",
      });
    } else if (incomingCopyRefSummary) {
      meta.createEl("div", {
        text: copyReferenceExpanded ? `🔁 ${incomingCopyRefSummary}` : `🔁 ${incomingCopyRefSummary} · 可点“引用 ${copyReferenceEntries.length}”查看各个副本`,
        cls: "workspace-panel-row-hint",
      });
    }
    if (hasChildren) {
      meta.createEl("div", {
        text: "子范式条目请在对应子范式上单独展开“管理条目”查看。",
        cls: "workspace-panel-row-hint",
      });
    }
    if (tagVisibilityApi?.activeFilterIds?.length > 0 && !directTagMatch && descendantTagMatch) {
      meta.createEl("div", {
        text: "当前范式本身未命中筛选，因为其子范式命中标签筛选而保留显示",
        cls: "workspace-panel-row-hint",
      });
    }
    if (tagVisibilityApi?.activeFilterIds?.length > 0 && !directTagMatch && !descendantTagMatch && ancestorTagMatch) {
      meta.createEl("div", {
        text: "当前范式本身未命中筛选，因为其上级范式命中标签筛选而保留显示",
        cls: "workspace-panel-row-hint",
      });
    }
    const actions = row.createDiv({ cls: "workspace-paradigm-badge-row" });
    if (isIncluded) {
      actions.createEl("span", {
        text: isDirect ? "当前Tab直接引用" : `继承自 ${this.getParadigmById(bindingRootId)?.name || bindingRootId}`,
        cls: `workspace-origin-badge ${isDirect ? "is-direct" : "is-inherited"}`.trim(),
      });
    }
    if (isCopy) {
      actions.createEl("span", { text: "引用副本", cls: "workspace-origin-badge is-copy-scope" });
    }
    if (tagIds.length > 0) {
      actions.createEl("span", { text: `标签 ${tagIds.length}`, cls: "workspace-origin-badge" });
    }
    const tagBtn = actions.createEl("button", {
      text: tagIds.length > 0 ? `标签 ${tagIds.length}` : "标签",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    tagBtn.onclick = async () => {
      await this.promptParadigmTagAssignment(paradigm.id);
    };
    const categoryBtn = actions.createEl("button", {
      text: "分类",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    categoryBtn.onclick = async () => {
      await this.promptParadigmCategoryAssignment(paradigm.id);
    };
    const bindBtn = actions.createEl("button", {
      text: isDirect ? "解绑" : "绑定到当前Tab",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    bindBtn.onclick = async () => {
      if (isDirect) await this.unbindParadigmFromCurrentTab(paradigm.id);
      else await this.bindParadigmToCurrentTab(paradigm.id);
    };
    const revealBtn = actions.createEl("button", {
      text: isIncluded ? "定位挂载" : "未挂入",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    revealBtn.disabled = !isIncluded;
    if (isIncluded) {
      revealBtn.onclick = async () => {
        await this.revealParadigmMountTarget(panelContext.tabId, paradigm.id);
      };
    }
    if (isCopy && sourceParadigm?.id) {
      const sourceBtn = actions.createEl("button", {
        text: "定义源",
        cls: "workspace-sub-btn",
        attr: { type: "button", title: `跳到定义源：${this.getParadigmNodeLabel(sourceParadigm)} (${sourceParadigm.id})` },
      });
      sourceBtn.onclick = async () => {
        await this.revealParadigmPanelTarget(sourceParadigm.id);
      };
    }
    if (!isCopy && copyReferenceEntries.length > 0) {
      const refsBtn = actions.createEl("button", {
        text: copyReferenceExpanded ? `收起引用 ${copyReferenceEntries.length}` : `引用 ${copyReferenceEntries.length}`,
        cls: "workspace-sub-btn",
        attr: { type: "button" },
      });
      refsBtn.onclick = async () => {
        this.expandedParadigmReferenceSourceIds[paradigm.id] = !copyReferenceExpanded;
        await this.render();
      };
    }
    const addChildBtn = actions.createEl("button", {
      text: "＋ 子范式",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    addChildBtn.onclick = async () => {
      await this.createParadigmChild(paradigm.id);
    };
    const copyBtn = actions.createEl("button", {
      text: "＋ 引用",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    copyBtn.onclick = async () => {
      await this.createParadigmCopy(paradigm.id, "");
    };
    const renameBtn = actions.createEl("button", {
      text: "重命名",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    renameBtn.onclick = async () => {
      await this.renameParadigm(isCopy && sourceParadigm?.id ? sourceParadigm.id : paradigm.id);
    };
    const editBtn = actions.createEl("button", {
      text: this.activeParadigmEditorId === paradigm.id ? "收起条目" : "管理条目",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    editBtn.onclick = async () => {
      this.activeParadigmEditorId = this.activeParadigmEditorId === paradigm.id ? "" : paradigm.id;
      await this.render();
    };
    const deleteBtn = actions.createEl("button", {
      text: isCopy ? "删副本" : "删除",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    deleteBtn.onclick = async () => {
      await this.deleteParadigm(paradigm.id);
    };
    if (!isCopy && copyReferenceExpanded && copyReferenceEntries.length > 0) {
      const refList = branch.createDiv({ cls: "workspace-paradigm-reference-list" });
      copyReferenceEntries.forEach((entry, index) => {
        const copyParadigm = entry.copyParadigm;
        if (!copyParadigm) return;
        const refItem = refList.createDiv({ cls: "workspace-paradigm-reference-item" });
        const refMeta = refItem.createDiv({ cls: "workspace-paradigm-reference-meta" });
        refMeta.createEl("div", {
          text: `#${index + 1} · ${this.getParadigmMountPathLabel(copyParadigm)}`,
          cls: "workspace-paradigm-reference-title",
        });
        refMeta.createEl("div", {
          text: `${copyParadigm.id} · 分类 ${copyParadigm.categoryId ? (this.getParadigmCategoryPathLabel(copyParadigm.categoryId) || copyParadigm.categoryId) : "未分类"} · 挂在 ${entry.hostLabel}`,
          cls: "workspace-paradigm-reference-subtitle",
        });
        const refActions = refItem.createDiv({ cls: "workspace-main-actions" });
        const jumpBtn = refActions.createEl("button", {
          text: "定位副本",
          cls: "workspace-sub-btn",
          attr: { type: "button" },
        });
        jumpBtn.onclick = async () => {
          await this.revealParadigmPanelTarget(copyParadigm.id);
        };
      });
    }
    if (this.activeParadigmEditorId === paradigm.id) {
      this.renderParadigmEditorPanel(branch, paradigm.id);
    }
    if (hasChildren && !isCollapsed) {
      const childWrap = branch.createDiv({ cls: "workspace-paradigm-panel-children" });
      childIds.forEach((childId) => this.renderParadigmPanelParadigmRow(childWrap, panelContext, childId, level + 1, currentCategoryId, nextTrail));
    }
  }

  renderParadigmPanelCategoryRow(container, panelContext, categoryId, level = 0, trail = new Set()) {
    const category = this.getParadigmCategoryById(categoryId);
    if (!category || trail.has(categoryId)) return;
    const tagVisibilityApi = panelContext?.tagVisibilityApi || null;
    if (tagVisibilityApi?.activeFilterIds?.length > 0 && !tagVisibilityApi.categoryVisible(category.id)) return;
    const nextTrail = new Set(trail);
    nextTrail.add(categoryId);
    const childCategoryIds = this.getChildParadigmCategoryIds(category.id)
      .filter((childId) => !tagVisibilityApi || tagVisibilityApi.categoryVisible(childId));
    const paradigmRootIds = this.getCategoryParadigmRootIds(category.id)
      .filter((paradigmId) => !tagVisibilityApi || tagVisibilityApi.visible(paradigmId));
    const hasChildren = childCategoryIds.length > 0 || paradigmRootIds.length > 0;
    const isCollapsed = hasChildren ? this.isParadigmCategoryTreeCollapsed(category.id) : false;
    const branch = container.createDiv({
      cls: `workspace-paradigm-category-branch ${hasChildren ? "has-children" : ""}`.trim(),
      attr: { style: `margin-left:${level * 18}px;` },
    });
    this.applyParadigmPalette(branch, category.id);
    const row = branch.createDiv({
      cls: "workspace-panel-row workspace-paradigm-category-row",
      attr: { "data-workspace-paradigm-category-id": category.id },
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
      const draggedParadigmId = sanitizeText(this.draggedParadigmId, "");
      if (draggedParadigmId && this.getParadigmById(draggedParadigmId)) {
        row.classList.add("drag-over-child");
      }
    });
    row.addEventListener("dragleave", (e) => {
      e.stopPropagation();
      row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
    });
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const draggedParadigmId = sanitizeText(this.draggedParadigmId, "");
      row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
      if (!draggedParadigmId || !this.getParadigmById(draggedParadigmId)) return;
      await this.assignParadigmCategory(draggedParadigmId, category.id, { detachFromParent: true });
    });
    const uncategorizedHead = row.createDiv({ cls: "workspace-panel-row-left" });
    const collapseBtn = uncategorizedHead.createEl("button", {
      text: hasChildren ? (isCollapsed ? "▶" : "▼") : "•",
      cls: `workspace-paradigm-collapse ${hasChildren ? "clickable" : "dot"} ${isCollapsed ? "is-collapsed" : ""}`.trim(),
      attr: { type: "button" },
    });
    if (hasChildren) {
      collapseBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await this.toggleParadigmCategoryTreeCollapsed(category.id);
      };
    }
    const meta = uncategorizedHead.createDiv({ cls: "workspace-paradigm-panel-meta" });
    meta.createEl("div", {
      text: `📚 ${category.name || category.id}`,
      cls: "workspace-panel-row-title",
    });
    meta.createEl("div", {
      text: `${category.id} · 子分类 ${childCategoryIds.length} · 直属范式 ${paradigmRootIds.length} · 全部范式 ${this.getParadigmCountForCategoryScope(category.id)}`,
      cls: "workspace-panel-row-subtitle",
    });
    meta.createEl("div", {
      text: "拖分类到上下边缘可排序；拖到右侧收纳区可变成子分类；把范式拖到这里可归入此类",
      cls: "workspace-panel-row-hint",
    });
    const categoryActions = row.createDiv({ cls: "workspace-paradigm-badge-row" });
    const addChildCategoryBtn = categoryActions.createEl("button", {
      text: "＋ 子分类",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    addChildCategoryBtn.onclick = async () => {
      await this.createParadigmCategory(category.id);
    };
    const addParadigmBtn = categoryActions.createEl("button", {
      text: "＋ 范式",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    addParadigmBtn.onclick = async () => {
      await this.createParadigm(category.id);
    };
    const renameCategoryBtn = categoryActions.createEl("button", {
      text: "重命名",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    renameCategoryBtn.onclick = async () => {
      await this.renameParadigmCategory(category.id);
    };
    const deleteCategoryBtn = categoryActions.createEl("button", {
      text: "删除",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    deleteCategoryBtn.onclick = async () => {
      await this.deleteParadigmCategory(category.id);
    };
    if (!isCollapsed) {
      const childWrap = branch.createDiv({ cls: "workspace-paradigm-panel-children" });
      childCategoryIds.forEach((childId) => this.renderParadigmPanelCategoryRow(childWrap, panelContext, childId, level + 1, nextTrail));
      paradigmRootIds.forEach((paradigmId) => this.renderParadigmPanelParadigmRow(childWrap, panelContext, paradigmId, 0, category.id, new Set()));
    }
  }

  renderParadigmPanel(container, tabId) {
    const activeTab = this.getTabById(tabId);
    if (!activeTab) return;
    const activeParadigmTagFilters = this.getParadigmTagFilters();
    const tagVisibilityApi = this.createParadigmPanelVisibilityApi(activeParadigmTagFilters);
    const togglePanelParadigmTagFilter = async (tagId) => {
      const normalizedId = sanitizeText(tagId, "");
      if (!normalizedId || !this.getParadigmTagById(normalizedId)) return;
      const next = tagVisibilityApi.activeFilterSet.has(normalizedId)
        ? activeParadigmTagFilters.filter((id) => id !== normalizedId)
        : activeParadigmTagFilters.concat(normalizedId);
      this.setParadigmTagFilters(next);
      await this.render();
    };
    const panelContext = {
      ...this.getParadigmBindingSummaryForTab(tabId),
      tabId,
      mode: this.visibleUiState?.paradigmTocMode === "tab" ? "tab" : "panel",
      tagVisibilityApi,
    };
    const panel = container.createDiv({ cls: "workspace-paradigm-panel-shell" });
    const head = panel.createDiv({ cls: "workspace-paradigm-panel-head" });
    const headLeft = head.createDiv();
    headLeft.createEl("div", { text: "📐 范式面板", cls: "workspace-panel-title" });
    headLeft.createEl("div", {
      text: `当前 Tab：${activeTab.name || activeTab.id} · 根绑定 ${panelContext.directRootIds.length} · 实际纳入 ${panelContext.includedParadigmIds.length}`,
      cls: "workspace-tab-section-subtitle",
    });
    const actions = head.createDiv({ cls: "workspace-main-actions" });
    const tocToggleBtn = actions.createEl("button", {
      text: this.visibleUiState?.paradigmTocCollapsed ? "展开 TOC" : "折叠 TOC",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    tocToggleBtn.onclick = async () => this.toggleParadigmTocCollapsed();
    const paradigmModeBtn = actions.createEl("button", {
      text: "范式面板",
      cls: `workspace-sub-btn ${panelContext.mode === "panel" ? "is-active" : ""}`.trim(),
      attr: { type: "button" },
    });
    paradigmModeBtn.onclick = async () => this.setParadigmTocMode("panel");
    const tabModeBtn = actions.createEl("button", {
      text: "Tab里面",
      cls: `workspace-sub-btn ${panelContext.mode === "tab" ? "is-active" : ""}`.trim(),
      attr: { type: "button" },
    });
    tabModeBtn.onclick = async () => this.setParadigmTocMode("tab");
    const createCategoryBtn = actions.createEl("button", {
      text: "新建分类",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    createCategoryBtn.onclick = async () => {
      await this.createParadigmCategory();
    };
    const createParadigmBtn = actions.createEl("button", {
      text: "新建范式",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    createParadigmBtn.onclick = async () => {
      await this.createParadigm(null);
    };
    const unbindAllBtn = actions.createEl("button", {
      text: "解绑当前Tab全部范式",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    unbindAllBtn.disabled = panelContext.directRootIds.length === 0;
    unbindAllBtn.onclick = async () => {
      await this.unbindParadigmFromCurrentTab();
    };
    const closeBtn = actions.createEl("button", {
      text: "收起面板",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    closeBtn.onclick = async () => this.toggleParadigmPanel();

    const summaryRow = panel.createDiv({ cls: "workspace-mount-status-row" });
    summaryRow.createDiv({ text: `根绑定 ${panelContext.directRootIds.length}`, cls: "workspace-mount-chip" });
    summaryRow.createDiv({ text: `纳入范式 ${panelContext.includedParadigmIds.length}`, cls: "workspace-mount-chip" });
    summaryRow.createDiv({ text: `分类 ${Object.keys(this.workspaceData?.paradigmCategoriesById || {}).length}`, cls: "workspace-mount-chip" });
    summaryRow.createDiv({ text: `标签 ${Object.keys(this.workspaceData?.paradigmTagsById || {}).length}`, cls: "workspace-mount-chip" });

    const tagToolbar = panel.createDiv({ cls: "workspace-paradigm-tag-toolbar" });
    const tagToolbarMain = tagToolbar.createDiv({ cls: "workspace-paradigm-tag-toolbar-main" });
    tagToolbarMain.createEl("div", { text: "🏷️ 范式标签筛选", cls: "workspace-paradigm-tag-toolbar-title" });
    tagToolbarMain.createEl("div", {
      text: activeParadigmTagFilters.length > 0
        ? `当前在范式管理面板内按 ${activeParadigmTagFilters.length} 个标签筛选；只影响范式面板与面板 TOC，不影响 Tab 条目显示。`
        : "这里只筛选范式管理面板里的范式；不会影响 Tab 里的条目显示。",
      cls: "workspace-paradigm-tag-toolbar-subtitle",
    });
    if (activeParadigmTagFilters.length > 0) {
      this.renderParadigmTagChipGroup(tagToolbarMain, activeParadigmTagFilters, {
        activeSet: tagVisibilityApi.activeFilterSet,
        onClick: (tagId) => { void togglePanelParadigmTagFilter(tagId); },
        showPath: true,
      });
    } else {
      tagToolbarMain.createDiv({ text: "未开启标签筛选", cls: "workspace-paradigm-tag-filter-empty" });
    }
    const tagToolbarActions = tagToolbar.createDiv({ cls: "workspace-paradigm-tag-toolbar-actions" });
    const createTagBtn = tagToolbarActions.createEl("button", {
      text: "＋ 标签",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    createTagBtn.onclick = async () => {
      await this.editParadigmTagDefinition();
    };
    const clearFilterBtn = tagToolbarActions.createEl("button", {
      text: "清空筛选",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    clearFilterBtn.disabled = activeParadigmTagFilters.length === 0;
    clearFilterBtn.onclick = async () => {
      this.setParadigmTagFilters([]);
      await this.render();
    };
    const toggleTagManagerBtn = tagToolbarActions.createEl("button", {
      text: this.visibleUiState?.showTagManager ? "收起标签管理" : "展开标签管理",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    toggleTagManagerBtn.onclick = async () => {
      this.setVisibleUiState({ showTagManager: !this.visibleUiState?.showTagManager });
      await this.render();
    };
    const tagFilterTree = panel.createDiv({ cls: "workspace-paradigm-tag-filter-tree" });
    this.renderParadigmTagFilterTree(tagFilterTree, activeParadigmTagFilters, (tagId) => { void togglePanelParadigmTagFilter(tagId); });
    if (this.visibleUiState?.showTagManager) {
      this.renderParadigmTagManager(panel);
    }

    const body = panel.createDiv({ cls: "workspace-paradigm-panel-body" });
    const browser = body.createDiv({ cls: "workspace-paradigm-panel-browser" });
    const rootCategoryIds = this.getChildParadigmCategoryIds(null)
      .filter((categoryId) => tagVisibilityApi.categoryVisible(categoryId));
    const uncategorizedRootIds = this.getCategoryParadigmRootIds(null)
      .filter((paradigmId) => tagVisibilityApi.visible(paradigmId));
    if (rootCategoryIds.length === 0 && uncategorizedRootIds.length === 0) {
      browser.createDiv({
        text: activeParadigmTagFilters.length > 0
          ? "当前标签筛选下没有可见范式。"
          : "当前还没有范式分类与范式节点。",
        cls: "workspace-empty",
      });
      return;
    }
    rootCategoryIds.forEach((categoryId) => this.renderParadigmPanelCategoryRow(browser, panelContext, categoryId, 0, new Set()));
    const uncategorizedCollapsed = uncategorizedRootIds.length > 0
      ? this.isParadigmCategoryTreeCollapsed(UNCATEGORIZED_PARADIGM_GROUP_ID)
      : false;
    if (uncategorizedRootIds.length > 0 || activeParadigmTagFilters.length === 0) {
      const uncategorized = browser.createDiv({
        cls: `workspace-paradigm-category-branch is-uncategorized ${uncategorizedRootIds.length > 0 ? "has-children" : ""}`.trim(),
        attr: { "data-workspace-paradigm-category-id": UNCATEGORIZED_PARADIGM_GROUP_ID },
      });
      const row = uncategorized.createDiv({
        cls: "workspace-panel-row workspace-paradigm-category-row",
        attr: { "data-workspace-paradigm-category-id": UNCATEGORIZED_PARADIGM_GROUP_ID },
      });
      row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
        const draggedParadigmId = sanitizeText(this.draggedParadigmId, "");
        if (draggedParadigmId && this.getParadigmById(draggedParadigmId)) {
          row.classList.add("drag-over-child");
        }
      });
      row.addEventListener("dragleave", (e) => {
        e.stopPropagation();
        row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
      });
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const draggedParadigmId = sanitizeText(this.draggedParadigmId, "");
        row.classList.remove("drag-over-top", "drag-over-bottom", "drag-over-child");
        if (!draggedParadigmId || !this.getParadigmById(draggedParadigmId)) return;
        await this.assignParadigmCategory(draggedParadigmId, null, { detachFromParent: true });
      });
      const uncategorizedHead = row.createDiv({ cls: "workspace-panel-row-left" });
      const collapseBtn = uncategorizedHead.createEl("button", {
        text: uncategorizedRootIds.length > 0 ? (uncategorizedCollapsed ? "▶" : "▼") : "•",
        cls: `workspace-paradigm-collapse ${uncategorizedRootIds.length > 0 ? "clickable" : "dot"} ${uncategorizedCollapsed ? "is-collapsed" : ""}`.trim(),
        attr: { type: "button" },
      });
      if (uncategorizedRootIds.length > 0) {
        collapseBtn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          await this.toggleParadigmCategoryTreeCollapsed(UNCATEGORIZED_PARADIGM_GROUP_ID);
        };
      }
      const meta = uncategorizedHead.createDiv({ cls: "workspace-paradigm-panel-meta" });
      meta.createEl("div", { text: "🗂 未分类", cls: "workspace-panel-row-title" });
      meta.createEl("div", {
        text: `直属范式 ${uncategorizedRootIds.length} · 全部范式 ${this.getParadigmCountForCategoryScope(null)}`,
        cls: "workspace-panel-row-subtitle",
      });
      meta.createEl("div", {
        text: "拖入这里可把范式节点和整棵子树归回未分类。",
        cls: "workspace-panel-row-hint",
      });
      const uncategorizedActions = row.createDiv({ cls: "workspace-paradigm-badge-row" });
      const addParadigmBtn = uncategorizedActions.createEl("button", {
        text: "＋ 范式",
        cls: "workspace-sub-btn",
        attr: { type: "button" },
      });
      addParadigmBtn.onclick = async () => {
        await this.createParadigm(null);
      };
      if (!uncategorizedCollapsed && uncategorizedRootIds.length > 0) {
        const childWrap = uncategorized.createDiv({ cls: "workspace-paradigm-panel-children" });
        uncategorizedRootIds.forEach((paradigmId) => this.renderParadigmPanelParadigmRow(childWrap, panelContext, paradigmId, 0, null, new Set()));
      }
    }
  }

  renderSnapshotPreview(container, snapshot, parentId = null, level = 0, trail = new Set()) {
    if (!snapshot || !isObjectLike(snapshot.itemsById)) return;
    const scopedKey = tabParentKey(sanitizeText(snapshot.tabId, ""), parentId);
    const childIds = ensureUniqueIds(snapshot.childrenByParentByTab?.[scopedKey] || [])
      .filter((itemId) => !!snapshot.itemsById?.[itemId]);
    childIds.forEach((itemId) => {
      if (trail.has(itemId)) return;
      const item = snapshot.itemsById?.[itemId];
      if (!item) return;
      const nextTrail = new Set(trail);
      nextTrail.add(itemId);
      const collapsed = Object.prototype.hasOwnProperty.call(snapshot.collapsedById || {}, itemId)
        ? !!snapshot.collapsedById[itemId]
        : !!item.isCollapsed;
      const row = container.createDiv({
        cls: "workspace-panel-row",
        attr: { style: `margin-left:${level * 18}px;` },
      });
      const left = row.createDiv();
      left.createEl("div", {
        text: sanitizeText(item.title || item.name, item.id),
        cls: "workspace-panel-row-title",
      });
      left.createEl("div", {
        text: [
          item.id,
          collapsed ? "已折叠" : "",
          item.noteBinding ? "已绑定笔记" : "",
        ].filter(Boolean).join(" · "),
        cls: "workspace-panel-row-subtitle",
      });
      this.renderSnapshotPreview(container, snapshot, itemId, level + 1, nextTrail);
    });
  }

  renderSnapshotPanel(container, activeTabId) {
    const activeTab = this.getTabById(activeTabId);
    if (!activeTab) return;
    const panel = container.createDiv({ cls: "workspace-paradigm-panel-shell" });
    const head = panel.createDiv({ cls: "workspace-paradigm-panel-head" });
    const headLeft = head.createDiv();
    headLeft.createEl("div", { text: "💾 快照管理", cls: "workspace-panel-title" });
    headLeft.createEl("div", {
      text: `当前 Tab：${activeTab.name || activeTab.id} · 快照 ${this.getSnapshotIdsForTab(activeTabId).length} 个`,
      cls: "workspace-tab-section-subtitle",
    });
    const actions = head.createDiv({ cls: "workspace-main-actions" });
    const saveBtn = actions.createEl("button", {
      text: "命名保存快照",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    saveBtn.onclick = async () => {
      await this.createSnapshot();
    };
    const closeBtn = actions.createEl("button", {
      text: "收起快照面板",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    closeBtn.onclick = async () => {
      await this.toggleSnapshotPanel();
    };

    const list = panel.createDiv({ cls: "workspace-paradigm-tag-filter-tree" });
    const snapshotIds = this.getSnapshotIdsForTab(activeTabId);
    if (snapshotIds.length === 0) {
      list.createDiv({ text: "_当前 Tab 暂无快照_", cls: "workspace-empty" });
      this.setSelectedSnapshotId("");
      return;
    }
    const selectedSnapshotId = this.getSelectedSnapshotId(activeTabId);
    snapshotIds.forEach((snapshotId) => {
      const snapshot = this.getSnapshotById(snapshotId);
      if (!snapshot) return;
      const row = list.createDiv({ cls: "workspace-panel-row" });
      const left = row.createDiv();
      left.createEl("div", {
        text: sanitizeText(snapshot.name, snapshot.id),
        cls: "workspace-panel-row-title",
      });
      left.createEl("div", {
        text: `${snapshot.createdAt || ""} · ${snapshot.id}`,
        cls: "workspace-panel-row-subtitle",
      });
      const rowActions = row.createDiv({ cls: "workspace-main-actions" });
      const viewBtn = rowActions.createEl("button", {
        text: selectedSnapshotId === snapshotId ? "已查看" : "查看",
        cls: "workspace-sub-btn",
        attr: { type: "button" },
      });
      viewBtn.onclick = async () => {
        this.setSelectedSnapshotId(snapshotId);
        await this.render();
      };
      const restoreBtn = rowActions.createEl("button", {
        text: "恢复为新 Tab",
        cls: "workspace-sub-btn",
        attr: { type: "button" },
      });
      restoreBtn.onclick = async () => {
        await this.restoreSnapshotAsNewTab(snapshotId);
      };
      const deleteBtn = rowActions.createEl("button", {
        text: "删除",
        cls: "workspace-sub-btn",
        attr: { type: "button" },
      });
      deleteBtn.onclick = async () => {
        await this.deleteSnapshot(snapshotId);
      };
    });

    const selectedSnapshot = selectedSnapshotId ? this.getSnapshotById(selectedSnapshotId) : null;
    if (selectedSnapshot && sanitizeText(selectedSnapshot.tabId, "") === sanitizeText(activeTabId, "")) {
      const preview = panel.createDiv({ cls: "workspace-paradigm-tag-filter-tree" });
      preview.createEl("div", {
        text: `📜 快照预览：${sanitizeText(selectedSnapshot.name, selectedSnapshot.id)}`,
        cls: "workspace-panel-title",
      });
      const tree = preview.createDiv({ attr: { style: "margin-top:6px;" } });
      this.renderSnapshotPreview(tree, selectedSnapshot, null, 0, new Set());
    }
  }

  renderRootTreeWithParadigmGroups(container, tabId, trail = new Set()) {
    const rootItemIds = this.getChildrenIds(null, tabId);
    const paradigmRootItemIdsById = new Map();
    rootItemIds.forEach((itemId) => {
      const item = this.getItemById(itemId);
      if (!item || item.tabId !== tabId || !this.isParadigmMountedItem(item)) return;
      const paradigmNodeId = sanitizeText(item.sourceParadigmMountScopeId || item.sourceParadigmId, "");
      if (!paradigmNodeId) return;
      if (!paradigmRootItemIdsById.has(paradigmNodeId)) paradigmRootItemIdsById.set(paradigmNodeId, []);
      paradigmRootItemIdsById.get(paradigmNodeId).push(item.id);
    });

    let renderedLocal = false;
    rootItemIds.forEach((itemId) => {
      const item = this.getItemById(itemId);
      if (!item || item.tabId !== tabId || this.isParadigmMountedItem(item)) return;
      renderedLocal = true;
      this.renderItemBranch(container, itemId, tabId, 0, trail);
    });

    if (renderedLocal && paradigmRootItemIdsById.size > 0) {
      container.createDiv({ cls: "workspace-branch-separator", text: "↓ 以下为范式挂载内容" });
    }
    this.renderParadigmMountCollection(container, tabId, paradigmRootItemIdsById, 0, trail);
  }

  renderWorkspaceSection(container, tabId, level = 0, rootActiveTabId = this.getActiveTabId()) {
    const tab = this.getTabById(tabId);
    if (!tab) return;
    const section = container.createDiv({
      cls: `workspace-tab-section ${tabId === rootActiveTabId ? "is-current" : "is-child"}`.trim(),
      attr: {
        style: `margin-left:${level * 18}px;`,
        "data-workspace-tab-section-id": tabId,
      },
    });
    const head = section.createDiv({ cls: "workspace-tab-section-head" });
    const titleWrap = head.createDiv({ cls: "workspace-tab-section-title-wrap" });
    titleWrap.createEl("div", {
      cls: "workspace-tab-section-title",
      text: `${tabId === rootActiveTabId ? "●" : "◦"} ${tab.emoji ? `${tab.emoji} ` : ""}${tab.name}`,
    });
    titleWrap.createEl("div", {
      cls: "workspace-tab-section-subtitle",
      text: [
        `Tab ID: ${tab.id}`,
        tab.parentTabId ? `来自上级 ${this.getTabById(tab.parentTabId)?.name || tab.parentTabId}` : "根层 Tab",
        `条目 ${this.getDirectItemCount(tab.id)}`,
      ].join(" · "),
    });

    const actions = head.createDiv({ cls: "workspace-main-actions" });
    const addRootBtn = actions.createEl("button", {
      text: "＋ 本Tab根条目",
      cls: "workspace-sub-btn",
      attr: { type: "button" },
    });
    addRootBtn.onclick = async () => this.addItem(null, tab.id);

    const rootDropZone = section.createDiv({
      cls: "workspace-root-drop-zone workspace-tab-local-root-drop-zone",
      text: `↥ 拖到这里设为「${tab.name}」的根条目`,
    });
    rootDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dragged = this.getItemById(this.draggedItemId);
      if (!dragged || dragged.tabId !== tab.id) return;
      rootDropZone.classList.add("drag-over");
    });
    rootDropZone.addEventListener("dragleave", () => rootDropZone.classList.remove("drag-over"));
    rootDropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      rootDropZone.classList.remove("drag-over");
      const dragged = this.getItemById(this.draggedItemId);
      if (!dragged || dragged.tabId !== tab.id) return;
      await this.moveItemToRoot(dragged.id);
    });

    const treeWrap = section.createDiv({ cls: "workspace-tab-section-tree" });
    const rootItemIds = this.getChildrenIds(null, tab.id);
    if (rootItemIds.length === 0) {
      treeWrap.createDiv({ text: "当前 Tab 还没有条目。", cls: "workspace-empty" });
    } else {
      this.renderRootTreeWithParadigmGroups(treeWrap, tab.id, new Set());
    }

    const childTabs = this.getTabChildrenIds(tab.id);
    if (childTabs.length > 0) {
      const childWrap = section.createDiv({ cls: "workspace-tab-section-children" });
      childTabs.forEach((childTabId) => this.renderWorkspaceSection(childWrap, childTabId, level + 1, rootActiveTabId));
    }
  }

  async render() {
    const { contentEl } = this;
    if (typeof this.floatingPinCleanup === "function") {
      try { this.floatingPinCleanup(); } catch (_) {}
      this.floatingPinCleanup = null;
    }
    this.captureParadigmTocScrollPosition();
    contentEl.empty();

    const wrap = contentEl.createDiv({ cls: "workspace-wrap workspace-mount-panel" });
    const activeTab = this.getActiveTab();
    const activeTabId = this.getActiveTabId();

    const tabBar = wrap.createDiv({ cls: "workspace-mount-tabbar" });
    const rootDropZone = tabBar.createDiv({
      cls: "workspace-mount-tab-root-drop-zone",
      text: "↥ 拖到这里设为顶层 Tab",
    });
    rootDropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!this.draggedTabId) return;
      rootDropZone.classList.add("drag-over");
    });
    rootDropZone.addEventListener("dragleave", () => rootDropZone.classList.remove("drag-over"));
    rootDropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      rootDropZone.classList.remove("drag-over");
      const draggedId = sanitizeText(this.draggedTabId, "");
      if (!draggedId || !this.getTabById(draggedId)) return;
      await this.updateWorkspaceData((data) => {
        ensureTabHierarchyState(data);
        const dragged = data.tabsById?.[draggedId];
        if (!dragged) return;
        this.removeIdFromSimpleChildrenMap(data.tabChildrenByParent, draggedId);
        dragged.parentTabId = null;
        if (!Array.isArray(data.tabChildrenByParent[ROOT_KEY])) data.tabChildrenByParent[ROOT_KEY] = [];
        data.tabChildrenByParent[ROOT_KEY].push(draggedId);
        rebuildTabOrderFromData(data);
      });
    });
    const tabTree = tabBar.createDiv({ cls: "workspace-mount-tab-capsule-group" });
    this.getTabChildrenIds(null).forEach((tabId) => this.renderTabCapsule(tabTree, tabId, activeTabId));

    const header = wrap.createDiv({ cls: "workspace-mount-header" });
    const titleBlock = header.createDiv();
    titleBlock.createEl("div", { text: "Workspace Mount", cls: "workspace-mount-title" });
    titleBlock.createEl("div", {
      text: `当前 Tab: ${activeTab?.name || "-"} | ${this.sourceNotePath || "No source note selected"}`,
      cls: "workspace-mount-subtitle",
    });
    if (this.dataPaths) {
      titleBlock.createEl("div", {
        text: `Data: ${this.dataPaths.dataPath}`,
        cls: "workspace-mount-meta",
      });
    }

    const actions = header.createDiv({ cls: "workspace-mount-actions" });
    const refreshBtn = actions.createEl("button", { text: "Refresh" });
    refreshBtn.onclick = async () => this.reloadWorkspace();
    const newTabBtn = actions.createEl("button", { text: "新建 Tab" });
    newTabBtn.onclick = async () => this.createTab();
    const renameTabBtn = actions.createEl("button", { text: "重命名 Tab" });
    renameTabBtn.onclick = async () => this.renameCurrentTab();
    const styleTabBtn = actions.createEl("button", { text: "Tab 特征化" });
    styleTabBtn.onclick = async () => this.editCurrentTabAppearance();
    const closeTabBtn = actions.createEl("button", { text: "关闭 Tab" });
    closeTabBtn.onclick = async () => this.closeCurrentTab();
    const transferParadigmItemsBtn = actions.createEl("button", { text: "📥 共通范式迁入" });
    transferParadigmItemsBtn.onclick = async () => this.promptTransferCommonParadigmItemsBetweenTabs();
    const cloneParadigmTopologyBtn = actions.createEl("button", { text: "🧬 范式同构迁入" });
    cloneParadigmTopologyBtn.onclick = async () => this.promptCloneTabParadigmBindingsIncrementally();
    const paradigmPanelBtn = actions.createEl("button", {
      text: this.visibleUiState?.showParadigmPanel ? "收起范式面板" : "范式面板",
    });
    paradigmPanelBtn.onclick = async () => this.toggleParadigmPanel();
    const snapshotPanelBtn = actions.createEl("button", {
      text: this.visibleUiState?.showSnapshotPanel ? "收起快照面板" : "💾 快照面板",
    });
    snapshotPanelBtn.onclick = async () => this.toggleSnapshotPanel();

    if (this.lastLoadWarning) {
      wrap.createDiv({
        text: this.lastLoadWarning,
        cls: "workspace-mount-warning",
      });
    }

    const statusRow = wrap.createDiv({ cls: "workspace-mount-status-row" });
    statusRow.createDiv({
      text: `Tabs ${Object.keys(this.workspaceData?.tabsById || {}).length}`,
      cls: "workspace-mount-chip",
    });
    statusRow.createDiv({
      text: `Items ${Object.keys(this.workspaceData?.itemsById || {}).length}`,
      cls: "workspace-mount-chip",
    });
    statusRow.createDiv({
      text: `Snapshots ${Object.keys(this.workspaceData?.snapshotsById || {}).length}`,
      cls: "workspace-mount-chip",
    });
    statusRow.createDiv({
      text: this.bridge.isReady() ? "Capsule Bridge Ready" : "Capsule Bridge Not Ready",
      cls: "workspace-mount-chip is-active",
    });
    if (activeTabId && this.getTabById(activeTabId)) {
      statusRow.createDiv({
        text: `TOC ${this.visibleUiState?.paradigmTocMode === "tab" ? "Tab里面" : "范式面板"}`,
        cls: "workspace-mount-chip",
      });
    }

    const sectionList = wrap.createDiv({ cls: "workspace-mount-sections" });
    if (!activeTabId || !this.getTabById(activeTabId)) {
      sectionList.createDiv({ text: "当前没有可用 Tab。", cls: "workspace-empty" });
      return;
    }
    const toc = this.renderParadigmToc(wrap, {
      ...this.getParadigmBindingSummaryForTab(activeTabId),
      tabId: activeTabId,
      mode: this.visibleUiState?.paradigmTocMode === "tab" ? "tab" : "panel",
    });
    this.restoreParadigmTocScrollPosition(toc);
    if (this.visibleUiState?.showSnapshotPanel) {
      this.renderSnapshotPanel(sectionList, activeTabId);
    }
    if (this.visibleUiState?.showParadigmPanel) {
      this.renderParadigmPanel(sectionList, activeTabId);
    }
    this.renderWorkspaceSection(sectionList, activeTabId, 0, activeTabId);
    this.mountFloatingPinButton(activeTabId);
    if (this.shouldRestorePinnedScrollAfterRender && !this.pendingParadigmFocus) {
      this.shouldRestorePinnedScrollAfterRender = false;
      this.schedulePinnedScrollRestore(activeTabId);
    }
    this.flushPendingParadigmFocus();
  }
}

module.exports = class WorkspaceMountPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(
      VIEW_TYPE_WORKSPACE_MOUNT,
      (leaf) => new WorkspaceMountView(leaf, this),
    );
    this.registerGlobalApi();

    this.ensureRibbonIcon();
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.ensureRibbonIcon();
    }));

    this.addCommand({
      id: "open-workspace-mount",
      name: "Open Workspace Mount",
      callback: async () => this.activateWorkspaceMount(),
    });

    this.addCommand({
      id: "open-workspace-mount-for-current-note",
      name: "Open Workspace Mount for current note",
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        const sourceNotePath = activeFile instanceof TFile ? activeFile.path : this.getDefaultSourceNotePath();
        await this.activateWorkspaceMount(sourceNotePath);
      },
    });

    this.addSettingTab(new WorkspaceMountSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_WORKSPACE_MOUNT).forEach((leaf) => leaf.detach());
    if (this.ribbonIconEl?.isConnected) this.ribbonIconEl.remove();
    this.ribbonIconEl = null;
    this.unregisterGlobalApi();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getDefaultSourceNotePath() {
    return sanitizeText(this.settings?.defaultSourceNotePath, DEFAULT_SETTINGS.defaultSourceNotePath);
  }

  ensureRibbonIcon() {
    if (this.ribbonIconEl?.isConnected) return this.ribbonIconEl;
    this.ribbonIconEl = this.addRibbonIcon("layout-dashboard", "Open Workspace Mount", async () => {
      await this.activateWorkspaceMount();
    });
    return this.ribbonIconEl;
  }

  resolveSourceFile(sourceNotePath) {
    const configured = sanitizeText(sourceNotePath, this.getDefaultSourceNotePath());
    if (!configured) return null;

    const exact = this.app.vault.getAbstractFileByPath(configured);
    if (exact instanceof TFile) return exact;

    const normalized = configured.replace(/\\/g, "/").replace(/^\/+/, "");
    const normalizedExact = this.app.vault.getAbstractFileByPath(normalized);
    if (normalizedExact instanceof TFile) return normalizedExact;

    const targetBase = normalized.replace(/^.*\//, "").replace(/\.md$/i, "").toLowerCase();
    const files = this.app.vault.getMarkdownFiles();
    const exactBase = files.find((file) => file.basename.toLowerCase() === targetBase);
    if (exactBase) return exactBase;

    const suffixMatch = files.find((file) => file.path.toLowerCase().endsWith(normalized.toLowerCase()));
    return suffixMatch || null;
  }

  async loadWorkspaceData(dataPath) {
    if (!sanitizeText(dataPath, "")) return defaultWorkspaceData();
    try {
      const exists = await this.app.vault.adapter.exists(dataPath);
      if (!exists) return defaultWorkspaceData();
      const raw = await this.app.vault.adapter.read(dataPath);
      return normalizeWorkspaceData(JSON.parse(raw));
    } catch (error) {
      console.error("[Workspace Mount] Failed to load workspace data:", error);
      new Notice(`Workspace load failed: ${error.message}`);
      return defaultWorkspaceData();
    }
  }

  async saveWorkspaceData(dataPath, data) {
    const safe = normalizeWorkspaceData(data);
    safe.lastModified = nowString();
    const payload = JSON.stringify(safe, null, 2);
    if (!sanitizeText(dataPath, "")) {
      throw new Error("Workspace data path is not resolved.");
    }
    const file = this.app.vault.getAbstractFileByPath(dataPath);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, payload);
    } else {
      await this.app.vault.create(dataPath, payload);
    }
    return safe;
  }

  async loadTaskNoteBindings(bindingsPath) {
    if (!sanitizeText(bindingsPath, "")) return {};
    try {
      const exists = await this.app.vault.adapter.exists(bindingsPath);
      if (!exists) return {};
      const raw = await this.app.vault.adapter.read(bindingsPath);
      const data = JSON.parse(raw);
      if (data && typeof data.bindings === "object" && !Array.isArray(data.bindings)) return data.bindings;
    } catch (error) {
      console.error("[Workspace Mount] Failed to load task note bindings:", error);
      new Notice(`Workspace note bindings load failed: ${error.message}`);
    }
    return {};
  }

  async loadTaskComments(commentsPath) {
    if (!sanitizeText(commentsPath, "")) return {};
    try {
      const exists = await this.app.vault.adapter.exists(commentsPath);
      if (!exists) return {};
      const raw = await this.app.vault.adapter.read(commentsPath);
      const data = JSON.parse(raw);
      if (data && typeof data.comments === "object" && !Array.isArray(data.comments)) return data.comments;
    } catch (error) {
      console.error("[Workspace Mount] Failed to load task comments:", error);
      new Notice(`Workspace comments load failed: ${error.message}`);
    }
    return {};
  }

  async saveTaskNoteBindings(bindingsPath, bindings) {
    if (!sanitizeText(bindingsPath, "")) {
      throw new Error("Task note bindings path is not resolved.");
    }
    const payload = JSON.stringify({
      schemaVersion: TASK_NOTE_BINDINGS_SCHEMA_VERSION,
      lastModified: nowString(),
      bindings: bindings || {},
    }, null, 2);
    const file = this.app.vault.getAbstractFileByPath(bindingsPath);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, payload);
    } else {
      await this.app.vault.create(bindingsPath, payload);
    }
    return bindings || {};
  }

  async saveTaskComments(commentsPath, comments) {
    if (!sanitizeText(commentsPath, "")) {
      throw new Error("Task comments path is not resolved.");
    }
    const payload = JSON.stringify({
      schemaVersion: TASK_COMMENTS_SCHEMA_VERSION,
      lastModified: nowString(),
      comments: comments || {},
    }, null, 2);
    const file = this.app.vault.getAbstractFileByPath(commentsPath);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, payload);
    } else {
      await this.app.vault.create(commentsPath, payload);
    }
    return comments || {};
  }

  findLeafBySourceNotePath(sourceNotePath) {
    const target = sanitizeText(sourceNotePath, "");
    if (!target) return null;
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_WORKSPACE_MOUNT).find((leaf) => {
      const current = sanitizeText(leaf.getViewState()?.state?.sourceNotePath, "");
      return current === target;
    }) || null;
  }

  getWorkspaceView(sourceNotePath = "") {
    const target = sanitizeText(sourceNotePath, "");
    if (target) {
      const leaf = this.findLeafBySourceNotePath(target);
      return leaf?.view instanceof WorkspaceMountView ? leaf.view : null;
    }

    const activeView = typeof this.app.workspace.getActiveViewOfType === "function"
      ? this.app.workspace.getActiveViewOfType(WorkspaceMountView)
      : null;
    if (activeView instanceof WorkspaceMountView) return activeView;

    const activeLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WORKSPACE_MOUNT);
    if (activeLeaves.length === 1 && activeLeaves[0].view instanceof WorkspaceMountView) return activeLeaves[0].view;
    return null;
  }

  getBridge(sourceNotePath = "") {
    const view = this.getWorkspaceView(sourceNotePath);
    return view?.bridge || null;
  }

  async ensureBridge(sourceNotePath = "") {
    const targetSource = sanitizeText(sourceNotePath, this.getDefaultSourceNotePath());
    let bridge = this.getBridge(targetSource);
    if (bridge?.isReady?.() === true) return bridge;
    await this.activateWorkspaceMount(targetSource);
    bridge = this.getBridge(targetSource);
    return bridge?.isReady?.() === true ? bridge : null;
  }

  async activateWorkspaceMount(sourceNotePath = "") {
    const sourceFile = this.resolveSourceFile(sourceNotePath || this.getDefaultSourceNotePath());
    const resolvedPath = sourceFile?.path || sanitizeText(sourceNotePath, this.getDefaultSourceNotePath());
    let leaf = this.findLeafBySourceNotePath(resolvedPath);
    if (!leaf) leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: VIEW_TYPE_WORKSPACE_MOUNT,
      active: true,
      state: { sourceNotePath: resolvedPath },
    });
    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  registerGlobalApi() {
    this.globalApi = {
      pluginId: this.manifest.id,
      pluginVersion: this.manifest.version,
      getBridge: (sourceNotePath = "") => this.getBridge(sourceNotePath),
      ensureBridge: async (sourceNotePath = "") => this.ensureBridge(sourceNotePath),
      openView: async (sourceNotePath = "") => this.activateWorkspaceMount(sourceNotePath),
    };
    window.__workspaceMountPluginApi = this.globalApi;
  }

  unregisterGlobalApi() {
    if (window.__workspaceMountPluginApi === this.globalApi) {
      delete window.__workspaceMountPluginApi;
    }
    this.globalApi = null;
  }
};
