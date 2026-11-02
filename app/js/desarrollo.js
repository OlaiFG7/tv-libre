/*
 * Mantiene vivo el modo desarrollador. LG da sesiones de 1000 horas y, cuando caduca, la TV borra las apps
 * instaladas a mano (TV Libre incluida). tools/install.py copia el token de la sesión en devmode.txt (fuera de
 * git) y aquí se pide a LG que la renueve, igual que el botón "Extend" de la app Developer Mode.
 * Como mucho una vez cada 20 horas; sin devmode.txt no hace nada. ES2015 como mucho: webOS 5 lleva Chromium 68.
 */
var Desarrollo = (function () {
  var CADA = 20 * 3600 * 1000;
  var RENOVAR = 'https://developer.lge.com/secure/ResetDevModeSession.dev?sessionToken=';

  // XHR y no fetch: desde file:// fetch no lee archivos locales (ver calendario.js)
  function leer(url, espera) {
    return new Promise(function (ok, mal) {
      var x = new XMLHttpRequest();
      x.open('GET', url);
      x.timeout = espera;
      x.onload = function () { if (x.status === 200 || (x.status === 0 && x.responseText)) ok(x.responseText); else mal(new Error('HTTP ' + x.status)); };
      x.onerror = x.ontimeout = function () { mal(new Error('Sin respuesta')); };
      x.send();
    });
  }

  /** Renueva la sesión si toca. Resuelve con las horas que quedan ("999:59:59"), o null si no hizo nada. */
  function renovar() {
    var ultima = 0;
    try { ultima = +localStorage.getItem('desarrolloRenovado') || 0; } catch (e) {}
    if (Date.now() - ultima < CADA) return Promise.resolve(null);
    return leer('devmode.txt', 3000).then(function (t) {
      var token = (t || '').trim();
      if (!/^[0-9A-Za-z]{16,128}$/.test(token)) return null;
      return leer(RENOVAR + token, 20000).then(function (r) {
        var j = JSON.parse(r);
        if (j.result !== 'success') throw new Error(j.errorMsg || 'LG no renovó la sesión');
        try { localStorage.setItem('desarrolloRenovado', String(Date.now())); } catch (e) {}
        return j.errorMsg || '';
      });
    }, function () { return null; });
  }

  return { renovar: renovar };
})();
