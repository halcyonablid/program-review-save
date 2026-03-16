const { Plugin, Notice, Modal, Setting, TFile } = require("obsidian");

const PLUGIN_VERSION = "0.1.0";
const STATE_SCHEMA_VERSION = "1.0";
const DEFAULT_RELATION_TYPE = "引用";
const RELATION_TYPES = ["引用", "关联", "依赖", "阻塞", "支持", "来源"];

const cloneJson = (value, fallback) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return fallback;
  }
};

const nowString = () => new Date().toISOString();

const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();

const normalizeNodeKey = (value) => normalizeText(value);

const normalizeOptionalText = (value) => {
  const text = String(value || "").trim();
  return text || "";
};

const createEmptyState = () => ({
  schema_version: STATE_SCHEMA_VERSION,
  updated: "",
  relationsById: {},
  nodeIndexByKey: {}
});

const sortByLocale = (list, getter) => {
  return [...list].sort((a, b) => {
    const aa = String(getter(a) || "");
    const bb = String(getter(b) || "");
    return aa.localeCompare(bb, "zh-Hans-CN");
  });
};

class RelationEditorModal extends Modal {
  constructor(app, plugin, sourceNodeKey) {
    super(app);
    this.plugin = plugin;
    this.sourceNodeKey = normalizeNodeKey(sourceNodeKey);
    this.editingRelationId = "";
    this.targetNodeKey = "";
    this.relationType = DEFAULT_RELATION_TYPE;
    this.description = "";
    this.searchQuery = "";
    this.keepSearchFocus = false;
  }

  async onOpen() {
    this.modalEl.style.maxWidth = "1280px";
    this.modalEl.style.width = "94vw";
    this.modalEl.style.height = "82vh";
    this.modalEl.addClass("eva-rel-modal-root");
    this.contentEl.style.display = "flex";
    this.contentEl.style.flexDirection = "column";
    this.contentEl.style.height = "100%";
    this.contentEl.style.gap = "16px";
    this.contentEl.style.overflow = "auto";
    await this.plugin.refreshAllAdapters();
    this.render();
  }

  onClose() {
    this.modalEl.style.maxWidth = "";
    this.modalEl.style.width = "";
    this.modalEl.style.height = "";
    this.contentEl.style.display = "";
    this.contentEl.style.flexDirection = "";
    this.contentEl.style.height = "";
    this.contentEl.style.gap = "";
    this.contentEl.style.overflow = "";
    this.contentEl.empty();
  }

  beginEdit(relation) {
    if (!relation) return;
    this.editingRelationId = relation.id;
    this.targetNodeKey = relation.targetNodeKey;
    this.relationType = relation.relationType || DEFAULT_RELATION_TYPE;
    this.description = relation.description || "";
    this.render();
  }

  resetComposer() {
    this.editingRelationId = "";
    this.targetNodeKey = "";
    this.relationType = DEFAULT_RELATION_TYPE;
    this.description = "";
    this.searchQuery = "";
    this.render();
  }

  jumpToNodeAndClose(nodeKey) {
    const targetKey = normalizeNodeKey(nodeKey);
    if (!targetKey) return;
    this.close();
    window.setTimeout(() => {
      void this.plugin.openNode(targetKey);
    }, 40);
  }

  async submit() {
    if (!this.sourceNodeKey) {
      new Notice("❌ 缺少源条目");
      return;
    }
    if (!this.targetNodeKey) {
      new Notice("⚠️ 请先选择目标条目");
      return;
    }
    if (this.sourceNodeKey === this.targetNodeKey) {
      new Notice("⚠️ 不能引用自己");
      return;
    }
    await this.plugin.upsertRelation({
      id: this.editingRelationId || "",
      sourceNodeKey: this.sourceNodeKey,
      targetNodeKey: this.targetNodeKey,
      relationType: this.relationType || DEFAULT_RELATION_TYPE,
      description: this.description || ""
    });
    this.resetComposer();
  }

