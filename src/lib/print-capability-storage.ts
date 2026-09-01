export function printCapabilityStorageKey(sessionId: string) {
  return `print-capability:${sessionId}`;
}

export function readPrintCapability(sessionId: string, storage: Pick<Storage, 'getItem'> = sessionStorage) {
  try {
    return storage.getItem(printCapabilityStorageKey(sessionId));
  } catch {
    return null;
  }
}

export function completeGenerationNavigation(
  sessionId: string,
  printToken: string,
  storage: Pick<Storage, 'setItem'> = sessionStorage,
  navigate: (url: string) => void = (url) => window.location.assign(url),
) {
  storage.setItem(printCapabilityStorageKey(sessionId), printToken);
  navigate(`/p/${sessionId}?source=generation`);
}
