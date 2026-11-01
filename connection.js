// Shared WebSocket connection for the counter and admin pages.
//
//   var conn = DoorCounter.connect('api', {
//     onState: function (s) {},      // { value, capacity } on connect and every change
//     onStatus: function (online) {},
//     onOpen: function () {},        // after each (re)connect
//     onMessage: function (msg) {},  // any other server message
//   });
//   conn.request({ type: 'change', delta: 1 }).then(function (state) {}, function (err) {});
//
// Every request must be acked by the server within ACK_TIMEOUT. A missing ack
// means the connection is dead even if the browser still thinks it is open,
// so the connection is torn down and the page shows offline until reconnected.
(function () {
  var ACK_TIMEOUT = 5000;
  var HEARTBEAT = 10000;
  var RETRY = 2000;

  function wsUrl(rel) {
    var u = new URL(rel, location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    return u.href;
  }

  function connect(rel, handlers) {
    var ws = null;
    var online = false;
    var nextId = 1;
    var pending = {};
    var heartbeat, retryTimer;

    function setOnline(on) {
      if (on === online) return;
      online = on;
      if (handlers.onStatus) handlers.onStatus(on);
    }

    function failAll(reason) {
      Object.keys(pending).forEach(function (id) {
        clearTimeout(pending[id].timer);
        pending[id].reject(new Error(reason));
      });
      pending = {};
    }

    function close() {
      if (ws) {
        ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
        try { ws.close(); } catch (e) { /* already closed */ }
        ws = null;
      }
      clearInterval(heartbeat);
      clearTimeout(retryTimer);
      setOnline(false);
      failAll('Ingen anslutning');
    }

    function drop() {
      close();
      retryTimer = setTimeout(open, RETRY);
    }

    function open() {
      close();
      ws = new WebSocket(wsUrl(rel));
      ws.onopen = function () {
        setOnline(true);
        heartbeat = setInterval(function () {
          request({ type: 'ping' }).catch(function () {});
        }, HEARTBEAT);
        if (handlers.onOpen) handlers.onOpen();
      };
      ws.onclose = drop;
      ws.onerror = drop;
      ws.onmessage = function (e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (msg.type === 'ack') {
          var p = pending[msg.id];
          if (!p) return;
          delete pending[msg.id];
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.state);
          else p.reject(new Error(msg.error));
        } else if (msg.type === 'state') {
          if (handlers.onState) handlers.onState(msg);
        } else if (handlers.onMessage) {
          handlers.onMessage(msg);
        }
      };
    }

    function request(msg) {
      return new Promise(function (resolve, reject) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Ingen anslutning'));
          return;
        }
        var id = nextId++;
        msg.id = id;
        pending[id] = {
          resolve: resolve,
          reject: reject,
          timer: setTimeout(function () {
            delete pending[id];
            reject(new Error('Inget svar från servern'));
            drop();
          }, ACK_TIMEOUT),
        };
        ws.send(JSON.stringify(msg));
      });
    }

    // Phones suspend background tabs; start a fresh connection on return.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') open();
    });

    open();
    return { request: request };
  }

  window.DoorCounter = { connect: connect };
})();
