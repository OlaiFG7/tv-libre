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

  /** Apps instaladas: [{id, title, icon, largeIcon, bgColor}] */
  function apps() {
    if (!enTV) return Promise.resolve(EJEMPLO);
    // 1.º Luna; 2.º SSAP local (ver ssap.js); 3.º la lista de apps conocidas
    return llamar('luna://com.webos.applicationManager/listLaunchPoints', {})
      .then(function (r) {
        if (!r.launchPoints || !r.launchPoints.length) throw new Error('Lista vacía');
        return r.launchPoints;
      })
      .catch(function () {
        if (typeof Ssap === 'undefined') throw new Error('Sin SSAP');
        return Ssap.apps().then(function (l) { if (!l.length) throw new Error('Lista vacía'); return l; });
      })
      .catch(function () { return CONOCIDAS; });
  }

  function abrir(id, params) {
    if (!enTV) { console.log('[ejemplo] abrir', id); return Promise.resolve(); }
    return llamar('luna://com.webos.applicationManager/launch', { id: id, params: params || {} });
  }

  function aviso(texto) {
    if (!enTV) return Promise.resolve();
    return llamar('luna://com.webos.notification/createToast', { message: texto }).catch(function () {});
  }

  return { enTV: enTV, llamar: llamar, apps: apps, abrir: abrir, aviso: aviso };
})();
