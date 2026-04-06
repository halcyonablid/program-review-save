const { ItemView, Modal, Notice, Plugin, Setting, SuggestModal, TFile, offref } = require('obsidian');

const DATA_SCHEMA_VERSION = 1;
const VIEW_TYPE_STATE_CAPSULES = 'state-capsules-view';
const MAX_NOTE_EVENT_LOG = 2000;
const DEFAULT_SETTINGS = {
  bridgeTimeoutMs: 5000,
  bridgePollMs: 150,
  openBridgeNotesInNewTab: true,
};

const NOTE_EVENT_LOG_SCHEMA_VERSION = 1;

function nowString() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join('-') + ' ' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join(':');
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sanitizeText(value, fallback = '') {
  const text = String(value == null ? '' : value).trim();
  return text || fallback;
}

function isObjectLike(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyStore() {
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    activeCapsuleId: null,
    capsuleOrder: [],
    capsules: [],
    noteTracking: {
      enabled: false,
    },
    noteEventLog: [],
  };
}

function normalizeNoteEventLog(rawEvents) {
  const list = Array.isArray(rawEvents)
    ? rawEvents
    : Array.isArray(rawEvents?.events)
      ? rawEvents.events
      : [];
  return list
    .filter((event) => event && typeof event === 'object')
    .map((event) => ({
      ts: sanitizeText(event.ts, nowString()),
      type: sanitizeText(event.type, 'unknown'),
      path: sanitizeText(event.path, ''),
      oldPath: sanitizeText(event.oldPath, ''),
    }))
    .slice(-MAX_NOTE_EVENT_LOG);
}

