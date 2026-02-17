// Open side panel when toolbar icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// --- State broadcasting ---

async function getFullState() {
  const currentWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const tabs = await chrome.tabs.query({ windowId: currentWindow.id });
  const groups = await chrome.tabGroups.query({ windowId: currentWindow.id });
  const { primaryGroupKeys = [] } = await chrome.storage.local.get('primaryGroupKeys');

  // Resolve which current groups are primary by matching title+color
  const primaryGroupIds = new Set();
  for (const group of groups) {
    if (primaryGroupKeys.some(k => k.title === group.title && k.color === group.color)) {
      primaryGroupIds.add(group.id);
    }
  }

  return {
    tabs: tabs.map(t => ({
      id: t.id,
      title: t.title,
      url: t.url,
      favIconUrl: t.favIconUrl,
      active: t.active,
      pinned: t.pinned,
      status: t.status,
      groupId: t.groupId,
      index: t.index,
    })),
    groups: groups.map(g => ({
      id: g.id,
      title: g.title,
      color: g.color,
      collapsed: g.collapsed,
    })),
    primaryGroupIds: [...primaryGroupIds],
  };
}

async function broadcastState() {
  try {
    const state = await getFullState();
    // Send to all extension views (side panel)
    chrome.runtime.sendMessage({ type: 'stateUpdate', state }).catch(() => {
      // Side panel may not be open — ignore
    });
  } catch (e) {
    // Window may have closed during query
  }
}

// --- Tab event listeners ---

chrome.tabs.onCreated.addListener(broadcastState);
chrome.tabs.onRemoved.addListener(broadcastState);
chrome.tabs.onUpdated.addListener(broadcastState);
chrome.tabs.onActivated.addListener(broadcastState);
chrome.tabs.onMoved.addListener(broadcastState);
chrome.tabs.onAttached.addListener(broadcastState);
chrome.tabs.onDetached.addListener(broadcastState);

// --- Group event listeners ---

chrome.tabGroups.onCreated.addListener(broadcastState);
chrome.tabGroups.onUpdated.addListener(broadcastState);
chrome.tabGroups.onRemoved.addListener(broadcastState);

// --- Message handlers ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getState') {
    getFullState().then(state => sendResponse({ state }));
    return true; // async response
  }

  if (msg.type === 'activateTab') {
    chrome.tabs.update(msg.tabId, { active: true });
    return;
  }

  if (msg.type === 'closeTab') {
    chrome.tabs.remove(msg.tabId);
    return;
  }

  if (msg.type === 'toggleGroupCollapse') {
    chrome.tabGroups.update(msg.groupId, { collapsed: !msg.collapsed });
    return;
  }

  if (msg.type === 'setPrimary') {
    handleSetPrimary(msg.groupId, msg.isPrimary);
    return;
  }

  if (msg.type === 'countNonPrimary') {
    getNonPrimaryTabs().then(tabs => sendResponse({ count: tabs.length }));
    return true;
  }

  if (msg.type === 'closeNonPrimary') {
    handleCloseNonPrimary().then(result => sendResponse(result));
    return true; // async response
  }

  if (msg.type === 'createGroup') {
    handleCreateGroup(msg.title, msg.color).then(() => sendResponse({ success: true }));
    return true;
  }

  if (msg.type === 'renameGroup') {
    chrome.tabGroups.update(msg.groupId, { title: msg.title });
    return;
  }

  if (msg.type === 'autoGroupByDomain') {
    handleAutoGroupByDomain().then(() => sendResponse({ success: true }));
    return true;
  }

  if (msg.type === 'moveTabToGroup') {
    chrome.tabs.group({ tabIds: [msg.tabId], groupId: msg.groupId });
    return;
  }

  if (msg.type === 'ungroupTab') {
    chrome.tabs.ungroup(msg.tabId);
    return;
  }
});

async function handleSetPrimary(groupId, isPrimary) {
  const groups = await chrome.tabGroups.query({});
  const group = groups.find(g => g.id === groupId);
  if (!group) return;

  const { primaryGroupKeys = [] } = await chrome.storage.local.get('primaryGroupKeys');
  const key = { title: group.title, color: group.color };

  let updated;
  if (isPrimary) {
    // Add if not already present
    if (!primaryGroupKeys.some(k => k.title === key.title && k.color === key.color)) {
      updated = [...primaryGroupKeys, key];
    } else {
      return; // already primary
    }
  } else {
    // Remove
    updated = primaryGroupKeys.filter(k => !(k.title === key.title && k.color === key.color));
  }

  await chrome.storage.local.set({ primaryGroupKeys: updated });
  broadcastState();
}

async function handleCreateGroup(title, color) {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const [activeTab] = await chrome.tabs.query({ active: true, windowId: win.id });
  if (!activeTab) {
    console.error('handleCreateGroup: no active tab found in window', win.id);
    return;
  }

  const groupId = await chrome.tabs.group({ tabIds: [activeTab.id], createProperties: { windowId: win.id } });
  await chrome.tabGroups.update(groupId, { title: title || '', color: color || 'grey' });
}

async function getNonPrimaryTabs() {
  const state = await getFullState();
  const primarySet = new Set(state.primaryGroupIds);
  return state.tabs.filter(t => {
    if (t.pinned) return false;
    if (t.groupId === -1) return false;
    return !primarySet.has(t.groupId);
  });
}

async function handleCloseNonPrimary() {
  const tabs = await getNonPrimaryTabs();
  if (tabs.length === 0) return { closed: 0 };
  await chrome.tabs.remove(tabs.map(t => t.id));
  return { closed: tabs.length };
}

const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

async function handleAutoGroupByDomain() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const tabs = await chrome.tabs.query({ windowId: win.id });
  const existingGroups = await chrome.tabGroups.query({ windowId: win.id });

  // Filter to ungrouped, non-pinned tabs with parseable URLs
  const domainMap = new Map(); // hostname -> tabId[]
  for (const tab of tabs) {
    if (tab.pinned || tab.groupId !== -1) continue;
    let hostname;
    try {
      hostname = new URL(tab.url).hostname;
    } catch {
      continue;
    }
    if (!hostname) continue;
    // Extract second-level domain (e.g. "docs.gomaestro.org" -> "gomaestro")
    const parts = hostname.split('.');
    if (parts.length < 2) continue;
    const baseDomain = parts[parts.length - 2]; // second-level domain without TLD
    if (!domainMap.has(baseDomain)) {
      domainMap.set(baseDomain, []);
    }
    domainMap.get(baseDomain).push(tab.id);
  }

  // Build a map of existing group titles for reuse
  const titleToGroup = new Map();
  for (const g of existingGroups) {
    if (g.title) {
      titleToGroup.set(g.title.toLowerCase(), g);
    }
  }

  let colorIndex = 0;
  for (const [hostname, tabIds] of domainMap) {
    if (tabIds.length < 2) continue;

    // Check if an existing group matches this domain
    const existing = titleToGroup.get(hostname.toLowerCase());
    if (existing) {
      await chrome.tabs.group({ tabIds, groupId: existing.id });
    } else {
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId: win.id } });
      const color = GROUP_COLORS[colorIndex % GROUP_COLORS.length];
      await chrome.tabGroups.update(groupId, { title: hostname, color });
      colorIndex++;
    }
  }
}
