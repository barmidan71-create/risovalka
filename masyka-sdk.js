/**
 * MasykaSDK v2 — мост между HTML5-игрой и платформой Masyka Games.
 *
 * Сообщения игра→платформа: {source:'masyka-game', type, payload}
 * Сообщения платформа→игра: {source:'masyka-host', type, payload}
 *
 * Вне платформы (открыли напрямую) — мультиплеер и лобби работают
 * через BroadcastChannel (кросс-таб в одном браузере).
 */
(function (global) {
  "use strict";

  var VERSION = 2;
  var SRC_GAME = "masyka-game";
  var SRC_HOST = "masyka-host";
  var _inPlatform = false;
  var _ready = false;
  var _audio = null;
  var _musicTimer = null;
  var _readyResolvers = [];
  var _pauseCbs = [];
  var _resumeCbs = [];
  var _initPayload = { lang: "ru" };
  var _myId = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // save/load pending
  var _reqSeq = 0;
  var _pending = {};

  // Multiplayer
  var _mpChannel = null;
  var _mpRoom = "";
  var _mpPeers = [];
  var _mpMsgCbs = [];
  var _mpPeerJoinCbs = [];
  var _mpPeerLeftCbs = [];

  // Lobby
  var _LOBBY_CH = "masyka_lobby_discovery";
  var _lobbyCh = null;
  var _lobbyHB = null;
  var _lobbyHBTimer = null;
  var _lobbyUpdateCbs = [];
  var _lobbyListening = false;
  var _lobbyCleanTimer = null;
  var _pendingRooms = {};

  /* ---- Audio ---- */
  function _ensureAudio() {
    try {
      if (!_audio) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        _audio = new AC();
      }
      if (_audio.state === "suspended") try { _audio.resume(); } catch (e) {}
      return _audio;
    } catch (e) { return null; }
  }

  /* ---- Platform postMessage ---- */
  function _post(type, payload) {
    try {
      parent.postMessage({ source: SRC_GAME, type: type, payload: payload || {}, v: VERSION }, "*");
    } catch (e) {}
  }

  function _request(type, payload) {
    var reqId = ++_reqSeq;
    return new Promise(function (resolve, reject) {
      _pending[reqId] = {
        resolve: resolve, reject: reject,
        timer: setTimeout(function () {
          if (_pending[reqId]) { delete _pending[reqId]; reject(new Error("timeout")); }
        }, 8000),
      };
      var p = payload || {}; p.reqId = reqId;
      _post(type, p);
    });
  }

  function _onMessage(ev) {
    var d = ev && ev.data;
    if (!d || d.source !== SRC_HOST) return;
    _inPlatform = true;
    switch (d.type) {
      case "init":
        _initPayload = d.payload || _initPayload;
        if (!_ready) {
          _ready = true;
          _readyResolvers.forEach(function (r) { r(_initPayload); });
          _readyResolvers = [];
        }
        break;
      case "pause": _pauseCbs.forEach(function (cb) { try { cb(); } catch (e) {} }); break;
      case "resume": _resumeCbs.forEach(function (cb) { try { cb(); } catch (e) {} }); break;
      case "saveResult": case "loadResult": {
        var pl = d.payload || {};
        var entry = _pending[pl.reqId];
        if (entry) {
          delete _pending[pl.reqId];
          clearTimeout(entry.timer);
          if (pl.ok === false) entry.reject(new Error(pl.error || "save_error"));
          else entry.resolve(d.type === "loadResult" ? (pl.data != null ? pl.data : null) : true);
        }
        break;
      }
    }
  }

  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("message", _onMessage, false);
  }

  /* ---- BroadcastChannel: lobby ---- */
  function _ensureLobbyCh() {
    if (_lobbyCh) return _lobbyCh;
    try { _lobbyCh = new BroadcastChannel(_LOBBY_CH); } catch (e) { return null; }
    _lobbyCh.onmessage = function (ev) {
      var m = ev.data;
      if (!m || !m.type || m.from === _myId) return;
      if (m.type === "lobby_heartbeat") {
        _pendingRooms[m.roomCode] = {
          roomCode: m.roomCode, roomName: m.roomName || m.roomCode,
          playerCount: m.playerCount, maxPlayers: m.maxPlayers,
          hostName: m.hostName, ts: Date.now()
        };
        _fireLobbyUpdate();
      } else if (m.type === "lobby_query" && _lobbyHB) {
        _lobbyCh.postMessage({
          type: "lobby_heartbeat", from: _myId,
          roomCode: _lobbyHB.roomCode, roomName: _lobbyHB.roomName,
          playerCount: _lobbyHB._getPlayerCount(), maxPlayers: _lobbyHB.maxPlayers,
          hostName: _lobbyHB.hostName, ts: Date.now()
        });
      }
    };
    return _lobbyCh;
  }

  function _fireLobbyUpdate() {
    var list = [];
    var now = Date.now();
    for (var k in _pendingRooms) {
      if (now - _pendingRooms[k].ts < 4000) list.push(_pendingRooms[k]);
    }
    _lobbyUpdateCbs.forEach(function (cb) { cb(list); });
  }

  /* ---- BroadcastChannel: multiplayer ---- */
  function _ensureMpCh(room) {
    if (_mpChannel) return _mpChannel;
    _mpRoom = room || "default";
    try { _mpChannel = new BroadcastChannel("masyka_mp_" + _mpRoom); } catch (e) { return null; }
    _mpChannel.onmessage = function (ev) {
      var m = ev.data;
      if (!m || !m.type || m.from === _myId) return;
      if (m.type === "peer_info") {
        if (_mpPeers.indexOf(m.from) === -1) {
          _mpPeers.push(m.from);
          _mpPeerJoinCbs.forEach(function (cb) { try { cb(m.from); } catch (e) {} });
        }
      } else if (m.type === "peer_leave") {
        _mpPeers = _mpPeers.filter(function (p) { return p !== m.from; });
        _mpPeerLeftCbs.forEach(function (cb) { try { cb(m.from); } catch (e) {} });
      } else if (m.type === "mp_data") {
        _mpMsgCbs.forEach(function (cb) { try { cb(m.from, m.data); } catch (e) {} });
      }
    };
    return _mpChannel;
  }

  var MasykaSDK = {
    version: VERSION,

    init: function () {
      _post("ready");
      return new Promise(function (resolve) {
        if (_ready) return resolve(_initPayload);
        _readyResolvers.push(resolve);
        setTimeout(function () {
          if (!_ready) {
            _ready = true;
            _readyResolvers.forEach(function (r) { r(_initPayload); });
            _readyResolvers = [];
          }
        }, 1500);
      });
    },

    submitScore: function (v) { _post("submitScore", { value: Math.max(0, Math.floor(Number(v) || 0)) }); },
    gameOver: function (v) { _post("gameOver", { value: Math.max(0, Math.floor(Number(v) || 0)) }); },
    vibrate: function () { _post("vibrate"); },

    sound: function (type) {
      var ac = _ensureAudio(); if (!ac) return;
      try {
        var t0 = ac.currentTime;
        var P = {
          tap:["sine",660,880,.07,.16], click:["square",520,520,.05,.12],
          pop:["triangle",880,180,.14,.20], hit:["square",320,90,.13,.20],
          coin:["sine",980,1560,.13,.20], win:["sine",660,1320,.30,.22],
          fail:["sawtooth",300,70,.32,.20], wrong:["sawtooth",220,120,.18,.18],
          shoot:["sawtooth",520,120,.18,.20], jump:["square",330,720,.12,.18],
          flap:["triangle",500,760,.08,.16], blip:["square",740,740,.05,.14],
          chime:["sine",1320,1980,.18,.18], ding:["sine",1568,1568,.16,.18],
          thud:["sine",180,70,.16,.26], swoosh:["triangle",200,900,.10,.14],
          zap:["sawtooth",1200,200,.10,.16], bloop:["sine",400,700,.09,.18],
          sparkle:["triangle",1760,2640,.12,.16], drum:["square",140,60,.10,.26],
          laser:["sawtooth",900,120,.14,.18], bubble:["sine",600,1100,.10,.18],
          step:["square",240,240,.04,.12],
        };
        var p = P[type] || P.tap;
        var osc = ac.createOscillator(), g = ac.createGain();
        osc.type = p[0];
        osc.frequency.setValueAtTime(p[1], t0);
        osc.frequency.exponentialRampToValueAtTime(Math.max(40, p[2]), t0 + p[3]);
        g.gain.setValueAtTime(p[4], t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + p[3]);
        osc.connect(g); g.connect(ac.destination);
        osc.start(t0); osc.stop(t0 + p[3] + 0.02);
      } catch (e) {}
    },

    music: function (theme) {
      var ac = _ensureAudio(); if (!ac) return;
      this.musicStop();
      var TH = {
        neon:{wave:"triangle",base:220,tempo:240,gain:.05,scale:[0,3,5,7,10,7,5,3]},
        synth:{wave:"sawtooth",base:165,tempo:200,gain:.045,scale:[0,5,7,12,10,7,5,0]},
        calm:{wave:"sine",base:262,tempo:380,gain:.05,scale:[0,4,7,11,7,4]},
        chip:{wave:"square",base:330,tempo:170,gain:.035,scale:[0,2,4,7,4,2]},
        space:{wave:"sine",base:196,tempo:430,gain:.05,scale:[0,3,7,10,12,10,7,3]},
        happy:{wave:"triangle",base:294,tempo:230,gain:.05,scale:[0,4,7,9,7,4]},
        tense:{wave:"sawtooth",base:147,tempo:210,gain:.04,scale:[0,1,5,6,5,1]},
        water:{wave:"sine",base:233,tempo:340,gain:.05,scale:[0,5,9,12,9,5]},
      };
      var t = (typeof theme === "string" ? TH[theme] : theme) || TH.neon;
      var i = 0;
      _musicTimer = setInterval(function () {
        try {
          var semis = t.scale[i % t.scale.length];
          var freq = t.base * Math.pow(2, semis / 12);
          var t0 = ac.currentTime;
          var osc = ac.createOscillator(), g = ac.createGain();
          osc.type = t.wave || "triangle";
          osc.frequency.setValueAtTime(freq, t0);
          var dur = (t.tempo / 1000) * 0.9;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(t.gain || 0.05, t0 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
          osc.connect(g); g.connect(ac.destination);
          osc.start(t0); osc.stop(t0 + dur + 0.02);
        } catch (e) {}
        i++;
      }, t.tempo || 240);
    },

    musicStop: function () { if (_musicTimer) { clearInterval(_musicTimer); _musicTimer = null; } },

    onPause: function (cb) { if (typeof cb === "function") _pauseCbs.push(cb); },
    onResume: function (cb) { if (typeof cb === "function") _resumeCbs.push(cb); },
    getLang: function () { return _initPayload.lang || "ru"; },

    save: function (data) {
      var str;
      try { str = (typeof data === "string") ? data : JSON.stringify(data); }
      catch (e) { return Promise.reject(new Error("invalid_data")); }
      if (_inPlatform) return _request("saveData", { data: str });
      try { localStorage.setItem("masyka_save", str); } catch (e) {}
      return Promise.resolve(true);
    },

    load: function () {
      if (_inPlatform) {
        return _request("loadData", {}).then(function (raw) {
          if (raw == null) return null;
          if (typeof raw !== "string") return raw;
          try { return JSON.parse(raw); } catch (e) { return raw; }
        });
      }
      try {
        var raw = localStorage.getItem("masyka_save");
        return Promise.resolve(raw ? JSON.parse(raw) : null);
      } catch (e) { return Promise.resolve(null); }
    },

    /* ============ МУЛЬТИПЛЕЕР ============ */
    mpJoin: function (room) {
      if (!_ready) return Promise.resolve({ ok: false, error: "not_initialized" });
      _mpRoom = room || "default";
      var ch = _ensureMpCh(_mpRoom);
      if (!ch) return Promise.resolve({ ok: false, error: "broadcast_channel_unsupported" });
      _mpPeers = [];
      ch.postMessage({ type: "peer_info", from: _myId });
      setTimeout(function () { if (_mpChannel) _mpChannel.postMessage({ type: "peer_info", from: _myId }); }, 200);
      return Promise.resolve({ ok: true, playerId: _myId, peers: [] });
    },

    mpSend: function (data) {
      if (_mpChannel) _mpChannel.postMessage({ type: "mp_data", from: _myId, data: data });
    },

    mpLeave: function () {
      if (_mpChannel) {
        try { _mpChannel.postMessage({ type: "peer_leave", from: _myId }); } catch (e) {}
        try { _mpChannel.close(); } catch (e) {}
      }
      _mpChannel = null;
      _mpPeers = [];
    },

    onMpMessage: function (cb) { if (typeof cb === "function") _mpMsgCbs.push(cb); },
    onMpPeerJoined: function (cb) { if (typeof cb === "function") _mpPeerJoinCbs.push(cb); },
    onMpPeerLeft: function (cb) { if (typeof cb === "function") _mpPeerLeftCbs.push(cb); },

    /* ============ ЛОББИ ============ */
    startHeartbeat: function (data) {
      _lobbyHB = {
        roomCode: data.roomCode,
        roomName: data.roomName || data.roomCode,
        maxPlayers: data.maxPlayers || 5,
        hostName: data.hostName || "",
        _getPlayerCount: data.getPlayerCount || function () { return 1; },
      };
      var ch = _ensureLobbyCh();
      if (!ch) return;
      ch.postMessage({
        type: "lobby_heartbeat", from: _myId,
        roomCode: _lobbyHB.roomCode, roomName: _lobbyHB.roomName,
        playerCount: data.playerCount || _lobbyHB._getPlayerCount(),
        maxPlayers: _lobbyHB.maxPlayers, hostName: _lobbyHB.hostName, ts: Date.now()
      });
      if (_lobbyHBTimer) clearInterval(_lobbyHBTimer);
      _lobbyHBTimer = setInterval(function () {
        if (!_lobbyHB || !_lobbyCh) return;
        _lobbyCh.postMessage({
          type: "lobby_heartbeat", from: _myId,
          roomCode: _lobbyHB.roomCode, roomName: _lobbyHB.roomName,
          playerCount: _lobbyHB._getPlayerCount(),
          maxPlayers: _lobbyHB.maxPlayers, hostName: _lobbyHB.hostName, ts: Date.now()
        });
      }, 1500);
    },

    updateHeartbeatPlayers: function (count) {
      if (_lobbyHB) _lobbyHB._getPlayerCount = function () { return count; };
    },

    stopHeartbeat: function () {
      if (_lobbyHBTimer) { clearInterval(_lobbyHBTimer); _lobbyHBTimer = null; }
      _lobbyHB = null;
    },

    onLobbyUpdate: function (cb) {
      _lobbyUpdateCbs.push(cb);
      if (!_lobbyListening) {
        _lobbyListening = true;
        _ensureLobbyCh();
        if (_lobbyCleanTimer) clearInterval(_lobbyCleanTimer);
        _lobbyCleanTimer = setInterval(function () {
          var now = Date.now(), changed = false;
          for (var k in _pendingRooms) {
            if (now - _pendingRooms[k].ts > 4000) { delete _pendingRooms[k]; changed = true; }
          }
          if (changed) _fireLobbyUpdate();
        }, 2000);
      }
    },

    queryLobbies: function () {
      return new Promise(function (resolve) {
        var ch = _ensureLobbyCh();
        if (!ch) return resolve([]);
        ch.postMessage({ type: "lobby_query", from: _myId });
        setTimeout(function () {
          var list = [], now = Date.now();
          for (var k in _pendingRooms) {
            if (now - _pendingRooms[k].ts < 4000) list.push(_pendingRooms[k]);
          }
          resolve(list);
        }, 2000);
      });
    },

    stopLobbyListener: function () {
      _lobbyUpdateCbs = [];
      _lobbyListening = false;
      if (_lobbyCleanTimer) { clearInterval(_lobbyCleanTimer); _lobbyCleanTimer = null; }
      _pendingRooms = {};
      if (_lobbyCh) { try { _lobbyCh.close(); } catch (e) {} _lobbyCh = null; }
    },
  };

  global.MasykaSDK = MasykaSDK;
})(typeof window !== "undefined" ? window : this);
