// ============================================================
//  app.js — 表现层主控制器
//  只负责渲染和用户输入，通过 GameEngine.dispatch / onStateUpdate 通信
// ============================================================
'use strict';

(function () {
  // ── 当前状态缓存
  let _state = null;
  let _selectedEnemy = null;

  // ── 卡牌图标映射
  const CARD_ICONS = {
    ATTACK: ['⚔️','🗡️','🔪','💥','🌀','🏹','⚡'],
    SKILL:  ['🛡️','🔰','✨','💫','🌟','🔮','🌊'],
    POWER:  ['🔥','👁️','💀','🌑','⚗️','🧿','♾️'],
    STATUS: ['🩸'],
  };
  function cardIcon(card) {
    const pool = CARD_ICONS[card.type] || ['❓'];
    let hash = 0;
    for (const ch of card.id) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
    return pool[hash % pool.length];
  }

  // ── 屏幕切换
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  // ============================================================
  //  STATE_UPDATE 处理器 — 将状态翻译到 DOM
  // ============================================================
  function onStateUpdate({ state }) {
    _state = state;

    if (state.gameOver) { renderGameOver(state); return; }

    switch (state.phase) {
      case 'MAP':    renderMap(state);    break;
      case 'PLAYER_TURN':
      case 'ENEMY_TURN': renderCombat(state); break;
      case 'REWARD': renderReward(state); break;
    }
  }

  // ============================================================
  //  地图渲染
  // ============================================================
  const NODE_ICONS = { COMBAT: '⚔️', ELITE: '💀', REST: '🔥', BOSS: '👑', SHOP: '🛒' };
  const NODE_LABELS = { COMBAT: '战斗', ELITE: '精英', REST: '营地', BOSS: 'BOSS', SHOP: '商店' };

  function renderMap(state) {
    showScreen('screen-map');

    // 玩家 HP 迷你栏
    const p = state.player;
    document.getElementById('mini-hp').textContent = `${p.hp} / ${p.maxHp}`;

    const canvas = document.getElementById('map-canvas');
    canvas.innerHTML = '';

    const available = new Set();
    state.map.floors.forEach(f => f.nodes.forEach(n => { if (n.available && !n.visited) available.add(n.id); }));

    // 从低层到高层渲染（floor 0 在底部）
    [...state.map.floors].reverse().forEach(floor => {
      const row = document.createElement('div');
      row.className = 'map-floor';

      floor.nodes.forEach(node => {
        const el = document.createElement('div');
        el.className = 'map-node';
        el.dataset.type = node.type;
        el.dataset.id = node.id;

        if (node.visited) el.classList.add('visited');
        else if (available.has(node.id)) el.classList.add('available');

        el.innerHTML = `<span>${NODE_ICONS[node.type] || '❓'}</span>
                        <span class="node-type">${NODE_LABELS[node.type] || node.type}</span>`;

        if (available.has(node.id)) {
          el.addEventListener('click', () => {
            GameEngine.dispatch({ type: 'SELECT_NODE', payload: { nodeId: node.id } });
          });
        }
        row.appendChild(el);
      });

      canvas.appendChild(row);
    });
  }

  // ============================================================
  //  战斗渲染
  // ============================================================
  function renderCombat(state) {
    showScreen('screen-combat');

    const p = state.player;

    // 玩家 HP 条
    const pct = Math.max(0, (p.hp / p.maxHp) * 100);
    document.getElementById('player-hp-bar').style.width = pct + '%';
    document.getElementById('player-hp-text').textContent = `${p.hp} / ${p.maxHp}`;
    document.getElementById('player-block-text').textContent = p.block ? `🛡 ${p.block}` : '';
    document.getElementById('turn-text').textContent = `第 ${state.turn} 回合`;

    // 能量
    document.getElementById('energy-cur').textContent = p.energy;
    document.getElementById('energy-max').textContent = `/ ${p.maxEnergy}`;

    // 玩家状态
    renderStatuses(document.getElementById('player-statuses'), p.statuses);

    // 敌人
    renderEnemies(state.enemies);

    // 手牌
    renderHand(p.hand, p.energy);

    // 日志
    renderLog(state.log);
  }

  function renderStatuses(container, statuses) {
    container.innerHTML = '';
    const labels = { strength:'力量', dexterity:'敏捷', vulnerable:'易伤', weak:'虚弱', poison:'中毒', barricade:'壁垒', demon_form:'恶魔' };
    for (const [k, v] of Object.entries(statuses)) {
      if (!v || !labels[k]) continue;
      const b = document.createElement('span');
      b.className = `status-badge ${k}`;
      b.textContent = `${labels[k]} ${v}`;
      container.appendChild(b);
    }
  }

  function renderEnemies(enemies) {
    const area = document.getElementById('enemies-area');
    area.innerHTML = '';

    enemies.forEach(e => {
      const fig = document.createElement('div');
      fig.className = 'enemy-figure' + (e.alive ? '' : ' dead');
      fig.id = `enemy-${e.instanceId}`;
      if (_selectedEnemy === e.instanceId) fig.classList.add('selected');

      const hpPct = Math.max(0, (e.hp / e.maxHp) * 100);
      const intentText = e.intent ? e.intent.desc : '???';

      fig.innerHTML = `
        <div class="enemy-intent">${intentText}</div>
        <div class="enemy-avatar" id="avatar-${e.instanceId}">${e.icon}</div>
        ${e.block ? `<div class="enemy-block">🛡 ${e.block}</div>` : ''}
        <div class="enemy-name">${e.name}</div>
        <div class="enemy-hp-bar-outer"><div class="enemy-hp-bar-inner" style="width:${hpPct}%"></div></div>
        <div class="enemy-hp-text">${e.hp} / ${e.maxHp}</div>
        <div class="status-badges" id="estatus-${e.instanceId}"></div>
      `;

      if (e.alive) {
        fig.addEventListener('click', () => {
          _selectedEnemy = e.instanceId;
          renderCombat(_state);
        });
      }

      area.appendChild(fig);

      // 状态效果
      const sb = fig.querySelector(`#estatus-${e.instanceId}`);
      if (sb) renderStatuses(sb, e.statuses);
    });

    // 默认选中第一个活着的敌人
    if (!enemies.find(e => e.instanceId === _selectedEnemy && e.alive)) {
      const first = enemies.find(e => e.alive);
      _selectedEnemy = first ? first.instanceId : null;
    }
  }

  // 清理描述中残留的 {key} 模板占位符
  function cleanDesc(desc) {
    const defaults = { dmg: '?', block: '?', hp: '?' };
    return (desc || '').replace(/\{(\w+)\}/g, (_, k) => defaults[k] || '?');
  }

  function renderHand(hand, energy) {
    const area = document.getElementById('hand-area');
    area.innerHTML = '';

    hand.forEach(card => {
      const cost = card.cost === -1 ? energy : card.cost;
      const cantPlay = card.unplayable || cost > energy;

      const el = document.createElement('div');
      el.className = 'card' + (cantPlay ? ' cant-play' : '');
      el.dataset.type = card.type;

      el.innerHTML = `
        <div class="card-type-banner"></div>
        <div class="card-cost">${card.cost === -1 ? 'X' : card.cost}</div>
        <div class="card-icon">${cardIcon(card)}</div>
        <div class="card-name">${card.name}</div>
        <div class="card-desc">${cleanDesc(card.desc)}</div>
      `;

      if (!cantPlay) {
        el.addEventListener('click', () => {
          GameEngine.dispatch({
            type: 'PLAY_CARD',
            payload: { cardId: card.id, targetId: _selectedEnemy }
          });
        });
      }

      area.appendChild(el);
    });
  }

  function renderLog(logs) {
    const logEl = document.getElementById('combat-log');
    if (!logEl) return;
    logEl.innerHTML = logs.slice(0, 12).map(l => `<p>${l}</p>`).join('');
  }

  // ============================================================
  //  奖励渲染
  // ============================================================
  function renderReward(state) {
    showScreen('screen-reward');

    const container = document.getElementById('reward-cards');
    container.innerHTML = '';

    state.rewardCards.forEach(card => {
      const el = document.createElement('div');
      el.className = 'reward-card';

      const typeColors = { ATTACK: '#e05252', SKILL: '#5298e0', POWER: '#cc44ff', STATUS: '#6b6880' };
      el.style.borderColor = typeColors[card.type] || 'var(--border)';

      el.innerHTML = `
        <div class="reward-card-cost">${card.cost === -1 ? 'X' : card.cost}</div>
        <div class="reward-card-icon">${cardIcon(card)}</div>
        <div class="reward-card-name">${card.name}</div>
        <div class="reward-card-type">${card.type}</div>
        <div class="reward-card-desc">${card.desc}</div>
      `;

      el.addEventListener('click', () => {
        GameEngine.dispatch({ type: 'PICK_REWARD', payload: { cardId: card.id } });
      });

      container.appendChild(el);
    });
  }

  // ============================================================
  //  游戏结束
  // ============================================================
  function renderGameOver(state) {
    showScreen('screen-gameover');
    const icon  = document.getElementById('gameover-icon');
    const title = document.getElementById('gameover-title');
    const sub   = document.getElementById('gameover-sub');

    if (state.victory) {
      icon.textContent  = '🏆';
      title.textContent = '胜利！';
      title.className   = 'gameover-title victory';
      sub.textContent   = '恭喜你通关了卡牌肉鸽！';
    } else {
      icon.textContent  = '💀';
      title.textContent = '你已阵亡';
      title.className   = 'gameover-title defeat';
      sub.textContent   = `在第 ${state.map.currentFloor + 1} 层倒下了。`;
    }
  }

  // ============================================================
  //  事件绑定
  // ============================================================
  function bindEvents() {
    // 开始游戏
    document.getElementById('btn-start')?.addEventListener('click', () => {
      GameEngine.dispatch({ type: 'START_GAME', payload: { seed: Date.now() } });
    });

    // 结束回合
    document.getElementById('btn-end-turn')?.addEventListener('click', () => {
      GameEngine.dispatch({ type: 'END_TURN', payload: {} });
    });

    // 跳过奖励
    document.getElementById('btn-skip-reward')?.addEventListener('click', () => {
      GameEngine.dispatch({ type: 'PICK_REWARD', payload: { cardId: null } });
    });

    // 重新开始
    document.querySelectorAll('.btn-restart').forEach(btn => {
      btn.addEventListener('click', () => {
        showScreen('screen-menu');
      });
    });
  }

  // ── 启动
  document.addEventListener('DOMContentLoaded', () => {
    GameEngine.onStateUpdate(onStateUpdate);
    bindEvents();
    showScreen('screen-menu');
  });

})();
