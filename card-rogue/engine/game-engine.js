// ============================================================
//  game-engine.js — 游戏核心逻辑层
//  零 DOM 依赖。所有交互通过 dispatch(action) / onStateUpdate 进行。
// ============================================================

(function (global) {
  'use strict';

  // ── 依赖（浏览器环境下通过全局变量，Node 环境下通过 require）
  const _cards   = typeof CARDS   !== 'undefined' ? { CARDS, getCard, getRewardPool } : require('./cards');
  const _enemies = typeof ENEMY_TEMPLATES !== 'undefined'
    ? { createEnemy, computeIntent, getEnemiesForRoom, INTENT }
    : require('./enemies');
  const _map     = typeof generateMap !== 'undefined'
    ? { generateMap, enterNode, getAvailableNodes, serializeMap, TOTAL_FLOORS }
    : require('./map-gen');

  // ── 内部状态
  let _state = null;
  let _onStateUpdate = null;

  // ── 简易 seeded RNG
  let _seed = 0;
  function rng(min, max) {
    _seed = (_seed * 1664525 + 1013904223) & 0xffffffff;
    return min + (Math.abs(_seed) % (max - min + 1));
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = rng(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ── 初始牌组
  function buildStarterDeck() {
    const deck = [];
    for (let i = 0; i < 5; i++) deck.push(_cards.getCard('strike'));
    for (let i = 0; i < 4; i++) deck.push(_cards.getCard('defend'));
    deck.push(_cards.getCard('bash'));
    return shuffle(deck);
  }

  // ── 创建玩家
  function createPlayer() {
    return {
      hp: 80, maxHp: 80,
      block: 0,
      energy: 3, maxEnergy: 3,
      statuses: {},
      deck: buildStarterDeck(),
      hand: [],
      discard: [],
      exhaust: [],
      gold: 99,
    };
  }

  // ── 工具：日志
  function pushLog(msg) {
    _state.log.unshift(msg);
    if (_state.log.length > 20) _state.log.pop();
  }

  // ── 工具：状态快照（用于发送给表现层）
  function snapshot() {
    const p = _state.player;
    return {
      phase: _state.phase,
      turn: _state.turn,
      player: {
        hp: p.hp, maxHp: p.maxHp,
        block: p.block,
        energy: p.energy, maxEnergy: p.maxEnergy,
        statuses: { ...p.statuses },
        hand: p.hand.map(serializeCard),
        deck: p.deck.map(serializeCard),
        discard: p.discard.map(serializeCard),
      },
      enemies: _state.enemies.map(serializeEnemy),
      map: _map.serializeMap(_state.map),
      rewardCards: _state.rewardCards || [],
      log: [..._state.log],
      gameOver: _state.gameOver || false,
      victory: _state.victory || false,
    };
  }

  function serializeCard(c) {
    // 确保描述中的 {key} 被替换为实际数值
    let desc = c.desc || '';
    if (c.params) {
      desc = desc.replace(/\{(\w+)\}/g, (_, key) => c.params[key] !== undefined ? c.params[key] : `{${key}}`);
    }
    return { id: c.id, name: c.name, cost: c.cost, type: c.type, desc, rarity: c.rarity, unplayable: !!c.unplayable };
  }
  function serializeEnemy(e) {
    return {
      instanceId: e.instanceId, id: e.id, name: e.name, icon: e.icon,
      hp: e.hp, maxHp: e.maxHp, block: e.block,
      statuses: { ...e.statuses },
      intent: e.currentIntent,
      alive: e.alive,
    };
  }

  // ── 广播状态
  function broadcast() {
    if (_onStateUpdate) _onStateUpdate({ type: 'STATE_UPDATE', state: snapshot() });
  }

  // ============================================================
  //  战斗逻辑
  // ============================================================

  // 摸牌
  function draw(n) {
    for (let i = 0; i < n; i++) {
      if (_state.player.deck.length === 0) {
        if (_state.player.discard.length === 0) break;
        _state.player.deck = shuffle([..._state.player.discard]);
        _state.player.discard = [];
        pushLog('洗牌！');
      }
      _state.player.hand.push(_state.player.deck.shift());
    }
  }

  // 计算实际伤害（含力量/弱化/易伤）
  function calcDamage(attacker, target, base) {
    let dmg = base + (attacker.statuses.strength || 0);
    if (attacker.statuses.weak) dmg = Math.floor(dmg * 0.75);
    dmg = Math.max(0, dmg);
    if (target.statuses.vulnerable) dmg = Math.floor(dmg * 1.5);
    return Math.max(0, dmg);
  }

  // 计算格挡（含敏捷）
  function calcBlock(blocker, base) {
    return base + (blocker.statuses.dexterity || 0);
  }

  // 对目标造成伤害
  function dealDamage(target, dmg) {
    if (!target.alive) return;
    const absorbed = Math.min(target.block, dmg);
    target.block = Math.max(0, target.block - dmg);
    const actual = dmg - absorbed;
    target.hp = Math.max(0, target.hp - actual);
    pushLog(`${target.name || '玩家'} 受到 ${actual} 点伤害（格挡吸收 ${absorbed}）。`);
    if (target.hp <= 0) {
      target.alive = false;
      if (target.instanceId) pushLog(`${target.name} 被击败！`);
    }
  }

  // 获得格挡
  function gainBlock(entity, amount) {
    entity.block += amount;
    pushLog(`${entity.name || '玩家'} 获得 ${amount} 点格挡（共 ${entity.block}）。`);
  }

  // 施加状态
  function applyStatus(entity, status, amount) {
    entity.statuses = entity.statuses || {};
    entity.statuses[status] = (entity.statuses[status] || 0) + amount;
    pushLog(`${entity.name || '玩家'} ${status} ${amount > 0 ? '+' : ''}${amount}。`);
  }

  // 加入弃牌堆
  function addToDiscard(cardId) {
    const c = _cards.getCard(cardId);
    if (c) _state.player.discard.push(c);
  }

  // ── 构建 ctx（卡牌 effect 的执行上下文）
  function buildCtx(cardInst, targetEnemy) {
    const p = _state.player;
    return {
      player: p,
      target: targetEnemy || _state.enemies.find(e => e.alive),
      enemies: _state.enemies.filter(e => e.alive),
      calc: (base) => calcDamage(p, targetEnemy || _state.enemies.find(e => e.alive), base),
      calcBlock: (base) => calcBlock(p, base),
      dealDamage,
      gainBlock,
      applyStatus,
      draw,
      addToDiscard,
      spendEnergy: (n) => { p.energy -= n; },
      log: pushLog,
    };
  }

  // ── 开始战斗
  function startCombat(enemyIds) {
    _state.enemies = enemyIds.map(id => _enemies.createEnemy(id, rng));
    _state.phase = 'PLAYER_TURN';
    _state.turn = 1;
    _state.player.block = _state.player.statuses.barricade ? _state.player.block : 0;
    _state.player.energy = _state.player.maxEnergy;
    draw(5);

    // 计算敌人意图
    _state.enemies.forEach(e => {
      e.currentIntent = _enemies.computeIntent(e, _state.player, rng);
    });

    pushLog(`⚔️ 战斗开始！第 ${_state.turn} 回合。`);
    broadcast();
  }

  // ── 玩家打出手牌
  function playCard(cardId, targetId) {
    if (_state.phase !== 'PLAYER_TURN') return;
    const p = _state.player;
    const idx = p.hand.findIndex(c => c.id === cardId);
    if (idx === -1) { pushLog('手牌中没有该卡。'); broadcast(); return; }

    const card = p.hand[idx];
    if (card.unplayable) { pushLog(`${card.name} 无法打出。`); broadcast(); return; }

    const cost = card.cost === -1 ? p.energy : card.cost;
    if (cost > p.energy) { pushLog('能量不足！'); broadcast(); return; }

    const target = _state.enemies.find(e => e.instanceId === targetId) || _state.enemies.find(e => e.alive);

    // 从手牌移除
    p.hand.splice(idx, 1);
    p.energy -= cost;

    // 执行效果
    const ctx = buildCtx(card, target);
    card.effect(ctx);

    // 进弃牌/废除
    if (card.exhaust) {
      p.exhaust.push(card);
      pushLog(`${card.name} 被废除。`);
    } else {
      p.discard.push(card);
    }

    pushLog(`▶ 打出 ${card.name}。`);

    // 检查胜利
    if (_state.enemies.every(e => !e.alive)) {
      endCombatVictory();
      return;
    }

    broadcast();
  }

  // ── 结束玩家回合
  function endPlayerTurn() {
    if (_state.phase !== 'PLAYER_TURN') return;
    _state.phase = 'ENEMY_TURN';

    // 弃所有手牌
    _state.player.discard.push(..._state.player.hand);
    _state.player.hand = [];

    // 处理回合结束状态效果
    const p = _state.player;
    if (p.statuses.strength_down) {
      applyStatus(p, 'strength', -p.statuses.strength_down);
      delete p.statuses.strength_down;
    }
    if (p.statuses.combust) {
      dealDamage(p, 1);
      _state.enemies.filter(e => e.alive).forEach(e => dealDamage(e, p.statuses.combust));
    }

    pushLog('━━ 敌人回合 ━━');

    // 敌人行动
    _state.enemies.filter(e => e.alive).forEach(e => {
      executeEnemyIntent(e);
      e.intentIndex++;
      if (_state.player.hp <= 0) return;
    });

    if (_state.player.hp <= 0) {
      _state.phase = 'GAME_OVER';
      _state.gameOver = true;
      pushLog('💀 你已被击败。');
      broadcast();
      return;
    }

    // 新回合准备
    _state.turn++;
    _state.phase = 'PLAYER_TURN';
    const barricade = p.statuses.barricade;
    if (!barricade) p.block = 0;

    // 敌人格挡清零
    _state.enemies.forEach(e => { e.block = 0; });

    // 处理毒
    _state.enemies.forEach(e => {
      if (e.statuses.poison) {
        dealDamage(e, e.statuses.poison);
        e.statuses.poison = Math.max(0, e.statuses.poison - 1);
      }
      if (e.statuses.vulnerable) e.statuses.vulnerable = Math.max(0, e.statuses.vulnerable - 1);
      if (e.statuses.weak) e.statuses.weak = Math.max(0, e.statuses.weak - 1);
    });
    if (p.statuses.vulnerable) p.statuses.vulnerable = Math.max(0, p.statuses.vulnerable - 1);
    if (p.statuses.weak) p.statuses.weak = Math.max(0, p.statuses.weak - 1);

    // 恶魔形态
    if (p.statuses.demon_form) applyStatus(p, 'strength', p.statuses.demon_form);

    p.energy = p.maxEnergy;
    draw(5);
    pushLog(`━━ 玩家回合 ${_state.turn} ━━`);

    // 更新敌人意图
    _state.enemies.filter(e => e.alive).forEach(e => {
      e.currentIntent = _enemies.computeIntent(e, _state.player, rng);
    });

    // 检查胜利（敌人可能死于毒）
    if (_state.enemies.every(e => !e.alive)) {
      endCombatVictory();
      return;
    }

    broadcast();
  }

  // ── 执行敌人意图
  function executeEnemyIntent(enemy) {
    const intent = enemy.currentIntent;
    if (!intent) return;
    switch (intent.type) {
      case 'ATTACK': {
        const times = intent.times || 1;
        for (let i = 0; i < times; i++) {
          const dmg = calcDamage(enemy, _state.player, intent.dmg);
          dealDamage(_state.player, dmg);
          if (_state.player.hp <= 0) return;
        }
        break;
      }
      case 'DEFEND':
        gainBlock(enemy, intent.block || 0);
        if (intent.status) applyStatus(enemy, intent.status, intent.amount || 0);
        break;
      case 'BUFF':
        if (intent.status) applyStatus(enemy, intent.status, intent.amount || 0);
        break;
      case 'DEBUFF':
        if (intent.status) applyStatus(_state.player, intent.status, intent.amount || 0);
        break;
    }
    pushLog(`${enemy.name}：${intent.desc}`);
  }

  // ── 战斗胜利
  function endCombatVictory() {
    _state.phase = 'REWARD';
    pushLog('🎉 战斗胜利！');

    // 生成奖励卡牌
    const pool = _cards.getRewardPool();
    shuffle(pool);
    _state.rewardCards = pool.slice(0, 3).map(id => _cards.getCard(id)).map(serializeCard);

    // 回合结束清理
    _state.player.discard.push(..._state.player.hand);
    _state.player.hand = [];
    _state.player.block = 0;

    broadcast();
  }

  // ── 选择奖励卡
  function pickReward(cardId) {
    if (_state.phase !== 'REWARD') return;
    if (cardId) {
      const card = _cards.getCard(cardId);
      if (card) {
        _state.player.discard.push(card);
        pushLog(`获得了 ${card.name}！`);
      }
    } else {
      pushLog('跳过了奖励。');
    }
    _state.rewardCards = [];
    _state.phase = 'MAP';
    broadcast();
  }

  // ── 进入地图节点
  function selectNode(nodeId) {
    if (_state.phase !== 'MAP') return;
    _map.enterNode(_state.map, nodeId);

    const node = findNode(nodeId);
    if (!node) return;

    if (node.type === 'REST') {
      // 营地：回血
      const heal = Math.floor(_state.player.maxHp * 0.3);
      _state.player.hp = Math.min(_state.player.maxHp, _state.player.hp + heal);
      pushLog(`🔥 在营地休息，回复 ${heal} 点 HP。`);
      // 检查是否到 Boss 层
      if (_state.map.currentFloor >= _map.TOTAL_FLOORS - 2) {
        _state.phase = 'MAP';
      } else {
        _state.phase = 'MAP';
      }
      broadcast();
    } else {
      // 战斗/精英/Boss
      const enemyIds = _enemies.getEnemiesForRoom(_state.map.currentFloor + 1, node.type, rng);
      startCombat(enemyIds);
    }
  }

  function findNode(nodeId) {
    for (const floor of _state.map.floors) {
      for (const n of floor.nodes) {
        if (n.id === nodeId) return n;
      }
    }
    return null;
  }

  // ── 检查是否全部 Boss 击败
  function checkVictory() {
    if (_state.enemies.every(e => !e.alive) && _state.map.currentFloor >= _map.TOTAL_FLOORS - 1) {
      _state.victory = true;
      _state.phase = 'GAME_OVER';
      pushLog('🏆 恭喜！你通关了！');
    }
  }

  // ============================================================
  //  公共 API
  // ============================================================

  const GameEngine = {
    /**
     * 注册状态更新回调
     * @param {function} cb - (stateUpdate) => void
     */
    onStateUpdate(cb) {
      _onStateUpdate = cb;
    },

    /**
     * 发送动作（表现层 → 逻辑层）
     * @param {{ type: string, payload: object }} action
     */
    dispatch(action) {
      if (!action || !action.type) return;
      const p = action.payload || {};

      switch (action.type) {

        case 'START_GAME': {
          _seed = p.seed || Date.now();
          _state = {
            phase: 'MAP',
            turn: 0,
            player: createPlayer(),
            enemies: [],
            map: _map.generateMap(_seed),
            rewardCards: [],
            log: ['游戏开始！选择路线开始冒险。'],
            gameOver: false,
            victory: false,
          };
          // 解锁第一层所有节点
          _state.map.floors[0].nodes.forEach(n => { n.available = true; });
          broadcast();
          break;
        }

        case 'SELECT_NODE':
          selectNode(p.nodeId);
          break;

        case 'PLAY_CARD':
          playCard(p.cardId, p.targetId);
          break;

        case 'END_TURN':
          endPlayerTurn();
          break;

        case 'PICK_REWARD':
          pickReward(p.cardId || null);
          break;

        case 'REST_HEAL':
          // 已在 selectNode 中处理
          break;

        case 'GET_STATE':
          broadcast();
          break;

        default:
          console.warn('[GameEngine] Unknown action:', action.type);
      }
    },

    /**
     * 直接获取当前状态快照（用于调试）
     */
    getSnapshot() {
      return _state ? snapshot() : null;
    }
  };

  // 挂载到全局
  if (typeof module !== 'undefined') {
    module.exports = GameEngine;
  } else {
    global.GameEngine = GameEngine;
  }

})(typeof window !== 'undefined' ? window : global);
