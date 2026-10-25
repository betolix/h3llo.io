// Visit counter and anonymous visit summary, shared by index.html and
// profiles.html. The arrival is counted once per browser-tab session; what the
// visitor did across both pages is sent once as a summary when they leave.
// No visitor IDs are created: "returning" comes from a local visit tally.
(function () {
  const endpoint = "https://4rqnv2a4lcabaobur3o6btm2ki0ixixy.lambda-url.us-east-1.on.aws/";
  const countedKey = "h3llo-global-visit-counted";
  const lastCountKey = "h3llo-global-last-count";
  const sessionKey = "h3llo-session";

  // Storage can throw (blocked site data, some private modes).
  const safe = area => ({
    get(key) { try { return window[area].getItem(key); } catch (e) { return null; } },
    set(key, value) { try { window[area].setItem(key, value); } catch (e) {} }
  });
  const tab = safe("sessionStorage");
  const browser = safe("localStorage");

  let session = null;
  try { session = JSON.parse(tab.get(sessionKey)); } catch (e) {}
  session = session || {
    visit: null, ref: "", pages: {}, cvs: [], views: [], languages: [], contacts: [],
    easterEgg: false, version: 0, sentVersion: 0, sent: false
  };
  const save = () => tab.set(sessionKey, JSON.stringify(session));
  const changed = () => { session.version++; save(); };
  const addOnce = (list, value) => {
    if (value && !session[list].includes(value)) { session[list].push(value); changed(); }
  };

  const path = location.pathname.split("/").pop() || "index.html";
  const page = session.pages[path] = session.pages[path] || { seconds: 0, scroll: 0 };
  save();

  // ---- Visit counter ----
  const counter = document.getElementById("visit-count");
  const cachedCount = tab.get(lastCountKey);
  if (counter) counter.textContent = cachedCount || "—";

  if (tab.get(countedKey) !== "1") {
    const previousVisits = parseInt(browser.get("h3llo-visit-total") || "0", 10) || 0;
    const firstSeen = browser.get("h3llo-first-seen");
    browser.set("h3llo-visit-total", String(previousVisits + 1));
    if (!firstSeen) browser.set("h3llo-first-seen", new Date().toISOString().slice(0, 10));

    // Tag shared links with ?ref=company-role to see which application a visit came from.
    const params = new URLSearchParams(location.search);
    session.ref = (params.get("ref") || params.get("utm_campaign") || params.get("utm_source") || "").slice(0, 100);
    save();

    const payload = {
      type: "visit",
      page: location.href,
      referrer: document.referrer || "Direct / Unknown",
      language: navigator.language || "Unknown",
      userAgent: navigator.userAgent || "Unknown",
      ref: session.ref,
      timezone: (Intl.DateTimeFormat().resolvedOptions().timeZone) || "Unknown",
      screen: screen.width + "×" + screen.height,
      viewport: innerWidth + "×" + innerHeight,
      device: matchMedia("(pointer: coarse)").matches ? "Touch screen" : "Mouse / trackpad",
      previousVisits: previousVisits,
      firstSeen: firstSeen || ""
    };

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
    .then(res => {
      if (!res.ok) throw new Error("Visit endpoint returned " + res.status);
      return res.json();
    })
    .then(data => {
      if (typeof data.visits !== "number") return;
      if (counter) counter.textContent = data.visits.toLocaleString();
      tab.set(lastCountKey, String(data.visits));
      tab.set(countedKey, "1");
      session.visit = data.visits;
      save();
    })
    .catch(err => {
      console.warn("Visit counter unavailable:", err);
      // Keep the footer discreet if the backend is temporarily unavailable.
      if (counter && !cachedCount) counter.textContent = "—";
    });
  }

  // ---- What the visitor does ----
  let internalNavAt = 0;
  document.addEventListener("click", e => {
    const el = e.target.closest && e.target.closest("a, button");
    if (!el) return;
    if (el.dataset.viewButton) addOnce("views", el.dataset.viewButton === "table" ? "Recruiter table" : "Story");
    const lang = el.dataset.langButton || el.dataset.lang;
    if (lang) addOnce("languages", lang.toUpperCase());
    if (el.tagName !== "A") return;
    const href = el.getAttribute("href") || "";
    if (/\.pdf$/i.test(href)) addOnce("cvs", href.split("/").pop());
    else if (href.startsWith("mailto:")) addOnce("contacts", "Email");
    else if (/linkedin\.com/i.test(href)) addOnce("contacts", "LinkedIn");
    else if (el.origin === location.origin && el.pathname !== location.pathname && el.target !== "_blank") {
      // Moving to the other page continues this visit; don't send the summary yet.
      internalNavAt = Date.now();
    }
  }, true);

  document.addEventListener("h3llo:easter-egg", () => { session.easterEgg = true; changed(); });

  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const height = document.documentElement.scrollHeight;
      const seen = Math.min(100, Math.round((scrollY + innerHeight) / height * 100));
      const bucket = Math.floor(seen / 25) * 25;
      if (bucket > page.scroll) { page.scroll = bucket; changed(); }
    });
  }, { passive: true });

  // Count only time the page is actually visible.
  let visibleSince = document.visibilityState === "visible" ? Date.now() : null;
  function flushTime() {
    if (visibleSince) page.seconds += Math.round((Date.now() - visibleSince) / 1000);
    visibleSince = null;
    save();
  }

  function engaged() {
    const pages = Object.values(session.pages);
    return session.cvs.length || session.views.length || session.languages.length ||
      session.contacts.length || session.easterEgg ||
      pages.some(p => p.scroll >= 50) || pages.reduce((sum, p) => sum + p.seconds, 0) >= 20;
  }

  function sendSummary() {
    if (Date.now() - internalNavAt < 3000) return;
    if (!engaged() || (session.sent && session.version === session.sentVersion)) return;
    const summary = JSON.stringify({
      type: "summary",
      visit: session.visit,
      ref: session.ref,
      update: session.sent,
      pages: session.pages,
      cvs: session.cvs,
      views: session.views,
      languages: session.languages,
      contacts: session.contacts,
      easterEgg: session.easterEgg
    });
    // sendBeacon survives the page closing; it posts as text/plain, so no CORS preflight.
    const queued = navigator.sendBeacon && navigator.sendBeacon(endpoint, summary);
    if (!queued) fetch(endpoint, { method: "POST", body: summary, keepalive: true }).catch(() => {});
    session.sent = true;
    session.sentVersion = session.version;
    save();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { visibleSince = Date.now(); return; }
    flushTime();
    sendSummary();
  });
  addEventListener("pagehide", () => { flushTime(); sendSummary(); });
})();
