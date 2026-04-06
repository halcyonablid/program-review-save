const { Notice, Plugin, PluginSettingTab, Setting, TFile } = require('obsidian');

const DEFAULT_SETTINGS = {
  sourceNotePath: '做mermaid图的悬浮窗.md',
};

const WIDGET_ID = 'mermaid-floating-widget';

function sanitizeText(value, fallback = '') {
  const text = String(value == null ? '' : value).trim();
  return text || fallback;
}

class MermaidFloatingWidgetSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Mermaid Floating Widget' });

    new Setting(containerEl)
      .setName('Source note path')
      .setDesc('Path or basename of the note that contains the Mermaid floating widget Templater script.')
      .addText((text) => {
        text.setPlaceholder(DEFAULT_SETTINGS.sourceNotePath);
        text.setValue(this.plugin.settings.sourceNotePath);
        text.onChange(async (value) => {
          this.plugin.settings.sourceNotePath = sanitizeText(value, DEFAULT_SETTINGS.sourceNotePath);
          await this.plugin.saveSettings();
        });
      });
  }
}

module.exports = class MermaidFloatingWidgetPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.addRibbonIcon('waypoints', 'Toggle Mermaid floating widget', async () => {
      await this.toggleWidget();
    });

    this.addCommand({
      id: 'toggle-mermaid-floating-widget',
      name: 'Toggle Mermaid floating widget',
      callback: async () => this.toggleWidget(),
    });

    this.addSettingTab(new MermaidFloatingWidgetSettingTab(this.app, this));
  }

  async onunload() {
    this.closeWidgetIfOpen();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getConfiguredSourcePath() {
    return sanitizeText(this.settings?.sourceNotePath, DEFAULT_SETTINGS.sourceNotePath);
  }

  resolveSourceFile() {
    const configured = this.getConfiguredSourcePath();
    if (!configured) return null;

    const exact = this.app.vault.getAbstractFileByPath(configured);
    if (exact instanceof TFile) return exact;

    const normalized = configured.replace(/\\/g, '/').replace(/^\/+/, '');
    const exactNormalized = this.app.vault.getAbstractFileByPath(normalized);
    if (exactNormalized instanceof TFile) return exactNormalized;

    const targetBase = normalized.replace(/^.*\//, '').replace(/\.md$/i, '').toLowerCase();
    const files = this.app.vault.getMarkdownFiles();

    const exactBase = files.find((file) => file.basename.toLowerCase() === targetBase);
    if (exactBase) return exactBase;

    const suffixMatch = files.find((file) => file.path.toLowerCase().endsWith(normalized.toLowerCase()));
    if (suffixMatch) return suffixMatch;

    return null;
  }

  extractTemplaterScript(markdown) {
    const text = String(markdown || '');
    const start = text.indexOf('<%*');
    if (start < 0) return '';
    const end = text.lastIndexOf('%>');
    if (end < 0 || end <= start) return '';
    return text.slice(start + 3, end).trim();
  }

  async evaluateSourceScript(file) {
    const markdown = await this.app.vault.cachedRead(file);
    const script = this.extractTemplaterScript(markdown);
    if (!script) {
      throw new Error(`No Templater script block found in ${file.path}`);
    }

    window.__mermaidFloatingWidgetPluginMode = true;
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const runner = new AsyncFunction('app', 'tp', script);
    await runner(this.app, { obsidian: require('obsidian') });
  }

  closeWidgetIfOpen() {
    const existing = document.getElementById(WIDGET_ID);
    if (!existing) return false;
    try {
      if (typeof existing.cleanup === 'function') existing.cleanup();
    } catch (error) {
      console.warn('[Mermaid Floating Widget] Cleanup failed:', error);
    }
    existing.remove();
    return true;
  }

  async toggleWidget() {
    try {
      window.__mermaidFloatingWidgetPluginMode = true;

      if (typeof window.__toggleMermaidFloatingWidget === 'function') {
        await window.__toggleMermaidFloatingWidget();
        return;
      }

      const file = this.resolveSourceFile();
      if (!file) {
        new Notice(`Mermaid source note not found: ${this.getConfiguredSourcePath()}`);
        return;
      }

      await this.evaluateSourceScript(file);
    } catch (error) {
      console.error('[Mermaid Floating Widget] Toggle failed:', error);
      new Notice(`Mermaid widget failed: ${error.message}`);
    }
  }
};
