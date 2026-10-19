/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var gWorkspaces = {
  _initialized: false,
  _workspaces: [],

  PREF_DATA: "browser.workspaces.data",
  TAB_ATTR: "workspace-id",

  _getActiveWorkspaceId() {
    const tab = gBrowser.selectedTab;
    return tab?.getAttribute(this.TAB_ATTR) || (this._workspaces[0]?.id ?? null);
  },

  init() {
    if (this._initialized) return;
    this._initialized = true;
    this._load();
    if (!this._workspaces.length) {
      this._workspaces.push(this._makeWorkspace("Default", "🏠", "#e76d83"));
      this._save();
    }
    this._updateButton();
    gBrowser.tabContainer.addEventListener("TabOpen", e => this._onTabOpen(e));
    // Restored tabs fire TabOpen (getting the active workspace) before their
    // saved values land, so re-read everything once restore has finished.
    SessionStore.promiseAllWindowsRestored.then(() => this.migrateCurrentTabs());
    window.addEventListener("SSWindowRestored", () => this.migrateCurrentTabs());
    gBrowser.tabContainer.addEventListener("SSTabRestoring", e => {
      if (this._restoreTabWs(e.target)) {
        this._updateButton();
        this._applyCollapsed();
      }
    });
    gBrowser.tabContainer.addEventListener("TabSelect", () => {
      this._moveSelectedWorkspaceTabsToFront();
      this._updateButton();
      this._applyCollapsed();
    });
    gBrowser.tabContainer.addEventListener("TabShow", e => {
      const wsId = e.target.getAttribute(this.TAB_ATTR);
      if (wsId && wsId !== this._workspaces[0]?.id) {
        this._moveWorkspaceTabsToFront(wsId);
      }
    });
    this._initTabContextMenu();
    setTimeout(() => this._applyCollapsed(), 0);
    const btn = document.getElementById("workspaces-toolbar-button");
    if (btn) btn.addEventListener("mousedown", e => { e.preventDefault(); this.openPanel(btn); });
  },

  _makeWorkspace(name, icon, color) {
    return { id: "ws-" + Date.now() + "-" + Math.floor(Math.random() * 1e6), name, icon, color };
  },

  _load() {
    try {
      const raw = Services.prefs.getStringPref(this.PREF_DATA, "");
      if (raw) this._workspaces = JSON.parse(raw).workspaces || [];
    } catch (e) {}
  },

  _save() {
    try {
      Services.prefs.setStringPref(this.PREF_DATA, JSON.stringify({ workspaces: this._workspaces }));
    } catch (e) {}
  },

  _onTabOpen(e) {
    const tab = e.target;
    // Like Zen: new tabs land with the normal tabs, not inside a folder.
    if (!tab.hasAttribute(this.TAB_ATTR)) {
      const looseId = this._workspaces[0]?.id;
      if (looseId) this._setTabWs(tab, looseId);
    }
  },

  // The attribute is what the UI reads; SessionStore's custom tab value is
  // what survives restarts.
  _setTabWs(tab, wsId) {
    tab.setAttribute(this.TAB_ATTR, wsId);
    this._setTabWorkspaceColor(tab, wsId);
    try {
      SessionStore.setCustomTabValue(tab, this.TAB_ATTR, wsId);
    } catch (e) {}
  },

  _restoreTabWs(tab) {
    let saved = "";
    try {
      saved = SessionStore.getCustomTabValue(tab, this.TAB_ATTR);
    } catch (e) {}
    if (saved && this._workspaces.some(w => w.id === saved)) {
      tab.setAttribute(this.TAB_ATTR, saved);
      this._setTabWorkspaceColor(tab, saved);
      return true;
    }
    return false;
  },

  migrateCurrentTabs() {
    const defaultId = this._workspaces[0]?.id;
    if (!defaultId) return;
    for (const tab of gBrowser.tabs) {
      if (!this._restoreTabWs(tab) && !tab.hasAttribute(this.TAB_ATTR)) {
        this._setTabWs(tab, defaultId);
      }
    }
    this._moveWorkspaceTabsToLeft();
    this._updateButton();
    this._applyCollapsed();
  },

  _setTabWorkspaceColor(tab, wsId) {
    const workspace = this._workspaces.find(ws => ws.id === wsId);
    if (!workspace) return;
    tab.style.setProperty("--workspace-tab-color", workspace.color);
    tab.toggleAttribute("workspace-folder", workspace !== this._workspaces[0]);
  },

  _refreshTabWorkspaceColors() {
    for (const tab of gBrowser.tabs) {
      this._setTabWorkspaceColor(tab, tab.getAttribute(this.TAB_ATTR));
    }
  },

  _applyCollapsed() {
    const collapsed = new Set(this._workspaces.filter(w => w.collapsed).map(w => w.id));
    for (const tab of gBrowser.tabs) {
      const hide = collapsed.has(tab.getAttribute(this.TAB_ATTR)) &&
        !tab.selected && !tab.pinned;
      if (hide && !tab.hidden) {
        gBrowser.hideTab(tab);
      } else if (!hide && tab.hidden && tab.hasAttribute(this.TAB_ATTR)) {
        // Hidden state is restored from the session, so tabs hidden in an
        // earlier run must be shown again when their workspace is expanded.
        gBrowser.showTab(tab);
      }
    }
  },

  toggleCollapsed(ws) {
    ws.collapsed = !ws.collapsed;
    this._save();
    if (!ws.collapsed && ws !== this._workspaces[0]) {
      this._moveWorkspaceTabsToFront(ws.id);
    }
    this._applyCollapsed();
  },

  _moveWorkspaceTabsToFront(wsId) {
    let index = Array.from(gBrowser.tabs).findIndex(tab => !tab.pinned);
    if (index < 0) index = gBrowser.tabs.length;
    for (const tab of this._getTabsForWorkspace(wsId)) {
      if (!tab.pinned) gBrowser.moveTabTo(tab, { tabIndex: index++ });
    }
  },

  _moveWorkspaceTabsToLeft() {
    for (const workspace of this._workspaces.slice(1).reverse()) {
      this._moveWorkspaceTabsToFront(workspace.id);
    }
  },

  _moveSelectedWorkspaceTabsToFront() {
    const wsId = this._getActiveWorkspaceId();
    if (wsId && wsId !== this._workspaces[0]?.id) {
      this._moveWorkspaceTabsToFront(wsId);
    }
  },

  moveTab(tab, wsId) {
    this._setTabWs(tab, wsId);
    this._applyCollapsed();
    this._updateButton();
  },

  unloadWorkspace(wsId) {
    let count = 0;
    for (const tab of this._getTabsForWorkspace(wsId)) {
      if (!tab.selected && !tab.hasAttribute("pending") && gBrowser.discardBrowser(tab)) count++;
    }
    return count;
  },

  _initTabContextMenu() {
    const ctx = document.getElementById("tabContextMenu");
    if (!ctx) return;
    const menu = document.createXULElement("menu");
    menu.id = "context_moveTabToWorkspace";
    menu.setAttribute("label", "Move to Workspace");
    const popup = document.createXULElement("menupopup");
    menu.appendChild(popup);
    const anchor = document.getElementById("context_moveTabOptions");
    ctx.insertBefore(menu, anchor ? anchor.nextSibling : null);

    popup.addEventListener("popupshowing", () => {
      popup.textContent = "";
      const tab = TabContextMenu.contextTab;
      if (!tab) return;
      const current = tab.getAttribute(this.TAB_ATTR);
      for (const ws of this._workspaces) {
        const item = document.createXULElement("menuitem");
        item.setAttribute("label", ws.icon + " " + ws.name);
        item.setAttribute("type", "radio");
        if (ws.id === current) item.setAttribute("checked", "true");
        item.addEventListener("command", () => {
          const tabs = tab.multiselected ? gBrowser.selectedTabs : [tab];
          for (const t of tabs) this._setTabWs(t, ws.id);
          this._applyCollapsed();
          this._updateButton();
        });
        popup.appendChild(item);
      }
    });
  },

  _getTabsForWorkspace(wsId) {
    return Array.from(gBrowser.tabs).filter(t => t.getAttribute(this.TAB_ATTR) === wsId);
  },

  _updateButton() {
    const btn = document.getElementById("workspaces-toolbar-button");
    if (!btn) return;
    const activeId = this._getActiveWorkspaceId();
    const ws = this._workspaces.find(w => w.id === activeId) || this._workspaces[0];
    if (!ws) return;
    btn.style.setProperty("--workspace-color", ws.color);
    const label = btn.querySelector(".toolbarbutton-text");
    if (label) label.textContent = ws.icon + " " + ws.name;
  },

  openPanel(anchor) {
    const panel = document.getElementById("workspaces-panel");
    if (!panel) return;
    if (panel.state === "open" || panel.state === "showing") {
      panel.hidePopup();
      return;
    }
    this._renderPanel();
    panel.openPopup(anchor, "after_start", 0, 4, false, false);
  },

  _closePanel() {
    document.getElementById("workspaces-panel")?.hidePopup();
  },

  _renderPanel() {
    const body = document.getElementById("workspaces-panel-body");
    if (!body) return;
    body.textContent = "";

    const header = this._el("div", "workspaces-panel-header");
    const title = this._el("span");
    title.textContent = "Workspaces";
    header.appendChild(title);

    const addBtn = this._el("button", "workspace-add");
    addBtn.textContent = "+";
    addBtn.title = "New workspace";
    addBtn.addEventListener("click", () => {
      const existing = body.querySelector(".workspace-editor");
      if (existing) { existing.remove(); return; }
      body.appendChild(this._buildEditor(null));
    });
    header.appendChild(addBtn);
    body.appendChild(header);

    // Like Zen: folder workspaces on top, then the first (default) workspace
    // as a plain list of normal tabs.
    const activeId = this._getActiveWorkspaceId();
    const [loose, ...folders] = this._workspaces;
    for (const ws of folders) {
      body.appendChild(this._buildWorkspaceSection(ws, activeId));
    }
    if (loose) {
      if (folders.length) body.appendChild(this._el("div", "workspace-divider"));
      body.appendChild(this._buildLooseSection(loose));
    }
  },

  _buildLooseSection(ws) {
    const section = this._el("div", "workspace-loose");
    const head = this._el("div", "workspace-loose-head");
    const newTab = this._el("button", "workspace-newtab");
    newTab.textContent = "+  New Tab";
    newTab.addEventListener("click", () => {
      const tab = gBrowser.addTrustedTab(BROWSER_NEW_TAB_URL);
      this._setTabWs(tab, ws.id);
      gBrowser.selectedTab = tab;
      this._closePanel();
    });
    const sleepBtn = this._el("button", "workspace-unload");
    sleepBtn.textContent = "💤";
    sleepBtn.title = "Unload these tabs from memory";
    sleepBtn.addEventListener("click", e => {
      e.stopPropagation();
      this.unloadWorkspace(ws.id);
      this._renderPanel();
    });
    head.append(newTab, sleepBtn);
    section.appendChild(head);
    const list = this._el("div", "workspace-tabs-list");
    for (const tab of this._getTabsForWorkspace(ws.id)) list.appendChild(this._buildTabRow(tab));
    section.appendChild(list);
    return section;
  },

  _buildUrlAdder(ws) {
    const input = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
    input.className = "workspace-url-input";
    input.placeholder = "Add site to " + ws.name + " (Enter)";
    input.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this._addingWs = null;
        this._renderPanel();
      } else if (e.key === "Enter" && input.value.trim()) {
        e.preventDefault();
        this.addUrlToWorkspace(input.value.trim(), ws.id);
        this._renderPanel();
      }
    });
    setTimeout(() => input.focus(), 0);
    return input;
  },

  // Opens unloaded and in the background so the current tab stays selected.
  addUrlToWorkspace(text, wsId) {
    let url;
    try {
      url = Services.uriFixup.getFixupURIInfo(
        text, Ci.nsIURIFixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP).preferredURI.spec;
    } catch (e) {
      return null;
    }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && url.startsWith("http://")) {
      url = "https://" + url.slice(7);
    }
    const tab = gBrowser.addTrustedTab(url, {
      inBackground: true,
      createLazyBrowser: true,
      lazyTabTitle: text,
    });
    this._setTabWs(tab, wsId);
    this._applyCollapsed();
    return tab;
  },

  _buildTabRow(tab) {
    const tabRow = this._el("div", "workspace-tab" + (tab === gBrowser.selectedTab ? " current" : "") + (tab.hasAttribute("pending") ? " unloaded" : ""));

    const favicon = document.createElementNS("http://www.w3.org/1999/xhtml", "img");
    favicon.className = "workspace-favicon";
    favicon.src = tab.getAttribute("image") || "chrome://global/skin/icons/defaultFavicon.svg";
    tabRow.appendChild(favicon);

    const tabTitle = this._el("span", "workspace-tab-title");
    tabTitle.textContent = tab.label || "New Tab";
    tabRow.appendChild(tabTitle);

    const moveBtn = this._el("button", "workspace-move");
    moveBtn.textContent = "↕";
    moveBtn.title = "Move to…";
    moveBtn.addEventListener("click", e => {
      e.stopPropagation();
      this._showMoveMenu(tab, moveBtn);
    });
    tabRow.appendChild(moveBtn);

    tabRow.addEventListener("click", () => {
      if (tab.hidden) gBrowser.showTab(tab);
      gBrowser.selectedTab = tab;
      this._moveSelectedWorkspaceTabsToFront();
      this._updateButton();
      this._closePanel();
    });
    return tabRow;
  },

  _buildWorkspaceSection(ws, activeId) {
    const isActive = ws.id === activeId;
    const tabs = this._getTabsForWorkspace(ws.id);

    const section = this._el("div", "workspace-section" + (isActive ? " active" : ""));
    const row = this._el("div", "workspace-row");

    const toggle = this._el("button", "workspace-expand");
    toggle.textContent = ws.collapsed ? "▸" : "▾";
    toggle.title = ws.collapsed ? "Show tabs in tab bar" : "Hide tabs from tab bar";
    toggle.addEventListener("click", e => {
      e.stopPropagation();
      this.toggleCollapsed(ws);
      this._renderPanel();
    });
    row.appendChild(toggle);

    const icon = this._el("span", "workspace-icon");
    icon.textContent = ws.icon;
    row.appendChild(icon);

    const nameBtn = this._el("button", "workspace-switch");
    nameBtn.textContent = ws.name;
    nameBtn.style.setProperty("--workspace-color", ws.color);
    nameBtn.addEventListener("click", () => {
      const first = tabs[0];
      if (first) {
        if (first.hidden) gBrowser.showTab(first);
        if (ws !== this._workspaces[0]) this._moveWorkspaceTabsToFront(ws.id);
        gBrowser.selectedTab = first;
        this._updateButton();
        this._closePanel();
      }
    });
    row.appendChild(nameBtn);

    const countEl = this._el("span", "workspace-tab-count");
    countEl.textContent = tabs.length;
    row.appendChild(countEl);

    const addUrlBtn = this._el("button", "workspace-addurl");
    addUrlBtn.textContent = "+";
    addUrlBtn.title = "Add a site to this workspace";
    addUrlBtn.addEventListener("click", e => {
      e.stopPropagation();
      this._addingWs = this._addingWs === ws.id ? null : ws.id;
      this._renderPanel();
    });
    row.appendChild(addUrlBtn);

    const sleepBtn = this._el("button", "workspace-unload");
    sleepBtn.textContent = "💤";
    sleepBtn.title = "Unload this workspace's tabs from memory";
    sleepBtn.addEventListener("click", e => {
      e.stopPropagation();
      this.unloadWorkspace(ws.id);
      this._renderPanel();
    });
    row.appendChild(sleepBtn);

    const editBtn = this._el("button", "workspace-edit");
    editBtn.textContent = "✎";
    editBtn.title = "Edit workspace";
    editBtn.addEventListener("click", e => {
      e.stopPropagation();
      const existing = section.querySelector(".workspace-editor");
      if (existing) { existing.remove(); return; }
      section.appendChild(this._buildEditor(ws));
    });
    row.appendChild(editBtn);
    section.appendChild(row);

    if (this._addingWs === ws.id) {
      section.appendChild(this._buildUrlAdder(ws));
    }

    const tabList = this._el("div", "workspace-tabs-list");
    tabList.hidden = !!ws.collapsed;
    for (const tab of tabs) tabList.appendChild(this._buildTabRow(tab));

    if (!tabs.length) {
      const empty = this._el("div", "workspace-empty");
      empty.textContent = "No tabs";
      tabList.appendChild(empty);
    }
    section.appendChild(tabList);
    return section;
  },

  _showMoveMenu(tab, anchor) {
    const currentId = tab.getAttribute(this.TAB_ATTR);
    const others = this._workspaces.filter(w => w.id !== currentId);
    if (!others.length) return;

    const menu = this._el("div", "workspace-move-menu");
    for (const ws of others) {
      const item = this._el("button", "workspace-move-item");
      item.textContent = ws.icon + " " + ws.name;
      item.addEventListener("click", e => {
        e.stopPropagation();
        this.moveTab(tab, ws.id);
        menu.remove();
        this._renderPanel();
      });
      menu.appendChild(item);
    }

    document.addEventListener("click", () => menu.remove(), { once: true, capture: true });
    anchor.parentElement.appendChild(menu);
  },

  _buildEditor(ws) {
    const editor = this._el("div", "workspace-editor");

    const nameInput = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
    nameInput.placeholder = "Workspace name";
    nameInput.value = ws ? ws.name : "";
    editor.appendChild(nameInput);

    const iconRow = this._el("div", "workspace-icon-presets");
    const presets = [
      "🏠","💼","🎮","🎵","📺","📚","🛒","✈️","💡","🔧",
      "🎨","🌿","⭐","🔒","🧪","🎯","💻","🖥️","⌨️","🕹️",
      "🎧","🎬","📷","📰","📝","📁","📌","🔖","💬","📧",
      "📅","💰","📈","🏦","🍕","☕","🍿","🛠️","⚙️","🧩",
      "🚀","🌐","🔍","🧠","❤️","💜","🌸","🐱","🐶","🦊",
      "🐺","👻","🔥","⚡","🌙","☀️","❄️","🌈","🏆","🎁",
      "🎓","🏋️","⚽","🎲","🗺️","🏝️","🚗","🎤","🎹","🎸",
    ];
    let selectedIcon = ws ? ws.icon : presets[0];
    for (const emoji of presets) {
      const btn = this._el("button");
      btn.textContent = emoji;
      if (emoji === selectedIcon) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        selectedIcon = emoji;
        iconRow.querySelectorAll("button").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
      });
      iconRow.appendChild(btn);
    }
    editor.appendChild(iconRow);

    const customIcon = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
    customIcon.className = "workspace-custom-icon";
    customIcon.placeholder = "…or type/paste any emoji";
    customIcon.maxLength = 8;
    customIcon.addEventListener("input", () => {
      const v = customIcon.value.trim();
      if (!v) return;
      selectedIcon = v;
      iconRow.querySelectorAll("button").forEach(b => b.classList.toggle("selected", b.textContent === v));
    });
    editor.appendChild(customIcon);

    // In-panel swatches: the native color picker opens a separate window,
    // which steals focus and auto-closes the panel.
    const swatchRow = this._el("div", "workspace-swatches");
    const colors = ["#e76d83","#ff9f43","#feca57","#1dd1a1","#48dbfb","#54a0ff","#5f27cd","#c56cf0","#ff6b81","#8395a7"];
    let selectedColor = ws ? ws.color : colors[0];
    const hexInput = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
    const markSwatch = () => swatchRow.querySelectorAll("button").forEach(b =>
      b.classList.toggle("selected", b.dataset.color.toLowerCase() === selectedColor.toLowerCase()));
    for (const c of colors) {
      const sw = this._el("button", "workspace-swatch");
      sw.dataset.color = c;
      sw.style.background = c;
      sw.title = c;
      sw.addEventListener("click", () => {
        selectedColor = c;
        hexInput.value = c;
        markSwatch();
      });
      swatchRow.appendChild(sw);
    }
    editor.appendChild(swatchRow);

    const colorLine = this._el("div", "workspace-color-line");
    const preview = this._el("span", "workspace-color-preview");
    preview.style.background = selectedColor;
    hexInput.value = selectedColor;
    hexInput.placeholder = "#e76d83";
    hexInput.addEventListener("input", () => {
      if (/^#[0-9a-fA-F]{6}$/.test(hexInput.value)) {
        selectedColor = hexInput.value;
        preview.style.background = selectedColor;
        markSwatch();
      }
    });
    swatchRow.addEventListener("click", () => { preview.style.background = selectedColor; });
    colorLine.append(preview, hexInput);
    editor.appendChild(colorLine);
    markSwatch();

    const controls = this._el("div", "workspace-editor-controls");

    if (ws && this._workspaces.length > 1) {
      const deleteBtn = this._el("button", "workspace-delete");
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        const idx = this._workspaces.indexOf(ws);
        const fallback = this._workspaces[idx === 0 ? 1 : idx - 1];
        for (const tab of this._getTabsForWorkspace(ws.id)) {
          this._setTabWs(tab, fallback.id);
        }
        this._workspaces.splice(idx, 1);
        this._save();
        this._applyCollapsed();
        this._updateButton();
        this._renderPanel();
      });
      controls.appendChild(deleteBtn);
    }

    const cancelBtn = this._el("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => editor.remove());
    controls.appendChild(cancelBtn);

    const saveBtn = this._el("button", "workspace-save");
    saveBtn.textContent = ws ? "Save" : "Create";
    saveBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) return;
      const color = /^#[0-9a-fA-F]{6}$/.test(hexInput.value) ? hexInput.value : selectedColor;
      if (ws) {
        ws.name = name; ws.icon = selectedIcon; ws.color = color;
      } else {
        this._workspaces.push(this._makeWorkspace(name, selectedIcon, color));
      }
      this._save();
      this._refreshTabWorkspaceColors();
      this._updateButton();
      this._renderPanel();
    });
    controls.appendChild(saveBtn);
    editor.appendChild(controls);

    setTimeout(() => nameInput.focus(), 50);
    return editor;
  },

  _el(tag, className) {
    const el = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    if (className) el.className = className;
    return el;
  },
};

