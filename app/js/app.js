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
    profundidad: true,
    cielo: true,              // las fotos pasan a su versión de noche en oscuro (y alguna nocturna, de día en claro)        // el primer plano de algunas fotos tapa el reloj
    reloj: 'vidrio',          // vidrio | fino | oculto
    fecha: true,              // fecha encima del reloj
    tiempo: 'tarjeta',        // tarjeta (arriba a la izquierda) | fecha (junto a la fecha) | oculto
    vidrio: 'liquido',        // liquido | sencillo
    animaciones: true,
    atenuar: 0,               // 0, 0.25, 0.45, 0.65, 'auto' (medio de 22:00 a 7:00) o 'tv' (de noche, la retroiluminación de la TV)
    luzDia: null,
    despertar: '',            // 'HH:MM': esa mañana TV Libre abre con el reloj y el tiempo del día ('' = no)
    buenosDias: '',           // el último día que se enseñó (AAAA-MM-DD), para no repetirlo             // la retroiluminación de la TV antes de bajarla de noche, para devolverla por la mañana
    favoritas: null,          // ids de la fila de favoritas, en orden; null = las 7 primeras
    ayuda: 'siempre',         // ayuda de los botones de colores abajo: siempre | inicio (unos segundos) | nunca
    reposo: 5,                // minutos sin tocar el mando hasta el modo marco (0 = nunca)
    orden: [],                // ids en el orden elegido
    ocultas: null,            // null = aún no decidido: se aplican las de fábrica
    ultima: '',               // última app o entrada abierta: al volver, el foco está ahí ("seguir viendo")
    devmode: 0                // última renovación de Developer Mode (ms); 0 = se apunta al primer arranque
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
    avisarMovil();
  }

  // ---------- La app del móvil ----------
  // Al abrir TV Libre, el móvil manda su dirección ({movil: 'http://ip:puerto/'}). Mientras tenga la app abierta,
  // se le cuenta cómo están las apps (favoritas, ocultas y orden) para que las enseñe igual que la TV.
  var MOVIL_VALIDO = /^http:\/\/(10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}\/$/;   // solo la red de casa
  var movil = null, ultimoEnvio = '';
  try { movil = localStorage.getItem('movil'); } catch (e) {}

  function avisarMovil(siempre) {
    if (!movil || prefs.ocultas === null || !prefs.favoritas) return;   // aún sin la primera lista de apps
    var datos = JSON.stringify({ favoritas: prefs.favoritas || [], ocultas: prefs.ocultas || [], orden: prefs.orden || [] });
    if (datos === ultimoEnvio && !siempre) return;   // guardar() también se llama por ajustes que no son de apps
    ultimoEnvio = datos;
    try {
      var x = new XMLHttpRequest();
      x.open('POST', movil);
      x.timeout = 3000;
      x.setRequestHeader('Content-Type', 'text/plain');   // así no hay consulta previa de CORS
      x.send(datos);
    } catch (e) {}   // con la app del móvil cerrada no contesta nadie: no pasa nada
  }

  // ---------- Estado ----------

  var apps = [];
  // Filas de foco. De arriba abajo en pantalla: ARRIBA (tiempo y ajustes), FAV, RESTO, ENTRADAS
  var FAV = 0, RESTO = 1, ENTRADAS_F = 2, ARRIBA = 3;
  var ORDEN_V = [ARRIBA, FAV, RESTO, ENTRADAS_F];   // las entradas, bajando la pantalla
  var CONTENEDOR = ['fila-apps', 'fila-resto'];
  var filas = [[], [], [], []];
  var fila = FAV, col = 0;
  var colPorFila = [0, 0, 0, -1];   // -1: la primera vez, arriba se va al botón de ajustes
  var desp = [0, 0];                // desplazamiento en px de cada fila de apps
  var editando = false;
  var tiempo = null;
  var temaActual = '';
  var panel = null;          // null | 'ajustes' | 'cajon' | 'agenda'
  var $ = function (id) { return document.getElementById(id); };
  var body = document.body;

  // ---------- Apps ----------

  // La última lista buena se guarda: al arrancar se pinta al momento y se refresca por detrás
  // (Luna, y sobre todo SSAP, pueden tardar varios segundos)
  function appsGuardadas() {
    try { var l = JSON.parse(localStorage.getItem('apps')); if (l && l.length) return l; } catch (e) {}
    return null;
  }

  // Seguir viendo: al volver a TV Libre, el foco está en lo último que abriste (si sigue en el dock o en las entradas)
  function enfocarUltima() {
    if (panel || editando || !prefs.ultima) return;
    for (var f = FAV; f <= ENTRADAS_F; f++) {
      for (var i = 0; i < filas[f].length; i++) {
        if (filas[f][i].dato.id === prefs.ultima) { enfocar(f, i); return; }
      }
    }
  }

  function cargarApps() {
    return Luna.apps().then(function (lista) {
      if (lista === Luna.CONOCIDAS && apps.length) lista = apps;   // la lista de reserva no sustituye a una real
      if (lista !== Luna.CONOCIDAS) {
        try {
          localStorage.setItem('apps', JSON.stringify(lista.map(function (a) {
            return { id: a.id, appId: a.appId, params: a.params, title: a.title, icon: a.icon, largeIcon: a.largeIcon, bgColor: a.bgColor, iconColor: a.iconColor };
          })));
        } catch (e) {}
      }
      ordenarApps(lista);
    });
  }

  function ordenarApps(lista) {
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
    // Favoritas al principio: las 7 primeras que se ven (lo que cabe en su fila)
    if (!prefs.favoritas) {
      prefs.favoritas = lista.filter(function (a) { return !oculta(a.id); }).slice(0, 7).map(function (a) { return a.id; });
      guardar();
    }
  }

  // prefs.ocultas es null hasta que llega la primera lista de apps
  function oculta(id) { return !!prefs.ocultas && prefs.ocultas.indexOf(id) >= 0; }

  // Las apps de una fila: favoritas en el orden elegido; el resto, en el orden general.
  // Editando se ven también las ocultas (atenuadas), para poder volver a mostrarlas
  function appsDeFila(f) {
    var favs = prefs.favoritas || [];
    var lista;
    if (f === FAV) {
      var porId = {};
      apps.forEach(function (a) { porId[a.id] = a; });
      lista = favs.map(function (id) { return porId[id]; }).filter(Boolean);
    } else {
      lista = apps.filter(function (a) { return favs.indexOf(a.id) < 0; });
    }
    return editando ? lista : lista.filter(function (a) { return !oculta(a.id); });
  }

  function tarjetaApp(a) {
    var t = document.createElement('div');
    t.className = 'app' + (oculta(a.id) ? ' escondida' : '') + (a.id === TODAS ? ' mas' : '');
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
    if (e.senal) c.insertAdjacentHTML('beforeend', '<i class="senal"></i>');   // hay algo enchufado y encendido
    c.dato = e;
    return c;
  }

  // Se pinta todo de una vez con un DocumentFragment: un solo reflow
  function pintarApps() {
    [FAV, RESTO].forEach(function (f) {
      var contenedor = $(CONTENEDOR[f]);
      var trozo = document.createDocumentFragment();
      appsDeFila(f).forEach(function (a) { trozo.appendChild(tarjetaApp(a)); });
      if (f === RESTO && !editando) trozo.appendChild(tarjetaApp({ id: TODAS, title: 'Todas las apps' }));
      contenedor.innerHTML = '';
      contenedor.appendChild(trozo);
      filas[f] = Array.prototype.slice.call(contenedor.querySelectorAll('.app'));
      ajustarDock(f);
    });
  }

  // Cada caja mide lo que sus apps, centrada, hasta el ancho de la pantalla (y luego se desplaza).
  // Se centra con left y no con transform para que offsetLeft siga valiendo para el vidrio
  var MAX_DOCK = 1776, MARGEN_DOCK = 24, VACIA = 760;
  var anchoUtil = [0, 0], izquierda = [0, 0];
  function ajustarDock(f) {
    var n = filas[f].length;
    var w = n ? Math.min(MAX_DOCK, n * PASO - 32 + 2 * MARGEN_DOCK) : VACIA;
    var dock = $(CONTENEDOR[f]).parentNode;
    izquierda[f] = Math.round((1920 - w) / 2);
    anchoUtil[f] = w - 2 * MARGEN_DOCK;
    dock.style.width = w + 'px';
    dock.style.left = izquierda[f] + 'px';
    Fondos.colocarVidrio(dock);
    desp[f] = -1;   // fuerza a recolocar la fila con el ancho nuevo
    desplazar(f);
  }

  function pintarEntradas(lista) {
    var contenedor = $('fila-entradas');
    var viejos = contenedor.querySelectorAll('.chip');
    for (var i = 0; i < viejos.length; i++) contenedor.removeChild(viejos[i]);
    lista.forEach(function (e) { contenedor.appendChild(chip(e)); });
    filas[ENTRADAS_F] = Array.prototype.slice.call(contenedor.querySelectorAll('.chip'));
    Fondos.colocarVidrio(contenedor);   // el ancho cambia con los nombres
    if (fila === ENTRADAS_F) enfocar(ENTRADAS_F, col);
  }

  function prepararBotonAjustes() {
    var boton = $('boton-ajustes');
    boton.insertAdjacentHTML('beforeend', svg('ajustes'));
    boton.dato = { id: '__ajustes', title: 'Ajustes' };
    filas[ARRIBA] = [boton];
  }

  // Los HDMI con el nombre que les diste en la TV ("PS5") y un punto si tienen señal.
  // Si el firmware no da la lista, se quedan los tres genéricos
  var ultimasEntradas = '';
  function actualizarEntradas() {
    Luna.entradas().then(function (hdmi) {
      var lista = [ENTRADAS[0]].concat(hdmi.map(function (h) {
        return { id: h.appId, title: h.nombre, dibujo: 'hdmi', senal: h.conectada };
      }), [ENTRADAS[ENTRADAS.length - 1]]);
      var clave = JSON.stringify(lista);
      if (clave === ultimasEntradas) return;
      ultimasEntradas = clave;
      pintarEntradas(lista);
    }).catch(function () {});
  }

  function abrir(dato) {
    if (dato.id === TODAS) { abrirCajon(); return; }
    if (dato.id === '__ajustes') { abrirAjustes(); return; }
    if (dato.id === '__tiempo') return;
    if (dato.id === '__calendario') { abrirAgenda(); return; }   // la tarjeta solo se enfoca para ver las horas
    prefs.ultima = dato.id;
    guardar();
    // Un acceso fijado (un vídeo de YouTube…) abre su app con sus params; una app normal, solo por su id
    Luna.abrir(dato.appId || dato.id, dato.params || undefined).catch(function (err) {
      aviso('No se pudo abrir ' + dato.title);
      console.warn(err);
    });
  }

  // ---------- Foco ----------

  var PASO = 208 + 32;               // ancho de app + margen (ver .dock .app): fijo, así no hay que medir el DOM al moverse
  var enfocado = null;

  function enfocar(f, c) {
    var antes = enfocado;
    if (enfocado) enfocado.classList.remove('foco', 'moviendo');
    if (!filas[f].length) { enfocado = null; return; }
    c = Math.max(0, Math.min(c, filas[f].length - 1));
    fila = f; col = c; colPorFila[f] = c;
    enfocado = filas[f][c];
    enfocado.classList.add('foco');
    if (editando && f <= RESTO) enfocado.classList.add('moviendo');
    if (f <= RESTO) desplazar(f);
    ponerNombre(f, c);
    ponerPagina(f === RESTO || f === ENTRADAS_F ? 2 : 1);
    // La tarjeta del tiempo crece al enfocarla (previsión por horas): su vidrio se vuelve a recortar
    var tarjeta = $('tarjeta-tiempo');
    if (antes === tarjeta || enfocado === tarjeta) Fondos.colocarVidrio(tarjeta);
  }

  // Un solo rótulo para las dos filas de apps: se desliza bajo la enfocada (solo transform y opacity)
  var rotulo = null, rotuloVisible = false;
  function ponerNombre(f, c) {
    if (!rotulo) rotulo = $('nombre-foco');
    if (f > RESTO) { rotulo.classList.remove('visible'); rotuloVisible = false; return; }
    var dock = $(CONTENEDOR[f]).parentNode;
    var x = izquierda[f] + MARGEN_DOCK + c * PASO - desp[f] + 104 - 160;   // centrado bajo la app (rótulo de 320)
    var y = dock.offsetTop + dock.offsetHeight + 12;
    if (!rotuloVisible) { rotulo.classList.add('quieto'); rotulo.offsetWidth; }   // aparece en su sitio, sin deslizarse
    rotulo.textContent = filas[f][c].querySelector('.nombre').textContent;
    rotulo.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    rotulo.classList.remove('quieto');
    rotulo.classList.add('visible');
    rotuloVisible = true;
  }

  // El dock se desliza dejando una app de margen a la izquierda, como en Apple TV
  function desplazar(f) {
    var total = filas[f].length;
    var max = Math.max(0, total * PASO - 32 - anchoUtil[f]);
    var x = Math.min(max, Math.max(0, (colPorFila[f] - 1) * PASO));
    if (x === desp[f]) return;
    desp[f] = x;
    $(CONTENEDOR[f]).style.transform = 'translate3d(' + (-x) + 'px,0,0)';
  }

  // Segunda pantalla: al bajar de las favoritas, todo sube SUBIDA px y aparecen el resto de apps y las entradas, como en Apple TV.
  // Solo se anima transform (las capas se suben a la GPU justo antes, ver .desplazando);
  // el vidrio se funde mientras se mueve y se recoloca al llegar
  var SUBIDA = 560, pagina = 1, temporizadorPagina;
  function ponerPagina(n) {
    if (n === pagina) return;
    pagina = n;
    body.classList.add('desplazando');
    clearTimeout(temporizadorPagina);
    requestAnimationFrame(function () {
      body.classList.toggle('pagina-2', n === 2);
      Fondos.subir(n === 2 ? SUBIDA : 0);
      temporizadorPagina = setTimeout(function () {
        colocarVidrios();
        body.classList.remove('desplazando');
      }, 520);
    });
  }

  // Entre las dos filas de apps se baja o sube a la tarjeta que está justo debajo o encima en pantalla
  function columnaEnPantalla(desde, hacia) {
    var x = izquierda[desde] + col * PASO - desp[desde];
    return Math.max(0, Math.round((x - izquierda[hacia] + desp[hacia]) / PASO));
  }

  function mover(dx, dy) {
    if (dy) {
      if (editando) { cambiarDeFila(dy); return; }
      // Se sigue el orden en pantalla (ARRIBA, FAV, RESTO, ENTRADAS) saltando las filas vacías
      var i = ORDEN_V.indexOf(fila) + dy;
      while (i >= 0 && i < ORDEN_V.length && !filas[ORDEN_V[i]].length) i += dy;
      if (i < 0 || i >= ORDEN_V.length) return;
      var f = ORDEN_V[i];
      if (f === ARRIBA) enfocar(f, colPorFila[f] >= 0 ? colPorFila[f] : filas[f].length - 1);
      else if (f <= RESTO && fila <= RESTO) enfocar(f, columnaEnPantalla(fila, f));
      else enfocar(f, colPorFila[f]);
      return;
    }
    if (editando) { reordenar(dx); return; }
    enfocar(fila, col + dx);
  }

  // ---------- Mover apps (mantener OK o botón amarillo) ----------

  // forzar (botón amarillo): empieza aunque el foco no esté en una app, desde la primera.
  // Si no, con todas las apps ocultas no habría forma de volver a mostrarlas
  function empezarEdicion(forzar) {
    var enApp = fila <= RESTO && enfocado && enfocado.dato.id !== TODAS;
    if (!apps.length || (!enApp && !forzar)) return false;
    var id = enApp ? enfocado.dato.id : apps[0].id;
    editando = true;
    body.classList.add('editando');
    pintarApps();
    enfocarApp(id);
    return true;
  }

  function terminarEdicion() {
    var id = enfocado ? enfocado.dato.id : null;
    var f = fila <= RESTO ? fila : FAV;
    editando = false;
    body.classList.remove('editando');
    guardar();
    pintarApps();
    // Si la app quedó oculta, el foco pasa a la de al lado
    if (!enfocarApp(id)) enfocar(filas[f].length ? f : RESTO, col);
  }

  /** Enfoca la app con ese id en la fila donde esté. false si no está a la vista. */
  function enfocarApp(id) {
    for (var f = FAV; f <= RESTO; f++) {
      for (var i = 0; i < filas[f].length; i++) if (filas[f][i].dato.id === id) { enfocar(f, i); return true; }
    }
    return false;
  }

  function indicePorId(id) {
    for (var i = 0; i < filas[fila].length; i++) if (filas[fila][i].dato.id === id) return i;
    return Math.min(col, filas[fila].length - 1);
  }

  // Mover una app dentro de su fila: se cambia de sitio el nodo, sin repintar
  function reordenar(dx) {
    if (fila > RESTO) return;
    var destino = col + dx;
    if (destino < 0 || destino >= filas[fila].length) return;
    var a = filas[fila][col].dato.id, b = filas[fila][destino].dato.id;
    if (fila === FAV) {
      prefs.favoritas = filas[FAV].map(function (t) { return t.dato.id; });
      prefs.favoritas.splice(destino, 0, prefs.favoritas.splice(col, 1)[0]);
    } else {
      // El resto sigue el orden general: se intercambian las dos apps en él
      var i = indiceApp(a), j = indiceApp(b);
      var x = apps[i]; apps[i] = apps[j]; apps[j] = x;
      prefs.orden = apps.map(function (y) { return y.id; });
    }
    var nodo = filas[fila].splice(col, 1)[0];
    filas[fila].splice(destino, 0, nodo);
    $(CONTENEDOR[fila]).insertBefore(nodo, filas[fila][destino + 1] || null);
    enfocar(fila, destino);
  }

  // La primera favorita; si no hay favoritas, la primera del resto
  function enfocarInicio() { enfocar(filas[FAV].length ? FAV : RESTO, 0); }

  function indiceApp(id) {
    for (var i = 0; i < apps.length; i++) if (apps[i].id === id) return i;
    return -1;
  }

  // Editando, ▲ sube la app del resto a favoritas (al final) y ▼ la baja de favoritas al resto
  function cambiarDeFila(dy) {
    if (!enfocado || fila > RESTO) return;
    var id = enfocado.dato.id;
    if (dy < 0 && fila === RESTO) prefs.favoritas.push(id);
    else if (dy > 0 && fila === FAV) prefs.favoritas.splice(prefs.favoritas.indexOf(id), 1);
    else return;
    pintarApps();
    enfocarApp(id);
  }

  /** Oculta o vuelve a mostrar la app en el dock. Devuelve true si queda oculta. */
  function alternarOcultaId(id) {
    if (!prefs.ocultas) prefs.ocultas = [];
    var i = prefs.ocultas.indexOf(id);
    if (i >= 0) prefs.ocultas.splice(i, 1); else prefs.ocultas.push(id);
    guardar();
    return i < 0;
  }

  function alternarOculta() {
    enfocado.classList.toggle('escondida', alternarOcultaId(enfocado.dato.id));
  }

  // ---------- Todas las apps ----------

  var COLUMNAS = 6, ALTO_FILA = 122 + 92;
  var rejilla = [], celda = 0;

  function abrirCajon() {
    panel = 'cajon';
    body.classList.add('con-panel');
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
    body.classList.remove('con-panel');
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
    // Los laterales hacen tope, como en tvOS: pasar de fila al llegar al borde desorienta
    else if (k === TECLAS.IZQ) { if (celda % COLUMNAS > 0) enfocarCelda(celda - 1); }
    else if (k === TECLAS.DER) { if (celda % COLUMNAS < COLUMNAS - 1) enfocarCelda(celda + 1); }
    else if (k === TECLAS.ARRIBA) { if (celda >= COLUMNAS) enfocarCelda(celda - COLUMNAS); }
    else if (k === TECLAS.ABAJO) {
      // Si la última fila es más corta y no hay app justo debajo, se va a la última
      if (celda + COLUMNAS < rejilla.length) enfocarCelda(celda + COLUMNAS);
      else if (Math.floor(celda / COLUMNAS) < Math.floor((rejilla.length - 1) / COLUMNAS)) enfocarCelda(rejilla.length - 1);
    }
    else if (k === TECLAS.OK && rejilla[celda]) abrir(rejilla[celda].dato);
    else if (k === TECLAS.AMARILLO && rejilla[celda]) {
      // Aquí están todas, también las ocultas: el amarillo las devuelve al dock (o las quita)
      var t = rejilla[celda];
      var oculta = alternarOcultaId(t.dato.id);
      t.classList.toggle('escondida', oculta);
      pintarApps();
      aviso(t.dato.title + (oculta ? ' oculta en el dock' : ' vuelve al dock'));
    }
  }

  // ---------- Tema y fondo ----------

  function dos(n) { return (n < 10 ? '0' : '') + n; }

  function horaLocal(d) {
    return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate()) + 'T' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }

  // Hora de la ciudad elegida, que puede no estar en la zona de la TV
  function horaCiudad() {
    if (!tiempo || typeof tiempo.desfase !== 'number') return horaLocal(new Date());
    var d = new Date(Date.now() + tiempo.desfase * 1000);
    return d.getUTCFullYear() + '-' + dos(d.getUTCMonth() + 1) + '-' + dos(d.getUTCDate()) + 'T' + dos(d.getUTCHours()) + ':' + dos(d.getUTCMinutes());
  }

  function esDeDia() {
    if (tiempo && tiempo.amanecer) {
      // Open-Meteo da amanecer y anochecer en hora de la ciudad, sin zona: se compara solo "HH:MM" como texto,
      // así sigue valiendo con los datos de ayer (sin red, o pasada la medianoche antes de refrescar)
      var local = horaCiudad().slice(11);
      return local >= tiempo.amanecer.slice(11) && local < tiempo.anochecer.slice(11);
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
    // Los fondos minimalistas tienen versión clara y oscura, y las fotos, de día y de noche
    if (Fondos.buscar(prefs.fondo).minimal || prefs.cielo) aplicarFondo(animar);
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
      cielo: prefs.cielo,
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

  // reloj() la llama cada minuto, pero la fecha cambia una vez al día y el tiempo cada 30 min:
  // solo se formatea y se toca el DOM si algo cambió
  var ultimaFecha = '';
  function pintarFecha() {
    pintarTarjeta();
    var d = new Date();
    // Una temperatura de hace horas no se enseña como si fuera la de ahora
    var actual = tiempo && !tiempo.vieja && prefs.tiempo === 'fecha';
    var clave = d.toDateString() + (actual ? ':' + tiempo.codigo + ':' + Math.round(tiempo.temp) + ':' + tiempo.ciudad : '');
    var siguiente = body.classList.contains('con-calendario') ? textoSiguienteEvento() : '';
    clave += ':' + siguiente;
    if (clave === ultimaFecha) return;
    ultimaFecha = clave;
    var texto = escapar(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
    if (actual) {
      texto += '<span class="clima">' + Tiempo.icono(tiempo.codigo) + Math.round(tiempo.temp) + '° ' + escapar(tiempo.ciudad) + '</span>';
    }
    // Con calendario, lo siguiente que tienes hoy al lado de la fecha (y la fecha se puede elegir)
    if (siguiente) texto += '<span class="agenda-hoy">' + escapar(siguiente) + '</span>';
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
    comprobarDespertador();
  }

  // ---------- Despertador ----------

  // TV Libre no puede encender la TV (apagada no se ejecuta): eso lo hace el temporizador de la TV
  // (ver docs/AJUSTES-TV.md). Lo que hace es, si se abre en las dos horas después de la hora elegida,
  // ponerse en modo marco con un resumen del día bajo el reloj. Una vez al día; cualquier botón lo quita
  function comprobarDespertador() {
    if (!prefs.despertar || document.hidden || panel || editando) return;
    var ahora = horaLocal(new Date());
    var hoy = ahora.slice(0, 10), hora = ahora.slice(11);
    if (prefs.buenosDias === hoy || hora < prefs.despertar) return;
    var limite = dos(Math.min(23, +prefs.despertar.slice(0, 2) + 2)) + prefs.despertar.slice(2);
    if (hora >= limite) return;
    prefs.buenosDias = hoy;
    guardar();
    pintarBuenosDias();
    entrarMarco();
    body.classList.add('buenos-dias');
    Fondos.colocarVidrio($('buenos-dias'));
  }

  function pintarBuenosDias() {
    var h = new Date().getHours();
    var saludo = h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
    var t = tiempo && !tiempo.vieja ? tiempo : null;
    var partes = [];
    if (t) {
      partes.push(grados(t.temp) + ' y ' + Tiempo.describir(t.codigo).toLowerCase() + ' en ' + escapar(t.ciudad));
      if (typeof t.max === 'number') partes.push('Máx ' + grados(t.max) + ' · Mín ' + grados(t.min));
      var lluvia = Tiempo.proximaLluvia((t.horas || []).filter(function (x) { return x.hora > horaCiudad(); }).slice(0, 12));
      if (lluvia) partes.push((lluvia.nieve ? 'Nieve' : 'Lluvia') + ' hacia las ' + (+lluvia.hora.slice(11, 13)) + ':00');
      else if (t.lluvia < 20) partes.push('Sin lluvia');
    }
    // Y lo que tienes hoy en el calendario (los 3 primeros)
    var hoy = eventosDeHoy();
    var agenda = hoy.slice(0, 3).map(function (e) {
      return '<li><b>' + (e.todoElDia ? 'Todo el día' : horaDe(e.inicio)) + '</b>' + escapar(e.titulo) + '</li>';
    }).join('') + (hoy.length > 3 ? '<li class="mas">y ' + (hoy.length - 3) + ' más</li>' : '');
    if (body.classList.contains('con-calendario') && !hoy.length) agenda = '<li class="mas">Hoy no tienes nada en el calendario</li>';
    $('buenos-dias-contenido').innerHTML =
      (t ? '<div class="bd-icono">' + Tiempo.icono(t.codigo, t.noche) + '</div>' : '') +
      '<div class="bd-texto"><b>' + saludo + '</b><span>' + partes.join('</span><span>') + '</span>' +
      (agenda ? '<ul class="bd-agenda">' + agenda + '</ul>' : '') + '</div>';
  }

  // Tarjeta del tiempo, arriba a la izquierda: solo se reescribe si cambió algo
  var ultimaTarjeta = '';
  function grados(n) { return Math.round(n) + '°'; }
  function pintarTarjeta() {
    var ver = !!(prefs.tiempo === 'tarjeta' && tiempo && !tiempo.vieja);
    body.classList.toggle('con-tiempo', ver);
    var el = $('tarjeta-tiempo');
    el.dato = { id: '__tiempo', title: 'Tiempo' };
    ponerFilaArriba();
    if (!ver) return;
    var t = tiempo;
    var proximas = (t.horas || []).filter(function (h) { return h.hora > horaCiudad(); }).slice(0, 6);
    // Si va a llover en las próximas 6 horas (y no está lloviendo ya), la tarjeta lo avisa
    var tipoAhora = Tiempo.proximaLluvia([{ codigo: t.codigo, lluvia: null }]);
    var lluvia = tipoAhora ? null : Tiempo.proximaLluvia(proximas);
    el.classList.toggle('avisa-lluvia', !!lluvia);
    var clave = [t.ciudad, t.codigo, t.noche, Math.round(t.temp), t.max, t.min, t.lluvia, proximas.length && proximas[0].hora, lluvia && lluvia.hora, prefs.h24].join(':');
    if (clave === ultimaTarjeta) return;
    ultimaTarjeta = clave;
    var detalle = [];
    if (typeof t.max === 'number') detalle.push('Máx ' + grados(t.max) + ' · Mín ' + grados(t.min));
    if (t.lluvia >= 20 && !lluvia) detalle.push('Lluvia ' + t.lluvia + '%');   // por debajo no aporta
    function etiquetaHora(hora) {
      var n = +hora.slice(11, 13);
      return prefs.h24 ? dos(n) + ':00' : ((n % 12) || 12) + (n < 12 ? ' a. m.' : ' p. m.');
    }
    var horas = proximas.map(function (h) {
      var gota = h.lluvia >= 30 ? '<i>' + h.lluvia + '%</i>' : '';
      return '<div class="hora"><span>' + etiquetaHora(h.hora) + '</span>' + Tiempo.icono(h.codigo, h.noche) + '<b>' + grados(h.temp) + '</b>' + gota + '</div>';
    }).join('');
    var avisoLluvia = lluvia ? '<span class="lluvia-pronto">' + (lluvia.nieve ? 'Nieve' : 'Lluvia') + ' hacia las ' + etiquetaHora(lluvia.hora) + '</span>' : '';
    $('tiempo-contenido').innerHTML =
      '<div class="tiempo-icono">' + Tiempo.icono(t.codigo, t.noche) + '</div>' +
      '<div class="tiempo-temp">' + grados(t.temp) + '</div>' +
      '<div class="tiempo-texto"><b>' + escapar(t.ciudad) + '</b>' +
      '<span>' + Tiempo.describir(t.codigo) + '</span>' + avisoLluvia + '<span>' + detalle.join(' · ') + '</span></div>' +
      (horas ? '<div class="horas">' + horas + '</div>' : '');
    Fondos.colocarVidrio(el);   // el ancho cambia con el nombre de la ciudad
  }

  // La fila de arriba, de izquierda a derecha: [tiempo, fecha (con calendario), ajustes], cada uno si está
  function ponerFilaArriba() {
    var el = $('tarjeta-tiempo'), fecha = $('fecha'), boton = $('boton-ajustes');
    fecha.dato = { id: '__calendario', title: 'Calendario' };
    var arriba = [];
    if (body.classList.contains('con-tiempo')) arriba.push(el);
    if (body.classList.contains('con-calendario') && prefs.fecha) arriba.push(fecha);
    arriba.push(boton);
    if (arriba.join() === filas[ARRIBA].join() && arriba.length === filas[ARRIBA].length) return;
    var habia = enfocado;
    filas[ARRIBA] = arriba;
    colPorFila[ARRIBA] = -1;
    if (fila === ARRIBA) enfocar(ARRIBA, Math.max(0, arriba.indexOf(habia)));
  }

  // ---------- Calendario ----------

  var eventos = [];
  var MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  var DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  function eventosDeHoy() {
    var ahora = Date.now(), d = new Date();
    var finDeHoy = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    // Los que quedan hoy: los de todo el día y los que aún no han terminado
    return eventos.filter(function (e) { return e.inicio < finDeHoy && e.fin > ahora; });
  }

  function horaDe(ms) {
    var d = new Date(ms), h = d.getHours();
    return prefs.h24 ? dos(h) + ':' + dos(d.getMinutes()) : ((h % 12) || 12) + ':' + dos(d.getMinutes()) + (h < 12 ? ' a. m.' : ' p. m.');
  }

  /** Lo siguiente que tienes hoy, para ponerlo junto a la fecha: "18:30 Fútbol" ('' si no queda nada). */
  function textoSiguienteEvento() {
    var hoy = eventosDeHoy(), ahora = Date.now();
    var e = hoy.filter(function (x) { return !x.todoElDia && x.inicio > ahora; })[0] || hoy[0];
    if (!e) return '';
    var cuando = e.todoElDia ? '' : e.inicio <= ahora ? 'Ahora: ' : horaDe(e.inicio) + ' ';
    return cuando + e.titulo;   // lo corta el CSS (.agenda-hoy): la fecha no puede llegar a la tarjeta del tiempo
  }

  var temporizadorCalendario;
  function actualizarCalendario() {
    clearTimeout(temporizadorCalendario);
    Calendario.obtener().then(function (lista) {
      eventos = lista;
      body.classList.add('con-calendario');
      ultimaFecha = '';
      pintarFecha();
      ponerFilaArriba();
      if (body.classList.contains('buenos-dias')) pintarBuenosDias();
      if (!document.hidden) temporizadorCalendario = setTimeout(actualizarCalendario, 30 * 60 * 1000);
    }).catch(function (e) {
      if (e && e.message === 'Sin calendario') return;   // no se configuró: ni botón ni reintentos
      console.warn('Calendario no disponible', e);
      if (!document.hidden) temporizadorCalendario = setTimeout(actualizarCalendario, 5 * 60 * 1000);
    });
  }

  var desplazamientoAgenda = 0;
  function abrirAgenda() {
    panel = 'agenda';
    body.classList.add('con-panel');
    var html = '', ahora = Date.now(), hoy = new Date();
    hoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    for (var i = 0; i < 7; i++) {
      var dia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + i);
      var fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + i + 1).getTime();
      var delDia = eventos.filter(function (e) { return e.inicio < fin && e.fin > dia.getTime() && e.fin > ahora; });
      var nombre = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : DIAS_LARGOS[dia.getDay()];
      html += '<div class="agenda-dia"><h3>' + nombre + ' <span>' + dia.getDate() + ' ' + MESES_CORTOS[dia.getMonth()].toLowerCase() + '</span></h3>';
      html += delDia.length ? delDia.map(function (e) {
        var cuando = e.todoElDia || e.inicio < dia.getTime() ? 'Todo el día' : horaDe(e.inicio);
        return '<div class="agenda-evento"><b>' + cuando + '</b><span>' + escapar(e.titulo) +
          (e.lugar ? '<i>' + escapar(e.lugar) + '</i>' : '') + '</span></div>';
      }).join('') : '<div class="agenda-vacio">Nada</div>';
      html += '</div>';
    }
    $('agenda-lista').innerHTML = html;
    desplazamientoAgenda = 0;
    $('agenda-lista').style.transform = 'none';
    var a = $('agenda');
    a.classList.add('abierto');
    Fondos.colocarVidrio(a);
  }

  function cerrarAgenda() {
    panel = null;
    body.classList.remove('con-panel');
    $('agenda').classList.remove('abierto');
  }

  function teclaAgenda(k) {
    if (k === TECLAS.ATRAS || k === TECLAS.OK) { cerrarAgenda(); return; }
    if (k !== TECLAS.ARRIBA && k !== TECLAS.ABAJO) return;
    var lista = $('agenda-lista'), alto = lista.parentNode.offsetHeight;
    var max = Math.max(0, lista.offsetHeight - alto);
    desplazamientoAgenda = Math.max(0, Math.min(max, desplazamientoAgenda + (k === TECLAS.ABAJO ? 160 : -160)));
    lista.style.transform = 'translate3d(0,' + (-desplazamientoAgenda) + 'px,0)';
  }

  function escapar(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ---------- Tiempo ----------

  // Sin red se reintenta pronto (1, 2, 4… hasta 30 min): al encender la TV la app suele abrirse antes que el wifi
  var temporizadorTiempo, reintentoTiempo = 0;
  function actualizarTiempo() {
    clearTimeout(temporizadorTiempo);
    Tiempo.obtener(prefs.lugar).then(function (t) {
      tiempo = t;
      reintentoTiempo = t.vieja ? Math.min(30, reintentoTiempo ? reintentoTiempo * 2 : 1) : 0;
      pintarFecha();
      aplicarTema(true);
      if (body.classList.contains('buenos-dias')) { pintarBuenosDias(); Fondos.colocarVidrio($('buenos-dias')); }
    }).catch(function (e) {
      reintentoTiempo = Math.min(30, reintentoTiempo ? reintentoTiempo * 2 : 1);
      console.warn('Tiempo no disponible', e);
    }).then(function () {
      clearTimeout(temporizadorTiempo);
      if (!document.hidden) temporizadorTiempo = setTimeout(actualizarTiempo, (reintentoTiempo || 30) * 60 * 1000);
    });
  }
  window.addEventListener('online', actualizarTiempo);

  function deNoche() {
    var h = new Date().getHours();
    return h >= 22 || h < 7;
  }

  function aplicarAtenuado() {
    var nivel = prefs.atenuar;
    if (nivel === 'auto') nivel = deNoche() ? 0.45 : 0;
    if (nivel === 'tv') nivel = luzDeLaTV();
    $('atenuador').style.opacity = nivel;
  }

  // "De noche, en toda la TV": se baja la retroiluminación de la propia TV, así que el atenuado sigue en
  // Netflix, YouTube o un HDMI. TV Libre solo lo comprueba cuando está delante (al volver a ella y cada
  // minuto mientras se ve): si la TV se queda toda la noche en otra app, la luz vuelve al volver a TV Libre.
  // Devuelve cuánto debe atenuar TV Libre su propia pantalla: nada si la TV se deja, como 'auto' si no
  var luzSinPermiso = false, cambiandoLuz = false;
  function luzDeLaTV() {
    if (luzSinPermiso) return deNoche() ? 0.45 : 0;
    if (cambiandoLuz) return 0;
    var bajar = deNoche() && prefs.atenuar === 'tv';
    if (bajar === (prefs.luzDia !== null)) return 0;   // ya está como toca
    cambiandoLuz = true;
    var hecho = bajar
      ? Luna.luz().then(function (v) {
          var baja = Math.max(5, Math.round(v * 0.4));
          return Luna.ponerLuz(typeof v === 'string' ? String(baja) : baja).then(function () { prefs.luzDia = v; });
        })
      : Luna.ponerLuz(prefs.luzDia).then(function () { prefs.luzDia = null; });
    hecho.then(guardar, function () {
      luzSinPermiso = true;
      if (bajar) aviso('La TV no deja cambiar su brillo: TV Libre atenúa solo su pantalla');
      aplicarAtenuado();
    }).then(function () { cambiandoLuz = false; });
    return 0;
  }

  // ---------- Ajustes ----------

  var ajusteFoco = 0;
  var resultados = null;     // sitios encontrados al buscar la ubicación
  var OPCIONES_TEMA = [['auto', 'Automático'], ['claro', 'Claro'], ['oscuro', 'Oscuro']];
  var OPCIONES_ATENUAR = [[0, 'No'], ['auto', 'De noche'], ['tv', 'De noche, en toda la TV'], [0.25, 'Bajo'], [0.45, 'Medio'], [0.65, 'Alto']];
  var OPCIONES_VIDRIO = [['liquido', 'Líquido'], ['sencillo', 'Sencillo (más rápido)']];
  var OPCIONES_ROTAR = [[0, 'Nunca'], [1, 'Cada minuto'], [5, 'Cada 5 min'], [15, 'Cada 15 min'], [60, 'Cada hora']];
  var OPCIONES_ROTAR_EN = [['todas', 'Todas las fotos'], ['grupo', 'Solo este grupo']];
  var OPCIONES_RELOJ = [['vidrio', 'Vidrio'], ['fino', 'Fino'], ['oculto', 'Oculto']];
  var OPCIONES_AYUDA = [['siempre', 'Siempre'], ['inicio', 'Unos segundos'], ['nunca', 'Nunca']];
  var OPCIONES_DESPERTAR = [['', 'No'], ['06:30', '6:30'], ['07:00', '7:00'], ['07:30', '7:30'], ['08:00', '8:00'], ['08:30', '8:30'], ['09:00', '9:00'], ['10:00', '10:00']];
  var OPCIONES_REPOSO = [[0, 'Nunca'], [2, 'A los 2 min'], [5, 'A los 5 min'], [10, 'A los 10 min'], [30, 'A los 30 min']];
  var OPCIONES_TIEMPO = [['tarjeta', 'Arriba a la izquierda'], ['fecha', 'Junto a la fecha'], ['oculto', 'Oculto']];

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
      { nombre: 'Cambiar de fondo', repintar: true, valor: function () { return etiqueta(OPCIONES_ROTAR, prefs.rotar); },
        cambiar: function (p) { prefs.rotar = rotar(OPCIONES_ROTAR, prefs.rotar, p); programarRotacion(); } },
      // Las filas que no tienen efecto con la opción de arriba se ocultan (ver filter al final)
      { nombre: 'Rotar entre', si: function () { return prefs.rotar > 0; }, valor: function () { return etiqueta(OPCIONES_ROTAR_EN, prefs.rotarEn); },
        cambiar: function (p) { prefs.rotarEn = rotar(OPCIONES_ROTAR_EN, prefs.rotarEn, p); } },
      { grupo: 'Pantalla de inicio' },
      { nombre: 'Reloj', repintar: true, valor: function () { return etiqueta(OPCIONES_RELOJ, prefs.reloj); },
        cambiar: function (p) { prefs.reloj = rotar(OPCIONES_RELOJ, prefs.reloj, p); aplicarVidrio(); aplicarFondo(false); pintarRelleno(); } },
      { nombre: 'Profundidad', si: function () { return prefs.reloj !== 'oculto'; }, valor: function () { return prefs.profundidad ? 'Sí' : 'No'; },
        cambiar: function () { prefs.profundidad = !prefs.profundidad; aplicarVidrio(); aplicarFondo(false); } },
      { nombre: 'Cielo de día y de noche', valor: function () { return prefs.cielo ? 'Según el tema' : 'No'; },
        cambiar: function () { prefs.cielo = !prefs.cielo; aplicarFondo(true); } },
      { nombre: 'Fecha', valor: function () { return prefs.fecha ? 'Sí' : 'No'; },
        cambiar: function () { prefs.fecha = !prefs.fecha; aplicarVidrio(); ponerFilaArriba(); } },
      { nombre: 'Tiempo', valor: function () { return etiqueta(OPCIONES_TIEMPO, prefs.tiempo); },
        cambiar: function (p) { prefs.tiempo = rotar(OPCIONES_TIEMPO, prefs.tiempo, p); ultimaFecha = ''; pintarFecha(); } },
      { nombre: 'Vidrio', valor: function () { return etiqueta(OPCIONES_VIDRIO, prefs.vidrio); },
        cambiar: function (p) { prefs.vidrio = rotar(OPCIONES_VIDRIO, prefs.vidrio, p); aplicarVidrio(); } },
      { nombre: 'Animaciones', valor: function () { return prefs.animaciones ? 'Completas' : 'Reducidas'; },
        cambiar: function () { prefs.animaciones = !prefs.animaciones; aplicarVidrio(); } },
      { nombre: 'Ayuda de los botones', valor: function () { return etiqueta(OPCIONES_AYUDA, prefs.ayuda); },
        cambiar: function (p) { prefs.ayuda = rotar(OPCIONES_AYUDA, prefs.ayuda, p); mostrarPie(); } },
      { nombre: 'Salvapantallas', valor: function () { return etiqueta(OPCIONES_REPOSO, prefs.reposo); },
        cambiar: function (p) { prefs.reposo = rotar(OPCIONES_REPOSO, prefs.reposo, p); programarReposo(); } },
      { nombre: 'Despertador', valor: function () { return etiqueta(OPCIONES_DESPERTAR, prefs.despertar); },
        cambiar: function (p) { prefs.despertar = rotar(OPCIONES_DESPERTAR, prefs.despertar, p); prefs.buenosDias = ''; } },
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
      { nombre: 'Developer Mode', accion: true,
        valor: function () { var d = diasDevMode(); return '<small>renovado hace ' + d + (d === 1 ? ' día' : ' días') + '</small>Renovar'; },
        cambiar: function () {
          // Se da por renovado al abrirlo: ahí se pulsa EXTEND
          prefs.devmode = Date.now(); guardar(); cerrarAjustes();
          abrir({ id: DEV_MODE, title: 'Developer Mode' });
        } },
      { nombre: 'Restablecer el dock', accion: true, valor: function () { return 'OK'; },
        cambiar: function () {
          prefs.orden = []; prefs.ocultas = null; prefs.favoritas = null; guardar();
          cargarApps().then(function () { pintarApps(); enfocar(fila, col); });
          aviso('Dock restablecido');
        } }
    );
    return lista.filter(function (a) { return !a.si || a.si(); });
  }
  var AJUSTES = [], ELEGIBLES = [];

  // Tras cambiar un ajuste: si muestra u oculta otras filas se repinta la lista; si no, solo esa fila
  function trasCambiar(a) {
    guardar();
    if (a.repintar) pintarAjustes();
    else if (AJUSTES.indexOf(a) >= 0 && a.el.parentNode) refrescarAjuste(a);
  }

  function abrirAjustes() {
    panel = 'ajustes';
    body.classList.add('con-panel', 'panel-ajustes');
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
    body.classList.remove('con-panel', 'panel-ajustes');
    $('ajustes').classList.remove('abierto');
    mostrarPie();
  }

  function buscarLugar(input) {
    input.blur();
    var texto = input.value.trim();
    if (!texto || texto === prefs.lugar.nombre) { input.value = prefs.lugar.nombre; return; }
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
    // Al quitar los resultados, el foco volvería a caer más abajo (hasta en "Restablecer el dock"): vuelve a Ubicación
    for (var i = 0; i < ELEGIBLES.length; i++) if (AJUSTES[ELEGIBLES[i]].tipo === 'texto') enfocarAjuste(i);
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
      if (a.cambiar) { a.cambiar(1); trasCambiar(a); }
    } else if ((k === TECLAS.IZQ || k === TECLAS.DER) && a.cambiar && !a.resultado) {
      a.cambiar(k === TECLAS.IZQ ? -1 : 1); trasCambiar(a);
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
    var pie = $('pie');
    clearTimeout(temporizadorPie);
    pie.classList.toggle('apagado', prefs.ayuda === 'nunca');
    if (prefs.ayuda === 'inicio') temporizadorPie = setTimeout(function () { pie.classList.add('apagado'); }, 7000);
  }

  // Modo marco: Atrás en la pantalla principal deja solo la foto y el reloj, como un cuadro.
  // No cuesta nada: solo se apaga la opacidad de la interfaz, y la rotación de fondos sigue
  var marco = false;
  function entrarMarco() {
    if (pagina === 2) enfocarInicio();   // el marco es el reloj y la foto: se vuelve a la primera pantalla
    marco = true;
    body.classList.add('marco');
    $('pie').classList.add('apagado');
  }
  function salirMarco() {
    if (!marco) return;
    marco = false;
    body.classList.remove('buenos-dias');
    body.classList.remove('marco');
    mostrarPie();
  }

  // Salvapantallas: tras unos minutos sin tocar el mando, el modo marco entra solo.
  // Un único temporizador que se rearma con cada tecla; con la app oculta no hay ninguno
  var temporizadorReposo;
  function programarReposo() {
    clearTimeout(temporizadorReposo);
    if (!prefs.reposo || document.hidden) return;
    temporizadorReposo = setTimeout(function () {
      if (panel || editando) { programarReposo(); return; }   // no se esconde lo que estás usando
      entrarMarco();
    }, prefs.reposo * 60 * 1000);
  }

  // Developer Mode caduca a las 1000 h (~41 días) y con él se borra TV Libre. No hay forma de leer
  // la fecha real, así que se cuenta desde la instalación o desde la última vez que se abrió desde Ajustes
  var DEV_MODE = 'com.palmdts.devmode';
  function diasDevMode() { return Math.floor((Date.now() - prefs.devmode) / 86400000); }
  function avisarDevMode() {
    if (diasDevMode() >= 30) aviso('Renueva Developer Mode: Ajustes → Developer Mode');
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
  function abrirPuesto(i) {
    var t = filas[FAV][i];
    if (!t) return;
    enfocar(FAV, i);
    abrir(t.dato);
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
    programarReposo();
    if (!k) return;
    if (e.repeat && k >= 37 && k <= 40) {
      var ahora = Date.now();
      if (ahora - ultimaRepeticion < 110) { e.preventDefault(); return; }
      ultimaRepeticion = ahora;
    }
    // OK repetido se ignora: si se abrió Ajustes manteniendo OK, cambiaría el primer ajuste en bucle
    if (panel === 'ajustes') { if ((e.repeat && k === TECLAS.OK) || teclaAjustes(k)) e.preventDefault(); return; }
    if (panel === 'cajon') { if (!e.repeat || k !== TECLAS.OK) teclaCajon(k); e.preventDefault(); return; }
    if (panel === 'agenda') { if (!e.repeat) teclaAgenda(k); e.preventDefault(); return; }
    if (marco) {
      // Rojo y verde siguen cambiando el fondo y el tema sin salir; cualquier otra tecla devuelve el dock
      if (k === TECLAS.ROJO) siguienteFondo();
      else if (k === TECLAS.VERDE) alternarTema();
      else if (!e.repeat) salirMarco();
      e.preventDefault();
      return;
    }
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
      case TECLAS.AMARILLO: if (editando) terminarEdicion(); else empezarEdicion(true); break;
      case TECLAS.AZUL: if (!editando) abrirAjustes(); break;
      case TECLAS.ATRAS: if (editando) terminarEdicion(); else entrarMarco(); break;
      default:
        // 1-9 abre la app que ocupa ese puesto en el dock (mantenerlos sigue siendo el Acceso rápido de LG)
        if (k >= 49 && k <= 57 && !editando) { abrirPuesto(k - 49); break; }
        return;
    }
    e.preventDefault();
  });

  // Se suelta aunque haya un panel abierto: mantener OK en "Todas las apps" o en Ajustes abre el panel
  // con el botón aún pulsado, y si no se reinicia aquí la siguiente pulsación de OK se pierde
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== TECLAS.OK || !okAbajo) return;
    e.preventDefault();
    var mantenido = okMantenido;
    okReiniciar();
    if (!mantenido && !panel) pulsarOk();
  });
  window.addEventListener('blur', okReiniciar);

  // ---------- Órdenes desde el móvil ----------
  // La app del móvil abre TV Libre con parámetros (ssap://system.launcher/launch con params):
  // {fondo: id} cambia el fondo, {tema: 'claro'|'oscuro'|'auto'}, {siguiente: true} pasa al siguiente,
  // {movil: url} dice adónde mandar cómo están las apps y {soloMovil: true} pide solo eso;
  // {mantenerOk: true} hace lo de mantener OK sobre la app que tiene el foco.
  function parametros() {
    var sistema = window.webOSSystem || window.PalmSystem;
    var p = sistema && sistema.launchParams;
    try { p = typeof p === 'string' ? JSON.parse(p || '{}') : p || {}; } catch (e) { p = {}; }
    return p;
  }

  function atenderParametros(p) {
    if (typeof p.movil === 'string' && MOVIL_VALIDO.test(p.movil)) {
      movil = p.movil;
      try { localStorage.setItem('movil', movil); } catch (e) {}
      avisarMovil(true);
    }
    if (p.fondo && Fondos.buscar(p.fondo).id === p.fondo) {
      prefs.fondo = p.fondo; guardar(); aplicarFondo(); programarRotacion();
      aviso(Fondos.buscar(p.fondo).nombre, 'imagen');
    } else if (p.siguiente) {
      siguienteFondo();
    }
    if (p.tema === 'claro' || p.tema === 'oscuro' || p.tema === 'auto') {
      prefs.tema = p.tema; guardar(); aplicarTema(true);
    }
  }

  // Al volver a la app (desde el móvil, o tras instalar otra), atiende los parámetros y recarga la lista.
  // Sin parámetros es el botón Home del móvil: se vuelve a la pantalla de inicio limpia, como en Apple TV
  document.addEventListener('webOSRelaunch', function (e) {
    // Algunos firmware mandan detail vacío y dejan los parámetros en launchParams
    var d = e && e.detail;
    var p = d && typeof d === 'object' && Object.keys(d).length ? d : parametros();
    atenderParametros(p);
    // Mantener pulsado el trackpad del móvil = mantener OK (el socket de botones solo sabe pulsar y soltar)
    if (p.mantenerOk) { if (!panel) mantenerOk(); return; }
    if (p.soloMovil) return;   // el móvil solo pregunta por las apps: la pantalla se queda como está
    var home = !p.fondo && !p.siguiente && !p.tema;
    if (panel === 'cajon') cerrarCajon();
    if (panel === 'agenda') cerrarAgenda();
    if (home && panel === 'ajustes') cerrarAjustes();
    else if (panel === 'ajustes') refrescarTodos();
    if (home && editando) terminarEdicion();
    if (home) salirMarco();
    okReiniciar();
    // Con handlesRelaunch la app relanzada no siempre pasa sola al frente
    var sistema = window.webOSSystem || window.PalmSystem;
    if (sistema && sistema.activate) { try { sistema.activate(); } catch (err) {} }
    cargarApps().then(function () { pintarApps(); enfocar(fila, col); enfocarUltima(); });
  });

  // Oculta = sin temporizadores. Visible otra vez = se ponen al día
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearTimeout(temporizadorReloj);
      clearTimeout(temporizadorTiempo);
      clearTimeout(temporizadorRotacion);
      clearTimeout(temporizadorReposo);
      okReiniciar();
      // Con otra app delante, la foto no se ve: se suelta su memoria para que esa app arranque antes
      Fondos.soltar();
      pintarRelleno();
    } else {
      aplicarFondo(false);   // vuelve la foto (sin transición: viene de soltarla)
      reloj();
      actualizarTiempo();
      programarRotacion();
      programarReposo();
      actualizarCalendario();
      Desarrollo.renovar().catch(function () {});   // que el modo desarrollador no caduque
      actualizarEntradas();   // se enchufan y desenchufan cosas mientras ves otra app
      enfocarUltima();
      if (!marco) mostrarPie();
      avisarDevMode();
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
  pintarEntradas(ENTRADAS);
  prepararBotonAjustes();
  colocarVidrios();
  var guardadas = appsGuardadas();
  if (guardadas) ordenarApps(guardadas);
  pintarApps();
  enfocarInicio();
  enfocarUltima();
  // Doble rAF: el estado inicial ya está pintado cuando se quita la clase, así hay transición de entrada.
  // No espera a la lista de apps: el reloj y las entradas salen al momento
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    body.classList.remove('entrada');
    alinearRelleno();
  }); });
  cargarApps().catch(function (e) { console.warn('Sin lista de apps', e); }).then(function () {
    if (panel === 'cajon' || editando) return;   // no se cambia la fila mientras se usa; el relanzamiento la pone al día
    // Se mantiene la app enfocada; "Todas las apps" no cuenta (sin lista guardada es lo único que había al arrancar)
    var id = enfocado && fila <= RESTO && enfocado.dato.id !== TODAS ? enfocado.dato.id : null;
    var f = fila;
    pintarApps();
    if (f > RESTO) enfocar(f, col);
    else if (!id || !enfocarApp(id)) enfocarInicio();
    if (!id) enfocarUltima();
  });
  if (!prefs.devmode) { prefs.devmode = Date.now(); guardar(); }
  setTimeout(avisarDevMode, 3000);
  actualizarTiempo();
  actualizarCalendario();
  Desarrollo.renovar().catch(function () {});   // que el modo desarrollador no caduque
  programarRotacion();
  programarReposo();
  actualizarEntradas();
  mostrarPie();
  atenderParametros(parametros());
  // Las fuentes pueden llegar después del primer pintado y cambiar el ancho del reloj
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(alinearRelleno);
})();
