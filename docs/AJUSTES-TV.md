# Ajustes de la TV para quitar anuncios y procesos de fondo

Probado en webOS 5.0 (LG UN711C0ZB). Según el idioma o la región, algunos nombres pueden cambiar un poco.
Todo empieza en **⚙ → Todos los ajustes**.

## 1. Anuncios y recomendaciones

| Qué | Dónde | Valor |
|---|---|---|
| Información de visualización | General → Acerca de este TV → Acuerdos de usuario | Desmarcado |
| Publicidad basada en intereses | General → Acerca de este TV → Acuerdos de usuario | Desmarcado |
| Información de voz | General → Acerca de este TV → Acuerdos de usuario | Desmarcado (si no usas el micro) |
| Inicio automático de Home | General → Ajustes adicionales → Ajustes de la pantalla de inicio | Desactivado |
| Promoción en Home | General → Ajustes adicionales → Ajustes de la pantalla de inicio | Desactivado |
| Recomendación de contenido | General → Ajustes adicionales → Ajustes de la pantalla de inicio | Desactivado |
| Live Plus (reconoce lo que ves) | General → Live Plus | Desactivado |

## 2. Procesos de fondo

| Qué | Dónde | Recomendación |
|---|---|---|
| Encender TV con móvil | Conexión → Ajustes de conexión de dispositivos | **Activado si usas la app móvil de TV Libre** (la enciende con Wake-on-LAN); si no, desactivar |
| SIMPLINK (HDMI-CEC) | Conexión → Ajustes de conexión HDMI | Desactivar si no controlas otros aparatos con el mando |
| QuickStart+ | General → Ajustes adicionales | Desactivado = cada encendido es un arranque limpio |

Si dejas QuickStart+ activado, haz un **reinicio completo** de vez en cuando: desenchufa la TV durante 1 minuto. Así se libera la memoria que se va acumulando.

## 3. Imagen

- Modo de imagen: **Cine** o **Experto**.
- Ahorro de energía: **Desactivado**.
- Relación de aspecto → **Solo escaneo: Activado**. Sin él la TV recorta un poco los bordes y reescala; con él, la imagen de 1080p (y TV Libre) pasa a 4K exactamente al doble, píxel a píxel.
- Contraste dinámico, Color dinámico y Motion Eye Care: desactívalos si la imagen te parece artificial.

## 4. Bloqueo por DNS

*Conexión → Wi-Fi (o cable) → Ajustes avanzados → Editar*. Desmarca "automático" y pon un DNS que filtre anuncios, por ejemplo AdGuard DNS: `94.140.14.14` y `94.140.15.15`.
Si tienes Pi-hole o AdGuard Home, añade [dns/bloqueo-lg.txt](../dns/bloqueo-lg.txt).

## 5. Último recurso

*General → Restablecer configuración inicial*. En el asistente, **rechaza todos los acuerdos opcionales** desde el principio y vuelve a instalar TV Libre.
