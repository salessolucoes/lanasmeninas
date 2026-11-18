/* Funções compartilhadas entre o cardápio e o painel */
(function () {
  const A = window.APP;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const brl = v => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const digitos = s => String(s || '').replace(/\D/g, '');
  const numBR = v => Number(String(v ?? '').trim().replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0;

  function mascaraTel(v) {
    const d = digitos(v).slice(0, 11);
    if (d.length <= 2) return d ? '(' + d : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  /* ---------- armazenamento local seguro ---------- */
  const mem = {};
  const ls = {
    get(k, padrao = null) { try { const v = localStorage.getItem(k); return v == null ? (k in mem ? mem[k] : padrao) : JSON.parse(v); } catch (e) { return k in mem ? mem[k] : padrao; } },
    set(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} }
  };

  /* ---------- Planilha (Google Apps Script) ---------- */
  async function rpc(acao, args) {
    if (window.DEMO) return window.DEMO.chamar(acao, args);
    const r = await fetch(A.API_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },     // evita a checagem extra (CORS) e deixa mais rápido
      body: JSON.stringify(Object.assign({ acao }, args || {}))
    });
    if (!r.ok) { const e = new Error('Erro ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  function blobParaBase64(blob) {
    return new Promise((ok, falha) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result).split(',')[1]);
      fr.onerror = () => falha(new Error('Não foi possível ler a foto'));
      fr.readAsDataURL(blob);
    });
  }
  async function enviarFoto(pin, blob) {
    const r = await rpc('admin_foto', { pin, base64: await blobParaBase64(blob), mime: blob.type || 'image/jpeg' });
    if (!r.ok) throw new Error(r.erro || 'Falha ao enviar');
    return r.url;
  }
  // Converte link de compartilhamento do Google Drive em link de imagem
  function linkDrive(url) {
    url = String(url || '').trim();
    if (!/drive\.google\.com|docs\.google\.com/.test(url)) return url;
    const m = url.match(/\/d\/([\w-]{20,})/) || url.match(/[?&]id=([\w-]{20,})/);
    return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w900` : url;
  }

  /* ---------- horários ---------- */
  const min = hhmm => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? +m[1] * 60 + +m[2] : null; };
  const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const TURNOS = ['almoco', 'noite'];
  const nomeTurno = (cfg, t) => (cfg.turnos && cfg.turnos[t] && cfg.turnos[t].nome) || (t === 'almoco' ? 'Almoço' : 'Noite');
  const turnoAtivo = (cfg, t) => !!(cfg.turnos && cfg.turnos[t] && cfg.turnos[t].ativo !== false);
  function turnoEm(cfg, m) {
    for (const t of TURNOS) {
      if (!turnoAtivo(cfg, t)) continue;
      const i = min(cfg.turnos[t].inicio), f = min(cfg.turnos[t].fim);
      if (i != null && f != null && m >= i && m < f) return t;
    }
    return null;
  }

  /* ---------- relógio da loja (usa a hora do servidor, não a do celular) ---------- */
  let desvio = 0;
  function acertarRelogio(agoraLoja) {
    const d = new Date(agoraLoja);              // "2026-10-06T12:30:00" = hora local da loja
    if (!isNaN(d)) desvio = d.getTime() - Date.now();
  }
  const agoraLoja = () => new Date(Date.now() + desvio);
  const minutosAgora = () => { const d = agoraLoja(); return d.getHours() * 60 + d.getMinutes(); };
  const hojeISO = () => { const d = agoraLoja(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  /* ---------- avisos ---------- */
  let tt;
  function toast(msg, tipo) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.className = 'show' + (tipo ? ' ' + tipo : '');
    clearTimeout(tt); tt = setTimeout(() => t.className = '', 2800);
  }
  let audio;
  function bip(vezes = 1) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      for (let i = 0; i < vezes; i++) {
        const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + i * 0.35;
        o.type = 'sine'; o.frequency.setValueAtTime(880, t0); o.frequency.setValueAtTime(1175, t0 + 0.12);
        o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        o.start(t0); o.stop(t0 + 0.32);
      }
    } catch (e) {}
  }
  const destravarSom = () => { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) {} };

  /* ---------- reduzir foto antes de enviar ---------- */
  function reduzirImagem(file, max = 1000, q = 0.82) {
    return new Promise((ok, falha) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src);
        c.toBlob(b => b ? ok(b) : falha(new Error('Não foi possível ler a foto')), 'image/jpeg', q);
      };
      img.onerror = () => falha(new Error('Arquivo de imagem inválido'));
      img.src = URL.createObjectURL(file);
    });
  }

  /* ---------- copiar e compartilhar ---------- */
  async function copiar(txt) {
    try { await navigator.clipboard.writeText(txt); return true; }
    catch (e) {
      const i = document.createElement('textarea'); i.value = txt; i.style.position = 'fixed'; i.style.opacity = '0';
      document.body.appendChild(i); i.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (x) {} i.remove(); return ok;
    }
  }
  async function compartilharImagem(blob, nomeArquivo, texto) {
    const file = new File([blob], nomeArquivo, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: texto }); return 'compartilhado'; }
      catch (e) { if (e.name === 'AbortError') return 'cancelado'; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nomeArquivo;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'baixado';
  }

  /* ---------- ARTE DO DIA (gerada no navegador) ---------- */
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const dataExtenso = d => `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`;
  let fontesProntas = null;
  function carregarFontes() {
    if (fontesProntas) return fontesProntas;
    const lista = ['600 60px Montserrat', '700 60px Montserrat', '600 60px Oswald', '700 60px Oswald', '600 60px Caveat'];
    fontesProntas = Promise.race([
      Promise.all(lista.map(f => document.fonts ? document.fonts.load(f).catch(() => null) : null)),
      new Promise(r => setTimeout(r, 2500))
    ]);
    return fontesProntas;
  }
  let logoImg = null;
  function carregarLogo() {
    if (logoImg) return logoImg;
    logoImg = new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = window.DEMO_LOGO || 'img/logo.png'; });
    return logoImg;
  }
  function quebrar(ctx, txt, largura) {
    const palavras = txt.split(/\s+/); const linhas = []; let l = '';
    for (const p of palavras) {
      const t = l ? l + ' ' + p : p;
      if (ctx.measureText(t).width > largura && l) { linhas.push(l); l = p; } else l = t;
    }
    if (l) linhas.push(l);
    return linhas;
  }
  let fotoCache = {};
  function carregarImg(src) {
    if (!src) return Promise.resolve(null);
    if (window.DEMO_FOTOS && window.DEMO_FOTOS[src]) src = window.DEMO_FOTOS[src];
    if (!fotoCache[src]) fotoCache[src] = new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
    return fotoCache[src];
  }
  function cobrir(c, img, x, y, w, h) {           // desenha a foto preenchendo a área (como object-fit: cover)
    const k = Math.max(w / img.width, h / img.height), iw = img.width * k, ih = img.height * k;
    c.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }
  function pilula(c, x, y, w, h, cor) { c.fillStyle = cor; if (c.roundRect) { c.beginPath(); c.roundRect(x, y, w, h, h / 2); c.fill(); } else c.fillRect(x, y, w, h); }
  /* opts: { formato: 'story'|'feed', turno, proteinas:[nomes], precos:[{nome,preco}], acomp, foto, slogan, link, data:Date } */
  /* Arte da lanchonete (Lá Nas Meninas): sem "pratos do dia" — mostra as artes das promoções
     num mural, com a logo, título, data e o link do cardápio. Cores da marca: preto ameixa + rosa. */
  async function desenharArtePromos(canvas, opts) {
    await carregarFontes();
    const story = opts.formato !== 'feed';
    const W = 1080, H = story ? 1920 : 1350;
    canvas.width = W; canvas.height = H;
    const c = canvas.getContext('2d');
    const ROSA = '#ff2d8a', NOITE = '#120a10', OURO = '#ffcf4a', BRANCO = '#fff6fa';
    const [logo, ...artes] = await Promise.all([carregarLogo()].concat(opts.artes.map(a => carregarImg(a.foto))));
    // fundo escuro com brilho rosa
    c.fillStyle = NOITE; c.fillRect(0, 0, W, H);
    const gl = c.createRadialGradient(W / 2, -120, 40, W / 2, -120, H * 0.75);
    gl.addColorStop(0, 'rgba(255,45,138,.55)'); gl.addColorStop(1, 'rgba(255,45,138,0)');
    c.fillStyle = gl; c.fillRect(0, 0, W, H);
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    // logo redonda
    const lw = story ? 250 : 190, ly = story ? 70 : 40;
    if (logo) {
      c.save(); c.beginPath(); c.arc(W / 2, ly + lw / 2, lw / 2 + 8, 0, 7); c.fillStyle = ROSA; c.fill();
      c.beginPath(); c.arc(W / 2, ly + lw / 2, lw / 2, 0, 7); c.clip(); c.drawImage(logo, (W - lw) / 2, ly, lw, lw); c.restore();
    }
    let y = ly + lw + (story ? 120 : 90);
    let ft = story ? 104 : 84; const tt = (opts.titulo || 'PROMOÇÕES DE HOJE').toUpperCase();
    do { c.font = `700 ${ft}px Oswald,sans-serif`; ft -= 2; } while (c.measureText(tt).width > 960 && ft > 40);
    c.fillStyle = BRANCO;
    c.shadowColor = 'rgba(255,45,138,.6)'; c.shadowBlur = 30; c.fillText((opts.titulo || 'PROMOÇÕES DE HOJE').toUpperCase(), W / 2, y); c.shadowBlur = 0;
    y += story ? 30 : 22;
    const d = opts.data || new Date(), dt = dataExtenso(d), dts = dt.charAt(0).toUpperCase() + dt.slice(1);
    c.font = `700 ${story ? 40 : 34}px Montserrat,sans-serif`;
    const dw = c.measureText(dts).width + 64, dh = story ? 68 : 58;
    pilula(c, (W - dw) / 2, y, dw, dh, OURO); c.fillStyle = NOITE; c.fillText(dts, W / 2, y + dh * 0.69);
    y += dh + (story ? 60 : 36);
    // mural das artes (story: 3x2 · feed: 3x1)
    const lista = artes.filter(Boolean).slice(0, story ? 6 : 3);
    const cols = 3, rows = Math.max(1, Math.ceil(lista.length / cols)), gap = story ? 22 : 18, margem = 50;
    const rodape = story ? 250 : 170;
    const areaH = H - rodape - y, cw = (W - margem * 2 - gap * (cols - 1)) / cols;
    const ch = Math.min(cw * 1.5, (areaH - gap * (rows - 1)) / rows), cwr = ch / 1.5;
    const totalW = cwr * Math.min(cols, lista.length) + gap * (Math.min(cols, lista.length) - 1);
    y += Math.max(0, (areaH - (ch * rows + gap * (rows - 1))) / 2);   // centraliza o mural na área livre
    lista.forEach((im, i) => {
      const r = Math.floor(i / cols), k = i % cols, nLinha = Math.min(cols, lista.length - r * cols);
      const lw2 = cwr * nLinha + gap * (nLinha - 1);
      const x = (W - lw2) / 2 + k * (cwr + gap), yy = y + r * (ch + gap);
      c.save(); c.beginPath();
      if (c.roundRect) c.roundRect(x, yy, cwr, ch, 26); else c.rect(x, yy, cwr, ch);
      c.clip(); c.fillStyle = '#000'; c.fillRect(x, yy, cwr, ch); cobrir(c, im, x, yy, cwr, ch); c.restore();
      c.lineWidth = 4; c.strokeStyle = 'rgba(255,45,138,.75)';
      c.beginPath(); if (c.roundRect) c.roundRect(x, yy, cwr, ch, 26); else c.rect(x, yy, cwr, ch); c.stroke();
    });
    void totalW;
    // rodapé
    c.fillStyle = BRANCO; c.font = `600 ${story ? 64 : 52}px Caveat,cursive`;
    c.fillText(opts.slogan || '', W / 2, H - (story ? 140 : 96));
    if (opts.link) {
      const t = 'Peça pelo link: ' + opts.link.replace(/^https?:\/\//, '').replace(/\/$/, '');
      c.font = `700 ${story ? 32 : 28}px Montserrat,sans-serif`;
      const tw = c.measureText(t).width + 56, th = story ? 62 : 54, ty = H - (story ? 108 : 78);
      pilula(c, (W - tw) / 2, ty, tw, th, ROSA); c.fillStyle = '#fff'; c.fillText(t, W / 2, ty + th * 0.68);
    }
    return canvas;
  }
  async function desenharArte(canvas, opts) {
    if (!(opts.proteinas || []).length && (opts.artes || []).length) return desenharArtePromos(canvas, opts);
    await carregarFontes();
    const [logo, foto] = await Promise.all([carregarLogo(), carregarImg(opts.foto)]);
    const story = opts.formato !== 'feed';
    const W = 1080, H = story ? 1920 : 1350, S = story ? 1 : 0.84;
    canvas.width = W; canvas.height = H;
    const c = canvas.getContext('2d');
    const TERRA = '#d6177a', CAFE = '#1c0f17', MOST = '#ffc83d', CREME = '#fff4fa';
    // fundo terracota com textura suave
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#b9562d'); g.addColorStop(1, '#8c3b1c');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // foto no topo, escurecendo para o fundo
    const fh = story ? 760 : 470;
    if (foto) {
      c.save(); cobrir(c, foto, 0, 0, W, fh); c.restore();
      const f = c.createLinearGradient(0, 0, 0, fh);
      f.addColorStop(0, 'rgba(28,15,23,.55)'); f.addColorStop(.55, 'rgba(28,15,23,.25)'); f.addColorStop(1, '#b40f60');
      c.fillStyle = f; c.fillRect(0, 0, W, fh + 2);
    }
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    if (logo) { const lw = story ? 330 : 270, lh = logo.height * lw / logo.width; c.drawImage(logo, (W - lw) / 2, story ? 70 : 40, lw, lh); }
    // título em faixa mostarda (como nos posts)
    let y = fh - (story ? 150 : 110);
    c.font = `700 ${Math.round(104 * S)}px Oswald,sans-serif`;
    const tit = (opts.turno + ' de hoje').toUpperCase();
    c.fillStyle = CREME; c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 18; c.fillText(tit, W / 2, y); c.shadowBlur = 0;
    y += Math.round(30 * S);
    const d = opts.data || new Date(), dt = dataExtenso(d), dts = dt.charAt(0).toUpperCase() + dt.slice(1);
    c.font = `700 ${Math.round(40 * S)}px Montserrat,sans-serif`;
    const dw = c.measureText(dts).width + 64;
    pilula(c, (W - dw) / 2, y, dw, Math.round(68 * S), MOST);
    c.fillStyle = CAFE; c.fillText(dts, W / 2, y + Math.round(47 * S));
    y += Math.round(68 * S) + (story ? 70 : 44);

    // lista de pratos (ajusta o tamanho para caber)
    const nomes = (opts.proteinas || []).length ? opts.proteinas : ['Cardápio em atualização'];
    const rodapeAlt = (opts.precos && opts.precos.length ? (story ? 120 : 96) : 0) + (opts.acomp ? (story ? 90 : 70) : 0) + (story ? 230 : 170);
    const base = H - rodapeAlt;
    let tam = story ? 80 : 66, linhas, alt;
    for (; tam >= 36; tam -= 2) {
      c.font = `600 ${tam}px Oswald,sans-serif`;
      linhas = nomes.map(n => quebrar(c, n.toUpperCase(), 900));
      const n = linhas.reduce((s, l) => s + l.length, 0);
      alt = n * tam * 1.08 + (nomes.length - 1) * tam * 0.42;
      if (alt <= base - y) break;
    }
    let yy = y + Math.max(0, (base - y - alt) / 2) + tam * 0.86;
    linhas.forEach((ls, i) => {
      if (i > 0) { c.fillStyle = MOST; c.beginPath(); c.arc(W / 2, yy - tam * 0.86 - tam * 0.26, 6, 0, 7); c.fill(); }
      c.fillStyle = CREME;
      ls.forEach(l => { c.fillText(l, W / 2, yy); yy += tam * 1.08; });
      yy += tam * 0.42;
    });
    // acompanhamentos
    y = base + (story ? 10 : 6);
    if (opts.acomp) {
      c.font = `600 ${Math.round(34 * S)}px Montserrat,sans-serif`; c.fillStyle = 'rgba(255,244,228,.9)';
      const ls = quebrar(c, 'Acompanha: ' + opts.acomp, 940).slice(0, 2);
      ls.forEach((l, i) => c.fillText(l, W / 2, y + 34 * S + i * 44 * S));
      y += story ? 90 : 70;
    }
    // preços em etiquetas mostarda
    const precos = (opts.precos || []).slice(0, 3);
    if (precos.length) {
      c.font = `700 ${Math.round(42 * S)}px Oswald,sans-serif`;
      const partes = precos.map(p => `${p.nome.toUpperCase()}  ${brl(p.preco).replace(',00', '')}`);
      const larg = partes.map(t => c.measureText(t).width + 56), gap = 24;
      const total = larg.reduce((a, b) => a + b, 0) + gap * (partes.length - 1), k = total > 1000 ? 1000 / total : 1;
      let x = (W - total * k) / 2; const h = Math.round(76 * S);
      partes.forEach((t, i) => {
        const w = larg[i] * k; pilula(c, x, y, w, h, CREME);
        c.fillStyle = TERRA; c.save(); c.translate(x + w / 2, y + h * 0.69); c.scale(k, k); c.fillText(t, 0, 0); c.restore();
        x += w + gap * k;
      });
    }
    // rodapé
    c.fillStyle = CREME; c.font = `600 ${Math.round(60 * S)}px Caveat,cursive`;
    c.fillText(opts.slogan || '', W / 2, H - (story ? 120 : 86));
    if (opts.link) {
      c.fillStyle = MOST; c.font = `700 ${Math.round(30 * S)}px Montserrat,sans-serif`;
      c.fillText('Peça pelo link: ' + opts.link.replace(/^https?:\/\//, '').replace(/\/$/, ''), W / 2, H - (story ? 60 : 38));
    }
    return canvas;
  }
  const canvasParaBlob = cv => new Promise(ok => cv.toBlob(ok, 'image/png'));

  /* ---------- atualização automática (celular com página antiga em cache) ---------- */
  async function checarAtualizacao(ocupado) {
    if (location.protocol === 'file:') return;
    try {
      const url = location.href.split('#')[0];
      const [antigo, novo] = await Promise.all([
        fetch(url, { cache: 'force-cache' }).then(r => r.text()),
        fetch(url, { cache: 'reload' }).then(r => r.ok ? r.text() : null)
      ]);
      if (!novo || antigo === novo || (ocupado && ocupado())) return;
      if (sessionStorage.getItem('recarregou')) return;
      sessionStorage.setItem('recarregou', '1'); location.reload();
    } catch (e) {}
  }

  window.B = { $, $$, brl, esc, norm, digitos, numBR, mascaraTel, ls, rpc, enviarFoto, linkDrive, min, hhmm, TURNOS, nomeTurno, turnoAtivo, turnoEm,
    acertarRelogio, agoraLoja, minutosAgora, hojeISO, toast, bip, destravarSom, reduzirImagem, copiar, compartilharImagem,
    desenharArte, canvasParaBlob, dataExtenso, checarAtualizacao, carregarFontes };
})();
