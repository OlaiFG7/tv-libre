/*
 * Llamadas al bus Luna de webOS desde la app web, sin la librería webOSTV.js.
 * PalmServiceBridge existe en las apps web de la TV; en un navegador normal no, y entonces
 * se usan datos de ejemplo para poder probar la interfaz en el ordenador.
 * ES2015 como mucho: webOS 5 lleva Chromium 68.
 */
var Luna = (function () {
  var vivos = {};   // si el puente se recoge como basura, la respuesta no llega nunca
  var siguiente = 0;
  var enTV = typeof window.PalmServiceBridge !== 'undefined';

  /** Si el servicio no contesta en `espera` ms, la promesa se rechaza en vez de quedarse colgada. */
  function llamar(uri, params, espera) {
    return new Promise(function (ok, mal) {
      if (!enTV) { mal(new Error('Fuera de la TV')); return; }
      var id = ++siguiente;
      var puente = new window.PalmServiceBridge();
      vivos[id] = puente;
      var corte = setTimeout(function () {
        if (!vivos[id]) return;
        delete vivos[id];
        try { puente.cancel(); } catch (e) {}
        mal({ returnValue: false, errorText: 'Sin respuesta de ' + uri });
      }, espera || 8000);
      puente.onservicecallback = function (texto) {
        if (!vivos[id]) return;   // ya se dio por perdida
        clearTimeout(corte);
        delete vivos[id];
        var r;
        try { r = JSON.parse(texto); } catch (e) { r = { returnValue: false, errorText: texto }; }
        if (r.returnValue === false) mal(r); else ok(r);
      };
      puente.call(uri, JSON.stringify(params || {}));
    });
  }

  var EJEMPLO = [
    { id: 'netflix', title: 'Netflix', bgColor: '#141414' },
    { id: 'youtube.leanback.v4', title: 'YouTube', bgColor: '#e62117' },
    { id: 'amazon', title: 'Prime Video', bgColor: '#00a8e1' },
    { id: 'com.disney.disneyplus-prod', title: 'Disney+', bgColor: '#0b1a4b' },
    { id: 'spotify-beehive', title: 'Spotify', bgColor: '#1db954' },
    { id: 'com.webos.app.discovery', title: 'LG Content Store', bgColor: '#a50034' },
    { id: 'com.webos.app.browser', title: 'Navegador', bgColor: '#3b4b63' }
  ];

  // Si la TV no deja a la app leer su lista (algunos firmware lo niegan), se ofrecen las conocidas.
  // Ids de LG según Connect SDK y couch-tv; si alguna no está instalada, abrirla da un aviso.
  var CONOCIDAS = [
    { id: 'netflix', title: 'Netflix', bgColor: '#141414' },
    { id: 'youtube.leanback.v4', title: 'YouTube', bgColor: '#e62117' },
    { id: 'amazon', title: 'Prime Video', bgColor: '#00a8e1' },
    { id: 'com.disney.disneyplus-prod', title: 'Disney+', bgColor: '#0b1a4b' },
    { id: 'spotify-beehive', title: 'Spotify', bgColor: '#1db954' },
    { id: 'com.apple.appletv', title: 'Apple TV', bgColor: '#1c1c1e' },
    { id: 'cdp-30', title: 'Plex', bgColor: '#1f1f1f' }
  ];

  /**
   * Cada acceso de la lista lleva su propia clave. La TV da también los accesos que fijaste en el inicio
   * de LG desde una app (un vídeo o una lista de YouTube, por ejemplo): tienen el mismo id que la app
   * y llevan params. Si se guardaran por id, ese acceso taparía a la app. La app se queda con su id
   * (así siguen valiendo el orden, las favoritas y las ocultas guardadas) y el acceso usa su launchPointId.
   */
  function separarAccesos(lista) {
    var vistos = {}, salida = [];
    lista.forEach(function (a) {
      var lp = a.launchPointId || '';
      var principal = a.lptype ? a.lptype === 'default' : (!lp || lp === a.id || /_default$/.test(lp));
      var clave = principal ? a.id : (lp || a.id + ':' + (a.title || ''));
      if (vistos[clave]) return;
      vistos[clave] = true;
      var copia = {};
      for (var k in a) copia[k] = a[k];
      copia.id = clave;
      copia.appId = a.id;
      copia.params = principal ? null : (a.params || null);
      salida.push(copia);
    });
    return salida;
  }

  /** Apps instaladas: [{id (clave única), appId, params, title, icon, largeIcon, bgColor}] */
  function apps() {
    if (!enTV) return Promise.resolve(EJEMPLO);
    // 1.º Luna; 2.º SSAP local (ver ssap.js); 3.º la lista de apps conocidas
    return llamar('luna://com.webos.applicationManager/listLaunchPoints', {})
      .then(function (r) {
        if (!r.launchPoints || !r.launchPoints.length) throw new Error('Lista vacía');
        return separarAccesos(r.launchPoints);
      })
      .catch(function () {
        if (typeof Ssap === 'undefined') throw new Error('Sin SSAP');
        return Ssap.apps().then(function (l) { if (!l.length) throw new Error('Lista vacía'); return separarAccesos(l); });
      })
      .catch(function () { return CONOCIDAS; });
  }

  // Fuera de la TV, para probar los nombres y el punto de señal en el ordenador
  var EJEMPLO_ENTRADAS = [
    { appId: 'com.webos.app.hdmi1', label: 'PS5', connected: true, hdmiPlugIn: true },
    { appId: 'com.webos.app.hdmi2', label: 'HDMI2', connected: true, hdmiPlugIn: false },
    { appId: 'com.webos.app.hdmi3', label: 'Apple TV', connected: true, hdmiPlugIn: false }
  ];

  /**
   * Los HDMI de la TV: [{appId, nombre, conectada}], con el nombre que les pusiste en la TV.
   * 1.º Luna (eim); 2.º SSAP, solo si ya está emparejada (no hace salir el aviso de permiso por esto).
   * Los campos cambian según el firmware: se leen con cuidado y solo se quedan los HDMI.
   */
  function entradas() {
    var lista = !enTV ? Promise.resolve(EJEMPLO_ENTRADAS)
      : llamar('luna://com.webos.service.eim/getAllInputStatus', {}, 5000)
        .then(function (r) {
          var l = r.devices || r.inputSourceList || [];
          if (!l.length) throw new Error('Lista vacía');
          return l;
        })
        .catch(function () {
          var clave = null;
          try { clave = localStorage.getItem('ssap:clave'); } catch (e) {}
          if (!clave || typeof Ssap === 'undefined') throw new Error('Sin lista de entradas');
          return Ssap.entradas();
        });
    return lista.then(function (l) {
      var hdmi = [];
      l.forEach(function (d) {
        var id = d.appId || '';
        var n = /hdmi(\d)$/i.exec(id);
        if (!n) return;
        var nombre = d.label || d.deviceName || d.name || '';
        // "HDMI1" o vacío = sin renombrar: se escribe bonito
        if (!nombre || /^hdmi\s*\d$/i.test(nombre)) nombre = 'HDMI ' + n[1];
        // `connected` viene a true en todos los puertos (el puerto existe), no dice si hay algo enchufado:
        // solo cuentan los campos de cable o señal. Sin ellos, no se pinta punto
        var conectada = d.hdmiPlugIn === true || d.signalDetection === true || d.signal === true;
        hdmi.push({ appId: id, nombre: nombre, conectada: conectada });
      });
      if (!hdmi.length) throw new Error('Sin HDMI');
      hdmi.sort(function (a, b) { return a.appId < b.appId ? -1 : 1; });
      return hdmi;
    });
  }

  function abrir(id, params) {
    if (!enTV) { console.log('[ejemplo] abrir', id); return Promise.resolve(); }
    return llamar('luna://com.webos.applicationManager/launch', { id: id, params: params || {} });
  }

  /**
   * La retroiluminación de la TV (0-100, la de Ajustes → Imagen), para atenuar de noche también en las demás apps.
   * Si el firmware no deja a la app leerla o cambiarla, la promesa se rechaza y TV Libre atenúa solo su pantalla.
   */
  function luz() {
    if (!enTV) return Promise.reject(new Error('Fuera de la TV'));
    return llamar('luna://com.webos.settingsservice/getSystemSettings', { category: 'picture', keys: ['backlight'] }, 5000)
      .then(function (r) {
        var v = r.settings && r.settings.backlight;
        if (v === undefined || isNaN(+v)) throw new Error('Sin retroiluminación');
        return v;
      });
  }
  function ponerLuz(v) {
    if (!enTV) return Promise.reject(new Error('Fuera de la TV'));
    return llamar('luna://com.webos.settingsservice/setSystemSettings', { category: 'picture', settings: { backlight: v } }, 5000);
  }

  function aviso(texto) {
    if (!enTV) return Promise.resolve();
    return llamar('luna://com.webos.notification/createToast', { message: texto }).catch(function () {});
  }

  return { enTV: enTV, llamar: llamar, apps: apps, entradas: entradas, abrir: abrir, aviso: aviso, luz: luz, ponerLuz: ponerLuz, CONOCIDAS: CONOCIDAS };
})();
