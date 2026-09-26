// タイルポップの画面と操作
(function () {
  'use strict';

  const L = window.TileLogic;

  const LEVELS = {
    easy: { cols: 8, rows: 6, colors: 3, label: 'かんたん' },
    normal: { cols: 10, rows: 8, colors: 4, label: 'ふつう' },
    hard: { cols: 12, rows: 10, colors: 5, label: 'むずかしい' },
  };
  const SYMBOLS = ['●', '▲', '■', '◆', '★']; // 色覚に頼らず見分けられるように
  const CLEAR_BONUS = 1000;
  const HINT_PENALTY = 50;
  const POP_MS = 180;
  const FALL_MS = 280;

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const tileEls = new Map(); // tile id -> element

  const state = {
    level: 'normal',
    initial: null, // やり直し用の初期盤面
    board: [],
    solutionMap: new Map(),
    score: 0,
    moves: 0,
    hints: 0,
    history: [],
    startedAt: 0,
    elapsed: 0,
    timer: 0,
    busy: false,
    finished: false,
    hovered: null,
  };

  // ---- 保存（ベストスコア・難易度） ----
  const store = {
    get(key) { try { return localStorage.getItem('tilepop.' + key); } catch { return null; } },
    set(key, v) { try { localStorage.setItem('tilepop.' + key, v); } catch { /* 保存できなくても遊べる */ } },
  };
  const bestScore = () => Number(store.get('best.' + state.level)) || 0;

  // ---- 盤面の開始 ----
  function newGame() {
    const lv = LEVELS[state.level];
    const g = L.generate(lv.cols, lv.rows, lv.colors);
    state.initial = g.board;
    state.solutionMap = g.solutionMap;
    startBoard(g.board);
    setStatus(`${lv.label}：${lv.cols}×${lv.rows}・${lv.colors}色。同じ色がつながった所をクリック！`);
  }

  function startBoard(board) {
    stopTimer();
    Object.assign(state, {
      board, score: 0, moves: 0, hints: 0, history: [], elapsed: 0, startedAt: 0,
      busy: false, finished: false, hovered: null,
    });
    boardEl.textContent = '';
    tileEls.clear();
    hideOverlay();
    layout();
    render();
    updateStats();
  }

  // ---- 描画 ----
  function layout() {
    const lv = LEVELS[state.level];
    const avail = Math.min(boardEl.parentElement.clientWidth, window.innerWidth - 32) - 20; // 枠と余白ぶん
    const cell = Math.max(22, Math.min(56, Math.floor(avail / lv.cols)));
    document.documentElement.style.setProperty('--cell', cell + 'px');
    boardEl.style.width = cell * lv.cols + 'px';
    boardEl.style.height = cell * lv.rows + 'px';
    state.cell = cell;
  }

  function createTile(t) {
    const el = document.createElement('div');
    el.className = 'tile enter';
    el.dataset.color = t.color;
    const face = document.createElement('div');
    face.className = 'face';
    face.textContent = SYMBOLS[t.color];
    el.appendChild(face);
    el.addEventListener('animationend', () => el.classList.remove('enter', 'shake', 'hint'));
    return el;
  }

  // 盤面の状態に DOM を合わせる。位置が変わったタイルは CSS の transition で落ちる/滑る
  function render() {
    const rows = LEVELS[state.level].rows;
    const cell = state.cell;
    const seen = new Set();
    state.board.forEach((col, c) => {
      col.forEach((t, y) => {
        seen.add(t.id);
        let el = tileEls.get(t.id);
        if (!el) {
          el = createTile(t);
          tileEls.set(t.id, el);
          boardEl.appendChild(el);
        }
        el.dataset.c = c;
        el.dataset.y = y;
        el.style.transform = `translate(${c * cell}px, ${(rows - 1 - y) * cell}px)`;
      });
    });
    for (const [id, el] of tileEls) {
      if (!seen.has(id)) {
        el.remove();
        tileEls.delete(id);
      }
    }
  }

  const elAt = (c, y) => tileEls.get(state.board[c][y].id);

  function updateStats() {
    $('score').textContent = state.score.toLocaleString();
    const best = bestScore();
    $('best').textContent = best ? best.toLocaleString() : '-';
    $('left').textContent = L.countTiles(state.board);
    $('moves').textContent = state.moves;
    $('time').textContent = fmtTime(state.elapsed);
    $('undoBtn').disabled = state.history.length === 0 || state.busy;
    $('hintBtn').disabled = state.finished || state.busy;
    document.querySelectorAll('.levels button').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.level === state.level));
    });
  }

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const setStatus = (msg) => { $('status').textContent = msg; };

  // ---- タイマー ----
  function startTimer() {
    if (state.timer) return;
    state.startedAt = Date.now() - state.elapsed * 1000;
    state.timer = setInterval(() => {
      state.elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
      $('time').textContent = fmtTime(state.elapsed);
    }, 250);
  }
  function stopTimer() {
    clearInterval(state.timer);
    state.timer = 0;
  }

  // ---- ハイライト ----
  function clearHighlight() {
    boardEl.querySelectorAll('.tile.hl').forEach((el) => el.classList.remove('hl'));
  }
  function highlightAt(c, y) {
    clearHighlight();
    if (state.busy || state.finished || !state.board[c] || !state.board[c][y]) return;
    const g = L.findGroup(state.board, c, y);
    if (g.length < 2) {
      setStatus('となりに同じ色がないので消せません');
      return;
    }
    g.forEach(([gc, gy]) => elAt(gc, gy).classList.add('hl'));
    setStatus(`${g.length} 個消せます（+${L.points(g.length)} 点）`);
  }

  // ---- 操作 ----
  function clickAt(c, y) {
    if (state.busy || state.finished) return;
    const g = L.findGroup(state.board, c, y);
    const el = elAt(c, y);
    if (g.length < 2) {
      el.classList.remove('shake');
      void el.offsetWidth; // アニメーションを再始動
      el.classList.add('shake');
      setStatus('となりに同じ色がないタイルは消せません');
      return;
    }
    startTimer();
    state.history.push({ board: state.board, score: state.score, moves: state.moves });
    const pts = L.points(g.length);
    state.score += pts;
    state.moves += 1;
    state.busy = true;
    clearHighlight();
    g.forEach(([gc, gy]) => elAt(gc, gy).classList.add('pop'));
    floatScore(g, pts);
    setStatus(`${g.length} 個消した！ +${pts} 点`);
    updateStats();

    setTimeout(() => {
      state.board = L.removeCells(state.board, g);
      render();
      updateStats();
      setTimeout(() => {
        state.busy = false;
        updateStats();
        checkEnd();
        if (!state.finished && state.hovered) highlightAt(...state.hovered);
      }, FALL_MS);
    }, POP_MS);
  }

  function floatScore(g, pts) {
    const rows = LEVELS[state.level].rows;
    const cx = g.reduce((s, [c]) => s + c, 0) / g.length;
    const cy = g.reduce((s, [, y]) => s + y, 0) / g.length;
    const el = document.createElement('div');
    el.className = 'float-score';
    el.textContent = '+' + pts;
    el.style.left = 6 + (cx + 0.5) * state.cell + 'px';
    el.style.top = 6 + (rows - 1 - cy + 0.5) * state.cell + 'px';
    el.addEventListener('animationend', () => el.remove());
    boardEl.appendChild(el);
  }

  function checkEnd() {
    if (state.board.length === 0) {
      state.finished = true;
      stopTimer();
      state.score += CLEAR_BONUS;
      const prevBest = bestScore();
      const isBest = state.score > prevBest;
      if (isBest) store.set('best.' + state.level, state.score);
      updateStats();
      setStatus('クリア！おめでとう！');
      showOverlay(isBest ? 'クリア！ 🎉 ベスト更新！' : 'クリア！ 🎉', [
        ['スコア', state.score.toLocaleString()],
        ['クリアボーナス', '+' + CLEAR_BONUS],
        ['手数', state.moves],
        ['時間', fmtTime(state.elapsed)],
        ['ヒント', state.hints + ' 回'],
      ], [
        ['もう一度（同じ盤面）', retry],
        ['次の盤面へ', newGame, true],
      ]);
    } else if (!L.hasMoves(state.board)) {
      state.finished = true;
      stopTimer();
      updateStats();
      setStatus('消せるタイルがなくなりました');
      showOverlay('手詰まり…', [
        ['残りタイル', L.countTiles(state.board)],
        ['スコア', state.score.toLocaleString()],
        ['手数', state.moves],
      ], [
        ['↶ 元に戻す', undo],
        ['やり直し', retry],
        ['新しい盤面', newGame, true],
      ]);
    }
  }

  function undo() {
    if (state.busy || !state.history.length) return;
    const prev = state.history.pop();
    state.board = prev.board;
    state.score = prev.score;
    state.moves = prev.moves;
    if (state.finished) {
      state.finished = false;
      hideOverlay();
      if (state.moves > 0) startTimer();
    }
    clearHighlight();
    render();
    updateStats();
    setStatus('1 手戻しました');
  }

  function retry() {
    if (!state.initial) return;
    startBoard(state.initial);
    setStatus('同じ盤面で最初からやり直します');
  }

  function hint() {
    if (state.busy || state.finished) return;
    const key = L.boardKey(state.board);
    let move = state.solutionMap.get(key);
    if (!move) {
      const res = L.solve(state.board, 700);
      if (res.path) {
        // 見つけた手順を覚えておき、次のヒントからはすぐ出せるようにする
        let b = state.board;
        for (const mv of res.path) {
          state.solutionMap.set(L.boardKey(b), mv);
          b = L.removeCells(b, L.findGroup(b, mv.c, mv.y));
        }
        move = res.path[0];
      } else {
        setStatus(res.timedOut
          ? 'クリアへの手順を見つけられませんでした。「元に戻す」で数手戻ると見つかるかもしれません'
          : 'この盤面からはクリアできません。「元に戻す」で戻ってみましょう');
        return;
      }
    }
    state.hints += 1;
    state.score = Math.max(0, state.score - HINT_PENALTY);
    updateStats();
    clearHighlight();
    L.findGroup(state.board, move.c, move.y).forEach(([c, y]) => {
      const el = elAt(c, y);
      el.classList.remove('hint');
      void el.offsetWidth;
      el.classList.add('hint');
    });
    setStatus(`ヒント：光っているタイルを消すとクリアに近づきます（−${HINT_PENALTY} 点）`);
  }

  function setLevel(level) {
    if (level === state.level) return;
    if (state.moves > 0 && !state.finished && !confirm('今のゲームを終了して難易度を変えますか？')) return;
    state.level = level;
    store.set('level', level);
    newGame();
  }

  // ---- オーバーレイ ----
  function showOverlay(title, rows, actions) {
    $('ovTitle').textContent = title;
    const dl = $('ovBody');
    dl.textContent = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
    const box = $('ovActions');
    box.textContent = '';
    for (const [label, fn, primary] of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.addEventListener('click', fn);
      box.appendChild(b);
    }
    $('overlay').hidden = false;
    box.lastChild.focus();
  }
  function hideOverlay() { $('overlay').hidden = true; }

  // ---- イベント ----
  const tileFromEvent = (e) => {
    const el = e.target.closest('.tile');
    return el && !el.classList.contains('pop') ? [Number(el.dataset.c), Number(el.dataset.y)] : null;
  };

  boardEl.addEventListener('click', (e) => {
    const pos = tileFromEvent(e);
    if (pos) clickAt(...pos);
  });
  boardEl.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const pos = tileFromEvent(e);
    state.hovered = pos;
    if (pos) highlightAt(...pos);
  });
  boardEl.addEventListener('pointerleave', () => {
    state.hovered = null;
    clearHighlight();
  });

  $('undoBtn').addEventListener('click', undo);
  $('hintBtn').addEventListener('click', hint);
  $('retryBtn').addEventListener('click', () => {
    if (state.moves > 0 && !state.finished && !confirm('同じ盤面を最初からやり直しますか？')) return;
    retry();
  });
  $('newBtn').addEventListener('click', () => {
    if (state.moves > 0 && !state.finished && !confirm('新しい盤面にしますか？（今のゲームは終了します）')) return;
    newGame();
  });
  document.querySelectorAll('.levels button').forEach((b) => {
    b.addEventListener('click', () => setLevel(b.dataset.level));
  });

  document.addEventListener('keydown', (e) => {
    if (e.altKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === 'z' || (e.ctrlKey && k === 'z')) { e.preventDefault(); undo(); }
    else if (e.ctrlKey) return;
    else if (k === 'h') hint();
    else if (k === 'r') $('retryBtn').click();
    else if (k === 'n') $('newBtn').click();
  });

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => { layout(); render(); });
  });

  // ---- 起動 ----
  const savedLevel = store.get('level');
  if (savedLevel && LEVELS[savedLevel]) state.level = savedLevel;
  newGame();
})();