function sortCapsulesByUpdatedAt(capsules) {
  return [...capsules].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function normalizeCapsuleOrder(rawOrder, capsules) {
  const validIds = new Set(capsules.map((capsule) => capsule.id));
  const seen = new Set();
  const order = [];
  const source = Array.isArray(rawOrder)
    ? rawOrder
    : sortCapsulesByUpdatedAt(capsules).map((capsule) => capsule.id);

  source.forEach((rawId) => {
    const id = sanitizeText(rawId, '');
    if (!id || seen.has(id) || !validIds.has(id)) return;
    seen.add(id);
    order.push(id);
  });

  capsules.forEach((capsule) => {
    if (seen.has(capsule.id)) return;
    seen.add(capsule.id);
    order.push(capsule.id);
  });

  return order;
}

function normalizeStore(raw) {
  const capsules = Array.isArray(raw?.capsules) ? raw.capsules : [];
  const normalizedCapsules = capsules
    .filter((capsule) => capsule && typeof capsule === 'object')
    .map((capsule) => ({
      id: sanitizeText(capsule.id, createId('capsule')),
      name: sanitizeText(capsule.name, 'Untitled Capsule'),
      createdAt: sanitizeText(capsule.createdAt, nowString()),
      updatedAt: sanitizeText(capsule.updatedAt, nowString()),
      vault: deepClone(capsule.vault || {}),
      obsidianWorkspace: deepClone(capsule.obsidianWorkspace || {}),
      workspaceMount: deepClone(capsule.workspaceMount || {}),
      gtd: deepClone(capsule.gtd || {}),
      meta: deepClone(capsule.meta || {}),
    }));
  return {
    schemaVersion: DATA_SCHEMA_VERSION,
    activeCapsuleId: sanitizeText(raw?.activeCapsuleId, '') || null,
    capsuleOrder: normalizeCapsuleOrder(raw?.capsuleOrder, normalizedCapsules),
    noteTracking: {
      enabled: raw?.noteTracking?.enabled === true,
    },
    capsules: normalizedCapsules,
    noteEventLog: normalizeNoteEventLog(raw?.noteEventLog),
  };
}

class CapsuleRepository {
  constructor(plugin) {
    this.plugin = plugin;
    this.store = createEmptyStore();
  }

  async load() {
    const raw = await this.plugin.loadData();
    this.store = normalizeStore(raw);
    const externalLog = await this.plugin.loadNoteEventLog();
    if (externalLog.length > 0) {
      this.store.noteEventLog = externalLog;
    } else if (this.store.noteEventLog.length > 0) {
      await this.plugin.saveNoteEventLog(this.store.noteEventLog);
    }
    return this.store;
  }

  async save() {
    this.store = normalizeStore(this.store);
    await this.plugin.saveMainStore(this.store);
    await this.plugin.saveNoteEventLog(this.store.noteEventLog);
  }

  getCapsuleOrder() {
    this.store.capsuleOrder = normalizeCapsuleOrder(this.store.capsuleOrder, this.store.capsules);
    return [...this.store.capsuleOrder];
  }

  listCapsules() {
    const byId = new Map(this.store.capsules.map((capsule) => [capsule.id, capsule]));
    return this.getCapsuleOrder()
      .map((id) => byId.get(id))
      .filter(Boolean);
  }

  getCapsule(id) {
    const target = sanitizeText(id, '');
    return this.store.capsules.find((capsule) => capsule.id === target) || null;
  }

  getActiveCapsule() {
    return this.getCapsule(this.store.activeCapsuleId);
  }

  async createCapsule(capsule) {
    this.store.capsules.push(capsule);
    this.store.capsuleOrder = [capsule.id, ...this.getCapsuleOrder().filter((id) => id !== capsule.id)];
    this.store.activeCapsuleId = capsule.id;
    await this.save();
    return capsule;
  }

  async updateCapsule(id, nextCapsule, options = {}) {
    const index = this.store.capsules.findIndex((capsule) => capsule.id === id);
    if (index < 0) throw new Error(`Capsule not found: ${id}`);
    this.store.capsules[index] = nextCapsule;
    this.store.capsuleOrder = this.getCapsuleOrder().map((capsuleId) => (
      capsuleId === id ? nextCapsule.id : capsuleId
    ));
    if (options.setActive === true) {
      this.store.activeCapsuleId = nextCapsule.id;
    }
    await this.save();
    return nextCapsule;
  }

  async deleteCapsule(id) {
    this.store.capsules = this.store.capsules.filter((capsule) => capsule.id !== id);
    this.store.capsuleOrder = this.getCapsuleOrder().filter((capsuleId) => capsuleId !== id);
    if (this.store.activeCapsuleId === id) this.store.activeCapsuleId = null;
    await this.save();
  }

  async moveCapsule(sourceId, targetId = null, placement = 'before') {
    const source = sanitizeText(sourceId, '');
    if (!source) return false;

    const order = this.getCapsuleOrder().filter((id) => id !== source);
    if (!targetId) {
      order.push(source);
      this.store.capsuleOrder = order;
      await this.save();
      return true;
    }

    const target = sanitizeText(targetId, '');
    const targetIndex = order.indexOf(target);
    if (targetIndex < 0) return false;

    const insertAt = placement === 'after' ? targetIndex + 1 : targetIndex;
    order.splice(insertAt, 0, source);
    this.store.capsuleOrder = order;
    await this.save();
    return true;
  }

  async setActiveCapsuleId(id) {
    this.store.activeCapsuleId = sanitizeText(id, '') || null;
    await this.save();
  }

  isNoteTrackingEnabled() {
    return this.store.noteTracking?.enabled === true;
  }

  async setNoteTrackingEnabled(enabled) {
    this.store.noteTracking = {
      enabled: enabled === true,
    };
    await this.save();
  }

  async appendNoteEvent(event) {
    this.store.noteEventLog.push({
      ts: sanitizeText(event?.ts, nowString()),
      type: sanitizeText(event?.type, 'unknown'),
      path: sanitizeText(event?.path, ''),
      oldPath: sanitizeText(event?.oldPath, ''),
    });
    if (this.store.noteEventLog.length > MAX_NOTE_EVENT_LOG) {
      this.store.noteEventLog = this.store.noteEventLog.slice(-MAX_NOTE_EVENT_LOG);
    }
    await this.save();
  }

  async clearNoteEventLog() {
    this.store.noteEventLog = [];
    await this.save();
  }

  getRecentNoteEvents(limit = 8) {
    return [...(this.store.noteEventLog || [])].slice(-limit).reverse();
  }

  resolvePathFromEventLog(originalPath) {
    let currentPath = sanitizeText(originalPath, '');
    if (!currentPath) {
      return {
        path: '',
        missing: false,
        renamed: false,
        history: [],
      };
    }
    const history = [];
    for (const event of this.store.noteEventLog || []) {
      if (event.type === 'rename' && sanitizeText(event.oldPath, '') === currentPath) {
        history.push({
          type: 'rename',
          from: currentPath,
          to: sanitizeText(event.path, ''),
          ts: event.ts,
        });
        currentPath = sanitizeText(event.path, currentPath);
      } else if (event.type === 'delete' && sanitizeText(event.path, '') === currentPath) {
        history.push({
          type: 'delete',
          path: currentPath,
          ts: event.ts,
        });
      } else if (event.type === 'create' && sanitizeText(event.path, '') === currentPath) {
        history.push({
          type: 'create',
          path: currentPath,
          ts: event.ts,
        });
      }
    }
    const file = currentPath ? this.plugin.app.vault.getAbstractFileByPath(currentPath) : null;
    return {
      path: currentPath,
      missing: !file,
      renamed: currentPath !== sanitizeText(originalPath, ''),
      history,
    };
  }
}

class NoteEventTracker {
  constructor(app, repository) {
    this.app = app;
    this.repository = repository;
    this.eventRefs = [];
    this.enabled = false;
  }

  enable() {
    if (this.enabled) return;
    this.eventRefs.push(this.app.vault.on('create', (file) => {
      if (!(file instanceof TFile)) return;
      void this.handleEvent({ type: 'create', path: file.path });
    }));

    this.eventRefs.push(this.app.vault.on('rename', (file, oldPath) => {
      if (!(file instanceof TFile)) return;
      void this.handleEvent({ type: 'rename', path: file.path, oldPath });
    }));

    this.eventRefs.push(this.app.vault.on('delete', (file) => {
      if (!(file instanceof TFile)) return;
      void this.handleEvent({ type: 'delete', path: file.path });
    }));
    this.enabled = true;
  }

  disable() {
    if (!this.enabled) return;
    this.eventRefs.forEach((ref) => offref(ref));
    this.eventRefs = [];
    this.enabled = false;
  }

  syncWithRepository() {
    if (this.repository.isNoteTrackingEnabled()) {
      this.enable();
      return;
    }
    this.disable();
  }

  async handleEvent(event) {
    if (!this.repository.isNoteTrackingEnabled()) return;
    await this.repository.appendNoteEvent({
      ts: nowString(),
      type: event.type,
      path: event.path,
      oldPath: event.oldPath,
    });
  }
}

class BridgeRegistry {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
  }

  getWorkspaceMountPluginApi() {
    const api = window.__workspaceMountPluginApi;
    return api && typeof api === 'object' ? api : null;
  }

  getFileByPath(path) {
    const target = sanitizeText(path, '');
    if (!target) return null;
    const file = this.app.vault.getAbstractFileByPath(target);
    return file instanceof TFile ? file : null;
  }

  getBridge(globalName, targetNotePath = null) {
    if (globalName === 'workspaceCapsuleBridge') {
      const pluginApi = this.getWorkspaceMountPluginApi();
      if (pluginApi && typeof pluginApi.getBridge === 'function') {
        try {
          const pluginBridge = pluginApi.getBridge(targetNotePath || '');
          if (pluginBridge && typeof pluginBridge.isReady === 'function' && pluginBridge.isReady() === true) {
            if (targetNotePath && typeof pluginBridge.getState === 'function') {
              const pluginState = pluginBridge.getState();
              const pluginNotePath = sanitizeText(pluginState?.notePath, '');
              if (pluginNotePath && pluginNotePath !== targetNotePath) return null;
            }
            return pluginBridge;
          }
        } catch (error) {
          console.warn('[State Capsules] Failed to inspect workspace mount plugin bridge:', error);
        }
      }
    }
    const bridge = window[globalName];
    if (!bridge || typeof bridge !== 'object') return null;
    if (typeof bridge.isReady !== 'function' || bridge.isReady() !== true) return null;
    if (targetNotePath && typeof bridge.getState === 'function') {
      try {
        const state = bridge.getState();
        const notePath = sanitizeText(state?.notePath, '');
        if (notePath && notePath !== targetNotePath) return null;
      } catch (error) {
        console.warn(`[State Capsules] Failed to inspect bridge ${globalName}:`, error);
        return null;
      }
    }
    return bridge;
  }

  async waitForBridge(globalName, targetNotePath = null, timeoutMs = this.settings.bridgeTimeoutMs) {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs) {
      const bridge = this.getBridge(globalName, targetNotePath);
      if (bridge) return bridge;
      await sleep(this.settings.bridgePollMs);
    }
    return null;
  }

  async openTargetNote(notePath) {
    const file = this.getFileByPath(notePath);
    if (!file) return false;
    const leaf = this.app.workspace.getLeaf(this.settings.openBridgeNotesInNewTab ? 'tab' : false);
    await leaf.openFile(file, { active: true });
    return true;
  }

  async ensureBridge(globalName, targetNotePath = null, options = {}) {
    const direct = this.getBridge(globalName, targetNotePath);
    if (direct) return direct;
    if (globalName === 'workspaceCapsuleBridge') {
      const pluginApi = this.getWorkspaceMountPluginApi();
      if (pluginApi && typeof pluginApi.ensureBridge === 'function' && targetNotePath) {
        try {
          const pluginBridge = await pluginApi.ensureBridge(targetNotePath);
          if (pluginBridge && typeof pluginBridge.isReady === 'function' && pluginBridge.isReady() === true) {
            return pluginBridge;
          }
        } catch (error) {
          console.warn('[State Capsules] Failed to ensure workspace mount plugin bridge:', error);
        }
      }
    }
    const allowOpenTargetNote = options?.allowOpenTargetNote !== false;
    if (targetNotePath && allowOpenTargetNote) {
      await this.openTargetNote(targetNotePath);
    }
    return this.waitForBridge(globalName, targetNotePath);
  }
}

class ObsidianWorkspaceService {
  constructor(app) {
    this.app = app;
  }

  collectRootLeaves() {
    const leaves = [];
    this.app.workspace.iterateRootLeaves((leaf) => {
      leaves.push(leaf);
    });
    return leaves;
  }