  renderNodeCard(container, label, record) {
    const card = container.createEl("div", {
      cls: `eva-rel-target-preview ${record ? "is-selected" : ""}`.trim()
    });
    card.createEl("div", { text: label, cls: "eva-rel-section-title" });
    if (!record) {
      card.createEl("div", { text: "未找到条目索引", cls: "eva-rel-empty" });
      return;
    }
    card.createEl("div", { text: record.label || record.nodeKey, cls: "eva-rel-target-title" });
    const chipRow = card.createEl("div", { cls: "eva-rel-chip-row" });
    chipRow.createEl("span", {
      text: `视图: ${record.viewLabel || record.viewType || "未知"}`,
      cls: "eva-rel-chip is-view"
    });
    card.createEl("div", {
      text: record.pathLabel || record.notePath || record.nodeKey,
      cls: "eva-rel-target-path"
    });
  }

  renderRelationList(container, title, relations, mode) {
    const panel = container.createEl("div", { cls: "eva-rel-panel" });
    panel.createEl("div", { text: title, cls: "eva-rel-section-title" });
    if (!relations || relations.length === 0) {
      panel.createEl("div", { text: "暂无", cls: "eva-rel-empty" });
      return;
    }
    const list = panel.createEl("div", { cls: "eva-rel-existing-list" });
    relations.forEach((relation) => {
      const record = mode === "outgoing" ? relation.target : relation.source;
      const item = list.createEl("div", { cls: "eva-rel-existing-item" });
      const chipRow = item.createEl("div", { cls: "eva-rel-chip-row" });
      chipRow.createEl("span", {
        text: relation.relationType || DEFAULT_RELATION_TYPE,
        cls: `eva-rel-chip ${mode === "outgoing" ? "is-outgoing" : "is-incoming"}`
      });
      chipRow.createEl("span", {
        text: `${mode === "outgoing" ? "目标视图" : "来源视图"}: ${record?.viewLabel || record?.viewType || "未知"}`,
        cls: "eva-rel-chip is-view"
      });
      item.createEl("div", { text: record?.label || relation.targetNodeKey || relation.sourceNodeKey, cls: "eva-rel-item-title" });
      item.createEl("div", {
        text: record?.pathLabel || record?.notePath || relation.targetNodeKey || relation.sourceNodeKey,
        cls: "eva-rel-item-path"
      });
      if (relation.description) {
        item.createEl("div", {
          text: relation.description,
          cls: "eva-rel-item-description"
        });
      }
      const actions = item.createEl("div", { cls: "eva-rel-existing-actions" });
      const openBtn = actions.createEl("button", { text: mode === "outgoing" ? "打开目标" : "打开来源" });
      openBtn.onclick = () => {
        this.jumpToNodeAndClose(mode === "outgoing" ? relation.targetNodeKey : relation.sourceNodeKey);
      };
      if (mode === "outgoing") {
        const editBtn = actions.createEl("button", { text: "编辑" });
        editBtn.onclick = () => this.beginEdit(relation);
        const deleteBtn = actions.createEl("button", { text: "删除" });
        deleteBtn.onclick = async () => {
          await this.plugin.deleteRelation(relation.id);
          if (this.editingRelationId === relation.id) this.resetComposer();
          else this.render();
        };
      }
    });
  }

