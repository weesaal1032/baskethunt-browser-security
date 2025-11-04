const INACTIVITY_TIMEOUT_MINUTES = 3;
const INACTIVITY_ALARM_NAME = 'inactivity-lock-alarm';

const DEFAULT_LOCK_STATE = {
  isLocked: false,
  lockTabId: null,
  lockWindowId: null
};

let lockState = { ...DEFAULT_LOCK_STATE };

async function persistLockState() {
  await chrome.storage.session.set({ lockState });
}

async function loadLockState() {
  try {
    const stored = await chrome.storage.session.get('lockState');
    if (stored.lockState) {
      lockState = { ...lockState, ...stored.lockState };
      if (lockState.isLocked) {
        await ensureLockTab();
      }
    }
  } catch (error) {
    console.error('Unable to load lock state', error);
  }
}

async function resetInactivityTimer() {
  await chrome.alarms.clear(INACTIVITY_ALARM_NAME);
  chrome.alarms.create(INACTIVITY_ALARM_NAME, {
    delayInMinutes: INACTIVITY_TIMEOUT_MINUTES
  });
}

async function ensureLockTab() {
  const lockUrl = chrome.runtime.getURL('lockscreen.html');

  if (lockState.lockTabId !== null) {
    try {
      const existingTab = await chrome.tabs.get(lockState.lockTabId);
      lockState.lockWindowId = existingTab.windowId ?? null;
      if (lockState.lockWindowId !== null) {
        await chrome.windows.update(lockState.lockWindowId, { focused: true });
      }
      await chrome.tabs.update(existingTab.id, { active: true });
      await persistLockState();
      return existingTab;
    } catch (error) {
      // Tab not found, fall through to create a new one.
      lockState.lockTabId = null;
      lockState.lockWindowId = null;
    }
  }

  const tab = await chrome.tabs.create({ url: lockUrl, active: true });
  lockState.lockTabId = tab.id ?? null;
  lockState.lockWindowId = tab.windowId ?? null;
  await persistLockState();

  if (lockState.lockWindowId !== null) {
    try {
      await chrome.windows.update(lockState.lockWindowId, { focused: true });
    } catch (error) {
      console.error('Failed to focus lock window', error);
    }
  }

  return tab;
}

async function scheduleInactivityTimer() {
  if (lockState.isLocked) {
    return;
  }

  try {
    await resetInactivityTimer();
  } catch (error) {
    console.error('Failed to reset inactivity timer', error);
  }
}

async function lockSession() {
  if (lockState.isLocked) {
    await ensureLockTab();
    return;
  }

  lockState = {
    ...lockState,
    isLocked: true
  };

  await persistLockState();
  await chrome.alarms.clear(INACTIVITY_ALARM_NAME);

  try {
    await ensureLockTab();
  } catch (error) {
    console.error('Failed to open lock tab', error);
  }
}

async function unlockSession() {
  if (!lockState.isLocked) {
    return;
  }

  const tabId = lockState.lockTabId;
  lockState = { ...DEFAULT_LOCK_STATE };
  await persistLockState();

  if (tabId !== null) {
    try {
      await chrome.tabs.remove(tabId);
    } catch (error) {
      // The tab may already be gone; ignore.
    }
  }

  await scheduleInactivityTimer();
}

loadLockState()
  .then(() => {
    if (!lockState.isLocked) {
      return scheduleInactivityTimer();
    }
    return undefined;
  })
  .catch((error) => {
    console.error('Failed to restore lock state', error);
  });

chrome.runtime.onInstalled.addListener(() => {
  scheduleInactivityTimer();
});

chrome.runtime.onStartup?.addListener(() => {
  scheduleInactivityTimer();
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if (lockState.isLocked) {
    if (lockState.lockWindowId !== null && lockState.lockWindowId !== windowId) {
      chrome.windows.update(lockState.lockWindowId, { focused: true }).catch(() => {
        // Ignore focus failures.
      });
    }

    if (lockState.lockTabId !== null && lockState.lockTabId !== tabId) {
      chrome.tabs.update(lockState.lockTabId, { active: true }).catch(() => {
        ensureLockTab().catch((error) => {
          console.error('Unable to re-open lock tab after activation change', error);
        });
      });
    }
    return;
  }

  scheduleInactivityTimer();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!lockState.isLocked) {
    return;
  }

  if (lockState.lockTabId === tabId) {
    lockState.lockTabId = null;
    lockState.lockWindowId = null;
    persistLockState().catch(() => {});
    ensureLockTab().catch((error) => {
      console.error('Failed to recreate lock tab after removal', error);
    });
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (!lockState.isLocked || lockState.lockWindowId === null) {
    return;
  }

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  if (windowId !== lockState.lockWindowId) {
    chrome.windows.update(lockState.lockWindowId, { focused: true }).catch(() => {
      ensureLockTab().catch((error) => {
        console.error('Failed to refocus lock window', error);
      });
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (message.type === 'user-activity') {
    scheduleInactivityTimer();
    return false;
  }

  if (message.type === 'lockscreen-unlocked') {
    const lockUrl = chrome.runtime.getURL('lockscreen.html');
    const senderUrl = sender?.tab?.url ?? sender?.url ?? '';
    const isFromLockTab =
      sender?.tab?.id === lockState.lockTabId && senderUrl.startsWith(lockUrl);
    const isFromLockDocument = !sender?.tab && senderUrl.startsWith(lockUrl);

    if (!isFromLockTab && !isFromLockDocument) {
      sendResponse({ success: false, error: 'unauthorized_sender' });
      return false;
    }

    if (!lockState.isLocked) {
      sendResponse({ success: false, error: 'not_locked' });
      return false;
    }

    (async () => {
      await unlockSession();
      sendResponse({ success: true });
    })().catch((error) => {
      console.error('Failed to unlock session', error);
      sendResponse({ success: false, error: 'unlock_failed' });
    });
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === INACTIVITY_ALARM_NAME) {
    lockSession().catch((error) => {
      console.error('Failed to start lock session', error);
    });
  }
});