  capture() {
    const leaves = [];
    let activeFilePath = null;
    try {
      activeFilePath = this.app.workspace.getActiveFile()?.path || null;
    } catch (error) {
      console.warn('[State Capsules] Failed to capture active file:', error);
    }
    this.app.workspace.iterateRootLeaves((leaf) => {
      try {
        leaves.push({
          viewState: deepClone(leaf.getViewState()),
          ephemeralState: deepClone(leaf.getEphemeralState()),
        });
      } catch (error) {
        console.warn('[State Capsules] Failed to serialize leaf:', error);
      }
    });
    return {
      capturedAt: nowString(),
      layout: deepClone(this.app.workspace.getLayout()),
      leaves,
      activeFilePath,
    };
  }

  async waitForLayoutReady() {
    if (this.app.workspace.layoutReady) return;
    await new Promise((resolve) => this.app.workspace.onLayoutReady(resolve));
  }

  async clearRootLeaves() {
    const leaves = this.collectRootLeaves();
    leaves.forEach((leaf) => {
      try {
        leaf.detach();
      } catch (error) {
        console.warn('[State Capsules] Failed to detach leaf during replay fallback:', error);
      }
    });
    await sleep(60);
  }

  async replayLeaves(state) {
    const warnings = [];
    const leaves = Array.isArray(state?.leaves) ? state.leaves : [];
    await this.clearRootLeaves();
    for (let index = 0; index < leaves.length; index += 1) {
      const snapshot = leaves[index];
      if (!snapshot?.viewState) continue;
      if (snapshot.viewState.type === 'markdown' && !findFirstFilePath(snapshot.viewState)) {
        warnings.push(`Leaf ${index + 1} skipped because its markdown file no longer exists`);
        continue;
      }
      try {
        const leaf = this.app.workspace.getLeaf(index === 0 ? false : 'tab');
        await leaf.setViewState(deepClone(snapshot.viewState), deepClone(snapshot.ephemeralState || undefined));
        if (typeof snapshot.viewState?.pinned === 'boolean') {
          leaf.setPinned(snapshot.viewState.pinned);
        }
      } catch (error) {
        warnings.push(`Leaf ${index + 1} replay failed: ${error.message}`);
      }
    }
    return { warnings };
  }

  async restore(state, options = {}) {
    const warnings = [];
    const layout = state?.layout;
    const leaves = Array.isArray(state?.leaves) ? state.leaves : [];
    if (options.preferLeafReplay === true && leaves.length > 0) {
      const replayResult = await this.replayLeaves(state);
      warnings.push(...replayResult.warnings);
      return { warnings, mode: 'leaf-replay' };
    }
    if (layout) {
      try {
        await this.app.workspace.changeLayout(deepClone(layout));
        await this.waitForLayoutReady();
        await sleep(80);
      } catch (error) {
        warnings.push(`Workspace layout restore failed: ${error.message}`);
      }
    }
    if (!layout && leaves.length > 0) {
      const replayResult = await this.replayLeaves(state);
      warnings.push(...replayResult.warnings);
    }
    return { warnings, mode: layout ? 'layout' : 'leaf-replay' };
  }
}

function findFirstFilePath(node) {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstFilePath(item);
      if (found) return found;
    }
    return '';
  }
  if (!isObjectLike(node)) return '';
  if (typeof node.file === 'string' && sanitizeText(node.file, '')) {
    return sanitizeText(node.file, '');
  }
  for (const value of Object.values(node)) {
    const found = findFirstFilePath(value);
    if (found) return found;
  }
  return '';
}

function layoutContainsMarkdownFile(node, targetPath) {
  const normalizedTarget = sanitizeText(targetPath, '');
  if (!normalizedTarget) return false;
  if (Array.isArray(node)) {
    return node.some((item) => layoutContainsMarkdownFile(item, normalizedTarget));
  }
  if (!isObjectLike(node)) return false;
  const nodeType = sanitizeText(node.type, '');
  const stateFile = sanitizeText(node.state?.file, '');
  const directFile = sanitizeText(node.file, '');
  if (nodeType === 'markdown' && (stateFile === normalizedTarget || directFile === normalizedTarget)) {
    return true;
  }
  return Object.values(node).some((value) => layoutContainsMarkdownFile(value, normalizedTarget));
}

function detectWorkspaceHostPresence(workspaceState, workspaceHostNotePath) {
  const targetPath = sanitizeText(workspaceHostNotePath, '');
  const leaves = Array.isArray(workspaceState?.leaves) ? workspaceState.leaves : [];
  const leafRecorded = !!targetPath && leaves.some((snapshot) => {
    const viewState = snapshot?.viewState;
    return sanitizeText(viewState?.type, '') === 'markdown'
      && sanitizeText(findFirstFilePath(viewState), '') === targetPath;
  });
  const layoutRecorded = !!targetPath && layoutContainsMarkdownFile(workspaceState?.layout, targetPath);
  const activeFileRecorded = !!targetPath && sanitizeText(workspaceState?.activeFilePath, '') === targetPath;
  return {
    leafRecorded,
    layoutRecorded,
    leafOrLayoutRecorded: leafRecorded || layoutRecorded,
    activeFileRecorded,
  };
}

class CapsuleAssembler {
  constructor(app, bridgeRegistry, workspaceService) {
    this.app = app;
    this.bridgeRegistry = bridgeRegistry;
    this.workspaceService = workspaceService;
  }

  captureCapsule(name) {
    const workspaceBridge = this.bridgeRegistry.getBridge('workspaceCapsuleBridge');
    const gtdBridge = this.bridgeRegistry.getBridge('gtdCapsuleBridge');
    const warnings = [];
    let workspaceMount = null;
    let gtd = null;

    if (workspaceBridge && typeof workspaceBridge.getState === 'function') {
      try {
        workspaceMount = deepClone(workspaceBridge.getState());
      } catch (error) {
        warnings.push(`workspace bridge capture failed: ${error.message}`);
      }
    } else {
      warnings.push('workspace bridge unavailable during capture');
    }

    if (gtdBridge && typeof gtdBridge.getState === 'function') {
      try {
        gtd = deepClone(gtdBridge.getState());
      } catch (error) {
        warnings.push(`gtd bridge capture failed: ${error.message}`);
      }
    } else {
      warnings.push('gtd bridge unavailable during capture');
    }

    const timestamp = nowString();
    return {
      id: createId('capsule'),
      name: sanitizeText(name, 'Untitled Capsule'),
      createdAt: timestamp,
      updatedAt: timestamp,
      vault: {
        name: this.app.vault.getName(),
      },
      obsidianWorkspace: this.workspaceService.capture(),
      workspaceMount,
      gtd,
      meta: {
        warnings,
      },
    };
  }
}

class CapsuleRestoreCoordinator {
  constructor(app, bridgeRegistry, workspaceService, repository) {
    this.app = app;
    this.bridgeRegistry = bridgeRegistry;
    this.workspaceService = workspaceService;
    this.repository = repository;
    this.restoreInFlight = false;
  }

