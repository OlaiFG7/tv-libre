/*
 * Plan B para leer las apps instaladas: el protocolo SSAP de la propia TV (ws://127.0.0.1:3000),
 * el mismo que usan las apps de mando del móvil. Solo se usa si Luna niega listLaunchPoints,
 * cosa que pasa en algunos firmware con apps que no son de LG.
 * La primera vez la TV pregunta si se permite el acceso; la clave que da se guarda y no vuelve a preguntar.
 * Manifiesto de emparejamiento: el público de LG, tomado de PyWebOSTV (MIT). Ver movil/compartido/ssap-registro.json.
 */
var Ssap = (function () {
  var REGISTRO = {"forcePairing":false,"manifest":{"appVersion":"1.1","manifestVersion":1,"permissions":["LAUNCH","LAUNCH_WEBAPP","APP_TO_APP","CLOSE","TEST_OPEN","TEST_PROTECTED","CONTROL_AUDIO","CONTROL_DISPLAY","CONTROL_INPUT_JOYSTICK","CONTROL_INPUT_MEDIA_RECORDING","CONTROL_INPUT_MEDIA_PLAYBACK","CONTROL_INPUT_TV","CONTROL_POWER","READ_APP_STATUS","READ_CURRENT_CHANNEL","READ_INPUT_DEVICE_LIST","READ_NETWORK_STATE","READ_RUNNING_APPS","READ_TV_CHANNEL_LIST","WRITE_NOTIFICATION_TOAST","READ_POWER_STATE","READ_COUNTRY_INFO","READ_SETTINGS","CONTROL_TV_SCREEN","CONTROL_TV_STANBY","CONTROL_FAVORITE_GROUP","CONTROL_USER_INFO","CHECK_BLUETOOTH_DEVICE","CONTROL_BLUETOOTH","CONTROL_TIMER_INFO","STB_INTERNAL_CONNECTION","CONTROL_RECORDING","READ_RECORDING_STATE","WRITE_RECORDING_LIST","READ_RECORDING_LIST","READ_RECORDING_SCHEDULE","WRITE_RECORDING_SCHEDULE","READ_STORAGE_DEVICE_LIST","READ_TV_PROGRAM_INFO","CONTROL_BOX_CHANNEL","READ_TV_ACR_AUTH_TOKEN","READ_TV_CONTENT_STATE","READ_TV_CURRENT_TIME","ADD_LAUNCHER_CHANNEL","SET_CHANNEL_SKIP","RELEASE_CHANNEL_SKIP","CONTROL_CHANNEL_BLOCK","DELETE_SELECT_CHANNEL","CONTROL_CHANNEL_GROUP","SCAN_TV_CHANNELS","CONTROL_TV_POWER","CONTROL_WOL"],"signatures":[{"signature":"eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbmctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRyaMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQojoa7NQnAtw==","signatureVersion":1}],"signed":{"appId":"com.lge.test","created":"20140509","localizedAppNames":{"":"LG Remote App","ko-KR":"리모컨 앱","zxx-XX":"ЛГ Rэмotэ AПП"},"localizedVendorNames":{"":"LG Electronics"},"permissions":["TEST_SECURE","CONTROL_INPUT_TEXT","CONTROL_MOUSE_AND_KEYBOARD","READ_INSTALLED_APPS","READ_LGE_SDX","READ_NOTIFICATIONS","SEARCH","WRITE_SETTINGS","WRITE_NOTIFICATION_ALERT","CONTROL_POWER","READ_CURRENT_CHANNEL","READ_RUNNING_APPS","READ_UPDATE_INFO","UPDATE_FROM_REMOTE_APP","READ_LGE_TV_INPUT_EVENTS","READ_TV_CURRENT_TIME"],"serial":"2f930e2d2cfe083771f68e4fe7bb07","vendorId":"com.lge"}},"pairingType":"PROMPT"};

  /** Abre la conexión, se empareja y devuelve una función pedir(uri, payload) → Promise. */
  function conectar(espera) {
    return new Promise(function (ok, mal) {
      var ws;
      try { ws = new WebSocket('ws://127.0.0.1:3000'); } catch (e) { mal(e); return; }
      var siguiente = 0, pendientes = {};
      var corte = setTimeout(function () { ws.close(); mal(new Error('SSAP sin respuesta')); }, espera || 20000);
      ws.onerror = function () { clearTimeout(corte); mal(new Error('SSAP no disponible')); };
      ws.onopen = function () {
        var registro = JSON.parse(JSON.stringify(REGISTRO));
        try { var clave = localStorage.getItem('ssap:clave'); if (clave) registro['client-key'] = clave; } catch (e) {}
        ws.send(JSON.stringify({ type: 'register', id: 'registro', payload: registro }));
      };
      ws.onmessage = function (m) {
        var r; try { r = JSON.parse(m.data); } catch (e) { return; }
        if (r.id === 'registro') {
          if (r.type === 'registered') {
            clearTimeout(corte);
            try { localStorage.setItem('ssap:clave', r.payload['client-key']); } catch (e) {}
            ok(function pedir(uri, payload) {
              return new Promise(function (bien, error) {
                var id = 'p' + (++siguiente);
                pendientes[id] = [bien, error];
                ws.send(JSON.stringify({ type: 'request', id: id, uri: uri, payload: payload || {} }));
              });
            });
          } else if (r.type === 'error') {
            clearTimeout(corte); ws.close(); mal(new Error(r.error || 'Emparejamiento rechazado'));
          }
          return;   // 'response' con pairingType PROMPT: la TV está preguntando, se espera
        }
        var p = pendientes[r.id];
        if (!p) return;
        delete pendientes[r.id];
        if (r.type === 'error' || (r.payload && r.payload.returnValue === false)) p[1](r); else p[0](r.payload);
      };
    });
  }

  /** Apps instaladas por SSAP, con el mismo formato que listLaunchPoints. */
  function apps() {
    return conectar().then(function (pedir) {
      return pedir('ssap://com.webos.applicationManager/listLaunchPoints');
    }).then(function (r) { return r.launchPoints || []; });
  }

  return { conectar: conectar, apps: apps };
})();
