// ============================================================
//  map-gen.js — 地图生成器（逻辑层，零 DOM 依赖）
// ============================================================

const ROOM_TYPES = ['COMBAT', 'COMBAT', 'COMBAT', 'ELITE', 'REST', 'COMBAT', 'COMBAT'];
// 每层节点数（列）
const NODES_PER_FLOOR = 6;
const TOTAL_FLOORS = 3;

/**
 * 生成一个种子化地图
 * @param {number} seed
 * @returns {object} map — { floors: Floor[], currentFloor, currentNode }
 *
 * Floor: { floorNum, nodes: Node[] }
 * Node:  { id, type, children: [nodeId], parents: [nodeId], visited }
 */
function generateMap(seed) {
  // 简易 seeded RNG
  let s = seed;
  const rng = (min, max) => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return min + (Math.abs(s) % (max - min + 1));
  };

  const floors = [];

  for (let f = 0; f < TOTAL_FLOORS; f++) {
    const count = f === TOTAL_FLOORS - 1 ? 1 : rng(3, 5); // 最后一层只有 Boss
    const nodes = [];

    for (let n = 0; n < count; n++) {
      let type;
      if (f === TOTAL_FLOORS - 1) {
        type = 'BOSS';
      } else if (n === 0 && f > 0 && rng(0, 3) === 0) {
        type = 'ELITE';
      } else if (rng(0, 4) === 0) {
        type = 'REST';
      } else {
        type = 'COMBAT';
      }

      nodes.push({
        id: `f${f}n${n}`,
        floorNum: f,
        nodeIdx: n,
        type,
        children: [],
        parents: [],
        visited: false,
        available: f === 0, // 第一层所有节点都可选
      });
    }
    floors.push({ floorNum: f, nodes });
  }

  // 连接节点：每个节点连到下一层 1-2 个节点
  for (let f = 0; f < TOTAL_FLOORS - 1; f++) {
    const cur = floors[f].nodes;
    const next = floors[f + 1].nodes;

    cur.forEach((node, ni) => {
      // 至少连一个，最多两个
      const targets = new Set();
      targets.add(rng(0, next.length - 1));
      if (next.length > 1 && rng(0, 1)) {
        targets.add(rng(0, next.length - 1));
      }
      targets.forEach(ti => {
        node.children.push(next[ti].id);
        next[ti].parents.push(node.id);
        next[ti].available = false; // 由父节点解锁
      });
    });
  }

  return {
    floors,
    currentFloor: 0,
    currentNode: null,
    seed,
  };
}

/**
 * 玩家选择进入一个节点后，更新地图状态
 */
function enterNode(map, nodeId) {
  let node = null;
  for (const floor of map.floors) {
    for (const n of floor.nodes) {
      if (n.id === nodeId) { node = n; break; }
    }
  }
  if (!node) throw new Error(`Node not found: ${nodeId}`);

  node.visited = true;
  map.currentNode = nodeId;
  map.currentFloor = node.floorNum;

  // 解锁子节点
  const nextFloor = map.floors[node.floorNum + 1];
  if (nextFloor) {
    node.children.forEach(childId => {
      const child = nextFloor.nodes.find(n => n.id === childId);
      if (child) child.available = true;
    });
  }

  return map;
}

/**
 * 获取当前可用（可点击）的节点 id 列表
 */
function getAvailableNodes(map) {
  const result = [];
  for (const floor of map.floors) {
    for (const node of floor.nodes) {
      if (node.available && !node.visited) result.push(node.id);
    }
  }
  return result;
}

/**
 * 地图序列化为纯 JSON（用于 STATE_UPDATE）
 */
function serializeMap(map) {
  return {
    currentFloor: map.currentFloor,
    currentNode: map.currentNode,
    floors: map.floors.map(f => ({
      floorNum: f.floorNum,
      nodes: f.nodes.map(n => ({
        id: n.id,
        type: n.type,
        children: n.children,
        visited: n.visited,
        available: n.available,
      }))
    }))
  };
}

if (typeof module !== 'undefined') {
  module.exports = { generateMap, enterNode, getAvailableNodes, serializeMap, TOTAL_FLOORS };
}
