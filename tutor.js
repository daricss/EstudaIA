/* =========================================================
   EstudaIA — Tutor no próprio site (chat de estudo)
   Três motores, nesta ordem:
   1) "byok": chave da Anthropic do próprio aluno (fica só no navegador)
   2) "server": função /api/chat do site (a chave fica no servidor)
   3) "local": roteiro de perguntas, sem IA, como reserva
   ========================================================= */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const core = window.EstudoCore;
  if (!$("chatLog") || !core) return;

  const K_CHAT = "estudoia_chat_v6", K_API = "estudoia_key_v6", K_MODEL = "estudoia_model_v6";
  const st = { msgs: [], busy: false, ctrl: null, engine: "checking", sawLocalNote: false };
  const S = { mode: "socratico", subject: "", topic: "", level: "Ensino Médio", tone: "paciente", length: "normal", lang: "pt", reveal: true };

  const el = {
    log: $("chatLog"), empty: $("chatEmpty"), form: $("chatForm"), input: $("chatInput"),
    send: $("chatSend"), stop: $("chatStop"), mic: $("chatMic"), pill: $("engineStatus"),
    newBtn: $("chatNewBtn"), copyBtn: $("chatCopyBtn"), quick: $("chatQuick"),
    mode: $("tMode"), subject: $("tSubject"), topic: $("tTopic"), topic2: $("emptyTopic"), level: $("tLevel"),
    tone: $("tTone"), length: $("tLength"), lang: $("tLang"), reveal: $("tReveal"),
    starters: $("starterChips"), startBtn: $("emptyStart"), modeHint: $("modeHint"),
    dlg: $("aiDialog"), key: $("aiKey"), model: $("aiModel"), dlgMsg: $("aiMsg")
  };

  /* ---------- texto → HTML (markdown leve, sempre escapado) ---------- */
  function md(src) {
    let s = esc(src);
    const blocks = [];
    s = s.replace(/```([\s\S]*?)```/g, (_, c) => { blocks.push(`<pre><code>${c.replace(/^\n/, "")}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
    const inline = (t) => t
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
      .replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
    const out = [];
    let list = null, para = [];
    const flushL = () => { if (list) { out.push(`<${list.t}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.t}>`); list = null; } };
    const flushP = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
    s.split("\n").forEach((line) => {
      let m;
      if (/^\u0000\d+\u0000$/.test(line.trim())) { flushL(); flushP(); out.push(line.trim()); }
      else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flushP(); if (!list || list.t !== "ul") { flushL(); list = { t: "ul", items: [] }; } list.items.push(m[1]); }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushP(); if (!list || list.t !== "ol") { flushL(); list = { t: "ol", items: [] }; } list.items.push(m[1]); }
      else if ((m = line.match(/^\s*#{1,4}\s+(.*)$/))) { flushL(); flushP(); out.push(`<p><strong>${inline(m[1])}</strong></p>`); }
      else if (!line.trim()) { flushL(); flushP(); }
      else { flushL(); para.push(line); }
    });
    flushL(); flushP();
    return out.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  }

  function parseCards(text) {
    const out = [];
    String(text).split("\n").forEach((l) => {
      const m = l.match(/^\s*(?:[-*•]|\d+[.)])?\s*(?:\*\*)?P(?:ergunta)?:(?:\*\*)?\s*(.+?)\s*\|\|\s*(?:\*\*)?R(?:esposta)?:(?:\*\*)?\s*(.+?)\s*$/i);
      if (m) out.push({ q: m[1].replace(/\*\*/g, "").trim(), a: m[2].replace(/\*\*/g, "").trim() });
    });
    return out;
  }

  /* ---------- persistência ---------- */
  const save = () => store.set(K_CHAT, JSON.stringify({ msgs: st.msgs.slice(-40), S }));
  function load() {
    try {
      const d = JSON.parse(store.get(K_CHAT) || "null");
      if (!d) return;
      if (Array.isArray(d.msgs)) st.msgs = d.msgs.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
      if (d.S) Object.assign(S, d.S);
    } catch (e) {}
  }

  /* ---------- controles ---------- */
  const MODE_HINTS = {
    socratico: "O tutor explica um pouco, pergunta e deixa a conclusão com você.",
    explicar: "Explicação simples, com analogia, em blocos curtos e com checagem.",
    exercicio: "Cole a questão. O tutor ajuda a montar, mas não faz a conta por você.",
    corrigir: "Cole a questão e a sua resolução. O tutor aponta onde o raciocínio desviou.",
    quiz: "Perguntas uma por vez, com dificuldade crescente e placar.",
    feynman: "Você explica com suas palavras e o tutor mostra as lacunas.",
    redacao: "Cole seu texto. O tutor critica sem reescrever nenhuma frase.",
    plano: "Mapa de estudo em 5 etapas e começo pela primeira.",
    idioma: "Conversa curta no idioma que você pedir, com correções leves."
  };
  const STARTERS = {
    socratico: (t) => `Vamos começar. Quero entender ${t}.`,
    explicar: (t) => `Me explique ${t} de forma simples, em partes.`,
    exercicio: (t) => `Quero resolver uma questão sobre ${t}. Me guie sem dar a conta pronta.`,
    corrigir: (t) => `Quero descobrir onde errei numa resolução sobre ${t}. Já te mando.`,
    quiz: (t) => `Me teste sobre ${t}, uma pergunta por vez.`,
    feynman: (t) => `Quero praticar ${t} pela Técnica Feynman. Pode começar.`,
    redacao: (t) => `Quero revisar um texto sobre ${t}. Já te mando.`,
    plano: (t) => `Monte um plano de estudo do zero para ${t}.`,
    idioma: (t) => `Quero praticar conversação sobre ${t}.`
  };
  const SUGGESTIONS = ["Fotossíntese", "Equação do 2º grau", "Revolução Francesa", "Uso da crase", "Laços de repetição"];

  function syncControls() {
    el.mode.value = S.mode; el.subject.value = S.subject; el.topic.value = S.topic; el.topic2.value = S.topic;
    el.level.value = S.level; el.tone.value = S.tone; el.length.value = S.length; el.lang.value = S.lang; el.reveal.checked = !!S.reveal;
    el.modeHint.textContent = MODE_HINTS[S.mode] || "";
  }
  function bindControls() {
    const upd = (k, node, evt) => node.addEventListener(evt || "change", () => {
      S[k] = node.type === "checkbox" ? node.checked : node.value;
      if (k === "topic") el.topic2.value = S.topic;
      el.modeHint.textContent = MODE_HINTS[S.mode] || "";
      save();
    });
    upd("mode", el.mode); upd("subject", el.subject, "input"); upd("topic", el.topic, "input"); upd("level", el.level);
    upd("tone", el.tone); upd("length", el.length); upd("lang", el.lang); upd("reveal", el.reveal);
    el.topic2.addEventListener("input", () => { S.topic = el.topic2.value; el.topic.value = S.topic; save(); });
    el.topic2.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); startFromTopic(); } });
  }

  /* ---------- motor: status ---------- */
  const ENGINE_TEXT = { checking: "Conectando…", server: "IA conectada", byok: "IA conectada (sua chave)", local: "Tutor local · sem IA", limited: "IA esgotada" };

  /* quando a IA volta: "às 14:35 (em cerca de 12 min)" */
  function whenBack(resetAt, retryAfter) {
    const secs = Math.max(1, Math.round(Number(retryAfter) || (resetAt ? (new Date(resetAt) - Date.now()) / 1000 : 60)));
    const d = new Date(Date.now() + secs * 1000);
    const hhmm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const sameDay = d.toDateString() === new Date().toDateString();
    const day = sameDay ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " ";
    let rel;
    if (secs < 90) rel = "em cerca de 1 minuto";
    else if (secs < 3600) rel = "em cerca de " + Math.round(secs / 60) + " minutos";
    else { const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60); rel = "em cerca de " + h + " h" + (m ? " " + m + " min" : ""); }
    return { secs, text: (sameDay ? "às " : "em ") + day + hhmm + " (" + rel + ")", short: (sameDay ? "" : day) + hhmm };
  }
  let recheck = null;
  function markLimited(info) {
    const w = whenBack(info && info.resetAt, info && info.retryAfter);
    setEngine("limited", "IA esgotada · volta " + (w.short.length > 5 ? "em " : "às ") + w.short);
    clearTimeout(recheck);
    recheck = setTimeout(detect, Math.min(w.secs * 1000 + 1500, 2147000000));
    return w;
  }
  function setEngine(e, label) {
    st.engine = e;
    el.pill.dataset.engine = e;
    el.pill.querySelector(".pill-text").textContent = label || ENGINE_TEXT[e];
    el.pill.title = e === "local" ? "Toque para conectar uma IA" : "Toque para ver as opções de conexão";
  }
  async function detect() {
    if (store.get(K_API)) return setEngine("byok");
    if (location.protocol === "file:") return setEngine("local");
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 3500);
      const r = await fetch("/api/chat", { signal: c.signal, headers: { accept: "application/json" } });
      clearTimeout(t);
      const j = await r.json();
      if (j && j.ai && j.limited) markLimited(j);
      else setEngine(j && j.ai ? "server" : "local");
    } catch (e) { setEngine("local"); }
  }

  /* ---------- mensagens na tela ---------- */
  const atBottom = () => el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight < 90;
  const toBottom = () => { el.log.scrollTop = el.log.scrollHeight; };

  function tools(m) {
    const bot = m.role === "assistant";
    if (!bot) return "";
    const cards = parseCards(m.content).length;
    const b = (act, label) => `<button type="button" class="mt-btn" data-act="${act}">${label}</button>`;
    return b("copy", "Copiar") + b("sheet", "Salvar na folha") + (window.speechSynthesis ? b("speak", "Ouvir") : "") +
      (cards ? b("cards", `Adicionar ${cards} ${cards === 1 ? "cartão" : "cartões"}`) : "") +
      (m.local ? b("prompt", "Copiar comando p/ outra IA") + b("connect", "Conectar IA") : "");
  }
  function paint(row, m, streaming) {
    const body = row.querySelector(".body");
    if (streaming && !m.content) body.innerHTML = '<span class="typing" aria-label="Digitando"><i></i><i></i><i></i></span>';
    else body.innerHTML = m.role === "user" ? `<p>${esc(m.content).replace(/\n/g, "<br>")}</p>` : md(m.content);
    row.querySelector(".msg-tools").innerHTML = streaming ? "" : tools(m);
  }
  function addRow(m, streaming) {
    const row = document.createElement("div");
    row.className = `msg ${m.role === "user" ? "user" : "bot"}`;
    row.innerHTML = `${m.role === "user" ? "" : '<span class="avatar" aria-hidden="true"></span>'}<div class="bubble"><div class="body"></div><div class="msg-tools"></div></div>`;
    row._m = m;
    el.log.appendChild(row);
    paint(row, m, streaming);
    return row;
  }
  function renderAll() {
    [...el.log.querySelectorAll(".msg")].forEach((n) => n.remove());
    st.msgs.forEach((m) => addRow(m, false));
    el.empty.hidden = st.msgs.length > 0;
    toBottom();
  }
  let raf = 0;
  function schedulePaint(row, m) {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; const stick = atBottom(); paint(row, m, true); if (stick) toBottom(); });
  }
  function setBusy(b) {
    st.busy = b;
    el.send.hidden = b; el.stop.hidden = !b;
    el.input.disabled = false;
    el.log.setAttribute("aria-busy", String(b));
  }

  /* ---------- tutor local (reserva sem IA) ---------- */
  const LOCAL = {
    socratico: [
      "Vamos por partes. Antes de qualquer explicação: o que você já sabe ou imagina sobre **{t}**? Pode ser pouco, é só para eu saber de onde partir.",
      "Isso já é um ponto de partida. Agora tente dar **um exemplo** de {t} que você conheça, do dia a dia ou de um exercício.",
      "E se algo mudasse nesse exemplo, o que você acha que aconteceria? Por que você pensa assim?",
      "Teste Feynman: explique {t} em **duas frases**, como se falasse com um colega que nunca viu o assunto."
    ],
    explicar: [
      "Para explicar {t} do jeito certo, preciso saber seu ponto de partida: você já viu isso na aula ou é a primeira vez?",
      "Pense numa situação do seu dia a dia que lembre {t}. Qual seria? Escreva do seu jeito.",
      "Agora diga qual é a **ideia central** de {t} em uma frase só."
    ],
    exercicio: [
      "Cole aqui o enunciado. Depois, sem calcular nada: quais são os **dados** que o texto fornece e o que ele **pede**?",
      "Que conceito ou fórmula de {t} você acha que se aplica aqui? Se não souber, diga o que já tentou.",
      "Monte o primeiro passo do cálculo e me mostre, mesmo que esteja inseguro."
    ],
    corrigir: [
      "Cole a questão e a sua resolução completa, passo a passo, sem apagar o que você acha que errou.",
      "Releia seu passo 1. Você consegue justificar por que fez essa operação? Escreva o motivo.",
      "Confira os **sinais** e as **unidades** em cada linha. Em qual deles você tem menos certeza?"
    ],
    quiz: [
      "Pergunta 1 sobre {t}: explique com suas palavras o que é, em uma frase. Responda antes de olhar qualquer material.",
      "Pergunta 2: dê um exemplo concreto de {t} e diga por que ele se encaixa.",
      "Pergunta 3: qual erro é mais comum quando alguém estuda {t}? O que você faria para evitá-lo?"
    ],
    feynman: [
      "Explique **{t}** como se estivesse ensinando um colega, sem consultar nada. Pode escrever aqui.",
      "Releia o que escreveu. Qual trecho soou mais vago? É nele que está a sua lacuna.",
      "Tente explicar de novo só essa parte, agora com um exemplo."
    ],
    redacao: [
      "Cole o seu texto. Antes, diga em uma frase qual é a **tese** que você defende sobre {t}.",
      "Releia o texto e marque a frase mais fraca. O que falta nela: um dado, um exemplo ou uma ligação com a anterior?",
      "Reescreva só essa frase por conta própria e me mostre a nova versão."
    ],
    plano: [
      "Para montar o plano de {t}: em quantos dias é a prova ou meta, e quanto tempo por dia você tem?",
      "Liste 3 subtópicos de {t} que você já domina e 3 que não domina.",
      "Comece pelo mais fraco: como você acha que ele se conecta com o que você já sabe?"
    ],
    idioma: [
      "Let's start: tell me, in a short sentence, something about {t}. Escreva no idioma que está praticando.",
      "Good effort. Now add one more sentence, using a connecting word like *because* or *but*.",
      "Try to ask me a question about {t}."
    ]
  };
  const LOCAL_GENERIC = [
    "Boa. Qual parte disso você explicaria com mais segurança? E qual com menos?",
    "O que você responderia se alguém perguntasse **por quê**?",
    "Tente conectar isso com algo que você já aprendeu antes. Qual seria a ligação?"
  ];
  function localText(text) {
    if (/^Sobre o material que carreguei:/i.test(text) && window.EstudaMateriais?.hasMaterial()) {
      return window.EstudaMateriais.localGuide(text);
    }
    const n = st.msgs.filter((m) => m.role === "user").length;
    const t = S.topic || "esse assunto";
    if (/cart(õ|o)es|flashcard/i.test(text)) return "Para **criar cartões automaticamente** eu preciso da IA conectada. Enquanto isso, você pode criar à mão na seção **Cartões** (logo abaixo na página) com o que acabou de estudar.";
    if (/resum/i.test(text)) {
      const mine = st.msgs.filter((m) => m.role === "user").slice(-5).map((m) => "- " + m.content.slice(0, 110));
      return "Pelo que você escreveu até agora:\n" + (mine.join("\n") || "- (ainda nada)") + "\n\nQue tal passar isso para a **folha de resumo** com suas palavras?";
    }
    if (/dica/i.test(text)) return "Uma pista: volte ao que você **já sabe** sobre {t} e procure o ponto exato em que a dúvida aparece. Qual é ele?".replace("{t}", t);
    const pool = LOCAL[S.mode] || LOCAL.socratico;
    const idx = n - 1;
    const line = idx < pool.length ? pool[idx] : LOCAL_GENERIC[(idx - pool.length) % LOCAL_GENERIC.length];
    return line.replace(/\{t\}/g, t);
  }
  async function localReply(bot, row) {
    await new Promise((r) => setTimeout(r, 550));
    const lastUser = [...st.msgs].reverse().find((m) => m.role === "user");
    bot.content = localText(lastUser ? lastUser.content : "");
    if (!st.sawLocalNote) {
      st.sawLocalNote = true;
      bot.local = true;
      bot.content += "\n\n_Estou no modo local, sem IA: faço as perguntas, mas não corrijo de verdade. Para explicações e correções completas, conecte uma IA._";
    }
    paint(row, bot, false);
  }

  /* ---------- motores remotos ---------- */
  const httpErr = (status) => Object.assign(new Error("http " + status), { status });

  async function remoteReply(bot, row) {
    const ctrl = (st.ctrl = new AbortController());
    const history = st.msgs.slice(0, -1).map(({ role, content }) => ({ role, content }));
    // O material não entra no histórico local nem no backup da conversa.
    // Só anexamos trechos em memória quando a pessoa autorizou expressamente.
    if (history.length && history[history.length - 1].role === "user" && window.EstudaMateriais?.hasMaterial()) {
      const last = history[history.length - 1];
      const context = window.EstudaMateriais.contextFor(last.content);
      if (context && /^Sobre o material que carreguei:/i.test(last.content)) last.content += context;
    }
    let r;
    if (st.engine === "byok") {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-api-key": store.get(K_API) || "", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: store.get(K_MODEL) || core.DEFAULT_MODEL, max_tokens: core.maxTokens(S.length), system: core.buildSystem(S), messages: core.cleanMessages(history, 24, 10000), stream: true })
      });
      if (!r.ok) throw httpErr(r.status);
      await core.readAnthropicStream(r, (_, all) => { bot.content = all; schedulePaint(row, bot); }, ctrl.signal);
    } else {
      r = await fetch("/api/chat", { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history, settings: S }) });
      if (!r.ok) {
        let info = null;
        try { info = await r.json(); } catch (e) {}
        throw Object.assign(httpErr(r.status), { info });
      }
      if (st.engine === "limited") setEngine("server");
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bot.content += dec.decode(value, { stream: true });
        schedulePaint(row, bot);
      }
    }
  }

  /* ---------- enviar ---------- */
  async function send(text) {
    text = String(text || "").trim();
    if (!text || st.busy) return;
    if (!S.topic && st.msgs.filter((m) => m.role === "user").length === 0 && text.length <= 90 && !/\n/.test(text)) {
      S.topic = text; el.topic.value = text; el.topic2.value = text;
    }
    el.empty.hidden = true;
    const um = { role: "user", content: text };
    st.msgs.push(um);
    addRow(um, false);
    const bot = { role: "assistant", content: "" };
    st.msgs.push(bot);
    const row = addRow(bot, true);
    toBottom();
    el.input.value = ""; autogrow();
    setBusy(true);

    try {
      if (st.engine === "local" || st.engine === "checking") await localReply(bot, row);
      else await remoteReply(bot, row);
    } catch (e) {
      if (e.name === "AbortError") {
        if (!bot.content) { st.msgs.pop(); st.msgs.pop(); row.remove(); el.log.querySelector(".msg.user:last-of-type") && 0; renderAll(); el.input.value = text; autogrow(); }
      } else {
        const status = e.status || 0;
        if (status === 401 || status === 403) {
          bot.content = "A chave de API foi recusada. Abra **Conectar IA**, confira a chave e tente de novo.";
          bot.local = true;
        } else if (status === 429) {
          const info = e.info || {};
          if (info.error === "exhausted") {
            const w = markLimited(info);
            bot.content = bot.content || ("A IA gratuita chegou ao limite de uso por agora. Ela deve voltar **" + w.text + "**. Enquanto isso, você pode usar o tutor local, os cartões e as anotações.");
          } else if (info.error === "rate_limited") {
            const w = whenBack(info.resetAt, info.retryAfter);
            bot.content = bot.content || ("Você enviou muitas mensagens em pouco tempo. Tente de novo **" + w.text + "**.");
          } else {
            bot.content = bot.content || "Muitas mensagens em pouco tempo. Espere um minuto e tente de novo.";
          }
        } else if (bot.content) {
          bot.content += "\n\n_(a conexão caiu no meio da resposta)_";
        } else {
          setEngine("local");
          st.sawLocalNote = false;
          await localReply(bot, row);
          bot.content = "Não consegui falar com a IA agora, então passei para o **tutor local**.\n\n" + bot.content;
        }
      }
    } finally {
      bot.content = (bot.content || "").trim();
      if (bot.content) paint(row, bot, false);
      else if (st.msgs.includes(bot)) { st.msgs.splice(st.msgs.indexOf(bot), 1); row.remove(); }
      setBusy(false);
      st.ctrl = null;
      save();
      if (atBottom()) toBottom();
      el.input.focus({ preventScroll: true });
    }
  }

  function autogrow() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 170) + "px";
  }

  function newChat(silent) {
    if (st.ctrl) st.ctrl.abort();
    st.msgs = []; st.sawLocalNote = false;
    save(); renderAll(); setBusy(false);
    if (!silent) showToast("Nova conversa.");
  }

  function startFromTopic() {
    const t = (S.topic || "").trim();
    if (!t) { el.topic2.focus(); showToast("Escreva o assunto primeiro."); return; }
    send((STARTERS[S.mode] || STARTERS.socratico)(t));
  }

  /* ---------- ações nas mensagens ---------- */
  el.log.addEventListener("click", (e) => {
    const btn = e.target.closest(".mt-btn");
    if (!btn) return;
    const row = btn.closest(".msg");
    const m = row && row._m;
    if (!m) return;
    const act = btn.dataset.act;
    if (act === "copy") copyText(m.content, "Resposta copiada!");
    else if (act === "sheet") {
      const body = $("noteContentInput"), title = $("noteTopicInput");
      if (!body) return;
      body.value = (body.value ? body.value.trim() + "\n\n" : "") + m.content;
      if (title && !title.value.trim() && S.topic) title.value = S.topic;
      body.dispatchEvent(new Event("input"));
      showToast("Salvo na folha de resumo.");
    } else if (act === "speak") {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(m.content.replace(/[*_`#]/g, ""));
        u.lang = { pt: "pt-BR", en: "en-US", es: "es-ES" }[S.lang] || "pt-BR";
        speechSynthesis.speak(u);
      } catch (err) {}
    } else if (act === "cards") {
      const list = parseCards(m.content);
      if (window.EstudoCards && list.length) window.EstudoCards.addMany(list.map((c) => ({ ...c, tag: S.subject || S.topic || "" })));
    } else if (act === "prompt") {
      const goal = { socratico: "socratico", explicar: "socratico", exercicio: "calculo", corrigir: "erro_conta", quiz: "questoes", feynman: "feynman", redacao: "redacao", plano: "plano", idioma: "socratico" }[S.mode];
      if (window.EstudaIA && window.EstudaIA.sync) {
        window.EstudaIA.sync({ topic: S.topic, subject: S.subject, level: S.level, goal, tone: S.tone });
        copyText(window.EstudaIA.promptText(), "Comando copiado. Cole no ChatGPT, Gemini ou Claude.");
      }
    } else if (act === "connect") openDialog();
  });

  /* ---------- formulário, atalhos e voz ---------- */
  el.form.addEventListener("submit", (e) => { e.preventDefault(); send(el.input.value); });
  el.input.addEventListener("input", autogrow);
  /* celular: placeholder curto (o texto longo, com dica de Enter, não cabe no campo) */
  const phFull = el.input.getAttribute("placeholder") || "";
  const phMq = window.matchMedia("(max-width: 520px)");
  const syncPlaceholder = () => el.input.setAttribute("placeholder", phMq.matches ? "Escreva sua resposta ou dúvida…" : phFull);
  syncPlaceholder();
  if (phMq.addEventListener) phMq.addEventListener("change", syncPlaceholder);

  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(el.input.value); }
  });
  el.stop.addEventListener("click", () => { if (st.ctrl) st.ctrl.abort(); });
  el.newBtn.addEventListener("click", () => { if (st.msgs.length > 1 && !confirm("Começar uma nova conversa? A atual será apagada.")) return; newChat(); });
  el.copyBtn.addEventListener("click", () => {
    if (!st.msgs.length) return showToast("Ainda não há conversa.");
    copyText(st.msgs.map((m) => (m.role === "user" ? "Eu: " : "Tutor: ") + m.content).join("\n\n"), "Conversa copiada!");
  });
  el.quick.addEventListener("click", (e) => {
    const b = e.target.closest("[data-say]");
    if (!b) return;
    if (!st.msgs.length) return showToast("Comece a conversa primeiro.");
    send(b.dataset.say);
  });
  el.startBtn.addEventListener("click", startFromTopic);

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) el.mic.hidden = true;
  else {
    let rec = null, on = false;
    el.mic.addEventListener("click", () => {
      if (on && rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = { pt: "pt-BR", en: "en-US", es: "es-ES" }[S.lang] || "pt-BR";
      rec.interimResults = true;
      const base = el.input.value ? el.input.value.trim() + " " : "";
      rec.onresult = (ev) => { let t = ""; for (const r of ev.results) t += r[0].transcript; el.input.value = base + t; autogrow(); };
      rec.onend = () => { on = false; el.mic.classList.remove("rec"); el.mic.setAttribute("aria-pressed", "false"); };
      rec.onerror = () => { showToast("Não consegui usar o microfone."); };
      on = true; el.mic.classList.add("rec"); el.mic.setAttribute("aria-pressed", "true");
      try { rec.start(); } catch (e) { on = false; el.mic.classList.remove("rec"); }
    });
  }

  /* ---------- janela "Conectar IA" ---------- */
  function openDialog() {
    el.key.value = store.get(K_API) || "";
    el.model.value = store.get(K_MODEL) || core.DEFAULT_MODEL;
    el.dlgMsg.textContent = "";
    if (typeof el.dlg.showModal === "function") el.dlg.showModal(); else el.dlg.setAttribute("open", "");
  }
  el.pill.addEventListener("click", openDialog);
  $("aiClose").addEventListener("click", () => el.dlg.close());
  $("aiSave").addEventListener("click", () => {
    const k = el.key.value.trim();
    if (!/^sk-ant-/.test(k)) { el.dlgMsg.textContent = "A chave da Anthropic começa com sk-ant-. Confira e tente de novo."; return; }
    store.set(K_API, k); store.set(K_MODEL, el.model.value);
    setEngine("byok"); el.dlg.close(); showToast("IA conectada com a sua chave.");
  });
  $("aiRemove").addEventListener("click", () => {
    try { localStorage.removeItem(K_API); localStorage.removeItem(K_MODEL); } catch (e) {}
    el.key.value = ""; setEngine("checking"); detect(); el.dlg.close(); showToast("Chave removida deste aparelho.");
  });

  /* ---------- API usada pelo topo da página e pelo globo ---------- */
  window.EstudoChat = {
    begin(topic, subject) {
      if (typeof subject === "string" && subject) { S.subject = subject; el.subject.value = subject; }
      topic = (topic || "").trim();
      if (topic) {
        if (st.msgs.length > 1 && !confirm(`Já existe uma conversa. Começar uma nova sobre "${topic}"?`)) { scrollToId("tutor"); return; }
        if (st.msgs.length) newChat(true);
        S.topic = topic; el.topic.value = topic; el.topic2.value = topic;
      }
      save(); scrollToId("tutor");
      if (topic) setTimeout(() => startFromTopic(), reduceMotion() ? 50 : 650);
      else setTimeout(() => (S.topic ? el.input : el.topic2).focus({ preventScroll: true }), 600);
    },
    send,
    newChat
  };

  /* ---------- início ---------- */
  el.starters.innerHTML = SUGGESTIONS.map((t) => `<button type="button" class="chip" data-topic="${esc(t)}">${esc(t)}</button>`).join("");
  el.starters.addEventListener("click", (e) => {
    const b = e.target.closest("[data-topic]");
    if (!b) return;
    S.topic = b.dataset.topic; el.topic.value = S.topic; el.topic2.value = S.topic; save(); startFromTopic();
  });

  load();
  syncControls();
  bindControls();
  renderAll();
  setEngine("checking");
  detect();
  setBusy(false);
})();
