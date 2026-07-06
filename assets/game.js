/* =============================================
   Рисовалка — Game Logic v2
   Timers, description phase, lobby browser
   ============================================= */
(function () {
  'use strict';

  /* =============================================
     CONSTANTS
     ============================================= */
  const PLAYER_COLORS = [
    '#E8614D', '#3D5A80', '#E9C46A', '#9B59B6', '#2ECC71',
  ];
  const BOT_NAMES = [
    'Пушистик', 'Робо-Кот', 'Капитан Краб', 'Зигзаг',
    'Ниндзя-Черепаха', 'Лисёнок', 'Банановый Смузи', 'Мистер Пропеллер',
    'Панда-Панк', 'Космический Енот',
  ];
  const BOT_PROMPTS = [
    'кот в космосе', 'робот-пицца', 'летающий дракон', 'подводный замок',
    'единорог на радуге', 'танцующий банан', 'супергерой-белка', 'пингвин на пляже',
    'динозавр с очками', 'шоколадная гора', 'космическая медуза', 'робот-няня',
    'собака-астронавт', 'чайник-трансформер', 'летающий диван',
    'кактус в шляпе', 'ракета-морковка', 'осьминог-музыкант', 'луна из сыра',
    'пират-пингвин',
  ];
  const BOT_DESCS = [
    'Это рисунок на тему космоса и приключений. Видно, что автор вдохновлялся научной фантастикой.',
    'Очень абстрактно, но чувствуется энергия. Кажется, тут изображено что-то из мира животных.',
    'Яркие цвета и необычные формы. Напоминает современное искусство.',
    'Мне кажется, здесь изображён какой-то фантастический персонаж. Мило и забавно!',
    'Интересная композиция. Чувствуется влияние поп-культуры и аниме.',
    'Очень экспрессивно! Видно, что художник экспериментировал с формой.',
    'Напоминает детские рисунки — искренне и непосредственно. Мне нравится!',
    'Тут явно что-то связанное с технологиями и будущим. Футуристично!',
    'Красивый рисунок! Чувствуется настроение и характер.',
    'Забавный сюжет. Видно, что автор подошёл с юмором.',
    'Это напоминает мне сон — немного сюрреалистично, но очень образно.',
    'Динамичная композиция! Чувствуется движение и энергия.',
    'Очень стильно. Минималистично, но со вкусом.',
    'Кажется, тут спрятана какая-то история. Хочется рассматривать детали.',
    'Теплый и уютный рисунок. Вызывает улыбку!',
    'Смелый эксперимент с цветом. Необычно и свежо!',
    'Наивно, но очаровательно. В этом есть свой шарм!',
    'Очень фактурно. Чувствуется, что автор старался передать объём.',
    'Загадочный рисунок. Есть что-то мистическое в этом образе.',
    'Весёлый и жизнерадостный. Поднимает настроение!',
  ];

  const PALETTE = [
    '#1A1A2E', '#E8614D', '#3D5A80', '#E9C46A',
    '#6BBF59', '#9B59B6', '#F39C12', '#2C3E50',
  ];
  const PEN_SIZES = [
    { v: 2, css: '6px' },
    { v: 5, css: '10px' },
    { v: 10, css: '16px' },
    { v: 18, css: '24px' },
  ];
  const CANVAS_W = 640;
  const CANVAS_H = 400;
  const MAX_CHUNK_BYTES = 3500;
  const DRAW_DURATION = 350000;  // 350s
  const DESC_DURATION = 30000;   // 30s
  const PROMPT_DURATION = 60000; // 60s

  /* =============================================
     STATE
     ============================================= */
  const S = {
    // Online
    myId: null,
    myName: '',
    isHost: false,
    players: {},        // { id: { name, color } }
    hostId: null,
    roomCode: null,

    // Offline
    offlinePlayers: [],

    // Game
    mode: null,         // 'online' | 'offline'
    phase: 'lobby',
    myPrompt: '',
    myAssignment: null, // { promptText, authorId }
    assignments: [],    // [{ playerId, promptText, authorId }]
    promptsDone: {},    // { playerId: text }
    playersDone: [],    // [playerId] — кто сдал рисунок (completed chunks)
    drawingDoneMap: {}, // { playerId: true } — кто отправил drawing_done
    playerOrder: [],    // shuffled player IDs

    // Drawings
    drawings: {},       // { playerId: imageData (complete) }
    drawingChunks: {},  // { playerId: [chunk, ...] }
    drawingChunksTotal: {}, // { playerId: N }
    myDrawingData: null,
    drawingDone: false,

    // Timers
    drawTimerEnd: 0,
    descTimerEnd: 0,
    promptTimerEnd: 0,
    timerInterval: null,
    promptDone: false,

    // Description phase (online)
    descriptions: {},     // { drawerPlayerId: "текст" }
    myDescTarget: null,   // drawingPlayerId чей рисунок описывает этот клиент
    descDone: false,
    descDoneMap: {},      // { playerId: true }
    descAssignments: {},

    // Canvas
    currentPlayerIdx: 0,
    canDraw: false,

    // Play again
    playAgainReady: {},
  };

  var pendingPhase = null;

  /* =============================================
     TIMER HELPERS
     ============================================= */
  function formatTimer(sec) {
    if (sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateTimerDisplay(endTime, timerEl, onEnd) {
    if (!timerEl) return;
    var remaining = Math.max(0, endTime - Date.now());
    var sec = Math.ceil(remaining / 1000);
    timerEl.textContent = formatTimer(sec);

    timerEl.className = timerEl.className.replace(/timer-\w+/g, '');
    if (sec <= 10) timerEl.classList.add('timer-urgent');
    else if (sec <= 60) timerEl.classList.add('timer-warn');

    if (sec <= 0 && onEnd) onEnd();
  }

  function startTimer(endTime, timerEl, onEnd) {
    stopTimer();
    updateTimerDisplay(endTime, timerEl, onEnd);
    S.timerInterval = setInterval(function () {
      updateTimerDisplay(endTime, timerEl, onEnd);
      if (Date.now() >= endTime) stopTimer();
    }, 333);
  }

  function stopTimer() {
    if (S.timerInterval) {
      clearInterval(S.timerInterval);
      S.timerInterval = null;
    }
  }

  /* =============================================
     DOM REFS
     ============================================= */
  function $(id) { return document.getElementById(id); }

  const D = {};
  function cacheDom() {
    D.screens = {
      lobby:    $('scr-lobby'),
      offline:  $('scr-offline'),
      waitHost: $('scr-wait-host'),
      prompt:   $('scr-prompt'),
      promptWait: $('scr-prompt-wait'),
      drawing:  $('scr-drawing'),
      drawWait: $('scr-draw-wait'),
      desc:     $('scr-desc'),
      descWait: $('scr-desc-wait'),
      reveal:   $('scr-reveal'),
    };
    // Lobby
    D.lobbyName  = $('lobby-name');
    D.lobbyCreateBtn = $('lobby-create-btn');
    D.lobbySearchBtn = $('lobby-search-btn');
    D.lobbyStart = $('lobby-start');
    D.lobbyList  = $('lobby-player-list');
    D.lobbyStatus = $('lobby-status');
    D.lobbyOfflineBtn = $('lobby-offline-btn');
    D.lobbyBrowser = $('lobby-browser');
    D.lobbyBrowserList = $('lobby-browser-list');
    D.lobbyBrowserStatus = $('lobby-browser-status');
    D.lobbyJoinRoom = $('lobby-join-room');
    D.lobbyJoinBtn = $('lobby-join-btn');
    D.lobbyRoomInfo = $('lobby-room-info');
    D.lobbyRoomCode = $('lobby-room-code');
    // Wait host
    D.waitHostText = $('wait-host-text');
    // Prompt
    D.promptName = $('prompt-name');
    D.promptInput = $('prompt-input');
    D.promptSubmit = $('prompt-submit');
    D.promptTimer = $('prompt-timer');
    D.promptWaitText = $('prompt-wait-text');
    // Drawing
    D.drawName = $('draw-name');
    D.drawPrompt = $('draw-prompt');
    D.drawCanvas = $('draw-canvas');
    D.drawPalette = $('draw-palette');
    D.drawSizes = $('draw-sizes');
    D.drawUndo = $('draw-undo');
    D.drawClear = $('draw-clear');
    D.drawEraser = $('draw-eraser');
    D.drawSubmit = $('draw-submit');
    D.drawWaitText = $('draw-wait-text');
    D.drawTimer = $('draw-timer');
    // Desc
    D.descInput = $('desc-input');
    D.descSubmit = $('desc-submit');
    D.descTimer = $('desc-timer');
    D.descDrawingImg = $('desc-drawing-img');
    D.descWaitText = $('desc-wait-text');
    // Reveal
    D.revealGrid = $('reveal-grid');
    D.revealAgain = $('reveal-again');
    D.revealExit = $('reveal-exit');
    D.playAgainCount = $('play-again-count');
    // Offline
    D.offScreen = $('scr-offline');
    D.offNameInput = $('off-name-input');
    D.offAddBtn = $('off-add-btn');
    D.offPlayerList = $('off-player-list');
    D.offStartBtn = $('off-start-btn');
  }

  /* =============================================
     SCREEN MANAGER
     ============================================= */
  function showScreen(name) {
    Object.values(D.screens).forEach(function (s) { if (s) s.classList.remove('active'); });
    var target = D.screens[name];
    if (target) {
      target.classList.add('active');
      void target.offsetWidth;
    }
    S.phase = name;
  }

  /* =============================================
     HELPERS
     ============================================= */
  function esc(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function hasSelfAssign(plist, pOrder, prompts) {
    for (var i = 0; i < pOrder.length; i++) {
      var pid = pOrder[i];
      if (prompts[i] && prompts[i].playerId === pid) return true;
    }
    return false;
  }

  function playerColor(id) {
    var idx = 0;
    var keys = Object.keys(S.players).sort();
    var pos = keys.indexOf(String(id));
    return pos >= 0 ? PLAYER_COLORS[pos % PLAYER_COLORS.length] : '#999';
  }

  function playerName(id) {
    var p = S.players[id];
    return p ? p.name : '#' + id;
  }

  function playerColorById(id) {
    var keys = Object.keys(S.players);
    var pos = keys.indexOf(String(id));
    return PLAYER_COLORS[(pos >= 0 ? pos : keys.length) % PLAYER_COLORS.length];
  }

  function notify(msg) {
    console.log('[Рисовалка]', msg);
  }

  /* =============================================
     LOBBY BROWSER
     ============================================= */
  S._heartbeatActive = false;

  function lobbyCreateRoom() {
    var name = D.lobbyName.value.trim();
    if (!name) { D.lobbyName.focus(); return; }

    // Generate 6-char room code (no ambiguous chars)
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var code = '';
    for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];

    S.roomCode = code;
    S.myName = name;
    S.mode = 'online';

    joinRoom(code, true);
  }

  function lobbySearchRooms() {
    var name = D.lobbyName.value.trim();
    if (!name) { D.lobbyName.focus(); return; }

    S.myName = name;
    S.mode = 'online';

    // Показываем браузер
    D.lobbyBrowser.style.display = '';
    D.lobbyBrowserList.innerHTML = '<p style="text-align:center;color:var(--text-tertiary);padding:12px">Поиск комнат...</p>';
    D.lobbyBrowserStatus.textContent = 'Поиск...';

    MasykaSDK.init().then(function () {
      MasykaSDK.onLobbyUpdate(function (rooms) {
        renderLobbyBrowser(rooms);
      });
      MasykaSDK.queryLobbies().then(function (rooms) {
        renderLobbyBrowser(rooms);
        if (rooms.length === 0) {
          D.lobbyBrowserStatus.textContent = 'Комнат не найдено. Введи код вручную.';
        } else {
          D.lobbyBrowserStatus.textContent = 'Найдено комнат: ' + rooms.length;
        }
      });
    });
  }

  function renderLobbyBrowser(rooms) {
    if (rooms.length === 0) {
      D.lobbyBrowserList.innerHTML = '<p style="text-align:center;color:var(--text-tertiary);padding:12px">Нет активных комнат</p>';
      return;
    }
    D.lobbyBrowserList.innerHTML = rooms.map(function (r) {
      return '<div class="lobby-room-row" data-room="' + esc(r.roomCode) + '">' +
        '<div class="room-info">' +
        '<span class="room-name">' + esc(r.roomName) + '</span>' +
        '<span class="room-meta">' + r.playerCount + '/' + r.maxPlayers + ' · хост: ' + esc(r.hostName || '-') + '</span>' +
        '</div>' +
        '<button class="btn btn-secondary room-join-btn" data-room="' + esc(r.roomCode) + '">Войти</button>' +
        '</div>';
    }).join('');

    // Click handlers
    D.lobbyBrowserList.querySelectorAll('.room-join-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        joinRoom(btn.dataset.room, false);
      });
    });
    D.lobbyBrowserList.querySelectorAll('.lobby-room-row').forEach(function (row) {
      row.addEventListener('click', function () {
        joinRoom(row.dataset.room, false);
      });
    });
  }

  function lobbyJoinByCode() {
    var room = D.lobbyJoinRoom.value.trim();
    if (room) joinRoom(room, false);
  }

  function joinRoom(room, amHost) {
    D.lobbyBrowser.style.display = 'none';

    MasykaSDK.init().then(function () {
      return MasykaSDK.mpJoin(room);
    }).then(function (res) {
      if (!res.ok) {
        notify('Ошибка: ' + (res.error || 'неизвестная'));
        return;
      }

      S.myId = res.playerId;
      S.roomCode = room;
      S.players = {};
      S.players[S.myId] = { name: S.myName, color: playerColorById(S.myId) };

      setupOnlineListeners();

      MasykaSDK.mpSend({ type: 'join', name: S.myName, hostId: amHost ? S.myId : undefined });

      if (amHost) {
        S.hostId = S.myId;
        S.isHost = true;
        // Запускаем heartbeat
        MasykaSDK.startHeartbeat({
          roomCode: room,
          roomName: room,
          maxPlayers: 5,
          hostName: S.myName,
          getPlayerCount: function () { return Object.keys(S.players).length; }
        });
        S._heartbeatActive = true;
      } else {
        S.hostId = null;
        S.isHost = false;
      }

      onlineRenderLobby();
      if (amHost) onlineCheckHost();
    });
  }

  /* =============================================
     =============================================
     OFFLINE (BOT) MODE
     =============================================
     ============================================= */

  function makeBotName(used) {
    var pool = BOT_NAMES.filter(function (n) { return used.indexOf(n) < 0; });
    return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : 'Бот#' + (used.length + 1);
  }

  function makeBotPrompt() {
    return BOT_PROMPTS[Math.floor(Math.random() * BOT_PROMPTS.length)];
  }

  function makeBotDesc() {
    return BOT_DESCS[Math.floor(Math.random() * BOT_DESCS.length)];
  }

  /* ---- Offline: render bot list ---- */
  function offRenderBotPreview(humanName) {
    var names = [humanName];
    for (var i = 0; i < 4; i++) names.push(makeBotName(names));
    D.offPlayerList.innerHTML = names.map(function (n, i) {
      var c = PLAYER_COLORS[i % PLAYER_COLORS.length];
      var label = i === 0 ? ' — это ты' : ' — бот';
      return '<span class="tag tag-sm" style="background:' + c + '20;color:' + c + '">' +
        '<span class="dot" style="background:' + c + '"></span>' +
        esc(n) + '<span style="opacity:0.5;font-size:0.75rem">' + label + '</span></span>';
    }).join('');
  }

  /* ---- Offline: start game ---- */
  function offStartGame() {
    var humanName = D.offNameInput.value.trim();
    if (!humanName) { D.offNameInput.focus(); return; }

    // Генерируем 4 ботов
    var allNames = [humanName];
    for (var i = 0; i < 4; i++) allNames.push(makeBotName(allNames));
    S.offlinePlayers = allNames.map(function (name, i) {
      return { id: i, name: name, isBot: i > 0 };
    });

    S.players = {};
    S.offlinePlayers.forEach(function (p) {
      S.players[p.id] = { name: p.name, color: PLAYER_COLORS[p.id % PLAYER_COLORS.length] };
    });
    S.mode = 'offline';
    S.currentPlayerIdx = 0;
    S.promptsDone = {};
    S.assignments = [];
    S.playersDone = [];
    S.drawings = {};
    S.descriptions = {};
    S.myAssignment = null;
    S.myDrawingData = null;
    offNextTurn();
  }

  /* ---- Offline: advance to next turn / phase ---- */
  function offNextTurn() {
    var promptsDone = Object.keys(S.promptsDone).length;
    var allPromptsDone = promptsDone >= S.offlinePlayers.length;
    var allDrawingsDone = Object.keys(S.drawings).length >= S.offlinePlayers.length;
    var descPhase = allPromptsDone && S.assignments.length > 0 && allDrawingsDone;

    if (!allPromptsDone) {
      // Prompt phase
      offShowPrompt();
    } else if (S.assignments.length === 0) {
      // Just finished prompts → shuffle
      offDoShuffle();
    } else if (!allDrawingsDone) {
      // Drawing phase
      offShowDrawing();
    } else if (!descPhase) {
      // Shouldn't happen, but just in case
      offDoDescShuffle();
    } else {
      // Description phase
      offShowDesc();
    }
  }

  /* ---- Offline: prompt ---- */
  function offShowPrompt() {
    var player = S.offlinePlayers[S.currentPlayerIdx];
    if (player.isBot) {
      // Бот автоматически придумывает тему
      showScreen('promptWait');
      D.promptWaitText.textContent = esc(player.name) + ' придумывает тему...';
      setTimeout(function () {
        var text = makeBotPrompt();
        S.promptsDone[player.id] = text;
        S.currentPlayerIdx++;
        offNextTurn();
      }, 600 + Math.random() * 600);
      return;
    }

    showScreen('prompt');
    D.promptName.textContent = player.name;
    D.promptName.style.color = PLAYER_COLORS[player.id % PLAYER_COLORS.length];
    D.promptInput.value = '';
    D.promptInput.focus();
    D.promptSubmit.disabled = false;
    D.promptSubmit.textContent = 'Готово';
    D.promptSubmit.onclick = offSubmitPrompt;
  }

  function offSubmitPrompt() {
    var text = D.promptInput.value.trim();
    if (!text) return;
    var player = S.offlinePlayers[S.currentPlayerIdx];
    S.promptsDone[player.id] = text;
    S.currentPlayerIdx++;
    showScreen('promptWait');
    D.promptWaitText.textContent = 'Отлично! Ждём ботов...';
    setTimeout(function () { offNextTurn(); }, 400);
  }

  /* ---- Offline: shuffle & assign ---- */
  function offDoShuffle() {
    showScreen('promptWait');
    D.promptWaitText.textContent = 'Перемешиваем темы...';

    setTimeout(function () {
      var pList = Object.keys(S.promptsDone).map(function (pid) {
        return { playerId: Number(pid), text: S.promptsDone[pid] };
      });
      var order = S.offlinePlayers.map(function (p) { return p.id; });
      var attempts = 0;

      do {
        shuffle(pList);
        attempts++;
      } while (attempts < 100 && hasSelfAssign(pList, order, pList));

      S.assignments = order.map(function (pid, idx) {
        return { playerId: pid, promptText: pList[idx].text, authorId: pList[idx].playerId };
      });

      S.currentPlayerIdx = 0;
      offNextTurn();
    }, 500);
  }

  /* ---- Bot drawing generator ---- */
  function generateBotDrawing() {
    var c = document.createElement('canvas');
    c.width = CANVAS_W;
    c.height = CANVAS_H;
    var ctx = c.getContext('2d');

    // Белый фон
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Рисуем случайные каракули
    var lines = 6 + Math.floor(Math.random() * 12);
    var colors = ['#1A1A2E','#E8614D','#3D5A80','#E9C46A','#6BBF59','#9B59B6','#F39C12','#2C3E50'];
    for (var i = 0; i < lines; i++) {
      ctx.strokeStyle = colors[Math.floor(Math.random() * colors.length)];
      ctx.lineWidth = 2 + Math.random() * 14;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      var x = Math.random() * CANVAS_W;
      var y = Math.random() * CANVAS_H;
      ctx.moveTo(x, y);
      var pts = 3 + Math.floor(Math.random() * 8);
      for (var p = 0; p < pts; p++) {
        if (Math.random() > 0.4) {
          ctx.lineTo(Math.random() * CANVAS_W, Math.random() * CANVAS_H);
        } else {
          ctx.quadraticCurveTo(
            Math.random() * CANVAS_W, Math.random() * CANVAS_H,
            Math.random() * CANVAS_W, Math.random() * CANVAS_H
          );
        }
      }
      ctx.stroke();
    }

    // Иногда добавляем заливки
    var shapes = Math.floor(Math.random() * 4);
    for (var s = 0; s < shapes; s++) {
      ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
      ctx.globalAlpha = 0.15 + Math.random() * 0.3;
      ctx.beginPath();
      ctx.arc(Math.random() * CANVAS_W, Math.random() * CANVAS_H, 10 + Math.random() * 60, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    return c.toDataURL('image/jpeg', 0.7);
  }

  /* ---- Offline: drawing ---- */
  function offShowDrawing() {
    var player = S.offlinePlayers[S.currentPlayerIdx];
    var assign = S.assignments.find(function (a) { return a.playerId === player.id; });
    if (!assign) return;

    if (player.isBot) {
      // Бот автоматически рисует
      showScreen('drawWait');
      D.drawWaitText.textContent = esc(player.name) + ' рисует...';
      setTimeout(function () {
        S.drawings[player.id] = generateBotDrawing();
        S.currentPlayerIdx++;
        if (S.currentPlayerIdx >= S.offlinePlayers.length) {
          offDoDescShuffle();
        } else {
          offNextTurn();
        }
      }, 800 + Math.random() * 800);
      return;
    }

    var author = S.players[assign.authorId];
    showScreen('drawing');
    D.drawName.textContent = player.name;
    D.drawName.style.color = PLAYER_COLORS[player.id % PLAYER_COLORS.length];
    D.drawPrompt.innerHTML = 'Рисует: <strong>«' + esc(assign.promptText) + '»</strong>' +
      (author ? ' — тема <span style="color:' + esc(author.color) + '">' + esc(author.name) + '</span>' : '');
    D.drawTimer.textContent = '120';

    D.drawSubmit.textContent = 'Готово!';
    D.drawSubmit.disabled = false;
    D.drawSubmit.onclick = offSubmitDrawing;
    S.drawingDone = false;
    S.canDraw = true;
    stopTimer();

    setTimeout(function () { initCanvas(); }, 50);
  }

  /* ---- Offline: submit drawing ---- */
  function offSubmitDrawing() {
    var player = S.offlinePlayers[S.currentPlayerIdx];
    var imageData = D.drawCanvas.toDataURL('image/jpeg', 0.7);
    S.drawings[player.id] = imageData;
    S.currentPlayerIdx++;

    showScreen('drawWait');
    D.drawWaitText.textContent = 'Рисунок готов! Ждём ботов...';

    setTimeout(function () {
      if (S.currentPlayerIdx >= S.offlinePlayers.length) {
        offDoDescShuffle();
      } else {
        offNextTurn();
      }
    }, 400);
  }

  /* ---- Offline: description shuffle ---- */
  function offDoDescShuffle() {
    showScreen('descWait');
    D.descWaitText.textContent = 'Перемешиваем для описаний...';

    setTimeout(function () {
      var ids = S.offlinePlayers.map(function (p) { return p.id; });
      var shuffled = ids.slice();
      var attempts = 0;
      do {
        shuffle(shuffled);
        attempts++;
      } while (attempts < 100 && shuffled.some(function (id, i) { return id === ids[i]; }));

      S.descAssignments = {};
      ids.forEach(function (pid, i) {
        S.descAssignments[pid] = shuffled[i];
      });

      S.currentPlayerIdx = 0;
      offNextTurn();
    }, 500);
  }

  /* ---- Offline: description ---- */
  function offShowDesc() {
    var player = S.offlinePlayers[S.currentPlayerIdx];
    var drawingId = S.descAssignments[player.id];
    if (drawingId === undefined) return;

    if (player.isBot) {
      // Бот автоматически описывает
      showScreen('descWait');
      D.descWaitText.textContent = esc(player.name) + ' описывает рисунок...';
      setTimeout(function () {
        S.descriptions[drawingId] = makeBotDesc();
        S.currentPlayerIdx++;
        if (S.currentPlayerIdx >= S.offlinePlayers.length) {
          offShowReveal();
        } else {
          offNextTurn();
        }
      }, 600 + Math.random() * 600);
      return;
    }

    showScreen('desc');
    D.descDrawingImg.src = S.drawings[drawingId] || '';
    D.descInput.value = '';
    D.descInput.focus();
    D.descSubmit.disabled = false;
    D.descSubmit.textContent = 'Готово';
    D.descSubmit.onclick = offSubmitDesc;
    stopTimer();
    D.descTimer.textContent = '00:30';
  }

  function offSubmitDesc() {
    var player = S.offlinePlayers[S.currentPlayerIdx];
    var drawingId = S.descAssignments[player.id];
    var text = D.descInput.value.trim();
    S.descriptions[drawingId] = text;
    S.currentPlayerIdx++;

    showScreen('descWait');
    D.descWaitText.textContent = 'Ждём ботов...';

    setTimeout(function () {
      if (S.currentPlayerIdx >= S.offlinePlayers.length) {
        offShowReveal();
      } else {
        offNextTurn();
      }
    }, 400);
  }

  /* ---- Offline: reveal ---- */
  function offShowReveal() {
    S.playAgainReady = {};
    D.revealAgain.disabled = false;
    D.revealAgain.textContent = 'Сыграть ещё';
    D.playAgainCount.textContent = '';
    buildReveal();
    showScreen('reveal');
  }

  /* =============================================
     =============================================
     ONLINE (MULTIPLAYER) MODE
     =============================================
     ============================================= */

  /* ---- Online: listeners ---- */
  function setupOnlineListeners() {
    MasykaSDK.onMpMessage(function (from, data) {
      if (!data || !data.type) return;

      if (data.type === 'join') {
        // Всегда обновляем имя (onMpPeerJoined мог создать запись раньше)
        var jName = data.name || '#' + from;
        if (!S.players[from]) {
          S.players[from] = { name: jName, color: playerColorById(from) };
        } else {
          S.players[from].name = jName;
        }
        // Хост определяется только тем, кто создал комнату
        if (data.hostId) {
          S.hostId = data.hostId;
        }
        onlineRenderLobby();
        onlineCheckHost();
        MasykaSDK.updateHeartbeatPlayers(Object.keys(S.players).length);
      }

      switch (data.type) {
        case 'join': break;
        case 'player_list': onlineHandlePlayerList(data); break;
        case 'game_start': onlineHandleGameStart(data); break;
        case 'prompt': onlineHandlePrompt(from, data); break;
        case 'drawing_phase': onlineHandleDrawingPhase(data); break;
        case 'drawing_done': onlineHandleDrawingDone(from); break;
        case 'drawing_announce': S.drawingChunksTotal[data.playerId] = data.totalChunks; break;
        case 'drawing_chunk': onlineHandleChunk(from, data); break;
        case 'desc_phase': onlineHandleDescPhase(data); break;
        case 'desc_text': onlineHandleDescText(from, data); break;
        case 'phase': onlineHandlePhase(data); break;
        case 'play_again': onlineHandlePlayAgain(from); break;
      }
    });

    MasykaSDK.onMpPeerJoined(function (id) {
      if (!S.players[id]) {
        S.players[id] = { name: '#' + id, color: playerColorById(id) };
      }
      onlineRenderLobby();
      onlineCheckHost();
      MasykaSDK.updateHeartbeatPlayers(Object.keys(S.players).length);

      // Хост отправляет новому игроку список всех участников с их именами
      if (S.isHost) {
        var list = {};
        Object.keys(S.players).forEach(function (pid) {
          if (String(pid) !== String(id)) {
            list[pid] = S.players[pid].name;
          }
        });
        if (Object.keys(list).length > 0) {
          MasykaSDK.mpSend({ type: 'player_list', players: list, hostId: S.hostId });
        }
      }
    });

    MasykaSDK.onMpPeerLeft(function (id) {
      delete S.players[id];
      onlineRenderLobby();
      onlineCheckHost();
      MasykaSDK.updateHeartbeatPlayers(Object.keys(S.players).length);
    });

    MasykaSDK.onPause(function () { S.canDraw = false; });
    MasykaSDK.onResume(function () { S.canDraw = true; });
  }

  /* ---- Online: check host ---- */
  function onlineCheckHost() {
    var ids = Object.keys(S.players);
    if (ids.length === 0) return;

    // Если хост покинул комнату — сбрасываем
    if (S.hostId && !S.players[S.hostId]) {
      S.hostId = null;
    }

    S.isHost = S.hostId ? String(S.myId) === String(S.hostId) : false;

    if (S.isHost) {
      D.lobbyStart.style.display = '';
      D.lobbyStatus.innerHTML =
        'Ты <span class="host-badge">ХОСТ</span> — можешь начать игру';
    } else if (S.hostId) {
      D.lobbyStart.style.display = 'none';
      D.lobbyStatus.innerHTML = 'Ожидаем хоста...';
    } else {
      D.lobbyStart.style.display = 'none';
      D.lobbyStatus.innerHTML = 'Подключение...';
    }
    onlineRenderLobby();
  }

  /* ---- Online: render lobby ---- */
  function onlineRenderLobby() {
    // Показываем код комнаты
    if (S.roomCode) {
      D.lobbyRoomInfo.style.display = '';
      D.lobbyRoomCode.textContent = S.roomCode;
      // Прячем кнопки создания/поиска
      D.lobbyCreateBtn.style.display = 'none';
      D.lobbySearchBtn.style.display = 'none';
    }

    D.lobbyList.innerHTML = Object.keys(S.players).sort().map(function (id) {
      var p = S.players[id];
      var isH = String(id) === String(S.hostId);
      return '<span class="tag" style="background:' + p.color + '20;color:' + p.color + '">' +
        '<span class="dot" style="background:' + p.color + '"></span>' +
        esc(p.name) +
        (isH ? ' <span class="host-badge" style="font-size:0.7rem;background:var(--accent-gold);padding:1px 6px;border-radius:999px;margin-left:3px">HOST</span>' : '') +
        '</span>';
    }).join('');

    var count = Object.keys(S.players).length;
    D.lobbyStart.disabled = count < 2;
  }

  /* ---- Online: handle player_list ---- */
  function onlineHandlePlayerList(data) {
    if (!data.players) return;
    Object.keys(data.players).forEach(function (pid) {
      if (!S.players[pid]) {
        S.players[pid] = { name: data.players[pid], color: playerColorById(pid) };
      } else {
        // Обновляем имя (было временное #id)
        S.players[pid].name = data.players[pid];
      }
    });
    if (data.hostId) {
      S.hostId = data.hostId;
    }
    onlineRenderLobby();
    onlineCheckHost();
  }

  /* ---- Online: host starts game ---- */
  function onlineStartGame() {
    if (!S.isHost) return;
    var playerList = {};
    Object.keys(S.players).forEach(function (id) {
      playerList[id] = S.players[id].name;
    });
    var ids = Object.keys(S.players);
    var order = shuffle(ids.slice());

    // Останавливаем heartbeat (игра началась)
    MasykaSDK.stopHeartbeat();
    S._heartbeatActive = false;

    MasykaSDK.mpSend({
      type: 'game_start',
      players: playerList,
      playerOrder: order,
      promptEndTime: Date.now() + PROMPT_DURATION,
    });

    onlineHandleGameStart({ players: playerList, playerOrder: order, promptEndTime: Date.now() + PROMPT_DURATION });
  }

  /* ---- Online: handle game start ---- */
  function onlineHandleGameStart(data) {
    if (data.players) {
      Object.keys(data.players).forEach(function (id) {
        if (!S.players[id]) {
          S.players[id] = { name: data.players[id], color: playerColorById(id) };
        }
      });
    }
    S.playerOrder = data.playerOrder || Object.keys(S.players);
    S.playAgainReady = {};
    S.promptsDone = {};
    S.assignments = [];
    S.playersDone = [];
    S.drawingChunks = {};
    S.drawingChunksTotal = {};
    S.drawings = {};
    S.descriptions = {};
    S.drawingDoneMap = {};
    S.descDoneMap = {};
    S.myPrompt = '';
    S.myAssignment = null;
    S.myDescTarget = null;
    S.promptDone = false;
    stopTimer();

    showPromptEntry();

    if (data.promptEndTime) {
      S.promptTimerEnd = data.promptEndTime;
      startTimer(data.promptEndTime, D.promptTimer, function () {
        if (!S.promptDone) autoSubmitPrompt();
      });
    }
  }

  /* ---- Online: prompt entry ---- */
  function showPromptEntry() {
    showScreen('prompt');
    D.promptName.textContent = S.myName;
    D.promptName.style.color = playerColor(S.myId);
    D.promptInput.value = '';
    D.promptInput.focus();
    D.promptSubmit.disabled = false;
    D.promptSubmit.textContent = 'Готово';
    D.promptSubmit.onclick = onlineSubmitPrompt;
  }

  /* ---- Online: submit prompt ---- */
  function onlineSubmitPrompt() {
    var text = D.promptInput.value.trim();
    if (!text || S.promptDone) return;
    S.promptDone = true;
    S.myPrompt = text;
    S.promptsDone[S.myId] = text;
    MasykaSDK.mpSend({ type: 'prompt', text: text });
    D.promptSubmit.disabled = true;

    stopTimer();
    showScreen('promptWait');
    updatePromptWaitText();

    // Если хост отправил последним — проверяем сами (mock SDK не доставляет себе сообщения)
    if (S.isHost) tryStartDrawingPhase();
  }

  /* ---- Online: update prompt wait counter ---- */
  function updatePromptWaitText() {
    var total = S.playerOrder ? S.playerOrder.length : 0;
    var done = Object.keys(S.promptsDone).length;
    D.promptWaitText.textContent = 'Ввели тему: ' + done + ' из ' + total;
  }

  /* ---- Online: auto-submit prompt on timer expiry ---- */
  function autoSubmitPrompt() {
    if (S.promptDone) return;
    S.promptDone = true;
    D.promptSubmit.disabled = true;
    D.promptSubmit.textContent = 'Время вышло';
    var text = D.promptInput.value.trim();
    if (text) {
      S.myPrompt = text;
      S.promptsDone[S.myId] = text;
      MasykaSDK.mpSend({ type: 'prompt', text: text });
      if (S.isHost) tryStartDrawingPhase();
    }
    stopTimer();
    showScreen('promptWait');
    updatePromptWaitText();
    D.promptWaitText.textContent = text ? 'Время вышло, ждём остальных...' : 'Вы не ввели тему, ждём остальных...';
  }

  /* ---- Online: handle prompt ---- */
  function onlineHandlePrompt(from, data) {
    S.promptsDone[from] = data.text;
    updatePromptWaitText();
    if (S.isHost) tryStartDrawingPhase();
  }

  /* ---- Online: try start drawing phase (host only) ---- */
  function tryStartDrawingPhase() {
    if (!S.isHost) return;
    var totalPlayers = S.playerOrder.length;
    var submitted = Object.keys(S.promptsDone).length;
    if (submitted < totalPlayers) return;

    // Все темы получены — shuffle и старт рисования
    var pList = S.playerOrder.map(function (pid) {
      return { playerId: pid, text: S.promptsDone[pid] };
    });
    var attempts = 0;
    do {
      shuffle(pList);
      attempts++;
    } while (attempts < 100 && hasSelfAssign(pList, S.playerOrder, pList));

    var assignData = {};
    S.playerOrder.forEach(function (pid, idx) {
      assignData[pid] = { promptText: pList[idx].text, authorId: pList[idx].playerId };
    });

    var endTime = Date.now() + DRAW_DURATION;
    MasykaSDK.mpSend({ type: 'drawing_phase', assignments: assignData, endTime: endTime });

    onlineHandleDrawingPhase({ assignments: assignData, endTime: endTime });
  }

  /* ---- Online: handle drawing phase ---- */
  function onlineHandleDrawingPhase(data) {
    S.assignments = Object.keys(data.assignments).map(function (pid) {
      return { playerId: pid, promptText: data.assignments[pid].promptText, authorId: data.assignments[pid].authorId };
    });
    S.drawTimerEnd = data.endTime;
    S.playersDone = [];
    S.drawingDoneMap = {};
    S.drawingChunks = {};
    S.drawingChunksTotal = {};

    var a = data.assignments[S.myId];
    if (a) S.myAssignment = a;

    showDrawingOnline();
  }

  /* ---- Online: drawing ---- */
  function showDrawingOnline() {
    if (!S.myAssignment) return;

    var author = S.players[S.myAssignment.authorId];
    showScreen('drawing');
    D.drawName.textContent = S.myName;
    D.drawName.style.color = playerColor(S.myId);
    D.drawPrompt.innerHTML = 'Рисует: <strong>«' + esc(S.myAssignment.promptText) + '»</strong>' +
      (author ? ' — тема <span style="color:' + esc(author.color) + '">' + esc(author.name) + '</span>' : '');

    D.drawSubmit.textContent = 'Готово!';
    D.drawSubmit.disabled = false;
    S.drawingDone = false;
    S.canDraw = true;

    var endTime = S.drawTimerEnd;
    if (endTime) {
      startTimer(endTime, D.drawTimer, function () {
        // Таймер истёк → авто-сабмит
        if (!S.drawingDone) autoSubmitDrawing();
      });
    } else {
      D.drawTimer.textContent = '--:--';
    }

    setupOnlineDrawingSubmit();
    setTimeout(function () { initCanvas(); }, 50);
  }

  /* ---- Online: auto-submit on timer expiry ---- */
  function autoSubmitDrawing() {
    if (S.drawingDone) return;
    S.drawingDone = true;
    D.drawSubmit.disabled = true;
    D.drawSubmit.textContent = 'Время вышло';

    var imageData = D.drawCanvas.toDataURL('image/jpeg', 0.65);
    S.myDrawingData = imageData;
    S.drawings[S.myId] = imageData;

    sendDrawingChunks(imageData);

    showScreen('drawWait');
    D.drawWaitText.textContent = 'Время вышло, ждём остальных...';
    if (S.isHost) startHostWatcher();
  }

  /* ---- Online: send drawing chunks + drawing_done ---- */
  function sendDrawingChunks(imageData) {
    var raw = atob(imageData.split(',')[1]);
    var totalChunks = Math.ceil(raw.length / MAX_CHUNK_BYTES);

    MasykaSDK.mpSend({ type: 'drawing_announce', playerId: S.myId, totalChunks: totalChunks });

    // Отправляем все чанки сразу — без setTimeout.
    // setTimeout тормозится до 1с в фоновых вкладках, что делает передачу очень медленной.
    for (var i = 0; i < totalChunks; i++) {
      var chunk = raw.slice(i * MAX_CHUNK_BYTES, (i + 1) * MAX_CHUNK_BYTES);
      MasykaSDK.mpSend({
        type: 'drawing_chunk',
        playerId: S.myId,
        index: i,
        total: totalChunks,
        data: btoa(chunk),
      });
    }

    MasykaSDK.mpSend({ type: 'drawing_done', playerId: S.myId });

    // Хост: mock SDK не доставляет сообщения себе
    if (S.isHost) {
      S.drawingDoneMap[S.myId] = true;
      tryStartDescPhase();
      startHostWatcher();  // гарантирует проверку каждые 100мс
    }
  }

  /* ---- Online: drawing submit setup ---- */
  function setupOnlineDrawingSubmit() {
    D.drawSubmit.onclick = function () {
      if (S.drawingDone) return;
      S.drawingDone = true;
      D.drawSubmit.disabled = true;
      D.drawSubmit.textContent = 'Отправляем...';
      stopTimer();

      var imageData = D.drawCanvas.toDataURL('image/jpeg', 0.65);

      S.myDrawingData = imageData;
      S.drawings[S.myId] = imageData;

      sendDrawingChunks(imageData);

      showScreen('drawWait');
      D.drawWaitText.textContent = 'Рисунок отправлен, ждём остальных...';
    };
  }

  /* ---- Online: drawing done ---- */
  function onlineHandleDrawingDone(from) {
    S.drawingDoneMap[from] = true;
    if (S.isHost) {
      tryStartDescPhase();
    }
  }

  /* ---- Online: chunk assembly ---- */
  function onlineHandleChunk(from, data) {
    var pid = data.playerId;
    if (!S.drawingChunks[pid]) {
      S.drawingChunks[pid] = [];
      if (data.total) S.drawingChunksTotal[pid] = data.total;
    }
    S.drawingChunks[pid][data.index] = data.data;

    var chunks = S.drawingChunks[pid];
    var total = S.drawingChunksTotal[pid];
    if (!total) return;

    var received = 0;
    for (var k = 0; k < chunks.length; k++) { if (chunks[k]) received++; }
    if (received < total) return;

    // Все чанки получены — декодим каждый отдельно, btoa вставляет = padding
    var binary = chunks.map(function (c) { return atob(c); }).join('');
    var bytes = new Uint8Array(binary.length);
    for (var j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
    var blob = new Blob([bytes], { type: 'image/jpeg' });
    var reader = new FileReader();
    reader.onloadend = function () {
      S.drawings[pid] = reader.result;
      S.playersDone.push(pid);

      // Если ждём этот рисунок на экране описания — обновляем
      if (S.phase === 'desc' && S.myDescTarget === pid && D.descDrawingImg) {
        D.descDrawingImg.src = reader.result;
      }

      if (S.phase === 'reveal') buildReveal();

      if (S.isHost) tryStartDescPhase();
    };
    reader.readAsDataURL(blob);
  }

  /* ---- Host watcher: проверяет готовность перехода каждые 100мс ---- */
  function startHostWatcher() {
    if (!S.isHost) return;
    if (S._hostWatcher) return; // уже запущен
    S._hostWatcher = setTimeout(hostWatchTick, 100);
  }

  function stopHostWatcher() {
    if (S._hostWatcher) { clearTimeout(S._hostWatcher); S._hostWatcher = null; }
  }

  function hostWatchTick() {
    if (!S.isHost) { stopHostWatcher(); return; }
    S._hostWatcher = setTimeout(hostWatchTick, 100); // самовосстанавливающийся

    // Проверяем рисование → описание
    if (S.phase !== 'desc' && S.phase !== 'reveal') {
      tryStartDescPhase();
    }
    // Проверяем описание → финал
    if (S.phase === 'descWait') {
      tryStartDescReveal();
    }
    // Если уже в reveal — выключаемся
    if (S.phase === 'reveal') {
      stopHostWatcher();
    }
  }

  /* ---- Online: try start desc phase (host only) ---- */
  function tryStartDescPhase() {
    if (!S.isHost) return;
    if (S.phase === 'desc' || S.phase === 'reveal') return;
    if (!S.playerOrder || S.playerOrder.length === 0) return;

    var allDone = S.playerOrder.every(function (pid) {
      return S.drawingDoneMap[pid] || S.drawings[pid];
    });

    if (!allDone) return;

    // Все рисунки получены — начинаем фазу описания
    var ids = S.playerOrder.slice();
    var shuffled = ids.slice();
    var attempts = 0;
    do {
      shuffle(shuffled);
      attempts++;
    } while (attempts < 100 && shuffled.some(function (id, idx) { return id === ids[idx]; }));

    var descAssign = {};
    ids.forEach(function (pid, idx) {
      descAssign[pid] = shuffled[idx]; // pid описывает рисунок shuffled[idx]
    });

    var endTime = Date.now() + DESC_DURATION;
    MasykaSDK.mpSend({ type: 'desc_phase', assignments: descAssign, endTime: endTime });

    // Очистить desc state
    S.descriptions = {};
    S.descDoneMap = {};

    onlineHandleDescPhase({ assignments: descAssign, endTime: endTime });
  }

  /* ---- Online: handle desc phase ---- */
  function onlineHandleDescPhase(data) {
    S.descTimerEnd = data.endTime;
    S.descDone = false;
    S.descAssignments = data.assignments; // для reveal

    var myTarget = data.assignments[S.myId];
    if (myTarget !== undefined) {
      S.myDescTarget = myTarget;
      // Показать рисунок для описания
      showScreen('desc');
      var drawingUrl = S.drawings[myTarget];
      if (drawingUrl) {
        D.descDrawingImg.src = drawingUrl;
      }
      D.descInput.value = '';
      D.descInput.focus();
      D.descSubmit.disabled = false;
      D.descSubmit.textContent = 'Готово';
      D.descSubmit.onclick = onlineSubmitDesc;
      stopTimer();

      if (data.endTime) {
        startTimer(data.endTime, D.descTimer, function () {
          if (!S.descDone) autoSubmitDesc();
        });
      } else {
        D.descTimer.textContent = '00:30';
      }
    }
  }

  /* ---- Online: update desc wait counter ---- */
  function updateDescWaitText() {
    var total = S.playerOrder ? S.playerOrder.length : 0;
    var done = Object.keys(S.descDoneMap || {}).length;
    D.descWaitText.textContent = 'Подтвердили: ' + done + ' из ' + total;
  }

  /* ---- Online: auto-submit description ---- */
  function autoSubmitDesc() {
    if (S.descDone) return;
    S.descDone = true;
    D.descSubmit.disabled = true;
    D.descSubmit.textContent = 'Время вышло';

    var text = D.descInput.value.trim();
    if (S.myDescTarget !== null) {
      S.descriptions[S.myDescTarget] = text;
      MasykaSDK.mpSend({ type: 'desc_text', text: text, drawingPlayerId: S.myDescTarget });
    }

    // Сразу ставим себе doneMap — для корректного счётчика и проверки перехода
    S.descDoneMap[S.myId] = true;

    showScreen('descWait');
    updateDescWaitText();

    if (S.isHost) tryStartDescReveal();
  }

  /* ---- Online: submit description ---- */
  function onlineSubmitDesc() {
    if (S.descDone) return;
    var text = D.descInput.value.trim();
    S.descDone = true;
    D.descSubmit.disabled = true;
    D.descSubmit.textContent = 'Отправлено';
    stopTimer();

    if (S.myDescTarget !== null) {
      S.descriptions[S.myDescTarget] = text;
      MasykaSDK.mpSend({ type: 'desc_text', text: text, drawingPlayerId: S.myDescTarget });
    }

    // Сразу ставим себе doneMap
    S.descDoneMap[S.myId] = true;

    showScreen('descWait');
    updateDescWaitText();

    if (S.isHost) tryStartDescReveal();
  }

  /* ---- Online: handle desc text ---- */
  function tryStartDescReveal() {
    if (!S.isHost) return;
    if (S.phase === 'reveal') return;
    if (!S.playerOrder || S.playerOrder.length === 0) return;

    var allDesc = S.playerOrder.every(function (pid) {
      return S.descDoneMap[pid];
    });
    if (!allDesc) return;

    MasykaSDK.mpSend({ type: 'phase', phase: 'reveal' });
    buildReveal();
    showScreen('reveal');
  }

  function onlineHandleDescText(from, data) {
    if (data.drawingPlayerId !== undefined) {
      S.descriptions[data.drawingPlayerId] = data.text;
    }
    S.descDoneMap[from] = true;
    updateDescWaitText();
    tryStartDescReveal();
  }

  /* ---- Online: handle phase ---- */
  function onlineHandlePhase(data) {
    if (data.phase === 'reveal') {
      buildReveal();
      showScreen('reveal');
    }
  }

  /* =============================================
     =============================================
     SHARED: Canvas Engine
     =============================================
     ============================================= */
  var canvasState = {
    ctx: null,
    isDrawing: false,
    lastX: 0, lastY: 0,
    color: PALETTE[0],
    size: 5,
    history: [],
    maxHistory: 30,
    drawing: false,
  };
  var currentCanvas = null;

  function initCanvas() {
    var c = D.drawCanvas;
    if (!c) return;
    currentCanvas = c;

    c.width = CANVAS_W;
    c.height = CANVAS_H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    canvasState.ctx = ctx;
    canvasState.history = [];
    canvasState.isDrawing = false;
    canvasState.drawing = false;
    canvasState.color = PALETTE[0];
    canvasState.size = 5;
    saveCanvasState();

    renderPalette();
    renderSizes();
    setupCanvasEvents();
  }

  function setupCanvasEvents() {

    function getCoords(e) {
      var canvas = D.drawCanvas;
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      var cx = e.touches ? e.touches[0].clientX : e.clientX;
      var cy = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (cx - rect.left) * scaleX,
        y: (cy - rect.top) * scaleY,
      };
    }

    function startDraw(e) {
      if (!S.canDraw) return;
      e.preventDefault();
      var coords = getCoords(e);
      canvasState.isDrawing = true;
      canvasState.lastX = coords.x;
      canvasState.lastY = coords.y;
    }

    function moveDraw(e) {
      if (!canvasState.isDrawing || !S.canDraw) return;
      e.preventDefault();
      var coords = getCoords(e);
      var ctx = canvasState.ctx;
      ctx.beginPath();
      ctx.moveTo(canvasState.lastX, canvasState.lastY);
      ctx.lineTo(coords.x, coords.y);

      if (canvasState.eraser) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = canvasState.size * 2.5;
      } else {
        ctx.strokeStyle = canvasState.color;
        ctx.lineWidth = canvasState.size;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();

      canvasState.lastX = coords.x;
      canvasState.lastY = coords.y;
    }

    function endDraw(e) {
      if (canvasState.isDrawing) {
        canvasState.isDrawing = false;
        saveCanvasState();
        canvasState.ctx.beginPath();
      }
    }

    // Clone trick to remove old listeners
    var c = D.drawCanvas;
    var newC = c.cloneNode(true);
    c.parentNode.replaceChild(newC, c);
    D.drawCanvas = newC;

    var ctx = newC.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    canvasState.ctx = ctx;
    canvasState.history = [];
    saveCanvasState();
    renderPalette();
    renderSizes();

    newC.addEventListener('mousedown', startDraw);
    newC.addEventListener('mousemove', moveDraw);
    newC.addEventListener('mouseup', endDraw);
    newC.addEventListener('mouseleave', endDraw);
    newC.addEventListener('touchstart', startDraw, { passive: false });
    newC.addEventListener('touchmove', moveDraw, { passive: false });
    newC.addEventListener('touchend', endDraw, { passive: false });
  }

  function saveCanvasState() {
    var ctx = canvasState.ctx;
    if (!ctx) return;
    var data = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    canvasState.history.push(data);
    if (canvasState.history.length > canvasState.maxHistory) {
      canvasState.history.shift();
    }
  }

  function undoCanvas() {
    if (canvasState.history.length <= 1) return;
    canvasState.history.pop();
    var data = canvasState.history[canvasState.history.length - 1];
    canvasState.ctx.putImageData(data, 0, 0);
  }

  function clearCanvas() {
    var ctx = canvasState.ctx;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    canvasState.history = [];
    saveCanvasState();
  }

  function toggleEraser() {
    canvasState.eraser = !canvasState.eraser;
    if (canvasState.eraser) {
      D.drawEraser.classList.add('active');
    } else {
      D.drawEraser.classList.remove('active');
      canvasState.color = PALETTE[0];
      var swatches = D.drawPalette.querySelectorAll('.color-swatch:not([data-custom])');
      swatches.forEach(function (s) { s.classList.remove('active'); });
      if (swatches[0]) swatches[0].classList.add('active');
    }
  }

  function renderPalette() {
    D.drawPalette.innerHTML = PALETTE.map(function (c, i) {
      return '<button class="color-swatch ' + (i === 0 ? 'active' : '') +
        '" data-color="' + c + '" style="background:' + c + '" aria-label="Цвет"></button>';
    }).join('') +
    '<button class="color-swatch" data-custom="" aria-label="Свой цвет" style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);">' +
      '<input type="color" id="custom-color" value="#E8614D" style="opacity:0;width:100%;height:100%;border:none;cursor:pointer">' +
    '</button>';

    D.drawPalette.querySelectorAll('.color-swatch:not([data-custom])').forEach(function (el) {
      el.addEventListener('click', function () {
        canvasState.color = el.dataset.color;
        canvasState.eraser = false;
        D.drawEraser.classList.remove('active');
        D.drawPalette.querySelectorAll('.color-swatch').forEach(function (s) { s.classList.remove('active'); });
        el.classList.add('active');
      });
    });

    var custom = document.getElementById('custom-color');
    if (custom) {
      custom.addEventListener('input', function () {
        canvasState.color = custom.value;
        canvasState.eraser = false;
        D.drawEraser.classList.remove('active');
        D.drawPalette.querySelectorAll('.color-swatch').forEach(function (s) { s.classList.remove('active'); });
        custom.parentElement.classList.add('active');
      });
    }
  }

  function renderSizes() {
    D.drawSizes.innerHTML = PEN_SIZES.map(function (s, i) {
      return '<button class="size-opt ' + (i === 1 ? 'active' : '') +
        '" data-size="' + s.v + '" style="--sz:' + s.css + '" aria-label="Размер"></button>';
    }).join('');

    D.drawSizes.querySelectorAll('.size-opt').forEach(function (el) {
      el.addEventListener('click', function () {
        canvasState.size = parseFloat(el.dataset.size);
        canvasState.eraser = false;
        D.drawEraser.classList.remove('active');
        D.drawSizes.querySelectorAll('.size-opt').forEach(function (s) { s.classList.remove('active'); });
        el.classList.add('active');
      });
    });
  }

  /* =============================================
     SHARED: Reveal builder
     ============================================= */
  function buildReveal() {
    var players = S.mode === 'offline' ? S.offlinePlayers : Object.keys(S.players).map(function (id) {
      return { id: id, name: S.players[id].name };
    });

    var assignList = S.assignments;

    D.revealGrid.innerHTML = assignList.map(function (a) {
      var drawer = players.find(function (p) { return p.id === a.playerId; });
      var author = players.find(function (p) { return p.id === a.authorId; });
      var drawing = S.drawings[a.playerId];
      var descText = S.descriptions[a.playerId];

      if (!drawer || !author) return '';

      var dc = playerColor(a.playerId);
      var ac = playerColor(a.authorId);

      var imgHtml = drawing
        ? '<div class="drawing-preview"><img src="' + drawing + '" alt="Рисунок" loading="lazy"></div>'
        : '<div class="drawing-preview" style="padding:40px;text-align:center;color:var(--text-tertiary)">Рисунок ещё не загружен</div>';

      // Кто описывал этот рисунок?
      var descAuthorHtml = '';
      if (descText !== undefined) {
        var describerName = '';
        if (S.descAssignments) {
          // Ищем кто описывал рисунок a.playerId
          // S.descAssignments: { describerId: drawingPlayerId }
          for (var pid in S.descAssignments) {
            if (S.descAssignments[pid] === a.playerId) {
              describerName = S.mode === 'online' ? playerName(pid) :
                (S.mode === 'offline' && S.players[pid] ? S.players[pid].name : '');
              break;
            }
          }
        }
        descAuthorHtml = '<div class="reveal-chain-from">' +
          (describerName ? esc(describerName) + ' описал(а): ' : '') +
          '</div>' +
          '<div class="reveal-desc">' + esc(descText) + '</div>';
      } else {
        descAuthorHtml = '<div class="reveal-chain-from" style="color:var(--text-tertiary);font-style:normal">Описание ещё не загружено</div>';
      }

      return '<div class="reveal-card">' +
        '<div class="card-outer"><div class="card-inner">' +
        '<div class="match-info">' +
        '<span class="name-from" style="color:' + dc + '">' + esc(drawer.name) + '</span>' +
        '<span class="arrow">→</span>' +
        '<span class="name-to" style="color:' + ac + '">' + esc(author.name) + '</span>' +
        '<span class="prompt-text">«' + esc(a.promptText) + '»</span>' +
        '</div>' +
        imgHtml +
        descAuthorHtml +
        '</div></div></div>';
    }).join('');
  }

  /* =============================================
     SHARED: Play again & Exit
     ============================================= */
  /* ---- Play again (online: all must confirm) ---- */
  S.playAgainReady = {};

  function handlePlayAgainClick() {
    if (S.mode === 'online') {
      if (S.playAgainReady[S.myId]) return; // уже нажал
      S.playAgainReady[S.myId] = true;
      D.revealAgain.disabled = true;
      D.revealAgain.textContent = '✓ Готов';

      MasykaSDK.mpSend({ type: 'play_again' });
      updatePlayAgainCount();
      if (S.isHost) tryRestartGame();
    } else {
      // Оффлайн — сразу рестарт
      restartGame();
    }
  }

  /* ---- Host checks if all ready ---- */
  function tryRestartGame() {
    if (!S.isHost) return;
    var allReady = Object.keys(S.players).every(function (id) {
      return S.playAgainReady[id];
    });
    if (allReady) {
      // Все готовы — начинаем новую игру
      S.playAgainReady = {};
      D.revealAgain.disabled = false;
      D.revealAgain.textContent = 'Сыграть ещё';
      D.playAgainCount.textContent = '';
      onlineStartGame();
    }
  }

  /* ---- Update counter ---- */
  function updatePlayAgainCount() {
    var ready = Object.keys(S.playAgainReady).length;
    var total = Object.keys(S.players).length;
    D.playAgainCount.textContent = ready + ' из ' + total + ' готовы';
  }

  /* ---- Handle play_again message ---- */
  function onlineHandlePlayAgain(from) {
    S.playAgainReady[from] = true;
    updatePlayAgainCount();
    if (S.isHost) tryRestartGame();
  }

  /* ---- Exit to main menu ---- */
  function handleExitToMenu() {
    if (S.mode === 'online') {
      MasykaSDK.mpLeave();
      MasykaSDK.stopHeartbeat();
      MasykaSDK.stopLobbyListener();
    }
    playAgain();
  }

  /* ---- Full reset to lobby ---- */
  function playAgain() {
    stopTimer();
    S.offlinePlayers = [];
    S.players = {};
    S.promptsDone = {};
    S.assignments = [];
    S.playersDone = [];
    S.drawings = {};
    S.descriptions = {};
    S.descAssignments = {};
    S.descDoneMap = {};
    S.drawingDoneMap = {};
    S.drawingChunks = {};
    S.drawingChunksTotal = {};
    S.myAssignment = null;
    S.myDrawingData = null;
    S.myPrompt = '';
    S.currentPlayerIdx = 0;
    S.drawingDone = false;
    S.descDone = false;
    S.myDescTarget = null;
    S.drawTimerEnd = 0;
    S.descTimerEnd = 0;
    S.promptTimerEnd = 0;
    S.promptDone = false;
    S.roomCode = null;
    S.isHost = false;
    S.hostId = null;
    S.mode = '';
    S.playAgainReady = {};
    canvasState.history = [];

    showScreen('lobby');

    D.lobbyCreateBtn.style.display = '';
    D.lobbySearchBtn.style.display = '';
    D.lobbyBrowser.style.display = 'none';
    D.lobbyRoomInfo.style.display = 'none';
    D.lobbyRoomCode.textContent = '';
    D.lobbyList.innerHTML = '';
    D.lobbyStart.style.display = 'none';
    D.lobbyStatus.textContent = '';
    D.revealAgain.disabled = false;
    D.revealAgain.textContent = 'Сыграть ещё';
    D.playAgainCount.textContent = '';

    D.offPlayerList.innerHTML = '';
    D.lobbyName.value = '';
  }

  /* ---- Quick restart (offline, no lobby reset) ---- */
  function restartGame() {
    stopTimer();
    S.promptsDone = {};
    S.assignments = [];
    S.playersDone = [];
    S.drawings = {};
    S.descriptions = {};
    S.descAssignments = {};
    S.descDoneMap = {};
    S.drawingDoneMap = {};
    S.drawingChunks = {};
    S.drawingChunksTotal = {};
    S.myAssignment = null;
    S.myDrawingData = null;
    S.myPrompt = '';
    S.currentPlayerIdx = 0;
    S.drawingDone = false;
    S.descDone = false;
    S.myDescTarget = null;
    S.drawTimerEnd = 0;
    S.descTimerEnd = 0;
    S.promptTimerEnd = 0;
    S.promptDone = false;
    S.canDraw = false;
    S.playAgainReady = {};
    canvasState.history = [];

    offNextTurn();
  }

  /* =============================================
     INIT & EVENT WIRING
     ============================================= */

  function init() {
    cacheDom();

    // ---- Lobby ----
    D.lobbyCreateBtn.addEventListener('click', lobbyCreateRoom);
    D.lobbySearchBtn.addEventListener('click', lobbySearchRooms);
    D.lobbyJoinBtn.addEventListener('click', lobbyJoinByCode);

    D.lobbyName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        lobbyCreateRoom();
      }
    });
    D.lobbyJoinRoom.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        lobbyJoinByCode();
      }
    });

    // ---- Offline mode ----
    D.lobbyOfflineBtn.addEventListener('click', function () {
      showScreen('offline');
      offRenderBotPreview('');
      D.offNameInput.value = '';
      D.offNameInput.focus();
    });

    D.offNameInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); offStartGame(); }
    });
    D.offNameInput.addEventListener('input', function () {
      var v = D.offNameInput.value.trim();
      if (v) offRenderBotPreview(v);
    });
    D.offStartBtn.addEventListener('click', offStartGame);

    // ---- Canvas tools ----
    D.drawUndo.addEventListener('click', undoCanvas);
    D.drawClear.addEventListener('click', clearCanvas);
    D.drawEraser.addEventListener('click', toggleEraser);

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
        if (D.screens.drawing && D.screens.drawing.classList.contains('active')) {
          e.preventDefault();
          undoCanvas();
        }
      }
    });

    // ---- Host start game ----
    D.lobbyStart.addEventListener('click', onlineStartGame);

    // ---- Play again ----
    D.revealAgain.addEventListener('click', handlePlayAgainClick);
    D.revealExit.addEventListener('click', handleExitToMenu);

    // ---- Prompt submit (keyboard) ----
    D.promptInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        D.promptSubmit.click();
      }
    });

    // ---- Desc submit (keyboard) ----
    D.descInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        D.descSubmit.click();
      }
    });

    // ---- Auto-focus lobby name ----
    D.lobbyName.focus();

    notify('Добро пожаловать в Рисовалку!');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