  resolveCapsulePaths(capsule) {
    const nextCapsule = deepClone(capsule);
    const warnings = [];
    const resolvePath = (value, label) => {
      const resolved = this.repository.resolvePathFromEventLog(value);
      if (!sanitizeText(value, '')) return resolved;
      if (resolved.renamed) {
        warnings.push(`${label} 宸叉敼鍚嶏細${value} -> ${resolved.path}`);
      }
      if (resolved.missing) {
        warnings.push(`${label} 褰撳墠涓嶅瓨鍦細${resolved.path || value}`);
      }
      return resolved;
    };

    const activeFile = resolvePath(nextCapsule?.obsidianWorkspace?.activeFilePath, 'Active file');
    if (nextCapsule?.obsidianWorkspace) {
      nextCapsule.obsidianWorkspace.activeFilePath = activeFile.missing ? null : activeFile.path;
    }

    const workspaceHost = resolvePath(nextCapsule?.workspaceMount?.notePath, 'Workspace host note');
    if (nextCapsule?.workspaceMount) {
      nextCapsule.workspaceMount.notePath = workspaceHost.missing ? nextCapsule.workspaceMount.notePath : workspaceHost.path;
    }

    const gtdHost = resolvePath(nextCapsule?.gtd?.notePath, 'GTD host note');
    if (nextCapsule?.gtd) {
      nextCapsule.gtd.notePath = gtdHost.missing ? nextCapsule.gtd.notePath : gtdHost.path;
    }

    const workspaceSnapshot = this.resolveWorkspaceSnapshotPaths(nextCapsule?.obsidianWorkspace || {});
    nextCapsule.obsidianWorkspace = workspaceSnapshot.workspaceState;
    warnings.push(...workspaceSnapshot.warnings);
    const workspaceHostPresence = detectWorkspaceHostPresence(
      nextCapsule?.obsidianWorkspace || {},
      nextCapsule?.workspaceMount?.notePath || ''
    );

    return {
      capsule: nextCapsule,
      warnings,
      missing: {
        activeFile: activeFile.missing,
        workspaceHost: workspaceHost.missing,
        gtdHost: gtdHost.missing,
      },
      restoreHints: {
        preferLeafReplay: workspaceSnapshot.requiresLeafReplay,
        workspaceHostRecordedInLeaves: workspaceHostPresence.leafRecorded,
        workspaceHostRecordedInLayout: workspaceHostPresence.layoutRecorded,
        workspaceHostLeafOrLayoutRecorded: workspaceHostPresence.leafOrLayoutRecorded,
        workspaceHostRecordedAsActiveFile: workspaceHostPresence.activeFileRecorded,
      },
    };
  }

  resolveWorkspaceSnapshotPaths(workspaceState) {
    const nextState = deepClone(workspaceState || {});
    const warnings = [];
    const seenWarnings = new Set();
    let requiresLeafReplay = false;
    const resolveFilePath = (value, label) => {
      const path = sanitizeText(value, '');
      if (!path) return path;
      const resolved = this.repository.resolvePathFromEventLog(path);
      if (resolved.renamed && !seenWarnings.has(`${label}:rename:${path}:${resolved.path}`)) {
        warnings.push(`${label} 宸叉敼鍚嶏細${path} -> ${resolved.path}`);
        seenWarnings.add(`${label}:rename:${path}:${resolved.path}`);
        requiresLeafReplay = true;
      }
      if (resolved.missing) {
        if (!seenWarnings.has(`${label}:missing:${path}`)) {
          warnings.push(`${label} 褰撳墠涓嶅瓨鍦細${resolved.path || path}`);
          seenWarnings.add(`${label}:missing:${path}`);
        }
        requiresLeafReplay = true;
        return '';
      }
      return sanitizeText(resolved.path, path);
    };
    const visit = (node, label) => {
      if (Array.isArray(node)) {
        node.forEach((item, index) => visit(item, `${label}[${index}]`));
        return;
      }
      if (!isObjectLike(node)) return;

      Object.entries(node).forEach(([key, value]) => {
        if (key === 'file' && typeof value === 'string') {
          const nextPath = resolveFilePath(value, `${label}.${key}`);
          if (nextPath) {
            node[key] = nextPath;
          } else {
            delete node[key];
          }
          return;
        }
        visit(value, `${label}.${key}`);
      });
    };

    if (isObjectLike(nextState.layout)) {
      visit(nextState.layout, 'Workspace layout file');
    }
    if (Array.isArray(nextState.leaves)) {
      nextState.leaves.forEach((leaf, index) => {
        if (isObjectLike(leaf?.viewState)) {
          visit(leaf.viewState, `Workspace leaf ${index + 1}`);
        }
      });
    }
    return {
      workspaceState: nextState,
      warnings,
      requiresLeafReplay,
    };
  }

  async restoreCapsule(capsule) {
    if (this.restoreInFlight) {
      throw new Error('Another capsule restore is already running');
    }
    this.restoreInFlight = true;
    const result = {
      ok: false,
      mode: 'failed',
      applied: [],
      skipped: [],
      warnings: [],
      errors: [],
    };

    try {
      const resolvedCapsule = this.resolveCapsulePaths(capsule);
      result.warnings.push(...resolvedCapsule.warnings);
      capsule = resolvedCapsule.capsule;

      if (sanitizeText(capsule?.vault?.name, '') && capsule.vault.name !== this.app.vault.getName()) {
        throw new Error(`Capsule belongs to vault ${capsule.vault.name}, current vault is ${this.app.vault.getName()}`);
      }

      const workspaceResult = await this.workspaceService.restore(
        capsule.obsidianWorkspace || {},
        resolvedCapsule.restoreHints || {}
      );
      result.warnings.push(...workspaceResult.warnings);
      result.applied.push('obsidianWorkspace');

      const workspaceNotePath = sanitizeText(capsule?.workspaceMount?.notePath, '');
      if (capsule.workspaceMount && workspaceNotePath) {
        const bridge = await this.bridgeRegistry.ensureBridge('workspaceCapsuleBridge', workspaceNotePath, {
          allowOpenTargetNote: false,
        });
        if (bridge && typeof bridge.applyState === 'function') {
          const bridgeResult = await bridge.applyState(capsule.workspaceMount, {
            rerender: true,
            restorePinnedScroll: true,
            source: 'capsule',
          });
          result.applied.push('workspaceMount');
          if (Array.isArray(bridgeResult?.warnings)) result.warnings.push(...bridgeResult.warnings);
        } else {
          result.skipped.push('workspaceMount');
          result.warnings.push('workspace bridge unavailable during restore');
        }
      } else {
        result.skipped.push('workspaceMount');
      }

      const gtdNotePath = sanitizeText(capsule?.gtd?.notePath, '');
      if (capsule.gtd && gtdNotePath) {
        const bridge = await this.bridgeRegistry.ensureBridge('gtdCapsuleBridge', gtdNotePath);
        if (bridge && typeof bridge.applyState === 'function') {
          const bridgeResult = await bridge.applyState(capsule.gtd, {
            rerender: true,
            restoreViewContext: true,
            restorePinnedScroll: false,
            source: 'capsule',
          });
          result.applied.push('gtd');
          if (Array.isArray(bridgeResult?.warnings)) result.warnings.push(...bridgeResult.warnings);
        } else {
          result.skipped.push('gtd');
          result.warnings.push('gtd bridge unavailable during restore');
        }
      } else {
        result.skipped.push('gtd');
      }

      const activeFilePath = sanitizeText(capsule?.obsidianWorkspace?.activeFilePath, '');
      const workspaceHostLeafOrLayoutRecorded = resolvedCapsule.restoreHints?.workspaceHostLeafOrLayoutRecorded === true;
      const shouldSkipWorkspaceHostActiveFile =
        !!workspaceNotePath
        && activeFilePath === workspaceNotePath
        && !workspaceHostLeafOrLayoutRecorded;
      if (activeFilePath) {
        if (shouldSkipWorkspaceHostActiveFile) {
          result.skipped.push('activeFile');
          result.warnings.push('Active file reopen skipped because workspace host note was not recorded as an open markdown leaf in this capsule.');
        } else {
          try {
            const file = this.app.vault.getAbstractFileByPath(activeFilePath);
            if (file instanceof TFile) {
              const leaf = this.app.workspace.getLeaf(false);
              await leaf.openFile(file, { active: true });
              result.applied.push('activeFile');
            } else {
              result.skipped.push('activeFile');
              result.warnings.push(`Active file skipped because it no longer exists: ${activeFilePath}`);
            }
          } catch (error) {
            result.warnings.push(`Active file restore failed: ${error.message}`);
          }
        }
      } else {
        result.skipped.push('activeFile');
      }

      result.ok = true;
      result.mode = result.warnings.length > 0 || result.skipped.length > 0 ? 'partial-success' : 'success';
      return result;
    } catch (error) {
      result.errors.push(error.message);
      result.mode = 'failed';
      throw Object.assign(error, { restoreResult: result });
    } finally {
      this.restoreInFlight = false;
    }
  }
}

