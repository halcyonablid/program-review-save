const {
  ItemView,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  requestUrl
} = require("obsidian");

const VIEW_TYPE_SMA_CLIENT = "obsidian-sma-client-view";
const SHARED_CONCEPT_STORAGE_KEY = "supermemo_concepts_final_v3";
const DEFAULT_SETTINGS = {
  bridgeBaseUrl: "http://127.0.0.1:27182/api/v1",
  bridgeToken: "dev-obsidian-bridge",
  requestTimeoutMs: 8000,
  autoSyncOnStartup: false,
  autoRegisterOnEnroll: false,
  importFrontmatterKey: "srs",
  dueLookaheadDays: 0
};

function nowIso() {
  return new Date().toISOString();
}

function createInitialState() {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    conceptsById: {},
    smConceptsById: {},
    conceptMappings: {},
    notesById: {},
    pathIndex: {},
    smIndex: {},
    ui: {
      activeTab: "records",
      selectedSmConceptId: null,
      scrollByFilter: {},
      recordTreeByFilter: {},
      smConceptTree: {}
    },
    reviewSession: {
      date: formatDateOnly(new Date()),
      completedByNoteId: {}
    },
    audit: {
      lastFullScanAt: null,
      lastHealthCheckAt: null,
      lastSuccessfulSyncAt: null
    }
  };
}

function generateNoteId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateConceptId(keyword) {
  let hash = 0;
  const text = String(keyword || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash &= hash;
  }
  return `sm-${Math.abs(hash).toString(36)}`;
}

function cloneSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {})
  };
}

function formatDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }

  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function normalizePositiveInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function hasMojibake(value) {
  const text = String(value || "");
  if (!text) {
    return false;
  }
  return /\uFFFD|\?{3,}|[\u00C0-\u024F][\u0080-\u00BF]|[鍀-龿][\u0080-\uFFFF]*[鍀-龿]/.test(text);
}

function getBasenameFromPath(pathValue) {
  const pathText = String(pathValue || "").replace(/\\/g, "/");
  const filename = pathText.split("/").filter(Boolean).pop() || "";
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}

function getCommentSummary(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > 100 ? `${normalized.slice(0, 100)}…` : normalized;
}

function createRecord(file, noteId) {
  return {
    noteId,
    path: file.path,
    basename: file.basename,
    smId: null,
    smConceptId: null,
    legacyConceptId: null,
    conceptId: null,
    primarySmConceptId: null,
    needsSmConcept: false,
    pendingConceptSync: false,
    enrolled: true,
    status: "enrolled",
    registeredAt: null,
    lastSyncAt: null,
    lastErrorAt: null,
    schedule: {
      nextReview: null,
      interval: null,
      repetitions: null,
      easiness: null,
      lastReview: null,
      status: null,
      reason: null,
      sources: null,
      diagnostics: null
    },
    reviewProbe: {
      lastProbedAt: null,
      lastRequestedGrade: null,
      lastVerdict: null,
      lastResponse: null
    },
    contentFingerprint: {
      mtime: file.stat ? file.stat.mtime : null,
      size: file.stat ? file.stat.size : null
    },
    comment: "",
    errors: []
  };
}

function createConceptRecord({ id, label, parentId = null, accentColor = "", note = "" }) {
  return {
    id: id || generateConceptId(label),
    keyword: label,
    parentId,
    order: 0,
    colorType: parentId ? "plus" : "yaml",
    accentColor,
    note,
    createdAt: nowIso()
  };
}

class SmaBridgeClient {
  constructor(plugin) {
    this.plugin = plugin;
  }

  async health() {
    return this.request("/health", { method: "GET" });
  }

  async register(payload) {
    return this.request("/elements/register", {
      method: "POST",
      body: payload
    });
  }

  async reparent(smId, payload) {
    return this.request(`/elements/${encodeURIComponent(smId)}/reparent`, {
      method: "POST",
      body: payload
    });
  }

  async concepts() {
    return this.request("/concepts", {
      method: "GET"
    });
  }

  async ensureConcept(payload) {
    return this.request("/concepts/ensure", {
      method: "POST",
      body: payload
    });
  }

  async conceptLearningProbe(smConceptId, payload) {
    return this.request(`/concepts/${encodeURIComponent(smConceptId)}/learning-probe`, {
      method: "POST",
      body: payload
    });
  }

  async status(smId) {
    return this.request(`/elements/${encodeURIComponent(smId)}`, {
      method: "GET"
    });
  }

  async review(smId, payload) {
    return this.request(`/elements/${encodeURIComponent(smId)}/review`, {
      method: "POST",
      body: payload
    });
  }

  async deleteElement(smId) {
    return this.request(`/elements/${encodeURIComponent(smId)}/delete`, {
      method: "POST"
    });
  }

  async request(path, options) {
    const settings = this.plugin.state.settings;
    const baseUrl = (settings.bridgeBaseUrl || DEFAULT_SETTINGS.bridgeBaseUrl).replace(/\/+$/, "");
    const url = `${baseUrl}${path}`;
    const headers = {
      Authorization: `Bearer ${settings.bridgeToken || ""}`
    };
    const requestOptions = {
      url,
      method: options.method || "GET",
      headers,
      throw: false
    };

    if (options.body !== undefined) {
      requestOptions.headers["Content-Type"] = "application/json; charset=utf-8";
      requestOptions.body = JSON.stringify(options.body);
    }

    const response = await Promise.race([
      requestUrl(requestOptions),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error(`Bridge request timed out after ${settings.requestTimeoutMs} ms`)), settings.requestTimeoutMs);
      })
    ]);

    let payload = null;
    if (response.text) {
      try {
        payload = JSON.parse(response.text);
      } catch (error) {
        payload = {
          ok: false,
          message: "invalid-json-response",
          data: {
            error: error.message,
            raw: response.text
          }
        };
      }
    }

    if (response.status >= 400 || !payload || payload.ok === false) {
      const errorMessage = payload && payload.data && payload.data.error
        ? payload.data.error
        : (payload && payload.message) || `HTTP ${response.status}`;
      throw new Error(errorMessage);
    }

    return payload;
  }
}

class ConceptPickerModal extends Modal {
  constructor(app, plugin, options) {
    super(app);
    this.plugin = plugin;
    this.options = options || {};
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("obsidian-sma-client-concept-picker-modal");
    contentEl.createEl("h3", { text: this.options.title || "选择 Concept" });

    if (this.options.description) {
      contentEl.createDiv({
        cls: "obsidian-sma-client-note-path",
        text: this.options.description
      });
    }

    const actions = contentEl.createDiv({ cls: "obsidian-sma-client-actions" });
    if (this.options.allowClear !== false) {
      const clearButton = actions.createEl("button", { text: "清除选择" });
      clearButton.addEventListener("click", async () => {
        if (typeof this.options.onPick === "function") {
          await this.options.onPick(null);
        }
        this.close();
      });
    }

    const tree = contentEl.createDiv({ cls: "obsidian-sma-client-concept-tree" });
    const roots = this.plugin.getConceptList().filter((concept) => !concept.parentId);
    if (!roots.length) {
      tree.createDiv({
        cls: "obsidian-sma-client-empty",
        text: "当前没有 concept。"
      });
      return;
    }

    roots.forEach((concept) => {
      this.renderNode(tree, concept, 0);
    });
  }

