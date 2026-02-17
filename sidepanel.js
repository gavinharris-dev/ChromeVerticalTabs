const tabList = document.getElementById('tab-list');
const closeNonPrimaryBtn = document.getElementById('close-non-primary');
const newGroupBtn = document.getElementById('new-group-btn');
const newGroupForm = document.getElementById('new-group-form');
const newGroupNameInput = document.getElementById('new-group-name');
const newGroupSubmit = document.getElementById('new-group-submit');
const newGroupCancel = document.getElementById('new-group-cancel');
const colorPicker = document.getElementById('color-picker');
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');

const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
let selectedColor = 'blue';

let currentState = null;
let collapsedGroups = new Set(); // local UI collapse state (mirrors Chrome's)
let historyCollapsed = false;
let scrollTop = 0;
let draggedTabId = null;
let searchQuery = '';

// --- Request initial state ---

chrome.runtime.sendMessage({ type: 'getState' }, (response) => {
  if (response?.state) {
    currentState = response.state;
    syncCollapsedGroups();
    renderTabs();
  }
});

// --- Listen for state updates ---

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'stateUpdate') {
    currentState = msg.state;
    syncCollapsedGroups();
    renderTabs();
  }
});

// Sync local collapsed state with Chrome's group collapsed state
function syncCollapsedGroups() {
  if (!currentState) return;
  collapsedGroups = new Set(
    currentState.groups.filter(g => g.collapsed).map(g => g.id)
  );
}

// --- Rendering ---