class CapsuleNameModal extends Modal {
  constructor(app, title, placeholder, initialValue = '') {
    super(app);
    this.titleText = title;
    this.placeholder = placeholder;
    this.initialValue = initialValue;
    this.resolvePromise = null;
    this.resolved = false;
  }

  openAndWait() {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  resolve(value) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolvePromise?.(value);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: this.titleText });
    let currentValue = this.initialValue;
    new Setting(contentEl)
      .setName('Capsule name')
      .addText((text) => {
        text.setPlaceholder(this.placeholder);
        text.setValue(this.initialValue);
        text.onChange((value) => {
          currentValue = value;
        });
        window.setTimeout(() => text.inputEl.focus(), 0);
      });
    const buttonRow = contentEl.createDiv({ cls: 'state-capsules-modal-actions' });
    const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      this.resolve(null);
      this.close();
    };
    const saveBtn = buttonRow.createEl('button', { text: 'Save', cls: 'mod-cta' });
    saveBtn.onclick = () => {
      this.resolve(sanitizeText(currentValue, ''));
      this.close();
    };
  }

  onClose() {
    this.contentEl.empty();
    this.resolve(null);
  }
}

class CapsuleSwitchConfirmModal extends Modal {
  constructor(app, currentCapsule, nextCapsule) {
    super(app);
    this.currentCapsule = currentCapsule;
    this.nextCapsule = nextCapsule;
    this.resolvePromise = null;
    this.resolved = false;
  }

  openAndWait() {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  resolve(value) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolvePromise?.(value);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this.modalEl.addClass('state-capsules-switch-confirm-modal');

    contentEl.createEl('h3', { text: 'Switch Capsule' });
    const summary = contentEl.createDiv({ cls: 'state-capsules-switch-summary' });
    summary.createEl('div', {
      text: `Current capsule: ${this.currentCapsule?.name || 'None'}`,
      cls: 'state-capsules-switch-line',
    });
    summary.createEl('div', {
      text: `Switch to: ${this.nextCapsule?.name || 'Unknown capsule'}`,
      cls: 'state-capsules-switch-line',
    });

    const helper = contentEl.createDiv({ cls: 'state-capsules-helper' });
    helper.setText('Do you want to save the current workspace state back into the current capsule before switching?');

    const buttonRow = contentEl.createDiv({ cls: 'state-capsules-modal-actions' });
    const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      this.resolve('cancel');
      this.close();
    };

    const discardBtn = buttonRow.createEl('button', {
      text: 'Switch Without Saving',
      cls: 'state-capsules-btn',
    });
    discardBtn.onclick = () => {
      this.resolve('discard');
      this.close();
    };

    const saveBtn = buttonRow.createEl('button', {
      text: `Save "${this.currentCapsule?.name || 'Current'}" Then Switch`,
      cls: 'mod-cta state-capsules-btn',
    });
    saveBtn.onclick = () => {
      this.resolve('save');
      this.close();
    };
  }

  onClose() {
    this.modalEl.removeClass('state-capsules-switch-confirm-modal');
    this.contentEl.empty();
    this.resolve('cancel');
  }
}

class CapsuleSuggestModal extends SuggestModal {
  constructor(app, capsules) {
    super(app);
    this.capsules = capsules;
    this.setPlaceholder('Select a capsule');
    this.resolvePromise = null;
    this.resolved = false;
  }

  getSuggestions(query) {
    const normalized = sanitizeText(query, '').toLowerCase();
    return this.capsules.filter((capsule) => {
      if (!normalized) return true;
      return sanitizeText(capsule.name, '').toLowerCase().includes(normalized);
    });
  }

  renderSuggestion(capsule, el) {
    el.createDiv({ text: capsule.name });
    el.createEl('small', {
      text: `${capsule.updatedAt || ''} 路 ${capsule.id}`,
    });
  }

  onChooseSuggestion(capsule, evt) {
    void evt;
    this.resolved = true;
    this.resolvePromise?.(capsule);
  }

