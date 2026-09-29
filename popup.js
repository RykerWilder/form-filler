const btn = document.getElementById("fillBtn");
const status = document.getElementById("status");
const apiKeyInput = document.getElementById("apiKey");
const saveKeyBtn = document.getElementById("saveKeyBtn");
const keyStatus = document.getElementById("keyStatus");

const SIMPLELOGIN_API_BASE = "https://app.simplelogin.io/api";

// ---------- API key persistence (chrome.storage.local, never hardcoded) ----------
(async function loadStoredKey() {
  const { simpleLoginApiKey } = await chrome.storage.local.get("simpleLoginApiKey");
  if (simpleLoginApiKey) {
    apiKeyInput.value = simpleLoginApiKey;
    keyStatus.textContent = "Key loaded from storage";
  }
})();

saveKeyBtn.addEventListener("click", async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    keyStatus.textContent = "Enter a key first";
    return;
  }
  await chrome.storage.local.set({ simpleLoginApiKey: key });
  keyStatus.textContent = "Key saved";
});

// ---------- SimpleLogin alias management (create once, then reuse) ----------
const ALIAS_NOTE_PREFIX = "Created by Fake Form Filler";
// How many aliases the extension will create before it starts reusing them.
// Raise it if you want more variety, lower it (min 1) to save your quota.
const MAX_POOL_SIZE = 3;
const ALIASES_PAGE_SIZE = 20; // fixed by the SimpleLogin API
const MAX_PAGES_TO_SCAN = 5;

class SimpleLoginError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function slFetch(path, apiKey, options = {}) {
  const res = await fetch(`${SIMPLELOGIN_API_BASE}${path}`, {
    ...options,
    headers: {
      "Authentication": apiKey,
      "Content-Type": "application/json"
    }
  });
  if (res.status === 401) {
    throw new SimpleLoginError("Invalid or expired API key", 401);
  }
  return res;
}

async function errorFromResponse(res) {
  // SimpleLogin returns { "error": "..." } with a human-readable reason
  // (e.g. alias quota reached). Surface it instead of just the status code.
  let detail = "";
  try {
    const body = await res.json();
    detail = body.error || body.message || "";
  } catch (_) {}
  return new SimpleLoginError(
    `SimpleLogin API error (${res.status})${detail ? ": " + detail : ""}`,
    res.status
  );
}

async function createSimpleLoginAlias(apiKey) {
  const res = await slFetch("/alias/random/new", apiKey, {
    method: "POST",
    body: JSON.stringify({ note: `${ALIAS_NOTE_PREFIX} on ${new Date().toISOString()}` })
  });
  if (!res.ok) throw await errorFromResponse(res);

  const data = await res.json();
  const email = data.alias || data.email;
  if (!email) throw new SimpleLoginError("SimpleLogin API returned no alias", res.status);
  return { id: data.id, email };
}

// Finds aliases already created by this extension (recognized by their note).
// Aliases you created for real services are never touched.
async function findExistingOwnAliases(apiKey) {
  const found = [];
  for (let page = 0; page < MAX_PAGES_TO_SCAN; page++) {
    const res = await slFetch(`/v2/aliases?page_id=${page}`, apiKey);
    if (!res.ok) throw await errorFromResponse(res);
    const { aliases = [] } = await res.json();
    for (const a of aliases) {
      if (a.enabled && (a.note || "").startsWith(ALIAS_NOTE_PREFIX)) {
        found.push({ id: a.id, email: a.email });
      }
    }
    if (aliases.length < ALIASES_PAGE_SIZE) break;
  }
  return found;
}

// Still exists on SimpleLogin and still enabled?
async function isAliasUsable(apiKey, alias) {
  if (alias.id == null) return true; // can't verify, assume OK
  const res = await slFetch(`/aliases/${alias.id}`, apiKey);
  if (!res.ok) return false; // e.g. 404: deleted from the dashboard
  const data = await res.json();
  return data.enabled !== false;
}

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Returns { email, reused }. Strategy:
//  1. If fewer than MAX_POOL_SIZE aliases are known, create a new one.
//  2. If creation isn't possible (quota reached, API error) or the pool is
//     full, reuse a known alias (picked at random, after checking it's alive).
//  3. If nothing is known locally, look up the aliases this extension created
//     earlier on the SimpleLogin account and reuse those.
async function getEmailAlias(apiKey) {
  const stored = await chrome.storage.local.get("aliasPool");
  let pool = Array.isArray(stored.aliasPool) ? stored.aliasPool : [];
  const savePool = () => chrome.storage.local.set({ aliasPool: pool });
  let createError = null;

  if (pool.length < MAX_POOL_SIZE) {
    try {
      const created = await createSimpleLoginAlias(apiKey);
      pool.push(created);
      await savePool();
      return { email: created.email, reused: false };
    } catch (err) {
      if (err.status === 401) throw err; // bad key: reusing wouldn't help
      console.warn("Alias creation failed, trying to reuse one:", err.message);
      createError = err;
    }
  }

  if (pool.length === 0) {
    pool = (await findExistingOwnAliases(apiKey)).slice(0, MAX_POOL_SIZE);
    await savePool();
  }

  for (const candidate of shuffled(pool)) {
    if (await isAliasUsable(apiKey, candidate)) {
      return { email: candidate.email, reused: true };
    }
    pool = pool.filter((a) => a.id !== candidate.id);
    await savePool();
  }

  throw createError || new Error("no reusable alias found for this extension");
}

btn.addEventListener("click", async () => {
  btn.disabled = true;
  status.textContent = "Filling...";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      status.textContent = "No active tab found";
      btn.disabled = false;
      return;
    }

    // 1. Try to get a real, receivable email alias from SimpleLogin
    let emailAlias = null;
    let emailReused = false;
    let emailErrorMessage = null;
    const { simpleLoginApiKey } = await chrome.storage.local.get("simpleLoginApiKey");

    if (!simpleLoginApiKey) {
      emailErrorMessage = "no SimpleLogin API key saved";
    } else {
      try {
        const result = await getEmailAlias(simpleLoginApiKey);
        emailAlias = result.email;
        emailReused = result.reused;
        if (!emailAlias) {
          emailErrorMessage = "SimpleLogin API returned no alias";
        }
      } catch (apiErr) {
        console.warn("SimpleLogin alias creation failed:", apiErr.message);
        emailErrorMessage = apiErr.message;
      }
    }

    // 2. Expose the alias to content.js via a page-scoped global,
    //    set in an isolated injection that runs before content.js.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: (alias) => { window.__fakeFormFillerEmail = alias; },
      args: [emailAlias]
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["content.js"]
    });

    // Sum the filled-in fields across all frames on the page
    const total = results.reduce((sum, r) => sum + (typeof r.result === "number" ? r.result : 0), 0);

    if (total > 0) {
      if (emailAlias) {
        status.textContent = `${total} fields filled in (email: ${emailAlias}, ${emailReused ? "reused" : "new"})`;
      } else if (emailErrorMessage) {
        status.textContent = `${total} fields filled in — email skipped (${emailErrorMessage})`;
      } else {
        status.textContent = `${total} fields filled in`;
      }
    } else {
      status.textContent = "No compatible fields found on this page";
    }
  } catch (err) {
    status.textContent = "Unable to perform actions on this page";
  } finally {
    btn.disabled = false;
  }
});