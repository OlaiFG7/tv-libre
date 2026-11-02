/*
 * Fondos de pantalla: minimalistas (degradados CSS, cero bytes) y paisajes (fotos de Unsplash, licencia libre).
 * Las fotos van dentro del .ipk en app/fondos/ (las descarga tools/fondos.py); si faltan, se piden a Unsplash.
 *
 * Por cada foto hay hasta tres archivos:
 *   <id>.jpg          la foto, 1920 x 1080
 *   <id>-vidrio.jpg   480 x 270, ya difuminada (tools/fondos.py): la usan los paneles de vidrio,
 *                     el relleno del reloj y la transición. La TV no calcula ningún difuminado.
 *   <id>-frente.webp  el primer plano con el cielo transparente (tools/profundidad.py), dibujado
 *                     encima del reloj para que las cumbres o los edificios lo tapen
 *
 * Capas, de abajo arriba: #foto, #borroso-a/#borroso-b (las copias difuminadas), velo, reloj, #frente, interfaz.
 * Solo hay UNA capa de foto: la nueva se pone mientras la tapa la copia difuminada, así que nunca hay dos
 * fotos de 1920 x 1080 en memoria. Todo lo que se anima es opacity o transform (solo compositor).
 */
var Fondos = (function () {
  var LISTA = [
    { id: 'grafito', nombre: 'Grafito', grupo: 'Minimalista', minimal: {
      oscuro: 'radial-gradient(ellipse at 25% 15%, #3b3f4a 0%, rgba(59,63,74,0) 60%), linear-gradient(160deg, #1c1e24 0%, #0c0d10 100%)',
      claro: 'radial-gradient(ellipse at 25% 15%, #ffffff 0%, rgba(255,255,255,0) 60%), linear-gradient(160deg, #eceef2 0%, #d6d9e0 100%)' } },
    { id: 'aurora', nombre: 'Aurora', grupo: 'Minimalista', minimal: {
      oscuro: 'radial-gradient(circle at 15% 20%, #4a2fb0 0%, rgba(74,47,176,0) 45%), radial-gradient(circle at 85% 25%, #0e7aa0 0%, rgba(14,122,160,0) 50%), radial-gradient(circle at 55% 105%, #9c2f7a 0%, rgba(156,47,122,0) 55%), linear-gradient(#0a0b18, #0a0b18)',
      claro: 'radial-gradient(circle at 15% 20%, #c9bdfc 0%, rgba(201,189,252,0) 45%), radial-gradient(circle at 85% 25%, #a8e3f5 0%, rgba(168,227,245,0) 50%), radial-gradient(circle at 55% 105%, #f7c3e3 0%, rgba(247,195,227,0) 55%), linear-gradient(#f4f3fb, #f4f3fb)' } },
    { id: 'oceano', nombre: 'Océano', grupo: 'Minimalista', minimal: {
      oscuro: 'radial-gradient(ellipse at 70% 0%, #1b5d8c 0%, rgba(27,93,140,0) 60%), linear-gradient(180deg, #0b2238 0%, #050d18 100%)',
      claro: 'radial-gradient(ellipse at 70% 0%, #bfe4ff 0%, rgba(191,228,255,0) 60%), linear-gradient(180deg, #e3f1fb 0%, #c7dcee 100%)' } },
    { id: 'atardecer', nombre: 'Atardecer', grupo: 'Minimalista', minimal: {
      oscuro: 'radial-gradient(ellipse at 50% 110%, #c2563a 0%, rgba(194,86,58,0) 55%), radial-gradient(ellipse at 10% 0%, #4a2a5e 0%, rgba(74,42,94,0) 55%), linear-gradient(#160f1c, #160f1c)',
      claro: 'radial-gradient(ellipse at 50% 110%, #ffc6a5 0%, rgba(255,198,165,0) 55%), radial-gradient(ellipse at 10% 0%, #e9d3f2 0%, rgba(233,211,242,0) 55%), linear-gradient(#fbf3ee, #fbf3ee)' } },
    { id: 'salvia', nombre: 'Salvia', grupo: 'Minimalista', minimal: {
      oscuro: 'radial-gradient(ellipse at 80% 20%, #2f5a48 0%, rgba(47,90,72,0) 55%), linear-gradient(200deg, #14201b 0%, #090d0b 100%)',
      claro: 'radial-gradient(ellipse at 80% 20%, #d3eadb 0%, rgba(211,234,219,0) 55%), linear-gradient(200deg, #eef3ef 0%, #d9e3dc 100%)' } },

    { id: 'montanas-amanecer', nombre: 'Amanecer sobre las nubes', grupo: 'Montañas', foto: '1506905925346-21bda4d32df4', profundidad: true, relojY: 30 },
    { id: 'montanas-estrellas', nombre: 'Noche estrellada', grupo: 'Montañas', foto: '1519681393784-d120267933ba' },
    { id: 'montanas-valle', nombre: 'Valle alpino', grupo: 'Montañas', foto: '1464822759023-fed622ff2c3b' },
    { id: 'montanas-cumbre', nombre: 'Cumbre nevada', grupo: 'Montañas', foto: '1483728642387-6c3bdd6c93e5', profundidad: true, relojY: 100 },
    { id: 'montanas-himalaya', nombre: 'Himalaya', grupo: 'Montañas', foto: '1454496522488-7a8e488e8606' },
    { id: 'montanas-sierra', nombre: 'Sierra y pradera', grupo: 'Montañas', foto: '1486870591958-9b9d0d1dda99', profundidad: true },
    { id: 'lago-muelle', nombre: 'Muelle en el lago', grupo: 'Lagos', foto: '1439066615861-d1af74d74000' },
    { id: 'montanas-rojas', nombre: 'Picos rojos', grupo: 'Montañas', foto: '1477346611705-65d1883cee1e', profundidad: true },
    { id: 'playa-atardecer', nombre: 'Playa al atardecer', grupo: 'Playas', foto: '1507525428034-b723cf961d3e' },
    { id: 'playa-tropical', nombre: 'Playa tropical', grupo: 'Playas', foto: '1519046904884-53103b34b206' },
    { id: 'playa-aerea', nombre: 'Costa desde el aire', grupo: 'Playas', foto: '1505228395891-9a51e7e86bf6' },
    { id: 'playa-amanecer', nombre: 'Amanecer en la orilla', grupo: 'Playas', foto: '1473116763249-2faaef81ccda' },
    { id: 'playa-costa', nombre: 'Costa al anochecer', grupo: 'Playas', foto: '1475924156734-496f6cac6ec1' },
    { id: 'ciudad-nueva-york', nombre: 'Nueva York', grupo: 'Ciudades', foto: '1514565131-fce0801e5785', profundidad: true },
    { id: 'ciudad-tokio', nombre: 'Tokio de noche', grupo: 'Ciudades', foto: '1540959733332-eab4deabeeaf' },
    { id: 'ciudad-paris', nombre: 'París', grupo: 'Ciudades', foto: '1502602898657-3e91760cbb34' },
    { id: 'ciudad-san-francisco', nombre: 'San Francisco', grupo: 'Ciudades', foto: '1501594907352-04cda38ebc29' },
    { id: 'ciudad-chicago', nombre: 'Chicago', grupo: 'Ciudades', foto: '1477959858617-67f85cf4f1df' },
    { id: 'ciudad-dubai', nombre: 'Dubái', grupo: 'Ciudades', foto: '1512453979798-5ea266f8880c', profundidad: true },
    { id: 'ciudad-hong-kong', nombre: 'Hong Kong', grupo: 'Ciudades', foto: '1536599018102-9f803c140fc1' },
    { id: 'ciudad-londres', nombre: 'Londres', grupo: 'Ciudades', foto: '1513635269975-59663e0ac1ad' },
    { id: 'ciudad-manhattan', nombre: 'Manhattan', grupo: 'Ciudades', foto: '1534430480872-3498386e7856', profundidad: true },
    { id: 'lago-braies', nombre: 'Lago de Braies', grupo: 'Lagos', foto: '1470770841072-f978cf4d019e' },
    { id: 'lago-turquesa', nombre: 'Lago turquesa', grupo: 'Lagos', foto: '1501785888041-af3ef285b470' },
    { id: 'lago-wanaka', nombre: 'Árbol en el lago', grupo: 'Lagos', foto: '1494500764479-0c8f2919a3d8' },
    { id: 'naturaleza-colinas', nombre: 'Colinas en capas', grupo: 'Naturaleza', foto: '1500534314209-a25ddb2bd429' },
    { id: 'naturaleza-bosque', nombre: 'Bosque', grupo: 'Naturaleza', foto: '1441974231531-c6227db76b6e' },
    { id: 'naturaleza-desierto', nombre: 'Desierto', grupo: 'Naturaleza', foto: '1509316785289-025f5b846b35', profundidad: true, relojY: 50 },
    { id: 'naturaleza-aurora', nombre: 'Aurora boreal', grupo: 'Naturaleza', foto: '1531366936337-7c912a4589a7' },
    { id: 'naturaleza-niebla', nombre: 'Colinas con niebla', grupo: 'Naturaleza', foto: '1470071459604-3b5ec3a7fe05' },
    { id: 'naturaleza-valle', nombre: 'Valle verde', grupo: 'Naturaleza', foto: '1472214103451-9374bd1c798e' },
    { id: 'naturaleza-yosemite', nombre: 'Yosemite', grupo: 'Naturaleza', foto: '1506744038136-46273834b3fb', profundidad: true },
    { id: 'montanas-reflejo', nombre: 'Reflejo al amanecer', grupo: 'Montañas', foto: '1464278533981-50106e6176b1', profundidad: true, relojY: 40 }
  ];

  function remota(f, vidrio) {
    // Si faltan los archivos locales, Unsplash (imgix) también sabe difuminar
    return 'https://images.unsplash.com/photo-' + f.foto + (vidrio
      ? '?w=480&h=270&fit=crop&crop=entropy&blur=60&sat=80&q=80&fm=jpg'
      : '?w=1920&h=1080&fit=crop&crop=entropy&q=75&fm=jpg');
  }

  function buscar(id) {
    for (var i = 0; i < LISTA.length; i++) if (LISTA[i].id === id) return LISTA[i];
    return LISTA[0];
  }

  function siguiente(id, paso) {
    var i = LISTA.indexOf(buscar(id));
    return LISTA[(i + paso + LISTA.length) % LISTA.length];
  }

  /** El siguiente para la rotación automática: del mismo grupo, o la siguiente foto de todas. */
  function siguienteRotacion(id, soloGrupo) {
    var actual = buscar(id);
    var lista = LISTA.filter(function (f) { return soloGrupo ? f.grupo === actual.grupo : !f.minimal; });
    var i = lista.indexOf(actual);
    return lista[(i + 1) % lista.length];
  }

  // Carga y decodifica antes de mostrar (img.decode), para que la transición no dé tirones
  var resueltas = {};
  function cargar(src) {
    return new Promise(function (ok, mal) {
      var img = new Image();
      img.onload = function () {
        if (img.decode) img.decode().then(function () { ok(src); }, function () { ok(src); });
        else ok(src);
      };
      img.onerror = mal;
      img.src = src;
    });
  }

  function url(f, tipo) {
    var clave = f.id + ':' + tipo;
    if (clave in resueltas) return Promise.resolve(resueltas[clave]);
    var local = 'fondos/' + f.id + (tipo === 'foto' ? '.jpg' : tipo === 'vidrio' ? '-vidrio.jpg' : '-frente.webp');
    var intento = cargar(local);
    // El recorte solo existe en local; sin él, simplemente no hay profundidad
    intento = tipo === 'frente' ? intento.catch(function () { return ''; })
      : intento.catch(function () { return cargar(remota(f, tipo === 'vidrio')); });
    return intento.then(function (src) { resueltas[clave] = src; return src; });
  }

  /** {fondo, vidrio, frente}: valores CSS de background-image ('' si no hay recorte). */
  function css(f, tema, conFrente) {
    if (f.minimal) return Promise.resolve({ fondo: f.minimal[tema], vidrio: f.minimal[tema], frente: '' });
    return Promise.all([
      url(f, 'foto'), url(f, 'vidrio'),
      conFrente && f.profundidad ? url(f, 'frente') : Promise.resolve('')
    ]).then(function (r) {
      return { fondo: 'url("' + r[0] + '")', vidrio: 'url("' + r[1] + '")', frente: r[2] ? 'url("' + r[2] + '")' : '' };
    });
  }

  // ---------- Transición difuminada ----------

  var foto, borrosos, frente, actual = '', vidrioActual = '';
  var oyentes = { vidrio: null, mitad: null };
  var ocupado = false, pendiente = null;   // ocupado desde que se pide la foto hasta que acaba la transición

  function iniciar() {
    foto = document.getElementById('foto');
    borrosos = [document.getElementById('borroso-a'), document.getElementById('borroso-b')];
    frente = document.getElementById('frente');
  }

  function despues(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  function ponerVidrio(valor) {
    vidrioActual = valor;
    var vidrios = document.querySelectorAll('.vidrio-fondo');
    for (var i = 0; i < vidrios.length; i++) vidrios[i].style.backgroundImage = valor;
    if (oyentes.vidrio) oyentes.vidrio(valor);
  }

  /**
   * Cambia al fondo f. opciones: {tema, frente (bool), animar (bool)}.
   * Si llega otro cambio mientras se anima, se encola solo el último.
   */
  function aplicar(f, opciones) {
    var pedido = f.id + ':' + opciones.tema + ':' + opciones.frente;
    // El cerrojo se pone ANTES de cargar la foto: si llegan dos pulsaciones mientras se decodifica,
    // la segunda espera su turno en vez de lanzar otra transición encima
    if (ocupado) { pendiente = [f, opciones]; return Promise.resolve(); }
    if (pedido === actual) return Promise.resolve();
    ocupado = true;
    actual = pedido;
    var body = document.body;
    return css(f, opciones.tema, opciones.frente).then(function (v) {
      if (!vidrioActual || !opciones.animar) {
        // Primer fondo, o animaciones reducidas: cambio directo
        foto.style.backgroundImage = v.fondo;
        frente.style.backgroundImage = v.frente || 'none';
        frente.style.opacity = v.frente ? 1 : 0;
        foto.style.opacity = 1;
        body.classList.toggle('foto', !f.minimal);
        ponerVidrio(v.vidrio);
        if (oyentes.mitad) oyentes.mitad(f);
        siguientePendiente();
        return;
      }
      var a = borrosos[0], b = borrosos[1];
      // 1. La foto actual se funde con su copia difuminada; el recorte y el vidrio de los paneles se apagan
      a.style.backgroundImage = vidrioActual;
      body.classList.add('transicion');
      a.style.opacity = 1;
      frente.style.opacity = 0;
      return despues(550).then(function () {
        // 2. Tapada la foto, se cambia por la nueva; la copia difuminada nueva se funde sobre la vieja
        foto.style.backgroundImage = v.fondo;
        foto.classList.add('acercada');
        frente.style.backgroundImage = v.frente || 'none';
        frente.classList.add('acercada');
        body.classList.toggle('foto', !f.minimal);
        b.style.backgroundImage = v.vidrio;
        b.style.opacity = 1;
        ponerVidrio(v.vidrio);
        if (oyentes.mitad) oyentes.mitad(f);
        return despues(500);
      }).then(function () {
        // 3. Se aclara la foto nueva mientras se asienta (de 1,04 a 1): el vidrio y el recorte vuelven
        a.style.opacity = 0;
        a.style.transition = 'none';
        void a.offsetWidth;
        a.style.transition = '';
        b.style.opacity = 0;
        foto.classList.remove('acercada');
        frente.classList.remove('acercada');
        if (v.frente) frente.style.opacity = 1;
        body.classList.remove('transicion');
        return despues(900);
      }).then(function () {
        a.style.backgroundImage = b.style.backgroundImage = 'none';   // libera las texturas
        siguientePendiente();
      });
    }).catch(function (e) {
      actual = '';
      siguientePendiente();
      console.warn('Fondo no disponible', e);   // sin red y sin la foto en el paquete: se queda el que hubiera
    });
  }

  function siguientePendiente() {
    ocupado = false;
    if (pendiente) { var p = pendiente; pendiente = null; aplicar(p[0], p[1]); }
  }

  /**
   * Coloca el recorte difuminado de un panel para que coincida con el fondo de detrás.
   * Se mide con offsetLeft/Top (ignoran transform) para que dé igual si el panel está animándose.
   */
  var MARGEN = 40;
  function colocarVidrio(panel) {
    var hijo = panel.querySelector('.vidrio-fondo');
    if (!hijo) return;
    var p = posicion(panel);
    hijo.style.left = -MARGEN + 'px';
    hijo.style.top = -MARGEN + 'px';
    hijo.style.width = panel.offsetWidth + 2 * MARGEN + 'px';
    hijo.style.height = panel.offsetHeight + 2 * MARGEN + 'px';
    hijo.style.backgroundPosition = (MARGEN - p.x) + 'px ' + (MARGEN - p.y) + 'px';
    if (vidrioActual) hijo.style.backgroundImage = vidrioActual;
  }

  /** Posición en pantalla de un elemento, sin contar transform. */
  function posicion(el) {
    var x = 0, y = 0;
    while (el) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
    return { x: x, y: y };
  }

  return {
    LISTA: LISTA, buscar: buscar, siguiente: siguiente, siguienteRotacion: siguienteRotacion,
    iniciar: iniciar, aplicar: aplicar, colocarVidrio: colocarVidrio, posicion: posicion,
    vidrio: function () { return vidrioActual; },
    /** fn(vidrio) cuando cambia la copia difuminada; mitad(f) en el momento oculto de la transición */
    al: function (evento, fn) { oyentes[evento] = fn; }
  };
})();
