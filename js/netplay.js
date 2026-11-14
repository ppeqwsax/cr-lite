'use strict';

/* ============================================================
   联机：房间码 → Supabase 广播频道
   房主权威：房主跑整局模拟，20Hz 下发快照；客机只上传下牌指令。

   客机降低延迟的三招（都是免费的本机/协议优化）：
   1) 本地预测：点牌瞬间扣圣水 + 画一个半透明“影子兵”，等快照确认后无缝换成真实单位；
   2) 自适应插值：按实际到包间隔动态调整缓冲（45–120ms），掉包时沿最近速度外推；
   3) 圣水/计时本地外推：不用等下一帧快照，进度条不再一跳一跳。
   ============================================================ */

class NetPlay {
  constructor(opts) {
    const o = opts || {};
    this.cb = o;
    this.deck = (o.deck || CR.DEFAULT_DECK).slice();
    this.role = null;
    this.room = '';
    this.client = null;
    this.started = false;
    this.gameRef = null;
    this.foeDeck = null;
    this.snap = null;
    this.snapAt = 0;
    this.buf = [];
    this.view = null;
    this.resultWinner = null;
    this.resultReason = '';
    this.sendTimer = 0;
    this.overSent = false;
    this.hiTimer = 0;
    this.now = 0;
    this.lastRecv = 0;
    this.lastArrive = 0;
    this.gaps = [];
    this.delay = 0.07;
    this.leftFired = false;
    this.SNAP_HZ = 20;

    /* 客机本地预测 */
    this.pending = [];   // {card, x, y, t, kind, radius, color}
    this.biasLog = [];   // {cost, t}
    this.fx = [];        // 正在播放的特效

    /* 房主发送特效去重 */
    this.fxSent = typeof WeakSet === 'function' ? new WeakSet() : null;
    this.fxId = 1;

    /* P2P 直连（失败自动退回中转） */
    this.p2p = null;
    this.linkMode = 'relay';
    this.linkRtt = 0;
    this.linkTimer = 0;
  }

  /* 统一发包：P2P 通了走直连，否则走 Supabase 中转 */
  send(e, d) {
    if (this.p2p && this.p2p.send(e, d)) return;
    if (this.client) this.client.emit(e, d);
  }

  beginP2P(isHost) {
    if (typeof P2P !== 'function' || this.p2p) return;
    const self = this;
    this.p2p = new P2P({
      sendSignal: function (msg) { if (self.client) self.client.emit('sig', msg); },
      onMessage: function (e, d) { self.onMsg(e, d); },
      onState: function (mode) {
        self.linkMode = mode;
        self.reportLink();
      }
    });
    this.p2p.start(isHost);
    clearInterval(this.linkTimer);
    this.linkTimer = setInterval(function () { self.reportLink(); }, 1000);
  }

  reportLink() {
    if (this.p2p && this.p2p.ready) this.linkRtt = Math.round(this.p2p.rtt || 0);
    if (this.cb.onLink) this.cb.onLink(this.linkMode, this.linkRtt);
  }

  /* ---------------- 房间 ---------------- */

  static randomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  channel() {
    const prefix = (window.CR_NET && window.CR_NET.channelPrefix) || 'cr';
    return prefix + '-' + this.room;
  }

  status(text, kind) {
    if (this.cb.onStatus) this.cb.onStatus(text, kind);
  }

  host() {
    this.role = 'host';
    this.room = NetPlay.randomCode();
    this.connect();
    this.status(this.room, 'room');
  }

  join(code) {
    this.role = 'guest';
    this.room = String(code || '').toUpperCase().trim();
    this.connect();
    this.status('正在加入房间 ' + this.room + ' …', 'waiting');
  }

  connect() {
    const self = this;
    this.client = new RealtimeClient(this.channel(), {
      onEvent: function (e, d) { self.onMsg(e, d); },
      onStatus: function (s) {
        if (s === 'online') { self.onOnline(); return; }
        if (s === 'denied') self.status('频道被拒绝，请重新建房间');
        else if (s === 'reconnecting') self.status('网络重连中…');
        else if (s === 'config') self.status('联机配置缺失');
      }
    });
    this.client.connect();
  }

  onOnline() {
    const self = this;
    if (this.role === 'guest') {
      this.sendHi();
      clearInterval(this.hiTimer);
      this.hiTimer = setInterval(function () {
        if (self.started) { clearInterval(self.hiTimer); return; }
        self.sendHi();
      }, 900);
      this.status('已连接，等待房主开始…', 'waiting');
    } else if (this.started && this.gameRef) {
      this.send('start', { deck: this.deck });
      this.status('已重新连接', 'ok');
    }
  }