var gRamLimiter = {
  PREF_ENABLED: "browser.ramlimiter.enabled",
  PREF_LIMIT: "browser.ramlimiter.limitMB",
  INTERVAL_MS: 15000,
  _usageMB: 0,
  _timer: null,

  get enabled() { return Services.prefs.getBoolPref(this.PREF_ENABLED, false); },
  get limitMB() { return Services.prefs.getIntPref(this.PREF_LIMIT, 4096); },

  WIDGET_ID: "ramlimiter-toolbar-button",
  PREF_PLACED: "browser.ramlimiter.placed",

  get _btn() {
    return document.getElementById(this.WIDGET_ID);
  },

  init() {
    this._registerWidget();
    // Delegated so it survives the widget node being rebuilt or moved.
    document.getElementById("navigator-toolbox").addEventListener("command", e => {
      const btn = e.target.closest?.("#" + this.WIDGET_ID);
      if (btn) this.openPanel(btn);
    });
    this._tick();
    this._timer = setInterval(() => this._tick(), this.INTERVAL_MS);
    window.addEventListener("unload", () => clearInterval(this._timer), { once: true });
  },

  _registerWidget() {
    // Widgets are app-global; only the first window creates it.
    if (CustomizableUI.getWidget(this.WIDGET_ID)?.provider !== CustomizableUI.PROVIDER_API) {
      try {
        CustomizableUI.createWidget({
          id: this.WIDGET_ID,
          type: "button",
          label: "RAM Limiter",
          tooltiptext: "RAM Limiter",
          defaultArea: CustomizableUI.AREA_NAVBAR,
          onCreated(node) {
            node.ownerGlobal.gRamLimiter?._updateButton();
          },
        });
      } catch (e) {}
    }
    if (!Services.prefs.getBoolPref(this.PREF_PLACED, false)) {
      CustomizableUI.addWidgetToArea(this.WIDGET_ID, CustomizableUI.AREA_NAVBAR);
      const dl = CustomizableUI.getPlacementOfWidget("downloads-button");
      if (dl?.area === CustomizableUI.AREA_NAVBAR) {
        CustomizableUI.moveWidgetWithinArea(this.WIDGET_ID, dl.position + 1);
      }
      Services.prefs.setBoolPref(this.PREF_PLACED, true);
    }
  },

  async measure() {
    const info = await ChromeUtils.requestProcInfo();
    let bytes = info.memory || 0;
    for (const child of info.children || []) bytes += child.memory || 0;
    this._usageMB = Math.round(bytes / 1048576);
    return this._usageMB;
  },

  _candidates() {
    return Array.from(gBrowser.tabs)
      .filter(t => !t.selected && !t.pinned && !t.hasAttribute("pending") &&
        !t.hasAttribute("soundplaying") && !t.closing)
      .sort((a, b) => a.lastAccessed - b.lastAccessed);
  },

  async _tick() {
    try {
      await this.measure();
    } catch (e) {
      return;
    }
    if (this.enabled && this._usageMB > this.limitMB) {
      // A couple per tick; memory is released lazily, so re-check next tick.
      for (const tab of this._candidates().slice(0, 2)) gBrowser.discardBrowser(tab);
    }
    this._updateButton();
    if (document.getElementById("ramlimiter-panel")?.state === "open") this._renderPanel();
  },

  unloadAllBackground() {
    for (const tab of this._candidates()) gBrowser.discardBrowser(tab);
    setTimeout(() => this._tick(), 2000);
  },

  _fmt(mb) {
    return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : mb + " MB";
  },

  _updateButton() {
    const btn = this._btn;
    if (!btn) return;
    btn.toggleAttribute("over-limit", this.enabled && this._usageMB > this.limitMB);
    btn.toggleAttribute("limiter-on", this.enabled);
    btn.setAttribute("tooltiptext", "RAM: " + this._fmt(this._usageMB) + " — limiter " +
      (this.enabled ? "on (" + this._fmt(this.limitMB) + ")" : "off"));
  },

  openPanel(anchor = this._btn) {
    const panel = document.getElementById("ramlimiter-panel");
    if (!panel) return;
    if (panel.state === "open" || panel.state === "showing") { panel.hidePopup(); return; }
    this._renderPanel();
    panel.openPopup(anchor, "bottomright topright", 0, 4, false, false);
    this._tick();
  },

  _renderPanel() {
    const body = document.getElementById("ramlimiter-panel-body");
    if (!body) return;
    const el = gWorkspaces._el.bind(gWorkspaces);
    body.textContent = "";

    const header = el("div", "workspaces-panel-header");
    const title = el("span");
    title.textContent = "RAM Limiter";
    const toggle = el("button", "ramlimiter-toggle" + (this.enabled ? " on" : ""));
    toggle.textContent = this.enabled ? "ON" : "OFF";
    toggle.addEventListener("click", () => {
      Services.prefs.setBoolPref(this.PREF_ENABLED, !this.enabled);
      this._renderPanel();
      this._tick();
    });
    header.append(title, toggle);
    body.appendChild(header);

    const content = el("div", "ramlimiter-content");
    const pct = Math.min(100, Math.round((this._usageMB / this.limitMB) * 100));
    const usage = el("div", "ramlimiter-usage");
    usage.textContent = this._fmt(this._usageMB) + " / " + this._fmt(this.limitMB);
    const bar = el("div", "ramlimiter-bar");
    const fill = el("div", "ramlimiter-fill" + (pct >= 100 ? " over" : ""));
    fill.style.width = pct + "%";
    bar.appendChild(fill);

    const limitLabel = el("div", "ramlimiter-label");
    limitLabel.textContent = "Limit: " + this._fmt(this.limitMB);
    const slider = document.createElementNS("http://www.w3.org/1999/xhtml", "input");
    slider.type = "range";
    slider.className = "ramlimiter-slider";
    slider.min = 1024;
    slider.max = 32768;
    slider.step = 256;
    slider.value = this.limitMB;
    slider.addEventListener("input", () => {
      limitLabel.textContent = "Limit: " + this._fmt(+slider.value);
    });
    slider.addEventListener("change", () => {
      Services.prefs.setIntPref(this.PREF_LIMIT, +slider.value);
      this._renderPanel();
      this._updateButton();
    });

    const hint = el("div", "ramlimiter-hint");
    hint.textContent = "When on, the least recently used background tabs are unloaded " +
      "once usage goes over the limit. Pinned tabs and tabs playing audio are kept.";

    const unloadAll = el("button", "ramlimiter-unload-all");
    unloadAll.textContent = "💤 Unload all background tabs";
    unloadAll.addEventListener("click", () => this.unloadAllBackground());

    content.append(usage, bar, limitLabel, slider, unloadAll, hint);
    body.appendChild(content);
  },
};


