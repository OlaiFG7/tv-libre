/*
 * El tiempo con Open-Meteo: gratis, sin clave y sin rastreo.
 * Guarda la última respuesta 30 minutos para no pedirla en cada arranque.
 */
var Tiempo = (function () {
  var CADUCA = 30 * 60 * 1000;

  // Sin red, fetch puede tardar mucho en rendirse: se corta a los 10 s
  function json(url) {
    var corte = new Promise(function (ok, mal) { setTimeout(function () { mal(new Error('Tiempo agotado')); }, 10000); });
    return Promise.race([fetch(url), corte]).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /** Hasta 6 sitios con ese nombre, con su región y país para distinguir los que se llaman igual. */
  function buscar(texto) {
    var url = 'https://geocoding-api.open-meteo.com/v1/search?count=6&language=es&name=' + encodeURIComponent(texto);
    return json(url).then(function (r) {
      return (r.results || []).map(function (l) {
        var donde = [l.admin2 !== l.name ? l.admin2 : '', l.admin1, l.country].filter(Boolean);
        return { nombre: l.name, region: donde.join(', '), lat: l.latitude, lon: l.longitude };
      });
    });
  }

  function pedir(l) {
    return Promise.resolve(l).then(function (l) {
      var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + l.lat + '&longitude=' + l.lon +
        '&current=temperature_2m,weather_code' +
        '&daily=sunrise,sunset' +
        '&timezone=auto&forecast_days=1';
      return json(url).then(function (d) {
        return {
          ciudad: l.nombre,
          temp: d.current.temperature_2m,
          codigo: d.current.weather_code,
          desfase: d.utc_offset_seconds,   // zona horaria de la ciudad: amanecer y anochecer vienen en su hora
          amanecer: d.daily.sunrise[0],
          anochecer: d.daily.sunset[0],
          guardado: Date.now()
        };
      });
    });
  }

  /** lugar: {nombre, lat, lon} elegido en Ajustes. */
  function obtener(lugar) {
    var clave = 'tiempo:' + lugar.lat.toFixed(2) + ',' + lugar.lon.toFixed(2);
    try {
      var guardado = JSON.parse(localStorage.getItem(clave));
      if (guardado && Date.now() - guardado.guardado < CADUCA) return Promise.resolve(guardado);
    } catch (e) {}
    return pedir(lugar).then(function (t) {
      try { localStorage.setItem(clave, JSON.stringify(t)); } catch (e) {}
      return t;
    });
  }

  // Códigos WMO agrupados en seis dibujos
  function tipo(codigo) {
    if (codigo === 0 || codigo === 1) return 'sol';
    if (codigo === 2 || codigo === 3) return 'nubes';
    if (codigo === 45 || codigo === 48) return 'niebla';
    if ((codigo >= 71 && codigo <= 77) || codigo === 85 || codigo === 86) return 'nieve';
    if (codigo >= 95) return 'tormenta';
    return 'lluvia';
  }

  var trazo = 'fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"';
  var nube = '<path ' + trazo + ' d="M18 46h30a10 10 0 0 0 0-20 14 14 0 0 0-27-3A11 11 0 0 0 18 46z"/>';
  var DIBUJOS = {
    sol: '<circle ' + trazo + ' cx="32" cy="32" r="11"/><path ' + trazo +
      ' d="M32 8v6M32 50v6M8 32h6M50 32h6M15 15l4 4M45 45l4 4M15 49l4-4M45 19l4-4"/>',
    nubes: nube,
    niebla: '<path ' + trazo + ' d="M12 24h40M8 34h48M14 44h36"/>',
    lluvia: nube + '<path ' + trazo + ' d="M24 52l-3 6M34 52l-3 6M44 52l-3 6"/>',
    nieve: nube + '<path ' + trazo + ' d="M24 54h.1M34 56h.1M44 54h.1"/>',
    tormenta: nube + '<path ' + trazo + ' d="M34 48l-6 8h8l-6 8"/>'
  };

  function icono(codigo) {
    return '<svg viewBox="0 0 64 64">' + DIBUJOS[tipo(codigo)] + '</svg>';
  }

  return { buscar: buscar, obtener: obtener, icono: icono };
})();
