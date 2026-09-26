// タイルポップのゲームロジック（DOM に依存しない）。
// 盤面は「列の配列」。各列は下から上へ並んだタイル {id, color} の配列で、
// 空になった列は取り除く。よって board[c][y] は左から c 列目・下から y 段目。
(function (root) {
  'use strict';

  let nextId = 1;
  const tile = (color) => ({ id: nextId++, color });

  const colorAt = (b, c, y) => {
    const col = b[c];
    return col && y >= 0 && y < col.length ? col[y].color : -1;
  };

  // (c, y) と縦横につながる同色タイルの座標 [[c, y], ...]
  function findGroup(b, c, y) {
    const color = colorAt(b, c, y);
    if (color < 0) return [];
    const seen = new Set([c * 1000 + y]);
    const out = [];
    const stack = [[c, y]];
    while (stack.length) {
      const [cc, yy] = stack.pop();
      out.push([cc, yy]);
      for (const [dc, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = cc + dc, ny = yy + dy, k = nc * 1000 + ny;
        if (!seen.has(k) && colorAt(b, nc, ny) === color) {
          seen.add(k);
          stack.push([nc, ny]);
        }
      }
    }
    return out;
  }

  // 指定セルを消し、上のタイルを落とし、空の列を左へ詰めた新しい盤面を返す
  function removeCells(b, cells) {
    const rm = new Set(cells.map(([c, y]) => c * 1000 + y));
    return b
      .map((col, c) => col.filter((_, y) => !rm.has(c * 1000 + y)))
      .filter((col) => col.length);
  }

  function hasMoves(b) {
    for (let c = 0; c < b.length; c++) {
      for (let y = 0; y < b[c].length; y++) {
        const color = b[c][y].color;
        if (colorAt(b, c + 1, y) === color || colorAt(b, c, y + 1) === color) return true;
      }
    }
    return false;
  }

  // 消せるグループ（2個以上）の一覧
  function allGroups(b) {
    const seen = new Set();
    const groups = [];
    for (let c = 0; c < b.length; c++) {
      for (let y = 0; y < b[c].length; y++) {
        if (seen.has(c * 1000 + y)) continue;
        const g = findGroup(b, c, y);
        g.forEach(([gc, gy]) => seen.add(gc * 1000 + gy));
        if (g.length >= 2) groups.push(g);
      }
    }
    return groups;
  }

  const countTiles = (b) => b.reduce((n, col) => n + col.length, 0);
  const boardKey = (b) => b.map((col) => col.map((t) => t.color).join('')).join('|');
  const points = (n) => (n - 1) * (n - 1) * 10;

  // ---- 盤面生成 ----
  // 空の盤面から「消す操作の逆」を積み重ねて盤面を作るので、必ずクリアできる。
  // 逆操作は 3 種類：既存の列への縦一列の挿入、同じ高さへの横一列の挿入、新しい列の挿入。
  // 挿入したグループが外の同色タイルと接していないことを確かめるので、
  // 後で順方向にクリックしたとき、ちょうどそのグループだけが消えて元の盤面に戻る。

  const SIZE_WEIGHT = { 2: 6, 3: 3, 4: 1 };

  function candidates(b, W, H, K, rem) {
    const out = [];
    const okSize = (s) => s <= rem && rem - s !== 1;
    const push = (o, s) => {
      for (let k = 0; k < K; k++) out.push({ ...o, s, k, w: SIZE_WEIGHT[s] * (o.t === 'n' ? 2 : 1) });
    };
    if (b.length < W) {
      for (let p = 0; p <= b.length; p++) {
        for (let s = 2; s <= Math.min(4, H); s++) if (okSize(s)) push({ t: 'n', p }, s);
      }
    }
    for (let c = 0; c < b.length; c++) {
      const h = b[c].length;
      for (let s = 2; s <= Math.min(4, H - h); s++) {
        if (!okSize(s)) continue;
        for (let y = 0; y <= h; y++) push({ t: 'v', c, y }, s);
      }
      let minH = Infinity;
      for (let s = 1; s <= 4 && c + s - 1 < b.length; s++) {
        const len = b[c + s - 1].length;
        if (len >= H) break;
        minH = Math.min(minH, len);
        if (s >= 2 && okSize(s)) for (let y = 0; y <= minH; y++) push({ t: 'h', c, y }, s);
      }
    }
    return out;
  }

  // 候補を盤面に適用し、挿入セルが孤立したグループになっていれば {board, cells} を返す
  function applyCandidate(b, cand) {
    const nb = b.map((col) => col.slice());
    const cells = [];
    const fresh = () => tile(cand.k);
    if (cand.t === 'n') {
      nb.splice(cand.p, 0, Array.from({ length: cand.s }, fresh));
      for (let i = 0; i < cand.s; i++) cells.push([cand.p, i]);
    } else if (cand.t === 'v') {
      nb[cand.c].splice(cand.y, 0, ...Array.from({ length: cand.s }, fresh));
      for (let i = 0; i < cand.s; i++) cells.push([cand.c, cand.y + i]);
    } else {
      for (let i = 0; i < cand.s; i++) {
        nb[cand.c + i].splice(cand.y, 0, fresh());
        cells.push([cand.c + i, cand.y]);
      }
    }
    const inGroup = new Set(cells.map(([c, y]) => c * 1000 + y));
    for (const [c, y] of cells) {
      for (const [dc, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, ny = y + dy;
        if (!inGroup.has(nc * 1000 + ny) && colorAt(nb, nc, ny) === cand.k) return null;
      }
    }
    return { board: nb, cells };
  }

  function tryBuild(W, H, K) {
    let b = [];
    let total = 0;
    const target = W * H;
    const reverseMoves = [];
    while (total < target) {
      const cands = candidates(b, W, H, K, target - total);
      // 重み付きランダム順（A-Res）
      for (const c of cands) c.r = Math.pow(Math.random(), 1 / c.w);
      cands.sort((a, z) => z.r - a.r);
      let applied = null;
      for (const cand of cands) {
        applied = applyCandidate(b, cand);
        if (applied) break;
      }
      if (!applied) return null;
      b = applied.board;
      total += applied.cells.length;
      const [c, y] = applied.cells[0];
      reverseMoves.push({ c, y });
    }
    return { board: b, solution: reverseMoves.reverse() };
  }

  // 解の手順を辿り、「盤面 → 次の一手」の表を作る（ヒントに使う）
  function solutionMap(board, solution) {
    const map = new Map();
    let b = board;
    for (const mv of solution) {
      map.set(boardKey(b), mv);
      b = removeCells(b, findGroup(b, mv.c, mv.y));
    }
    return b.length === 0 ? map : null;
  }

  function generate(W, H, K) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const built = tryBuild(W, H, K);
      if (!built) continue;
      // 全色が使われている盤面だけを採用する
      const used = new Set(built.board.flat().map((t) => t.color));
      if (used.size < K) continue;
      const map = solutionMap(built.board, built.solution);
      if (map) return { board: built.board, solution: built.solution, solutionMap: map, guaranteed: true };
    }
    // 念のためのフォールバック（通常は到達しない）
    const board = Array.from({ length: W }, () =>
      Array.from({ length: H }, () => tile(Math.floor(Math.random() * K))));
    return { board, solution: [], solutionMap: new Map(), guaranteed: false };
  }

  // ---- ソルバー（ヒント用） ----
  // 1 枚だけ残った色がある盤面は二度と消せないので詰み。
  function hopeless(b) {
    const cnt = new Map();
    for (const col of b) for (const t of col) cnt.set(t.color, (cnt.get(t.color) || 0) + 1);
    for (const n of cnt.values()) if (n === 1) return true;
    return false;
  }

  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // タイルが少ない盤面は時間内に全探索して、解けるか解けないかを確定させる。
  // 多い盤面は全探索が間に合わないので、詰みを避けながらランダムに最後まで打つ試行を繰り返す。
  function solve(board, timeMs) {
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const deadline = now() + timeMs;
    if (board.length === 0) return { path: [], timedOut: false };
    if (hopeless(board)) return { path: null, timedOut: false };
    if (countTiles(board) <= 40) {
      const res = solveExhaustive(board, deadline, now);
      if (res.path || !res.timedOut) return res;
    }
    while (now() < deadline) {
      const path = playout(board);
      if (path) return { path, timedOut: false };
    }
    return { path: null, timedOut: true };
  }

  function playout(board) {
    let b = board;
    const path = [];
    while (b.length) {
      let moved = false;
      for (const g of shuffle(allGroups(b))) {
        const nb = removeCells(b, g);
        if (!hopeless(nb)) {
          b = nb;
          path.push({ c: g[0][0], y: g[0][1] });
          moved = true;
          break;
        }
      }
      if (!moved) return null;
    }
    return path;
  }

  function solveExhaustive(board, deadline, now) {
    const dead = new Set();
    let timedOut = false;

    function dfs(b) {
      if (b.length === 0) return [];
      if (now() > deadline) { timedOut = true; return null; }
      const key = boardKey(b);
      if (dead.has(key) || hopeless(b)) return null;
      for (const g of shuffle(allGroups(b))) {
        const rest = dfs(removeCells(b, g));
        if (rest) return [{ c: g[0][0], y: g[0][1] }, ...rest];
        if (timedOut) return null;
      }
      dead.add(key);
      return null;
    }

    const path = dfs(board);
    return { path, timedOut: !path && timedOut };
  }

  const api = {
    findGroup, removeCells, hasMoves, allGroups, countTiles, boardKey, points,
    generate, solutionMap, solve,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TileLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
