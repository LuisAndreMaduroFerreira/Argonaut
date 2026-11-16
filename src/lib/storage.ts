// localStorage can throw (private mode, blocked site data, a full quota).

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// False when the write failed (storage full, blocked or unavailable), for callers whose cache
// holds work found nowhere else.
export function writeStorage(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