var gForceDark = {
  PREF: "browser.forcedark.sites",

  get sites() {
    try {
      return JSON.parse(Services.prefs.getStringPref(this.PREF, "[]"));
    } catch (e) {
      return [];
    }
  },

  // Per-page actor: it applies the inversion inside each document and skips
  // pages whose own background is already dark.
  _registerActor() {
    try {
      ChromeUtils.registerWindowActor("ForceDark", {
        parent: { esModuleURI: "chrome://browser/content/ForceDark.sys.mjs" },
        child: {
          esModuleURI: "chrome://browser/content/ForceDark.sys.mjs",
          events: { DOMContentLoaded: {}, pageshow: {} },
        },
        matches: ["http://*/*", "https://*/*"],
        allFrames: true,
        // The child only reads colors and toggles a stylesheet; it exposes
        // nothing privileged to the page.
        safeForUntrustedWebProcess: true,
      });
    } catch (e) {
      // Already registered by another window.
    }
  },

  init() {
    this._registerActor();
    const ctx = document.getElementById("contentAreaContextMenu");
    if (!ctx) return;
    const sep = document.createXULElement("menuseparator");
    const item = document.createXULElement("menuitem");
    item.id = "context-forcedark";
    item.setAttribute("type", "checkbox");
    item.addEventListener("command", () => this.toggle(this._host()));
    ctx.append(sep, item);
    ctx.addEventListener("popupshowing", e => {
      if (e.target !== ctx) return;
      const host = this._host();
      item.hidden = sep.hidden = !host;
      if (!host) return;
      item.toggleAttribute("checked", this.sites.includes(host));
      item.removeAttribute("disabled");
      item.setAttribute("label", "Force Dark Mode on this site");
      this._queryTop()?.then(state => {
        if (state?.nativelyDark && !this.sites.includes(host)) {
          item.setAttribute("label", "Force Dark Mode (site is already dark)");
          item.setAttribute("disabled", "true");
        }
      }, () => {});
    });
  },

  _queryTop() {
    try {
      return gBrowser.selectedBrowser.browsingContext.currentWindowGlobal
        .getActor("ForceDark").sendQuery("ForceDark:State");
    } catch (e) {
      return null;
    }
  },

  _host() {
    try {
      const uri = gBrowser.selectedBrowser.currentURI;
      return /^https?$/.test(uri.scheme) ? uri.host.replace(/^www\./, "") : "";
    } catch (e) {
      return "";
    }
  },

  _refreshAll() {
    for (const browser of gBrowser.browsers) {
      for (const bc of browser.browsingContext?.getAllBrowsingContextsInSubtree() ?? []) {
        try {
          bc.currentWindowGlobal?.getActor("ForceDark").sendAsyncMessage("ForceDark:Refresh");
        } catch (e) {}
      }
    }
  },

  toggle(host) {
    if (!host) return;
    const old = this.sites;
    const next = old.includes(host) ? old.filter(h => h !== host) : [...old, host];
    Services.prefs.setStringPref(this.PREF, JSON.stringify(next));
    this._refreshAll();
  },
};
