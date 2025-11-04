const ACTIVITY_EVENTS = {
  mouse: ['mousemove', 'mousedown'],
  keyboard: ['keydown', 'keyup']
};
const MIN_REPORT_INTERVAL_MS = 5000;
let lastReportedAt = 0;

function reportActivity() {
  const now = Date.now();
  if (now - lastReportedAt < MIN_REPORT_INTERVAL_MS) {
    return;
  }

  lastReportedAt = now;

  chrome.runtime.sendMessage({ type: 'user-activity' }).catch((error) => {
    console.error('Failed to report user activity', error);
  });
}

for (const eventName of ACTIVITY_EVENTS.mouse) {
  window.addEventListener(eventName, reportActivity, { passive: true });
}

for (const eventName of ACTIVITY_EVENTS.keyboard) {
  window.addEventListener(eventName, reportActivity, { passive: false });
}
