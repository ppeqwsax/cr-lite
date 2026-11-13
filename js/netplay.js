'use strict';

/* ============================================================
   联机：房间码 → Supabase 广播频道
   房主权威：房主跑整局模拟，12Hz 下发快照；客机只上传下牌指令，
   渲染时在最近两个快照之间做插值（延迟 100ms 缓冲）
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
    this.buf = [];
    this.view = null;
    this.resultWinner = null;
    this.resultReason = '';
    this.sendTimer = 0;
    this.overSent = false;
    this.hiTimer = 0;
    this.now = 0;
    this.lastRecv = 0;
    this.leftFired = false;
    this.SNAP_HZ = 12;
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
      this.client.emit('start', { deck: this.deck });
      this.status('已重新连接', 'ok');
    }
  }

  sendHi() {
    if (this.client) this.client.emit('hi', { deck: this.deck });
  }

  /* ---------------- 消息 ---------------- */

  onMsg(e, d) {
    if (this.role === 'host') {
      if (e === 'hi') {
        this.foeDeck = (d && d.deck) || CR.DEFAULT_DECK.slice();
        if (!this.started) {
          this.started = true;
          this.status('对手已加入，开局！', 'ok');
          if (this.cb.onBegin) this.cb.onBegin({ foeDeck: this.foeDeck });
        } else if (this.client) {
          this.client.emit('start', { deck: this.deck });
        }
      } else if (e === 'play') {
        if (this.gameRef && d) this.gameRef.play(1, d.i | 0, d.x, d.y);
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
      this.status('对局开始', 'ok');
      if (this.cb.onBegin) this.cb.onBegin({});
    } else if (e === 'snap') {
      this.lastRecv = this.now;
      this.buf.push({ t: this.now, d: d });
      if (this.buf.length > 6) this.buf.shift();
      this.snap = d;
      if (!this.started) { this.started = true; if (this.cb.onBegin) this.cb.onBegin({}); }
    } else if (e === 'over') {
      this.resultWinner = d ? d.winner : -1;
      this.resultReason = (d && d.reason) || '对局结束';
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
    if (this.role === 'host' && this.client) {
      this.client.emit('start', { deck: this.deck });
    }
  }

  tick(dt, game) {
    this.now += dt;

    if (this.role === 'host') {
      const g = this.gameRef || game;
      if (!g) return;
      this.sendTimer -= dt;
      if (this.sendTimer <= 0) {
        this.sendTimer = 1 / this.SNAP_HZ;
        if (this.client) this.client.emit('snap', g.snapshot());
      }
      if (g.phase === 'over' && !this.overSent) {
        this.overSent = true;
        if (this.client) {
          this.client.emit('over', { winner: g.result.winner, reason: g.result.reason });
        }
      }
      return;
    }

    if (this.role === 'guest') {
      this.view = this.buildView();
      if (this.started && this.lastRecv && this.now - this.lastRecv > 8 && !this.leftFired) {
        this.peerLeft();
      }
    }
  }

  /* ---------------- 客机：插值出视图 ---------------- */

  buildView() {
    if (!this.buf.length) return null;
    const t = this.now - 0.1;
    let a = this.buf[0];
    let b = this.buf[this.buf.length - 1];
    for (let i = 0; i < this.buf.length; i++) {
      if (this.buf[i].t <= t) a = this.buf[i];
      else { b = this.buf[i]; break; }
    }
    let alpha = 1;
    if (b && b !== a && b.t > a.t) alpha = CR.clamp((t - a.t) / (b.t - a.t), 0, 1);

    const sa = a.d;
    const sb = b ? b.d : sa;
    const minId = new Map();

    (sb.u || []).forEach((u) => { minId.set(u[0], u); });
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
      }
      const card = CR.CARD_BY_ID[u[2]];
      if (!card) return;
      units.push({
        id: id, team: u[1], card: u[2], x: x, y: y,
        hp: hp, maxHp: card.hp, radius: card.radius, flash: 0
      });
    });

    const hpMap = {};
    (sb.tw || []).forEach((row) => { hpMap[row[0]] = row[1]; });
    const flip = this.role === 'guest';
    const fx = (v) => (flip ? CR.COLS - v : v);
    const fy = (v) => (flip ? CR.ROWS - v : v);
    const ft = (v) => (flip ? 1 - v : v);

    const towers = CR.TOWERS.map((t2) => {
      const st = CR.TOWER_STATS[t2.kind];
      const hp = hpMap[t2.id] !== undefined ? hpMap[t2.id] : st.hp;
      return {
        id: t2.id, team: ft(t2.team), kind: t2.kind, x: fx(t2.x), y: fy(t2.y),
        hp: hp, maxHp: st.hp, alive: hp > 0, active: true, flash: 0
      };
    });

    units.forEach((u) => { u.x = fx(u.x); u.y = fy(u.y); u.team = ft(u.team); });

    return { towers: towers, units: units, bolts: [], blasts: [] };
  }

  /* ---------------- 客机：指令 ---------------- */

  requestPlay(slot, x, y) {
    if (this.client) this.client.emit('play', { i: slot, x: x, y: y });
  }

  requestRematch() {
    if (this.role === 'host') {
      if (this.cb.onBegin) this.cb.onBegin({ foeDeck: this.foeDeck });
    } else if (this.client) {
      this.client.emit('again', {});
    }
  }

  leave() {
    clearInterval(this.hiTimer);
    if (this.client) {
      try { this.client.emit('bye', {}); } catch (e) { /* ignore */ }
      this.client.close();
      this.client = null;
    }
    this.role = null;
    this.started = false;
    this.buf = [];
    this.snap = null;
    this.view = null;
    this.gameRef = null;
    this.leftFired = false;
  }
}
