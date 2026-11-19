/* =========================================================
   EstudaIA — Globo 3D de matérias (Canvas 2D, sem bibliotecas)
   Esfera de nós com projeção em perspectiva. Arraste para girar;
   toque numa matéria para começar por ela no gerador.
   ========================================================= */
(() => {
  const cv = document.getElementById("globe");
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const SUBJECTS = ["Matemática", "Física", "Química", "Biologia", "História", "Geografia", "Português", "Redação", "Filosofia", "Inglês", "Programação", "Sociologia", "Artes", "Economia"];
  /* cor de cada matéria: [fundo, texto] */
  const COLORS = {
    "Matemática": ["#ef5b3c", "#fff"], "Física": ["#3b6cf6", "#fff"], "Química": ["#14a39a", "#fff"], "Biologia": ["#3fa564", "#fff"],
    "História": ["#f6b93b", "#2a2210"], "Geografia": ["#29a6d6", "#fff"], "Português": ["#f06fa5", "#fff"], "Redação": ["#8b5cf6", "#fff"],
    "Filosofia": ["#b9733e", "#fff"], "Inglês": ["#e2467f", "#fff"], "Programação": ["#2c3e8f", "#fff"], "Sociologia": ["#a3c230", "#1f2a08"],
    "Artes": ["#f08a3c", "#fff"], "Economia": ["#0f8f6a", "#fff"]
  };
  let INK = "31,35,48";
  const readTheme = () => { INK = (getComputedStyle(document.documentElement).getPropertyValue("--ink-rgb") || "31,35,48").trim(); };
  readTheme();
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const FOV = 3.4;

  const fib = (i, n) => {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.399963;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };

  const NODES = [];
  const NB = 110;
  for (let i = 0; i < NB; i++) NODES.push({ p: fib(i, NB), delay: i * 0.007 });
  SUBJECTS.forEach((label, i) => NODES.push({ p: fib(i, SUBJECTS.length), label, delay: 0.2 + i * 0.05 }));

  const EDGES = [];
  for (let i = 0; i < NODES.length; i++) {
    for (let j = i + 1; j < NODES.length; j++) {
      const a = NODES[i].p, b = NODES[j].p;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d < 0.4) EDGES.push([i, j]);
    }
  }

  const RINGS = [0, 1, 2].map((axis) => {
    const pts = [];
    for (let k = 0; k <= 72; k++) {
      const t = (k / 72) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      pts.push(axis === 0 ? [c, s, 0] : axis === 1 ? [0, c, s] : [c, 0, s]);
    }
    return pts;
  });

  let W = 400, dpr = 1;
  let ay = 0.6, ax = 0.32, vy = 0;
  let dragging = false, moved = 0, lx = 0, ly = 0, lt = 0;
  let mx = -1, my = -1, hover = -1;
  let visible = true, raf = 0, last = performance.now();
  /* se a animação de entrada está rodando, o globo só "monta" depois dela */
  let t0 = last;
  let proj = [];

  function resize() {
    W = cv.clientWidth || 400;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(W * dpr);
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

  function rotate(p, k) {
    const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
    const x = p[0] * k * cy + p[2] * k * sy;
    const z0 = -p[0] * k * sy + p[2] * k * cy;
    const y0 = p[1] * k;
    return [x, y0 * cx - z0 * sx, y0 * sx + z0 * cx];
  }

  function toScreen(v) {
    const R = W * (W < 460 ? 0.27 : 0.31); /* telas estreitas: globo um pouco menor para os rótulos não saírem do quadro */
    const s = FOV / (FOV - v[2]);
    return { x: W / 2 + v[0] * s * R, y: W / 2 + v[1] * s * R, z: v[2], s };
  }

  function pick(px, py) {
    let best = -1, bz = -2;
    proj.forEach((q, i) => {
      if (!q.hit || q.z < -0.25) return;
      if (Math.abs(px - q.x) < q.hw && Math.abs(py - q.y) < q.hh && q.z > bz) { best = i; bz = q.z; }
    });
    return best;
  }

  function draw(now) {
    const dt = Math.min(50, now - last);
    last = now;
    if (!dragging) {
      if (!reduce) ay += 0.00032 * dt;
      ay += vy * dt;
      vy *= 0.94;
      ax += (0.32 - ax) * 0.0015 * dt;
    }
    const T = t0 === Infinity ? -10 : (now - t0) / 1000;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, W);

    proj = NODES.map((n) => {
      const a = reduce ? 1 : ease((T - n.delay) / 1.4);
      const q = toScreen(rotate(n.p, 1 + (1 - a) * 2.4));
      q.a = a;
      return q;
    });

    // anéis de referência
    ctx.lineWidth = 1;
    RINGS.forEach((ring) => {
      ctx.beginPath();
      ring.forEach((p, i) => {
        const q = toScreen(rotate(p, 1));
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      });
      ctx.strokeStyle = `rgba(${INK},0.09)`;
      ctx.stroke();
    });

    // conexões
    EDGES.forEach(([i, j]) => {
      const a = proj[i], b = proj[j];
      const depth = clamp(((a.z + b.z) / 2 + 1) / 2, 0, 1);
      const alpha = Math.min(a.a, b.a) * (0.03 + 0.2 * depth * depth);
      ctx.strokeStyle = `rgba(${INK},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    // nós e rótulos, do fundo para a frente
    const order = proj.map((_, i) => i).sort((a, b) => proj[a].z - proj[b].z);
    hover = pick(mx, my);
    cv.style.cursor = hover >= 0 ? "pointer" : dragging ? "grabbing" : "grab";

    order.forEach((i) => {
      const q = proj[i], n = NODES[i];
      const depth = clamp((q.z + 1) / 2, 0, 1);
      q.hit = false;
      if (!n.label) {
        ctx.fillStyle = `rgba(${INK},${(q.a * (0.12 + 0.4 * depth)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, (1 + 1.6 * depth) * (W / 480 + 0.4), 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      const fs = (11 + 5 * depth) * (0.8 + W / 1200);
      ctx.font = `600 ${fs.toFixed(1)}px Figtree, system-ui, sans-serif`;
      const tw = ctx.measureText(n.label).width;
      const w = tw + 16, h = fs + 10;
      q.hw = w / 2; q.hh = h / 2; q.hit = q.a > 0.9;
      const on = hover === i;
      const alpha = q.a * (0.45 + 0.55 * depth);
      const col = COLORS[n.label] || ["#3b6cf6", "#fff"];

      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(q.x - w / 2, q.y - h / 2, w, h, h / 2);
      else ctx.rect(q.x - w / 2, q.y - h / 2, w, h);
      if (on) { ctx.shadowColor = "rgba(0,0,0,.28)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; }
      ctx.fillStyle = on ? `rgb(${INK})` : col[0];
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(${INK},${on ? 1 : 0.5})`;
      ctx.stroke();
      ctx.fillStyle = on ? "#fff" : col[1];
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(n.label, q.x, q.y + 0.5);
      ctx.restore();
    });
  }

  function loop(now) {
    raf = 0;
    if (!visible || document.hidden) return;
    draw(now);
    raf = requestAnimationFrame(loop);
  }
  const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } };

  cv.addEventListener("pointerdown", (e) => {
    dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; lt = e.timeStamp;
    const r = cv.getBoundingClientRect();
    mx = e.clientX - r.left; my = e.clientY - r.top;
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener("pointermove", (e) => {
    const r = cv.getBoundingClientRect();
    mx = e.clientX - r.left; my = e.clientY - r.top;
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    moved += Math.abs(dx) + Math.abs(dy);
    ay += dx * 0.007;
    ax = clamp(ax + dy * 0.005, -1.1, 1.1);
    vy = clamp((dx * 0.007) / Math.max(e.timeStamp - lt, 8), -0.004, 0.004);
    lx = e.clientX; ly = e.clientY; lt = e.timeStamp;
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    if (e.type === "pointerup" && moved < 6) {
      const i = pick(mx, my);
      if (i >= 0 && window.EstudaIA) window.EstudaIA.start("", NODES[i].label);
    }
    if (e.pointerType !== "mouse") { mx = -1; my = -1; }
  };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  cv.addEventListener("pointerleave", () => { if (!dragging) { mx = -1; my = -1; } });

  new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) start(); }).observe(cv);
  document.addEventListener("visibilitychange", () => !document.hidden && start());
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(cv); else window.addEventListener("resize", resize);

  resize();
  start();
})();