function renderTabs() {
  if (!currentState) return;

  scrollTop = tabList.scrollTop;

  const { tabs, groups, primaryGroupIds } = currentState;
  const primarySet = new Set(primaryGroupIds);
  const groupMap = new Map(groups.map(g => [g.id, g]));

  // Organize tabs: ungrouped first, then by group (preserving tab order)
  const ungrouped = [];
  const groupedTabs = new Map(); // groupId -> tabs[]

  for (const tab of tabs) {
    if (tab.groupId === -1 || tab.groupId === chrome.tabGroups?.TAB_GROUP_ID_NONE) {
      ungrouped.push(tab);
    } else {
      if (!groupedTabs.has(tab.groupId)) {
        groupedTabs.set(tab.groupId, []);
      }
      groupedTabs.get(tab.groupId).push(tab);
    }
  }

  const fragment = document.createDocumentFragment();

  // Split groups into primary and non-primary, preserving tab order
  const primaryGroups = [];
  const nonPrimaryGroups = [];
  for (const [groupId, groupTabs] of groupedTabs) {
    const group = groupMap.get(groupId);
    if (!group) continue;
    if (primarySet.has(groupId)) {
      primaryGroups.push({ groupId, groupTabs, group });
    } else {
      nonPrimaryGroups.push({ groupId, groupTabs, group });
    }
  }

  // Render order: Primary groups -> Non-primary groups -> Ungrouped tabs
  const groupOrder = [...primaryGroups, ...nonPrimaryGroups];

  for (const { groupId, groupTabs, group } of groupOrder) {
    const isPrimary = primarySet.has(groupId);
    const isCollapsed = collapsedGroups.has(groupId);

    // Group header
    const header = document.createElement('div');
    header.className = 'group-header' + (isCollapsed ? ' collapsed' : '');
    header.dataset.groupId = groupId;

    header.innerHTML = `
      <span class="group-collapse-icon">▼</span>
      <span class="group-color-dot group-color-${group.color}"></span>
      <span class="group-title">${escapeHtml(group.title || 'Untitled')}</span>
      <span class="group-count">${groupTabs.length}</span>
      ${isPrimary ? '<span class="primary-badge">Primary</span>' : ''}
      <button class="primary-toggle ${isPrimary ? 'is-primary' : ''}"
              data-group-id="${groupId}"
              data-is-primary="${isPrimary}"
              title="${isPrimary ? 'Remove primary status' : 'Set as primary group'}">★</button>
    `;

    fragment.appendChild(header);

    // Group tabs container
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'group-tabs' + (isCollapsed ? ' collapsed' : '');

    for (const tab of groupTabs) {
      tabsContainer.appendChild(createTabElement(tab, true, group.color));
    }

    fragment.appendChild(tabsContainer);
  }

  // Ungrouped drop zone + tabs (at the bottom)
  const ungroupedZone = document.createElement('div');
  ungroupedZone.className = 'ungrouped-drop-zone';
  ungroupedZone.innerHTML = '<div class="ungrouped-label">Ungrouped Tabs</div>';
  for (const tab of ungrouped) {
    ungroupedZone.appendChild(createTabElement(tab, false));
  }
  fragment.appendChild(ungroupedZone);

  // Recently Closed section
  const recentlyClosed = currentState.recentlyClosed || [];
  if (recentlyClosed.length > 0) {
    const historySection = document.createElement('div');
    historySection.className = 'history-section';

    const historyHeader = document.createElement('div');
    historyHeader.className = 'history-header' + (historyCollapsed ? ' collapsed' : '');
    historyHeader.innerHTML = `
      <span class="group-collapse-icon">▼</span>
      <span class="history-icon">🕐</span>
      <span class="group-title">Recently Closed</span>
      <span class="group-count">${recentlyClosed.length}</span>
    `;
    historySection.appendChild(historyHeader);

    const historyItems = document.createElement('div');
    historyItems.className = 'history-items' + (historyCollapsed ? ' collapsed' : '');

    for (const item of recentlyClosed) {
      historyItems.appendChild(createHistoryElement(item));
    }

    historySection.appendChild(historyItems);
    fragment.appendChild(historySection);
  }

  tabList.innerHTML = '';
  tabList.appendChild(fragment);

  // Restore scroll
  tabList.scrollTop = scrollTop;
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function createHistoryElement(item) {
  const el = document.createElement('div');
  el.className = 'tab-item history-item';
  el.dataset.sessionId = item.sessionId;

  const faviconHtml = getFaviconHtml(item);

  el.innerHTML = `
    ${faviconHtml}
    <span class="tab-title">${escapeHtml(item.title || item.url || 'Closed Tab')}</span>
    <span class="history-badge">${formatTimeAgo(item.lastModified)}</span>
  `;

  return el;
}

function createTabElement(tab, grouped, groupColor) {
  const el = document.createElement('div');
  let classes = 'tab-item';
  if (grouped) classes += ' grouped';
  if (tab.active) classes += ' active';
  if (tab.pinned) classes += ' pinned';
  if (grouped && groupColor) classes += ` group-border-${groupColor}`;
  el.className = classes;
  el.dataset.tabId = tab.id;
  el.draggable = true;

  const faviconHtml = getFaviconHtml(tab);

  el.innerHTML = `
    ${faviconHtml}
    <span class="tab-title">${escapeHtml(tab.title || 'New Tab')}</span>
    <button class="tab-close" data-tab-id="${tab.id}" title="Close tab">✕</button>
  `;

  return el;
}

function getFaviconHtml(tab) {
  if (tab.status === 'loading') {
    return '<div class="tab-favicon-fallback loading">⏳</div>';
  }
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) {
    return `<img class="tab-favicon" src="${escapeHtml(tab.favIconUrl)}" alt="" onerror="this.outerHTML='<div class=\\'tab-favicon-fallback\\'>🌐</div>'">`;
  }
  return '<div class="tab-favicon-fallback">🌐</div>';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Event delegation ---

tabList.addEventListener('click', (e) => {
  // Close button
  const closeBtn = e.target.closest('.tab-close');
  if (closeBtn) {
    e.stopPropagation();
    const tabId = parseInt(closeBtn.dataset.tabId);
    chrome.runtime.sendMessage({ type: 'closeTab', tabId });
    return;
  }

  // Primary toggle
  const primaryBtn = e.target.closest('.primary-toggle');
  if (primaryBtn) {
    e.stopPropagation();
    const groupId = parseInt(primaryBtn.dataset.groupId);
    const isPrimary = primaryBtn.dataset.isPrimary === 'true';
    chrome.runtime.sendMessage({ type: 'setPrimary', groupId, isPrimary: !isPrimary });
    return;
  }

  // Group header collapse/expand (ignore if rename is active or long-press just fired)
  const groupHeader = e.target.closest('.group-header');
  if (groupHeader && !e.target.closest('.group-rename-input') && !longPressTriggered) {
    const groupId = parseInt(groupHeader.dataset.groupId);
    const group = currentState?.groups.find(g => g.id === groupId);
    if (group) {
      chrome.runtime.sendMessage({
        type: 'toggleGroupCollapse',
        groupId,
        collapsed: group.collapsed,
      });
    }
    return;
  }

  // History header collapse/expand
  const historyHeader = e.target.closest('.history-header');
  if (historyHeader) {
    historyCollapsed = !historyCollapsed;
    historyHeader.classList.toggle('collapsed', historyCollapsed);
    const items = historyHeader.nextElementSibling;
    if (items) items.classList.toggle('collapsed', historyCollapsed);
    return;
  }

  // Tab click — activate or restore
  const tabItem = e.target.closest('.tab-item');
  if (tabItem) {
    if (tabItem.classList.contains('history-item')) {
      const sessionId = tabItem.dataset.sessionId;
      chrome.runtime.sendMessage({ type: 'restoreSession', sessionId });
    } else {
      const tabId = parseInt(tabItem.dataset.tabId);
      chrome.runtime.sendMessage({ type: 'activateTab', tabId });
    }
    return;
  }
});

// --- Rename Group (long-press) ---

let longPressTimer = null;
let longPressTriggered = false;

tabList.addEventListener('pointerdown', (e) => {
  const groupTitle = e.target.closest('.group-title');
  if (!groupTitle) return;

  longPressTriggered = false;
  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    startRenameGroup(groupTitle);
  }, 500);
});