  renderNode(container, concept, level) {
    const node = container.createDiv({ cls: "obsidian-sma-client-concept-node" });
    node.style.setProperty("--sm-concept-level", String(level));

    const capsule = node.createDiv({ cls: "obsidian-sma-client-concept-capsule" });
    if (concept.accentColor) {
      capsule.style.setProperty("--sm-concept-accent", concept.accentColor);
    }

    const main = capsule.createDiv({ cls: "obsidian-sma-client-concept-capsule-main" });
    main.createDiv({
      cls: "obsidian-sma-client-concept-capsule-title",
      text: this.plugin.getConceptLabel(concept)
    });
    main.createDiv({
      cls: "obsidian-sma-client-concept-capsule-path",
      text: this.plugin.getConceptPathLabel(concept.id)
    });

    const button = capsule.createEl("button", { text: "选择" });
    button.addEventListener("click", async () => {
      if (typeof this.options.onPick === "function") {
        await this.options.onPick(concept.id);
      }
      this.close();
    });

    const children = this.plugin.getConceptChildren(concept.id);
    if (children.length) {
      const childrenWrap = node.createDiv({ cls: "obsidian-sma-client-concept-children" });
      children.forEach((child) => this.renderNode(childrenWrap, child, level + 1));
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ConfirmActionModal extends Modal {
  constructor(app, options) {
    super(app);
    this.options = options || {};
    this.confirmed = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("obsidian-sma-client-concept-picker-modal");
    contentEl.createEl("h3", { text: this.options.title || "请确认" });

    if (this.options.description) {
      contentEl.createDiv({
        cls: "obsidian-sma-client-note-path",
        text: this.options.description
      });
    }

    if (this.options.warning) {
      contentEl.createDiv({
        cls: "obsidian-sma-client-note-path",
        text: this.options.warning
      });
    }

    const actions = contentEl.createDiv({ cls: "obsidian-sma-client-actions" });
    const cancelButton = actions.createEl("button", {
      text: this.options.cancelText || "取消"
    });
    cancelButton.addEventListener("click", () => {
      this.close();
    });

    const confirmButton = actions.createEl("button", {
            text: this.options.confirmText || "??"
    });
    confirmButton.addClass("mod-warning");
    confirmButton.addEventListener("click", async () => {
      this.confirmed = true;
      this.close();
      if (typeof this.options.onConfirm === "function") {
        await this.options.onConfirm();
      }
    });
  }

  onClose() {
    this.contentEl.empty();
    if (!this.confirmed && typeof this.options.onCancel === "function") {
      this.options.onCancel();
    }
  }
}

class SmConceptPickerModal extends Modal {
  constructor(app, plugin, options) {
    super(app);
    this.plugin = plugin;
    this.options = options || {};
    this.query = "";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("obsidian-sma-client-concept-picker-modal");
    contentEl.createEl("h3", { text: this.options.title || "选择 SuperMemo Concept" });

    if (this.options.description) {
      contentEl.createDiv({
        cls: "obsidian-sma-client-note-path",
        text: this.options.description
      });
    }

    const actions = contentEl.createDiv({ cls: "obsidian-sma-client-actions" });
    if (this.options.allowClear !== false) {
      const clearButton = actions.createEl("button", { text: "清除选择" });
      clearButton.addEventListener("click", async () => {
        if (typeof this.options.onPick === "function") {
          await this.options.onPick(null);
        }
        this.close();
      });
    }

    const input = contentEl.createEl("input", {
      type: "text",
      placeholder: "搜索 SuperMemo Concept 名称"
    });
    input.addClass("obsidian-sma-client-smconcept-search");
    input.addEventListener("input", () => {
      this.query = input.value.trim().toLowerCase();
      this.renderList();
    });

    this.listEl = contentEl.createDiv({ cls: "obsidian-sma-client-concept-tree" });
    this.renderList();
  }

  renderList() {
    if (!this.listEl) {
      return;
    }
    this.listEl.empty();
    const concepts = this.plugin.getSmConceptList().filter((concept) => {
      if (!this.query) {
        return true;
      }
      const haystack = `${concept.name || ""} ${concept.smConceptId || ""}`.toLowerCase();
      return haystack.includes(this.query);
    });

    if (!concepts.length) {
      this.listEl.createDiv({
        cls: "obsidian-sma-client-empty",
        text: this.plugin.getSmConceptList().length
          ? "没有匹配的 SuperMemo Concept。"
          : "当前还没有拉取到 SuperMemo Concept。请先点击“拉取 SM Concept”。"
      });
      return;
    }

    concepts.forEach((concept) => {
      const card = this.listEl.createDiv({ cls: "obsidian-sma-client-note" });
      const header = card.createDiv({ cls: "obsidian-sma-client-note-header" });
      const titleWrap = header.createDiv();
      titleWrap.createDiv({
        cls: "obsidian-sma-client-note-title",
        text: concept.name || `SM Concept ${concept.smConceptId}`
      });
      titleWrap.createDiv({
        cls: "obsidian-sma-client-note-path",
        text: `smConceptId: ${concept.smConceptId}${concept.elementId ? ` ｜ elementId: ${concept.elementId}` : ""}`
      });
      const badges = header.createDiv({ cls: "obsidian-sma-client-note-badges" });
      this.createBadge(badges, `use:${concept.useCount != null ? concept.useCount : "-"}`, "");
      if (concept.created) {
        this.createBadge(badges, "new", "-warn");
      }
      card.createDiv({
        cls: "obsidian-sma-client-note-path",
        text: `Obsidian entries: ${this.plugin.getRecordsBySmConcept(concept.smConceptId).length}`
      });

      const actions = card.createDiv({ cls: "obsidian-sma-client-actions" });
      const button = actions.createEl("button", { text: "选择" });
      button.addEventListener("click", async () => {
        if (typeof this.options.onPick === "function") {
          await this.options.onPick(concept.smConceptId);
        }
        this.close();
      });
    });
  }

  createBadge(container, label, modifier) {
    const cls = modifier ? `obsidian-sma-client-badge ${modifier}` : "obsidian-sma-client-badge";
    container.createDiv({ cls, text: label });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ObsidianSmaClientView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_SMA_CLIENT;
  }

  getDisplayText() {
    return "SMA Panel";
  }

  getIcon() {
    return "database";
  }

  async onOpen() {
    this.plugin.registerViewInstance(this);
    await this.render();
  }

  async onClose() {
    this.plugin.unregisterViewInstance(this);
  }

  async refresh() {
    await this.render();
  }

  async render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("obsidian-sma-client-view");

    const toolbar = container.createDiv({ cls: "obsidian-sma-client-toolbar" });
    this.createButton(toolbar, "Health", async () => {
      await this.plugin.runHealthCheck(true);
    });
    this.createButton(toolbar, "注册/刷新", async () => {
      await this.plugin.syncEnrolledNotes({ interactive: true });
    });
    this.createButton(toolbar, "Enroll current", async () => {
      await this.plugin.enrollCurrentNote({ autoSync: true });
    });
    this.createButton(toolbar, "Import srs:true", async () => {
      await this.plugin.importFrontmatterMembers(true);
    });
    this.createButton(toolbar, "拉取 SM Concept", async () => {
      await this.plugin.refreshSmConcepts(true);
    });

    const summary = container.createDiv({ cls: "obsidian-sma-client-summary" });
    const records = this.plugin.getSortedRecords();
    this.createSummaryCard(summary, "Enrolled", String(records.filter((record) => record.enrolled).length));
    this.createSummaryCard(summary, "Registered", String(records.filter((record) => record.enrolled && record.smId).length));
    this.createSummaryCard(summary, "SM Concepts", String(this.plugin.getSmConceptList().length));
    this.createSummaryCard(summary, "Errors", String(records.filter((record) => Array.isArray(record.errors) && record.errors.length > 0).length));

    const tabBar = container.createDiv({ cls: "obsidian-sma-client-tabbar" });
    [
      ["records", "条目"],
      ["smconcepts", "SM Concepts"]
    ].forEach(([key, label]) => {
      const isActive = this.plugin.state.ui.activeTab === key;
      const button = tabBar.createEl("button", {
        text: label,
        cls: isActive ? "is-active" : ""
      });
      button.addEventListener("click", async () => {
        this.plugin.state.ui.activeTab = key;
        await this.plugin.persistState();
      });
    });

    const conceptFilterWrap = container.createDiv({ cls: "obsidian-sma-client-concept-filter" });
    const selectedConcept = this.plugin.getSelectedSmConcept();
    this.renderSmConceptFilterCapsules(conceptFilterWrap);

    if ((this.plugin.state.ui.activeTab || "records") === "smconcepts") {
      this.renderSmConceptManager(container);
      return;
    }

    const filteredRecords = this.plugin.filterRecordsBySelectedSmConcept(records).filter((record) => record.enrolled !== false);
    this.renderSection(
      container,
      selectedConcept
        ? `条目：${selectedConcept.name || selectedConcept.smConceptId} (${filteredRecords.length}/${records.length})`
        : `全部条目 (${records.length})`,
      filteredRecords,
      records.length
        ? "当前筛选下没有条目，可切回全部或重新选择一个 SuperMemo Concept。"
        : "还没有任何成员笔记。先执行 Enroll current，或导入 srs:true。"
    );
  }

  renderSmConceptFilterCapsules(container) {
    const concepts = this.plugin.getSmConceptList();
    const header = container.createDiv({ cls: "obsidian-sma-client-concept-filter-header" });
    header.createDiv({
      cls: "obsidian-sma-client-section-title",
      text: "SM Concept 筛选"
    });
    const clearButton = header.createEl("button", {
      text: this.plugin.state.ui.selectedSmConceptId ? "显示全部" : "全部条目",
      cls: this.plugin.state.ui.selectedSmConceptId ? "" : "is-active"
    });
    clearButton.addEventListener("click", async () => {
      this.plugin.state.ui.selectedSmConceptId = null;
      this.plugin.state.ui.activeTab = "records";
      await this.plugin.persistState();
    });

    if (!concepts.length) {
      container.createDiv({
        cls: "obsidian-sma-client-empty",
        text: "还没有 SuperMemo Concept。点击上方“拉取 SM Concept”后会在这里显示胶囊。"
      });
      return;
    }

    const tree = container.createDiv({ cls: "obsidian-sma-client-concept-filter-tree obsidian-sma-client-capsule-tree" });
    this.renderSmConceptRootDropZone(tree);
    const byId = new Map(concepts.map((concept) => [String(concept.smConceptId), concept]));
    const roots = this.plugin.getTreeRoots("smConcept", "all", concepts, (concept) => String(concept.smConceptId));
    roots.forEach((concept) => this.renderSmConceptFilterCapsule(tree, concept, byId, 0));
  }

  renderSmConceptRootDropZone(container) {
    const rootZone = container.createDiv({
      cls: "obsidian-sma-client-root-drop-zone",
      text: "↥ 拖到这里设为顶层 Concept"
    });
    rootZone.addEventListener("dragover", (event) => {
      const payload = this.readTreeDragPayload(event);
      if (!payload || payload.kind !== "smConcept") {
        return;
      }
      event.preventDefault();
      rootZone.addClass("drag-over");
    });
    rootZone.addEventListener("dragleave", () => rootZone.removeClass("drag-over"));
    rootZone.addEventListener("drop", async (event) => {
      const payload = this.readTreeDragPayload(event);
      if (!payload || payload.kind !== "smConcept") {
        return;
      }
      event.preventDefault();
      rootZone.removeClass("drag-over");
      await this.plugin.moveTreeItemToRoot("smConcept", "all", payload.itemId);
    });
  }

  renderSmConceptFilterCapsule(container, concept, byId, level) {
    const conceptId = String(concept.smConceptId);
    const selectedId = normalizePositiveInt(this.plugin.state.ui.selectedSmConceptId);
    const entry = this.plugin.getTreeEntry("smConcept", "all", conceptId);
    const parentConcept = entry.parentId ? byId.get(String(entry.parentId)) : null;
    const children = this.plugin.getTreeChildren("smConcept", "all", conceptId, Array.from(byId.values()), (item) => String(item.smConceptId));
    const collapsed = this.plugin.isTreeItemCollapsed("smConcept", "all", conceptId);
    const wrapper = container.createDiv({ cls: "obsidian-sma-client-filter-capsule-node" });
    wrapper.style.setProperty("--sma-tree-level", String(level));
    wrapper.dataset.dropLabel = "";

    const capsule = wrapper.createDiv({
      cls: selectedId === normalizePositiveInt(concept.smConceptId)
        ? "obsidian-sma-client-filter-capsule is-active"
        : "obsidian-sma-client-filter-capsule"
    });
    this.attachTreeDragHandlers(capsule, "smConcept", "all", conceptId);

    const toggle = capsule.createEl("button", {
      text: children.length ? (collapsed ? "▸" : "▾") : "•",
      cls: "obsidian-sma-client-filter-toggle"
    });
    toggle.disabled = !children.length;
    toggle.addEventListener("click", async (event) => {
      event.stopPropagation();
      await this.plugin.toggleTreeItemCollapsed("smConcept", "all", conceptId);
    });

    capsule.createDiv({ cls: "obsidian-sma-client-filter-drag", text: "☰" });
    capsule.addEventListener("click", async (event) => {
      if (event.target && event.target.closest && event.target.closest("button")) {
        return;
      }
      this.plugin.state.ui.selectedSmConceptId = normalizePositiveInt(concept.smConceptId);
      this.plugin.state.ui.activeTab = "records";
      await this.plugin.persistState();
    });
    capsule.createDiv({
      cls: "obsidian-sma-client-filter-label",
      text: concept.name || `SM Concept ${concept.smConceptId}`
    });
    capsule.createDiv({
      cls: "obsidian-sma-client-filter-count",
      text: String(this.plugin.getRecordsBySmConcept(concept.smConceptId).length)
    });

    const relationBits = [];
    relationBits.push(parentConcept ? `父级：${parentConcept.name || parentConcept.smConceptId}` : "顶层 Concept");
    if (children.length) {
      relationBits.push(`子级：${children.length}`);
    }
    wrapper.createDiv({
      cls: "obsidian-sma-client-capsule-relation",
      text: relationBits.join(" · ")
    });

    if (children.length && !collapsed) {
      wrapper.createDiv({
        cls: "obsidian-sma-client-nested-capsule-caption",
        text: `子 Concept × ${children.length}`
      });
      const childWrap = wrapper.createDiv({ cls: "obsidian-sma-client-filter-children obsidian-sma-client-nested-capsule-ring" });
      children.forEach((child) => this.renderSmConceptFilterCapsule(childWrap, child, byId, level + 1));
    }
  }

  renderSmConceptManager(container) {
    const conceptContainer = container.createDiv({ cls: "obsidian-sma-client-concept-manager" });
    const concepts = this.plugin.getSmConceptList();
    conceptContainer.createDiv({
      cls: "obsidian-sma-client-note-path",
      text: `已拉取 SM Concepts：${concepts.length}`
    });

    if (!concepts.length) {
      conceptContainer.createDiv({
        cls: "obsidian-sma-client-empty",
        text: "当前还没有拉取到 SuperMemo Concepts。点击上方“拉取 SM Concept”即可刷新。"
      });
      return;
    }

    const tree = conceptContainer.createDiv({ cls: "obsidian-sma-client-capsule-tree obsidian-sma-client-smconcept-manager-tree" });
    this.renderSmConceptRootDropZone(tree);
    this.renderSmConceptTree(tree, concepts);
  }

  renderSmConceptTree(container, concepts) {
    const byId = new Map(concepts.map((concept) => [String(concept.smConceptId), concept]));
    const roots = this.plugin.getTreeRoots("smConcept", "all", concepts, (concept) => String(concept.smConceptId));
    roots.forEach((concept) => this.renderSmConceptTreeNode(container, concept, byId, 0));
  }

  renderSmConceptTreeNode(container, concept, byId, level) {
    const conceptId = String(concept.smConceptId);
    const entry = this.plugin.getTreeEntry("smConcept", "all", conceptId);
    const parentConcept = entry.parentId ? byId.get(String(entry.parentId)) : null;
    const children = this.plugin.getTreeChildren("smConcept", "all", conceptId, Array.from(byId.values()), (item) => String(item.smConceptId));
    const collapsed = this.plugin.isTreeItemCollapsed("smConcept", "all", conceptId);
    const wrapper = container.createDiv({ cls: "obsidian-sma-client-tree-node obsidian-sma-client-concept-capsule-node" });
    wrapper.style.setProperty("--sma-tree-level", String(level));
    wrapper.dataset.treeKind = "smConcept";
    wrapper.dataset.treeId = conceptId;
    wrapper.dataset.dropLabel = "";

    const shell = wrapper.createDiv({ cls: "obsidian-sma-client-capsule" });
    this.attachTreeDragHandlers(shell, "smConcept", "all", conceptId);
    const head = shell.createDiv({ cls: "obsidian-sma-client-tree-controls" });
    const toggle = head.createEl("button", { text: children.length ? (collapsed ? "▸" : "▾") : "•" });
    toggle.disabled = !children.length;
    toggle.addEventListener("click", async () => {
      await this.plugin.toggleTreeItemCollapsed("smConcept", "all", conceptId);
    });
    head.createDiv({ cls: "obsidian-sma-client-drag-handle", text: "☰" });

    const card = shell.createDiv({ cls: "obsidian-sma-client-note obsidian-sma-client-capsule-card" });
    this.renderSmConceptCard(card, concept);

    const relationBits = [];
    relationBits.push(parentConcept ? `父级：${parentConcept.name || parentConcept.smConceptId}` : "顶层 Concept");
    if (children.length) {
      relationBits.push(`子级：${children.length}`);
    }
    wrapper.createDiv({
      cls: "obsidian-sma-client-capsule-relation",
      text: relationBits.join(" · ")
    });

    if (children.length && !collapsed) {
      wrapper.createDiv({
        cls: "obsidian-sma-client-nested-capsule-caption",
        text: `子 Concept × ${children.length}`
      });
      const childWrap = wrapper.createDiv({ cls: "obsidian-sma-client-tree-children obsidian-sma-client-nested-capsule-ring" });
      children.forEach((child) => this.renderSmConceptTreeNode(childWrap, child, byId, level + 1));
    }
  }

  renderSmConceptCard(card, concept) {
    const selectedSmConceptId = normalizePositiveInt(this.plugin.state.ui.selectedSmConceptId);
    const header = card.createDiv({ cls: "obsidian-sma-client-note-header" });
    const titleWrap = header.createDiv();
    titleWrap.createDiv({
      cls: "obsidian-sma-client-note-title",
      text: concept.name || `SM Concept ${concept.smConceptId}`
    });
    titleWrap.createDiv({
      cls: "obsidian-sma-client-note-path",
      text: `smConceptId: ${concept.smConceptId}${concept.elementId ? ` ｜ elementId: ${concept.elementId}` : ""}`
    });

    const badges = header.createDiv({ cls: "obsidian-sma-client-note-badges" });
    this.createBadge(badges, `use:${concept.useCount != null ? concept.useCount : "-"}`, "");
    this.createBadge(badges, `notes:${this.plugin.getRecordsBySmConcept(concept.smConceptId).length}`, "");
    if (concept.created) {
      this.createBadge(badges, "new", "-warn");
    }
    if (selectedSmConceptId === normalizePositiveInt(concept.smConceptId)) {
      this.createBadge(badges, "selected", "-ok");
    }

    const actions = card.createDiv({ cls: "obsidian-sma-client-actions" });
    this.createButton(actions, "筛选条目", async () => {
      this.plugin.state.ui.selectedSmConceptId = normalizePositiveInt(concept.smConceptId);
      this.plugin.state.ui.activeTab = "records";
      await this.plugin.persistState();
    });
    if (selectedSmConceptId === normalizePositiveInt(concept.smConceptId)) {
      this.createButton(actions, "清除筛选", async () => {
        this.plugin.state.ui.selectedSmConceptId = null;
        await this.plugin.persistState();
      });
    }
    this.createButton(actions, "学习 Probe", async () => {
      await this.plugin.runConceptLearningProbe(concept.smConceptId, {
        mode: "set-current-only",
        effectful: false
      }, true);
    });
    this.createButton(actions, "推进队列 Probe", async () => {
      await this.plugin.runConceptLearningProbe(concept.smConceptId, {
        mode: "next",
        effectful: true
      }, true);
    });
  }

  createButton(container, label, onClick) {
    const button = container.createEl("button", { text: label });
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await onClick();
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  createSummaryCard(container, label, value) {
    const card = container.createDiv({ cls: "obsidian-sma-client-summary-card" });
    card.createDiv({ cls: "obsidian-sma-client-summary-label", text: label });
    card.createDiv({ cls: "obsidian-sma-client-summary-value", text: value });
  }

  renderSection(container, title, records, emptyMessage) {
    const section = container.createDiv({ cls: "obsidian-sma-client-section" });
    section.createDiv({ cls: "obsidian-sma-client-section-title", text: title });
    const list = section.createDiv({ cls: "obsidian-sma-client-list" });
    const scrollKey = this.plugin.getCurrentRecordListScrollKey();
    list.addEventListener("scroll", () => {
      this.plugin.rememberRecordListScroll(scrollKey, list.scrollTop);
    });

    if (!records.length) {
      if (emptyMessage) {
        list.createDiv({
          cls: "obsidian-sma-client-empty",
          text: emptyMessage
        });
      }
      return;
    }

    this.renderRecordTree(list, records, scrollKey);
    this.plugin.restoreRecordListScroll(list, scrollKey);
  }

  renderRecordTree(container, records, scrollKey) {
    const byId = new Map(records.map((record) => [record.noteId, record]));
    const roots = this.plugin.getTreeRoots("record", scrollKey, records, (record) => record.noteId);
    roots.forEach((record) => this.renderRecordTreeNode(container, record, byId, 0, scrollKey));
  }

  renderRecordTreeNode(container, record, byId, level, scrollKey) {
    const children = this.plugin.getTreeChildren("record", scrollKey, record.noteId, Array.from(byId.values()), (item) => item.noteId);
    const collapsed = this.plugin.isTreeItemCollapsed("record", scrollKey, record.noteId);
    const wrapper = container.createDiv({ cls: "obsidian-sma-client-tree-node obsidian-sma-client-record-tree-node" });
    wrapper.style.setProperty("--sma-tree-level", String(level));
    wrapper.dataset.treeKind = "record";
    wrapper.dataset.treeId = record.noteId;

    const shell = wrapper.createDiv({ cls: "obsidian-sma-client-capsule" });
    this.attachTreeDragHandlers(shell, "record", scrollKey, record.noteId);
    const head = shell.createDiv({ cls: "obsidian-sma-client-tree-controls" });
    const toggle = head.createEl("button", { text: children.length ? (collapsed ? "▸" : "▾") : "•" });
    toggle.disabled = !children.length;
    toggle.addEventListener("click", async () => {
      await this.plugin.toggleTreeItemCollapsed("record", scrollKey, record.noteId);
    });
    head.createDiv({ cls: "obsidian-sma-client-drag-handle", text: "☰" });

    this.renderRecordCard(shell, record);

    if (children.length && !collapsed) {
      const childWrap = wrapper.createDiv({ cls: "obsidian-sma-client-tree-children" });
      children.forEach((child) => this.renderRecordTreeNode(childWrap, child, byId, level + 1, scrollKey));
    }
  }

  attachTreeDragHandlers(element, kind, scopeKey, itemId) {
    const indicator = element.createDiv({ cls: "obsidian-sma-client-drop-indicator" });
    indicator.setText("拖到上方=前面｜中间=子级｜下方=后面");
    element.draggable = true;
    element.addEventListener("dragstart", (event) => {
      element.addClass("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", JSON.stringify({ kind, scopeKey, itemId }));
    });
    element.addEventListener("dragend", () => {
      element.removeClass("is-dragging");
      element.removeClass("drag-over-before");
      element.removeClass("drag-over-after");
      element.removeClass("drag-over-child");
    });
    element.addEventListener("dragover", (event) => {
      const payload = this.readTreeDragPayload(event);
      if (!payload || payload.kind !== kind || payload.itemId === itemId) {
        return;
      }
      event.preventDefault();
      const position = this.getTreeDropPosition(event, element);
      element.removeClass("drag-over-before");
      element.removeClass("drag-over-after");
      element.removeClass("drag-over-child");
      element.addClass("drag-over-" + position);
      const ownerNode = element.closest(".obsidian-sma-client-tree-node, .obsidian-sma-client-filter-capsule-node");
      if (ownerNode) {
        ownerNode.removeClass("drag-over-before");
        ownerNode.removeClass("drag-over-after");
        ownerNode.removeClass("drag-over-child");
        ownerNode.addClass("drag-over-" + position);
      }
      this.updateTreeDropIndicator(element, position);
    });
    element.addEventListener("dragleave", () => {
      element.removeClass("drag-over-before");
      element.removeClass("drag-over-after");
      element.removeClass("drag-over-child");
      const ownerNode = element.closest(".obsidian-sma-client-tree-node, .obsidian-sma-client-filter-capsule-node");
      if (ownerNode) {
        ownerNode.removeClass("drag-over-before");
        ownerNode.removeClass("drag-over-after");
        ownerNode.removeClass("drag-over-child");
      }
      this.updateTreeDropIndicator(element, null);
    });
    element.addEventListener("drop", async (event) => {
      const payload = this.readTreeDragPayload(event);
      if (!payload || payload.kind !== kind || payload.itemId === itemId) {
        return;
      }
      event.preventDefault();
      const position = this.getTreeDropPosition(event, element);
      this.updateTreeDropIndicator(element, null);
      const ownerNode = element.closest(".obsidian-sma-client-tree-node, .obsidian-sma-client-filter-capsule-node");
      if (ownerNode) {
        ownerNode.removeClass("drag-over-before");
        ownerNode.removeClass("drag-over-after");
        ownerNode.removeClass("drag-over-child");
      }
      await this.plugin.moveTreeItem(kind, scopeKey, payload.itemId, itemId, position);
    });
  }

  updateTreeDropIndicator(element, position) {
    const indicator = element.querySelector(".obsidian-sma-client-drop-indicator");
    const ownerNode = element.closest(".obsidian-sma-client-tree-node, .obsidian-sma-client-filter-capsule-node");
    const label = position === "before"
      ? "落点：放到这个条目前面"
      : position === "after"
        ? "落点：放到这个条目后面"
        : position === "child"
          ? "落点：作为这个条目的子级"
          : "拖到上方=前面｜中间=子级｜下方=后面";
    if (indicator) {
      indicator.setText(label);
    }
    if (ownerNode) {
      ownerNode.dataset.dropLabel = position ? label : "";
    }
  }

  readTreeDragPayload(event) {
    try {
      const payloadText = event.dataTransfer ? event.dataTransfer.getData("text/plain") : "";
      return payloadText ? JSON.parse(payloadText) : null;
    } catch (error) {
      return null;
    }
  }

  getTreeDropPosition(event, element) {
    const rect = element.getBoundingClientRect();
    const offset = event.clientY - rect.top;
    if (offset < rect.height * 0.28) {
      return "before";
    }
    if (offset > rect.height * 0.72) {
      return "after";
    }
    return "child";
  }

  renderRecordCard(container, record) {
    const note = container.createDiv({ cls: "obsidian-sma-client-note" });
    const header = note.createDiv({ cls: "obsidian-sma-client-note-header" });
    const titleWrap = header.createDiv();
    titleWrap.createDiv({ cls: "obsidian-sma-client-note-title", text: this.plugin.getRecordDisplayTitle(record) });
    titleWrap.createDiv({ cls: "obsidian-sma-client-note-path", text: record.path });

    const badges = header.createDiv({ cls: "obsidian-sma-client-note-badges" });
    this.createBadge(badges, record.enrolled ? "enrolled" : "removed", record.enrolled ? "-ok" : "");
    this.createBadge(badges, record.smId ? `sm:${record.smId}` : "unregistered", record.smId ? "-ok" : "-warn");
    if (record.schedule && record.schedule.nextReview) {
      this.createBadge(badges, `next:${record.schedule.nextReview}`, "");
    }
    const smConcept = this.plugin.getSmConceptById(record.smConceptId);
    if (smConcept) {
      this.createBadge(badges, `SM:${smConcept.name}`, "-ok");
    } else if (record.smConceptId) {
      this.createBadge(badges, `SM:${record.smConceptId}`, "-warn");
    } else if (record.needsSmConcept) {
      this.createBadge(badges, "SM:待绑定", "-warn");
    }
    if (record.pendingConceptSync) {
      this.createBadge(badges, "concept-pending", "-warn");
    }
    if (this.plugin.isDueRecord(record)) {
      this.createBadge(badges, "due", "-due");
    } else if (this.plugin.isPendingScheduleRecord(record)) {
      this.createBadge(badges, "pending-schedule", "-warn");
    }
    const meta = note.createDiv({ cls: "obsidian-sma-client-meta" });
    meta.createDiv({ text: `Status: ${record.status || "-"}` });
    meta.createDiv({ text: `Last sync: ${record.lastSyncAt || "-"}` });
    meta.createDiv({ text: `Interval: ${record.schedule && record.schedule.interval != null ? record.schedule.interval : "-"}` });
    meta.createDiv({ text: `Reps: ${record.schedule && record.schedule.repetitions != null ? record.schedule.repetitions : "-"}` });
    meta.createDiv({ text: `Next review: ${record.schedule && record.schedule.nextReview ? record.schedule.nextReview : "-"}` });
    if (record.schedule && (record.schedule.status || record.schedule.reason)) {
      const scheduleReason = record.schedule.reason ? ` ｜ ${record.schedule.reason}` : "";
      meta.createDiv({
        cls: "obsidian-sma-client-muted",
        text: `Schedule probe: ${record.schedule.status || "unknown"}${scheduleReason}`
      });
    }

    if (Array.isArray(record.errors) && record.errors.length) {
      note.createDiv({
        cls: "obsidian-sma-client-note-path",
        text: `Last error: ${record.errors[0].message}`
      });
    }

    if (smConcept) {
      note.createDiv({
        cls: "obsidian-sma-client-note-path",
        text: `SM Concept: ${smConcept.name} (${smConcept.smConceptId})`
      });
    }
    const commentSummary = this.plugin.getRecordCommentSummary(record);
    if (commentSummary) {
      note.createDiv({
        cls: "obsidian-sma-client-comment-summary",
        text: `评论：${commentSummary}`,
        attr: { title: record.comment || "" }
      });
    }
    const actions = note.createDiv({ cls: "obsidian-sma-client-actions" });
    this.createButton(actions, "Open", async () => {
      await this.plugin.openNoteByPath(record.path);
    });
    this.createButton(actions, "注册/刷新", async () => {
      await this.plugin.syncRecordById(record.noteId, true);
    });
    this.createButton(actions, record.enrolled ? "Unenroll" : "Re-enroll", async () => {
      if (record.enrolled) {
        new ConfirmActionModal(this.app, {
          title: "确认 Unenroll",
          description: record.path,
          warning: record.smId
            ? "这会同时删除 SuperMemo 中对应的 item。"
            : "这会把当前条目标记为未注册。",
          confirmText: "确认删除",
          cancelText: "取消",
          onConfirm: async () => {
            await this.plugin.unenrollRecord(record.noteId, true);
          }
        }).open();
      } else {
        await this.plugin.reenrollRecord(record.noteId, true);
      }
    });
    this.createButton(actions, record.comment ? "编辑评论" : "添加评论", async () => {
      await this.plugin.editRecordComment(record.noteId, true);
    });

    const conceptRow = note.createDiv({ cls: "obsidian-sma-client-review-row" });
    conceptRow.createDiv({ cls: "obsidian-sma-client-review-label", text: "SM Concept" });
    const conceptButton = conceptRow.createEl("button", {
      text: smConcept
        ? `${smConcept.name} (${smConcept.smConceptId})`
        : "选择 SM Concept"
    });
    conceptButton.addEventListener("click", () => {
      new SmConceptPickerModal(this.app, this.plugin, {
        title: "给条目赋予 SuperMemo Concept",
        description: record.path,
        allowClear: true,
        onPick: async (smConceptId) => {
          await this.plugin.assignSmConceptToRecord(record.noteId, smConceptId, true);
        }
      }).open();
    });
    return note;
  }

  createBadge(container, label, modifier) {
    const cls = modifier ? `obsidian-sma-client-badge ${modifier}` : "obsidian-sma-client-badge";
    container.createDiv({ cls, text: label });
  }

  createConceptBadge(container, concept) {
    const badge = container.createDiv({
      cls: "obsidian-sma-client-badge -concept",
      text: this.plugin.getConceptLabel(concept)
    });
    if (concept.accentColor) {
      badge.style.setProperty("--sm-concept-accent", concept.accentColor);
    }
  }
}

class SmaRecordCommentModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.options = options;
    this.result = null;
    this.textareaEl = null;
    this.waiter = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  onOpen() {
    const { contentEl } = this;
    const {
      title = "条目评论",
      description = "",
      value = ""
    } = this.options;
    this.result = null;
    this.textareaEl = null;
    contentEl.empty();
    this.modalEl.style.maxWidth = "960px";
    this.modalEl.style.width = "92vw";
    this.modalEl.style.height = "76vh";
    contentEl.style.display = "flex";
    contentEl.style.flexDirection = "column";
    contentEl.style.height = "100%";
    contentEl.style.gap = "10px";
    contentEl.createEl("h3", { text: title });
    if (description) {
      contentEl.createEl("div", {
        text: description,
        cls: "obsidian-sma-client-modal-desc"
      });
    }
    const textarea = contentEl.createEl("textarea", {
      text: value,
      cls: "obsidian-sma-client-comment-textarea"
    });
    this.textareaEl = textarea;
    textarea.placeholder = "记录补充信息、执行细节、上下文判断...";
    textarea.focus();
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.value.length;
    const counter = contentEl.createEl("div", { cls: "obsidian-sma-client-comment-counter" });
    const updateCounter = () => {
      counter.setText(`${textarea.value.length} 字`);
    };
    textarea.addEventListener("input", updateCounter);
    updateCounter();
    const actions = contentEl.createDiv({ cls: "obsidian-sma-client-modal-actions" });
    const clearBtn = actions.createEl("button", { text: "清空评论" });
    clearBtn.onclick = () => {
      this.result = { action: "clear" };
      this.close();
    };
    const closeBtn = actions.createEl("button", { text: "关闭窗口", cls: "mod-cta" });
    closeBtn.onclick = () => {
      this.result = {
        action: "save",
        value: String(this.textareaEl?.value || "")
      };
      this.close();
    };
  }

  onClose() {
    if (!this.result) {
      this.result = {
        action: "save",
        value: String(this.textareaEl?.value || "")
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
    if (this._resolve) {
      this._resolve(this.result);
      this._resolve = null;
    }
  }

  waitForResult() {
    this.open();
    return this.waiter;
  }
}

class ObsidianSmaClientSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian SMA Client" });

    new Setting(containerEl)
      .setName("Bridge Base URL")
      .setDesc("SMA bridge 本地 HTTP 地址。")
      .addText((text) => text
        .setPlaceholder(DEFAULT_SETTINGS.bridgeBaseUrl)
        .setValue(this.plugin.state.settings.bridgeBaseUrl)
        .onChange(async (value) => {
          this.plugin.state.settings.bridgeBaseUrl = value.trim() || DEFAULT_SETTINGS.bridgeBaseUrl;
          await this.plugin.persistState();
        }));

    new Setting(containerEl)
      .setName("Bridge Token")
      .setDesc("SMA bridge Bearer token。")
      .addText((text) => text
        .setPlaceholder(DEFAULT_SETTINGS.bridgeToken)
        .setValue(this.plugin.state.settings.bridgeToken)
        .onChange(async (value) => {
          this.plugin.state.settings.bridgeToken = value.trim();
          await this.plugin.persistState();
        }));

    new Setting(containerEl)
      .setName("Request timeout")
      .setDesc("HTTP 请求超时时间，单位毫秒。")
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.requestTimeoutMs))
        .setValue(String(this.plugin.state.settings.requestTimeoutMs))
        .onChange(async (value) => {
          const parsed = Number(value);
          this.plugin.state.settings.requestTimeoutMs = Number.isFinite(parsed) && parsed > 0
            ? parsed
            : DEFAULT_SETTINGS.requestTimeoutMs;
          await this.plugin.persistState();
        }));

