(() => {
  const config = window.CAMPUS_CONFIG || {};
  const API = (config.apiUrl || "https://campus-connect-api-lxnl.onrender.com").replace(/\/$/, "");
  const authDialog = document.getElementById("authDialog");
  const eventDialog = document.getElementById("eventDialog");
  const eventGrid = document.getElementById("eventGrid");
  const emptyState = document.getElementById("emptyState");
  const message = document.getElementById("message");
  const apiStatus = document.getElementById("apiStatus");
  const searchInput = document.getElementById("searchInput");
  let events = [];
  let registrations = [];
  let session = null;
  let currentFilter = "all";
  let authMode = "signin";
  let supabaseClient = null;

  if (window.supabase?.createClient && config.supabaseUrl && config.supabasePublishableKey && !config.supabaseUrl.includes("your-project-ref")) {
    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  }

  function announce(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("error", isError);
    message.hidden = !text;
  }

  function setAuthError(text) {
    const element = document.getElementById("authError");
    element.textContent = text;
    element.hidden = !text;
  }

  function setEventError(text) {
    const element = document.getElementById("eventError");
    element.textContent = text;
    element.hidden = !text;
  }

  function activeUserId() {
    return session?.user?.id || "";
  }

  async function api(path, options = {}) {
    const headers = { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const response = await fetch(`${API}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || `Request failed (${response.status})`);
    return payload.data;
  }

  function updateAccount() {
    const signedIn = Boolean(session?.user);
    document.getElementById("signInButton").hidden = signedIn;
    document.getElementById("signOutButton").hidden = !signedIn;
    document.getElementById("accountLabel").textContent = signedIn ? (session.user.email || "Signed in") : "Your campus, together";
    document.getElementById("hostButton").textContent = signedIn ? "＋ Host an event" : "＋ Sign in to host";
  }

  function statusIsOpen(event) {
    return String(event.status || "OPEN").toUpperCase() === "OPEN";
  }

  function render() {
    const query = searchInput.value.trim().toLowerCase();
    const mine = new Set(registrations.map((item) => item.event_id));
    let visible = events.filter((event) => (event.title || "").toLowerCase().includes(query));
    if (currentFilter === "open") visible = visible.filter(statusIsOpen);
    if (currentFilter === "mine") visible = visible.filter((event) => mine.has(event.id));
    document.getElementById("eventCount").textContent = events.length;
    document.getElementById("openCount").textContent = events.filter(statusIsOpen).length;
    eventGrid.replaceChildren();

    for (const event of visible) {
      const card = document.createElement("article");
      card.className = "event-card";
      const meta = document.createElement("div");
      meta.className = "card-meta";
      const tag = document.createElement("span");
      tag.className = "event-tag";
      tag.textContent = "CAMPUS EVENT";
      const state = document.createElement("span");
      state.className = `status-pill${statusIsOpen(event) ? "" : " closed"}`;
      state.textContent = statusIsOpen(event) ? "OPEN" : "CLOSED";
      meta.append(tag, state);

      const title = document.createElement("h3");
      title.textContent = event.title || "Untitled event";
      const description = document.createElement("p");
      description.textContent = "Show up, meet your people, and make something happen.";
      const footer = document.createElement("div");
      footer.className = "card-footer";
      const capacity = document.createElement("span");
      capacity.className = "capacity";
      capacity.textContent = event.capacity == null ? "No capacity limit" : `Capacity ${event.capacity}`;
      const actions = document.createElement("div");
      actions.className = "card-actions";
      const isOrganizer = activeUserId() && event.organizer_id === activeUserId();
      const registration = registrations.find((item) => item.event_id === event.id);

      if (isOrganizer) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "small-button secondary";
        toggle.textContent = statusIsOpen(event) ? "Close RSVPs" : "Reopen";
        toggle.addEventListener("click", () => changeEventStatus(event));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "small-button danger";
        remove.textContent = "Delete";
        remove.setAttribute("aria-label", `Delete ${event.title}`);
        remove.addEventListener("click", () => deleteEvent(event));
        actions.append(toggle, remove);
      } else if (registration) {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "small-button secondary";
        cancel.textContent = "Cancel RSVP";
        cancel.addEventListener("click", () => cancelRegistration(registration));
        actions.append(cancel);
      } else {
        const join = document.createElement("button");
        join.type = "button";
        join.className = "small-button";
        join.textContent = session ? "Save my spot" : "Sign in to RSVP";
        join.disabled = !statusIsOpen(event);
        join.addEventListener("click", () => registerForEvent(event));
        actions.append(join);
      }

      footer.append(capacity, actions);
      card.append(meta, title, description, footer);
      eventGrid.append(card);
    }
    emptyState.hidden = visible.length !== 0;
  }

  async function loadEvents() {
    apiStatus.innerHTML = '<span class="pulse"></span> Loading campus events…';
    document.getElementById("refreshButton").disabled = true;
    try {
      events = (await api("/api/events")) || [];
      apiStatus.innerHTML = `<span class="pulse"></span> Connected to the events board · ${events.length} live events`;
      if (session) await loadRegistrations();
      render();
    } catch (error) {
      apiStatus.innerHTML = '<span class="pulse"></span> Events board unavailable';
      announce(`${error.message}. Try refreshing in a moment.`, true);
      render();
    } finally {
      document.getElementById("refreshButton").disabled = false;
    }
  }

  async function loadRegistrations() {
    if (!session) { registrations = []; return; }
    try { registrations = (await api("/api/registrations")) || []; }
    catch (error) { registrations = []; announce(error.message, true); }
  }

  async function requireSignIn() {
    if (session) return true;
    authMode = "signin";
    updateAuthDialog();
    authDialog.showModal();
    announce("Sign in or create a campus account to continue.");
    return false;
  }

  async function registerForEvent(event) {
    if (!(await requireSignIn())) return;
    try {
      await api("/api/registrations", { method: "POST", body: JSON.stringify({ event_id: event.id }) });
      announce(`You’re on the list for ${event.title}. See you there!`);
      await loadRegistrations();
      render();
    } catch (error) { announce(error.message, true); }
  }

  async function cancelRegistration(registration) {
    try {
      await api(`/api/registrations/${encodeURIComponent(registration.id)}`, { method: "DELETE" });
      announce("Your RSVP has been cancelled.");
      await loadRegistrations();
      render();
    } catch (error) { announce(error.message, true); }
  }

  async function createEvent(form) {
    const values = new FormData(form);
    const capacityValue = String(values.get("capacity") || "").trim();
    const body = { title: String(values.get("title")).trim(), status: values.get("status") };
    if (capacityValue) body.capacity = Number(capacityValue);
    try {
      await api("/api/events", { method: "POST", body: JSON.stringify(body) });
      eventDialog.close();
      form.reset();
      announce("Your event is live. Bring your people together!");
      await loadEvents();
    } catch (error) { setEventError(error.message); }
  }

  async function changeEventStatus(event) {
    const status = statusIsOpen(event) ? "CLOSED" : "OPEN";
    try {
      await api(`/api/events/${encodeURIComponent(event.id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
      announce(status === "OPEN" ? "RSVPs reopened." : "RSVPs closed for this event.");
      await loadEvents();
    } catch (error) { announce(error.message, true); }
  }

  async function deleteEvent(event) {
    if (!window.confirm(`Delete “${event.title}”? This also removes its RSVPs.`)) return;
    try {
      await api(`/api/events/${encodeURIComponent(event.id)}`, { method: "DELETE" });
      announce("Event deleted.");
      await loadEvents();
    } catch (error) { announce(error.message, true); }
  }

  function updateAuthDialog() {
    const creating = authMode === "signup";
    document.getElementById("authTitle").textContent = creating ? "Find your people." : "Welcome back.";
    document.getElementById("authDescription").textContent = creating ? "Create an account to RSVP and host events." : "Sign in to RSVP and keep track of your events.";
    document.getElementById("authSubmit").textContent = creating ? "Create account" : "Sign in";
    document.getElementById("authSwitch").textContent = creating ? "Already have an account? Sign in" : "New here? Create an account";
    document.querySelector('#authForm input[name="password"]').autocomplete = creating ? "new-password" : "current-password";
  }

  document.getElementById("signInButton").addEventListener("click", () => {
    if (!supabaseClient) {
      announce("Sign-in needs the Supabase settings in campus-frontend/config.js. Event browsing still works.", true);
      return;
    }
    authMode = "signin";
    setAuthError("");
    updateAuthDialog();
    authDialog.showModal();
  });
  document.getElementById("signOutButton").addEventListener("click", async () => {
    await supabaseClient?.auth.signOut();
    session = null;
    registrations = [];
    updateAccount();
    render();
    announce("You’ve signed out.");
  });
  document.getElementById("authSwitch").addEventListener("click", () => {
    authMode = authMode === "signin" ? "signup" : "signin";
    setAuthError("");
    updateAuthDialog();
  });
  document.getElementById("authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    setAuthError("");
    if (!supabaseClient) { setAuthError("Supabase settings are not configured for this frontend."); return; }
    const form = new FormData(event.currentTarget);
    const credentials = { email: String(form.get("email")).trim(), password: String(form.get("password")) };
    const result = authMode === "signup" ? await supabaseClient.auth.signUp(credentials) : await supabaseClient.auth.signInWithPassword(credentials);
    if (result.error) { setAuthError(result.error.message); return; }
    if (result.data.session) {
      session = result.data.session;
      authDialog.close();
      updateAccount();
      announce(authMode === "signup" ? "Account created. Welcome to Campus Connect!" : "You’re signed in. Pick your next campus moment.");
      await loadRegistrations();
      render();
    } else {
      setAuthError("Check your email to confirm your account, then come back and sign in.");
    }
  });
  document.getElementById("hostButton").addEventListener("click", async () => {
    if (!(await requireSignIn())) return;
    setEventError("");
    eventDialog.showModal();
  });
  document.getElementById("eventForm").addEventListener("submit", (event) => {
    event.preventDefault();
    createEvent(event.currentTarget);
  });
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
  document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
  document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach((item) => item.classList.toggle("active", item === button));
    if (currentFilter === "mine" && !session) {
      authMode = "signin";
      updateAuthDialog();
      authDialog.showModal();
    }
    render();
  }));
  searchInput.addEventListener("input", render);
  document.getElementById("refreshButton").addEventListener("click", loadEvents);

  if (supabaseClient) {
    supabaseClient.auth.getSession().then(({ data }) => {
      session = data.session;
      updateAccount();
      if (session) loadRegistrations().then(render);
    });
    supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      updateAccount();
      if (session) loadRegistrations().then(render);
    });
  } else {
    document.getElementById("signInButton").title = "Configure Supabase to enable accounts";
  }
  updateAccount();
  loadEvents();
})();
