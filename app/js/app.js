/*
 * TV Libre: pantalla de inicio sin anuncios para LG webOS 5, con estética tipo Apple TV.
 * El mando no mueve el foco del navegador, así que la navegación es propia: dos filas (el dock de apps
 * y las entradas) más dos paneles (Todas las apps y Ajustes); lo enfocado lleva la clase .foco.
 *
 * Eficiencia: no hay nada corriendo en segundo plano. El reloj se despierta una vez por minuto,
 * el tiempo cada 30 minutos y la rotación de fondos (si está activada) a su ritmo; todo se para
 * cuando la app se oculta.
 */
(function () {
  var TECLAS = {
    IZQ: 37, ARRIBA: 38, DER: 39, ABAJO: 40, OK: 13,
    ATRAS: 461, ROJO: 403, VERDE: 404, AMARILLO: 405, AZUL: 406
  };
  var MI_ID = 'com.tvlibre.inicio';
  var TODAS = '__todas';
  var MANTENER_MS = 600;   // cuánto hay que mantener OK para coger una app (como en tvOS)

  // Apps del sistema que no aportan en el dock: se ocultan al principio, pero siguen en Todas las apps
  var OCULTAS_DE_FABRICA = /^(com\.webos\.|com\.palm\.|com\.lge\.)/;

  var ENTRADAS = [
    { id: 'com.webos.app.livetv', title: 'TV', dibujo: 'tv' },
    { id: 'com.webos.app.hdmi1', title: 'HDMI 1', dibujo: 'hdmi' },
    { id: 'com.webos.app.hdmi2', title: 'HDMI 2', dibujo: 'hdmi' },
    { id: 'com.webos.app.hdmi3', title: 'HDMI 3', dibujo: 'hdmi' },
    { id: 'com.webos.app.browser', title: 'Navegador', dibujo: 'web' }
  ];
  var AJUSTES_TV = 'com.palm.app.settings';

  var trazo = 'fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"';
  var DIBUJOS = {
    tv: '<rect ' + trazo + ' x="8" y="14" width="48" height="32" rx="5"/><path ' + trazo + ' d="M22 54h20"/>',
    hdmi: '<path ' + trazo + ' d="M10 22h44v12l-6 8H16l-6-8z"/><path ' + trazo + ' d="M22 30h20"/>',
    web: '<circle ' + trazo + ' cx="32" cy="32" r="22"/><path ' + trazo + ' d="M10 32h44M32 10c8 8 8 36 0 44M32 10c-8 8-8 36 0 44"/>',
    ajustes: '<circle ' + trazo + ' cx="32" cy="32" r="8"/><path ' + trazo +
      ' d="M32 8v8M32 48v8M8 32h8M48 32h8M15 15l6 6M43 43l6 6M15 49l6-6M43 21l6-6"/>',
    sol: '<circle ' + trazo + ' cx="32" cy="32" r="11"/><path ' + trazo +
      ' d="M32 6v7M32 51v7M6 32h7M51 32h7M14 14l5 5M45 45l5 5M14 50l5-5M45 19l5-5"/>',
    luna: '<path ' + trazo + ' d="M48 40A20 20 0 0 1 24 16a20 20 0 1 0 24 24z"/>',
    imagen: '<rect ' + trazo + ' x="8" y="12" width="48" height="40" rx="6"/><path ' + trazo + ' d="M8 44l14-14 12 12 8-8 14 14"/>',
    rejilla: '<rect ' + trazo + ' x="12" y="12" width="16" height="16" rx="4"/><rect ' + trazo + ' x="36" y="12" width="16" height="16" rx="4"/>' +
      '<rect ' + trazo + ' x="12" y="36" width="16" height="16" rx="4"/><rect ' + trazo + ' x="36" y="36" width="16" height="16" rx="4"/>'
  };
  function svg(nombre) { return '<svg viewBox="0 0 64 64">' + DIBUJOS[nombre] + '</svg>'; }

  // ---------- Preferencias (localStorage de la propia app en la TV) ----------

  var prefs = cargar('prefs', {
    lugar: { nombre: 'Madrid', region: 'Comunidad de Madrid, España', lat: 40.4165, lon: -3.7026 },
    h24: true,
    tema: 'auto',             // auto | claro | oscuro
    fondo: 'montanas-amanecer',
    rotar: 15,                // minutos entre fondos (0 = no rotar)
    rotarEn: 'todas',         // todas | grupo
    profundidad: true,        // el primer plano de algunas fotos tapa el reloj
    reloj: 'vidrio',          // vidrio | fino | oculto
    fecha: true,              // fecha y tiempo encima del reloj
    vidrio: 'liquido',        // liquido | sencillo
    animaciones: true,
    atenuar: 0,               // 0, 0.25, 0.45, 0.65 o 'auto' (medio de 22:00 a 7:00)
    orden: [],                // ids en el orden elegido
    ocultas: null             // null = aún no decidido: se aplican las de fábrica
  });

  function cargar(clave, porDefecto) {
    try {
      var v = JSON.parse(localStorage.getItem(clave));
      if (v) {
        for (var k in porDefecto) if (!(k in v)) v[k] = porDefecto[k];
        delete v.ciudad;   // versión 0.2: la ciudad era solo un nombre
        return v;
      }
    } catch (e) {}
    return porDefecto;
  }
  function guardar() {
    try { localStorage.setItem('prefs', JSON.stringify(prefs)); } catch (e) {}
  }

  // ---------- Estado ----------

  var apps = [];
  var filas = [[], [], []];   // dock, entradas y el botón de ajustes (arriba a la derecha)
  var fila = 0, col = 0;
  var colPorFila = [0, 0];
  var editando = false;
  var tiempo = null;
  var temaActual = '';
  var panel = null;          // null | 'ajustes' | 'cajon'
  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;

  // ---------- Apps ----------

  function cargarApps() {
    return Luna.apps().then(function (lista) {
      lista = lista.filter(function (a) { return a.id !== MI_ID; });
      if (prefs.ocultas === null) {
        prefs.ocultas = lista.filter(function (a) { return OCULTAS_DE_FABRICA.test(a.id); }).map(function (a) { return a.id; });
        guardar();
      }
      var pos = {};
      prefs.orden.forEach(function (id, i) { pos[id] = i; });
      lista.sort(function (a, b) {
        var pa = a.id in pos ? pos[a.id] : 1e6, pb = b.id in pos ? pos[b.id] : 1e6;
        return pa - pb;
      });
      apps = lista;
    });
  }

  function visibles() {
    if (editando) return apps;
    return apps.filter(function (a) { return prefs.ocultas.indexOf(a.id) < 0; });
  }

  function tarjetaApp(a) {
    var t = document.createElement('div');
    t.className = 'app' + (prefs.ocultas.indexOf(a.id) >= 0 && !panel ? ' escondida' : '') + (a.id === TODAS ? ' mas' : '');
    var cara = document.createElement('div');
    cara.className = 'cara';
    if (a.id === TODAS) {
      cara.innerHTML = svg('rejilla');
    } else {
      cara.style.backgroundColor = a.bgColor || a.iconColor || '#3a3a40';
      var icono = a.largeIcon || a.icon;
      if (icono) {
        var img = document.createElement('img');
        img.src = icono;
        img.onerror = function () { cara.removeChild(img); cara.insertBefore(document.createTextNode((a.title || '?').charAt(0)), cara.firstChild); };
        cara.appendChild(img);
      } else {
        cara.textContent = (a.title || '?').charAt(0);
      }
    }
    var nombre = document.createElement('div');
    nombre.className = 'nombre';
    nombre.textContent = a.title;
    t.appendChild(cara);
    t.appendChild(nombre);
    t.dato = a;
    return t;
  }

  function chip(e) {
    var c = document.createElement('div');
    c.className = 'chip';
    c.innerHTML = svg(e.dibujo);
    c.appendChild(document.createTextNode(e.title));
    c.dato = e;
    return c;
  }

  // Se pinta todo de una vez con un DocumentFragment: un solo reflow
  function pintarApps() {
    var contenedor = $('fila-apps');
    var trozo = document.createDocumentFragment();
    visibles().forEach(function (a) { trozo.appendChild(tarjetaApp(a)); });
    if (!editando) trozo.appendChild(tarjetaApp({ id: TODAS, title: 'Todas las apps' }));
    contenedor.innerHTML = '';
    contenedor.appendChild(trozo);
    filas[0] = Array.prototype.slice.call(contenedor.querySelectorAll('.app'));
  }

  function pintarEntradas() {
    var contenedor = $('fila-entradas');
    ENTRADAS.forEach(function (e) { contenedor.appendChild(chip(e)); });
    filas[1] = Array.prototype.slice.call(contenedor.querySelectorAll('.chip'));
    var boton = $('boton-ajustes');
    boton.insertAdjacentHTML('beforeend', svg('ajustes'));
    boton.dato = { id: '__ajustes', title: 'Ajustes' };
    filas[2] = [boton];
  }

  function abrir(dato) {
    if (dato.id === TODAS) { abrirCajon(); return; }
    if (dato.id === '__ajustes') { abrirAjustes(); return; }
    Luna.abrir(dato.id).catch(function (err) {
      aviso('No se pudo abrir ' + dato.title);
      console.warn(err);
    });
  }

  // ---------- Foco ----------

  var PASO = 288 + 40;              // ancho de app + margen: fijo, así no hay que medir el DOM al moverse
  var ANCHO_DOCK = 1776 - 2 * 64;   // ancho útil del dock (ver .dock en estilos.css)
  var enfocado = null;

  function enfocar(f, c) {
    if (enfocado) enfocado.classList.remove('foco', 'moviendo');
    if (!filas[f].length) { enfocado = null; return; }
    c = Math.max(0, Math.min(c, filas[f].length - 1));
    fila = f; col = c; colPorFila[f] = c;
    enfocado = filas[f][c];
    enfocado.classList.add('foco');
    if (editando && f === 0) enfocado.classList.add('moviendo');
    if (f === 0) desplazar();
  }

  // El dock se desliza dejando una app de margen a la izquierda, como en Apple TV
  function desplazar() {
    var total = filas[0].length;
    var max = Math.max(0, total * PASO - 40 - ANCHO_DOCK + 24);   // +24: sitio para la app ampliada
    var x = Math.min(max, Math.max(0, (col - 1) * PASO));
    $('fila-apps').style.transform = 'translate3d(' + (-x) + 'px,0,0)';
  }

  function mover(dx, dy) {
    if (dy) {
      // Arriba desde el dock se llega al botón de ajustes; abajo desde él se vuelve al dock
      var f = fila === 0 && dy < 0 ? 2 : fila === 2 ? (dy > 0 ? 0 : -1) : fila + dy;
      if (f === 2 && !editando) { enfocar(2, 0); return; }
      if (!editando && f >= 0 && f < 2 && filas[f].length) enfocar(f, colPorFila[f]);
      return;
    }
    if (editando) { reordenar(dx); return; }
    enfocar(fila, col + dx);
  }

  // ---------- Mover apps (mantener OK o botón amarillo) ----------

  function empezarEdicion() {
    if (fila !== 0 || !enfocado || enfocado.dato.id === TODAS) return false;
    var id = enfocado.dato.id;
    editando = true;
    body.classList.add('editando');
    pintarApps();
    enfocar(0, indicePorId(id));
    return true;
  }

  function terminarEdicion() {
    var id = enfocado ? enfocado.dato.id : null;
    editando = false;
    body.classList.remove('editando');
    guardar();
    pintarApps();
    var i = id ? indicePorId(id) : 0;
    // Si la app quedó oculta, el foco pasa a la de al lado
    enfocar(0, i);
  }

  function indicePorId(id) {
    for (var i = 0; i < filas[0].length; i++) if (filas[0][i].dato.id === id) return i;
    return Math.min(col, filas[0].length - 1);
  }

  // Mover una app: se cambia de sitio el nodo, sin repintar la fila entera
  function reordenar(dx) {
    var destino = col + dx;
    if (destino < 0 || destino >= apps.length) return;
    var a = apps.splice(col, 1)[0];
    apps.splice(destino, 0, a);
    prefs.orden = apps.map(function (x) { return x.id; });
    var nodo = filas[0].splice(col, 1)[0];
    filas[0].splice(destino, 0, nodo);
    $('fila-apps').insertBefore(nodo, filas[0][destino + 1] || null);
    enfocar(0, destino);
  }

  function alternarOculta() {
    var id = enfocado.dato.id;
    var i = prefs.ocultas.indexOf(id);
    if (i >= 0) prefs.ocultas.splice(i, 1); else prefs.ocultas.push(id);
    enfocado.classList.toggle('escondida', i < 0);
  }

  // ---------- Todas las apps ----------

  var COLUMNAS = 6, ALTO_FILA = 122 + 92;
  var rejilla = [], celda = 0;

  function abrirCajon() {
    panel = 'cajon';
    var dentro = document.createElement('div');
    dentro.className = 'rejilla-dentro';
    apps.forEach(function (a) { dentro.appendChild(tarjetaApp(a)); });
    var r = $('rejilla');
    r.innerHTML = '';
    r.appendChild(dentro);
    rejilla = Array.prototype.slice.call(dentro.children);
    celda = 0;
    enfocarCelda(0);
    var c = $('cajon');
    c.classList.add('abierto');
    Fondos.colocarVidrio(c);
  }

  function cerrarCajon() {
    panel = null;
    $('cajon').classList.remove('abierto');
    // Se vacía al terminar la animación: menos nodos y menos memoria mientras no se ve
    setTimeout(function () { if (panel !== 'cajon') { $('rejilla').innerHTML = ''; rejilla = []; } }, 450);
  }

  function enfocarCelda(i) {
    if (!rejilla.length) return;
    if (rejilla[celda]) rejilla[celda].classList.remove('foco');
    celda = Math.max(0, Math.min(rejilla.length - 1, i));
    rejilla[celda].classList.add('foco');
    var filaRejilla = Math.floor(celda / COLUMNAS);
    var y = Math.max(0, filaRejilla - 2) * ALTO_FILA;
    rejilla[0].parentNode.style.transform = 'translate3d(0,' + (-y) + 'px,0)';
  }

  function teclaCajon(k) {
    if (k === TECLAS.ATRAS) cerrarCajon();
    else if (k === TECLAS.IZQ) enfocarCelda(celda - 1);
    else if (k === TECLAS.DER) enfocarCelda(celda + 1);
    else if (k === TECLAS.ARRIBA) { if (celda >= COLUMNAS) enfocarCelda(celda - COLUMNAS); }
    else if (k === TECLAS.ABAJO) { if (celda + COLUMNAS < rejilla.length) enfocarCelda(celda + COLUMNAS); }
    else if (k === TECLAS.OK && rejilla[celda]) abrir(rejilla[celda].dato);
  }

  // ---------- Tema y fondo ----------

  function dos(n) { return (n < 10 ? '0' : '') + n; }

  function horaLocal(d) {
    return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()) + 'T' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }

  // Hora de la ciudad elegida, que puede no estar en la zona de la TV
  function horaCiudad() {
    if (typeof tiempo.desfase !== 'number') return horaLocal(new Date());
    var d = new Date(Date.now() + tiempo.desfase * 1000);
    return d.getUTCFullYear() + '-' + dos(d.getUTCMonth() + 1) + '-' + dos(d.getUTCDate()) + 'T' + dos(d.getUTCHours()) + ':' + dos(d.getUTCMinutes());
  }

  function esDeDia() {
    if (tiempo && tiempo.amanecer) {
      // Open-Meteo da amanecer y anochecer en hora de la ciudad, sin zona: se compara como texto "AAAA-MM-DDTHH:MM"
      var local = horaCiudad();
      return local >= tiempo.amanecer && local < tiempo.anochecer;
    }
    var h = new Date().getHours();
    return h >= 8 && h < 20;
  }

  function temaDeseado() {
    if (prefs.tema !== 'auto') return prefs.tema;
    return esDeDia() ? 'claro' : 'oscuro';
  }

  function aplicarTema(animar) {
    var tema = temaDeseado();
    if (tema === temaActual) return;
    if (animar && prefs.animaciones) {
      body.classList.add('cambiando-tema');
      setTimeout(function () { body.classList.remove('cambiando-tema'); }, 700);
    }
    temaActual = tema;
    body.classList.toggle('claro', tema === 'claro');
    // Los fondos minimalistas tienen versión clara y oscura
    if (Fondos.buscar(prefs.fondo).minimal) aplicarFondo(animar);
    else pintarRelleno();
  }

  function alternarTema() {
    prefs.tema = temaActual === 'claro' ? 'oscuro' : 'claro';
    guardar();
    aplicarTema(true);
    aviso(prefs.tema === 'claro' ? 'Modo claro' : 'Modo oscuro', prefs.tema === 'claro' ? 'sol' : 'luna');
  }

  function aplicarFondo(animar) {
    Fondos.aplicar(Fondos.buscar(prefs.fondo), {
      tema: temaActual || temaDeseado(),
      frente: prefs.profundidad && prefs.reloj !== 'oculto',
      animar: animar !== false && prefs.animaciones
    });
  }

  // En el momento en que la transición tapa la pantalla: el reloj se coloca para la foto nueva
  // (algunas lo bajan para que las cumbres lo tapen) sin que se vea el salto
  function enMitad(f) {
    var y = 64 + (prefs.profundidad && f.relojY ? f.relojY : 0);
    $('cabecera').style.top = y + 'px';   // un único reflow, mientras la pantalla está difuminada
    pintarRelleno();
  }

  function siguienteFondo() {
    var f = Fondos.siguiente(prefs.fondo, 1);
    prefs.fondo = f.id;
    guardar();
    aplicarFondo();
    aviso(f.nombre, 'imagen');
    programarRotacion();
  }

  // Rotación: por todas las fotos, o solo dentro del grupo (de ciudad en ciudad, de playa en playa).
  // No rota con un panel abierto: la transición taparía lo que estás leyendo.
  var temporizadorRotacion;
  function programarRotacion() {
    clearTimeout(temporizadorRotacion);
    if (!prefs.rotar || document.hidden) return;
    temporizadorRotacion = setTimeout(function () {
      if (panel || editando) { programarRotacion(); return; }
      prefs.fondo = Fondos.siguienteRotacion(prefs.fondo, prefs.rotarEn === 'grupo').id;
      guardar();
      aplicarFondo();
      programarRotacion();
    }, prefs.rotar * 60 * 1000);
  }

  function aplicarVidrio() {
    body.classList.toggle('vidrio-sencillo', prefs.vidrio === 'sencillo');
    body.classList.toggle('sin-animaciones', !prefs.animaciones);
    body.classList.toggle('sin-profundidad', !prefs.profundidad);
    body.classList.toggle('reloj-fino', prefs.reloj === 'fino');
    body.classList.toggle('reloj-oculto', prefs.reloj === 'oculto');
    body.classList.toggle('sin-fecha', !prefs.fecha);
  }

  function colocarVidrios() {
    var paneles = document.querySelectorAll('.vidrio');
    for (var i = 0; i < paneles.length; i++) Fondos.colocarVidrio(paneles[i]);
  }

  // ---------- Reloj de vidrio ----------

  var relleno = document.querySelector('#reloj .relleno');

  // Las cifras se rellenan con la copia difuminada del fondo, aclarada (u oscurecida en un fondo claro)
  function pintarRelleno() {
    var vidrio = Fondos.vidrio();
    if (!vidrio || prefs.reloj !== 'vidrio') { relleno.style.backgroundImage = ''; return; }
    var minimalClaro = temaActual === 'claro' && Fondos.buscar(prefs.fondo).minimal;
    var tinte = minimalClaro ? 'rgba(20,24,32,0.55)' : 'rgba(255,255,255,0.3)';
    relleno.style.backgroundImage = 'linear-gradient(' + tinte + ',' + tinte + '),' + vidrio;
    relleno.style.backgroundSize = '1920px 1080px';
    alinearRelleno();
  }

  function alinearRelleno() {
    var p = Fondos.posicion(relleno);
    relleno.style.backgroundPosition = (-p.x) + 'px ' + (-p.y) + 'px';
  }

  function pintarFecha() {
    var d = new Date();
    var texto = escapar(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
    if (tiempo) {
      texto += '<span class="clima">' + Tiempo.icono(tiempo.codigo) + Math.round(tiempo.temp) + '° ' + escapar(tiempo.ciudad) + '</span>';
    }
    $('fecha').innerHTML = texto;
  }

  var temporizadorReloj;
  function reloj() {
    clearTimeout(temporizadorReloj);
    var d = new Date();
    var h = d.getHours();
    var texto = (prefs.h24 ? dos(h) : (h % 12) || 12) + ':' + dos(d.getMinutes());
    var spans = $('reloj').children;
    for (var i = 0; i < spans.length; i++) spans[i].textContent = texto;
    alinearRelleno();   // el reloj está centrado: si cambia de ancho, se mueve
    pintarFecha();
    // Despierta justo al cambiar el minuto, no cada pocos segundos
    if (!document.hidden) temporizadorReloj = setTimeout(reloj, 60500 - d.getSeconds() * 1000 - d.getMilliseconds());
    if (prefs.tema === 'auto') aplicarTema(true);
    aplicarAtenuado();
  }

  function escapar(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ---------- Tiempo ----------

  var temporizadorTiempo;
  function actualizarTiempo() {
    clearTimeout(temporizadorTiempo);
    Tiempo.obtener(prefs.lugar).then(function (t) {
      tiempo = t;
      pintarFecha();
      aplicarTema(true);
    }).catch(function (e) {
      console.warn('Tiempo no disponible', e);
    });
    if (!document.hidden) temporizadorTiempo = setTimeout(actualizarTiempo, 30 * 60 * 1000);
  }

  function aplicarAtenuado() {
    var nivel = prefs.atenuar;
    if (nivel === 'auto') {
      var h = new Date().getHours();
      nivel = h >= 22 || h < 7 ? 0.45 : 0;
    }
    $('atenuador').style.opacity = nivel;
  }

  // ---------- Ajustes ----------

  var ajusteFoco = 0;
  var resultados = null;     // sitios encontrados al buscar la ubicación
  var OPCIONES_TEMA = [['auto', 'Automático'], ['claro', 'Claro'], ['oscuro', 'Oscuro']];
  var OPCIONES_ATENUAR = [[0, 'No'], ['auto', 'De noche'], [0.25, 'Bajo'], [0.45, 'Medio'], [0.65, 'Alto']];
  var OPCIONES_VIDRIO = [['liquido', 'Líquido'], ['sencillo', 'Sencillo (más rápido)']];
  var OPCIONES_ROTAR = [[0, 'Nunca'], [1, 'Cada minuto'], [5, 'Cada 5 min'], [15, 'Cada 15 min'], [60, 'Cada hora']];
  var OPCIONES_ROTAR_EN = [['todas', 'Todas las fotos'], ['grupo', 'Solo este grupo']];
  var OPCIONES_RELOJ = [['vidrio', 'Vidrio'], ['fino', 'Fino'], ['oculto', 'Oculto']];

  function rotar(opciones, actual, paso) {
    var i = 0;
    for (var k = 0; k < opciones.length; k++) if (opciones[k][0] === actual) i = k;
    return opciones[(i + paso + opciones.length) % opciones.length][0];
  }
  function etiqueta(opciones, actual) {
    for (var k = 0; k < opciones.length; k++) if (opciones[k][0] === actual) return opciones[k][1];
    return '';
  }

  function listaAjustes() {
    var lista = [
      { grupo: 'Apariencia' },
      { nombre: 'Tema', valor: function () { return etiqueta(OPCIONES_TEMA, prefs.tema); },
        cambiar: function (p) { prefs.tema = rotar(OPCIONES_TEMA, prefs.tema, p); aplicarTema(true); } },
      { nombre: 'Fondo', valor: function () { var f = Fondos.buscar(prefs.fondo); return '<small>' + f.grupo + '</small>' + f.nombre; },
        cambiar: function (p) { prefs.fondo = Fondos.siguiente(prefs.fondo, p).id; aplicarFondo(); programarRotacion(); } },
      { nombre: 'Cambiar de fondo', valor: function () { return etiqueta(OPCIONES_ROTAR, prefs.rotar); },
        cambiar: function (p) { prefs.rotar = rotar(OPCIONES_ROTAR, prefs.rotar, p); programarRotacion(); } },
      { nombre: 'Rotar entre', valor: function () { return etiqueta(OPCIONES_ROTAR_EN, prefs.rotarEn); },
        cambiar: function (p) { prefs.rotarEn = rotar(OPCIONES_ROTAR_EN, prefs.rotarEn, p); } },
      { grupo: 'Pantalla de inicio' },
      { nombre: 'Reloj', valor: function () { return etiqueta(OPCIONES_RELOJ, prefs.reloj); },
        cambiar: function (p) { prefs.reloj = rotar(OPCIONES_RELOJ, prefs.reloj, p); aplicarVidrio(); aplicarFondo(false); pintarRelleno(); } },
      { nombre: 'Profundidad', valor: function () { return prefs.profundidad ? 'Sí' : 'No'; },
        cambiar: function () { prefs.profundidad = !prefs.profundidad; aplicarVidrio(); aplicarFondo(false); } },
      { nombre: 'Fecha y tiempo', valor: function () { return prefs.fecha ? 'Sí' : 'No'; },
        cambiar: function () { prefs.fecha = !prefs.fecha; aplicarVidrio(); } },
      { nombre: 'Vidrio', valor: function () { return etiqueta(OPCIONES_VIDRIO, prefs.vidrio); },
        cambiar: function (p) { prefs.vidrio = rotar(OPCIONES_VIDRIO, prefs.vidrio, p); aplicarVidrio(); } },
      { nombre: 'Animaciones', valor: function () { return prefs.animaciones ? 'Completas' : 'Reducidas'; },
        cambiar: function () { prefs.animaciones = !prefs.animaciones; aplicarVidrio(); } },
      { nombre: 'Atenuar pantalla', valor: function () { return etiqueta(OPCIONES_ATENUAR, prefs.atenuar); },
        cambiar: function (p) { prefs.atenuar = rotar(OPCIONES_ATENUAR, prefs.atenuar, p); aplicarAtenuado(); } },
      { grupo: 'General' },
      { nombre: 'Ubicación', tipo: 'texto' }
    ];
    if (resultados === 'buscando') {
      lista.push({ nombre: 'Buscando…', valor: function () { return ''; } });
    } else if (resultados) {
      if (!resultados.length) lista.push({ nombre: 'Sin resultados', valor: function () { return 'Prueba otro nombre'; } });
      resultados.forEach(function (l) {
        lista.push({ nombre: l.nombre, resultado: true, valor: function () { return '<small>' + escapar(l.region) + '</small>'; },
          cambiar: function () { elegirLugar(l); } });
      });
    }
    lista.push(
      { nombre: 'Formato de hora', valor: function () { return prefs.h24 ? '24 horas' : '12 horas'; },
        cambiar: function () { prefs.h24 = !prefs.h24; reloj(); } },
      { nombre: 'Ajustes de la TV', accion: true, valor: function () { return 'Abrir'; },
        cambiar: function () { cerrarAjustes(); abrir({ id: AJUSTES_TV, title: 'Ajustes de la TV' }); } },
      { nombre: 'Restablecer el dock', accion: true, valor: function () { return 'OK'; },
        cambiar: function () {
          prefs.orden = []; prefs.ocultas = null; guardar();
          cargarApps().then(function () { pintarApps(); enfocar(fila, col); });
          aviso('Dock restablecido');
        } }
    );
    return lista;
  }
  var AJUSTES = [], ELEGIBLES = [];

  function abrirAjustes() {
    panel = 'ajustes';
    ajusteFoco = 0;
    resultados = null;
    pintarAjustes();
    var p = $('ajustes');
    p.classList.add('abierto');
    Fondos.colocarVidrio(p);
  }

  function cerrarAjustes() {
    var input = document.querySelector('#lista-ajustes input');
    if (input) input.blur();
    guardar();
    panel = null;
    $('ajustes').classList.remove('abierto');
    mostrarPie();
  }

  function buscarLugar(input) {
    input.blur();
    var texto = input.value.trim();
    if (!texto || texto === prefs.lugar.nombre) return;
    resultados = 'buscando';
    pintarAjustes();
    Tiempo.buscar(texto).then(function (lista) {
      if (panel !== 'ajustes') return;
      resultados = lista;
      pintarAjustes();
      if (lista.length) enfocarAjuste(ajusteFoco + 1);
    }).catch(function () {
      resultados = null;
      if (panel === 'ajustes') pintarAjustes();
      aviso('Sin conexión para buscar');
    });
  }

  function elegirLugar(l) {
    prefs.lugar = l;
    resultados = null;
    guardar();
    pintarAjustes();
    actualizarTiempo();
    aviso(l.nombre);
  }

  function pintarAjustes() {
    AJUSTES = listaAjustes();
    ELEGIBLES = AJUSTES.map(function (a, i) { return a.grupo ? -1 : i; }).filter(function (i) { return i >= 0; });
    ajusteFoco = Math.min(ajusteFoco, ELEGIBLES.length - 1);
    var lista = $('lista-ajustes');
    var trozo = document.createElement('div');
    trozo.className = 'lista-dentro';
    AJUSTES.forEach(function (a, i) {
      var el = document.createElement('div');
      if (a.grupo) { el.className = 'grupo'; el.textContent = a.grupo; trozo.appendChild(el); return; }
      el.className = 'ajuste' + (a.resultado ? ' resultado' : '') + (i === ELEGIBLES[ajusteFoco] ? ' foco' : '');
      var nombre = document.createElement('span');
      nombre.textContent = a.nombre;
      el.appendChild(nombre);
      if (a.tipo === 'texto') {
        var input = document.createElement('input');
        input.value = prefs.lugar.nombre;
        el.appendChild(input);
      } else {
        var valor = document.createElement('span');
        valor.className = 'valor';
        el.appendChild(valor);
      }
      a.el = el;
      trozo.appendChild(el);
      refrescarAjuste(a);
    });
    lista.innerHTML = '';
    lista.appendChild(trozo);
    desplazarAjustes();
  }

  // La lista no cabe con los resultados de búsqueda: se desliza para que lo enfocado quede a la vista
  var ALTO_LISTA = 800;
  function desplazarAjustes() {
    var dentro = document.querySelector('.lista-dentro');
    var el = AJUSTES[ELEGIBLES[ajusteFoco]].el;
    var y = Math.max(0, Math.min(dentro.offsetHeight - ALTO_LISTA, el.offsetTop - ALTO_LISTA / 2 + el.offsetHeight / 2));
    dentro.style.transform = 'translate3d(0,' + (-y) + 'px,0)';
  }

  // Al cambiar un valor solo se reescribe esa fila
  function refrescarAjuste(a) {
    var v = a.el.querySelector('.valor');
    if (v) v.innerHTML = a.valor() + (a.cambiar && !a.accion && !a.resultado ? ' &nbsp;‹ ›' : '');
  }
  function refrescarTodos() { AJUSTES.forEach(function (x) { if (x.el && x.valor) refrescarAjuste(x); }); }

  function enfocarAjuste(i) {
    AJUSTES[ELEGIBLES[ajusteFoco]].el.classList.remove('foco');
    ajusteFoco = Math.max(0, Math.min(ELEGIBLES.length - 1, i));
    AJUSTES[ELEGIBLES[ajusteFoco]].el.classList.add('foco');
    desplazarAjustes();
  }

  function teclaAjustes(k) {
    var input = document.querySelector('#lista-ajustes input');
    if (document.activeElement === input) {
      // El teclado en pantalla de webOS escribe en el input; OK busca, Atrás cancela
      if (k === TECLAS.OK) { buscarLugar(input); return true; }
      if (k === TECLAS.ATRAS || k === TECLAS.ABAJO) { input.value = prefs.lugar.nombre; input.blur(); return true; }
      return false;
    }
    var a = AJUSTES[ELEGIBLES[ajusteFoco]];
    if (k === TECLAS.ATRAS || k === TECLAS.AZUL) cerrarAjustes();
    else if (k === TECLAS.ARRIBA) enfocarAjuste(ajusteFoco - 1);
    else if (k === TECLAS.ABAJO) enfocarAjuste(ajusteFoco + 1);
    else if (k === TECLAS.OK) {
      if (a.tipo === 'texto') { input.value = ''; input.focus(); return true; }
      if (a.cambiar) { a.cambiar(1); guardar(); if (AJUSTES.indexOf(a) >= 0 && a.el.parentNode) refrescarAjuste(a); }
    } else if ((k === TECLAS.IZQ || k === TECLAS.DER) && a.cambiar && !a.resultado) {
      a.cambiar(k === TECLAS.IZQ ? -1 : 1); guardar(); refrescarAjuste(a);
    } else if (k === TECLAS.VERDE) { alternarTema(); refrescarTodos(); }
    else if (k === TECLAS.ROJO) { siguienteFondo(); refrescarTodos(); }
    return true;
  }

  // ---------- Avisos y pie ----------

  var temporizadorAviso;
  function aviso(texto, icono) {
    $('aviso-icono').innerHTML = icono ? svg(icono) : '';
    $('aviso-texto').textContent = texto;
    var el = $('aviso');
    el.classList.remove('visible');
    void el.offsetWidth;   // reinicia la animación del icono
    Fondos.colocarVidrio(el);   // el ancho cambia con el texto
    el.classList.add('visible');
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(function () { el.classList.remove('visible'); }, 2200);
  }

  // Las teclas de colores se muestran unos segundos y desaparecen para dejar la pantalla limpia
  var temporizadorPie;
  function mostrarPie() {
    $('pie').classList.remove('apagado');
    clearTimeout(temporizadorPie);
    temporizadorPie = setTimeout(function () { $('pie').classList.add('apagado'); }, 7000);
  }

  // ---------- Teclado / mando ----------

  // En el ordenador: Escape = Atrás, R/G/A/S = rojo/verde/amarillo/azul (para probar sin TV)
  var PRUEBA = { 82: TECLAS.ROJO, 71: TECLAS.VERDE, 65: TECLAS.AMARILLO, 83: TECLAS.AZUL };
  function normalizar(e) {
    if (e.target.tagName === 'INPUT' && e.keyCode !== 13 && e.keyCode !== 27 && e.keyCode !== 461 && e.keyCode !== 40) return 0;
    if (e.keyCode === 27 || e.keyCode === 8) return TECLAS.ATRAS;
    if (!Luna.enTV && PRUEBA[e.keyCode]) return PRUEBA[e.keyCode];
    return e.keyCode;
  }

  // OK en la pantalla principal actúa al soltarlo, para que mantenerlo pueda coger la app (como tvOS).
  // Vale para mandos que repiten la tecla mientras se mantiene y para los que solo mandan pulsar y soltar.
  var okAbajo = false, okMantenido = false, temporizadorOk = null;
  function okReiniciar() { okAbajo = false; okMantenido = false; clearTimeout(temporizadorOk); }

  function pulsarOk() {
    if (editando) alternarOculta();
    else if (enfocado) abrir(enfocado.dato);
  }
  function mantenerOk() {
    if (editando) return;
    if (!empezarEdicion()) pulsarOk();
  }

  // Al mantener pulsada una flecha, el mando repite muy rápido: se limita a un paso cada 110 ms
  // para que la cola de eventos no se acumule (eso es lo que se nota como "lag")
  var ultimaRepeticion = 0;

  document.addEventListener('keydown', function (e) {
    var k = normalizar(e);
    if (!k) return;
    if (e.repeat && k >= 37 && k <= 40) {
      var ahora = Date.now();
      if (ahora - ultimaRepeticion < 110) { e.preventDefault(); return; }
      ultimaRepeticion = ahora;
    }
    if (panel === 'ajustes') { if (teclaAjustes(k)) e.preventDefault(); return; }
    if (panel === 'cajon') { if (!e.repeat || k !== TECLAS.OK) teclaCajon(k); e.preventDefault(); return; }
    switch (k) {
      case TECLAS.OK:
        if (e.repeat || okAbajo) break;   // ya hay un temporizador en marcha
        okAbajo = true; okMantenido = false;
        temporizadorOk = setTimeout(function () { okMantenido = true; mantenerOk(); }, MANTENER_MS);
        break;
      case TECLAS.IZQ: mover(-1, 0); break;
      case TECLAS.DER: mover(1, 0); break;
      case TECLAS.ARRIBA: mover(0, -1); break;
      case TECLAS.ABAJO: mover(0, 1); break;
      case TECLAS.ROJO: siguienteFondo(); break;
      case TECLAS.VERDE: alternarTema(); break;
      case TECLAS.AMARILLO: if (editando) terminarEdicion(); else empezarEdicion(); break;
      case TECLAS.AZUL: if (!editando) abrirAjustes(); break;
      case TECLAS.ATRAS: if (editando) terminarEdicion(); break;   // en la pantalla principal no hace nada
      default: return;
    }
    e.preventDefault();
  });

  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== TECLAS.OK || panel || !okAbajo) return;
    e.preventDefault();
    var mantenido = okMantenido;
    okReiniciar();
    if (!mantenido) pulsarOk();
  });
  window.addEventListener('blur', okReiniciar);

  // Al volver a la app (p. ej. tras instalar otra), recarga la lista
  document.addEventListener('webOSRelaunch', function () {
    if (panel === 'cajon') cerrarCajon();
    cargarApps().then(function () { pintarApps(); enfocar(fila, col); });
  });

  // Oculta = sin temporizadores. Visible otra vez = se ponen al día
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearTimeout(temporizadorReloj);
      clearTimeout(temporizadorTiempo);
      clearTimeout(temporizadorRotacion);
      okReiniciar();
    } else {
      reloj();
      actualizarTiempo();
      programarRotacion();
      mostrarPie();
    }
  });

  // ---------- Arranque ----------

  Fondos.iniciar();
  Fondos.al('vidrio', pintarRelleno);
  Fondos.al('mitad', enMitad);
  aplicarVidrio();
  aplicarTema(false);
  aplicarFondo(false);
  reloj();
  pintarEntradas();
  colocarVidrios();
  cargarApps().catch(function () { apps = []; }).then(function () {
    pintarApps();
    enfocar(0, 0);
    // Doble rAF: el estado inicial ya está pintado cuando se quita la clase, así hay transición de entrada
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      body.classList.remove('entrada');
      alinearRelleno();
    }); });
  });
  actualizarTiempo();
  programarRotacion();
  mostrarPie();
  // Las fuentes pueden llegar después del primer pintado y cambiar el ancho del reloj
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(alinearRelleno);
})();
