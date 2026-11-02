/*
 * Tu calendario (Google Calendar u otro) a partir de su enlace privado en formato iCal (.ics).
 * El enlace no va en el código: tools/install.py --calendario=URL lo guarda en app/calendario.txt
 * (fuera de git) y va dentro del paquete. Sin ese archivo no hay calendario y el botón no aparece.
 *
 * Solo se leen los próximos 7 días, y se guardan 30 minutos para no descargar el .ics en cada vuelta.
 * Los eventos que se repiten (RRULE) se calculan aquí con lo habitual: diario, semanal (con días),
 * mensual y anual, con INTERVAL, COUNT, UNTIL y EXDATE. Las horas con zona (TZID) se toman como la
 * hora de la TV: vale mientras el calendario y la TV estén en la misma zona.
 * ES2015 como mucho: webOS 5 lleva Chromium 68.
 */
var Calendario = (function () {
  var CADUCA = 30 * 60 * 1000, DIAS = 7, DIA = 86400000;

  // XHR y no fetch: en la TV la app se sirve desde file://, y ahí fetch no lee archivos locales
  function leer(url, espera) {
    return new Promise(function (ok, mal) {
      var x = new XMLHttpRequest();
      x.open('GET', url);
      x.timeout = espera || 15000;
      x.onload = function () { if (x.status === 200 || (x.status === 0 && x.responseText)) ok(x.responseText); else mal(new Error('HTTP ' + x.status)); };
      x.onerror = x.ontimeout = function () { mal(new Error('Sin respuesta de ' + url)); };
      x.send();
    });
  }

  var enlace = null;
  /** El enlace .ics de calendario.txt, o null si no se configuró. */
  function configurado() {
    if (enlace !== null) return Promise.resolve(enlace);
    return leer('calendario.txt', 3000).then(function (t) {
      enlace = (t || '').trim();
      return enlace;
    }, function () { enlace = ''; return ''; });
  }

  // ---------- Lectura del .ics ----------

  function desescapar(s) {
    return s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
  }

  /** "20261102" (todo el día, hora local) o "20261102T183000[Z]" → {fecha: Date, todoElDia} */
  function fecha(valor) {
    var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(valor);
    if (!m) return null;
    if (!m[4]) return { fecha: new Date(+m[1], +m[2] - 1, +m[3]), todoElDia: true };
    var d = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
      : new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return { fecha: d, todoElDia: false };
  }

  function analizar(texto) {
    var lineas = texto.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    var eventos = [], ev = null;
    lineas.forEach(function (l) {
      if (l === 'BEGIN:VEVENT') { ev = { exdate: [] }; return; }
      if (l === 'END:VEVENT') { if (ev && ev.inicio && ev.estado !== 'CANCELLED') eventos.push(ev); ev = null; return; }
      if (!ev) return;
      var dos = l.indexOf(':');
      if (dos < 0) return;
      var nombre = l.slice(0, dos).split(';')[0].toUpperCase(), valor = l.slice(dos + 1);
      if (nombre === 'DTSTART') ev.inicio = fecha(valor);
      else if (nombre === 'DTEND') ev.fin = fecha(valor);
      else if (nombre === 'SUMMARY') ev.titulo = desescapar(valor);
      else if (nombre === 'LOCATION') ev.lugar = desescapar(valor);
      else if (nombre === 'RRULE') ev.rrule = valor;
      else if (nombre === 'UID') ev.uid = valor;
      else if (nombre === 'STATUS') ev.estado = valor.toUpperCase();
      else if (nombre === 'RECURRENCE-ID') ev.reemplaza = fecha(valor);
      else if (nombre === 'EXDATE') valor.split(',').forEach(function (v) { var f = fecha(v); if (f) ev.exdate.push(f.fecha.getTime()); });
    });
    return eventos;
  }

  var DIAS_SEMANA = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  /** Las veces que ocurre ev entre desde y hasta (Date), como [Date de inicio]. */
  function ocurrencias(ev, desde, hasta) {
    var inicio = ev.inicio.fecha;
    var dura = ev.fin ? ev.fin.fecha - inicio : (ev.inicio.todoElDia ? DIA : 0);
    if (!ev.rrule) return inicio < hasta && inicio.getTime() + Math.max(dura, 1) > desde ? [inicio] : [];
    var r = {};
    ev.rrule.split(';').forEach(function (p) { var kv = p.split('='); r[kv[0].toUpperCase()] = kv[1]; });
    var cada = Math.max(1, +r.INTERVAL || 1), cuenta = +r.COUNT || Infinity;
    var hastaRegla = r.UNTIL ? fecha(r.UNTIL).fecha : null;
    var dias = r.BYDAY ? r.BYDAY.split(',').map(function (d) { return DIAS_SEMANA[d.slice(-2)]; }).filter(function (d) { return d !== undefined; }) : null;
    var salida = [], n = 0, vueltas = 0;
    function candidata(d) {
      if (d < inicio) return true;
      if (hastaRegla && d > hastaRegla) return false;
      if (++n > cuenta) return false;
      if (d >= hasta) return false;
      if (d.getTime() + Math.max(dura, 1) > desde && ev.exdate.indexOf(d.getTime()) < 0) salida.push(d);
      return true;
    }
    function con(y, mes, dia) {
      return new Date(y, mes, dia, inicio.getHours(), inicio.getMinutes(), inicio.getSeconds());
    }
    var y = inicio.getFullYear(), m = inicio.getMonth(), d = inicio.getDate();
    // Un evento semanal de hace años: se salta directamente a cerca de hoy (con COUNT no, hay que contarlas todas)
    var k0 = 0;
    if (cuenta === Infinity && desde > inicio) {
      var dias0 = (desde - inicio) / DIA;
      var periodo = { DAILY: 1, WEEKLY: 7, MONTHLY: 30.4, YEARLY: 365.2 }[r.FREQ] || 1;
      k0 = Math.max(0, Math.floor(dias0 / (periodo * cada)) - 2);
    }
    for (var k = k0; vueltas++ < 3000; k++) {
      if (r.FREQ === 'DAILY') { if (!candidata(con(y, m, d + k * cada))) break; }
      else if (r.FREQ === 'WEEKLY') {
        var lunes = d - ((inicio.getDay() + 6) % 7) + k * 7 * cada;   // la semana empieza en lunes
        var seguir = true;
        (dias || [inicio.getDay()]).slice().sort(function (a, b) { return (a + 6) % 7 - (b + 6) % 7; }).forEach(function (dia) {
          if (seguir) seguir = candidata(con(y, m, lunes + (dia + 6) % 7));
        });
        if (!seguir) break;
      }
      else if (r.FREQ === 'MONTHLY') { var mm = con(y, m + k * cada, d); if (mm.getDate() === d && !candidata(mm)) break; }
      else if (r.FREQ === 'YEARLY') { if (!candidata(con(y + k * cada, m, d))) break; }
      else break;
    }
    return salida;
  }

  /** Eventos de los próximos 7 días, ordenados: [{inicio (ms), fin (ms), todoElDia, titulo, lugar}] */
  function proximos(texto, ahora) {
    var hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    var hasta = new Date(hoy.getTime() + DIAS * DIA);
    var eventos = analizar(texto);
    // Las ocurrencias cambiadas una a una (RECURRENCE-ID) sustituyen a la de la regla
    var cambiadas = {};
    eventos.forEach(function (ev) { if (ev.reemplaza && ev.uid) cambiadas[ev.uid + '@' + ev.reemplaza.fecha.getTime()] = true; });
    var lista = [];
    eventos.forEach(function (ev) {
      var dura = ev.fin ? ev.fin.fecha - ev.inicio.fecha : (ev.inicio.todoElDia ? DIA : 0);
      ocurrencias(ev, hoy, hasta).forEach(function (d) {
        if (ev.rrule && cambiadas[ev.uid + '@' + d.getTime()]) return;
        lista.push({ inicio: d.getTime(), fin: d.getTime() + dura, todoElDia: ev.inicio.todoElDia, titulo: ev.titulo || '(Sin título)', lugar: ev.lugar || '' });
      });
    });
    lista.sort(function (a, b) { return a.inicio - b.inicio || (b.todoElDia - a.todoElDia); });
    return lista;
  }

  /** Los próximos eventos; sin red, los últimos guardados (de hasta un día). Rechaza si no hay calendario. */
  function obtener() {
    return configurado().then(function (url) {
      if (!url) throw new Error('Sin calendario');
      var guardado = null;
      try { guardado = JSON.parse(localStorage.getItem('calendario')); } catch (e) {}
      if (guardado && guardado.url === url && Date.now() - guardado.guardado < CADUCA) return guardado.eventos;
      return leer(url).then(function (texto) {
        if (texto.indexOf('BEGIN:VCALENDAR') < 0) throw new Error('No es un calendario');
        var eventos = proximos(texto, new Date());
        try { localStorage.setItem('calendario', JSON.stringify({ url: url, guardado: Date.now(), eventos: eventos })); } catch (e) {}
        return eventos;
      }, function (e) {
        if (guardado && guardado.url === url && Date.now() - guardado.guardado < DIA) return guardado.eventos;
        throw e;
      });
    });
  }

  return { configurado: configurado, obtener: obtener, proximos: proximos };
})();