  openAndWait() {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onClose() {
    super.onClose();
    if (this.resolved) return;
    this.resolved = true;
    this.resolvePromise?.(null);
  }
}

function compactTimestamp(value) {
  const text = sanitizeText(value, '');
  if (!text) return '-';
  const match = text.match(/^\d{4}-(\d{2}-\d{2}) (\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : text;
}

function clearCapsuleDropState(list) {
  list.removeClass('is-drag-active');
  list.querySelectorAll('.state-capsules-card.is-dragging, .state-capsules-card.is-drop-before, .state-capsules-card.is-drop-after')
    .forEach((element) => {
      element.removeClass('is-dragging', 'is-drop-before', 'is-drop-after');
    });
  delete list.dataset.dragCapsuleId;
}

function getDropPlacement(card, event) {
  const rect = card.getBoundingClientRect();
  const offsetX = event.clientX - rect.left;
  const offsetY = event.clientY - rect.top;
  if (offsetY <= rect.height * 0.34) return 'before';
  if (offsetY >= rect.height * 0.66) return 'after';
  return offsetX < rect.width / 2 ? 'before' : 'after';
}

function renderCapsulesList(container, plugin, capsules, options = {}) {
  const activeId = plugin.repository.store.activeCapsuleId;
  const draggable = options.draggable === true;
  const list = container.createDiv({
    cls: `state-capsules-list${draggable ? ' is-draggable' : ''}`,
  });

  if (capsules.length === 0) {
    const empty = list.createDiv({ cls: 'state-capsules-empty' });
    empty.createEl('div', { text: options.emptyTitle || 'No capsules saved yet.' });
    empty.createEl('small', { text: options.emptySubtitle || 'Create one from your current workspace state.' });
    return list;
  }

  const refreshOwner = async () => {
    if (typeof options.onRefresh === 'function') {
      await options.onRefresh();
    }
  };

  capsules.forEach((capsule) => {
    const isActive = capsule.id === activeId;
    const card = list.createDiv({
      cls: `state-capsules-card${isActive ? ' is-active' : ''}`,
    });
    card.dataset.capsuleId = capsule.id;
    card.setAttr('title', capsule.name);
    if (draggable) card.draggable = true;

    const cardHead = card.createDiv({ cls: 'state-capsules-card-head' });
    const headText = cardHead.createDiv({ cls: 'state-capsules-card-head-text' });
    headText.createEl('div', { text: capsule.name, cls: 'state-capsules-card-title' });

    const metaRow = headText.createDiv({ cls: 'state-capsules-card-meta-row' });
    metaRow.createEl('span', {
      text: `Updated ${compactTimestamp(capsule.updatedAt)}`,
      cls: 'state-capsules-card-meta',
    });

    if (draggable) {
      cardHead.createDiv({
        text: '::',
        cls: 'state-capsules-card-handle',
        attr: { 'aria-label': 'Drag capsule to reorder' },
      });
    }

    const cardActions = card.createDiv({ cls: 'state-capsules-card-actions' });
    const switchBtn = cardActions.createEl('button', {
      text: isActive ? 'Switch Again' : 'Switch',
      cls: 'mod-cta state-capsules-btn',
    });
    switchBtn.onclick = async () => {
      await plugin.restoreCapsuleById(capsule.id);
      await refreshOwner();
    };

    const renameBtn = cardActions.createEl('button', {
      text: 'Rename',
      cls: 'state-capsules-btn',
    });
    renameBtn.onclick = async () => {
      await plugin.renameCapsuleById(capsule.id);
      await refreshOwner();
    };

    const deleteBtn = cardActions.createEl('button', {
      text: 'Delete',
      cls: 'state-capsules-btn is-danger',
    });
    deleteBtn.onclick = async () => {
      await plugin.deleteCapsuleById(capsule.id);
      await refreshOwner();
    };

    if (!draggable) return;

    card.addEventListener('dragstart', (event) => {
      list.dataset.dragCapsuleId = capsule.id;
      list.addClass('is-drag-active');
      card.addClass('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', capsule.id);
      }
    });

    card.addEventListener('dragend', () => {
      clearCapsuleDropState(list);
    });

    card.addEventListener('dragover', (event) => {
      const sourceId = list.dataset.dragCapsuleId || '';
      if (!sourceId || sourceId === capsule.id) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      list.querySelectorAll('.state-capsules-card.is-drop-before, .state-capsules-card.is-drop-after')
        .forEach((element) => element.removeClass('is-drop-before', 'is-drop-after'));
      card.addClass(getDropPlacement(card, event) === 'before' ? 'is-drop-before' : 'is-drop-after');
    });

    card.addEventListener('drop', async (event) => {
      const sourceId = list.dataset.dragCapsuleId || '';
      if (!sourceId || sourceId === capsule.id) {
        clearCapsuleDropState(list);
        return;
      }
      event.preventDefault();
      const placement = getDropPlacement(card, event);
      clearCapsuleDropState(list);
      await plugin.moveCapsuleById(sourceId, capsule.id, placement);
      await refreshOwner();
    });
  });

  if (draggable) {
    list.addEventListener('dragover', (event) => {
      if (!list.dataset.dragCapsuleId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    });

    list.addEventListener('drop', async (event) => {
      const sourceId = list.dataset.dragCapsuleId || '';
      const targetCard = event.target?.closest?.('.state-capsules-card');
      if (!sourceId || targetCard) return;
      event.preventDefault();
      clearCapsuleDropState(list);
      await plugin.moveCapsuleById(sourceId, null, 'after');
      await refreshOwner();
    });
  }

  return list;
}

class CapsuleManagerModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    this.modalEl.addClass('state-capsules-manager-modal');
    this.modalEl.style.maxWidth = '1320px';
    this.modalEl.style.width = '96vw';
    this.modalEl.style.height = '84vh';
    this.contentEl.style.display = 'flex';
    this.contentEl.style.flexDirection = 'column';
    this.contentEl.style.height = '100%';
    this.contentEl.style.gap = '10px';
    await this.refresh();
  }

  async refresh() {
    const { contentEl } = this;
    contentEl.empty();

    const wrap = contentEl.createDiv({ cls: 'state-capsules-panel state-capsules-manager' });
    const header = wrap.createDiv({ cls: 'state-capsules-panel-header' });
    const titleBlock = header.createDiv({ cls: 'state-capsules-panel-title-block' });
    titleBlock.createEl('div', { text: 'State Capsules', cls: 'state-capsules-panel-title' });
    titleBlock.createEl('div', {
      text: 'Quickly switch your Obsidian work scenes',
      cls: 'state-capsules-panel-subtitle',
    });

    const activeCapsule = this.plugin.repository.getActiveCapsule();
    const actions = header.createDiv({ cls: 'state-capsules-panel-actions' });
    const saveBtn = actions.createEl('button', {
      text: 'Save as New Capsule',
      cls: 'mod-cta state-capsules-btn',
    });
    saveBtn.onclick = async () => {
      await this.plugin.saveCurrentAsNewCapsule();
      await this.refresh();
    };

    const overwriteBtn = actions.createEl('button', {
      text: activeCapsule ? `Save to Active: ${activeCapsule.name}` : 'Save to Active Capsule',
      cls: 'state-capsules-btn',
    });
    overwriteBtn.disabled = !activeCapsule;
    overwriteBtn.title = activeCapsule
      ? `Overwrite the active capsule: ${activeCapsule.name}`
      : 'Switch to or create a capsule first.';
    overwriteBtn.onclick = async () => {
      await this.plugin.overwriteActiveCapsule();
      await this.refresh();
    };

    const statusBar = wrap.createDiv({ cls: 'state-capsules-status' });
    statusBar.setText(
      activeCapsule
        ? `Active capsule: ${activeCapsule.name}`
        : 'No active capsule selected'
    );

    const helper = wrap.createDiv({ cls: 'state-capsules-helper' });
    helper.setText('Drag capsules to reorder. Bind "State Capsules: Open capsule manager modal" to a hotkey for quick access.');

    const capsules = this.plugin.repository.listCapsules();
    renderCapsulesList(wrap, this.plugin, capsules, {
      draggable: true,
      onRefresh: async () => this.refresh(),
    });

    const logSection = wrap.createDiv({ cls: 'state-capsules-log-panel' });
    const logHead = logSection.createDiv({ cls: 'state-capsules-log-head' });
    logHead.createEl('div', { text: 'Note Event Log', cls: 'state-capsules-card-title' });
    logHead.createEl('div', {
      text: `${this.plugin.repository.store.noteEventLog.length} entries`,
      cls: 'state-capsules-card-meta',
    });

    const trackingRow = logSection.createDiv({ cls: 'state-capsules-card-actions' });
    const trackingEnabled = this.plugin.repository.isNoteTrackingEnabled();
    const trackingDeferred = this.plugin.isNoteTrackingDeferred();
    const toggleTrackingBtn = trackingRow.createEl('button', {
      text: trackingEnabled ? 'Pause Tracking' : 'Enable Tracking',
      cls: 'state-capsules-btn',
    });
    toggleTrackingBtn.onclick = async () => {
      await this.plugin.setNoteTrackingEnabled(!trackingEnabled);
      await this.refresh();
    };

    if (trackingEnabled && trackingDeferred) {
      const resumeTrackingBtn = trackingRow.createEl('button', {
        text: 'Resume Now',
        cls: 'state-capsules-btn',
      });
      resumeTrackingBtn.onclick = async () => {
        await this.plugin.armNoteTrackingSessionIfNeeded();
        await this.refresh();
      };
    }

    const clearLogBtn = trackingRow.createEl('button', {
      text: 'Clear Log',
      cls: 'state-capsules-btn is-danger',
    });
    clearLogBtn.onclick = async () => {
      const ok = window.confirm('Clear the note event log? Existing capsules will stay untouched.');
      if (!ok) return;
      await this.plugin.clearNoteEventLog();
      await this.refresh();
    };

    const logState = logSection.createDiv({ cls: 'state-capsules-helper' });
    logState.setText(
      trackingEnabled
        ? (
          trackingDeferred
            ? 'Tracking preference is on, but this session is still paused. It will resume on your first State Capsules interaction, or you can click "Resume Now".'
            : 'Tracking is on. New create/rename/delete events will be recorded.'
        )
        : 'Tracking is off. Previously recorded history is kept, but new events will not be logged.'
    );

    const recentEvents = this.plugin.repository.getRecentNoteEvents(6);
    if (recentEvents.length === 0) {
      logSection.createDiv({ cls: 'state-capsules-empty', text: 'No note events recorded yet.' });
    } else {
      const eventList = logSection.createDiv({ cls: 'state-capsules-log-list' });
      recentEvents.forEach((event) => {
        const row = eventList.createDiv({ cls: 'state-capsules-log-row' });
        row.createEl('div', {
          text: `${event.ts} | ${event.type}`,
          cls: 'state-capsules-card-meta',
        });
        const label = event.type === 'rename'
          ? `${event.oldPath} -> ${event.path}`
          : event.path;
        row.createEl('div', { text: label, cls: 'state-capsules-log-path' });
      });
    }
  }

  onClose() {
    this.modalEl.style.maxWidth = '';
    this.modalEl.style.width = '';
    this.modalEl.style.height = '';
    this.contentEl.style.display = '';
    this.contentEl.style.flexDirection = '';
    this.contentEl.style.height = '';
    this.contentEl.style.gap = '';
    this.contentEl.empty();
  }
}

class StateCapsulesView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_STATE_CAPSULES;
  }

  getDisplayText() {
    return 'State Capsules';
  }

  getIcon() {
    return 'layers';
  }

  async onOpen() {
    this.contentEl.addClass('state-capsules-view');
    await this.refresh();
  }

  async refresh() {
    const { contentEl } = this;
    contentEl.empty();

    const wrap = contentEl.createDiv({ cls: 'state-capsules-panel' });
    const header = wrap.createDiv({ cls: 'state-capsules-panel-header' });
    const titleBlock = header.createDiv({ cls: 'state-capsules-panel-title-block' });
    titleBlock.createEl('div', { text: 'State Capsules', cls: 'state-capsules-panel-title' });
    titleBlock.createEl('div', {
      text: 'Save and switch your Obsidian work scenes',
      cls: 'state-capsules-panel-subtitle',
    });

    const activeCapsule = this.plugin.repository.getActiveCapsule();
    const actions = header.createDiv({ cls: 'state-capsules-panel-actions' });
    const saveBtn = actions.createEl('button', {
      text: 'Save as New Capsule',
      cls: 'mod-cta state-capsules-btn',
    });
    saveBtn.onclick = async () => {
      await this.plugin.saveCurrentAsNewCapsule();
      await this.refresh();
    };

    const overwriteBtn = actions.createEl('button', {
      text: activeCapsule ? `Save to Active: ${activeCapsule.name}` : 'Save to Active Capsule',
      cls: 'state-capsules-btn',
    });
    overwriteBtn.disabled = !activeCapsule;
    overwriteBtn.title = activeCapsule
      ? `Overwrite the active capsule: ${activeCapsule.name}`
      : 'Switch to or create a capsule first.';
    overwriteBtn.onclick = async () => {
      await this.plugin.overwriteActiveCapsule();
      await this.refresh();
    };

    const statusBar = wrap.createDiv({ cls: 'state-capsules-status' });
    statusBar.setText(
      activeCapsule
        ? `Active capsule: ${activeCapsule.name}`
        : 'No active capsule selected'
    );

    const capsules = this.plugin.repository.listCapsules();
    renderCapsulesList(wrap, this.plugin, capsules, {
      onRefresh: async () => this.refresh(),
    });
  }
}
module.exports = class StateCapsulesPlugin extends Plugin {
  isNoteTrackingDeferred() {
    return this.repository?.isNoteTrackingEnabled?.() === true && this.deferNoteTrackingUntilInteraction === true;
  }

  async armNoteTrackingSessionIfNeeded() {
    if (!this.repository?.isNoteTrackingEnabled?.()) {
      this.deferNoteTrackingUntilInteraction = false;
      this.noteEventTracker?.disable();
      return false;
    }
    if (!this.deferNoteTrackingUntilInteraction) return false;
    this.noteEventTracker?.enable();
    this.deferNoteTrackingUntilInteraction = false;
    await this.refreshViews();
    new Notice('State Capsules note tracking resumed for this session.');
    return true;
  }

  getNoteEventLogPath() {
    return `${this.app.vault.configDir}/plugins/${this.manifest.id}/note-event-log.json`;
  }

  async loadNoteEventLog() {
    const path = this.getNoteEventLogPath();
    try {
      const exists = await this.app.vault.adapter.exists(path);
      if (!exists) return [];
      const raw = await this.app.vault.adapter.read(path);
      return normalizeNoteEventLog(JSON.parse(raw));
    } catch (error) {
      console.warn('[State Capsules] Failed to load note event log:', error);
      return [];
    }
  }

  async saveNoteEventLog(events) {
    const path = this.getNoteEventLogPath();
    const payload = {
      schemaVersion: NOTE_EVENT_LOG_SCHEMA_VERSION,
      updatedAt: nowString(),
      events: normalizeNoteEventLog(events),
    };
    await this.app.vault.adapter.write(path, JSON.stringify(payload, null, 2));
  }

  async saveMainStore(store) {
    const normalized = normalizeStore(store);
    await this.saveData({
      schemaVersion: normalized.schemaVersion,
      activeCapsuleId: normalized.activeCapsuleId,
      capsuleOrder: normalized.capsuleOrder,
      noteTracking: normalized.noteTracking,
      capsules: normalized.capsules,
    });
  }

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.repository = new CapsuleRepository(this);
    await this.repository.load();
    this.bridgeRegistry = new BridgeRegistry(this.app, this.settings);
    this.workspaceService = new ObsidianWorkspaceService(this.app);
    this.assembler = new CapsuleAssembler(this.app, this.bridgeRegistry, this.workspaceService);
    this.restoreCoordinator = new CapsuleRestoreCoordinator(this.app, this.bridgeRegistry, this.workspaceService, this.repository);
    this.noteEventTracker = new NoteEventTracker(this.app, this.repository);
    this.deferNoteTrackingUntilInteraction = this.repository.isNoteTrackingEnabled();
    this.noteEventTracker.disable();

    this.registerView(
      VIEW_TYPE_STATE_CAPSULES,
      (leaf) => new StateCapsulesView(leaf, this)
    );

    this.addCommand({
      id: 'save-current-as-new-capsule',
      name: 'Save current state as new capsule',
      callback: async () => this.saveCurrentAsNewCapsule(),
    });

    this.addCommand({
      id: 'overwrite-active-capsule',
      name: 'Overwrite active capsule',
      callback: async () => this.overwriteActiveCapsule(),
    });

    this.addCommand({
      id: 'switch-to-capsule',
      name: 'Switch to capsule',
      callback: async () => this.switchCapsule(),
    });

    this.addCommand({
      id: 'open-state-capsules-panel',
      name: 'Open state capsules panel',
      callback: async () => this.activateView(),
    });

    this.addCommand({
      id: 'open-capsule-manager-modal',
      name: 'Open capsule manager modal',
      callback: async () => this.openCapsuleManagerModal(),
    });

    this.addCommand({
      id: 'toggle-note-event-tracking',
      name: 'Toggle note event tracking',
      callback: async () => this.toggleNoteTracking(),
    });

    this.addCommand({
      id: 'clear-note-event-log',
      name: 'Clear note event log',
      callback: async () => this.clearNoteEventLog(),
    });

    this.addRibbonIcon('layers', 'Open State Capsules manager', async () => {
      await this.openCapsuleManagerModal();
    });
  }

  async onunload() {
    this.noteEventTracker?.disable();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_STATE_CAPSULES);
  }

  async activateView() {
    await this.armNoteTrackingSessionIfNeeded();
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_STATE_CAPSULES)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({
        type: VIEW_TYPE_STATE_CAPSULES,
        active: true,
      });
    }
    await this.app.workspace.revealLeaf(leaf);
    await this.refreshViews();
  }

  async refreshViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_STATE_CAPSULES);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view && typeof view.refresh === 'function') {
        await view.refresh();
      }
    }
  }

  async setNoteTrackingEnabled(enabled) {
    await this.repository.setNoteTrackingEnabled(enabled);
    if (enabled) {
      this.deferNoteTrackingUntilInteraction = false;
      this.noteEventTracker.enable();
    } else {
      this.deferNoteTrackingUntilInteraction = false;
      this.noteEventTracker.disable();
    }
    await this.refreshViews();
    new Notice(enabled ? 'State Capsules note tracking enabled.' : 'State Capsules note tracking paused.');
  }

  async openCapsuleManagerModal() {
    await this.armNoteTrackingSessionIfNeeded();
    const modal = new CapsuleManagerModal(this.app, this);
    modal.open();
  }

  async toggleNoteTracking() {
    const next = !this.repository.isNoteTrackingEnabled();
    await this.setNoteTrackingEnabled(next);
  }

  async clearNoteEventLog() {
    await this.repository.clearNoteEventLog();
    await this.refreshViews();
    new Notice('State Capsules note event log cleared.');
  }

  async saveCurrentAsNewCapsule() {
    await this.armNoteTrackingSessionIfNeeded();
    const modal = new CapsuleNameModal(this.app, 'Save capsule', 'e.g. Radar manual research');
    const name = await modal.openAndWait();
    if (!name) return;
    const capsule = this.assembler.captureCapsule(name);
    await this.repository.createCapsule(capsule);
    await this.refreshViews();
    const warningText = Array.isArray(capsule.meta?.warnings) && capsule.meta.warnings.length > 0
      ? ` Warnings: ${capsule.meta.warnings.join(' | ')}`
      : '';
    new Notice(`Capsule saved: ${capsule.name}.${warningText}`);
  }

  async saveCurrentIntoCapsule(capsule, options = {}) {
    if (!capsule) {
      new Notice('Capsule not found.');
      return null;
    }
    const next = this.assembler.captureCapsule(capsule.name);
    next.id = capsule.id;
    next.createdAt = capsule.createdAt;
    next.updatedAt = nowString();
    await this.repository.updateCapsule(capsule.id, next, { setActive: false });
    await this.refreshViews();
    if (options.notice !== false) {
      new Notice(`Capsule updated: ${next.name}`);
    }
    return next;
  }

  async overwriteActiveCapsule() {
    await this.armNoteTrackingSessionIfNeeded();
    const activeCapsule = this.repository.getActiveCapsule();
    if (!activeCapsule) {
      new Notice('No active capsule to overwrite.');
      return;
    }
    const ok = window.confirm(`Save the current state into "${activeCapsule.name}"? This will overwrite its previous snapshot.`);
    if (!ok) return;
    await this.saveCurrentIntoCapsule(activeCapsule);
  }

  async overwriteCapsuleById(id) {
    const capsule = this.repository.getCapsule(id);
    if (!capsule) {
      new Notice('Capsule not found.');
      return;
    }
    await this.saveCurrentIntoCapsule(capsule);
  }

  async deleteCapsuleById(id) {
    const capsule = this.repository.getCapsule(id);
    if (!capsule) return;
    const ok = window.confirm(`Delete capsule "${capsule.name}"? This cannot be undone.`);
    if (!ok) return;
    await this.repository.deleteCapsule(id);
    await this.refreshViews();
    new Notice(`Capsule deleted: ${capsule.name}`);
  }

  async renameCapsuleById(id) {
    const capsule = this.repository.getCapsule(id);
    if (!capsule) {
      new Notice('Capsule not found.');
      return;
    }
    const modal = new CapsuleNameModal(this.app, 'Rename capsule', 'Enter a new capsule name', capsule.name);
    const name = await modal.openAndWait();
    if (!name) return;
    const ok = window.confirm(`Rename capsule "${capsule.name}" to "${name}"?`);
    if (!ok) return;
    const next = Object.assign({}, capsule, {
      name,
      updatedAt: nowString(),
    });
    await this.repository.updateCapsule(capsule.id, next, { setActive: false });
    await this.refreshViews();
    new Notice(`Capsule renamed: ${name}`);
  }

  async restoreCapsuleById(id) {
    const capsule = this.repository.getCapsule(id);
    if (!capsule) {
      new Notice('Capsule not found.');
      return;
    }
    await this.restoreCapsule(capsule);
  }

  async restoreCapsule(capsule) {
    await this.armNoteTrackingSessionIfNeeded();
    const approved = await this.confirmSwitchCapsule(capsule);
    if (!approved) return null;
    try {
      const result = await this.restoreCoordinator.restoreCapsule(capsule);
      await this.repository.setActiveCapsuleId(capsule.id);
      await this.refreshViews();
      if (result.mode === 'success') {
        new Notice(`Capsule restored: ${capsule.name}`);
      } else {
        new Notice(`Capsule partially restored: ${capsule.name}`);
      }
      return result;
    } catch (error) {
      const restoreResult = error.restoreResult;
      const detail = restoreResult?.errors?.join(' | ') || error.message;
      new Notice(`Capsule restore failed: ${detail}`);
      throw error;
    }
  }

  async confirmSwitchCapsule(nextCapsule) {
    const target = nextCapsule?.id ? this.repository.getCapsule(nextCapsule.id) : nextCapsule;
    if (!target) {
      new Notice('Capsule not found.');
      return false;
    }

    const currentCapsule = this.repository.getActiveCapsule();
    if (!currentCapsule || currentCapsule.id === target.id) {
      return true;
    }

    const modal = new CapsuleSwitchConfirmModal(this.app, currentCapsule, target);
    const decision = await modal.openAndWait();
    if (decision === 'cancel') return false;
    if (decision === 'save') {
      await this.saveCurrentIntoCapsule(currentCapsule, { notice: true });
    }
    return true;
  }

  async moveCapsuleById(sourceId, targetId = null, placement = 'before') {
    const moved = await this.repository.moveCapsule(sourceId, targetId, placement);
    if (!moved) return false;
    await this.refreshViews();
    return true;
  }

  async switchCapsule() {
    await this.armNoteTrackingSessionIfNeeded();
    const capsules = this.repository.listCapsules();
    if (capsules.length === 0) {
      new Notice('No capsules saved yet.');
      return;
    }
    const modal = new CapsuleSuggestModal(this.app, capsules);
    const selected = await modal.openAndWait();
    if (!selected) return;
    await this.restoreCapsule(selected);
  }
};

