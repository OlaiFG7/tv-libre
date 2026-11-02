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
        '&current=temperature_2m,weather_code,is_day' +
        '&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
        '&hourly=temperature_2m,weather_code,is_day,precipitation_probability' +
        '&timezone=auto&forecast_days=2';   // 2 días: a las 22:00 las próximas horas ya son de mañana
      return json(url).then(function (d) {
        // Las próximas 12 horas, en hora de la ciudad ("AAAA-MM-DDTHH:00"); la tarjeta enseña las 6 que aún no han pasado
        var horas = [];
        for (var i = 0; i < d.hourly.time.length && horas.length < 12; i++) {
          if (d.hourly.time[i] <= d.current.time) continue;
          horas.push({ hora: d.hourly.time[i], temp: d.hourly.temperature_2m[i], codigo: d.hourly.weather_code[i], noche: d.hourly.is_day[i] === 0,
            lluvia: d.hourly.precipitation_probability ? d.hourly.precipitation_probability[i] : null });
        }
        return {
          ciudad: l.nombre,
          temp: d.current.temperature_2m,
          codigo: d.current.weather_code,
          noche: d.current.is_day === 0,
          max: d.daily.temperature_2m_max[0],
          min: d.daily.temperature_2m_min[0],
          lluvia: d.daily.precipitation_probability_max[0],   // % de probabilidad hoy (puede ser null)
          horas: horas,
          desfase: d.utc_offset_seconds,   // zona horaria de la ciudad: amanecer y anochecer vienen en su hora
          amanecer: d.daily.sunrise[0],
          anochecer: d.daily.sunset[0],
          guardado: Date.now()
        };
      });
    });
  }

  /**
   * lugar: {nombre, lat, lon} elegido en Ajustes.
   * Sin red (la TV suele arrancar la app antes de tener wifi) devuelve la última respuesta de hasta una semana,
   * marcada como `vieja`: su temperatura ya no vale, pero el amanecer y el anochecer apenas cambian de un día a otro.
   */
  var VIEJA_MAX = 7 * 24 * 60 * 60 * 1000;
  function obtener(lugar) {
    var clave = 'tiempo:' + lugar.lat.toFixed(2) + ',' + lugar.lon.toFixed(2);
    var guardado = null;
    try { guardado = JSON.parse(localStorage.getItem(clave)); } catch (e) {}
    if (guardado && Date.now() - guardado.guardado < CADUCA) return Promise.resolve(guardado);
    return pedir(lugar).then(function (t) {
      try { localStorage.setItem(clave, JSON.stringify(t)); } catch (e) {}
      return t;
    }, function (e) {
      if (guardado && Date.now() - guardado.guardado < VIEJA_MAX) { guardado.vieja = true; return guardado; }
      throw e;
    });
  }

  /**
   * La primera de las próximas horas en la que probablemente llueva (o nieve): {hora, nieve} o null.
   * Cuenta si la probabilidad es del 50 % o más, o si el código ya es de lluvia y la probabilidad no se sabe.
   */
  function proximaLluvia(horas) {
    for (var i = 0; i < horas.length; i++) {
      var t = tipo(horas[i].codigo);
      var moja = t === 'lluvia' || t === 'tormenta' || t === 'nieve';
      if (moja && (horas[i].lluvia === null || horas[i].lluvia === undefined || horas[i].lluvia >= 50)) return { hora: horas[i].hora, nieve: t === 'nieve' };
      if (horas[i].lluvia >= 70) return { hora: horas[i].hora, nieve: t === 'nieve' };
    }
    return null;
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
    tormenta: nube + '<path ' + trazo + ' d="M34 48l-6 8h8l-6 8"/>',
    luna: '<path ' + trazo + ' d="M46 40A18 18 0 0 1 24 18a18 18 0 1 0 22 22z"/>'
  };

  // De noche, cielo despejado es una luna y no un sol
  function icono(codigo, noche) {
    var t = tipo(codigo);
    return '<svg viewBox="0 0 64 64">' + DIBUJOS[noche && t === 'sol' ? 'luna' : t] + '</svg>';
  }

  /** El estado del cielo en palabras, según el código WMO. */
  function describir(c) {
    if (c === 0) return 'Despejado';
    if (c === 1) return 'Casi despejado';
    if (c === 2) return 'Parcialmente nublado';
    if (c === 3) return 'Nublado';
    if (c === 45 || c === 48) return 'Niebla';
    if (c >= 51 && c <= 57) return 'Llovizna';
    if (c === 61) return 'Lluvia débil';
    if (c === 63) return 'Lluvia';
    if (c === 65) return 'Lluvia fuerte';
    if (c === 66 || c === 67) return 'Lluvia helada';
    if (c >= 71 && c <= 77) return 'Nieve';
    if (c >= 80 && c <= 82) return 'Chubascos';
    if (c === 85 || c === 86) return 'Chubascos de nieve';
    if (c >= 95) return 'Tormenta';
    return '';
  }

  return { buscar: buscar, obtener: obtener, icono: icono, describir: describir, proximaLluvia: proximaLluvia };
})();