  sendHi() {
    if (this.client) this.send('hi', { deck: this.deck });
  }

  /* ---------------- 消息 ---------------- */

  onMsg(e, d) {
    if (e === 'sig') {
      if (this.p2p) this.p2p.onSignal(d);
      return;
    }
    if (this.role === 'host') {
      if (e === 'hi') {
        this.foeDeck = (d && d.deck) || CR.DEFAULT_DECK.slice();
        if (!this.started) {
          this.started = true;
          this.status('对手已加入，开局！', 'ok');
          if (this.cb.onBegin) this.cb.onBegin({ foeDeck: this.foeDeck });
          this.beginP2P(true);
        } else if (this.client) {
          this.send('start', { deck: this.deck });
        }
      } else if (e === 'play') {
        if (!this.gameRef || !d) return;
        const res = this.gameRef.play(1, d.i | 0, d.x, d.y);
        if (!res || !res.ok) {
          if (this.client) this.send('deny', { i: d.i | 0, reason: (res && res.reason) || '这张牌现在下不了' });
        }
      } else if (e === 'again') {
        if (this.cb.onBegin) this.cb.onBegin({ foeDeck: this.foeDeck });
      } else if (e === 'bye') {
        this.peerLeft();
      }
      return;
    }

    if (this.role !== 'guest') return;

    if (e === 'start') {
      this.started = true;
      clearInterval(this.hiTimer);
      this.overSent = false;
      this.resultWinner = null;
      this.buf = [];
      this.snap = null;
      this.pending = [];
      this.biasLog = [];
      this.fx = [];
      this.gaps = [];
      this.status('对局开始', 'ok');
      if (this.cb.onBegin) this.cb.onBegin({});
      this.beginP2P(false);
    } else if (e === 'snap') {
      if (!d) return;
      const now = this.now;
      const lastS = this.buf.length ? this.buf[this.buf.length - 1] : null;
      const sameBurst = lastS && now - lastS.arrive < 0.012;

      if (!sameBurst && this.lastArrive) {
        /* 只统计成批之后的真实到包间隔（中转会一次吐好几条） */
        const gap = now - this.lastArrive;
        if (gap > 0.02 && gap < 0.6) {
          this.gaps.push(gap);
          if (this.gaps.length > 14) this.gaps.shift();
        }
      }
      this.lastArrive = now;
      this.lastRecv = now;
      this.snapAt = now;
      this.snap = d;

      /* 同一批里只留最新一条：突发到达不会把插值时间线挤成一坨 */
      if (sameBurst) { lastS.t = now; lastS.d = d; lastS.arrive = now; }
      else { this.buf.push({ t: now, d: d, arrive: now }); }
      while (this.buf.length > 10) this.buf.shift();

      /* 自适应缓冲：缓冲要盖住最大的到包间隔，否则播放时钟会跑到最新快照前面 */
      if (this.gaps.length >= 2) {
        const max = Math.max.apply(null, this.gaps);
        this.delay = CR.clamp(max * 1.05 + 0.03, 0.06, 0.30);
      }

      if (d.fx && d.fx.length) {
        for (let i = 0; i < d.fx.length; i++) {
          const f = d.fx[i];
          this.fx.push({ x: f[1], y: f[2], r: f[3], dur: f[4] || 0.4, color: f[5], t: 0 });
        }
        if (this.fx.length > 24) this.fx.splice(0, this.fx.length - 24);
      }

      if (!this.started) { this.started = true; if (this.cb.onBegin) this.cb.onBegin({}); }
    } else if (e === 'deny') {
      if (this.biasLog.length) this.biasLog.shift();
      if (this.pending.length) this.pending.shift();
      if (this.cb.onDeny) this.cb.onDeny((d && d.reason) || '房主判定这张牌下不了');
    } else if (e === 'over') {
      this.resultWinner = d ? d.winner : -1;
      this.resultReason = (d && d.reason) || '对局结束';
      if (d && d.cr && this.snap) this.snap.cr = d.cr;
      if (this.cb.onResult) this.cb.onResult();
    } else if (e === 'bye') {
      this.peerLeft();
    }
  }

  peerLeft() {
    if (this.leftFired) return;
    this.leftFired = true;
    if (this.cb.onPeerLeft) this.cb.onPeerLeft();
  }

  /* ---------------- 主机：下发 ---------------- */

  attach(game) {
    this.gameRef = game;
    this.overSent = false;
    this.fxSent = typeof WeakSet === 'function' ? new WeakSet() : null;
    if (this.role === 'host' && this.client) {
      this.send('start', { deck: this.deck });
    }
  }

