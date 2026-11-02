# TV Libre

**Una pantalla de inicio rápida, limpia y sin anuncios para televisores LG con webOS, con estética tipo Apple TV.**
Pensada para la LG **UN711C0ZB** (webOS 5.0, firmware 04.64.00). Debería funcionar en otras LG con webOS 4 o 5, pero solo se ha probado en el navegador del ordenador y está pendiente de verificar en esa TV (ver [Compatibilidad](#compatibilidad)).

- **Sin anuncios.** Ni banners ni filas patrocinadas ni promociones que se reproducen solas.
- **Vidrio líquido.** El dock, los ajustes, los avisos y hasta las cifras del reloj son vidrio translúcido que difumina el fondo, con canto de luz y reflejo especular.
- **Fondos a elegir.** 5 minimalistas (Grafito, Aurora, Océano, Atardecer, Salvia) y 33 fotos: montañas, playas, ciudades, lagos y naturaleza. Van dentro del paquete y funcionan sin red.
- **Rotación con transición difuminada.** El fondo cambia solo cada 1, 5, 15 o 60 minutos (o nunca), por todas las fotos o dentro de un grupo. La foto se difumina, cambia mientras está borrosa y la nueva se enfoca asentándose, como en Apple TV.
- **Reloj con profundidad.** En 10 fotos, las cumbres o los edificios tapan parte del reloj, como en la pantalla de bloqueo del iPhone.
- **Personalizable.** Reloj de vidrio, fino u oculto; fecha y tiempo sí o no; profundidad sí o no.
- **Claro u oscuro con un botón.** El verde del mando cambia el tema con una transición suave.
- **Fluida.** Solo se animan transform y opacity, y la repetición de teclas se limita para que no se acumule lag. No corre nada en segundo plano.
- **Tus apps delante.** Eliges cuáles se ven y en qué orden, con el mando.
- **Entradas a un botón.** TV, HDMI 1-3 y navegador, en una caja de vidrio bajo el dock. Los ajustes, en el botón de arriba a la derecha (y desde ahí, los de la TV).
- **El tiempo de un vistazo.** Temperatura actual de tu ciudad, con [Open-Meteo](https://open-meteo.com) (sin clave y sin rastreo).
- **Tema automático.** Claro de día y oscuro de noche, según el amanecer y el anochecer reales de tu ciudad (en su zona horaria).
- **Atenuado** para ver en una habitación a oscuras.
- **Seguro.** Sin root. No toca el sistema: el inicio de LG sigue donde estaba, y una orden lo desinstala.

**En el móvil:** [apps de mando para Android e iPhone](movil/README.md) con trackpad, teclado, apps, cambio de fondo y un botón Home que abre TV Libre (y no el inicio de LG).

Además: [guía de ajustes](docs/AJUSTES-TV.md) para quitar publicidad y procesos de fondo desde los menús de la TV, y una [lista DNS](dns/bloqueo-lg.txt) para Pi-hole o AdGuard Home.

## Instalar

Unos diez minutos. Necesitas la TV y un ordenador en la misma red, con Python 3. No hace falta instalar nada más.

1. **En la TV**: abre LG Content Store e instala **Developer Mode**. Entra con una cuenta gratuita de [LG Developer](https://webostv.developer.lge.com), activa **Dev Mode Status** (la TV se reinicia) y después **Key Server**. Apunta la IP y la frase de paso (passphrase) que aparecen.
2. **En el ordenador**, instala:
   ```bash
   python3 tools/install.py 192.168.1.50
   ```
   Cambia la IP por la de tu TV. La primera vez te pide la frase de paso y empareja la TV: guarda su huella SSH en `~/.ssh/tvlibre_known_hosts` y te la enseña. Las siguientes veces no pide nada, pero se niega a seguir si la huella cambia (alguien podría estar suplantando la TV). El paquete pesa unos 15 MB porque lleva las fotos dentro.

   La clave SSH de la TV se guarda **desbloqueada** en `~/.ssh/tvlibre_<IP>` (permisos 600) para no pedir la frase en cada actualización. Es un compromiso de comodidad: quien pueda leer tu `~/.ssh` podría entrar al modo desarrollador de la TV. Bórrala con `--olvidar` cuando no la necesites, y activa el Key Server de la TV solo mientras emparejas (sirve la clave por HTTP).
3. **En la TV**, con TV Libre abierta, **mantén pulsado un número del mando** (Acceso rápido). A partir de ahí, ese número la abre desde cualquier sitio.

Para que la TV no te lleve al inicio de LG al encenderla: *Ajustes → General → Ajustes adicionales → Ajustes de la pantalla de inicio → Inicio automático de Home: desactivado*.

### Usar el mando

| Botón | Qué hace |
|---|---|
| ◀ ▶ ▲ ▼ | Moverse |
| OK | Abrir la app o entrada |
| OK mantenido | Coger la app para moverla (como en tvOS) |
| 🔴 Rojo | Siguiente fondo |
| 🟢 Verde | Modo claro / oscuro |
| 🟡 Amarillo | Editar el dock: ◀ ▶ mueve la app, OK la oculta o la muestra, Atrás termina |
| 🔵 Azul | Ajustes: tema, fondo, rotación, vidrio, animaciones, atenuado, reloj, profundidad, ubicación, hora |

Si notas la TV lenta, en Ajustes pon **Vidrio: Sencillo** y **Animaciones: Reducidas** (el fondo cambia sin transición).

Si el firmware no deja a TV Libre leer la lista de apps, lo intenta por el protocolo de la propia TV (SSAP): la primera vez la TV pregunta si permites el acceso; acepta y no vuelve a preguntar.

Al principio se ocultan las apps de sistema de LG (Content Store, Guía, Galería…). Con el botón amarillo puedes volver a mostrarlas.

### Mantenimiento

- Developer Mode caduca a las **1000 horas (~40 días)**. Abre la app Developer Mode de vez en cuando y pulsa **EXTEND**. Si caduca, TV Libre desaparece; basta con volver a instalarla.
- Desinstalar:
  ```bash
  python3 tools/install.py 192.168.1.50 --desinstalar
  ```
- Para probar cambios de HTML, CSS o JS sin volver a subir las fotos (un segundo en vez de quince):
  ```bash
  python3 tools/install.py 192.168.1.50 --rapido
  ```
- Si reinstalas Developer Mode, la huella SSH de la TV cambia y el instalador se detiene. Olvida la antigua y vuelve a emparejar:
  ```bash
  python3 tools/install.py 192.168.1.50 --olvidar
  ```

## Desarrollar

```
app/              la app web (HTML, CSS y JS sin dependencias)
  appinfo.json    id, versión y resolución de la app webOS
  js/luna.js      llamadas al bus Luna (listar y abrir apps); datos de ejemplo fuera de la TV
  js/tiempo.js    Open-Meteo e iconos del tiempo
  js/fondos.js    lista de fondos, transición difuminada, capa de profundidad y recortes del vidrio
  js/app.js       navegación con el mando, edición del dock, ajustes, tema y rotación
  fondos/         <id>.jpg (1920×1080), <id>-vidrio.jpg (480×270 ya difuminada), <id>-frente.webp (primer plano)
tools/build.py    crea TVLibre.ipk (formato ar + tar.gz) sin ares-cli
tools/install.py  instala por SSH con el instalador de la propia TV
tools/fondos.py   descarga las fotos y crea sus copias de vidrio (necesita Pillow)
tools/profundidad.py  recorta el primer plano de las fotos marcadas con profundidad: true (Pillow y NumPy)
docs/             guía de ajustes de la TV
dns/              dominios de publicidad de LG para bloquear por DNS
```

**Probar en el ordenador:** `python3 -m http.server 8123 --directory app` y abre http://localhost:8123 a 1920 × 1080. Sin la TV aparecen apps de ejemplo. Las flechas y Enter funcionan como el mando; `R`, `G`, `A` y `S` hacen de botones rojo, verde, amarillo y azul, y `Esc` de Atrás.

**Límites de webOS 5:** su navegador es Chromium 68. Eso deja fuera `backdrop-filter`, `gap` en flexbox, `?.` y `??`. El JS está escrito en ES2015. La TV no calcula ningún difuminado: cada foto trae una copia pequeña ya difuminada (`-vidrio.jpg`) que los paneles, el reloj y la transición estiran a pantalla completa. Solo se animan `transform` y `opacity`, y nunca hay dos fotos de 1920×1080 a la vez en memoria.

**Añadir fotos:** pon la entrada en `LISTA` de `app/js/fondos.js` (con el id de Unsplash), ejecuta `python3 tools/fondos.py`; si quieres profundidad, márcala con `profundidad: true` (y `relojY` para bajar el reloj) y ejecuta `python3 tools/profundidad.py --muestra` para revisar el recorte.

Si prefieres las herramientas oficiales de LG, también funciona:
```bash
npm install -g @webos-tools/cli
ares-setup-device   # añade la TV
ares-package app && ares-install com.tvlibre.inicio_0.3.1_all.ipk
```

## Compatibilidad

| Probado | Estado |
|---|---|
| Navegador de escritorio a 1920×1080 (apps de ejemplo) | ✅ |
| LG UN711C0ZB, webOS 5.0, 04.64.00: instalar, listar y abrir apps, mando, HDMI | ⏳ pendiente |
| Otras LG con webOS 4 / 5 | ❓ sin probar |

Si la pruebas en otra TV, apunta modelo, versión de webOS y qué funciona (listar apps, abrir HDMI, botones de colores).

## Créditos

Idea inspirada en [Free My TV](https://github.com/simbasjungles/free-my-tv) (MIT), que hace lo mismo para Google TV, LG y Samsung. Fotos de [Unsplash](https://unsplash.com) (licencia de Unsplash). Licencia del código: MIT.
