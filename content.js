const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart'];
let activityTimeoutId = null;
const ACTIVITY_DEBOUNCE_MS = 1000;

function reportActivity() {
  chrome.runtime.sendMessage({ type: 'user-activity' }).catch((error) => {
    console.error('Failed to report user activity', error);
  });
}

function scheduleActivityReport() {
  if (activityTimeoutId) {
    clearTimeout(activityTimeoutId);
  }
  activityTimeoutId = setTimeout(reportActivity, ACTIVITY_DEBOUNCE_MS);
}

for (const eventName of ACTIVITY_EVENTS) {
  window.addEventListener(eventName, scheduleActivityReport, { passive: true });
}