tabList.addEventListener('pointerup', () => {
  clearTimeout(longPressTimer);
});

tabList.addEventListener('pointerleave', () => {
  clearTimeout(longPressTimer);
});

function startRenameGroup(groupTitle) {
  const header = groupTitle.closest('.group-header');
  if (!header) return;

  const groupId = parseInt(header.dataset.groupId);
  const currentTitle = groupTitle.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'group-rename-input';
  input.value = currentTitle;
  groupTitle.replaceWith(input);
  input.focus();
  input.select();

  function commit() {
    const newTitle = input.value.trim();
    if (newTitle !== currentTitle) {
      chrome.runtime.sendMessage({ type: 'renameGroup', groupId, title: newTitle });
    }
    const span = document.createElement('span');
    span.className = 'group-title';
    span.textContent = newTitle || currentTitle;
    input.replaceWith(span);
  }

  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
    if (ev.key === 'Escape') { input.value = currentTitle; input.blur(); }
    ev.stopPropagation();
  });
  input.addEventListener('blur', commit, { once: true });
  input.addEventListener('click', (ev) => ev.stopPropagation());
}

// --- New Group Form ---

// Build color picker
GROUP_COLORS.forEach(color => {
  const dot = document.createElement('button');
  dot.className = `color-option group-color-${color}${color === selectedColor ? ' selected' : ''}`;
  dot.dataset.color = color;
  dot.title = color;
  colorPicker.appendChild(dot);
});

colorPicker.addEventListener('click', (e) => {
  const dot = e.target.closest('.color-option');
  if (!dot) return;
  selectedColor = dot.dataset.color;
  colorPicker.querySelectorAll('.color-option').forEach(d => d.classList.remove('selected'));
  dot.classList.add('selected');
});

newGroupBtn.addEventListener('click', () => {
  newGroupForm.style.display = newGroupForm.style.display === 'none' ? 'block' : 'none';
  if (newGroupForm.style.display === 'block') {
    newGroupNameInput.value = '';
    newGroupNameInput.focus();
  }
});

newGroupCancel.addEventListener('click', () => {
  newGroupForm.style.display = 'none';
});

newGroupSubmit.addEventListener('click', () => {
  const title = newGroupNameInput.value.trim();
  chrome.runtime.sendMessage({ type: 'createGroup', title, color: selectedColor });
  newGroupForm.style.display = 'none';
});

newGroupNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') newGroupSubmit.click();
  if (e.key === 'Escape') newGroupCancel.click();
});

// --- Drag & Drop ---

tabList.addEventListener('dragstart', (e) => {
  const tabItem = e.target.closest('.tab-item');
  if (!tabItem || tabItem.classList.contains('history-item')) {
    e.preventDefault();
    return;
  }
  draggedTabId = parseInt(tabItem.dataset.tabId);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedTabId);
  tabItem.classList.add('dragging');
});

tabList.addEventListener('dragend', (e) => {
  const tabItem = e.target.closest('.tab-item');
  if (tabItem) tabItem.classList.remove('dragging');
  draggedTabId = null;
  tabList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
});

tabList.addEventListener('dragover', (e) => {
  const target = e.target.closest('.group-header, .ungrouped-drop-zone');
  if (target) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    tabList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    target.classList.add('drag-over');
  }
});

tabList.addEventListener('dragleave', (e) => {
  const target = e.target.closest('.group-header, .ungrouped-drop-zone');
  if (target && !target.contains(e.relatedTarget)) {
    target.classList.remove('drag-over');
  }
});

tabList.addEventListener('drop', (e) => {
  e.preventDefault();
  tabList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

  if (!draggedTabId) return;

  const groupHeader = e.target.closest('.group-header');
  if (groupHeader) {
    const groupId = parseInt(groupHeader.dataset.groupId);
    chrome.runtime.sendMessage({ type: 'moveTabToGroup', tabId: draggedTabId, groupId });
    return;
  }

  const dropZone = e.target.closest('.ungrouped-drop-zone');
  if (dropZone) {
    chrome.runtime.sendMessage({ type: 'ungroupTab', tabId: draggedTabId });
  }
});

