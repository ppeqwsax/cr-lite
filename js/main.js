'use strict';

/* ============================================================
   界面与主循环：菜单、组牌、下牌交互、HUD、联机接线
   ============================================================ */

(function () {
  const $ = (id) => document.getElementById(id);

  const canvas = $('arena');
  const overlay = $('overlay');
  const handEl = $('hand');
  const elixFill = $('elixirFill');
  const elixNum = $('elixirNum');
  const timerEl = $('timer');
  const phaseEl = $('phaseLabel');
  const crownMe = $('crownMe');
  const crownFoe = $('crownFoe');
  const nameMe = $('nameMe');
  const nameFoe = $('nameFoe');
  const toastEl = $('toast');
  const netStatusEl = $('netStatus');

  const DECK_KEY = 'cr-deck-v1';

  /* AI 牌组：从全部可见卡里随机 8 张，保证至少两张低费，免得一直卡手 */
  function pickAiDeck() {
    const pool = CR.CARDS.filter((c) => !c.hidden && c.cost > 0).map((c) => c.id);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const picked = pool.slice(0, 8);
    const cheap = (id) => CR.CARD_BY_ID[id].cost <= 3;
    if (picked.filter(cheap).length < 2) {
      for (let i = 0; i < pool.length && picked.filter(cheap).length < 2; i++) {
        const cand = pool[i];
        if (!cheap(cand) || picked.indexOf(cand) >= 0) continue;
        for (let k = picked.length - 1; k >= 0; k--) {
          if (!cheap(picked[k])) { picked[k] = cand; break; }
        }
      }
    }
    return picked;
  }

  let screen = 'menu';
  let game = null;
  let bot = null;
  let net = null;
  let deck = loadDeck();
  let selected = -1;
  let cursor = null;
  let mode = 'ai';
  let difficulty = 'normal';
  let handSig = '';
  let toastTimer = 0;
  let clock = 0;
  let lastTime = performance.now();
  let idleView = null;

  /* ---------------- 本地存储 ---------------- */

  function loadDeck() {
    try {
      const raw = localStorage.getItem(DECK_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          const ok = arr.filter((id) => CR.CARD_BY_ID[id]);
          if (ok.length === 8) return ok;
        }
      }
    } catch (e) { /* 忽略损坏的本地配置 */ }
    return CR.DEFAULT_DECK.slice();
  }

  function saveDeck(d) {
    try { localStorage.setItem(DECK_KEY, JSON.stringify(d)); } catch (e) { /* 隐私模式 */ }
  }

  /* ---------------- 小工具 ---------------- */

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    toastTimer = 1.6;
  }

  function fmtTime(sec) {
    const s = Math.max(0, Math.ceil(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function idle() {
    if (!idleView) {
      idleView = {
        towers: CR.TOWERS.map((t) => {
          const st = CR.TOWER_STATS[t.kind];
          return { id: t.id, team: t.team, kind: t.kind, x: t.x, y: t.y, hp: st.hp, maxHp: st.hp, alive: true, flash: 0 };
        }),
        units: [], bolts: [], blasts: []
      };
    }
    return idleView;
  }

  /* ---------------- 菜单 ---------------- */

  function menuHtml() {
    const sel = deck.map((id) => CR.CARD_BY_ID[id]);
    return '' +
      '<div class="panel">' +
      '  <h2 class="panel-title">皇城对决</h2>' +
      '  <p class="panel-sub">8 张牌组 · 双路推塔 · 先拆国王塔者胜</p>' +
      '  <div class="section-label">对战模式</div>' +
      '  <div class="row" id="modeRow">' +
      '    <button class="btn" data-mode="ai">单人 AI</button>' +
      '    <button class="btn" data-mode="online">联机对战</button>' +
      '  </div>' +
      '  <div class="row" id="diffRow">' +
      '    <button class="btn" data-level="easy">简单</button>' +
      '    <button class="btn" data-level="normal">普通</button>' +
      '    <button class="btn" data-level="hard">困难</button>' +
      '  </div>' +
      '  <div id="onlineBox" class="hidden">' +
      '    <div class="section-label">联机房间</div>' +
      '    <div class="row">' +
      '      <input class="room-input" id="roomInput" maxlength="6" placeholder="房间码" autocomplete="off" spellcheck="false">' +
      '      <button class="btn" id="createBtn">创建房间</button>' +
      '      <button class="btn" id="joinBtn">加入</button>' +
      '    </div>' +
      '    <div class="tip" id="onlineTip">创建后把 6 位房间码发给朋友，对方点「加入」即可。</div>' +
      '  </div>' +
      '  <div class="section-label">牌组 <span class="deck-hint" id="deckCount">' + deck.length + '/8</span></div>' +
      '  <div class="deck-grid" id="deckGrid">' +
      CR.CARDS.filter((c) => !c.hidden).map((c) => {
        const on = deck.indexOf(c.id) >= 0;
        return '<div class="deck-card' + (on ? ' on' : '') + '" data-card="' + c.id + '">' +
          '<span class="emoji">' + c.emoji + '</span>' +
          '<span class="cname">' + c.name + '</span>' +
          '<span class="cost">' + c.cost + '</span>' +
          '</div>';
      }).join('') +
      '  </div>' +
      '  <div class="row" style="margin-top:8px">' +
      '    <button class="btn" id="codexBtn">卡牌图鉴 · ' + CR.CARDS.filter((c) => !c.hidden).length + ' 张</button>' +
      '  </div>' +
      '  <div class="row" style="margin-top:12px">' +
      '    <button class="btn primary" id="startBtn"' + (deck.length === 8 ? '' : ' disabled') + '>开始对战</button>' +
      '  </div>' +
      '  <div class="tip">点下方手牌选中，再点自己半场下兵；法术可放全图。<br>圣水上限 10，2.8 秒回 1 点；常规时间最后 60 秒起双倍，打平进 60 秒加时。</div>' +
      '</div>';
  }

  /* ---------------- 卡牌图鉴 ---------------- */

  function statsOf(c) {
    const s = [];
    if (c.kind === 'spell') {
      if (c.spellDmg) s.push('伤害 ' + c.spellDmg);
      s.push('范围 ' + c.spellRadius.toFixed(1) + ' 格');
      if (c.stun) s.push('僵直 ' + c.stun + 's');
    } else {
      if (c.count > 1) s.push('数量 ' + c.count);
      s.push('血量 ' + c.hp);
      if (c.dmg) s.push('伤害 ' + c.dmg);
      if (c.dmg && c.hitSpeed) s.push('攻速 ' + c.hitSpeed + 's');
      if (c.range !== undefined) s.push('射程 ' + c.range.toFixed(2) + ' 格');
      if (c.speed) s.push('移速 ' + c.speed);
      if (c.life) s.push('存活 ' + c.life + 's');
      if (c.splash) s.push('溅射 ' + c.splash + ' 格');
      if (c.targets === 'buildings') s.push('只打建筑');
      if (c.flying) s.push('空中单位');
      if (c.hitsAir === false) s.push('打不到空中');
      if (c.charge) s.push('冲锋翻倍');
      if (c.hitStun) s.push('命中僵直 ' + c.hitStun + 's');
      if (c.splits) s.push('死亡分裂 ×' + (c.splitCount || 2));
      if (c.deathBlast) s.push('死亡爆炸 ' + c.deathBlast.dmg);
      if (c.summon) s.push('每 ' + c.summon.interval + 's 召唤 ' + c.summon.count);
    }
    return s.join(' · ');
  }

  const KIND_LABEL = { troop: '军队', spell: '法术', building: '建筑' };

  function codexCardHtml(c) {
    return '<div class="codex-item">' +
      '<div class="codex-head">' +
      '<span class="codex-emoji">' + c.emoji + '</span>' +
      '<span class="codex-name">' + c.name + '</span>' +
      '<span class="codex-kind">' + (KIND_LABEL[c.kind] || '军队') + '</span>' +
      '<span class="cost">' + c.cost + '</span>' +
      '</div>' +
      '<div class="codex-desc">' + (CR.CARD_DESC[c.id] || '') + '</div>' +
      '<div class="codex-stats">' + statsOf(c) + '</div>' +
      '</div>';
  }

  function showCodex(filter) {
    screen = 'codex';
    const all = CR.CARDS.filter((c) => !c.hidden);
    const list = all.filter((c) => filter === 'all' || c.kind === filter)
      .slice()
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'zh'));
    const chips = [['all', '全部'], ['troop', '军队'], ['spell', '法术'], ['building', '建筑']];
    overlay.innerHTML =
      '<div class="panel codex-panel">' +
      '  <h2 class="panel-title">卡牌图鉴</h2>' +
      '  <p class="panel-sub">共 ' + all.length + ' 张可组牌，牌组取 8 张</p>' +
      '  <div class="chips" id="codexChips">' +
      chips.map(([k, label]) => '<button class="chip' + (filter === k ? ' on' : '') + '" data-kind="' + k + '">' + label + '</button>').join('') +
      '  </div>' +
      '  <div class="codex-list" id="codexList">' + list.map(codexCardHtml).join('') + '</div>' +
      '  <div class="row" style="margin-top:12px">' +
      '    <button class="btn primary" id="codexBack">返回菜单</button>' +
      '  </div>' +
      '</div>';
    overlay.classList.remove('hidden');
    $('codexChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-kind]');
      if (!b) return;
      showCodex(b.dataset.kind);
      overlay.scrollTop = 0;
    });
    $('codexBack').addEventListener('click', showMenu);
    overlay.scrollTop = 0;
  }

  function showMenu() {
    screen = 'menu';
    selected = -1;
    cursor = null;
    if (net) { net.leave(); net = null; }
    game = null;
    bot = null;
    overlay.innerHTML = menuHtml();
    overlay.classList.remove('hidden');
    handEl.innerHTML = '';
    handSig = '';
    netStatusEl.classList.add('hidden');
    nameMe.textContent = '你';
    nameFoe.textContent = '对手';
    bindMenu();
    syncMenu();
    updateHud(idleView);
    drawFrame();
  }

  function syncMenu() {
    const modeRow = $('modeRow');
    if (!modeRow) return;
    Array.prototype.forEach.call(modeRow.children, (b) => {
      b.classList.toggle('on', b.dataset.mode === mode);
    });
    const diffRow = $('diffRow');
    Array.prototype.forEach.call(diffRow.children, (b) => {
      b.classList.toggle('on', b.dataset.level === difficulty);
    });
    diffRow.classList.toggle('hidden', mode !== 'ai');
    $('onlineBox').classList.toggle('hidden', mode !== 'online');
    $('deckCount').textContent = deck.length + '/8';
    $('startBtn').disabled = deck.length !== 8;
    Array.prototype.forEach.call($('deckGrid').children, (el) => {
      el.classList.toggle('on', deck.indexOf(el.dataset.card) >= 0);
    });
  }

  function bindMenu() {
    $('modeRow').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      mode = b.dataset.mode;
      syncMenu();
    });

    $('diffRow').addEventListener('click', (e) => {
      const b = e.target.closest('[data-level]');
      if (!b) return;
      difficulty = b.dataset.level;
      syncMenu();
    });

    $('deckGrid').addEventListener('click', (e) => {
      const el = e.target.closest('[data-card]');
      if (!el) return;
      const id = el.dataset.card;
      const at = deck.indexOf(id);
      if (at >= 0) {
        if (deck.length <= 1) { toast('至少留一张牌'); return; }
        deck.splice(at, 1);
      } else {
        if (deck.length >= 8) { toast('牌组已满 8 张，先取消一张'); return; }
        deck.push(id);
      }
      saveDeck(deck);
      syncMenu();
    });

    $('startBtn').addEventListener('click', () => {
      if (deck.length !== 8) return;
      if (mode === 'online') { toast('先创建或加入房间'); return; }
      startBattle();
    });

    $('codexBtn').addEventListener('click', () => showCodex('all'));

    $('createBtn').addEventListener('click', () => {
      if (deck.length !== 8) { toast('牌组需要 8 张'); return; }
      startOnline('host', null);
    });

    $('joinBtn').addEventListener('click', () => {
      const code = ($('roomInput').value || '').trim().toUpperCase();
      if (code.length < 4) { toast('请输入 6 位房间码'); return; }
      if (deck.length !== 8) { toast('牌组需要 8 张'); return; }
      startOnline('guest', code);
    });
  }

  /* ---------------- 开局 ---------------- */

  function startBattle() {
    game = new Sim.Game([deck.slice(), pickAiDeck()]);
    bot = new AI.Bot(1, difficulty);
    selected = -1;
    screen = 'battle';
    overlay.classList.add('hidden');
    netStatusEl.classList.add('hidden');
    nameMe.textContent = '你';
    nameFoe.textContent = '电脑 (' + ({ easy: '简单', normal: '普通', hard: '困难' }[difficulty]) + ')';
    handSig = '';
    updateHud(game);
    drawFrame();
  }

  function startOnline(role, code) {
    if (typeof NetPlay !== 'function') { toast('联机模块未加载'); return; }
    game = null;
    bot = null;
    selected = -1;
    screen = 'battle';
    overlay.innerHTML = '<div class="panel"><h2 class="panel-title">联机中</h2><p class="panel-sub" id="connSub">正在连接…</p>' +
      '<div class="row"><button class="btn ghost" id="cancelNet">取消</button></div></div>';
    overlay.classList.remove('hidden');
    $('cancelNet').addEventListener('click', () => showMenu());
    handEl.innerHTML = '';
    handSig = '';

    net = new NetPlay({
      deck: deck.slice(),
      onBegin: (payload) => {
        overlay.classList.add('hidden');
        handSig = '';
        selected = -1;
        cursor = null;
        nameMe.textContent = '你';
        nameFoe.textContent = '对手';
        screen = 'battle';
        if (net && net.role === 'host') {
          const foeDeck = (payload && payload.foeDeck) || CR.DEFAULT_DECK.slice();
          game = new Sim.Game([deck.slice(), foeDeck.slice()]);
          net.attach(game);
        } else {
          game = null;
        }
        if (net) {
          netStatusEl.textContent = net.role === 'host' ? '联机 · 房主' : '联机 · 客机';
          netStatusEl.classList.remove('hidden');
        }
        updateHud();
        drawFrame();
      },
      onResult: () => showNetResult(),
      onDeny: (reason) => {
        handSig = '';
        toast(reason || '这张牌现在下不了');
      },
      onLink: (mode, rtt) => {
        if (!net) return;
        const who = net.role === 'host' ? '房主' : '客机';
        const tag = mode === 'direct'
          ? ('直连' + (rtt ? ' · ' + rtt + 'ms' : ''))
          : '中转';
        netStatusEl.textContent = '联机 · ' + who + ' · ' + tag;
      },
      onStatus: (text, kind) => {
        const sub = $('connSub');
        if (sub) sub.textContent = text;
        if (kind === 'room') {
          overlay.innerHTML = '<div class="panel"><h2 class="panel-title">房间已创建</h2>' +
            '<p class="panel-sub">把这串房间码发给朋友</p>' +
            '<div class="room-code">' + text + '</div>' +
            '<div class="row"><button class="btn" id="copyLink">复制邀请链接</button></div>' +
            '<div class="tip">等待对手加入…</div>' +
            '<div class="row" style="margin-top:10px"><button class="btn ghost" id="cancelNet2">取消</button></div></div>';
          $('copyLink').addEventListener('click', () => {
            const url = location.origin + location.pathname + '?room=' + text;
            (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
              () => toast('邀请链接已复制'),
              () => toast(url)
            );
          });
          $('cancelNet2').addEventListener('click', () => showMenu());
        }
      },
      onPeerLeft: () => {
        if (screen === 'battle') { showResult({ winner: net && net.role === 'host' ? 0 : 1, reason: '对手已离开' }); }
      }
    });

    if (role === 'host') net.host();
    else net.join(code);
  }

  /* ---------------- 主循环 ---------------- */

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.05);
    clock += dt;

    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) toastEl.classList.add('hidden');
    }

    if (screen === 'battle' && game) {
      game.update(dt);
      if (bot) bot.update(dt, game);
      if (game.phase === 'over' && overlay.classList.contains('hidden')) showResult(game.result);
    }

    if (screen === 'battle' && net) net.tick(dt, game);

    updateHud();
    updateHand();
    drawFrame();
  }

  /* ---------------- 状态读取（AI / 客机都走这里） ---------------- */

  function myTeam() {
    return (net && net.role === 'guest') ? 1 : 0;
  }

  /* 客机视角翻转 180°，让自己永远在下方（蓝色） */
  function flipped() {
    return !!(net && net.role === 'guest');
  }

  function toWorld(p) {
    if (!flipped()) return p;
    return { x: CR.COLS - p.x, y: CR.ROWS - p.y };
  }

  function source() {
    const t = myTeam();
    if (net && net.role === 'guest' && net.snap) {
      const sn = net.snap;
      return {
        hand: sn.h[t], next: sn.nx[t], elixir: net.predictedElixir(t),
        crownsMe: sn.cr[t], crownsFoe: sn.cr[1 - t],
        time: sn.ph === 'overtime' ? sn.ov : sn.tl, phase: sn.ph
      };
    }
    if (!game) return null;
    const me = game.players[t];
    const foe = game.players[1 - t];
    return {
      hand: me.hand, next: me.next, elixir: me.elixir,
      crownsMe: me.crowns, crownsFoe: foe.crowns,
      time: game.phase === 'overtime' ? game.overtimeLeft : game.timeLeft,
      phase: game.phase
    };
  }

  /* ---------------- HUD / 手牌 ---------------- */

  function updateHud(view) {
    const src = source();
    const isIdle = !src;
    crownMe.textContent = src ? src.crownsMe : 0;
    crownFoe.textContent = src ? src.crownsFoe : 0;

    if (isIdle) {
      timerEl.textContent = '3:00';
      timerEl.classList.remove('warn');
      phaseEl.textContent = '准备中';
      return;
    }

    timerEl.textContent = fmtTime(src.time);
    timerEl.classList.toggle('warn', src.phase === 'overtime' || (src.phase !== 'over' && src.time <= 60));
    if (src.phase === 'overtime') phaseEl.textContent = '加时赛 · 双倍圣水';
    else if (src.phase === 'over') phaseEl.textContent = '对局结束';
    else if (src.time <= 60) phaseEl.textContent = '双倍圣水';
    else phaseEl.textContent = '常规时间';

    const pct = Math.max(0, Math.min(1, src.elixir / CR.ELIXIR_MAX));
    elixFill.style.height = (pct * 100) + '%';
    elixNum.textContent = Math.floor(src.elixir);
  }

  function cardHtml(id, opts) {
    if (!id) return '<div class="card empty"></div>';
    const c = CR.CARD_BY_ID[id];
    if (!c) return '<div class="card empty"></div>';
    const cls = ['card'];
    if (opts && opts.selected) cls.push('on');
    if (opts && opts.poor) cls.push('poor');
    if (opts && opts.next) cls.push('next');
    return '<div class="' + cls.join(' ') + '" data-slot="' + (opts ? opts.slot : '') + '">' +
      '<span class="emoji">' + c.emoji + '</span>' +
      '<span class="cname">' + c.name + '</span>' +
      '<span class="cost">' + c.cost + '</span>' +
      '</div>';
  }

  function updateHand() {
    const src = source();
    const bar = handEl.parentElement;
    if (!src || screen !== 'battle') {
      if (handSig !== 'none') { handEl.innerHTML = ''; handSig = 'none'; }
      bar.style.visibility = screen === 'battle' ? 'visible' : 'hidden';
      return;
    }
    bar.style.visibility = 'visible';
    const sig = src.hand.join(',') + '|' + selected + '|' + Math.floor(src.elixir);
    if (sig !== handSig) {
      handSig = sig;
      handEl.innerHTML = src.hand.map((id, i) => {
        const c = CR.CARD_BY_ID[id];
        return cardHtml(id, { slot: i, selected: selected === i, poor: c && src.elixir < c.cost });
      }).join('');
    }
    elixFill.style.height = (Math.max(0, Math.min(1, src.elixir / CR.ELIXIR_MAX)) * 100) + '%';
    elixNum.textContent = Math.floor(src.elixir);
    timerEl.textContent = fmtTime(src.time);
  }

  handEl.addEventListener('click', (e) => {
    const el = e.target.closest('[data-slot]');
    if (!el) return;
    const i = Number(el.dataset.slot);
    const src = source();
    if (!src) return;
    const card = CR.CARD_BY_ID[src.hand[i]];
    if (!card) return;
    if (selected === i) { selected = -1; return; }
    if (src.elixir < card.cost) { toast('圣水不足（需要 ' + card.cost + '）'); return; }
    selected = i;
    handSig = '';
  });

  /* ---------------- 画布交互 ---------------- */

  function toTile(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * CR.COLS,
      y: ((ev.clientY - rect.top) / rect.height) * CR.ROWS
    };
  }

  canvas.addEventListener('pointermove', (ev) => {
    if (screen !== 'battle') return;
    const t = toWorld(toTile(ev));
    cursor = { x: t.x, y: t.y, ok: false };
    const src = source();
    if (src && selected >= 0) {
      const card = CR.CARD_BY_ID[src.hand[selected]];
      cursor.ok = !!card && (card.kind === 'spell' || CR.canDeployAt(myTeam(), t.x, t.y));
    }
  });

  canvas.addEventListener('pointerleave', () => { cursor = null; });

  canvas.addEventListener('pointerdown', (ev) => {
    if (screen !== 'battle') return;
    const t = toWorld(toTile(ev));
    tryDeploy(t.x, t.y);
  });

  function tryDeploy(x, y) {
    const src = source();
    if (!src) return;
    if (selected < 0) { toast('先点一张手牌'); return; }
    const card = CR.CARD_BY_ID[src.hand[selected]];
    if (!card) return;
    if (src.elixir < card.cost) { toast('圣水不足（需要 ' + card.cost + '）'); return; }
    const team = myTeam();
    if (card.kind !== 'spell' && !CR.canDeployAt(team, x, y)) { toast('只能下在自己半场'); return; }

    if (net && net.role === 'guest') {
      if (net.predictPlay(selected, x, y)) { selected = -1; handSig = ''; }
      return;
    }
    const res = game.play(team, selected, x, y);
    if (res.ok) { selected = -1; handSig = ''; }
    else toast(res.reason || '不能放在这里');
  }

  /* ---------------- 渲染 ---------------- */

  function drawFrame() {
    const guest = !!(net && net.role === 'guest' && net.view);
    const view = guest ? net.view : (game || idle());
    /* 客机画面做了 180° 翻转，鼠标光标（世界坐标）也要跟着翻，否则会出现对称的第二个准星 */
    let cur = null;
    if (screen === 'battle' && cursor) {
      cur = guest ? { x: CR.COLS - cursor.x, y: CR.ROWS - cursor.y, ok: cursor.ok } : cursor;
    }
    Render.draw(canvas, view, {
      time: clock,
      placing: selected >= 0 && screen === 'battle' ? { team: 0 } : null,
      cursor: cur
    });
  }

  /* ---------------- 结算 ---------------- */

  function showResult(result) {
    if (!result) return;
    const me = myTeam();
    const win = result.winner === me;
    const draw = result.winner === -1;
    const cls = draw ? 'draw' : (win ? 'win' : 'lose');
    const title = draw ? '平 局' : (win ? '胜 利' : '失 败');
    const src = source();
    const mine = src ? src.crownsMe : 0;
    const theirs = src ? src.crownsFoe : 0;
    overlay.innerHTML = '<div class="panel">' +
      '<div class="big-result ' + cls + '">' + title + '</div>' +
      '<div class="crown-line">皇冠 ' + mine + ' : ' + theirs + ' · ' + (result.reason || '') + '</div>' +
      '<div class="row"><button class="btn primary" id="againBtn">再来一局</button></div>' +
      '<div class="row"><button class="btn ghost" id="menuBtn">返回主菜单</button></div>' +
      '</div>';
    overlay.classList.remove('hidden');
    selected = -1;
    handSig = '';
    $('againBtn').addEventListener('click', () => {
      if (net) { net.requestRematch(); return; }
      startBattle();
    });
    $('menuBtn').addEventListener('click', () => showMenu());
  }

  function showNetResult() {
    if (!net) return;
    showResult({ winner: net.resultWinner, reason: net.resultReason || '对局结束' });
  }

  /* ---------------- 启动 ---------------- */

  window.__cr = {
    get game() { return game; },
    get net() { return net; },
    showMenu: showMenu,
    startBattle: startBattle,
    startOnline: startOnline,
    setDeck: (d) => { deck = d.slice(); saveDeck(deck); }
  };

  const q = new URLSearchParams(location.search);
  if (q.get('room')) {
    mode = 'online';
    setTimeout(() => startOnline('guest', q.get('room').toUpperCase()), 60);
  } else if (q.get('autostart') === 'ai') {
    if (q.get('level')) difficulty = q.get('level');
    setTimeout(startBattle, 60);
  } else if (q.get('autostart') === 'host') {
    setTimeout(() => startOnline('host', null), 60);
  }

  showMenu();
  requestAnimationFrame(frame);
})();