  renderSearchResults(container) {
    const query = normalizeText(this.searchQuery);
    const list = container.createEl("div", { cls: "eva-rel-search-results" });
    const results = this.plugin.searchNodes(query, {
      excludeNodeKey: this.sourceNodeKey,
      limit: 60
    });
    if (results.length === 0) {
      list.createEl("div", { text: "没有匹配条目", cls: "eva-rel-empty" });
      return;
    }
    results.forEach((record) => {
      const row = list.createEl("div", {
        cls: `eva-rel-search-item ${record.nodeKey === this.targetNodeKey ? "is-active" : ""}`.trim()
      });
      const chipRow = row.createEl("div", { cls: "eva-rel-chip-row" });
      chipRow.createEl("span", {
        text: `视图: ${record.viewLabel || record.viewType || "未知"}`,
        cls: "eva-rel-chip is-view"
      });
      row.createEl("div", { text: record.label || record.nodeKey, cls: "eva-rel-item-title" });
      row.createEl("div", {
        text: record.pathLabel || record.notePath || record.nodeKey,
        cls: "eva-rel-item-path"
      });
      const actions = row.createEl("div", { cls: "eva-rel-search-actions" });
      const selectBtn = actions.createEl("button", {
        text: record.nodeKey === this.targetNodeKey ? "已选中" : "选择"
      });
      selectBtn.onclick = () => {
        this.targetNodeKey = record.nodeKey;
        this.render();
      };
      const openBtn = actions.createEl("button", { text: "预览跳转" });
      openBtn.onclick = () => {
        this.jumpToNodeAndClose(record.nodeKey);
      };
    });
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("eva-rel-modal");
    const sourceRecord = this.plugin.getNodeRecord(this.sourceNodeKey);
    contentEl.createEl("h3", { text: "跨视图引用关系" });
    this.renderNodeCard(contentEl, "当前条目", sourceRecord);

    const snapshot = this.plugin.getNodeRelationSnapshot(this.sourceNodeKey);
    const layout = contentEl.createEl("div", { cls: "eva-rel-layout" });
    const composerColumn = layout.createEl("div", { cls: "eva-rel-column" });
    const listColumn = layout.createEl("div", { cls: "eva-rel-column" });
    const composer = composerColumn.createEl("div", { cls: "eva-rel-panel" });
    composer.createEl("div", {
      text: this.editingRelationId ? "编辑引用关系" : "新建引用关系",
      cls: "eva-rel-section-title"
    });

    const targetRecord = this.plugin.getNodeRecord(this.targetNodeKey);
    this.renderNodeCard(composer, "目标条目", targetRecord);

    const searchSetting = new Setting(composer).setName("搜索目标条目").setDesc("可按条目名、路径、视图类型筛选");
    const searchInput = searchSetting.controlEl.createEl("input", {
      cls: "eva-rel-search-input",
      attr: { type: "text", placeholder: "输入关键词筛选条目..." }
    });
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value;
      this.keepSearchFocus = true;
      this.render();
    });
    if (this.keepSearchFocus) {
      window.setTimeout(() => {
        searchInput.focus();
        const size = searchInput.value.length;
        try { searchInput.setSelectionRange(size, size); } catch (error) {}
      }, 0);
      this.keepSearchFocus = false;
    }

    this.renderSearchResults(composer);

    const typeSetting = new Setting(composer).setName("关系类型");
    const typeSelect = typeSetting.controlEl.createEl("select", { cls: "eva-rel-type-select" });
    RELATION_TYPES.forEach((type) => {
      const option = typeSelect.createEl("option", { text: type, value: type });
      option.selected = type === this.relationType;
    });
    typeSelect.onchange = () => {
      this.relationType = typeSelect.value || DEFAULT_RELATION_TYPE;
    };

    const descSetting = new Setting(composer).setName("关系说明").setDesc("例如：这个 workspace 条目依赖 GTD 中这项推进");
    const textarea = descSetting.controlEl.createEl("textarea", {
      cls: "eva-rel-description",
      attr: { rows: "4", placeholder: "补充说明这条关系为什么存在" }
    });
    textarea.value = this.description;
    textarea.addEventListener("input", () => {
      this.description = textarea.value;
    });

    const actions = composer.createEl("div", { cls: "eva-rel-form-actions" });
    const saveBtn = actions.createEl("button", {
      text: this.editingRelationId ? "保存修改" : "保存关系",
      cls: "mod-cta"
    });
    saveBtn.onclick = async () => {
      await this.submit();
    };
    const resetBtn = actions.createEl("button", { text: "清空表单" });
    resetBtn.onclick = () => this.resetComposer();

    this.renderRelationList(listColumn, "我指向的条目", snapshot.outgoing, "outgoing");
    this.renderRelationList(listColumn, "指向我的条目", snapshot.incoming, "incoming");
  }
}