// --- Search ---

function showSearch(initialChar) {
  searchBar.style.display = 'flex';
  searchInput.value = initialChar || '';
  searchInput.focus();
  applySearch();
}

function hideSearch() {
  searchBar.style.display = 'none';
  searchInput.value = '';
  searchQuery = '';
  applySearch();
}

function applySearch() {
  searchQuery = searchInput.value.toLowerCase();
  const items = tabList.querySelectorAll('.tab-item:not(.history-item)');
  const historyItems = tabList.querySelectorAll('.history-item');
  const groupHeaders = tabList.querySelectorAll('.group-header');
  const groupTabContainers = tabList.querySelectorAll('.group-tabs');
  const historySection = tabList.querySelector('.history-section');
  const historyHeader = tabList.querySelector('.history-header');
  const historyItemsContainer = tabList.querySelector('.history-items');

  if (!searchQuery) {
    items.forEach(el => el.classList.remove('search-hidden'));
    historyItems.forEach(el => el.classList.remove('search-hidden'));
    groupHeaders.forEach(el => el.classList.remove('search-hidden'));
    groupTabContainers.forEach(el => {
      el.classList.remove('search-hidden');
      if (collapsedGroups.has(parseInt(el.previousElementSibling?.dataset?.groupId))) {
        el.classList.add('collapsed');
      }
    });
    if (historySection) historySection.classList.remove('search-hidden');
    if (historyHeader) historyHeader.classList.remove('search-hidden');
    if (historyItemsContainer) {
      historyItemsContainer.classList.remove('search-hidden');
      historyItemsContainer.classList.toggle('collapsed', historyCollapsed);
    }
    return;
  }

  // Show/hide individual active tabs
  items.forEach(el => {
    const title = el.querySelector('.tab-title')?.textContent?.toLowerCase() || '';
    el.classList.toggle('search-hidden', !title.includes(searchQuery));
  });

  // Show/hide groups based on whether they have visible tabs
  groupHeaders.forEach(header => {
    const tabsContainer = header.nextElementSibling;
    if (!tabsContainer || !tabsContainer.classList.contains('group-tabs')) return;

    const visibleTabs = tabsContainer.querySelectorAll('.tab-item:not(.search-hidden)');
    const hasMatch = visibleTabs.length > 0;

    // Also check if group title matches
    const groupTitle = header.querySelector('.group-title')?.textContent?.toLowerCase() || '';
    const titleMatch = groupTitle.includes(searchQuery);

    if (hasMatch || titleMatch) {
      header.classList.remove('search-hidden');
      tabsContainer.classList.remove('search-hidden', 'collapsed');
      if (titleMatch && !hasMatch) {
        tabsContainer.querySelectorAll('.tab-item').forEach(el => el.classList.remove('search-hidden'));
      }
    } else {
      header.classList.add('search-hidden');
      tabsContainer.classList.add('search-hidden');
    }
  });

  // Show/hide history items based on search
  let hasHistoryMatch = false;
  historyItems.forEach(el => {
    const title = el.querySelector('.tab-title')?.textContent?.toLowerCase() || '';
    const matches = title.includes(searchQuery);
    el.classList.toggle('search-hidden', !matches);
    if (matches) hasHistoryMatch = true;
  });

  if (historySection) {
    historySection.classList.toggle('search-hidden', !hasHistoryMatch);
  }
  if (historyHeader) {
    historyHeader.classList.toggle('search-hidden', !hasHistoryMatch);
  }
  if (historyItemsContainer && hasHistoryMatch) {
    historyItemsContainer.classList.remove('search-hidden', 'collapsed');
  }
}

searchInput.addEventListener('input', applySearch);

searchClear.addEventListener('click', hideSearch);

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideSearch();
});

// Type-to-search: activate search when typing printable characters
document.addEventListener('keydown', (e) => {
  // Ignore if already focused on an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  // Ignore modifier keys and non-printable
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.length !== 1) return;

  showSearch(e.key);
});

// --- Auto-Group by Domain ---

document.getElementById('auto-group-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'autoGroupByDomain' });
});

// --- Close Non-Primary ---

closeNonPrimaryBtn.addEventListener('click', () => {
  // Ask background for a fresh count, then confirm before closing
  chrome.runtime.sendMessage({ type: 'countNonPrimary' }, (response) => {
    const count = response?.count || 0;
    if (count === 0) {
      alert('No non-primary group tabs to close.');
      return;
    }
    const confirmed = confirm(
      `Close ${count} tab${count === 1 ? '' : 's'} in non-primary groups?`
    );
    if (confirmed) {
      chrome.runtime.sendMessage({ type: 'closeNonPrimary' });
    }
  });
});
