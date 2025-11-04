const INACTIVITY_TIMEOUT_MINUTES = 3;
const INACTIVITY_ALARM_NAME = 'inactivity-lock-alarm';

async function resetInactivityTimer() {
  await chrome.alarms.clear(INACTIVITY_ALARM_NAME);
  chrome.alarms.create(INACTIVITY_ALARM_NAME, {
    delayInMinutes: INACTIVITY_TIMEOUT_MINUTES
  });
}

async function openLockPage() {
  const lockUrl = chrome.runtime.getURL('lock.html');
  await chrome.tabs.create({ url: lockUrl });
}

function scheduleInactivityTimer() {
  resetInactivityTimer().catch((error) => {
    console.error('Failed to reset inactivity timer', error);
  });
}

chrome.runtime.onInstalled.addListener(() => {
  scheduleInactivityTimer();
});

chrome.tabs.onActivated.addListener(() => {
  scheduleInactivityTimer();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'user-activity') {
    scheduleInactivityTimer();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === INACTIVITY_ALARM_NAME) {
    openLockPage().catch((error) => {
      console.error('Failed to open lock page', error);
    });
  }
});