  /* 把这一帧新产生的特效抽出来随快照一起发，客机也能看到爆炸/法术 */
  buildSnapshot(g) {
    const s = g.snapshot();
    const blasts = g.blasts || [];
    const fx = [];
    for (let i = 0; i < blasts.length; i++) {
      const b = blasts[i];
      if (this.fxSent && this.fxSent.has(b)) continue;
      if (b.t > 0.12) continue;
      if (this.fxSent) this.fxSent.add(b);
      fx.push([this.fxId++, b.x, b.y, b.r, b.dur, b.color]);
    }
    if (fx.length) s.fx = fx;
    return s;
  }

  tick(dt, game) {
    this.now += dt;

    if (this.role === 'host') {
      const g = this.gameRef || game;
      if (!g) return;
      this.sendTimer -= dt;
      if (this.sendTimer <= 0) {
        this.sendTimer = 1 / this.SNAP_HZ;
        if (this.client) this.send('snap', this.buildSnapshot(g));
      }
      if (g.phase === 'over' && !this.overSent) {
        this.overSent = true;
        if (this.client) {
          this.send('over', {
            winner: g.result.winner,
            reason: g.result.reason,
            cr: g.players.map((p) => p.crowns)
          });
        }
      }
      return;
    }

    if (this.role === 'guest') {
      this.tickFx(dt);
      this.view = this.buildView();
      if (this.started && this.lastRecv && this.now - this.lastRecv > 8 && !this.leftFired) {
        this.peerLeft();
      }
    }
  }

  tickFx(dt) {
    if (!this.fx.length) return;
    const keep = [];
    for (let i = 0; i < this.fx.length; i++) {
      const f = this.fx[i];
      f.t += dt;
      if (f.t < f.dur) keep.push(f);
    }
    this.fx = keep;
  }

  /* ---------------- 客机：本地预测 ---------------- */

  predictedElixir(team) {
    const sn = this.snap;
    if (!sn) return 5;
    const rate = (sn.ph === 'overtime' || sn.tl <= 60) ? 2 : 1;
    const dt = Math.max(0, this.now - this.snapAt);
    let v = sn.e[team] + dt / CR.ELIXIR_PERIOD * rate;
    if (team === 1 && this.biasLog.length) {
      const now = this.now;
      this.biasLog = this.biasLog.filter((b) => now - b.t < 0.7);
      v -= this.biasLog.reduce((s, b) => s + b.cost, 0);
    }
    return CR.clamp(v, 0, CR.ELIXIR_MAX);
  }

  /* 客机点牌：立刻扣圣水、画影子兵，不等房主回包 */
  predictPlay(slot, x, y) {
    const sn = this.snap;
    if (!sn || !this.client) return false;
    const hand = sn.h[1] || [];
    const card = CR.CARD_BY_ID[hand[slot]];
    if (!card) return false;
    if (this.predictedElixir(1) < card.cost) {
      if (this.cb.onDeny) this.cb.onDeny('圣水不足（需要 ' + card.cost + '）');
      return false;
    }
    this.biasLog.push({ cost: card.cost, t: this.now });
    this.pending.push({
      card: card.id, x: x, y: y, t: this.now, slot: slot,
      kind: card.kind, radius: card.spellRadius || card.radius || 0.5,
      color: card.color || '#ffd166'
    });
    if (this.pending.length > 6) this.pending.shift();
    this.send('play', { i: slot, x: x, y: y });
    return true;
  }

  pendingSpend() {
    return this.pending.length;
  }

  /* ---------------- 客机：插值出视图 ---------------- */

