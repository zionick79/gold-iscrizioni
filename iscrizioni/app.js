// Area soci GOLD: iscrizioni agli eventi, profilo, famiglia, gestione soci e quote sociali.
// Tutte le regole di accesso sono nel database (RLS, vedi supabase/schema.sql): qui c'è solo l'interfaccia.

const SUPABASE_URL = "https://gwjhvfnfmlyiidqnuivs.supabase.co";
const SUPABASE_KEY = "sb_publishable_5bXqfp3JD_soWMnz7zuwow__T_15mpC";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const TZ = "Europe/Zurich";
const DEFAULT_CATEGORIES = ["Adulto", "Giovane", "Famiglia", "Sostenitore"];
const METHODS = ["Bonifico", "Contanti", "TWINT", "Altro"];

// ─── Utilità ───
const $app = document.getElementById("app");
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = (d, o) => new Intl.DateTimeFormat("it-CH", {timeZone: TZ, ...o}).format(new Date(d));
const fmtFull = d => fmt(d, {weekday:"long", day:"numeric", month:"long", hour:"2-digit", minute:"2-digit"});
const fmtDate = d => d ? new Intl.DateTimeFormat("it-CH", {day:"2-digit", month:"2-digit", year:"numeric"}).format(new Date(d + "T12:00:00")) : "";
const chf = n => "CHF " + new Intl.NumberFormat("it-CH", {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(Number(n || 0));
const today = () => new Date().toLocaleDateString("sv-SE", {timeZone: TZ});
const thisYear = () => Number(today().slice(0, 4));
const val = id => $(id).value.trim();
const orNull = v => v === "" ? null : v;
const deadline = ev => new Date(new Date(ev.starts_at).getTime() - ev.cutoff_hours * 3600e3);
const isOpen = ev => ev.published && Date.now() < deadline(ev).getTime();
function toast(t){const el=$("toast");el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,2800)}
function errText(e){
  const m = e?.message || String(e);
  if (/completo/i.test(m)) return "L'evento è al completo.";
  if (/comitato/i.test(m)) return m;
  if (/duplicate key.*email/i.test(m)) return "Esiste già un socio con questa email.";
  if (/duplicate key/i.test(m)) return "Questo elemento esiste già.";
  if (/row-level security|violates/i.test(m)) return "Operazione non consentita (iscrizioni chiuse o permessi insufficienti).";
  if (/rate limit|security purposes/i.test(m)) return "Troppe richieste ravvicinate: attendi un minuto e riprova.";
  if (/expired|invalid/i.test(m)) return "Codice errato o scaduto. Controlla l'ultima email ricevuta o richiedine uno nuovo.";
  return m;
}
const fail = e => { $app.innerHTML = `<div class="msg err">${esc(errText(e))}</div>`; };
// Conferma in due tocchi: il primo cambia il testo del pulsante, il secondo esegue
function confirmTap(b, label = "Conferma") { if (b.dataset.sure === "1") return true; b.dataset.sure = "1"; b.textContent = label; return false; }
function feeStatus(f) {
  if (f.paid_at) return `<span class="pill paid">Pagata ${esc(fmtDate(f.paid_at))}</span>`;
  if (f.due_date && f.due_date < today()) return `<span class="pill late">Scaduta ${esc(fmtDate(f.due_date))}</span>`;
  return `<span class="pill due">Da pagare${f.due_date ? " entro " + esc(fmtDate(f.due_date)) : ""}</span>`;
}
function downloadCsv(name, rows) {
  const cell = v => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(["﻿" + rows.map(r => r.map(cell).join(";")).join("\r\n")], {type: "text/csv;charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function categories() {
  const { data } = await sb.from("fee_types").select("category");
  return [...new Set([...DEFAULT_CATEGORIES, ...(data || []).map(r => r.category)])];
}

const S = { me: null, tab: "eventi" };

// ─── Accesso con codice via email ───
function renderLogin(step = 1, email = "", note = "") {
  $("who").hidden = true; $("tabs").hidden = true;
  $app.innerHTML = `
  <div class="hero"><h1>Area soci GOLD</h1>
  <p class="muted">Iscrizioni ad allenamenti, gare e trasferte. Entri con la tua email: ricevi un codice, niente password.</p></div>
  <div class="card stack">
    ${note ? `<div class="msg ${note.startsWith("!") ? "err" : "ok"}">${esc(note.replace(/^!/, ""))}</div>` : ""}
    ${step === 1 ? `
      <form id="f1" class="stack">
        <label for="email">La tua email di socio
          <input id="email" type="email" required autocomplete="email" inputmode="email" value="${esc(email)}" placeholder="nome@esempio.ch"></label>
        <button class="btn" type="submit">Ricevi il codice</button>
      </form>
      <!-- TEMPORANEO: accesso con password per i test, da togliere quando l'invio email (SMTP) è configurato -->
      <details><summary>Accesso di prova con password</summary>
        <form id="fpw" class="stack" style="padding-top:10px">
          <label for="pwemail">Email<input id="pwemail" type="email" required autocomplete="username" value="${esc(email)}"></label>
          <label for="pw">Password di prova<input id="pw" type="password" required autocomplete="current-password"></label>
          <button class="btn ghost" type="submit">Entra con password</button>
        </form>
      </details>` : `
      <form id="f2" class="stack">
        <p class="small">Abbiamo inviato un codice a <b>${esc(email)}</b>. Controlla anche lo spam.</p>
        <label for="otp">Codice ricevuto
          <input id="otp" class="code" required inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="••••••"></label>
        <button class="btn" type="submit">Entra</button>
        <button class="btn ghost" type="button" id="back">Usa un'altra email</button>
      </form>`}
  </div>`;
  if (step === 1) {
    $("f1").onsubmit = async e => {
      e.preventDefault(); e.submitter.disabled = true;
      const em = val("email").toLowerCase();
      try {
        const { data: ok, error } = await sb.rpc("is_member_email", { p_email: em });
        if (error) throw error;
        if (!ok) return renderLogin(1, em, "!Questa email non è nell'elenco soci. Chiedi al comitato del GOLD di aggiungerla.");
        const { error: e2 } = await sb.auth.signInWithOtp({ email: em, options: { shouldCreateUser: true, emailRedirectTo: location.origin + "/iscrizioni/" } });
        if (e2) throw e2;
        renderLogin(2, em);
      } catch (x) { renderLogin(1, em, "!" + errText(x)); }
    };
    $("fpw").onsubmit = async e => {
      e.preventDefault(); e.submitter.disabled = true;
      const em = val("pwemail").toLowerCase();
      const { error } = await sb.auth.signInWithPassword({ email: em, password: $("pw").value });
      if (error) return renderLogin(1, em, "!Email o password di prova non corretti.");
    };
  } else {
    $("otp").focus();
    $("back").onclick = () => renderLogin(1, email);
    $("f2").onsubmit = async e => {
      e.preventDefault(); e.submitter.disabled = true;
      const { error } = await sb.auth.verifyOtp({ email, token: $("otp").value.replace(/\D/g, ""), type: "email" });
      if (error) return renderLogin(2, email, "!" + errText(error));
      // onAuthStateChange (SIGNED_IN) avvia l'app
    };
  }
}

// ─── Avvio e schede ───
const TABS = { eventi: ["Eventi", () => viewEvents()], famiglia: ["Famiglia", () => viewFamily()], profilo: ["Profilo e quote", () => viewProfile()],
  gestione: ["Gestione eventi", () => viewAdminEvents()], soci: ["Soci", () => viewMembers()], quote: ["Quote sociali", () => viewFees()] };
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderLogin();
  const email = session.user.email.toLowerCase();
  const { data: me, error } = await sb.from("members").select("*").eq("email", email).maybeSingle();
  if (error || !me || !me.active) {
    await sb.auth.signOut();
    return renderLogin(1, email, "!Il tuo accesso non è attivo. Contatta il comitato del GOLD.");
  }
  S.me = me;
  $("who").hidden = false;
  $("who").innerHTML = `${esc(me.full_name)}<br><button id="logout">Esci</button>`;
  $("logout").onclick = async () => { await sb.auth.signOut(); S.me = null; renderLogin(); };
  const keys = ["eventi", "famiglia", "profilo", ...(me.is_admin ? ["gestione", "soci", "quote"] : [])];
  $("tabs").hidden = false;
  $("tabs").innerHTML = keys.map(k => `<button data-t="${k}">${TABS[k][0]}</button>`).join("");
  $("tabs").querySelectorAll("button").forEach(b => b.onclick = () => go(b.dataset.t));
  go(S.tab);
}
function go(tab) {
  S.tab = tab;
  $("tabs").querySelectorAll("button").forEach(x => x.classList.toggle("on", x.dataset.t === tab));
  $app.innerHTML = `<p class="empty">Caricamento…</p>`;
  scrollTo(0, 0);
  TABS[tab][1]();
}

// ─── Eventi (socio) ───
async function viewEvents() {
  const since = new Date(Date.now() - 6 * 3600e3).toISOString();
  const [ev, pa, rg, ct] = await Promise.all([
    sb.from("events").select("*").eq("published", true).gte("starts_at", since).order("starts_at"),
    sb.from("participants").select("*").eq("member_id", S.me.id).order("created_at"),
    sb.from("registrations").select("event_id,participant_id"),
    sb.rpc("event_counts"),
  ]);
  const err = ev.error || pa.error || rg.error || ct.error;
  if (err) return fail(err);
  const counts = Object.fromEntries((ct.data || []).map(r => [r.event_id, Number(r.n)]));
  const mine = new Set(rg.data.map(r => r.event_id + "|" + r.participant_id));
  if (!ev.data.length) { $app.innerHTML = `<div class="card empty">Nessun evento in programma per ora.<br>Torna a controllare più avanti.</div>`; return; }
  $app.innerHTML = `<div class="stack">${ev.data.map(e => {
    const open = isOpen(e), n = counts[e.id] || 0, full = e.capacity && n >= e.capacity;
    const status = !open ? `<span class="pill closed">Iscrizioni chiuse</span>`
      : full ? `<span class="pill full">Al completo</span>`
      : `<span class="pill open">Aperte fino a ${esc(fmt(deadline(e), {weekday:"short", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"}))}</span>`;
    return `<article class="card ev">
      <div class="top">
        <div class="date"><b>${fmt(e.starts_at,{day:"numeric"})}</b><small>${fmt(e.starts_at,{month:"short"})}</small></div>
        <div style="min-width:0">
          <h3>${esc(e.title)}</h3>
          <div class="meta">${esc(fmtFull(e.starts_at))}${e.location ? " · " + esc(e.location) : ""}</div>
          <div class="meta btns" style="margin-top:6px">${status}<span>${n}${e.capacity ? " / " + e.capacity : ""} iscritti</span></div>
        </div>
      </div>
      ${e.description ? `<p class="small" style="white-space:pre-line">${esc(e.description)}</p>` : ""}
      <div class="people">${pa.data.map(p => {
        const on = mine.has(e.id + "|" + p.id);
        return `<div class="person"><span>${esc(p.full_name)}</span><div>
          ${on ? `<span class="yes">✓ Iscritto</span>` : ""}
          <button class="btn sm ${on ? "ghost" : "gold"}" data-ev="${e.id}" data-p="${p.id}" data-on="${on?1:0}" ${!open || (!on && full) ? "disabled" : ""}>${on ? "Annulla" : "Iscrivi"}</button>
        </div></div>`;}).join("")}
      </div>
    </article>`;}).join("")}</div>`;
  $app.querySelectorAll("button[data-ev]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    const { ev: event_id, p: participant_id } = b.dataset;
    const { error } = b.dataset.on === "1"
      ? await sb.from("registrations").delete().eq("event_id", event_id).eq("participant_id", participant_id)
      : await sb.from("registrations").insert({ event_id, participant_id });
    if (error) { toast(errText(error)); b.disabled = false; return; }
    toast(b.dataset.on === "1" ? "Iscrizione annullata" : "Iscrizione registrata");
    viewEvents();
  });
}

// ─── Famiglia (riusata anche nella scheda socio dell'amministratore) ───
function familyHtml(list, canRemoveFirst = false) {
  return `<div class="list">${list.map((p, i) => `<div class="li" data-pid="${p.id}">
      <div class="grow"><span class="name">${esc(p.full_name)}</span>
        <span class="small muted">${[p.birth_year, p.si_card ? "chip SI " + p.si_card : ""].filter(Boolean).map(esc).join(" · ")}</span></div>
      <button class="btn sm ghost" data-pedit>Modifica</button>
      ${i > 0 || canRemoveFirst ? `<button class="btn sm danger" data-pdel>Rimuovi</button>` : ""}
    </div>`).join("")}</div>
    <form class="stack" data-padd style="margin-top:12px">
      <div class="row3"><label>Nome e cognome<input name="full_name" required></label>
      <label>Anno di nascita<input name="birth_year" type="number" min="1900" max="2100" inputmode="numeric"></label>
      <label>Numero chip SI<input name="si_card" inputmode="numeric"></label></div>
      <div><button class="btn sm" type="submit">Aggiungi persona</button></div>
    </form>`;
}
function bindFamily(box, memberId, list, reload) {
  const read = f => ({ full_name: f.full_name.value.trim(), birth_year: f.birth_year.value ? Number(f.birth_year.value) : null, si_card: orNull(f.si_card.value.trim()) });
  box.querySelector("[data-padd]").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.from("participants").insert({ member_id: memberId, ...read(e.target) });
    if (error) return toast(errText(error)); toast("Persona aggiunta"); reload();
  };
  box.querySelectorAll("[data-pedit]").forEach(b => b.onclick = () => {
    const li = b.closest(".li"), p = list.find(x => x.id === li.dataset.pid);
    li.innerHTML = `<form class="stack" style="width:100%"><div class="row3">
      <label>Nome e cognome<input name="full_name" required value="${esc(p.full_name)}"></label>
      <label>Anno di nascita<input name="birth_year" type="number" min="1900" max="2100" value="${p.birth_year ?? ""}"></label>
      <label>Numero chip SI<input name="si_card" value="${esc(p.si_card)}"></label></div>
      <div class="btns"><button class="btn sm" type="submit">Salva</button><button class="btn sm ghost" type="button" data-x>Annulla</button></div></form>`;
    li.querySelector("[data-x]").onclick = reload;
    li.querySelector("form").onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.from("participants").update(read(e.target)).eq("id", p.id);
      if (error) return toast(errText(error)); toast("Salvato"); reload();
    };
  });
  box.querySelectorAll("[data-pdel]").forEach(b => b.onclick = async () => {
    if (!confirmTap(b, "Conferma rimozione")) return;
    const { error } = await sb.from("participants").delete().eq("id", b.closest(".li").dataset.pid);
    if (error) return toast(errText(error)); toast("Persona rimossa"); reload();
  });
}
async function viewFamily() {
  const { data, error } = await sb.from("participants").select("*").eq("member_id", S.me.id).order("created_at");
  if (error) return fail(error);
  $app.innerHTML = `<div class="card stack"><h2>La mia famiglia</h2>
    <p class="small muted">Le persone che puoi iscrivere agli eventi con il tuo account, ad esempio i figli. Il numero del chip SI serve per le gare.</p>
    <div id="fam">${familyHtml(data)}</div></div>`;
  bindFamily($("fam"), S.me.id, data, viewFamily);
}

// ─── Profilo e quote (socio) ───
async function viewProfile() {
  const [me, fees, st] = await Promise.all([
    sb.from("members").select("*").eq("id", S.me.id).single(),
    sb.from("fees").select("*").eq("member_id", S.me.id).order("year", { ascending: false }),
    sb.from("settings").select("value").eq("key", "istruzioni_pagamento").maybeSingle(),
  ]);
  if (me.error || fees.error) return fail(me.error || fees.error);
  const m = me.data, open = fees.data.filter(f => !f.paid_at);
  $app.innerHTML = `<div class="stack">
    <div class="card stack"><h2>Le mie quote</h2>
      ${fees.data.length ? `<div class="list">${fees.data.map(f => `<div class="li">
        <div class="grow"><span class="name">${esc(f.description)}</span><br>${feeStatus(f)}</div>
        <span class="num">${chf(f.amount)}</span></div>`).join("")}</div>` : `<p class="muted small">Nessuna quota registrata.</p>`}
      ${open.length && st.data?.value ? `<div class="msg info small" style="white-space:pre-line"><b>Come pagare</b>\n${esc(st.data.value)}</div>` : ""}
    </div>
    <form class="card stack" id="fp"><h2>I miei dati</h2>
      <p class="small muted">${esc(m.full_name)} · ${esc(m.email)} · <span class="pill cat">${esc(m.category)}</span>${m.member_since ? " · socio dal " + esc(fmtDate(m.member_since)) : ""}<br>
        Per cambiare nome, email o categoria scrivi al comitato.</p>
      <div class="row"><label for="pphone">Telefono<input id="pphone" type="tel" value="${esc(m.phone)}" autocomplete="tel"></label>
        <label for="pbirth">Data di nascita<input id="pbirth" type="date" value="${esc(m.birth_date)}"></label></div>
      <label for="paddr">Indirizzo<input id="paddr" value="${esc(m.address)}" autocomplete="street-address"></label>
      <div class="row"><label for="pzip">NPA<input id="pzip" value="${esc(m.zip)}" inputmode="numeric" autocomplete="postal-code"></label>
        <label for="pcity">Località<input id="pcity" value="${esc(m.city)}" autocomplete="address-level2"></label></div>
      <div><button class="btn" type="submit">Salva i miei dati</button></div>
    </form></div>`;
  $("fp").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.from("members").update({ phone: orNull(val("pphone")), birth_date: orNull(val("pbirth")),
      address: orNull(val("paddr")), zip: orNull(val("pzip")), city: orNull(val("pcity")) }).eq("id", S.me.id);
    if (error) return toast(errText(error)); toast("Dati salvati");
  };
}

// ─── Gestione eventi (admin) ───
const toLocalInput = d => { const x = new Date(d); const p = n => String(n).padStart(2,"0");
  return `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };
async function viewAdminEvents(editId = null) {
  const [ev, ct] = await Promise.all([
    sb.from("events").select("*").order("starts_at", { ascending: false }).limit(100),
    sb.rpc("event_counts"),
  ]);
  if (ev.error) return fail(ev.error);
  const counts = Object.fromEntries((ct.data || []).map(r => [r.event_id, Number(r.n)]));
  const cur = ev.data.find(x => x.id === editId) || {};
  $app.innerHTML = `<div class="stack">
    <form class="card stack" id="fev"><h2>${editId ? "Modifica evento" : "Nuovo evento"}</h2>
      <label for="etitle">Titolo<input id="etitle" required value="${esc(cur.title)}" placeholder="Allenamento in palestra"></label>
      <div class="row">
        <label for="estart">Data e ora<input id="estart" type="datetime-local" required value="${cur.starts_at ? toLocalInput(cur.starts_at) : ""}"></label>
        <label for="eloc">Luogo<input id="eloc" value="${esc(cur.location)}" placeholder="Palestra Liceo Savosa"></label>
      </div>
      <div class="row">
        <label for="ecut">Iscrizioni chiuse quante ore prima<input id="ecut" type="number" min="0" required value="${cur.cutoff_hours ?? 24}" inputmode="numeric"></label>
        <label for="ecap">Posti massimi (vuoto = illimitati)<input id="ecap" type="number" min="1" value="${cur.capacity ?? ""}" inputmode="numeric"></label>
      </div>
      <label for="edesc">Descrizione<textarea id="edesc" placeholder="Materiale: bussola, chip, pila frontale…">${esc(cur.description)}</textarea></label>
      <label class="check" for="epub"><input id="epub" type="checkbox" ${cur.published === false ? "" : "checked"}> Visibile ai soci</label>
      <p class="small muted" id="cutinfo"></p>
      <div class="btns"><button class="btn" type="submit">${editId ? "Salva modifiche" : "Crea evento"}</button>
      ${editId ? `<button class="btn ghost" type="button" id="cancel">Annulla</button>` : ""}</div>
    </form>
    <div class="card"><h2 style="margin-bottom:6px">Eventi</h2>
      <div class="list">${ev.data.length ? ev.data.map(e => `<div class="li" style="display:block">
        <div class="btns">
          <div class="grow"><b>${esc(e.title)}</b>${e.published ? "" : ` <span class="pill closed">nascosto</span>`}<br>
            <span class="small muted">${esc(fmtFull(e.starts_at))} · chiusura ${e.cutoff_hours} h prima · ${counts[e.id]||0}${e.capacity?"/"+e.capacity:""} iscritti</span></div>
          <button class="btn sm ghost" data-edit="${e.id}">Modifica</button>
          <button class="btn sm danger" data-del="${e.id}">Elimina</button>
        </div>
        <details data-reg="${e.id}"><summary>Vedi iscritti</summary><div class="small" style="padding-top:8px">…</div></details>
      </div>`).join("") : `<p class="empty">Ancora nessun evento.</p>`}</div></div></div>`;
  const upd = () => { const v = $("estart").value, h = Number($("ecut").value || 0);
    $("cutinfo").textContent = v ? "Le iscrizioni chiuderanno " + fmtFull(new Date(new Date(v).getTime() - h*3600e3)) + "." : ""; };
  ["estart","ecut"].forEach(id => $(id).oninput = upd); upd();
  if (editId) $("cancel").onclick = () => viewAdminEvents();
  $("fev").onsubmit = async e => {
    e.preventDefault();
    const row = { title: val("etitle"), location: orNull(val("eloc")), starts_at: new Date($("estart").value).toISOString(),
      cutoff_hours: Number($("ecut").value), capacity: $("ecap").value ? Number($("ecap").value) : null,
      description: orNull(val("edesc")), published: $("epub").checked };
    const { error } = editId ? await sb.from("events").update(row).eq("id", editId) : await sb.from("events").insert(row);
    if (error) return toast(errText(error));
    toast(editId ? "Evento aggiornato" : "Evento creato"); viewAdminEvents();
  };
  $app.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { viewAdminEvents(b.dataset.edit); scrollTo(0,0); });
  $app.querySelectorAll("button[data-del]").forEach(b => b.onclick = async () => {
    if (!confirmTap(b, "Conferma eliminazione")) return;
    const { error } = await sb.from("events").delete().eq("id", b.dataset.del);
    if (error) return toast(errText(error)); toast("Evento eliminato"); viewAdminEvents();
  });
  $app.querySelectorAll("details[data-reg]").forEach(d => d.ontoggle = async () => {
    if (!d.open) return;
    const box = d.querySelector("div");
    const { data, error } = await sb.from("registrations").select("created_at, participants(full_name, si_card, members(full_name,email,phone))").eq("event_id", d.dataset.reg).order("created_at");
    if (error) { box.textContent = errText(error); return; }
    if (!data.length) { box.textContent = "Nessun iscritto."; return; }
    const lines = data.map((r,i) => `${i+1}. ${r.participants.full_name}` + (r.participants.members.full_name !== r.participants.full_name ? ` (socio: ${r.participants.members.full_name})` : ""));
    box.innerHTML = `<ol style="padding-left:20px">${data.map(r => `<li>${esc(r.participants.full_name)}${r.participants.si_card ? ` <span class="muted">· chip ${esc(r.participants.si_card)}</span>` : ""} <span class="muted">· ${esc(r.participants.members.email)}</span></li>`).join("")}</ol>
      <div class="btns" style="margin-top:8px"><button class="btn sm ghost" data-copy>Copia elenco</button><button class="btn sm ghost" data-csv>Scarica CSV</button></div>`;
    box.querySelector("[data-copy]").onclick = async () => { try { await navigator.clipboard.writeText(lines.join("\n")); toast("Elenco copiato"); } catch { toast("Copia non riuscita"); } };
    box.querySelector("[data-csv]").onclick = () => downloadCsv("iscritti.csv", [["Nome","Chip SI","Socio","Email","Telefono","Iscritto il"],
      ...data.map(r => [r.participants.full_name, r.participants.si_card, r.participants.members.full_name, r.participants.members.email, r.participants.members.phone, fmt(r.created_at,{dateStyle:"short",timeStyle:"short"})])]);
  });
}

// ─── Soci (admin) ───
const MF = { q: "", stato: "attivi", cat: "", quota: "" };
async function viewMembers() {
  const y = thisYear();
  const [ms, fs, cats] = await Promise.all([
    sb.from("members").select("*").order("full_name"),
    sb.from("fees").select("member_id, paid_at").eq("year", y),
    categories(),
  ]);
  if (ms.error) return fail(ms.error);
  const feeBy = {};
  (fs.data || []).forEach(f => { const s = feeBy[f.member_id] ||= { n: 0, open: 0 }; s.n++; if (!f.paid_at) s.open++; });
  const quotaOf = m => { const s = feeBy[m.id]; return !s ? "nessuna" : s.open ? "da pagare" : "pagata"; };
  const all = ms.data;
  $app.innerHTML = `<div class="stack">
    <div class="tiles">
      <div class="tile"><b>${all.filter(m => m.active).length}</b><span>soci attivi</span></div>
      <div class="tile good"><b>${all.filter(m => m.active && quotaOf(m) === "pagata").length}</b><span>quota ${y} pagata</span></div>
      <div class="tile bad"><b>${all.filter(m => m.active && quotaOf(m) === "da pagare").length}</b><span>quota ${y} da pagare</span></div>
      <div class="tile"><b>${all.filter(m => m.active && quotaOf(m) === "nessuna").length}</b><span>senza quota ${y}</span></div>
    </div>
    <div class="card stack">
      <div class="btns"><h2 class="grow">Soci</h2>
        <button class="btn sm" id="mnew">Nuovo socio</button>
        <button class="btn sm ghost" id="mimp">Importa elenco</button>
        <button class="btn sm ghost" id="mcsv">Esporta CSV</button></div>
      <div class="toolbar">
        <input id="mq" type="search" placeholder="Cerca nome, email, località" value="${esc(MF.q)}">
        <select id="mstato"><option value="attivi">Attivi</option><option value="disattivati">Disattivati</option><option value="tutti">Tutti</option></select>
        <select id="mcat"><option value="">Tutte le categorie</option>${cats.map(c => `<option>${esc(c)}</option>`).join("")}</select>
        <select id="mquota"><option value="">Quota ${y}: tutte</option><option value="da pagare">Da pagare</option><option value="pagata">Pagata</option><option value="nessuna">Nessuna quota</option></select>
      </div>
      <div class="list" id="mlist"></div>
    </div></div>`;
  $("mstato").value = MF.stato; $("mcat").value = MF.cat; $("mquota").value = MF.quota;
  const filtered = () => all.filter(m =>
    (MF.stato === "tutti" || (MF.stato === "attivi") === m.active) && (!MF.cat || m.category === MF.cat) && (!MF.quota || quotaOf(m) === MF.quota) &&
    (!MF.q || [m.full_name, m.email, m.city, m.phone].join(" ").toLowerCase().includes(MF.q.toLowerCase())));
  const draw = () => {
    const list = filtered();
    $("mlist").innerHTML = list.length ? list.map(m => {
      const q = quotaOf(m);
      return `<a class="li" data-id="${m.id}"><div class="grow"><span class="name">${esc(m.full_name)}</span>
        ${m.is_admin ? `<span class="pill open">admin</span>` : ""}${m.active ? "" : ` <span class="pill closed">disattivato</span>`}<br>
        <span class="small muted">${esc([m.email, m.city].filter(Boolean).join(" · "))}</span></div>
        <span class="pill cat">${esc(m.category)}</span>
        <span class="pill ${q === "pagata" ? "paid" : q === "da pagare" ? "due" : "closed"}">${q === "nessuna" ? "nessuna quota" : "quota " + q}</span></a>`;
    }).join("") : `<p class="empty">Nessun socio corrisponde ai filtri.</p>`;
    $("mlist").querySelectorAll("a.li").forEach(a => a.onclick = () => viewMember(a.dataset.id));
  };
  $("mq").oninput = e => { MF.q = e.target.value; draw(); };
  [["mstato","stato"],["mcat","cat"],["mquota","quota"]].forEach(([id,k]) => $(id).onchange = e => { MF[k] = e.target.value; draw(); });
  $("mnew").onclick = () => viewMember(null);
  $("mimp").onclick = viewImport;
  $("mcsv").onclick = () => downloadCsv(`soci-${today()}.csv`, [["Nome","Email","Telefono","Indirizzo","NPA","Località","Data di nascita","Categoria","Socio dal","Attivo","Admin",`Quota ${y}`],
    ...filtered().map(m => [m.full_name, m.email, m.phone, m.address, m.zip, m.city, fmtDate(m.birth_date), m.category, fmtDate(m.member_since), m.active ? "sì" : "no", m.is_admin ? "sì" : "no", quotaOf(m)])]);
  draw();
}

function viewImport() {
  $app.innerHTML = `<form class="card stack" id="fm"><button class="back" type="button" id="bk">← Soci</button><h2>Importa elenco soci</h2>
    <p class="small muted">Una riga per socio: <b>Nome Cognome; email</b>, facoltativamente seguiti da <b>; categoria</b>. Puoi incollare le colonne copiate da Excel. Le email già presenti vengono ignorate.</p>
    <label for="mlist">Elenco<textarea id="mlist" style="min-height:200px" placeholder="Anna Rossi; anna.rossi@esempio.ch; Adulto&#10;Marco Bianchi; marco@esempio.ch; Giovane"></textarea></label>
    <div><button class="btn" type="submit">Importa</button></div></form>`;
  $("bk").onclick = () => go("soci");
  $("fm").onsubmit = async e => {
    e.preventDefault();
    const rows = [], bad = [];
    $("mlist").value.split(/\n/).map(l => l.trim()).filter(Boolean).forEach(l => {
      const parts = l.split(/[;\t,]/).map(x => x.trim()).filter(Boolean);
      const email = parts.find(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
      const rest = parts.filter(x => x !== email);
      if (!email || !rest.length) return bad.push(l);
      const cat = rest.length > 1 ? rest.pop() : null;
      rows.push({ email: email.toLowerCase(), full_name: rest.join(" "), ...(cat ? { category: cat } : {}) });
    });
    if (!rows.length) return toast("Nessuna riga valida: usa «Nome Cognome; email».");
    const { error } = await sb.from("members").upsert(rows, { onConflict: "email", ignoreDuplicates: true });
    if (error) return toast(errText(error));
    toast(`${rows.length} righe elaborate` + (bad.length ? `, ${bad.length} ignorate` : "")); go("soci");
  };
}

async function viewMember(id) {
  const isNew = !id;
  const [mr, nr, pr, fr, cats] = isNew ? [{ data: {} }, { data: null }, { data: [] }, { data: [] }, await categories()] : await Promise.all([
    sb.from("members").select("*").eq("id", id).single(),
    sb.from("member_notes").select("notes").eq("member_id", id).maybeSingle(),
    sb.from("participants").select("*").eq("member_id", id).order("created_at"),
    sb.from("fees").select("*").eq("member_id", id).order("year", { ascending: false }).order("created_at"),
    categories(),
  ]);
  if (mr.error) return fail(mr.error);
  const m = mr.data, self = m.id === S.me.id;
  scrollTo(0, 0);
  $app.innerHTML = `<div class="stack">
    <button class="back" id="bk">← Soci</button>
    <form class="card stack" id="fmem"><h2>${isNew ? "Nuovo socio" : esc(m.full_name)}</h2>
      <div class="row"><label for="mname">Nome e cognome<input id="mname" required value="${esc(m.full_name)}"></label>
        <label for="memail">Email (serve per entrare)<input id="memail" type="email" required value="${esc(m.email)}"></label></div>
      <div class="row"><label for="mphone">Telefono<input id="mphone" type="tel" value="${esc(m.phone)}"></label>
        <label for="mbirth">Data di nascita<input id="mbirth" type="date" value="${esc(m.birth_date)}"></label></div>
      <label for="maddr">Indirizzo<input id="maddr" value="${esc(m.address)}"></label>
      <div class="row"><label for="mzip">NPA<input id="mzip" value="${esc(m.zip)}"></label>
        <label for="mcity">Località<input id="mcity" value="${esc(m.city)}"></label></div>
      <div class="row"><label for="mcat">Categoria (determina la quota)<input id="mcat" list="catlist" required value="${esc(m.category || "Adulto")}"></label>
        <label for="msince">Socio dal<input id="msince" type="date" value="${esc(m.member_since || today())}"></label></div>
      <datalist id="catlist">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
      <label for="mnotes">Note del comitato (non visibili al socio)<textarea id="mnotes">${esc(nr.data?.notes)}</textarea></label>
      <div class="btns"><label class="check" for="mactive"><input id="mactive" type="checkbox" ${m.active === false ? "" : "checked"} ${self ? "disabled" : ""}> Attivo</label>
        <label class="check" for="madmin"><input id="madmin" type="checkbox" ${m.is_admin ? "checked" : ""} ${self ? "disabled" : ""}> Amministratore</label></div>
      <div class="btns"><button class="btn" type="submit">${isNew ? "Crea socio" : "Salva"}</button>
        ${!isNew && !self ? `<button class="btn danger" type="button" id="mdel">Elimina socio</button>` : ""}</div>
    </form>
    ${isNew ? "" : `
    <div class="card stack"><h3>Quote</h3>
      <div class="list" id="flist">${fr.data.length ? fr.data.map(f => feeRow(f)).join("") : `<p class="muted small">Nessuna quota.</p>`}</div>
      <details><summary>Aggiungi una quota o un addebito</summary>
        <form class="stack" id="fadd" style="padding-top:10px"><div class="row3">
          <label>Descrizione<input name="description" required placeholder="Tassa sociale ${thisYear()}"></label>
          <label>Importo CHF<input name="amount" type="number" step="0.05" min="0" required inputmode="decimal"></label>
          <label>Anno<input name="year" type="number" value="${thisYear()}" required></label></div>
          <div><button class="btn sm" type="submit">Aggiungi</button></div></form>
      </details></div>
    <div class="card stack"><h3>Famiglia</h3><p class="small muted">Persone che questo socio può iscrivere agli eventi.</p><div id="fam">${familyHtml(pr.data)}</div></div>`}
  </div>`;
  $("bk").onclick = () => go("soci");
  $("fmem").onsubmit = async e => {
    e.preventDefault();
    const row = { full_name: val("mname"), email: val("memail").toLowerCase(), phone: orNull(val("mphone")), birth_date: orNull(val("mbirth")),
      address: orNull(val("maddr")), zip: orNull(val("mzip")), city: orNull(val("mcity")), category: val("mcat"), member_since: orNull(val("msince")),
      ...(self ? {} : { active: $("mactive").checked, is_admin: $("madmin").checked }) };
    const res = isNew ? await sb.from("members").insert(row).select().single() : await sb.from("members").update(row).eq("id", id).select().single();
    if (res.error) return toast(errText(res.error));
    const notes = val("mnotes");
    if (notes || nr.data) await sb.from("member_notes").upsert({ member_id: res.data.id, notes, updated_at: new Date().toISOString() });
    if (self) S.me = res.data;
    toast(isNew ? "Socio creato" : "Dati salvati"); viewMember(res.data.id);
  };
  if (isNew) return;
  if ($("mdel")) $("mdel").onclick = async e => {
    if (!confirmTap(e.target, "Conferma: elimina socio, famiglia, iscrizioni e quote")) return;
    const { error } = await sb.from("members").delete().eq("id", id);
    if (error) return toast(errText(error)); toast("Socio eliminato"); go("soci");
  };
  $("fadd").onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const { error } = await sb.from("fees").insert({ member_id: id, description: f.description.value.trim(), amount: Number(f.amount.value), year: Number(f.year.value) });
    if (error) return toast(errText(error)); toast("Quota aggiunta"); viewMember(id);
  };
  bindFeeRows($("flist"), fr.data, () => viewMember(id));
  bindFamily($("fam"), id, pr.data, () => viewMember(id));
}

// Riga quota con pagamento (usata nella scheda socio e nella pagina Quote)
function feeRow(f, who = "") {
  return `<div class="li" data-fid="${f.id}">
    <div class="grow">${who ? `<a class="name" href="#" data-open="${f.member_id}" style="color:inherit">${esc(who)}</a><br>` : ""}
      <span class="${who ? "small" : "name"}">${esc(f.description)}</span><br>${feeStatus(f)}${f.method ? ` <span class="small muted">${esc(f.method)}</span>` : ""}${f.note ? ` <span class="small muted">· ${esc(f.note)}</span>` : ""}</div>
    <span class="num">${chf(f.amount)}</span>
    ${f.paid_at ? `<button class="btn sm ghost" data-unpay>Annulla pagamento</button>` : `<button class="btn sm gold" data-pay>Registra pagamento</button>`}
    <button class="btn sm danger" data-fdel aria-label="Elimina quota">✕</button>
  </div>`;
}
function bindFeeRows(box, fees, reload) {
  const byId = Object.fromEntries(fees.map(f => [f.id, f]));
  box.querySelectorAll("[data-open]").forEach(a => a.onclick = e => { e.preventDefault(); viewMember(a.dataset.open); });
  box.querySelectorAll("[data-pay]").forEach(b => b.onclick = () => {
    const li = b.closest(".li"), f = byId[li.dataset.fid];
    if (li.querySelector(".paybox")) return;
    li.insertAdjacentHTML("beforeend", `<form class="paybox">
      <label>Data<input name="paid_at" type="date" value="${today()}" required></label>
      <label>Importo<input name="paid_amount" type="number" step="0.05" min="0" value="${f.amount}" required></label>
      <label>Metodo<select name="method">${METHODS.map(x => `<option>${x}</option>`).join("")}</select></label>
      <button class="btn sm" type="submit">Conferma</button></form>`);
    li.querySelector(".paybox").onsubmit = async e => {
      e.preventDefault(); const p = e.target;
      const { error } = await sb.from("fees").update({ paid_at: p.paid_at.value, paid_amount: Number(p.paid_amount.value), method: p.method.value }).eq("id", f.id);
      if (error) return toast(errText(error)); toast("Pagamento registrato"); reload();
    };
  });
  box.querySelectorAll("[data-unpay]").forEach(b => b.onclick = async () => {
    if (!confirmTap(b, "Conferma annullamento")) return;
    const { error } = await sb.from("fees").update({ paid_at: null, paid_amount: null, method: null }).eq("id", b.closest(".li").dataset.fid);
    if (error) return toast(errText(error)); toast("Pagamento annullato"); reload();
  });
  box.querySelectorAll("[data-fdel]").forEach(b => b.onclick = async () => {
    if (!confirmTap(b, "Elimina")) return;
    const { error } = await sb.from("fees").delete().eq("id", b.closest(".li").dataset.fid);
    if (error) return toast(errText(error)); toast("Quota eliminata"); reload();
  });
}

// ─── Quote sociali (admin) ───
const FF = { year: null, stato: "", q: "" };
async function viewFees() {
  const y = FF.year ||= thisYear();
  const [tr, fr, mr, st] = await Promise.all([
    sb.from("fee_types").select("*").eq("year", y).order("category"),
    sb.from("fees").select("*").eq("year", y).order("created_at"),
    sb.from("members").select("id, full_name, email, category, active"),
    sb.from("settings").select("value").eq("key", "istruzioni_pagamento").maybeSingle(),
  ]);
  if (tr.error || fr.error) return fail(tr.error || fr.error);
  const mem = Object.fromEntries(mr.data.map(m => [m.id, m]));
  const fees = fr.data.sort((a, b) => (mem[a.member_id]?.full_name || "").localeCompare(mem[b.member_id]?.full_name || ""));
  const due = fees.reduce((s, f) => s + Number(f.amount), 0), paid = fees.reduce((s, f) => s + Number(f.paid_amount || 0), 0);
  const openN = fees.filter(f => !f.paid_at).length;
  const catsWithType = new Set(tr.data.map(t => t.category));
  const missingCats = [...new Set(mr.data.filter(m => m.active).map(m => m.category))].filter(c => !catsWithType.has(c));
  $app.innerHTML = `<div class="stack">
    <div class="btns"><h2 class="grow">Quote sociali ${y}</h2>
      <button class="btn sm ghost" id="yprev">← ${y - 1}</button><button class="btn sm ghost" id="ynext">${y + 1} →</button></div>
    <div class="tiles">
      <div class="tile"><b class="num">${chf(due)}</b><span>totale dovuto</span></div>
      <div class="tile good"><b class="num">${chf(paid)}</b><span>incassato</span></div>
      <div class="tile bad"><b class="num">${chf(Math.max(due - paid, 0))}</b><span>da incassare</span></div>
      <div class="tile"><b>${openN} / ${fees.length}</b><span>quote aperte</span></div>
    </div>
    <div class="card stack"><h3>Tariffe ${y} per categoria</h3>
      <div class="list" id="tlist">${tr.data.map(t => `<div class="li" data-tid="${t.id}">
        <span class="grow"><span class="pill cat">${esc(t.category)}</span></span>
        <input data-amt type="number" step="0.05" min="0" value="${t.amount}" style="max-width:120px" aria-label="Importo ${esc(t.category)}">
        <input data-due type="date" value="${esc(t.due_date)}" style="max-width:170px" aria-label="Scadenza ${esc(t.category)}">
        <button class="btn sm ghost" data-tsave>Salva</button><button class="btn sm danger" data-tdel aria-label="Elimina tariffa">✕</button></div>`).join("") || `<p class="small muted">Nessuna tariffa per il ${y}.</p>`}</div>
      ${missingCats.length ? `<div class="msg info small">Soci attivi in categorie senza tariffa ${y}: <b>${missingCats.map(esc).join(", ")}</b>. Aggiungi la tariffa prima di generare le quote.</div>` : ""}
      <form class="row3" id="tadd" style="align-items:end">
        <label>Categoria<input name="category" list="catlist2" required placeholder="Adulto"></label>
        <label>Importo CHF<input name="amount" type="number" step="0.05" min="0" required inputmode="decimal"></label>
        <label>Scadenza<input name="due_date" type="date"></label>
        <datalist id="catlist2">${(await categories()).map(c => `<option value="${esc(c)}">`).join("")}</datalist>
        <div><button class="btn sm" type="submit">Aggiungi tariffa</button></div>
      </form>
      <div class="btns"><button class="btn gold" id="gen" ${tr.data.length ? "" : "disabled"}>Genera quote ${y} per tutti i soci attivi</button>
        <span class="small muted">Crea la quota a chi non ce l'ha ancora; quelle esistenti non vengono toccate.</span></div>
    </div>
    <div class="card stack">
      <div class="btns"><h3 class="grow">Quote ${y}</h3><button class="btn sm ghost" id="fcsv">Esporta CSV</button></div>
      <div class="toolbar"><input id="fq" type="search" placeholder="Cerca socio" value="${esc(FF.q)}">
        <select id="fst"><option value="">Tutte</option><option value="open">Da pagare</option><option value="late">Scadute</option><option value="paid">Pagate</option></select></div>
      <div class="list" id="flist"></div>
    </div>
    <form class="card stack" id="fset"><h3>Istruzioni di pagamento</h3>
      <p class="small muted">Le vedono i soci con quote aperte nella scheda «Profilo e quote» (es. IBAN, intestatario, causale).</p>
      <textarea id="paytxt">${esc(st.data?.value)}</textarea><div><button class="btn sm" type="submit">Salva istruzioni</button></div></form>
  </div>`;
  $("yprev").onclick = () => { FF.year = y - 1; go("quote"); };
  $("ynext").onclick = () => { FF.year = y + 1; go("quote"); };
  $("fst").value = FF.stato;
  const filtered = () => fees.filter(f => {
    const st = f.paid_at ? "paid" : (f.due_date && f.due_date < today()) ? "late" : "open";
    return (!FF.stato || FF.stato === st || (FF.stato === "open" && st === "late")) &&
      (!FF.q || (mem[f.member_id]?.full_name || "").toLowerCase().includes(FF.q.toLowerCase()));
  });
  const draw = () => {
    const list = filtered();
    $("flist").innerHTML = list.length ? list.map(f => feeRow(f, mem[f.member_id]?.full_name || "?")).join("") : `<p class="empty">Nessuna quota.</p>`;
    bindFeeRows($("flist"), list, viewFees);
  };
  $("fq").oninput = e => { FF.q = e.target.value; draw(); };
  $("fst").onchange = e => { FF.stato = e.target.value; draw(); };
  draw();
  $("tadd").onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const { error } = await sb.from("fee_types").insert({ year: y, category: f.category.value.trim(), amount: Number(f.amount.value), due_date: orNull(f.due_date.value) });
    if (error) return toast(errText(error)); toast("Tariffa aggiunta"); viewFees();
  };
  $("tlist").querySelectorAll("[data-tsave]").forEach(b => b.onclick = async () => {
    const li = b.closest(".li");
    const { error } = await sb.from("fee_types").update({ amount: Number(li.querySelector("[data-amt]").value), due_date: orNull(li.querySelector("[data-due]").value) }).eq("id", li.dataset.tid);
    if (error) return toast(errText(error)); toast("Tariffa salvata (le quote già generate non cambiano)"); viewFees();
  });
  $("tlist").querySelectorAll("[data-tdel]").forEach(b => b.onclick = async () => {
    if (!confirmTap(b, "Elimina")) return;
    const { error } = await sb.from("fee_types").delete().eq("id", b.closest(".li").dataset.tid);
    if (error) return toast(errText(error)); toast("Tariffa eliminata"); viewFees();
  });
  $("gen").onclick = async e => {
    e.target.disabled = true;
    const { data, error } = await sb.rpc("generate_fees", { p_year: y });
    if (error) { e.target.disabled = false; return toast(errText(error)); }
    toast(data ? `${data} quote create` : "Nessuna nuova quota: tutti i soci attivi ce l'hanno già"); viewFees();
  };
  $("fcsv").onclick = () => downloadCsv(`quote-${y}.csv`, [["Socio","Email","Categoria","Descrizione","Importo","Scadenza","Pagata il","Importo pagato","Metodo","Nota"],
    ...filtered().map(f => { const m = mem[f.member_id] || {}; return [m.full_name, m.email, m.category, f.description, Number(f.amount).toFixed(2), fmtDate(f.due_date), fmtDate(f.paid_at), f.paid_amount != null ? Number(f.paid_amount).toFixed(2) : "", f.method, f.note]; })]);
  $("fset").onsubmit = async e => {
    e.preventDefault();
    const { error } = await sb.from("settings").upsert({ key: "istruzioni_pagamento", value: $("paytxt").value.trim() });
    if (error) return toast(errText(error)); toast("Istruzioni salvate");
  };
}

sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_IN" && !S.me) setTimeout(boot, 0); });
boot();
