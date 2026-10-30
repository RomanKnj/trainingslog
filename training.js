/* Trainings-Seite: Gym-Besuch per Knopf, pro Übung Sätze (Wdh. x kg) bzw. Cardio-Werte für den gewählten Tag.
   Jede Änderung speichert sich nach kurzer Pause von selbst. Eine offene Übung wird beim Speichern nicht neu
   gezeichnet (sonst ginge der Fokus im Eingabefeld verloren), nur ihre Kopfzeile und die Übersichten.
   Alle Texte gehen über textContent, nie über innerHTML. */
(() => {
  "use strict";
  const $ = (sel) => document.querySelector(sel);
  const SAVE_DELAY = 600;
  const DEFAULT_SETS = 3;
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const DAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const CARDIO = [["min", "Minuten", "numeric"], ["km", "km", "decimal"], ["stufe", "Stufe / Steigung", "decimal"], ["kcal", "kcal", "numeric"]];

  const pad = (n) => String(n).padStart(2, "0");
  function todayIso() { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; }

  let groups = [];
  let groupById = {};
  let exercises = [];
  let days = {};
  let loaded = false;
  let sel = todayIso();
  let calYear = Number(sel.slice(0, 4));
  let calMonth = Number(sel.slice(5, 7)) - 1;
  let filter = "all";
  let search = "";
  let hidden = new Set();   // ausgeblendete Übungen (nicht genutzte Maschinen, kein Interesse)
  let managing = false;     // "Auswahl bearbeiten": Antippen blendet aus/ein statt aufzuklappen
  let group = null;         // Ranglisten-Gruppe: code, member_id, secret, name, group_name
  const open = new Set();   // aufgeklappte Übungen
  const drafts = new Map(); // "Datum|Übung" -> Sätze/Cardio, wie gerade in den Feldern
  const timers = new Map(); // "Datum|Übung" -> Zeitgeber fürs Speichern
  const cards = new Map();  // Übung -> Element der Karte
  try { filter = localStorage.getItem("training-filter") || "all"; } catch (e) { /* ohne Speicher: alle */ }

  // ---------- Hilfen ----------

  const make = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  const dayNum = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const fromDayNum = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
  const weekday = (s) => DAYS[new Date(dayNum(s) * 86400000).getUTCDay()];
  const short = (s) => `${s.slice(8)}.${s.slice(5, 7)}.`;
  const mondayOf = (s) => { const n = dayNum(s); return n - ((new Date(n * 86400000).getUTCDay() + 6) % 7); };
  const fmt = (n) => String(n).replace(".", ",");
  const parseNum = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };
  const isCardio = (ex) => ex.group === "cardio";

  // ---------- Speicherort ----------
  // Auf dem Pi spricht die Seite mit /api/training (training_page.py). Die GitHub-Pages-Version (<html data-mode="local">)
  // speichert im Browser (localStorage) nach denselben Regeln; gesichert wird dort über "Als Datei sichern".
  const LOCAL = document.documentElement.dataset.mode === "local";
  const STORE_KEY = "trainingslog-daten";
  const MAX_SETS = 30;
  const CARDIO_FIELDS = ["min", "km", "stufe", "kcal"];
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const errText = (err) => (err.message === "Failed to fetch" ? (LOCAL ? "Keine Verbindung" : "Pi nicht erreichbar") : err.message);

  async function api(path, options) {
    const res = await fetch(path, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Fehler ${res.status}`);
    return body;
  }
  const send = (method, path, body) => api(path, {
    method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });

  const serverStore = {
    all: () => api("/api/training"),
    entry: (day, id, body) => send("PUT", `/api/training/${day}/entry/${id}`, body),
    visit: (day, visit) => send("PUT", `/api/training/${day}/visit`, { visit }),
    addExercise: (name, group) => send("POST", "/api/training/exercises", { name, group }),
    removeExercise: (id) => send("DELETE", `/api/training/exercises/${id}`),
    setHidden: (list) => send("PUT", "/api/training/hidden", { hidden: list }),
    setGroup: (g) => send("PUT", "/api/training/group", { group: g }),
  };

  const localStore = (() => {
    let catalog = null;
    const read = () => {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { d = null; }
      if (!d || typeof d !== "object") d = {};
      if (!Array.isArray(d.custom)) d.custom = [];
      if (!Array.isArray(d.hidden)) d.hidden = [];
      if (!d.days || typeof d.days !== "object") d.days = {};
      return d;
    };
    const persist = (d) => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch (e) {
        throw new Error("Speichern im Browser nicht möglich (privater Modus oder Speicher voll?)");
      }
    };
    const write = (d) => {
      d.changed = new Date().toISOString();
      if (!d.since) d.since = d.changed; // erster Eintrag überhaupt: ab hier zählt die Woche bis zur ersten Erinnerung
      persist(d);
      // Bitte an den Browser, die Daten nicht von selbst aufzuräumen, wenn der Speicher knapp wird
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    };
    const exList = (d) => [
      ...catalog.exercises.map((x) => ({ ...x, custom: false })),
      ...d.custom.map((x) => ({ ...x, reps: "Wdh.", custom: true })),
    ];
    const num = (v, name, high, whole) => {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > high) throw new Error(`${name}: Zahl von 0 bis ${high}`);
      return whole ? Math.trunc(v) : Math.round(v * 100) / 100;
    };
    const cleanEntry = (body, group) => {
      if (group === "cardio") {
        const v = body.cardio;
        if (!v || typeof v !== "object") throw new Error("cardio fehlt");
        const c = {};
        CARDIO_FIELDS.forEach((k) => { c[k] = num(v[k] ?? 0, k, 10000); });
        return Object.values(c).some(Boolean) ? { cardio: c } : null;
      }
      const sets = body.sets;
      if (!Array.isArray(sets) || sets.length > MAX_SETS) throw new Error(`Höchstens ${MAX_SETS} Sätze`);
      const clean = sets.filter((s) => s && typeof s === "object")
        .map((s) => ({ reps: num(s.reps ?? 0, "Wiederholungen", 1000, true), kg: num(s.kg ?? 0, "kg", 1000) }));
      return clean.some((s) => s.reps || s.kg) ? { sets: clean } : null;
    };
    const checkDay = (day) => { if (!DATE_RE.test(day)) throw new Error("Datum im Format JJJJ-MM-TT"); };
    const tidy = (d, day) => {
      const x = d.days[day];
      if (x && !Object.keys(x.entries).length && !x.visit) delete d.days[day];
    };
    const newId = () => "eigen-" + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");

    return {
      async all() {
        if (!catalog) {
          const res = await fetch("catalog.json", { cache: "no-cache" });
          if (!res.ok) throw new Error("Übungsliste nicht gefunden");
          catalog = await res.json();
        }
        const d = read();
        const known = new Set(exList(d).map((x) => x.id));
        return { groups: catalog.groups, exercises: exList(d), days: d.days, hidden: d.hidden.filter((id) => known.has(id)), group: d.group || null };
      },
      async setGroup(g) {
        const d = read();
        d.group = g;
        persist(d); // zählt nicht als neuer Eintrag für die Sicherungs-Erinnerung
      },
      async setHidden(list) {
        const d = read();
        const known = new Set(exList(d).map((x) => x.id));
        if (!Array.isArray(list) || list.some((id) => !known.has(id))) throw new Error("Unbekannte Übung");
        d.hidden = [...new Set(list)];
        write(d);
        return { hidden: d.hidden };
      },
      async entry(day, id, body) {
        checkDay(day);
        const d = read();
        const ex = exList(d).find((x) => x.id === id);
        if (!ex) throw new Error("Unbekannte Übung");
        const entry = cleanEntry(body, ex.group);
        const x = d.days[day] || (d.days[day] = { visit: false, entries: {} });
        if (entry) { x.entries[id] = entry; x.visit = true; } else delete x.entries[id];
        tidy(d, day);
        write(d);
        return { day: d.days[day] || null };
      },
      async visit(day, visit) {
        checkDay(day);
        const d = read();
        const x = d.days[day] || (d.days[day] = { visit: false, entries: {} });
        x.visit = Boolean(visit);
        tidy(d, day);
        write(d);
        return { day: d.days[day] || null };
      },
      async addExercise(name, group) {
        name = String(name || "").replace(/\s+/g, " ").trim();
        if (name.length < 2 || name.length > 60 || !catalog.groups.some((g) => g.id === group)) {
          throw new Error("Name (2 bis 60 Zeichen) und Bereich nötig");
        }
        const d = read();
        if (exList(d).some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error("Diese Übung gibt es schon");
        const item = { id: newId(), name, group };
        d.custom.push(item);
        write(d);
        return { ...item, reps: "Wdh.", custom: true };
      },
      async removeExercise(id) {
        const d = read();
        if (!d.custom.some((x) => x.id === id)) throw new Error("Nur eigene Übungen lassen sich entfernen");
        if (Object.values(d.days).some((x) => x.entries[id])) throw new Error("Die Übung hat Einträge und bleibt deshalb");
        d.custom = d.custom.filter((x) => x.id !== id);
        d.hidden = d.hidden.filter((x) => x !== id);
        write(d);
        return { deleted: id };
      },
      // Sicherung als Datei
      meta() {
        const d = read();
        return { changed: d.changed || null, exported: d.exported || null, since: d.since || null, dayCount: Object.keys(d.days).length };
      },
      markExported() {
        const d = read();
        d.exported = new Date().toISOString();
        persist(d);
      },
      /** Prüft eine Sicherungsdatei Eintrag für Eintrag. Ergebnis: neue Daten plus wie viel übersprungen wurde. */
      check(file) {
        if (!file || typeof file !== "object" || !file.days || typeof file.days !== "object") throw new Error("Keine Trainings-Sicherung");
        const groupIds = new Set(catalog.groups.map((g) => g.id));
        const custom = [];
        (Array.isArray(file.custom) ? file.custom : []).forEach((x) => {
          if (x && typeof x.id === "string" && x.id.length <= 40 && typeof x.name === "string" && x.name.trim().length >= 2
              && x.name.length <= 60 && groupIds.has(x.group) && !custom.some((c) => c.id === x.id)) {
            custom.push({ id: x.id, name: x.name.trim(), group: x.group });
          }
        });
        const d = { custom, days: {}, hidden: [] };
        const known = new Map(exList(d).map((x) => [x.id, x]));
        d.hidden = [...new Set((Array.isArray(file.hidden) ? file.hidden : []).filter((id) => known.has(id)))];
        let skipped = 0;
        Object.entries(file.days).forEach(([day, v]) => {
          if (!DATE_RE.test(day) || !v || typeof v !== "object") { skipped++; return; }
          const entries = {};
          Object.entries(v.entries && typeof v.entries === "object" ? v.entries : {}).forEach(([id, e]) => {
            try {
              const ex = known.get(id);
              const clean = ex && e && typeof e === "object" ? cleanEntry(e, ex.group) : null;
              if (clean) entries[id] = clean; else skipped++;
            } catch (err) { skipped++; }
          });
          if (Object.keys(entries).length || v.visit) d.days[day] = { visit: Boolean(v.visit) || Object.keys(entries).length > 0, entries };
        });
        const g = file.group;
        const validGroup = g && ["code", "member_id", "secret", "name", "group_name"].every((k) => typeof g[k] === "string");
        d.group = validGroup ? g : read().group || null; // Sicherung ohne Gruppe: aktuelle Gruppe behalten
        return { data: d, skipped };
      },
      replace(d) {
        const now = new Date().toISOString();
        d.changed = d.exported = d.since = now; // was geladen wurde, liegt ja schon als Datei vor
        persist(d);
      },
    };
  })();

  const store = LOCAL ? localStore : serverStore;

  function banner(text, level) {
    $("#banner").dataset.level = level;
    $("#banner-text").textContent = text;
  }

  // ---------- Daten lesen ----------

  const dayData = (d) => days[d] || { visit: false, entries: {} };
  const entryOf = (d, id) => dayData(d).entries[id] || null;
  const visited = (d) => Boolean(days[d] && (days[d].visit || Object.keys(days[d].entries).length));

  function summary(ex, entry) {
    if (!entry) return "";
    if (entry.cardio) {
      const c = entry.cardio;
      return [c.min && `${fmt(c.min)} min`, c.km && `${fmt(c.km)} km`, c.stufe && `Stufe ${fmt(c.stufe)}`, c.kcal && `${fmt(c.kcal)} kcal`]
        .filter(Boolean).join(" · ");
    }
    const sets = entry.sets.filter((s) => s.reps || s.kg);
    const unit = ex.reps === "Sek." ? " Sek." : "";
    return `${sets.length} ${sets.length === 1 ? "Satz" : "Sätze"}: ` +
      sets.map((s) => (s.kg ? `${s.reps}×${fmt(s.kg)}` : `${s.reps}${unit || " Wdh."}`)).join(" · ");
  }

  /** Frühere Einträge einer Übung (nicht der gewählte Tag), neueste zuerst. */
  function history(id) {
    return Object.keys(days).filter((d) => d !== sel && days[d].entries[id]).sort().reverse()
      .map((d) => ({ date: d, entry: days[d].entries[id] }));
  }

  function draftOf(ex) {
    const key = `${sel}|${ex.id}`;
    if (!drafts.has(key)) {
      const entry = entryOf(sel, ex.id);
      if (isCardio(ex)) drafts.set(key, { ...{ min: 0, km: 0, stufe: 0, kcal: 0 }, ...(entry ? entry.cardio : {}) });
      else drafts.set(key, entry ? entry.sets.map((s) => ({ ...s })) : Array.from({ length: DEFAULT_SETS }, () => ({ reps: 0, kg: 0 })));
    }
    return drafts.get(key);
  }

  // ---------- Speichern ----------

  function scheduleSave(ex, card) {
    const key = `${sel}|${ex.id}`;
    const day = sel;
    setState(card, "…", "");
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      const draft = drafts.get(key);
      try {
        const res = await store.entry(day, ex.id, isCardio(ex) ? { cardio: draft } : { sets: draft });
        if (res.day) days[day] = res.day; else delete days[day];
        if (day === sel) { updateHead(ex); setState(card, "Gespeichert ✓", "ok"); }
        renderSide();
        schedulePush();
      } catch (err) {
        setState(card, "Nicht gespeichert: " + errText(err), "err");
      }
    }, SAVE_DELAY));
  }

  function setState(card, text, cls) {
    const el = card && card.querySelector(".state");
    if (el) { el.textContent = text; el.className = "state " + cls; }
  }

  // ---------- Übungskarten ----------

  function numInput(value, mode, label, onChange) {
    const input = make("input", "num" + (value ? "" : " zero"));
    input.inputMode = mode;
    input.value = fmt(value);
    input.setAttribute("aria-label", label);
    input.addEventListener("focus", () => input.select());
    input.addEventListener("input", () => {
      const n = mode === "numeric" ? Math.floor(parseNum(input.value)) : parseNum(input.value);
      input.classList.toggle("zero", !n);
      onChange(n);
    });
    input.addEventListener("blur", () => { if (input.value.trim() === "") input.value = "0"; });
    return input;
  }

  function buildBody(ex, card) {
    const body = make("div", "card-body");
    const draft = draftOf(ex);
    const changed = () => scheduleSave(ex, card);

    if (isCardio(ex)) {
      const grid = make("div", "cardio");
      CARDIO.forEach(([k, label, mode]) => {
        const l = make("label", null, label);
        l.appendChild(numInput(draft[k], mode, `${ex.name}: ${label}`, (n) => { draft[k] = n; changed(); }));
        grid.appendChild(l);
      });
      body.appendChild(grid);
    } else {
      const table = make("table", "sets");
      const head = make("tr");
      ["Satz", ex.reps, "", "kg", ""].forEach((t) => head.appendChild(make("th", null, t)));
      table.appendChild(make("thead")).appendChild(head);
      const tbody = make("tbody");
      draft.forEach((s, i) => {
        const tr = make("tr");
        tr.appendChild(make("td", "n", String(i + 1)));
        tr.appendChild(make("td")).appendChild(numInput(s.reps, "numeric", `Satz ${i + 1}: ${ex.reps}`, (n) => { s.reps = n; changed(); }));
        tr.appendChild(make("td", "x", "×"));
        tr.appendChild(make("td")).appendChild(numInput(s.kg, "decimal", `Satz ${i + 1}: kg`, (n) => { s.kg = n; changed(); }));
        const del = make("td", "del");
        if (draft.length > 1) {
          const rm = make("button", "rm", "✕");
          rm.type = "button";
          rm.setAttribute("aria-label", `Satz ${i + 1} entfernen`);
          rm.addEventListener("click", () => { draft.splice(i, 1); rebuild(ex); changed(); });
          del.appendChild(rm);
        }
        tr.appendChild(del);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      body.appendChild(table);
    }

    const actions = make("div", "card-actions");
    if (!isCardio(ex)) {
      const add = make("button", "btn add", "+ Satz");
      add.type = "button";
      add.addEventListener("click", () => {
        const last = draft[draft.length - 1] || { reps: 0, kg: 0 };
        draft.push({ ...last }); // neuer Satz startet mit den Werten des letzten
        rebuild(ex);
        const inputs = cards.get(ex.id).querySelectorAll("tbody tr:last-child .num");
        if (inputs[0]) inputs[0].focus();
        if (last.reps || last.kg) changed();
      });
      actions.appendChild(add);
    }
    const prev = history(ex.id).find((h) => h.date < sel) || history(ex.id)[0];
    if (prev) {
      const copy = make("button", "btn", "Wie am " + short(prev.date));
      copy.type = "button";
      copy.title = summary(ex, prev.entry);
      copy.addEventListener("click", () => {
        const key = `${sel}|${ex.id}`;
        drafts.set(key, prev.entry.cardio ? { ...prev.entry.cardio } : prev.entry.sets.map((s) => ({ ...s })));
        rebuild(ex);
        changed();
      });
      actions.appendChild(copy);
    }
    const hide = make("button", "btn", hidden.has(ex.id) ? "Einblenden" : "Ausblenden");
    hide.type = "button";
    hide.title = "Ausgeblendete Übungen erscheinen nur noch bei der Suche und unter „Auswahl bearbeiten“";
    hide.addEventListener("click", () => {
      const on = !hidden.has(ex.id);
      setHidden(ex.id, on);
      if (on) open.delete(ex.id);
      renderList();
    });
    actions.appendChild(hide);
    if (ex.custom) {
      const rm = make("button", "btn danger", "Übung entfernen");
      rm.type = "button";
      rm.addEventListener("click", () => removeExercise(ex, card));
      actions.appendChild(rm);
    }
    actions.appendChild(make("span", "state", entryOf(sel, ex.id) ? "Gespeichert" : ""));
    body.appendChild(actions);

    const hist = history(ex.id);
    if (hist.length) {
      const ul = make("ul", "last");
      if (!isCardio(ex)) {
        let best = null;
        const all = entryOf(sel, ex.id) ? [{ date: sel, entry: entryOf(sel, ex.id) }, ...hist] : hist;
        all.forEach((h) => h.entry.sets.forEach((s) => {
          if (!best || s.kg > best.kg || (s.kg === best.kg && s.reps > best.reps)) best = { ...s, date: h.date };
        }));
        if (best && best.kg) {
          const li = make("li", "best");
          li.append(make("time", null, "Bestwert"), make("span", null, `${best.reps}×${fmt(best.kg)} kg (${short(best.date)})`));
          ul.appendChild(li);
        }
      }
      hist.slice(0, 4).forEach((h) => {
        const li = make("li");
        li.append(make("time", null, `${weekday(h.date)} ${short(h.date)}`), make("span", null, summary(ex, h.entry)));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }
    return body;
  }

  function headText(ex) {
    const entry = entryOf(sel, ex.id);
    if (entry) return summary(ex, entry);
    const h = history(ex.id)[0];
    return h ? `zuletzt ${short(h.date)}: ${summary(ex, h.entry)}` : "noch nicht eingetragen";
  }

  function updateHead(ex) {
    const card = cards.get(ex.id);
    if (!card) return;
    card.classList.toggle("has", Boolean(entryOf(sel, ex.id)));
    card.classList.toggle("is-hidden", hidden.has(ex.id));
    card.querySelector(".card-head small").textContent = headText(ex);
    card.querySelector(".card-head i").textContent = managing ? (hidden.has(ex.id) ? "ausgeblendet" : "sichtbar") : "›";
  }

  function buildCard(ex) {
    const card = make("div", "card");
    card.style.setProperty("--g", groupById[ex.group].color);
    const head = make("button", "card-head");
    head.type = "button";
    head.append(make("b", null, ex.name), make("i", null, "›"), make("small"));
    head.addEventListener("click", () => {
      if (managing) { // nur umschalten, die Liste bleibt stehen
        setHidden(ex.id, !hidden.has(ex.id));
        updateHead(ex);
        return;
      }
      if (open.has(ex.id)) open.delete(ex.id); else open.add(ex.id);
      rebuild(ex);
      if (open.has(ex.id)) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    card.appendChild(head);
    cards.set(ex.id, card);
    fillCard(ex, card);
    return card;
  }

  function fillCard(ex, card) {
    const old = card.querySelector(".card-body");
    if (old) old.remove();
    const isOpen = open.has(ex.id) && !managing;
    card.classList.toggle("open", isOpen);
    const head = card.querySelector(".card-head");
    if (managing) {
      head.removeAttribute("aria-expanded");
      head.setAttribute("aria-pressed", String(!hidden.has(ex.id)));
    } else {
      head.removeAttribute("aria-pressed");
      head.setAttribute("aria-expanded", String(isOpen));
    }
    if (isOpen) card.appendChild(buildBody(ex, card));
    updateHead(ex);
  }

  const rebuild = (ex) => fillCard(ex, cards.get(ex.id));

  // ---------- Übungen ausblenden ----------
  // Gespeichert wird jedes Mal die ganze Liste. Die Aufrufe laufen nacheinander, so gewinnt bei schnellem
  // Antippen immer der letzte Stand.
  let hiddenQueue = Promise.resolve();

  function setHidden(id, on) {
    if (on) hidden.add(id); else hidden.delete(id);
    const list = [...hidden];
    hiddenQueue = hiddenQueue
      .then(() => store.setHidden(list))
      .catch((err) => banner("Ausblenden nicht gespeichert: " + errText(err), "alarm"));
    renderHideBar();
  }

  function renderHideBar() {
    const n = exercises.filter((x) => hidden.has(x.id)).length;
    $("#hide-text").textContent = managing
      ? "Übung antippen blendet sie aus oder wieder ein."
      : n ? `${n} ${n === 1 ? "Übung" : "Übungen"} ausgeblendet` : "Nicht genutzte Übungen lassen sich ausblenden.";
    const btn = $("#hide-manage");
    btn.textContent = managing ? "Fertig" : "Auswahl bearbeiten";
    btn.classList.toggle("play", managing);
    $("#ex-list").classList.toggle("managing", managing);
  }

  async function removeExercise(ex, card) {
    if (!confirm(`„${ex.name}“ entfernen?`)) return;
    try {
      await store.removeExercise(ex.id);
      exercises = exercises.filter((x) => x.id !== ex.id);
      open.delete(ex.id);
      renderList();
    } catch (err) {
      setState(card, err.message, "err");
    }
  }

  // ---------- Zeichnen ----------

  function renderChips() {
    const counts = {};
    Object.keys(dayData(sel).entries).forEach((id) => {
      const ex = exercises.find((x) => x.id === id);
      if (ex) counts[ex.group] = (counts[ex.group] || 0) + 1;
    });
    const chip = (id, name, color) => {
      const b = make("button", "chip" + (id === "all" ? " all" : ""), name);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(filter === id));
      if (color) b.style.setProperty("--g", color);
      const n = id === "all" ? Object.keys(dayData(sel).entries).length : counts[id];
      if (n) b.appendChild(make("em", null, String(n)));
      b.addEventListener("click", () => {
        filter = id;
        try { localStorage.setItem("training-filter", id); } catch (e) { /* egal */ }
        renderChips();
        renderList();
      });
      return b;
    };
    const box = $("#chips");
    box.replaceChildren(chip("all", "Alle"), ...groups.map((g) => chip(g.id, g.name, g.color)));
    // Am Handy laufen die Knöpfe seitlich weiter: den gewählten sichtbar machen (nur waagerecht, die Seite springt nicht)
    const on = box.querySelector('[aria-selected="true"]');
    if (on && (on.offsetLeft + on.offsetWidth > box.scrollLeft + box.clientWidth || on.offsetLeft < box.scrollLeft)) {
      box.scrollLeft = on.offsetLeft - 8;
    }
  }

  function renderList() {
    const q = search.toLowerCase();
    const inFilter = exercises.filter((x) => (q ? x.name.toLowerCase().includes(q) : filter === "all" || x.group === filter));
    // Ausgeblendete zeigen: beim Bearbeiten der Auswahl, bei der Suche (zum Wiederfinden) und wenn am Tag etwas eingetragen ist
    const shown = inFilter.filter((x) => managing || q || !hidden.has(x.id) || entryOf(sel, x.id));
    renderHideBar();
    const box = $("#ex-list");
    box.replaceChildren();
    cards.clear();
    groups.forEach((g) => {
      const list = shown.filter((x) => x.group === g.id);
      if (!list.length) return;
      const h = make("div", "group-head", g.name);
      h.style.setProperty("--g", g.color);
      box.appendChild(h);
      list.forEach((ex) => box.appendChild(buildCard(ex)));
    });
    if (!shown.length) {
      box.appendChild(make("p", "empty", inFilter.length
        ? "Alle Übungen hier sind ausgeblendet. Über „Auswahl bearbeiten“ holst du sie zurück."
        : "Keine Übung gefunden. Unten lässt sich eine eigene anlegen."));
    }
  }

  /** Besuche: diese Woche, dieser Monat, Wochen am Stück (die laufende Woche zählt mit, sobald sie einen Besuch hat). */
  function visitStats() {
    const today = todayIso();
    const visits = Object.keys(days).filter(visited);
    const monday = mondayOf(today);
    const weeks = new Set(visits.map(mondayOf));
    let w = weeks.has(monday) ? monday : monday - 7;
    let streak = 0;
    while (weeks.has(w)) { streak++; w -= 7; }
    return {
      monday, streak,
      week: visits.filter((v) => dayNum(v) >= monday && v <= today).length,
      month: visits.filter((v) => v.slice(0, 7) === today.slice(0, 7)).length,
    };
  }

  function renderDay() {
    const today = todayIso();
    const label = sel === today ? "Heute" : sel === fromDayNum(dayNum(today) - 1) ? "Gestern" : weekday(sel);
    $("#day-name").textContent = `${label}, ${short(sel)}${sel.slice(0, 4) === today.slice(0, 4) ? "" : sel.slice(0, 4)}`;
    $("#day-next").disabled = sel >= today;

    const d = dayData(sel);
    const n = Object.keys(d.entries).length;
    const on = visited(sel);
    const btn = $("#visit");
    btn.setAttribute("aria-pressed", String(on));
    $("#visit-title").textContent = sel === today ? (on ? "Heute im Gym ✓" : "Heute im Gym") : (on ? `Im Gym am ${short(sel)} ✓` : `Im Gym am ${short(sel)}?`);
    $("#visit-sub").textContent = n ? `${n} ${n === 1 ? "Übung" : "Übungen"} eingetragen` : on ? "Gespeichert. Nochmal antippen nimmt es zurück." : "Antippen, wenn du da bist";

    const stats = visitStats();
    $("#s-week").textContent = stats.week;
    $("#s-month").textContent = stats.month;
    $("#s-streak").textContent = stats.streak;

    const ul = $("#done-list");
    const done = exercises.filter((x) => d.entries[x.id]);
    ul.replaceChildren(...done.map((ex) => {
      const li = make("li");
      li.style.setProperty("--g", groupById[ex.group].color);
      li.append(make("b", null, ex.name), make("span", null, summary(ex, d.entries[ex.id])));
      li.addEventListener("click", () => {
        search = "";
        $("#search").value = "";
        filter = ex.group;
        managing = false;
        open.add(ex.id);
        renderChips();
        renderList();
        cards.get(ex.id).scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return li;
    }));
    $("#done-empty").hidden = done.length > 0;
  }

  function renderCalendar() {
    $("#cal-name").textContent = `${MONTHS[calMonth]} ${calYear}`;
    const cal = $("#cal");
    cal.replaceChildren(...["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((t) => make("span", "wd", t)));
    const first = `${calYear}-${pad(calMonth + 1)}-01`;
    const offset = (new Date(dayNum(first) * 86400000).getUTCDay() + 6) % 7;
    for (let i = 0; i < offset; i++) cal.appendChild(make("span"));
    const count = new Date(Date.UTC(calYear, calMonth + 1, 0)).getUTCDate();
    const today = todayIso();
    let monthVisits = 0;
    for (let n = 1; n <= count; n++) {
      const d = `${calYear}-${pad(calMonth + 1)}-${pad(n)}`;
      const b = make("button", null, String(n));
      b.type = "button";
      if (visited(d)) { b.classList.add("visited"); monthVisits++; }
      if (d === today) b.classList.add("today");
      if (d === sel) b.classList.add("sel");
      if (d > today) { b.classList.add("future"); b.disabled = true; }
      const trained = days[d] ? groups.filter((g) => exercises.some((x) => x.group === g.id && days[d].entries[x.id])) : [];
      if (trained.length) {
        const dots = make("span", "dots");
        trained.forEach((g) => { const i = make("i"); i.style.setProperty("--g", g.color); dots.appendChild(i); });
        b.appendChild(dots);
      }
      b.setAttribute("aria-label", `${n}. ${MONTHS[calMonth]}${visited(d) ? ", im Gym" : ""}`);
      b.addEventListener("click", () => { selectDay(d); $(".day").scrollIntoView({ behavior: "smooth", block: "start" }); });
      cal.appendChild(b);
    }
    $("#cal-next").disabled = `${calYear}-${pad(calMonth + 1)}` >= today.slice(0, 7);
    const legend = $("#legend");
    legend.replaceChildren(make("span", null, `${monthVisits} ${monthVisits === 1 ? "Besuch" : "Besuche"} im ${MONTHS[calMonth]}`),
      ...groups.map((g) => { const s = make("span"); const i = make("i"); i.style.setProperty("--g", g.color); s.append(i, g.name); return s; }));
  }

  // ---------- Daten sichern ----------
  // Im Browser gespeichert (GitHub Pages) ist eine Datei die einzige Sicherung: Erinnerung, wenn es Einträge gibt,
  // die seit mehr als einer Woche nicht gesichert wurden. Auf dem Pi sichert der Server täglich selbst.
  const BACKUP_DAYS = 7;
  const ago = (iso) => {
    const n = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
    return n <= 0 ? "heute" : n === 1 ? "gestern" : `vor ${n} Tagen`;
  };

  function backupDue() {
    if (!LOCAL) return false;
    const m = localStore.meta();
    if (!m.dayCount || !m.changed || (m.exported && m.changed <= m.exported)) return false; // nichts Ungesichertes
    return Date.now() - Date.parse(m.exported || m.since || m.changed) > BACKUP_DAYS * 86400000;
  }

  function renderData() {
    const info = $("#data-info");
    if (!LOCAL) {
      info.textContent = "Deine Einträge liegen auf dem Pi, der jeden Tag selbst eine Sicherung anlegt. Zusätzlich kannst du alles als Datei herunterladen.";
      return;
    }
    const m = localStore.meta();
    info.textContent = "Deine Einträge liegen nur in diesem Browser auf diesem Gerät. Sichere sie regelmäßig als Datei "
      + "(z.B. in deine Cloud oder per Mail an dich). Browserdaten löschen oder das Handy wechseln löscht sonst alles. "
      + (m.exported ? `Letzte Sicherung: ${ago(m.exported)}.` : m.dayCount ? "Noch nie gesichert." : "");
    $(".data").classList.toggle("due", backupDue());
  }

  function exportFile() {
    if (timers.size) { $("#data-note").textContent = "Moment, es wird noch gespeichert. Gleich nochmal tippen."; return; }
    const file = {
      app: "trainingslog",
      version: 1,
      exported: new Date().toISOString(),
      custom: exercises.filter((x) => x.custom).map(({ id, name, group }) => ({ id, name, group })),
      hidden: [...hidden],
      group,
      days,
    };
    const blob = new Blob([JSON.stringify(file, null, 1)], { type: "application/json" });
    const a = make("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trainingslog-${todayIso()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    if (LOCAL) localStore.markExported();
    $("#data-note").textContent = `Gespeichert als ${a.download} (${Object.keys(days).length} Tage).`;
    renderSide();
  }

  async function importFile(input) {
    const f = input.files && input.files[0];
    input.value = "";
    if (!f) return;
    const note = $("#data-note");
    if (timers.size) { note.textContent = "Moment, es wird noch gespeichert. Gleich nochmal versuchen."; return; }
    try {
      if (f.size > 5 * 1024 * 1024) throw new Error("Datei ist zu groß für eine Trainings-Sicherung");
      const { data, skipped } = localStore.check(JSON.parse(await f.text()));
      const count = Object.keys(data.days).length;
      const current = Object.keys(days).length;
      const text = `${f.name}: ${count} Tage${data.custom.length ? `, ${data.custom.length} eigene Übungen` : ""}`
        + `${skipped ? ` (${skipped} ungültige Einträge werden übersprungen)` : ""}.\n\n`
        + (current ? `Das ersetzt die ${current} Tage, die gerade in diesem Browser sind. Vorher wird der jetzige Stand automatisch als Datei gesichert.\n\n` : "")
        + "Laden?";
      if (!confirm(text)) { note.textContent = "Nicht geladen."; return; }
      if (current) exportFile(); // Sicherheitskopie des jetzigen Stands
      localStore.replace(data);
      drafts.clear();
      await load();
      note.textContent = `Geladen: ${count} Tage.`;
    } catch (err) {
      note.textContent = "Nicht geladen: " + (err instanceof SyntaxError ? "keine gültige Sicherungsdatei" : err.message);
    }
  }

  // ---------- Rangliste ----------
  // Punkte und Besuchszahlen rechnet jedes Gerät selbst aus seinen Einträgen; zu Supabase gehen nur diese Zahlen und
  // der Name, nie Übungen oder Gewichte (supabase.sql). Der Publishable Key ist öffentlich, die Datenbank lässt damit
  // nur die Funktionen rl_* zu. Der Gruppen-Code zeigt die Rangliste, ändern kann man nur die eigene Zeile.
  const SUPA_URL = "https://wluqvllrnrcuiykquevi.supabase.co";
  const SUPA_KEY = "sb_publishable_V-r7ggXqjjDBbTXpgzAIeg_qL6IyAue";
  const POINTS = { visit: 10, set: 1, setsPerDay: 30, cardio: 5, record: 5 };
  const RANKS = [["Bronze", 0, "#cd7f32"], ["Silber", 200, "#c8d2dc"], ["Gold", 600, "#ffd84a"], ["Platin", 1500, "#7fe5d8"], ["Diamant", 3000, "#9ec9ff"]];
  const SORTS = [["points", "Punkte"], ["week", "Woche"], ["month", "Monat"], ["streak", "Serie"]];
  let board = null;
  let boardError = "";
  let sortBy = "points";
  let lastPush = "";
  let pushTimer = null;

  async function rpc(fn, args) {
    let res;
    try {
      res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
        method: "POST", headers: { apikey: SUPA_KEY, "Content-Type": "application/json" }, body: JSON.stringify(args),
      });
    } catch (err) {
      throw new Error("Rangliste gerade nicht erreichbar");
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(res.status < 500 && body && body.message ? body.message : "Rangliste gerade nicht erreichbar");
    return body;
  }

  /** Alle Punkte aus den Einträgen. Bestwert = mehr kg, bei gleichem Gewicht mehr Wiederholungen; der erste Eintrag zählt nicht. */
  function computePoints() {
    const best = {};
    let points = 0;
    Object.keys(days).sort().forEach((date) => {
      if (visited(date)) points += POINTS.visit;
      let sets = 0;
      Object.entries(days[date].entries).forEach(([id, e]) => {
        if (e.cardio) { points += POINTS.cardio; return; }
        const done = e.sets.filter((s) => s.reps > 0);
        sets += done.length;
        if (!done.length) return;
        const better = (a, b) => a.kg > b.kg || (a.kg === b.kg && a.reps > b.reps);
        const top = done.reduce((a, s) => (better(s, a) ? s : a));
        if (best[id] && better(top, best[id])) points += POINTS.record;
        if (!best[id] || better(top, best[id])) best[id] = top;
      });
      points += Math.min(sets, POINTS.setsPerDay) * POINTS.set;
    });
    return points;
  }

  const rankOf = (points) => [...RANKS].reverse().find((r) => points >= r[1]);

  function schedulePush() {
    if (!group) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushStats, 2500);
  }

  async function pushStats() {
    if (!group) return;
    const s = visitStats();
    const args = {
      p_member_id: group.member_id, p_secret: group.secret, p_points: computePoints(), p_visits_week: Math.min(s.week, 7),
      p_visits_month: Math.min(s.month, 31), p_streak_weeks: s.streak, p_week_start: fromDayNum(s.monday), p_month_key: todayIso().slice(0, 7),
    };
    const sig = JSON.stringify(args);
    try {
      if (sig !== lastPush) { await rpc("rl_push", args); lastPush = sig; }
      await loadBoard();
    } catch (err) {
      boardError = err.message;
      renderRank();
    }
  }

  async function loadBoard() {
    if (!group) return;
    try {
      board = await rpc("rl_board", { p_code: group.code });
      boardError = board ? "" : "Diese Gruppe gibt es nicht mehr";
    } catch (err) {
      boardError = err.message;
    }
    renderRank();
  }

  function boardValue(m, by) {
    const s = visitStats();
    if (by === "week") return m.week_start === fromDayNum(s.monday) ? m.visits_week : 0; // alte Woche zählt nicht mehr
    if (by === "month") return m.month_key === todayIso().slice(0, 7) ? m.visits_month : 0;
    return by === "streak" ? m.streak_weeks : m.points;
  }

  function renderRank() {
    const points = computePoints();
    const rank = rankOf(points);
    const next = RANKS[RANKS.indexOf(rank) + 1];
    const name = $("#rk-name");
    name.textContent = rank[0];
    name.style.color = rank[2];
    $("#rk-points").textContent = `${points} Punkte`;
    const fill = $("#rk-fill");
    fill.style.background = rank[2];
    fill.style.width = next ? `${Math.round(((points - rank[1]) / (next[1] - rank[1])) * 100)}%` : "100%";
    $("#rk-next").textContent = next ? `Noch ${next[1] - points} Punkte bis ${next[0]}` : "Höchster Rang erreicht";

    $("#rk-join").hidden = Boolean(group);
    $("#rk-board").hidden = !group;
    if (!group) return;
    $("#rk-gname").textContent = group.group_name;
    $("#rk-copy").textContent = `Code ${group.code}`;
    $("#rk-state").textContent = boardError;
    $("#rk-sort").replaceChildren(...SORTS.map(([id, label]) => {
      const b = make("button", "chip all", label);
      b.type = "button";
      b.setAttribute("aria-selected", String(sortBy === id));
      b.addEventListener("click", () => { sortBy = id; renderRank(); });
      return b;
    }));
    const members = board ? [...board.members] : [];
    members.sort((a, b) => boardValue(b, sortBy) - boardValue(a, sortBy) || b.points - a.points);
    const unit = { points: "P", week: "×", month: "×", streak: "Wo." }[sortBy];
    $("#rk-list").replaceChildren(...members.map((m, i) => {
      const li = make("li", m.id === group.member_id ? "me" : "");
      const r = rankOf(m.points);
      li.append(make("span", "pos", String(i + 1)));
      const who = make("span", "who", m.name);
      const badge = make("small", null, r[0]);
      badge.style.color = r[2];
      who.appendChild(badge);
      li.append(who, make("b", null, `${boardValue(m, sortBy)} ${unit}`));
      return li;
    }));
  }

  async function saveGroup(g) {
    await store.setGroup(g);
    group = g;
    board = null;
    boardError = "";
    lastPush = "";
    renderRank();
    if (g) await pushStats();
  }

  async function joinOrCreate(create) {
    const note = $("#rk-note");
    const member = $("#rk-member").value.trim();
    const value = (create ? $("#rk-group") : $("#rk-code")).value.trim();
    if (!member || !value) { note.textContent = create ? "Dein Name und ein Gruppenname fehlen." : "Dein Name und der Gruppen-Code fehlen."; return; }
    note.textContent = "Moment …";
    try {
      const res = create ? await rpc("rl_create_group", { p_group_name: value, p_member_name: member })
        : await rpc("rl_join_group", { p_code: value, p_member_name: member });
      await saveGroup({ code: res.code, member_id: res.member_id, secret: res.secret, name: res.name, group_name: res.group_name });
      note.textContent = "";
    } catch (err) {
      note.textContent = err.message;
    }
  }

  function renderBanner() {
    if (!loaded) return;
    $("#banner").style.cursor = backupDue() ? "pointer" : "";
    if (backupDue()) { banner("Bitte Daten als Datei sichern ›", "warn"); return; }
    const d = dayData(sel);
    const ids = Object.keys(d.entries);
    const sets = ids.reduce((s, id) => s + (d.entries[id].sets ? d.entries[id].sets.filter((x) => x.reps || x.kg).length : 0), 0);
    const label = sel === todayIso() ? "Heute" : short(sel);
    if (ids.length) banner(`${label}: ${ids.length} ${ids.length === 1 ? "Übung" : "Übungen"}${sets ? ` · ${sets} ${sets === 1 ? "Satz" : "Sätze"}` : ""}`, "ok");
    else banner(visited(sel) ? `${label}: im Gym` : `${label}: noch nicht im Gym`, visited(sel) ? "ok" : "wait");
  }

  function renderSide() {
    renderDay();
    renderChips();
    renderCalendar();
    renderData();
    renderRank();
    renderBanner();
  }

  function renderAll() {
    renderSide();
    renderList();
  }

  function selectDay(d) {
    sel = d;
    calYear = Number(d.slice(0, 4));
    calMonth = Number(d.slice(5, 7)) - 1;
    renderAll();
  }

  // ---------- Bedienung ----------

  $("#visit").addEventListener("click", async () => {
    const d = dayData(sel);
    if (Object.keys(d.entries).length) { banner("Tag hat Einträge: zählt als Besuch", "ok"); return; }
    const btn = $("#visit");
    btn.disabled = true;
    try {
      const res = await store.visit(sel, !d.visit);
      if (res.day) days[sel] = res.day; else delete days[sel];
      renderSide();
      schedulePush();
    } catch (err) {
      banner(errText(err), "alarm");
    } finally {
      btn.disabled = false;
    }
  });

  $("#day-prev").addEventListener("click", () => selectDay(fromDayNum(dayNum(sel) - 1)));
  $("#day-next").addEventListener("click", () => { if (sel < todayIso()) selectDay(fromDayNum(dayNum(sel) + 1)); });
  $("#day-today").addEventListener("click", () => selectDay(todayIso()));
  const shiftCal = (n) => { const k = calYear * 12 + calMonth + n; calYear = Math.floor(k / 12); calMonth = k % 12; renderCalendar(); };
  $("#cal-prev").addEventListener("click", () => shiftCal(-1));
  $("#cal-next").addEventListener("click", () => shiftCal(1));
  $("#search").addEventListener("input", () => { search = $("#search").value.trim(); renderList(); });
  $("#hide-manage").addEventListener("click", () => {
    managing = !managing;
    renderList();
    if (!managing) $("#hide-manage").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  let addGroup = "oberkoerper";
  function renderAddGroups() {
    $("#add-groups").replaceChildren(...groups.map((g) => {
      const b = make("button", "chip", g.name);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(g.id === addGroup));
      b.style.setProperty("--g", g.color);
      b.addEventListener("click", () => { addGroup = g.id; renderAddGroups(); });
      return b;
    }));
  }
  $("#add-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("#add-name").value.trim();
    try {
      const ex = await store.addExercise(name, addGroup);
      exercises.push(ex);
      $("#add-name").value = "";
      $("#add-note").textContent = `„${ex.name}“ angelegt`;
      search = "";
      $("#search").value = "";
      filter = ex.group;
      open.add(ex.id);
      renderChips();
      renderList();
      cards.get(ex.id).scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      $("#add-note").textContent = err.message;
    }
  });

  async function load() {
    try {
      const res = await store.all();
      groups = res.groups;
      groupById = Object.fromEntries(groups.map((g) => [g.id, g]));
      exercises = res.exercises;
      days = res.days;
      hidden = new Set(res.hidden || []);
      group = res.group || null;
      if (filter !== "all" && !groupById[filter]) filter = "all";
      loaded = true;
      renderAddGroups();
      renderAll();
      pushStats();
    } catch (err) {
      banner(LOCAL ? errText(err) : "Pi nicht erreichbar", "alarm");
    }
  }

  $("#rk-join-btn").addEventListener("click", () => joinOrCreate(false));
  $("#rk-create-btn").addEventListener("click", () => joinOrCreate(true));
  $("#rk-form").addEventListener("submit", (e) => { e.preventDefault(); joinOrCreate(!$("#rk-code").value.trim()); });
  $("#rk-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(group.code); $("#rk-state").textContent = "Code kopiert"; } catch (err) { $("#rk-state").textContent = `Code: ${group.code}`; }
  });
  $("#rk-leave").addEventListener("click", async () => {
    if (!confirm(`„${group.group_name}“ verlassen? Du verschwindest aus der Rangliste, deine Trainingsdaten bleiben.`)) return;
    try {
      await rpc("rl_leave", { p_member_id: group.member_id, p_secret: group.secret });
      await saveGroup(null);
    } catch (err) {
      $("#rk-state").textContent = err.message;
    }
  });

  $("#export").addEventListener("click", exportFile);
  // Am Handy steht "Daten sichern" ganz unten: die Erinnerung oben führt per Tippen dorthin
  $("#banner").addEventListener("click", () => { if (backupDue()) $(".data").scrollIntoView({ behavior: "smooth", block: "center" }); });
  if (LOCAL) {
    $("#import-btn").hidden = false;
    $("#import-btn").addEventListener("click", () => $("#import").click());
    $("#import").addEventListener("change", (e) => importFile(e.target));
  }

  // Zurück in den Tab: neu laden (Eingaben vom anderen Gerät), aber nie mitten im Tippen oder vor dem Speichern.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !timers.size && !document.activeElement.matches("input")) {
      if (sel !== todayIso() && !visited(sel)) sel = todayIso(); // neuer Tag seit dem letzten Öffnen
      drafts.clear();
      load();
    }
  });

  load();
})();
