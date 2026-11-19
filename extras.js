/* =========================================================
   EstudaIA — Progresso do dia e Cartões de revisão
   Tudo salvo no navegador (localStorage), sem cadastro.
   ========================================================= */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const dayKey = (d) => (d || new Date()).toLocaleDateString("sv-SE");
  const DAY = 86400000;

  /* ================= PROGRESSO ================= */
  const K_ST = "estudoia_stats_v6";
  let stats = { days: {}, goal: 60, exam: { name: "", date: "" } };
  try { const s = JSON.parse(store.get(K_ST) || "null"); if (s) stats = { ...stats, ...s }; } catch (e) {}
  const saveStats = () => store.set(K_ST, JSON.stringify(stats));
  const today = () => (stats.days[dayKey()] = stats.days[dayKey()] || { min: 0, cards: 0 });

  function streak() {
    let n = 0;
    const d = new Date();
    const active = (k) => stats.days[k] && (stats.days[k].min > 0 || stats.days[k].cards > 0);
    if (!active(dayKey(d))) d.setTime(d.getTime() - DAY); // hoje ainda não conta contra a sequência
    while (active(dayKey(d))) { n++; d.setTime(d.getTime() - DAY); }
    return n;
  }

  function renderStats() {
    if (!$("statMin")) return;
    const t = today();
    $("statMin").textContent = Math.round(t.min);
    $("statGoal").value = stats.goal;
    $("statBar").style.width = Math.min(100, (t.min / Math.max(1, stats.goal)) * 100) + "%";
    const s = streak();
    $("statStreak").textContent = s;
    $("statStreakLabel").textContent = s === 1 ? "dia seguido" : "dias seguidos";
    $("statDue").textContent = window.EstudoCards ? window.EstudoCards.dueCount() : 0;
    // semana
    const wk = $("statWeek");
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * DAY); days.push({ k: dayKey(d), l: d.toLocaleDateString("pt-BR", { weekday: "narrow" }) }); }
    const max = Math.max(30, ...days.map((x) => (stats.days[x.k] || { min: 0 }).min));
    wk.innerHTML = days.map((x, i) => {
      const v = (stats.days[x.k] || { min: 0 }).min;
      return `<span class="wk${i === 6 ? " now" : ""}" title="${Math.round(v)} min"><i style="height:${Math.max(4, (v / max) * 100)}%"></i><b>${x.l.toUpperCase()}</b></span>`;
    }).join("");
    // prova
    const ex = stats.exam;
    $("examName").value = ex.name || ""; $("examDate").value = ex.date || "";
    const out = $("examOut");
    if (ex.date) {
      const diff = Math.ceil((new Date(ex.date + "T00:00:00") - new Date(dayKey() + "T00:00:00")) / DAY);
      out.textContent = diff > 1 ? `faltam ${diff} dias` : diff === 1 ? "é amanhã" : diff === 0 ? "é hoje" : "já passou";
    } else out.textContent = "defina a data";
  }

  window.EstudoStats = {
    addFocus(min) { today().min += min; saveStats(); renderStats(); },
    addCards(n) { today().cards += n; saveStats(); renderStats(); }
  };

  if ($("statGoal")) {
    $("statGoal").addEventListener("change", () => { stats.goal = Math.max(5, Math.min(600, parseInt($("statGoal").value, 10) || 60)); saveStats(); renderStats(); });
    const onExam = () => { stats.exam = { name: $("examName").value.trim(), date: $("examDate").value }; saveStats(); renderStats(); };
    $("examName").addEventListener("change", onExam); $("examDate").addEventListener("change", onExam);
  }

  /* ================= CARTÕES ================= */
  const K_CARDS = "estudoia_cards_v6";
  const GAPS = [0, 0, 1, 3, 7, 16, 35]; // dias até a próxima revisão, por caixa (1 a 6)
  let deck = [];
  try { deck = JSON.parse(store.get(K_CARDS) || "[]") || []; } catch (e) {}
  const saveDeck = () => store.set(K_CARDS, JSON.stringify(deck));
  const uid = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const isDue = (c) => c.due <= Date.now();

  let studyAll = false, flipped = false, cur = null, tab = "revisar";

  const EXAMPLES = [
    ["O que o discriminante (Δ) diz sobre uma equação do 2º grau?", "Quantas raízes reais ela tem: Δ > 0, duas; Δ = 0, uma; Δ < 0, nenhuma.", "Matemática"],
    ["Qual organela libera energia para a célula?", "A mitocôndria.", "Biologia"],
    ["Quando se usa crase?", "Quando há fusão de preposição 'a' com artigo 'a'. Teste: troque por 'ao'.", "Português"],
    ["O que é velocidade média?", "Distância percorrida dividida pelo tempo gasto: Vm = ΔS / Δt.", "Física"],
    ["Que evento marca o início da Revolução Francesa?", "A queda da Bastilha, em 1789.", "História"],
    ["Qual é a geometria da molécula de água?", "Angular e polar (cerca de 104,5°).", "Química"]
  ];

  function add(list) {
    let n = 0;
    list.forEach((c) => {
      const q = String(c.q || "").trim(), a = String(c.a || "").trim();
      if (!q || !a || deck.some((d) => d.q === q && d.a === a)) return;
      deck.push({ id: uid(), q, a, tag: String(c.tag || "").trim().slice(0, 40), box: 1, due: Date.now() });
      n++;
    });
    if (n) { saveDeck(); renderCards(); renderStats(); }
    return n;
  }

  window.EstudoCards = {
    dueCount: () => deck.filter(isDue).length,
    addMany(list) {
      const n = add(list);
      showToast(n ? `${n} ${n === 1 ? "cartão adicionado" : "cartões adicionados"} ao baralho.` : "Esses cartões já estavam no baralho.");
    }
  };

  function pick() {
    const pool = deck.filter((c) => studyAll || isDue(c));
    if (!pool.length) return null;
    if (cur && pool.includes(cur) && pool.length > 1) { const rest = pool.filter((c) => c !== cur); return rest[Math.floor(Math.random() * rest.length)]; }
    return pool.sort((a, b) => a.due - b.due)[0];
  }

  function renderCards() {
    if (!$("fcFace")) return;
    ["revisar", "adicionar", "baralho"].forEach((t) => { $("fcTab-" + t).hidden = t !== tab; });
    document.querySelectorAll("[data-fctab]").forEach((b) => { b.classList.toggle("active", b.dataset.fctab === tab); b.setAttribute("aria-selected", String(b.dataset.fctab === tab)); });
    $("fcCount").textContent = `${deck.filter(isDue).length} para revisar · ${deck.length} no baralho`;

    if (tab === "revisar") {
      if (!cur || !deck.includes(cur)) cur = pick();
      const has = !!cur;
      $("fcEmpty").hidden = has; $("fcStudy").hidden = !has;
      if (!has) {
        $("fcEmptyText").textContent = deck.length ? "Tudo em dia. Volte mais tarde ou estude todos os cartões agora." : "Seu baralho está vazio. Peça cartões ao tutor, crie à mão ou carregue exemplos.";
        $("fcAll").hidden = !deck.length; $("fcExamples").hidden = !!deck.length;
      } else {
        $("fcTag").textContent = cur.tag || "Cartão";
        $("fcQ").textContent = cur.q; $("fcA").textContent = cur.a;
        $("fcCard").classList.toggle("flipped", flipped);
        $("fcShow").hidden = flipped; $("fcRate").hidden = !flipped;
        $("fcBox").textContent = "caixa " + cur.box + " de 6";
      }
    }
    if (tab === "baralho") {
      const q = ($("fcFilter").value || "").toLowerCase();
      const items = deck.filter((c) => !q || (c.q + c.a + c.tag).toLowerCase().includes(q));
      $("fcList").innerHTML = items.length ? items.map((c) => `
        <li class="fc-row"><div><strong>${esc(c.q)}</strong><span>${esc(c.a)}</span></div>
        <em title="Caixa ${c.box}">${"●".repeat(c.box)}${"○".repeat(6 - c.box)}</em>
        <button type="button" class="star-btn" data-del="${c.id}" aria-label="Excluir cartão">Excluir</button></li>`).join("") : '<li class="fc-row muted">Nada por aqui ainda.</li>';
    }
  }

  function rate(kind) {
    if (!cur) return;
    if (kind === "again") { cur.box = 1; cur.due = Date.now() + 10 * 60000; }
    else if (kind === "hard") { cur.due = Date.now() + Math.max(1, GAPS[cur.box]) * DAY * 0.5; }
    else { cur.box = Math.min(6, cur.box + 1); cur.due = Date.now() + GAPS[cur.box] * DAY; }
    window.EstudoStats.addCards(1);
    saveDeck();
    const prev = cur; flipped = false; cur = null;
    cur = pick(); if (cur === prev && !(studyAll || isDue(prev))) cur = null;
    renderCards();
  }

  function parseImport(text) {
    const out = [];
    String(text).split("\n").forEach((l) => {
      l = l.trim(); if (!l) return;
      let m = l.match(/^(?:P:\s*)?(.+?)\s*\|\|\s*(?:R:\s*)?(.+)$/i) || l.match(/^(.+?)\s*(?:::|;|\t)\s*(.+)$/);
      if (m) out.push({ q: m[1], a: m[2] });
    });
    return out;
  }

  if ($("fcFace")) {
    document.querySelectorAll("[data-fctab]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.fctab; renderCards(); }));
    $("fcShow").addEventListener("click", () => { flipped = true; renderCards(); $("fcRate").querySelector("button").focus({ preventScroll: true }); });
    $("fcCard").addEventListener("click", () => { if (cur) { flipped = !flipped; renderCards(); } });
    $("fcRate").addEventListener("click", (e) => { const b = e.target.closest("[data-rate]"); if (b) rate(b.dataset.rate); });
    $("fcAll").addEventListener("click", () => { studyAll = true; cur = null; flipped = false; renderCards(); });
    $("fcExamples").addEventListener("click", () => { add(EXAMPLES.map(([q, a, tag]) => ({ q, a, tag }))); showToast("Exemplos carregados."); });
    $("fcAsk").addEventListener("click", () => {
      if (!window.EstudoChat) return;
      scrollToId("tutor");
      $("chatInput").value = "Crie 6 cartões de estudo sobre o que vimos. Formato exato, uma linha por cartão: P: pergunta || R: resposta";
      $("chatInput").focus({ preventScroll: true });
      showToast("Revise a mensagem e envie ao tutor.");
    });
    $("fcAddForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const n = add([{ q: $("fcNewQ").value, a: $("fcNewA").value, tag: $("fcNewTag").value }]);
      if (n) { $("fcNewQ").value = ""; $("fcNewA").value = ""; $("fcNewQ").focus(); showToast("Cartão criado."); } else showToast("Preencha pergunta e resposta.");
    });
    $("fcImportBtn").addEventListener("click", () => {
      const list = parseImport($("fcImport").value);
      const n = add(list);
      showToast(n ? `${n} cartões importados.` : "Nada para importar. Use: pergunta || resposta");
      if (n) $("fcImport").value = "";
    });
    $("fcFilter").addEventListener("input", renderCards);
    $("fcList").addEventListener("click", (e) => { const b = e.target.closest("[data-del]"); if (!b) return; deck = deck.filter((c) => c.id !== b.dataset.del); if (cur && cur.id === b.dataset.del) cur = null; saveDeck(); renderCards(); renderStats(); });
    $("fcExport").addEventListener("click", () => { if (!deck.length) return showToast("Baralho vazio."); copyText(deck.map((c) => `P: ${c.q} || R: ${c.a}`).join("\n"), "Baralho copiado."); });
    $("fcClear").addEventListener("click", () => { if (deck.length && confirm("Apagar todos os cartões?")) { deck = []; cur = null; saveDeck(); renderCards(); renderStats(); } });
    document.addEventListener("keydown", (e) => {
      if (tab !== "revisar" || !cur || /input|textarea|select/i.test((e.target.tagName || ""))) return;
      const sec = $("cartoes").getBoundingClientRect();
      if (sec.bottom < 0 || sec.top > innerHeight) return;
      if (e.key === " " && !flipped) { e.preventDefault(); flipped = true; renderCards(); }
      else if (flipped && e.key === "1") rate("again");
      else if (flipped && e.key === "2") rate("hard");
      else if (flipped && e.key === "3") rate("good");
    });
  }

  /* ================= TEMPO DE FOCO: extras ================= */
  const custom = $("customMin");
  if (custom) {
    const btn = $("customTimerBtn");
    custom.addEventListener("change", () => {
      const v = Math.max(1, Math.min(180, parseInt(custom.value, 10) || 40));
      custom.value = v; btn.dataset.minutes = v; btn.textContent = v + " min";
      btn.click();
    });
  }
  const snd = $("timerSound");
  if (snd) {
    snd.checked = store.get("estudoia_sound_v6") !== "0";
    snd.addEventListener("change", () => store.set("estudoia_sound_v6", snd.checked ? "1" : "0"));
  }

  renderCards();
  renderStats();
})();
