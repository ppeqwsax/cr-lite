'use strict';

/* ============================================================
   P2P 直连（WebRTC DataChannel）
   目的：把「客机 → 房主 → 客机」的一来一回从云中转（亚洲节点
   往返 250–400ms）换成浏览器之间直连（同城常常 10–60ms）。
   信令仍然走 Supabase 广播（零成本），连不上就自动退回中转，
   所以最差情况和现在一样，不会更糟。

   两条通道：
   - ctrl：可靠有序，走 start/play/deny/over 这类关键消息；
   - game：不可靠不保序，只走 snap 快照，丢了就丢，下一秒还有新的。
   ============================================================ */

class P2P {
  constructor(opts) {
    const o = opts || {};
    this.sendSignal = o.sendSignal || function () {};
    this.onMessage = o.onMessage || function () {};
    this.onState = o.onState || function () {};
    this.pc = null;
    this.ctrl = null;
    this.game = null;
    this.ready = false;
    this.rtt = 0;
    this.pingTimer = 0;
  }

  static iceServers() {
    /* 多个 STUN：Cloudflare 各地一般可达，小米 / Google 做补充 */
    return [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.miwifi.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' }
    ];
  }

  start(isHost) {
    if (typeof RTCPeerConnection !== 'function') {
      this.onState('relay');
      return;
    }
    const self = this;
    const pc = new RTCPeerConnection({ iceServers: P2P.iceServers() });
    this.pc = pc;

    pc.onicecandidate = function (ev) {
      if (ev.candidate) self.sendSignal({ t: 'ice', s: ev.candidate.toJSON() });
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        if (self.ready) { self.ready = false; self.onState('relay'); }
      }
    };

    if (isHost) {
      this.setupCtrl(pc.createDataChannel('cr-ctrl', { ordered: true }));
      this.setupGame(pc.createDataChannel('cr-game', { ordered: false, maxRetransmits: 0 }));
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => self.sendSignal({ t: 'offer', s: pc.localDescription }))
        .catch(() => self.onState('relay'));
    } else {
      pc.ondatachannel = function (ev) {
        if (ev.channel.label === 'cr-ctrl') self.setupCtrl(ev.channel);
        else self.setupGame(ev.channel);
      };
    }
  }

  setupCtrl(dc) {
    const self = this;
    this.ctrl = dc;
    dc.onopen = function () {
      self.ready = true;
      self.onState('direct');
      self.startPing();
    };
    dc.onclose = function () {
      if (self.ready) { self.ready = false; self.onState('relay'); }
    };
    dc.onmessage = function (ev) {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || !m.e) return;
      if (m.e === 'pong') { self.rtt = Math.max(0, performance.now() - m.t); return; }
      if (m.e === 'ping') {
        try { dc.send(JSON.stringify({ e: 'pong', t: m.t })); } catch (e2) { /* ignore */ }
        return;
      }
      self.onMessage(m.e, m.d);
    };
  }

  setupGame(dc) {
    const self = this;
    this.game = dc;
    dc.onmessage = function (ev) {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || !m.e) return;
      self.onMessage(m.e, m.d);
    };
  }

  startPing() {
    const self = this;
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(function () {
      if (!self.ready || !self.ctrl || self.ctrl.readyState !== 'open') return;
      try { self.ctrl.send(JSON.stringify({ e: 'ping', t: performance.now() })); } catch (e) { /* ignore */ }
    }, 2000);
  }

  onSignal(msg) {
    const pc = this.pc;
    if (!pc || !msg || !msg.t) return;
    const self = this;
    try {
      if (msg.t === 'offer') {
        pc.setRemoteDescription(msg.s)
          .then(() => pc.createAnswer())
          .then((a) => pc.setLocalDescription(a))
          .then(() => self.sendSignal({ t: 'answer', s: pc.localDescription }))
          .catch(() => self.onState('relay'));
      } else if (msg.t === 'answer') {
        pc.setRemoteDescription(msg.s).catch(function () {});
      } else if (msg.t === 'ice') {
        pc.addIceCandidate(msg.s).catch(function () {});
      }
    } catch (e) { /* ignore */ }
  }

  send(e, d) {
    if (!this.ready) return false;
    const dc = (e === 'snap') ? this.game : this.ctrl;
    if (!dc || dc.readyState !== 'open') return false;
    try {
      dc.send(JSON.stringify({ e: e, d: d }));
      return true;
    } catch (err) {
      return false;
    }
  }

  close() {
    clearInterval(this.pingTimer);
    try { if (this.ctrl) this.ctrl.close(); } catch (e) { /* ignore */ }
    try { if (this.game) this.game.close(); } catch (e2) { /* ignore */ }
    try { if (this.pc) this.pc.close(); } catch (e3) { /* ignore */ }
    this.ctrl = null;
    this.game = null;
    this.pc = null;
    this.ready = false;
  }
}
