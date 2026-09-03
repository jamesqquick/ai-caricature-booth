declare global {
  interface Window {
    __printJobActive?: boolean;
  }
}

export function isPrintActive() {
  if (typeof window === 'undefined') return false;
  if (window.__printJobActive === true) return true;
  try {
    return Object.keys(sessionStorage).some((key) => key.startsWith('print-request:'));
  } catch {
    return false;
  }
}

export function setPrintActive(active: boolean) {
  window.__printJobActive = active;
  window.dispatchEvent(new CustomEvent('print-job-active', { detail: { active } }));
}