    new Setting(containerEl)
      .setName("Auto sync on startup")
      .setDesc("插件启动后自动同步当前已 enroll 的笔记。")
      .addToggle((toggle) => toggle
        .setValue(Boolean(this.plugin.state.settings.autoSyncOnStartup))
        .onChange(async (value) => {
          this.plugin.state.settings.autoSyncOnStartup = Boolean(value);
          await this.plugin.persistState();
        }));

    new Setting(containerEl)
      .setName("Auto register on enroll")
      .setDesc("手动 enroll 当前笔记时，立即触发 register/status 同步。")
      .addToggle((toggle) => toggle
        .setValue(Boolean(this.plugin.state.settings.autoRegisterOnEnroll))
        .onChange(async (value) => {
          this.plugin.state.settings.autoRegisterOnEnroll = Boolean(value);
          await this.plugin.persistState();
        }));

    new Setting(containerEl)
      .setName("Import frontmatter key")
      .setDesc("一次性导入旧 frontmatter 成员时识别的字段名。")
      .addText((text) => text
        .setPlaceholder(DEFAULT_SETTINGS.importFrontmatterKey)
        .setValue(this.plugin.state.settings.importFrontmatterKey)
        .onChange(async (value) => {
          this.plugin.state.settings.importFrontmatterKey = value.trim() || DEFAULT_SETTINGS.importFrontmatterKey;
          await this.plugin.persistState();
        }));

