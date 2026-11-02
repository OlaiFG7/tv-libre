# TV Libre en el móvil

Mando para la TV LG con la estética de TV Libre, en dos versiones con las mismas funciones: **Android** (`android/`) e **iOS** (`ios/`). Ninguna necesita cuenta de LG, ni trae anuncios, ni usa librerías externas. Tampoco hacen nada en segundo plano: conectan al abrirlas y cortan al salir.

- **Trackpad**: desliza para mover el foco y toca para OK, como el mando del Apple TV. Cada toque vibra.
- **Home → TV Libre**: el botón ⌂ abre TV Libre aunque estés en Netflix o en un HDMI. Es lo que el mando de plástico no deja hacer, porque su botón Home siempre abre el inicio de LG.
- Atrás, reproducir o pausar, volumen, silencio, los cuatro botones de colores y apagar o encender.
- **Teclado**: lo que escribes en el móvil aparece en el campo de texto que tenga el foco en la TV.
- **Apps y entradas**: tocas Spotify o HDMI 2 en el móvil y se abre directamente.
- **Fondos**: miniaturas de los 38 fondos de TV Libre. Tocas una y la TV cambia de fondo; también puedes elegir el tema (automático, claro u oscuro).

## Cómo funciona

Las dos apps hablan con la TV por **SSAP**, el protocolo de las apps de mando de LG: un WebSocket `wss://IP-de-la-TV:3001`.

1. **Emparejar**: la primera vez, la TV pregunta en pantalla si permites el acceso y devuelve una clave que la app guarda. El manifiesto de emparejamiento es el público de LG, tomado de [PyWebOSTV](https://github.com/supersaiyanmode/PyWebOSTV) (MIT), y está en `compartido/ssap-registro.json`.
2. **Certificado**: el de la TV es autofirmado. La app guarda su huella en el primer emparejamiento y después rechaza cualquier otro; así otro equipo de la red no puede hacerse pasar por la TV. Si reinstalas cosas en la TV y la huella cambia, pulsa *Olvidar* y vuelve a emparejar.
3. **Fondos y tema**: la app abre TV Libre con parámetros (`{"fondo": "playa-tropical"}`, `{"tema": "claro"}`) y TV Libre los aplica (`atenderParametros` en `app/js/app.js`).
4. **Datos compartidos**: los dos móviles leen `compartido/`. Si cambias la lista de fondos de la TV, regenera ese archivo:
   ```bash
   python3 tools/fondos_movil.py
   ```

### Encender la TV

Al conectar, la app guarda la MAC de la TV. Para encenderla manda un paquete Wake-on-LAN, y en la TV tiene que estar activado *Conexión → Ajustes de conexión de dispositivos → Encender TV con móvil*.

- **Android**: lo manda a toda la red. Funciona siempre.
- **iPhone**: iOS no deja enviar a toda la red sin un permiso especial de Apple (*multicast entitlement*), así que lo manda directo a la IP de la TV. Suele funcionar un buen rato después de apagarla, mientras el router recuerda su MAC, pero no siempre.

### Encontrar la TV

- **Android**: pregunta por SSDP quién es una TV LG en la red.
- **iPhone**: iOS tampoco deja usar SSDP sin ese permiso, así que prueba el puerto 3001 en las 254 direcciones de tu red. Tarda unos segundos y la primera vez iOS pide permiso para usar la red local.
- En los dos puedes escribir la IP a mano. Está en *Ajustes de la TV → General → Red*.

## Compilar e instalar

### Android (`android/`)

Hace falta el SDK de Android: Android Studio, o las *command line tools* con `platforms;android-35` y `build-tools;35.0.0`.

```bash
cd movil/android
gradle wrapper        # solo la primera vez, si no tienes el wrapper
./gradlew assembleRelease
```

El `.apk` queda en `app/build/outputs/apk/release/`. Está firmado con la clave de depuración para poder instalarlo directamente: pásalo al móvil, ábrelo y permite *instalar apps desconocidas*. No caduca.

También puedes abrir `movil/android` con Android Studio y darle a ▶︎ con el móvil conectado por cable.

### iOS (`ios/`)

Abre `movil/ios/TVLibreMando.xcodeproj` en Xcode, elige tu iPhone, entra con tu Apple ID en *Signing & Capabilities* (vale una cuenta gratuita) y dale a ▶︎.

Con una cuenta gratuita, la app caduca a los **7 días** y hay que volver a instalarla desde Xcode. Con la cuenta de desarrollador de pago (99 €/año) dura un año.

## Archivos

```
compartido/ssap-registro.json   manifiesto de emparejamiento (también lo usa app/js/ssap.js en la TV)
compartido/fondos.json          lista de fondos con miniaturas; la genera tools/fondos_movil.py
android/…/WebSocket.kt          cliente WebSocket mínimo con fijación de certificado (Android no trae uno)
android/…/TV.kt                 conexión SSAP, botones, Wake-on-LAN, SSDP
android/…/Principal.kt          interfaz: trackpad, apps, fondos, elegir TV
ios/TVLibreMando/TV.swift       lo mismo en Swift (URLSessionWebSocketTask, Network)
ios/TVLibreMando/Vistas.swift   interfaz SwiftUI con materiales de vidrio de iOS
```
