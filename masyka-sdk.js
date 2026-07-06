/**
 * masyka-sdk.js — shim для локальной разработки.
 * Заменить на реальный SDK платформы при публикации.
 *
 * Мультиплеер эмулируется через BroadcastChannel (кросс-таб).
 * Для теста: открыть index.html в двух вкладках → ввести одинаковую комнату.
 */
(function () {
  'use strict';

  const SDK = {};

  /* ---- Внутреннее состояние ---- */
  let initialized = false;
  let channel = null;
  let myId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  let peers = [];
  let roomName = '';
  const mpMessageCbs = [];
  const mpPeerJoinedCbs = [];
  const mpPeerLeftCbs = [];
  const pauseCbs = [];
  const resumeCbs = [];

  /* ---- init ---- */
  SDK.init = function () {
    return new Promise(function (resolve) {
      setTimeout(function () {
        initialized = true;
        resolve();
      }, 50);
    });
  };

  /* ---- Счёт ---- */
  SDK.submitScore = function (score) {
    console.log('[SDK] submitScore', score);
  };
  SDK.gameOver = function (score) {
    console.log('[SDK] gameOver', score);
  };

  /* ---- Звук и музыка ---- */
  SDK.sound = function (name) {
    console.log('[SDK] sound', name);
  };
  SDK.music = function (name) {
    console.log('[SDK] music', name);
  };
  SDK.musicStop = function () {
    console.log('[SDK] musicStop');
  };

  /* ---- Пауза ---- */
  SDK.onPause = function (cb) { pauseCbs.push(cb); };
  SDK.onResume = function (cb) { resumeCbs.push(cb); };

  /* ---- Сохранение ---- */
  SDK.save = function (data) {
    try { localStorage.setItem('masyka_save', JSON.stringify(data)); } catch (e) {}
    return Promise.resolve();
  };
  SDK.load = function () {
    try {
      var raw = localStorage.getItem('masyka_save');
      return Promise.resolve(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return Promise.resolve(null);
    }
  };

  /* ---- Вибрация / язык ---- */
  SDK.vibrate = function () {
    if (navigator.vibrate) navigator.vibrate(50);
  };
  SDK.getLang = function () {
    return navigator.language && navigator.language.indexOf('ru') === 0 ? 'ru' : 'en';
  };

  /* ---- Мультиплеер (эмуляция через BroadcastChannel) ---- */
  SDK.mpJoin = function (room) {
    if (!initialized) return Promise.resolve({ ok: false, error: 'not_initialized' });
    roomName = room;

    try {
      channel = new BroadcastChannel('masyka_mp_' + room);
    } catch (e) {
      return Promise.resolve({ ok: false, error: 'broadcast_channel_unsupported' });
    }

    channel.onmessage = function (event) {
      var msg = event.data;
      if (!msg || !msg.type) return;
      // В реальном SDK отправитель НЕ получает свои сообщения
      if (msg.from === myId) return;

      switch (msg.type) {
        case 'peer_info':
          if (peers.indexOf(msg.from) === -1) {
            peers.push(msg.from);
            mpPeerJoinedCbs.forEach(function (cb) { cb(msg.from); });
          }
          break;
        case 'peer_leave':
          peers = peers.filter(function (p) { return p !== msg.from; });
          mpPeerLeftCbs.forEach(function (cb) { cb(msg.from); });
          break;
        case 'mp_data':
          mpMessageCbs.forEach(function (cb) { cb(msg.from, msg.data); });
          break;
      }
    };

    // Объявить о себе
    peers = [];
    channel.postMessage({ type: 'peer_info', from: myId });

    // Собрать ответы других табов (они ответят своим peer_info)
    setTimeout(function () {
      channel.postMessage({ type: 'peer_info', from: myId });
    }, 200);

    return Promise.resolve({ ok: true, playerId: myId, peers: [] });
  };

  SDK.mpSend = function (data) {
    if (channel) {
      channel.postMessage({ type: 'mp_data', from: myId, data: data });
    }
  };

  SDK.onMpMessage = function (cb) { mpMessageCbs.push(cb); };
  SDK.onMpPeerJoined = function (cb) { mpPeerJoinedCbs.push(cb); };
  SDK.onMpPeerLeft = function (cb) { mpPeerLeftCbs.push(cb); };

  SDK.mpLeave = function () {
    if (channel) {
      channel.postMessage({ type: 'peer_leave', from: myId });
      channel.close();
    }
    channel = null;
    peers = [];
  };

  /* ---- Лобби-браузер (эмуляция через BroadcastChannel) ---- */
  var LOBBY_CHANNEL = 'masyka_lobby_discovery';
  var lobbyChannel = null;
  var heartbeatData = null;
  var heartbeatInterval = null;
  var lobbyUpdateCbs = [];
  var pendingRooms = {};
  var roomCleanupInterval = null;
  var lobbyListening = false;

  function ensureLobbyChannel() {
    if (!lobbyChannel) {
      try {
        lobbyChannel = new BroadcastChannel(LOBBY_CHANNEL);
      } catch (e) {
        return null;
      }
      lobbyChannel.onmessage = function (event) {
        var msg = event.data;
        if (!msg || !msg.type) return;
        if (msg.from === myId) return;

        switch (msg.type) {
          case 'lobby_heartbeat':
            pendingRooms[msg.roomCode] = {
              roomCode: msg.roomCode,
              roomName: msg.roomName || msg.roomCode,
              playerCount: msg.playerCount,
              maxPlayers: msg.maxPlayers,
              hostName: msg.hostName,
              ts: Date.now()
            };
            // Уведомить подписчиков
            var list = [];
            for (var k in pendingRooms) {
              if (Date.now() - pendingRooms[k].ts < 4000) {
                list.push(pendingRooms[k]);
              }
            }
            lobbyUpdateCbs.forEach(function (cb) { cb(list); });
            break;
          case 'lobby_query':
            if (heartbeatData) {
              lobbyChannel.postMessage({
                type: 'lobby_heartbeat',
                from: myId,
                roomCode: heartbeatData.roomCode,
                roomName: heartbeatData.roomName,
                playerCount: heartbeatData.playerCount,
                maxPlayers: heartbeatData.maxPlayers,
                hostName: heartbeatData.hostName,
                ts: Date.now()
              });
            }
            break;
        }
      };
    }
    return lobbyChannel;
  }

  SDK.startHeartbeat = function (data) {
    heartbeatData = {
      roomCode: data.roomCode,
      roomName: data.roomName || data.roomCode,
      maxPlayers: data.maxPlayers || 5,
      hostName: data.hostName || '',
      _getPlayerCount: data.getPlayerCount || function () { return 1; }
    };
    if (!ensureLobbyChannel()) return;
    var initialCount = data.playerCount || heartbeatData._getPlayerCount();

    // Немедленно отправить
    lobbyChannel.postMessage({
      type: 'lobby_heartbeat', from: myId,
      roomCode: heartbeatData.roomCode,
      roomName: heartbeatData.roomName,
      playerCount: initialCount,
      maxPlayers: heartbeatData.maxPlayers,
      hostName: heartbeatData.hostName,
      ts: Date.now()
    });

    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(function () {
      if (!heartbeatData) return;
      lobbyChannel.postMessage({
        type: 'lobby_heartbeat', from: myId,
        roomCode: heartbeatData.roomCode,
        roomName: heartbeatData.roomName,
        playerCount: heartbeatData._getPlayerCount(),
        maxPlayers: heartbeatData.maxPlayers,
        hostName: heartbeatData.hostName,
        ts: Date.now()
      });
    }, 1500);
  };

  SDK.updateHeartbeatPlayers = function (count) {
    if (heartbeatData && heartbeatData._getPlayerCount) {
      var old = heartbeatData._getPlayerCount;
      heartbeatData._getPlayerCount = function () { return count; };
    }
  };

  SDK.stopHeartbeat = function () {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    heartbeatData = null;
  };

  SDK.onLobbyUpdate = function (cb) {
    lobbyUpdateCbs.push(cb);
    if (!lobbyListening) {
      lobbyListening = true;
      ensureLobbyChannel();
      // Чистка просроченных каждые 2s
      if (roomCleanupInterval) clearInterval(roomCleanupInterval);
      roomCleanupInterval = setInterval(function () {
        var now = Date.now();
        var changed = false;
        for (var k in pendingRooms) {
          if (now - pendingRooms[k].ts > 4000) {
            delete pendingRooms[k];
            changed = true;
          }
        }
        if (changed) {
          var list = [];
          for (var kk in pendingRooms) list.push(pendingRooms[kk]);
          lobbyUpdateCbs.forEach(function (cb2) { cb2(list); });
        }
      }, 2000);
    }
  };

  SDK.queryLobbies = function () {
    return new Promise(function (resolve) {
      if (!ensureLobbyChannel()) return resolve([]);
      var qId = 'q_' + Date.now();
      lobbyChannel.postMessage({ type: 'lobby_query', from: myId, qId: qId });
      // Ждём 2 секунды на ответы
      setTimeout(function () {
        var list = [];
        for (var k in pendingRooms) {
          if (Date.now() - pendingRooms[k].ts < 4000) {
            list.push(pendingRooms[k]);
          }
        }
        resolve(list);
      }, 2000);
    });
  };

  SDK.stopLobbyListener = function () {
    lobbyUpdateCbs = [];
    lobbyListening = false;
    if (roomCleanupInterval) { clearInterval(roomCleanupInterval); roomCleanupInterval = null; }
    pendingRooms = {};
    if (lobbyChannel) {
      try { lobbyChannel.close(); } catch (e) {}
      lobbyChannel = null;
    }
  };

  window.MasykaSDK = SDK;
})();