module.exports = class EVACrossViewRelationsPlugin extends Plugin {
  async onload() {
    this.adapters = new Map();
    this.pendingFocusByContext = {};
    this.saveTimer = null;
    this.state = createEmptyState();
    await this.loadState();
    this.api = this.buildApi();
    this.app.plugins.plugins[this.manifest.id].api = this.api;
    window.evaCrossViewRelations = this.api;

    this.addCommand({
      id: "eva-cross-view-relations-open-modal",
      name: "Open Cross View Relation Editor For Last Focused Item",
      callback: () => {
        const nodeKey = window.evaCrossViewRelationsLastNodeKey || "";
        if (!nodeKey) {
          new Notice("⚠️ 还没有最近聚焦的跨视图条目");
          return;
        }
        this.openRelationEditor(nodeKey);
      }
    });
  }

  onunload() {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.app?.plugins?.plugins?.[this.manifest.id]) {
      delete this.app.plugins.plugins[this.manifest.id].api;
    }
    if (window.evaCrossViewRelations === this.api) delete window.evaCrossViewRelations;
  }

  buildApi() {
    return {
      version: PLUGIN_VERSION,
      registerAdapter: async (descriptor) => await this.registerAdapter(descriptor),
      unregisterAdapter: (adapterId) => this.unregisterAdapter(adapterId),
      refreshAdapter: async (adapterId) => await this.refreshAdapterIndex(adapterId),
      openRelationEditor: async (sourceNodeKey) => await this.openRelationEditor(sourceNodeKey),
      getNodeRelationSnapshot: (nodeKey) => this.getNodeRelationSnapshot(nodeKey),
      getNodeRecord: (nodeKey) => this.getNodeRecord(nodeKey),
      openNode: async (nodeKey) => await this.openNode(nodeKey),
      consumePendingFocus: (viewType, notePath) => this.consumePendingFocus(viewType, notePath),
      markLastFocusedNode: (nodeKey) => {
        window.evaCrossViewRelationsLastNodeKey = normalizeNodeKey(nodeKey);
      }
    };
  }

  async loadState() {
    const saved = await this.loadData();
    const next = createEmptyState();
    next.relationsById = cloneJson(saved?.relationsById || {}, {});
    next.nodeIndexByKey = cloneJson(saved?.nodeIndexByKey || {}, {});
    next.updated = normalizeOptionalText(saved?.updated);
    this.state = next;
  }

  scheduleSave(reason = "update", options = {}) {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(async () => {
      this.saveTimer = null;
      this.state.updated = nowString();
      await this.saveData(this.state);
      if (options.dispatch !== false) this.dispatchChanged(reason);
    }, 180);
  }

  dispatchChanged(reason = "update") {
    window.dispatchEvent(new CustomEvent("eva-cross-view-relations:changed", {
      detail: { reason, updated: this.state.updated || nowString() }
    }));
  }

  normalizeAdapterDescriptor(descriptor = {}) {
    const adapterId = normalizeText(descriptor.adapterId);
    const viewType = normalizeText(descriptor.viewType);
    const notePath = normalizeText(descriptor.notePath);
    if (!adapterId || !viewType || !notePath) return null;
    if (typeof descriptor.listItems !== "function") return null;
    return {
      adapterId,
      viewType,
      notePath,
      viewLabel: normalizeOptionalText(descriptor.viewLabel) || viewType,
      listItems: descriptor.listItems,
      openNode: typeof descriptor.openNode === "function" ? descriptor.openNode : null
    };
  }

  async registerAdapter(descriptor) {
    const normalized = this.normalizeAdapterDescriptor(descriptor);
    if (!normalized) return null;
    this.adapters.set(normalized.adapterId, normalized);
    await this.refreshAdapterIndex(normalized.adapterId);
    return true;
  }

  unregisterAdapter(adapterId) {
    const key = normalizeText(adapterId);
    if (!key) return;
    this.adapters.delete(key);
  }

  normalizeNodeRecord(adapter, item) {
    const nodeKey = normalizeNodeKey(item?.nodeKey);
    if (!nodeKey) return null;
    const label = normalizeOptionalText(item?.label) || nodeKey;
    const pathLabel = normalizeOptionalText(item?.pathLabel) || adapter.notePath;
    const searchText = normalizeOptionalText(item?.searchText || `${label} ${pathLabel} ${adapter.viewType}`);
    return {
      nodeKey,
      label,
      pathLabel,
      searchText,
      notePath: adapter.notePath,
      viewType: adapter.viewType,
      viewLabel: adapter.viewLabel,
      adapterId: adapter.adapterId
    };
  }

  async refreshAdapterIndex(adapterId) {
    const adapter = this.adapters.get(normalizeText(adapterId));
    if (!adapter) return [];
    let rawItems = [];
    try {
      rawItems = await Promise.resolve(adapter.listItems());
    } catch (error) {
      console.error("[EVA Relations] 刷新适配器索引失败:", error);
      return [];
    }
    const nextItems = Array.isArray(rawItems) ? rawItems : [];
    const previousRecords = Object.values(this.state.nodeIndexByKey || {})
      .filter((record) => record?.adapterId === adapter.adapterId)
      .map((record) => ({
        nodeKey: record.nodeKey,
        label: record.label,
        pathLabel: record.pathLabel,
        searchText: record.searchText,
        notePath: record.notePath,
        viewType: record.viewType,
        viewLabel: record.viewLabel,
        adapterId: record.adapterId
      }))
      .sort((a, b) => a.nodeKey.localeCompare(b.nodeKey, "zh-Hans-CN"));
    Object.keys(this.state.nodeIndexByKey || {}).forEach((nodeKey) => {
      if (this.state.nodeIndexByKey[nodeKey]?.adapterId === adapter.adapterId) {
        delete this.state.nodeIndexByKey[nodeKey];
      }
    });
    nextItems.forEach((item) => {
      const normalized = this.normalizeNodeRecord(adapter, item);
      if (!normalized) return;
      this.state.nodeIndexByKey[normalized.nodeKey] = normalized;
    });
    const nextRecords = Object.values(this.state.nodeIndexByKey || {})
      .filter((record) => record?.adapterId === adapter.adapterId)
      .map((record) => ({
        nodeKey: record.nodeKey,
        label: record.label,
        pathLabel: record.pathLabel,
        searchText: record.searchText,
        notePath: record.notePath,
        viewType: record.viewType,
        viewLabel: record.viewLabel,
        adapterId: record.adapterId
      }))
      .sort((a, b) => a.nodeKey.localeCompare(b.nodeKey, "zh-Hans-CN"));
    if (JSON.stringify(previousRecords) !== JSON.stringify(nextRecords)) {
      this.scheduleSave("index", { dispatch: false });
    }
    return nextItems;
  }

  async refreshAllAdapters() {
    const ids = Array.from(this.adapters.keys());
    for (const id of ids) {
      await this.refreshAdapterIndex(id);
    }
  }

  getNodeRecord(nodeKey) {
    const key = normalizeNodeKey(nodeKey);
    if (!key) return null;
    return cloneJson(this.state.nodeIndexByKey?.[key] || null, null);
  }

  getEnrichedRelation(relation) {
    return {
      ...relation,
      source: this.getNodeRecord(relation.sourceNodeKey),
      target: this.getNodeRecord(relation.targetNodeKey)
    };
  }

  getNodeRelationSnapshot(nodeKey) {
    const key = normalizeNodeKey(nodeKey);
    const outgoing = [];
    const incoming = [];
    Object.values(this.state.relationsById || {}).forEach((relation) => {
      if (!relation) return;
      if (relation.sourceNodeKey === key) outgoing.push(this.getEnrichedRelation(relation));
      if (relation.targetNodeKey === key) incoming.push(this.getEnrichedRelation(relation));
    });
    return {
      outgoing: sortByLocale(outgoing, (item) => item.target?.label || item.targetNodeKey),
      incoming: sortByLocale(incoming, (item) => item.source?.label || item.sourceNodeKey)
    };
  }

  searchNodes(query, options = {}) {
    const text = normalizeText(query).toLowerCase();
    const excludeNodeKey = normalizeNodeKey(options.excludeNodeKey);
    const limit = Math.max(1, Number(options.limit) || 50);
    const list = Object.values(this.state.nodeIndexByKey || {})
      .filter((record) => !!record && record.nodeKey !== excludeNodeKey)
      .filter((record) => {
        if (!text) return true;
        const haystack = `${record.label} ${record.pathLabel} ${record.searchText} ${record.viewType}`.toLowerCase();
        return haystack.includes(text);
      });
    return sortByLocale(list, (item) => `${item.label} ${item.pathLabel}`).slice(0, limit).map((item) => cloneJson(item, {}));
  }

  normalizeRelation(input = {}) {
    const sourceNodeKey = normalizeNodeKey(input.sourceNodeKey);
    const targetNodeKey = normalizeNodeKey(input.targetNodeKey);
    if (!sourceNodeKey || !targetNodeKey) return null;
    return {
      id: normalizeOptionalText(input.id) || `rel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      sourceNodeKey,
      targetNodeKey,
      relationType: normalizeOptionalText(input.relationType) || DEFAULT_RELATION_TYPE,
      description: normalizeOptionalText(input.description),
      createdAt: normalizeOptionalText(input.createdAt) || nowString(),
      updatedAt: nowString()
    };
  }

  async upsertRelation(input) {
    const relation = this.normalizeRelation(input);
    if (!relation) {
      new Notice("❌ 关系数据无效");
      return null;
    }
    this.state.relationsById[relation.id] = relation;
    this.scheduleSave("relation-upsert");
    return relation;
  }

  async deleteRelation(relationId) {
    const key = normalizeText(relationId);
    if (!key || !this.state.relationsById[key]) return;
    delete this.state.relationsById[key];
    this.scheduleSave("relation-delete");
  }

  async openRelationEditor(sourceNodeKey) {
    const key = normalizeNodeKey(sourceNodeKey);
    if (!key) {
      new Notice("⚠️ 当前条目还没有可用节点标识");
      return;
    }
    new RelationEditorModal(this.app, this, key).open();
  }

  getPendingFocusContextKey(viewType, notePath) {
    return `${normalizeText(viewType)}::${normalizeText(notePath)}`;
  }

  consumePendingFocus(viewType, notePath) {
    const contextKey = this.getPendingFocusContextKey(viewType, notePath);
    const payload = this.pendingFocusByContext[contextKey] || null;
    if (payload) delete this.pendingFocusByContext[contextKey];
    return payload ? cloneJson(payload, null) : null;
  }

  async openNotePath(notePath) {
    const path = normalizeText(notePath);
    if (!path) return false;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    const leaf = this.app.workspace.getMostRecentLeaf() || this.app.workspace.getLeaf(true);
    await leaf.openFile(file, { active: true });
    return true;
  }

  async openNode(nodeKey) {
    const record = this.getNodeRecord(nodeKey);
    if (!record) {
      new Notice("⚠️ 还没有这个条目的索引，请先打开对应视图一次");
      return false;
    }
    const contextKey = this.getPendingFocusContextKey(record.viewType, record.notePath);
    this.pendingFocusByContext[contextKey] = {
      nodeKey: record.nodeKey,
      requestedAt: nowString()
    };
    const adapter = record.adapterId ? this.adapters.get(record.adapterId) : null;
    if (adapter?.openNode) {
      try {
        const handled = await Promise.resolve(adapter.openNode(record.nodeKey, {
          notePath: record.notePath,
          viewType: record.viewType,
          fromPlugin: true
        }));
        if (handled) return true;
      } catch (error) {
        console.error("[EVA Relations] adapter openNode 失败:", error);
      }
    }
    const opened = await this.openNotePath(record.notePath);
    if (!opened) {
      delete this.pendingFocusByContext[contextKey];
      new Notice("❌ 打开目标视图失败");
      return false;
    }
    return true;
  }
};