    new Setting(containerEl)
      .setName("Due lookahead days")
      .setDesc("把未来 N 天内的 nextReview 也纳入今日队列。0 表示只看今天及逾期。")
      .addText((text) => text
        .setPlaceholder(String(DEFAULT_SETTINGS.dueLookaheadDays))
        .setValue(String(this.plugin.state.settings.dueLookaheadDays))
        .onChange(async (value) => {
          const parsed = Number(value);
          this.plugin.state.settings.dueLookaheadDays = Number.isFinite(parsed) && parsed >= 0
            ? Math.floor(parsed)
            : DEFAULT_SETTINGS.dueLookaheadDays;
          await this.plugin.persistState();
        }));
  }
}

module.exports = class ObsidianSmaClientPlugin extends Plugin {
  async onload() {
    this.views = new Set();
    this.state = await this.loadState();
    if (this.stateMigrationDirty) {
      await this.saveData(this.state);
    }
    this.client = new SmaBridgeClient(this);
    this.lastMarkdownPath = null;

    this.registerView(
      VIEW_TYPE_SMA_CLIENT,
      (leaf) => new ObsidianSmaClientView(leaf, this)
    );

    this.addRibbonIcon("database", "Open SMA panel", async () => {
      await this.activateView();
    });

    this.addCommand({
      id: "open-sma-panel",
      name: "Open SMA panel",
      callback: async () => {
        await this.activateView();
      }
    });

    this.addCommand({
      id: "enroll-current-note",
      name: "Enroll current note",
      callback: async () => {
        await this.enrollCurrentNote({ autoSync: true });
      }
    });

    this.addCommand({
      id: "sync-enrolled-notes",
      name: "Sync enrolled notes",
      callback: async () => {
        await this.syncEnrolledNotes({ interactive: true });
      }
    });

    this.addCommand({
      id: "refresh-current-note-status",
      name: "Refresh current note status",
      callback: async () => {
        const file = this.getCurrentMarkdownFile();
        if (!file) {
          new Notice("No active Markdown note.");
          return;
        }
        const record = this.ensureRecord(file, false);
        await this.syncRecordById(record.noteId, true);
      }
    });

    this.addCommand({
      id: "import-srs-frontmatter-members",
      name: "Import notes with srs:true into plugin JSON",
      callback: async () => {
        await this.importFrontmatterMembers(true);
      }
    });

    this.addSettingTab(new ObsidianSmaClientSettingTab(this.app, this));

    this.registerEvent(this.app.vault.on("rename", async (file, oldPath) => {
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }
      await this.handleRename(file, oldPath);
    }));

    this.registerEvent(this.app.vault.on("delete", async (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") {
        return;
      }
      await this.handleDelete(file);
    }));

    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file instanceof TFile && file.extension === "md") {
        this.lastMarkdownPath = file.path;
      }
    }));

    if (this.state.settings.autoSyncOnStartup) {
      window.setTimeout(() => {
        this.syncEnrolledNotes({ interactive: false }).catch((error) => {
          console.error("[ObsidianSmaClient][startupSync]", error);
        });
      }, 1200);
    }
  }

  async onunload() {
    await this.app.workspace.detachLeavesOfType(VIEW_TYPE_SMA_CLIENT);
    this.views.clear();
  }

  async loadState() {
    const loaded = await this.loadData();
    const state = createInitialState();
    if (!loaded || typeof loaded !== "object") {
      const sharedConcepts = this.loadSharedConcepts();
      if (sharedConcepts) {
        state.conceptsById = sharedConcepts;
      }
      return state;
    }

    state.version = loaded.version || 1;
    state.conceptsById = this.loadSharedConcepts()
      || (loaded.conceptsById && typeof loaded.conceptsById === "object" ? loaded.conceptsById : {});
    state.smConceptsById = loaded.smConceptsById && typeof loaded.smConceptsById === "object" ? loaded.smConceptsById : {};
    state.conceptMappings = loaded.conceptMappings && typeof loaded.conceptMappings === "object" ? loaded.conceptMappings : {};
    state.settings = cloneSettings(loaded.settings);
    state.notesById = loaded.notesById && typeof loaded.notesById === "object" ? loaded.notesById : {};
    state.pathIndex = loaded.pathIndex && typeof loaded.pathIndex === "object" ? loaded.pathIndex : {};
    state.smIndex = loaded.smIndex && typeof loaded.smIndex === "object" ? loaded.smIndex : {};
    Object.values(state.notesById).forEach((record) => {
      if (!record || typeof record !== "object") {
        return;
      }
      record.comment = typeof record.comment === "string" ? record.comment : "";
    });
    state.audit = {
      ...state.audit,
      ...(loaded.audit || {})
    };
    state.ui = {
      ...state.ui,
      ...(loaded.ui || {})
    };
    state.ui.selectedSmConceptId = normalizePositiveInt(state.ui.selectedSmConceptId);
    state.ui.scrollByFilter = state.ui.scrollByFilter && typeof state.ui.scrollByFilter === "object"
      ? state.ui.scrollByFilter
      : {};
    state.ui.recordTreeByFilter = state.ui.recordTreeByFilter && typeof state.ui.recordTreeByFilter === "object"
      ? state.ui.recordTreeByFilter
      : {};
    state.ui.smConceptTree = state.ui.smConceptTree && typeof state.ui.smConceptTree === "object"
      ? state.ui.smConceptTree
      : {};
    if (!["records", "smconcepts"].includes(state.ui.activeTab)) {
      state.ui.activeTab = "records";
    }
    state.reviewSession = {
      date: formatDateOnly(new Date()),
      completedByNoteId: {},
      ...(loaded.reviewSession || {})
    };
    this.normalizeReviewSession(state);
    this.stateMigrationDirty = this.migrateStateToSmConceptBinding(state);
    this.rebuildIndexes(state);
    return state;
  }

  async persistState() {
    this.rebuildIndexes(this.state);
    await this.saveData(this.state);
    await this.refreshViews();
  }

  normalizeSharedConcept(concept) {
    if (!concept || typeof concept !== "object") {
      return null;
    }
    const keyword = String(concept.keyword || concept.label || "").trim();
    if (!keyword) {
      return null;
    }
    const id = concept.id || generateConceptId(keyword);
    return {
      ...concept,
      id,
      keyword,
      parentId: concept.parentId || null,
      order: Number.isFinite(Number(concept.order)) ? Number(concept.order) : 0,
      colorType: concept.colorType || (concept.parentId ? "plus" : "yaml"),
      accentColor: concept.accentColor || "",
      note: typeof concept.note === "string" ? concept.note : "",
      createdAt: concept.createdAt || nowIso()
    };
  }

  loadSharedConcepts() {
    try {
      const raw = localStorage.getItem(SHARED_CONCEPT_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      const source = parsed && typeof parsed === "object" ? parsed.concepts : null;
      if (!source || typeof source !== "object") {
        return null;
      }
      const normalized = {};
      Object.values(source).forEach((concept) => {
        const next = this.normalizeSharedConcept(concept);
        if (next) {
          normalized[next.id] = next;
        }
      });
      const ids = new Set(Object.keys(normalized));
      Object.values(normalized).forEach((concept) => {
        if (concept.parentId && !ids.has(concept.parentId)) {
          concept.parentId = null;
        }
      });
      return normalized;
    } catch (error) {
      console.error("[ObsidianSmaClient][loadSharedConcepts]", error);
      return null;
    }
  }

  refreshConceptsFromSharedStore(interactive) {
    const shared = this.loadSharedConcepts();
    if (!shared) {
      if (interactive) {
        new Notice("没有找到共享 concept 数据。");
      }
      return false;
    }
    this.state.conceptsById = shared;
    if (interactive) {
      new Notice(`已读取共享 concept：${Object.keys(shared).length} 个。`);
    }
    return true;
  }

  normalizeSmConcept(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const smConceptId = raw.smConceptId != null ? Number(raw.smConceptId) : Number(raw.id);
    const name = String(raw.name || raw.keyword || "").trim();
    if (!Number.isFinite(smConceptId) || smConceptId <= 0 || !name) {
      return null;
    }
    return {
      smConceptId,
      name,
      elementId: raw.elementId != null ? Number(raw.elementId) : null,
      useCount: raw.useCount != null ? Number(raw.useCount) : null,
      created: Boolean(raw.created),
      pulledAt: raw.pulledAt || nowIso()
    };
  }

  async refreshSmConcepts(interactive) {
    try {
      const response = await this.client.concepts();
      const items = response.data && Array.isArray(response.data.items) ? response.data.items : [];
      const next = {};
      items.forEach((item) => {
        const concept = this.normalizeSmConcept(item);
        if (concept) {
          next[String(concept.smConceptId)] = concept;
        }
      });
      this.state.smConceptsById = next;
      await this.persistState();
      if (interactive) {
        new Notice(`已拉取 SuperMemo Concepts：${Object.keys(next).length} 个。`);
      }
      return next;
    } catch (error) {
      if (interactive) {
        new Notice(`拉取 SuperMemo Concepts 失败：${error.message}`);
      }
      throw error;
    }
  }

  async ensureSmConceptForLocalConcept(conceptId, interactive) {
    const concept = this.state.conceptsById[conceptId];
    if (!concept) {
      if (interactive) {
        new Notice("本地 Concept 不存在。");
      }
      return null;
    }
    const response = await this.client.ensureConcept({
      name: this.getConceptLabel(concept)
    });
    const smConcept = this.normalizeSmConcept(response.data || {});
    if (!smConcept) {
      throw new Error("SMA bridge returned an invalid concept payload.");
    }
    this.state.smConceptsById[String(smConcept.smConceptId)] = smConcept;
    await this.bindSmConceptToObsidianConcept(
      conceptId,
      smConcept.smConceptId,
      false,
      smConcept.created ? "ensure-created" : "ensure-existing"
    );
    if (interactive) {
      new Notice(`已绑定 SM Concept：${smConcept.name}`);
    }
    return smConcept;
  }

  async bindSmConceptToObsidianConcept(conceptId, smConceptId, interactive, bindMode = "manual") {
    if (!this.state.conceptsById[conceptId]) {
      throw new Error("Obsidian concept not found.");
    }
    const concept = this.getSmConceptById(smConceptId);
    if (!concept) {
      throw new Error("SuperMemo concept not found.");
    }
    this.state.conceptMappings[conceptId] = {
      smConceptId: concept.smConceptId,
      bindMode,
      boundAt: nowIso(),
      note: ""
    };
    Object.values(this.state.notesById || {}).forEach((record) => {
      if (!record || normalizePositiveInt(record.smConceptId)) {
        return;
      }
      if (record.legacyConceptId === conceptId || record.conceptId === conceptId) {
        record.smConceptId = concept.smConceptId;
        record.needsSmConcept = false;
        record.pendingConceptSync = this.isRecordConceptPendingSync(record);
      }
    });
    await this.persistState();
    if (interactive) {
      new Notice(`已映射：${this.getConceptPathLabel(conceptId)} → ${concept.name}`);
    }
  }

  async clearSmConceptMapping(conceptId, interactive) {
    if (this.state.conceptMappings && this.state.conceptMappings[conceptId]) {
      delete this.state.conceptMappings[conceptId];
      await this.persistState();
      if (interactive) {
        new Notice(`已取消映射：${this.getConceptPathLabel(conceptId)}`);
      }
    }
  }

  async runConceptLearningProbe(smConceptId, payload, interactive) {
    const concept = this.getSmConceptById(smConceptId);
    if (!concept) {
      if (interactive) {
        new Notice("SuperMemo concept 不存在。");
      }
      return null;
    }
    try {
      const response = await this.client.conceptLearningProbe(concept.smConceptId, payload || {
        mode: "set-current-only",
        effectful: false
      });
      if (interactive) {
        const verdict = response.data && response.data.verdict ? response.data.verdict : response.message;
        const suffix = response.data && response.data.warning ? `；${response.data.warning}` : "";
        new Notice(`Concept probe: ${verdict}${suffix}`);
      }
      return response;
    } catch (error) {
      if (interactive) {
        new Notice(`Concept probe failed: ${error.message}`);
      }
      throw error;
    }
  }

  getConceptMapping(conceptId) {
    return conceptId && this.state.conceptMappings
      ? this.state.conceptMappings[conceptId] || null
      : null;
  }

  getMappedSmConcept(conceptId) {
    const mapping = this.getConceptMapping(conceptId);
    if (!mapping || mapping.smConceptId == null) {
      return null;
    }
    return this.state.smConceptsById[String(mapping.smConceptId)] || null;
  }

  getSmConceptById(smConceptId) {
    const normalized = normalizePositiveInt(smConceptId);
    return normalized ? this.state.smConceptsById[String(normalized)] || null : null;
  }

  getSmConceptList() {
    return Object.values(this.state.smConceptsById || {}).sort((left, right) => {
      const labelLeft = `${left.name || ""} ${left.smConceptId || ""}`;
      const labelRight = `${right.name || ""} ${right.smConceptId || ""}`;
      return labelLeft.localeCompare(labelRight, "zh-CN");
    });
  }

  getTreeStore(kind, scopeKey) {
    if (!this.state.ui) {
      this.state.ui = {};
    }
    if (kind === "record") {
      if (!this.state.ui.recordTreeByFilter || typeof this.state.ui.recordTreeByFilter !== "object") {
        this.state.ui.recordTreeByFilter = {};
      }
      const key = scopeKey || "all";
      if (!this.state.ui.recordTreeByFilter[key] || typeof this.state.ui.recordTreeByFilter[key] !== "object") {
        this.state.ui.recordTreeByFilter[key] = {};
      }
      return this.state.ui.recordTreeByFilter[key];
    }
    if (!this.state.ui.smConceptTree || typeof this.state.ui.smConceptTree !== "object") {
      this.state.ui.smConceptTree = {};
    }
    return this.state.ui.smConceptTree;
  }

  getTreeEntry(kind, scopeKey, itemId) {
    const store = this.getTreeStore(kind, scopeKey);
    const id = String(itemId || "");
    if (!store[id] || typeof store[id] !== "object") {
      store[id] = { parentId: null, order: 0, collapsed: false };
    }
    return store[id];
  }

  getTreeRoots(kind, scopeKey, items, getId) {
    const visibleIds = new Set(items.map((item) => String(getId(item))));
    return items
      .filter((item) => {
        const entry = this.getTreeEntry(kind, scopeKey, getId(item));
        return !entry.parentId || !visibleIds.has(String(entry.parentId));
      })
      .sort((left, right) => this.compareTreeItems(kind, scopeKey, left, right, getId));
  }

  getTreeChildren(kind, scopeKey, parentId, items, getId) {
    return items
      .filter((item) => String(this.getTreeEntry(kind, scopeKey, getId(item)).parentId || "") === String(parentId || ""))
      .sort((left, right) => this.compareTreeItems(kind, scopeKey, left, right, getId));
  }

  compareTreeItems(kind, scopeKey, left, right, getId) {
    const leftEntry = this.getTreeEntry(kind, scopeKey, getId(left));
    const rightEntry = this.getTreeEntry(kind, scopeKey, getId(right));
    const orderDiff = (Number(leftEntry.order) || 0) - (Number(rightEntry.order) || 0);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    const leftLabel = kind === "record" ? this.getRecordDisplayTitle(left) : (left.name || String(left.smConceptId || ""));
    const rightLabel = kind === "record" ? this.getRecordDisplayTitle(right) : (right.name || String(right.smConceptId || ""));
    return leftLabel.localeCompare(rightLabel, "zh-CN");
  }

  isTreeItemCollapsed(kind, scopeKey, itemId) {
    return !!this.getTreeEntry(kind, scopeKey, itemId).collapsed;
  }

  async toggleTreeItemCollapsed(kind, scopeKey, itemId) {
    const entry = this.getTreeEntry(kind, scopeKey, itemId);
    entry.collapsed = !entry.collapsed;
    await this.persistState();
  }

  async moveTreeItem(kind, scopeKey, draggedId, targetId, position) {
    const dragged = String(draggedId || "");
    const target = String(targetId || "");
    if (!dragged || !target || dragged === target) {
      return;
    }
    const store = this.getTreeStore(kind, scopeKey);
    const draggedEntry = this.getTreeEntry(kind, scopeKey, dragged);
    const targetEntry = this.getTreeEntry(kind, scopeKey, target);
    if (position === "child") {
      if (this.treeContains(kind, scopeKey, dragged, target)) {
        new Notice("不能把父级拖到自己的子级下面。");
        return;
      }
      draggedEntry.parentId = target;
      draggedEntry.order = this.getNextTreeOrder(store, target);
    } else {
      draggedEntry.parentId = targetEntry.parentId || null;
      const siblings = Object.entries(store)
        .filter(([, entry]) => String(entry.parentId || "") === String(draggedEntry.parentId || ""))
        .map(([id]) => id)
        .filter((id) => id !== dragged);
      const targetIndex = Math.max(0, siblings.indexOf(target));
      siblings.splice(position === "before" ? targetIndex : targetIndex + 1, 0, dragged);
      siblings.forEach((id, index) => {
        this.getTreeEntry(kind, scopeKey, id).order = index;
      });
    }
    await this.persistState();
  }

  async moveTreeItemToRoot(kind, scopeKey, itemId) {
    const entry = this.getTreeEntry(kind, scopeKey, itemId);
    entry.parentId = null;
    entry.order = this.getNextTreeOrder(this.getTreeStore(kind, scopeKey), null);
    await this.persistState();
  }

  getNextTreeOrder(store, parentId) {
    const orders = Object.values(store)
      .filter((entry) => String(entry.parentId || "") === String(parentId || ""))
      .map((entry) => Number(entry.order) || 0);
    return orders.length ? Math.max(...orders) + 1 : 0;
  }

  treeContains(kind, scopeKey, ancestorId, possibleChildId) {
    const store = this.getTreeStore(kind, scopeKey);
    let cursor = String(possibleChildId || "");
    const guard = new Set();
    while (cursor && !guard.has(cursor)) {
      if (cursor === String(ancestorId || "")) {
        return true;
      }
      guard.add(cursor);
      cursor = store[cursor] ? String(store[cursor].parentId || "") : "";
    }
    return false;
  }

  getMappedObsidianConceptPathsForSmConcept(smConceptId) {
    const normalized = normalizePositiveInt(smConceptId);
    if (!normalized) {
      return [];
    }
    const matches = [];
    Object.entries(this.state.conceptMappings || {}).forEach(([conceptId, mapping]) => {
      if (normalizePositiveInt(mapping && mapping.smConceptId) === normalized && this.state.conceptsById[conceptId]) {
        matches.push(this.getConceptPathLabel(conceptId));
      }
    });
    return Array.from(new Set(matches)).sort((left, right) => left.localeCompare(right, "zh-CN"));
  }

  getRecordPrimarySmConceptId(record) {
    return record ? normalizePositiveInt(record.smConceptId) : null;
  }

  getRecordParentElementId(record) {
    const smConceptId = this.getRecordPrimarySmConceptId(record);
    const smConcept = smConceptId ? this.getSmConceptById(smConceptId) : null;
    return smConcept ? normalizePositiveInt(smConcept.elementId) : null;
  }

  getSelectedConceptEnrollmentBinding() {
    const smConceptId = this.state.ui && this.state.ui.selectedSmConceptId
      ? normalizePositiveInt(this.state.ui.selectedSmConceptId)
      : null;
    if (!smConceptId) {
      return null;
    }
    const smConcept = smConceptId ? this.getSmConceptById(smConceptId) : null;
    const parentId = smConcept ? normalizePositiveInt(smConcept.elementId) : null;
    if (!smConcept) {
      return null;
    }
    return {
      conceptId: null,
      smConceptId,
      parentId,
      smConcept
    };
  }

  isRecordConceptPendingSync(record) {
    if (!record || !record.smId) {
      return false;
    }
    return this.getRecordPrimarySmConceptId(record) !== normalizePositiveInt(record.primarySmConceptId);
  }

  migrateStateToSmConceptBinding(state) {
    let changed = false;
    Object.values(state.notesById || {}).forEach((record) => {
      if (!record || typeof record !== "object") {
        return;
      }

      const smConceptId = normalizePositiveInt(record.smConceptId);
      const primarySmConceptId = normalizePositiveInt(record.primarySmConceptId);
      const legacyConceptId = typeof record.legacyConceptId === "string" && record.legacyConceptId
        ? record.legacyConceptId
        : (record.conceptId || null);

      if (record.legacyConceptId !== legacyConceptId) {
        record.legacyConceptId = legacyConceptId;
        changed = true;
      }

      let resolvedSmConceptId = smConceptId;
      if (!resolvedSmConceptId && primarySmConceptId) {
        resolvedSmConceptId = primarySmConceptId;
      }
      if (!resolvedSmConceptId && record.conceptId) {
        const mapping = state.conceptMappings && state.conceptMappings[record.conceptId];
        const mappedSmConceptId = normalizePositiveInt(mapping && mapping.smConceptId);
        if (mappedSmConceptId) {
          resolvedSmConceptId = mappedSmConceptId;
        }
      }

      if ((record.smConceptId || null) !== resolvedSmConceptId) {
        record.smConceptId = resolvedSmConceptId;
        changed = true;
      }

      const needsSmConcept = !resolvedSmConceptId && record.enrolled !== false;
      if (Boolean(record.needsSmConcept) !== needsSmConcept) {
        record.needsSmConcept = needsSmConcept;
        changed = true;
      }

      const shouldPendingSync = this.isRecordConceptPendingSync(record);
      if (Boolean(record.pendingConceptSync) !== shouldPendingSync) {
        record.pendingConceptSync = shouldPendingSync;
        changed = true;
      }
    });

    return changed;
  }

  rebuildIndexes(state) {
    const rebuiltPathIndex = {};
    const rebuiltSmIndex = {};
    const notesById = state.notesById || {};
    Object.keys(notesById).forEach((noteId) => {
      const record = notesById[noteId];
      if (!record || !record.path) {
        return;
      }
      rebuiltPathIndex[record.path] = noteId;
      if (record.smId) {
        rebuiltSmIndex[String(record.smId)] = noteId;
      }
    });
    state.pathIndex = rebuiltPathIndex;
    state.smIndex = rebuiltSmIndex;
  }

  normalizeReviewSession(state) {
    const today = formatDateOnly(new Date());
    if (!state.reviewSession || typeof state.reviewSession !== "object") {
      state.reviewSession = {
        date: today,
        completedByNoteId: {}
      };
      return;
    }
    if (state.reviewSession.date !== today) {
      state.reviewSession = {
        date: today,
        completedByNoteId: {}
      };
      return;
    }
    if (!state.reviewSession.completedByNoteId || typeof state.reviewSession.completedByNoteId !== "object") {
      state.reviewSession.completedByNoteId = {};
    }
  }

  registerViewInstance(view) {
    this.views.add(view);
  }

  unregisterViewInstance(view) {
    this.views.delete(view);
  }

  async refreshViews() {
    for (const view of this.views) {
      await view.refresh();
    }
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_SMA_CLIENT)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({
        type: VIEW_TYPE_SMA_CLIENT,
        active: true
      });
    }
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  getCurrentMarkdownFile() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.file) {
      return view.file;
    }
    if (this.lastMarkdownPath) {
      const file = this.app.vault.getAbstractFileByPath(this.lastMarkdownPath);
      if (file instanceof TFile && file.extension === "md") {
        return file;
      }
    }
    return this.app.workspace.getActiveFile();
  }

  getSortedRecords() {
    return Object.values(this.state.notesById)
      .sort((left, right) => {
        const leftValue = left.path || "";
        const rightValue = right.path || "";
        return leftValue.localeCompare(rightValue, "zh-CN");
      });
  }

  getConceptList() {
    return Object.values(this.state.conceptsById || {}).sort((left, right) => {
      return this.getConceptPathLabel(left.id).localeCompare(this.getConceptPathLabel(right.id), "zh-CN");
    });
  }

  getConceptChildren(parentId) {
    return Object.values(this.state.conceptsById || {})
      .filter((concept) => (concept.parentId || null) === (parentId || null))
      .sort((left, right) => {
        const orderDiff = (left.order || 0) - (right.order || 0);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return this.getConceptLabel(left).localeCompare(this.getConceptLabel(right), "zh-CN");
      });
  }

  getConceptLabel(concept) {
    return concept ? (concept.keyword || concept.label || concept.id || "未命名") : "未命名";
  }

  getConceptPathLabel(conceptId) {
    if (!conceptId || !this.state.conceptsById[conceptId]) {
      return "";
    }
    const labels = [];
    let current = this.state.conceptsById[conceptId];
    const guard = new Set();
    while (current && !guard.has(current.id)) {
      labels.unshift(this.getConceptLabel(current));
      guard.add(current.id);
      current = current.parentId ? this.state.conceptsById[current.parentId] : null;
    }
    return labels.join(" > ");
  }

  getCurrentRecordListScrollKey() {
    const selectedSmConceptId = this.state.ui && this.state.ui.selectedSmConceptId
      ? normalizePositiveInt(this.state.ui.selectedSmConceptId)
      : null;
    return selectedSmConceptId ? "sm:" + selectedSmConceptId : "all";
  }

  rememberRecordListScroll(key, scrollTop) {
    if (!this.state.ui) {
      this.state.ui = {};
    }
    if (!this.state.ui.scrollByFilter || typeof this.state.ui.scrollByFilter !== "object") {
      this.state.ui.scrollByFilter = {};
    }
    this.state.ui.scrollByFilter[key || "all"] = Math.max(0, Math.round(Number(scrollTop) || 0));
    if (this.scrollPersistTimer) {
      window.clearTimeout(this.scrollPersistTimer);
    }
    this.scrollPersistTimer = window.setTimeout(() => {
      this.persistState();
    }, 400);
  }

  restoreRecordListScroll(list, key) {
    const saved = this.state.ui && this.state.ui.scrollByFilter
      ? Number(this.state.ui.scrollByFilter[key || "all"])
      : 0;
    if (!Number.isFinite(saved) || saved <= 0) {
      return;
    }
    window.requestAnimationFrame(() => {
      list.scrollTop = Math.max(0, saved);
    });
  }

  getRecordDisplayTitle(record) {
    if (!record) {
      return "未命名";
    }
    const file = record.path ? this.app.vault.getAbstractFileByPath(record.path) : null;
    if (file instanceof TFile && file.basename && !hasMojibake(file.basename)) {
      return file.basename;
    }
    const pathBasename = getBasenameFromPath(record.path);
    if (pathBasename && !hasMojibake(pathBasename)) {
      return pathBasename;
    }
    if (record.basename && !hasMojibake(record.basename)) {
      return record.basename;
    }
    if (record.smTitle && !hasMojibake(record.smTitle)) {
      return record.smTitle;
    }
    return pathBasename || record.basename || record.smTitle || record.path || "未命名";
  }

  getRecordCommentSummary(record) {
    return record ? getCommentSummary(record.comment) : "";
  }

  async editRecordComment(noteId, interactive) {
    const record = this.state.notesById[noteId];
    if (!record) {
      if (interactive) {
        new Notice("条目不存在。");
      }
      return;
    }
    const result = await new SmaRecordCommentModal(this.app, {
      title: `条目评论：${this.getRecordDisplayTitle(record)}`,
      description: record.path,
      value: typeof record.comment === "string" ? record.comment : ""
    }).waitForResult();
    if (!result) {
      return;
    }
    if (result.action === "clear") {
      record.comment = "";
      await this.persistState();
      if (interactive) {
        new Notice("已清空评论。");
      }
      return;
    }
    record.comment = String(result.value || "");
    await this.persistState();
    if (interactive) {
      new Notice(record.comment.trim() ? "评论已保存。" : "评论为空，已清空。");
    }
  }

  getSelectedSmConcept() {
    const selectedSmConceptId = this.state.ui && this.state.ui.selectedSmConceptId
      ? normalizePositiveInt(this.state.ui.selectedSmConceptId)
      : null;
    return selectedSmConceptId ? this.getSmConceptById(selectedSmConceptId) : null;
  }

  filterRecordsBySelectedConcept(records) {
    return this.filterRecordsBySelectedSmConcept(records);
  }

  filterRecordsBySelectedSmConcept(records) {
    const selectedSmConceptId = this.state.ui && this.state.ui.selectedSmConceptId
      ? normalizePositiveInt(this.state.ui.selectedSmConceptId)
      : null;
    if (!selectedSmConceptId) {
      return records;
    }
    const visibleConceptIds = this.getTreeDescendantIds("smConcept", "all", selectedSmConceptId);
    visibleConceptIds.add(String(selectedSmConceptId));
    return records.filter((record) => visibleConceptIds.has(String(normalizePositiveInt(record.smConceptId) || "")));
  }

  getTreeDescendantIds(kind, scopeKey, itemId) {
    const store = this.getTreeStore(kind, scopeKey);
    const root = String(itemId || "");
    const result = new Set();
    const visit = (parentId) => {
      Object.entries(store).forEach(([id, entry]) => {
        if (String(entry.parentId || "") !== String(parentId || "") || result.has(id)) {
          return;
        }
        result.add(id);
        visit(id);
      });
    };
    visit(root);
    return result;
  }

  recordMatchesSmConceptId(record, smConceptId) {
    if (!record) {
      return false;
    }
    return normalizePositiveInt(record.smConceptId) === normalizePositiveInt(smConceptId);
  }

  getRecordsByConcept(conceptId) {
    return this.getRecordsBySmConcept(conceptId);
  }

  getRecordsBySmConcept(smConceptId) {
    const normalized = normalizePositiveInt(smConceptId);
    if (!normalized) {
      return [];
    }
    return this.getSortedRecords().filter((record) => this.recordMatchesSmConceptId(record, normalized));
  }

  getTodayQueueRecords() {
    return this.getSortedRecords().filter((record) => this.isDueRecord(record));
  }

  getPendingScheduleRecords() {
    return this.getSortedRecords().filter((record) => this.isPendingScheduleRecord(record));
  }

  isDueRecord(record) {
    if (!record || !record.enrolled || !record.smId) {
      return false;
    }
    const nextReview = record.schedule ? parseDateOnly(record.schedule.nextReview) : null;
    if (!nextReview) {
      return false;
    }
    const today = new Date();
    const threshold = addDays(new Date(today.getFullYear(), today.getMonth(), today.getDate()), this.state.settings.dueLookaheadDays || 0);
    return nextReview.getTime() <= threshold.getTime();
  }

  isPendingScheduleRecord(record) {
    if (!record || !record.enrolled || !record.smId) {
      return false;
    }
    return !(record.schedule && parseDateOnly(record.schedule.nextReview));
  }

  isCompletedToday(noteId) {
    this.normalizeReviewSession(this.state);
    return Boolean(this.state.reviewSession.completedByNoteId[noteId]);
  }

  getCompletedTodayRecords() {
    this.normalizeReviewSession(this.state);
    return this.getSortedRecords().filter((record) => this.isCompletedToday(record.noteId));
  }

  ensureRecord(file, enrolled = true) {
    const existingId = this.state.pathIndex[file.path];
    if (existingId && this.state.notesById[existingId]) {
      const record = this.state.notesById[existingId];
      record.basename = file.basename;
      record.contentFingerprint = {
        mtime: file.stat ? file.stat.mtime : null,
        size: file.stat ? file.stat.size : null
      };
      if (enrolled) {
        record.enrolled = true;
        if (!record.status || record.status === "removed") {
          record.status = record.smId ? "active" : "enrolled";
        }
      }
      return record;
    }

    const noteId = generateNoteId();
    const record = createRecord(file, noteId);
    record.enrolled = enrolled;
    if (!enrolled) {
      record.status = "removed";
    }
    this.state.notesById[noteId] = record;
    this.state.pathIndex[file.path] = noteId;
    return record;
  }

  recordError(record, error) {
    record.lastErrorAt = nowIso();
    const message = error instanceof Error ? error.message : String(error);
    record.errors = [
      {
        at: record.lastErrorAt,
        message
      },
      ...(Array.isArray(record.errors) ? record.errors : [])
    ].slice(0, 8);
  }

  clearError(record) {
    record.errors = [];
    record.lastErrorAt = null;
  }

  async runHealthCheck(interactive) {
    try {
      const response = await this.client.health();
      this.state.audit.lastHealthCheckAt = nowIso();
      await this.persistState();
      if (interactive) {
        new Notice(`SMA bridge OK: ${response.message || "health"}`);
      }
      return response;
    } catch (error) {
      if (interactive) {
        new Notice(`SMA bridge health failed: ${error.message}`);
      }
      throw error;
    }
  }

  async enrollCurrentNote(options) {
    const file = this.getCurrentMarkdownFile();
    if (!file) {
      new Notice("No active Markdown note.");
      return null;
    }

    await this.ensureEnrollFrontmatter(file);
    const record = this.ensureRecord(file, true);
    const selectedBinding = this.getSelectedConceptEnrollmentBinding();
    if (selectedBinding) {
      record.conceptId = null;
      record.legacyConceptId = null;
      record.smConceptId = selectedBinding.smConceptId;
      record.needsSmConcept = false;
      record.pendingConceptSync = this.isRecordConceptPendingSync(record);
    } else {
      record.needsSmConcept = !normalizePositiveInt(record.smConceptId);
    }
    record.status = record.smId ? "active" : "enrolled";
    await this.persistState();
    new Notice(`Enrolled: ${file.path}`);

    const autoSync = options && (options.autoSync || this.state.settings.autoRegisterOnEnroll);
    if (autoSync) {
      await this.syncRecordById(record.noteId, true);
    }
    return record;
  }

  async assignSmConceptToRecord(noteId, smConceptId, interactive) {
    const record = this.state.notesById[noteId];
    if (!record) {
      return;
    }
    const previous = {
      smConceptId: record.smConceptId,
      conceptId: record.conceptId,
      legacyConceptId: record.legacyConceptId,
      primarySmConceptId: record.primarySmConceptId,
      pendingConceptSync: record.pendingConceptSync,
      needsSmConcept: record.needsSmConcept,
      smId: record.smId,
      status: record.status
    };
    const nextSmConceptId = normalizePositiveInt(smConceptId);
    try {
      record.smConceptId = nextSmConceptId;
      record.conceptId = null;
      record.legacyConceptId = null;
      record.needsSmConcept = !record.smConceptId;
      record.pendingConceptSync = this.isRecordConceptPendingSync(record);

      let reparentResult = null;
      if (record.smId && record.pendingConceptSync && record.smConceptId) {
        reparentResult = await this.reparentRegisteredRecord(record, record.smConceptId);
      }

      await this.persistState();
      if (interactive) {
        const concept = this.getSmConceptById(record.smConceptId);
        const label = concept
          ? `${concept.name} (${concept.smConceptId})`
          : "未绑定";
        let suffix = "";
        if (reparentResult && reparentResult.strategy === "recreate-and-retire") {
          suffix = reparentResult.retiredOldElement === false
            ? "；已重建到新 Concept，但旧 SM item 删除失败，请在 SuperMemo 检查重复项"
            : "；SMA 不支持原地移动，已重建到新 Concept，复习历史从新 item 开始";
        }
        new Notice(`SM Concept 已更新：${label}${suffix}`);
      }
    } catch (error) {
      Object.assign(record, previous);
      this.recordError(record, error);
      await this.persistState();
      if (interactive) {
        new Notice(`SM Concept 改绑失败：${error.message}`);
      }
      throw error;
    }
  }

  async reparentRegisteredRecord(record, smConceptId) {
    const concept = this.getSmConceptById(smConceptId);
    const parentId = concept ? normalizePositiveInt(concept.elementId) : null;
    if (!concept || !parentId) {
      throw new Error("目标 SuperMemo Concept 缺少 elementId，无法移动已注册 item。请先重新拉取 SM Concept。");
    }

    const file = this.app.vault.getAbstractFileByPath(record.path);
    if (!(file instanceof TFile) || file.extension !== "md") {
      throw new Error(`Markdown file no longer exists: ${record.path}`);
    }

    const bodyMarkdown = await this.app.vault.cachedRead(file);
    const response = await this.client.reparent(record.smId, {
      title: file.basename || record.basename || record.path,
      path: file.path,
      bodyMarkdown,
      status: "active",
      parentId,
      primaryConceptId: smConceptId,
      recreateIfMoveUnsupported: true,
      retireMode: "delete"
    });
    const data = response.data || {};
    const nextSmId = data.smId || (data.element && data.element.id ? String(data.element.id) : null);
    if (nextSmId) {
      record.smId = String(nextSmId);
    }
    record.basename = file.basename;
    record.path = file.path;
    record.smConceptId = smConceptId;
    record.primarySmConceptId = smConceptId;
    record.pendingConceptSync = false;
    record.needsSmConcept = false;
    record.status = "active";
    record.lastSyncAt = nowIso();
    this.clearError(record);
    return data;
  }

  async unenrollRecord(noteId, interactive) {
    const record = this.state.notesById[noteId];
    if (!record) {
      return;
    }
    const previousSmId = record.smId;
    if (previousSmId) {
      try {
        await this.client.deleteElement(previousSmId);
      } catch (error) {
        this.recordError(record, error);
        await this.persistState();
        if (interactive) {
          new Notice(`Unenroll failed: ${error.message}`);
        }
        throw error;
      }
    }
    record.enrolled = false;
    record.status = "removed";
    record.smId = null;
    record.schedule = {
      nextReview: null,
      interval: null,
      repetitions: null,
      easiness: null,
      lastReview: null,
      status: null,
      reason: null,
      sources: null,
      diagnostics: null
    };
    record.reviewProbe = {
      lastProbedAt: null,
      lastRequestedGrade: null,
      lastVerdict: null,
      lastResponse: null
    };
    this.normalizeReviewSession(this.state);
    delete this.state.reviewSession.completedByNoteId[noteId];
    this.clearError(record);
    await this.persistState();
    if (interactive) {
      new Notice(previousSmId ? `Unenrolled and deleted from SMA: ${record.path}` : `Unenrolled: ${record.path}`);
    }
  }

  async reenrollRecord(noteId, interactive) {
    const record = this.state.notesById[noteId];
    if (!record) {
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(record.path);
    if (file instanceof TFile && file.extension === "md") {
      await this.ensureEnrollFrontmatter(file);
    }
    record.enrolled = true;
    record.status = record.smId ? "active" : "enrolled";
    await this.persistState();
    if (interactive) {
      new Notice(`Re-enrolled: ${record.path}`);
    }
  }

  async syncEnrolledNotes(options) {
    const records = this.getSortedRecords().filter((record) => record.enrolled);
    if (!records.length) {
      if (options && options.interactive) {
        new Notice("No enrolled notes.");
      }
      return;
    }

    try {
      await this.runHealthCheck(false);
    } catch (error) {
      if (options && options.interactive) {
        new Notice(`Health check failed: ${error.message}`);
      }
      throw error;
    }

    let synced = 0;
    for (const record of records) {
      try {
        await this.syncRecord(record);
        synced += 1;
      } catch (error) {
        console.error("[ObsidianSmaClient][syncRecord]", record.path, error);
      }
    }

    this.state.audit.lastFullScanAt = nowIso();
    this.state.audit.lastSuccessfulSyncAt = nowIso();
    await this.persistState();

    if (options && options.interactive) {
      new Notice(`SMA sync finished: ${synced}/${records.length}`);
    }
  }

  async syncRecordById(noteId, interactive) {
    const record = this.state.notesById[noteId];
    if (!record) {
      if (interactive) {
        new Notice("Record not found.");
      }
      return;
    }
    try {
      await this.syncRecord(record);
      await this.persistState();
      if (interactive) {
        new Notice(`Synced: ${record.path}`);
      }
    } catch (error) {
      await this.persistState();
      if (interactive) {
        new Notice(`Sync failed: ${error.message}`);
      }
      throw error;
    }
  }

  async syncRecord(record) {
    try {
      const file = this.app.vault.getAbstractFileByPath(record.path);
      if (!(file instanceof TFile) || file.extension !== "md") {
        record.status = "missing";
        this.recordError(record, new Error("Markdown file no longer exists."));
        return;
      }

      record.basename = file.basename;
      record.contentFingerprint = {
        mtime: file.stat ? file.stat.mtime : null,
        size: file.stat ? file.stat.size : null
      };

      if (!record.smId) {
        const bodyMarkdown = await this.app.vault.cachedRead(file);
        const primaryConceptId = this.getRecordPrimarySmConceptId(record);
        const parentId = this.getRecordParentElementId(record);
        const payload = {
          title: file.basename,
          path: file.path,
          bodyMarkdown,
          status: "active",
          source: "obsidian-sma-client"
        };
        if (primaryConceptId) {
          payload.primaryConceptId = primaryConceptId;
        }
        if (parentId) {
          payload.parentId = parentId;
        }
        const response = await this.client.register(payload);
        const data = response.data || {};
        record.smId = data.smId || (data.element && String(data.element.id)) || null;
        record.registeredAt = nowIso();
        record.status = "active";
        record.primarySmConceptId = primaryConceptId || null;
        record.pendingConceptSync = false;
        this.applyStatusData(record, data);
        this.clearError(record);
        record.lastSyncAt = nowIso();
        return;
      }

      const response = await this.client.status(record.smId);
      this.applyStatusData(record, response.data || {});
      record.status = "active";
      record.pendingConceptSync = this.isRecordConceptPendingSync(record);
      this.clearError(record);
      record.lastSyncAt = nowIso();
    } catch (error) {
      record.status = record.smId ? "sync-error" : "register-error";
      this.recordError(record, error);
      throw error;
    }
  }

  applyStatusData(record, data) {
    if (data.element && data.element.id && !record.smId) {
      record.smId = String(data.element.id);
    }
    if (data.element && data.element.title) {
      record.smTitle = data.element.title;
    }
    if (data.element && data.element.primaryConceptId != null) {
      record.primarySmConceptId = normalizePositiveInt(data.element.primaryConceptId);
    }

    const schedule = data.schedule || {};
    record.schedule = {
      nextReview: schedule.nextReview != null ? schedule.nextReview : null,
      interval: schedule.interval != null ? schedule.interval : null,
      repetitions: schedule.repetitions != null ? schedule.repetitions : null,
      easiness: schedule.easiness != null ? schedule.easiness : null,
      lastReview: schedule.lastReview != null ? schedule.lastReview : null,
      status: schedule.status != null ? schedule.status : null,
      reason: schedule.reason != null ? schedule.reason : null,
      sources: schedule.sources != null ? schedule.sources : null,
      diagnostics: schedule.diagnostics != null ? schedule.diagnostics : null
    };
  }

  async importFrontmatterMembers(interactive) {
    const key = this.state.settings.importFrontmatterKey || DEFAULT_SETTINGS.importFrontmatterKey;
    const markdownFiles = this.app.vault.getMarkdownFiles();
    let created = 0;
    let reactivated = 0;
    let skipped = 0;

    for (const file of markdownFiles) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache && cache.frontmatter ? cache.frontmatter : null;
      if (!frontmatter || frontmatter[key] !== true) {
        continue;
      }
      const existingId = this.state.pathIndex[file.path];
      const existing = existingId ? this.state.notesById[existingId] : null;
      const record = this.ensureRecord(file, true);
      if (!existing) {
        created += 1;
      } else if (record.status === "removed" || record.status === "missing") {
        record.status = record.smId ? "active" : "enrolled";
        reactivated += 1;
      } else {
        skipped += 1;
      }
    }

    await this.persistState();
    if (interactive) {
      new Notice(`Import 完成：新增 ${created}，恢复 ${reactivated}，跳过 ${skipped}。`);
    }
    return { created, reactivated, skipped };
  }

  async handleRename(file, oldPath) {
    const noteId = this.state.pathIndex[oldPath];
    if (!noteId || !this.state.notesById[noteId]) {
      return;
    }
    const record = this.state.notesById[noteId];
    record.path = file.path;
    record.basename = file.basename;
    record.contentFingerprint = {
      mtime: file.stat ? file.stat.mtime : null,
      size: file.stat ? file.stat.size : null
    };
    await this.persistState();
  }

  async handleDelete(file) {
    const noteId = this.state.pathIndex[file.path];
    if (!noteId || !this.state.notesById[noteId]) {
      return;
    }
    const record = this.state.notesById[noteId];
    record.status = "missing";
    record.enrolled = false;
    this.recordError(record, new Error("Markdown file deleted from vault."));
    await this.persistState();
  }

  async openNoteByPath(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Note not found: ${path}`);
      return;
    }
    const leaf = this.app.workspace.getMostRecentLeaf() || this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
  }

  async ensureEnrollFrontmatter(file) {
    if (!(file instanceof TFile) || file.extension !== "md") {
      return;
    }
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.srs = true;
    });
  }
};
