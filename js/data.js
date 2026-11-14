'use strict';

/* ============================================================
   常量、场地几何、卡牌与塔的数值表
   单位统一用「格」为坐标单位，渲染时乘 TILE
   ============================================================ */

var CR = (function () {
  const COLS = 14;
  const ROWS = 22;
  const TILE = 36;

  const RIVER = { y0: 10, y1: 12 };
  const BRIDGES = [
    { x0: 2.6, x1: 4.6, cx: 3.6 },
    { x0: 9.4, x1: 11.4, cx: 10.4 }
  ];

  const MID_Y = (RIVER.y0 + RIVER.y1) / 2;

  const ELIXIR_MAX = 10;
  const ELIXIR_PERIOD = 2.8;
  const OVERTIME = 60;
  const REGULAR = 180;
  const DOUBLE_ELIXIR_AT = 60; // 剩余 60 秒起双倍圣水

  // 每方三座塔：两座公主塔 + 一座国王塔
  const TOWERS = [
    // team 0（下方）
    { id: 'k0', team: 0, kind: 'king', x: 7, y: 19.4 },
    { id: 'p0l', team: 0, kind: 'princess', x: 3, y: 16.4 },
    { id: 'p0r', team: 0, kind: 'princess', x: 11, y: 16.4 },
    // team 1（上方）
    { id: 'k1', team: 1, kind: 'king', x: 7, y: 2.6 },
    { id: 'p1l', team: 1, kind: 'princess', x: 3, y: 5.6 },
    { id: 'p1r', team: 1, kind: 'princess', x: 11, y: 5.6 }
  ];

  const TOWER_STATS = {
    king: { hp: 2600, dmg: 78, hitSpeed: 1.0, range: 6.2, radius: 1.12 },
    princess: { hp: 1500, dmg: 62, hitSpeed: 0.8, range: 5.8, radius: 1.0 }
  };

  /* ---------------- 卡牌 ---------------- */
  // targets: 'all'（可打兵也可打塔/建筑）、'buildings'（只打建筑与塔）
  // kind: 'troop' | 'building' | 'spell'

  const CARDS = [
    {
      id: 'knight', name: '骑士', emoji: '🛡️', cost: 3, kind: 'troop', count: 1,
      hp: 720, dmg: 82, hitSpeed: 1.1, range: 0.85, speed: 1.55, targets: 'all', radius: 0.42,
      color: '#8fb4ea'
    },
    {
      id: 'archers', name: '弓箭手', emoji: '🏹', cost: 3, kind: 'troop', count: 2,
      hp: 250, dmg: 44, hitSpeed: 0.9, range: 4.0, speed: 1.5, targets: 'all', radius: 0.32, ranged: true,
      color: '#7fd8a8'
    },
    {
      id: 'musketeer', name: '火枪手', emoji: '🔫', cost: 4, kind: 'troop', count: 1,
      hp: 360, dmg: 96, hitSpeed: 1.0, range: 4.6, speed: 1.5, targets: 'all', radius: 0.36, ranged: true,
      color: '#9fd0ff'
    },
    {
      id: 'giant', name: '巨人', emoji: '🦍', cost: 5, kind: 'troop', count: 1,
      hp: 2100, dmg: 128, hitSpeed: 1.5, range: 0.95, speed: 1.15, targets: 'buildings', radius: 0.56,
      color: '#f0b27a'
    },
    {
      id: 'goblins', name: '哥布林', emoji: '👺', cost: 2, kind: 'troop', count: 3,
      hp: 165, dmg: 46, hitSpeed: 0.7, range: 0.7, speed: 2.2, targets: 'all', radius: 0.3,
      color: '#9be36b'
    },
    {
      id: 'minipekka', name: '小皮卡', emoji: '🤖', cost: 4, kind: 'troop', count: 1,
      hp: 940, dmg: 330, hitSpeed: 1.6, range: 0.8, speed: 1.85, targets: 'all', radius: 0.44,
      color: '#c9a6ff'
    },
    {
      id: 'cannon', name: '加农炮', emoji: '💣', cost: 3, kind: 'building', count: 1,
      hp: 460, dmg: 74, hitSpeed: 0.9, range: 4.6, speed: 0, targets: 'all', radius: 0.5,
      life: 30, hitsAir: false, color: '#ffd166'
    },
    {
      id: 'fireball', name: '火球', emoji: '🔥', cost: 4, kind: 'spell', count: 1,
      spellDmg: 330, spellRadius: 1.9, radius: 0.5, color: '#ff7b4a'
    },
    {
      id: 'arrows', name: '万箭齐发', emoji: '☄️', cost: 3, kind: 'spell', count: 1,
      spellDmg: 132, spellRadius: 3.1, radius: 0.5, color: '#ffd166'
    },
    {
      id: 'valkyrie', name: '女武神', emoji: '🪓', cost: 4, kind: 'troop', count: 1,
      hp: 940, dmg: 132, hitSpeed: 1.5, range: 0.9, speed: 1.5, targets: 'all', radius: 0.46,
      splash: 1.15, color: '#ff9ec4'
    },
    {
      id: 'skeletons', name: '骷髅兵', emoji: '💀', cost: 1, kind: 'troop', count: 3,
      hp: 62, dmg: 32, hitSpeed: 0.6, range: 0.6, speed: 2.4, targets: 'all', radius: 0.26,
      color: '#d8dee9'
    },
    {
      id: 'hog', name: '野猪骑士', emoji: '🐗', cost: 4, kind: 'troop', count: 1,
      hp: 820, dmg: 158, hitSpeed: 1.4, range: 0.85, speed: 2.5, targets: 'buildings', radius: 0.46,
      color: '#e8a87c'
    },
    {
      id: 'zap', name: '小电', emoji: '⚡', cost: 2, kind: 'spell', count: 1,
      spellDmg: 190, spellRadius: 1.6, stun: 0.45, radius: 0.5, color: '#7fe3ff'
    },
    {
      id: 'rocket', name: '火箭', emoji: '🚀', cost: 6, kind: 'spell', count: 1,
      spellDmg: 700, spellRadius: 1.7, radius: 0.5, color: '#ff9f43'
    },
    {
      id: 'golem', name: '石头人', emoji: '🗿', cost: 8, kind: 'troop', count: 1,
      hp: 4200, dmg: 240, hitSpeed: 1.5, range: 0.95, speed: 0.9, targets: 'buildings', radius: 0.62,
      splits: 'golemite', splitCount: 2, color: '#b8b2a6'
    },
    {
      id: 'golemite', name: '小石头人', emoji: '🪨', cost: 0, kind: 'troop', count: 1, hidden: true,
      hp: 1100, dmg: 95, hitSpeed: 1.5, range: 0.9, speed: 1.2, targets: 'buildings', radius: 0.34,
      color: '#9d968a'
    },
    {
      id: 'darkprince', name: '黑骑士', emoji: '🐴', cost: 4, kind: 'troop', count: 1,
      hp: 1000, dmg: 150, hitSpeed: 1.4, range: 0.9, speed: 1.9, targets: 'all', radius: 0.46,
      splash: 1.05, charge: true, chargeDist: 1.7, color: '#8f8ff0'
    },
    {
      id: 'barbarians', name: '野蛮人', emoji: '⚔️', cost: 5, kind: 'troop', count: 4,
      hp: 430, dmg: 90, hitSpeed: 1.4, range: 0.85, speed: 1.7, targets: 'all', radius: 0.34,
      color: '#e8c07c'
    },
    {
      id: 'bomber', name: '炸弹人', emoji: '🧨', cost: 3, kind: 'troop', count: 1,
      hp: 280, dmg: 118, hitSpeed: 1.5, range: 3.6, speed: 1.5, targets: 'all', radius: 0.3,
      ranged: true, splash: 1.05, color: '#ffb870'
    },
    {
      id: 'skeletonarmy', name: '骷髅军团', emoji: '🦴', cost: 3, kind: 'troop', count: 12,
      hp: 60, dmg: 30, hitSpeed: 0.9, range: 0.6, speed: 2.3, targets: 'all', radius: 0.22,
      color: '#e4e8f0'
    },
    {
      id: 'wizard', name: '法师', emoji: '🧙', cost: 5, kind: 'troop', count: 1,
      hp: 720, dmg: 185, hitSpeed: 1.4, range: 4.2, speed: 1.5, targets: 'all', radius: 0.36,
      ranged: true, splash: 1.0, color: '#b39dff'
    },
    {
      id: 'witch', name: '女巫', emoji: '🧙‍♀️', cost: 5, kind: 'troop', count: 1,
      hp: 700, dmg: 120, hitSpeed: 1.3, range: 4.0, speed: 1.3, targets: 'all', radius: 0.36,
      ranged: true, splash: 0.9, color: '#c9b6ff',
      summon: { card: 'skeletons', count: 3, interval: 7, first: 1.6 }
    },
    {
      id: 'babydragon', name: '飞龙宝宝', emoji: '🐉', cost: 4, kind: 'troop', count: 1,
      hp: 800, dmg: 105, hitSpeed: 1.6, range: 3.2, speed: 1.6, targets: 'all', radius: 0.4,
      ranged: true, splash: 1.1, flying: true, color: '#a5e0ff'
    },
    {
      id: 'minions', name: '亡灵', emoji: '🦇', cost: 3, kind: 'troop', count: 3,
      hp: 150, dmg: 55, hitSpeed: 0.8, range: 0.7, speed: 2.4, targets: 'all', radius: 0.26,
      flying: true,
      color: '#b8b8ff'
    },
    {
      id: 'icewiz', name: '冰法师', emoji: '❄️', cost: 3, kind: 'troop', count: 1,
      hp: 520, dmg: 75, hitSpeed: 1.5, range: 4.2, speed: 1.5, targets: 'all', radius: 0.34,
      ranged: true, splash: 0.9, hitStun: 0.5, color: '#9fe8ff'
    },
    {
      id: 'giantskeleton', name: '大骷髅', emoji: '☠️', cost: 6, kind: 'troop', count: 1,
      hp: 2000, dmg: 240, hitSpeed: 1.6, range: 0.95, speed: 1.2, targets: 'buildings', radius: 0.56,
      deathBlast: { dmg: 520, radius: 2.2 }, color: '#cfd6e2'
    },
    {
      id: 'freeze', name: '冰冻', emoji: '🧊', cost: 4, kind: 'spell', count: 1,
      spellDmg: 0, spellRadius: 2.6, stun: 1.8, radius: 0.5, color: '#9fe8ff'
    },
    {
      id: 'tombstone', name: '骷髅墓碑', emoji: '🪦', cost: 3, kind: 'building', count: 1,
      hp: 480, dmg: 0, hitSpeed: 1.2, range: 0.6, speed: 0, targets: 'all', radius: 0.5,
      life: 32, color: '#cbbfae',
      summon: { card: 'skeletons', count: 2, interval: 4, first: 2 }
    }
  ];

  const CARD_BY_ID = {};
  CARDS.forEach(function (c) { CARD_BY_ID[c.id] = c; });

  // 图鉴用的文字说明
  const CARD_DESC = {
    knight: '三费肉盾，血厚攻稳，最适合顶在公主塔前面挡刀，也能单吃哥布林。',
    archers: '两只远程小兵，射程中距，伤害不高但便宜，适合配合肉盾跟在后面输出。',
    musketeer: '单体远程高伤，射程比弓箭手远，是廉价的对空/对塔输出点，怕近身。',
    giant: '只打建筑，血非常厚。放在桥头吸引塔的火力，让你的后排安全输出。',
    goblins: '三只高速小兵，便宜、出手快，适合解巨人、野猪这类大单位。',
    minipekka: '高伤近战，一刀能砍掉大半血，专门用来切肉盾和偷塔，但很脆。',
    cannon: '防守建筑，自动攻击范围内的地面单位（打不到空中），能拉扯敌人走位，30 秒后消失。',
    fireball: '范围法术，砸中范围内所有单位与塔；对塔伤害减半，用来清小兵或补塔。',
    arrows: '大范围低伤法术，专门清骷髅军团、哥布林这类成群的小兵。',
    valkyrie: '近战范围伤害，血厚，旋转一刀能同时打一圈，最适合解小兵海。',
    skeletons: '三只超便宜的骷髅，用来拖住大单位、骗对面的法术，性价比极高。',
    hog: '只打建筑，速度极快，从桥头直冲公主塔，是典型的偷塔快攻卡。',
    zap: '小范围法术，伤害低但会眩晕 0.45 秒，可以让对方塔少打两下，也能打断召唤。',
    rocket: '高伤单体法术，能一发打残公主塔，但费高，砸塔伤害同样减半。',
    golem: '八费终极肉盾，只打建筑，血量极高；死亡后分裂成两个小石头人继续推。',
    golemite: '石头人分裂出的小石头人，只打建筑，用来收尾拆塔。',
    darkprince: '带范围伤害的骑兵，冲刺一段距离后下一击伤害翻倍，适合正面冲塔。',
    barbarians: '四只中血近战，围绕落点排开，能快速围杀巨人、野猪这类单体大单位。',
    bomber: '远程范围投弹，对成群小兵伤害很高，但血少、射程短，需要前排保护。',
    skeletonarmy: '十二只骷髅方阵，瞬间淹没一个大单位，但一发万箭齐发就能全清。',
    wizard: '远程范围法师，伤害高、溅射广，是清小兵和打塔的主力后排。',
    witch: '远程溅射法师，每 7 秒在脚边召唤 3 只小骷髅，持续输出与滚雪球能力很强。',
    babydragon: '飞行远程，范围溅射，血比法师厚，适合跟在肉盾后面慢慢磨塔。',
    minions: '三只快速飞行小兵，出手快、能围杀，怕万箭齐发和火球。',
    icewiz: '远程溅射法师，每次命中都会让目标减速/僵直 0.5 秒，控场能力强但伤害偏低。',
    giantskeleton: '只打建筑的大肉盾，死亡时原地爆炸，对周围单位与塔造成大量伤害。',
    freeze: '范围冰冻法术，不造成伤害，但让范围内单位与塔停止行动 1.8 秒，配合推进极强。',
    tombstone: '防守建筑，每 4 秒召唤 2 只小骷髅，能持续拉扯并消耗对手，32 秒后消失。'
  };

  const DEFAULT_DECK = ['knight', 'archers', 'musketeer', 'giant', 'goblins', 'cannon', 'fireball', 'hog'];

  /* ---------------- 几何工具 ---------------- */

  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function inRiver(y) { return y > CR.RIVER.y0 - 0.05 && y < CR.RIVER.y1 + 0.05; }

  function onBridge(x) {
    for (let i = 0; i < BRIDGES.length; i++) {
      if (x >= BRIDGES[i].x0 - 0.15 && x <= BRIDGES[i].x1 + 0.15) return BRIDGES[i];
    }
    return null;
  }

  function laneBridge(x) {
    return Math.abs(x - BRIDGES[0].cx) <= Math.abs(x - BRIDGES[1].cx) ? BRIDGES[0] : BRIDGES[1];
  }

  // 某方可以下牌的区域
  function canDeployAt(team, x, y) {
    if (x < 0.6 || x > COLS - 0.6 || y < 0.6 || y > ROWS - 0.6) return false;
    if (team === 0 ? y < CR.RIVER.y1 + 0.2 : y > CR.RIVER.y0 - 0.2) return false;
    for (let i = 0; i < TOWERS.length; i++) {
      const t = TOWERS[i];
      const st = TOWER_STATS[t.kind];
      if (dist(x, y, t.x, t.y) < st.radius + 0.6) return false;
    }
    return true;
  }

  return {
    COLS: COLS, ROWS: ROWS, TILE: TILE,
    RIVER: RIVER, BRIDGES: BRIDGES, MID_Y: MID_Y,
    ELIXIR_MAX: ELIXIR_MAX, ELIXIR_PERIOD: ELIXIR_PERIOD,
    REGULAR: REGULAR, OVERTIME: OVERTIME, DOUBLE_ELIXIR_AT: DOUBLE_ELIXIR_AT,
    TOWERS: TOWERS, TOWER_STATS: TOWER_STATS,
    CARDS: CARDS, CARD_BY_ID: CARD_BY_ID, CARD_DESC: CARD_DESC, DEFAULT_DECK: DEFAULT_DECK,
    dist: dist, clamp: clamp, inRiver: inRiver, onBridge: onBridge, laneBridge: laneBridge,
    canDeployAt: canDeployAt
  };
})();