  buildView() {
    if (!this.buf.length) return null;

    const t = this.now - this.delay;
    let a = this.buf[0];
    let b = this.buf[this.buf.length - 1];
    let ai = 0;
    for (let i = 0; i < this.buf.length; i++) {
      if (this.buf[i].t <= t) { a = this.buf[i]; ai = i; }
      else { b = this.buf[i]; break; }
    }
    let alpha = 1;
    let extrap = 0;
    if (b !== a && b.t > a.t) {
      alpha = CR.clamp((t - a.t) / (b.t - a.t), 0, 1);
    } else if (t > a.t && ai > 0) {
      /* 快照断档：沿最近速度继续外推（最多 0.3s），宁可略过冲也不冻住 */
      const prev = this.buf[ai - 1];
      const gap = Math.max(0.016, a.t - prev.t);
      extrap = Math.min(0.30, t - a.t) / gap;
    }

    const sa = a.d;
    const sb = b ? b.d : sa;
    const prevD = ai > 0 ? this.buf[ai - 1].d : null;
    const minId = new Map();
    (sb.u || []).forEach((u) => { minId.set(u[0], u); });
    const prevId = new Map();
    if (prevD && prevD.u) prevD.u.forEach((u) => { prevId.set(u[0], u); });

    const seenCard = {};
    const units = [];
    (sa.u || []).forEach((u) => {
      const id = u[0];
      const other = minId.get(id);
      let x = u[3];
      let y = u[4];
      let hp = u[5];
      if (other) {
        x = x + (other[3] - x) * alpha;
        y = y + (other[4] - y) * alpha;
        hp = other[5];
      } else if (extrap > 0) {
        const p = prevId.get(id);
        if (p) { x = x + (u[3] - p[3]) * extrap; y = y + (u[4] - p[4]) * extrap; }
      }
      const card = CR.CARD_BY_ID[u[2]];
      if (!card) return;
      const key = u[1] + '|' + u[2];
      seenCard[key] = true;
      units.push({
        id: id, team: u[1], card: u[2], x: x, y: y,
        hp: hp, maxHp: card.hp, radius: card.radius, flash: 0, flying: !!card.flying
      });
    });

    /* 本地预测：房主快照里出现了这张牌 → 影子换成真单位，否则继续显示（最多 1.2s） */
    const stillPending = [];
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      const age = this.now - p.t;
      const matched = units.some((u) => u.team === 1 && u.card === p.card &&
        Math.abs(u.x - p.x) < 1.6 && Math.abs(u.y - p.y) < 1.6);
      if (matched || age > 1.2) continue;
      stillPending.push(p);
      if (p.kind === 'spell') {
        this.fx.push({ x: p.x, y: p.y, r: p.radius, dur: 0.45, color: p.color, t: 0 });
        continue;
      }
      const card = CR.CARD_BY_ID[p.card];
      units.push({
        id: 'ghost' + i, team: 1, card: p.card, x: p.x, y: p.y,
        hp: card.hp, maxHp: card.hp, radius: card.radius, flash: 0, ghost: true, flying: !!card.flying
      });
    }
    this.pending = stillPending;

    const hpMap = {};
    (sb.tw || []).forEach((row) => { hpMap[row[0]] = row[1]; });
    const flip = this.role === 'guest';
    const fx = (v) => (flip ? CR.COLS - v : v);
    const fy = (v) => (flip ? CR.ROWS - v : v);
    const ft = (v) => (flip ? 1 - v : v);

    const towers = CR.TOWERS.map((t2) => {
      const st = CR.TOWER_STATS[t2.kind];
      /* 快照里有塔就按快照走（缺失=已被拆掉）；老快照没 tw 字段才退回避 */
      const known = sb.tw && sb.tw.length;
      const hp = hpMap[t2.id] !== undefined ? hpMap[t2.id] : (known ? 0 : st.hp);
      return {
        id: t2.id, team: ft(t2.team), kind: t2.kind, x: fx(t2.x), y: fy(t2.y),
        hp: hp, maxHp: st.hp, alive: hp > 0, active: true, flash: 0
      };
    });

    units.forEach((u) => { u.x = fx(u.x); u.y = fy(u.y); u.team = ft(u.team); });
    const blasts = this.fx.map((f) => ({
      x: fx(f.x), y: fy(f.y), r: f.r, t: f.t, dur: f.dur, color: f.color
    }));

    return { towers: towers, units: units, bolts: [], blasts: blasts };
  }

  /* ---------------- 客机：指令 ---------------- */

  requestPlay(slot, x, y) {
    if (this.client) this.send('play', { i: slot, x: x, y: y });
  }

  requestRematch() {
    if (this.role === 'host') {
      if (this.cb.onBegin) this.cb.onBegin({ foeDeck: this.foeDeck });
    } else if (this.client) {
      this.send('again', {});
    }
  }

  leave() {
    clearInterval(this.hiTimer);
    clearInterval(this.linkTimer);
    if (this.p2p) { try { this.p2p.close(); } catch (e) { /* ignore */ } this.p2p = null; }
    this.linkMode = 'relay';
    if (this.client) {
      try { this.send('bye', {}); } catch (e) { /* ignore */ }
      this.client.close();
      this.client = null;
    }
    this.role = null;
    this.started = false;
    this.buf = [];
    this.snap = null;
    this.view = null;
    this.gameRef = null;
    this.pending = [];
    this.biasLog = [];
    this.fx = [];
    this.leftFired = false;
  }
}

