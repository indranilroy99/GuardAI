// AES-256-GCM credential encryption with session-scoped keys.
// The encryption key is generated once per browser session and stored in sessionStorage.
// When the tab is closed, the key is lost and localStorage ciphertext becomes unreadable —
// giving strong security without requiring a user passphrase.

const SESSION_KEY_NAME = "_s_key";
const INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes

let _inactivityTimer: ReturnType<typeof setTimeout> | null = null;

function resetInactivityTimer() {
  if (_inactivityTimer) clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(() => {
    sessionStorage.removeItem(SESSION_KEY_NAME);
    window.dispatchEvent(new CustomEvent("sentinel:session-expired"));
  }, INACTIVITY_MS);
}

// Reset timer on any user interaction
if (typeof window !== "undefined") {
  ["click", "keydown", "scroll", "touchstart"].forEach(ev =>
    window.addEventListener(ev, resetInactivityTimer, { passive: true })
  );
  resetInactivityTimer();
}

async function getOrCreateKey(): Promise<CryptoKey> {
  const stored = sessionStorage.getItem(SESSION_KEY_NAME);
  if (stored) {
    try {
      const jwk = JSON.parse(atob(stored));
      return await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    } catch {
      // If import fails, generate a new key below
    }
  }

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exported = await crypto.subtle.exportKey("jwk", key);
  sessionStorage.setItem(SESSION_KEY_NAME, btoa(JSON.stringify(exported)));
  return key;
}

/**
 * Encrypts `plaintext` with AES-256-GCM and stores the ciphertext in localStorage.
 */
export async function storeSecure(storageKey: string, plaintext: string): Promise<void> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);

  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), 12);

  // Prefix "enc:" to distinguish from plain legacy values
  localStorage.setItem(storageKey, "enc:" + btoa(String.fromCharCode(...combined)));
}

/**
 * Retrieves and decrypts a value previously stored with storeSecure.
 * Returns null if not found, session expired, or decryption fails.
 * Auto-migrates legacy plain JSON values by re-encrypting them.
 */
export async function retrieveAndDecrypt(storageKey: string): Promise<string | null> {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;

  // Legacy plain-text migration
  if (!raw.startsWith("enc:")) {
    // Looks like old plain JSON — re-encrypt it transparently
    try {
      await storeSecure(storageKey, raw);
      return raw;
    } catch {
      return raw;
    }
  }

  try {
    const key = await getOrCreateKey();
    const base64 = raw.slice(4); // strip "enc:"
    const combined = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    // Session key changed (new tab session) — remove stale ciphertext
    localStorage.removeItem(storageKey);
    return null;
  }
}

/**
 * Removes a secure value from localStorage.
 */
export function clearSecureStorage(storageKey: string): void {
  localStorage.removeItem(storageKey);
}
