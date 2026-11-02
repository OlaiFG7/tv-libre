package com.tvlibre.mando

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/*
 * Conexión con la TV LG por SSAP (el protocolo de las apps de mando de LG). Misma lógica que TV.swift en iOS:
 *  - Órdenes: WebSocket wss://IP:3001, mensajes JSON {type, id, uri, payload}.
 *  - Botones: un segundo WebSocket que da la TV (getPointerInputSocket), con "type:button\nname:UP\n\n".
 *  - Emparejar la primera vez: la TV pregunta en pantalla y devuelve una client-key que se guarda.
 *  - El certificado autofirmado de la TV se fija en el primer emparejamiento (huella SHA-256).
 * Nada corre en segundo plano: la actividad conecta en onResume y desconecta en onPause.
 */

const val ID_TV_LIBRE = "com.tvlibre.inicio"

/** id: el de TV Libre (la app, o el acceso fijado); se abre con appId y params. */
data class AppTV(val id: String, val nombre: String, val icono: String?, val color: String?, val appId: String = id, val params: JSONObject? = null)
/** Cómo tiene las apps la pantalla de TV Libre (lo manda la TV, ver avisarMovil en app/js/app.js). */
data class Disposicion(val favoritas: List<String>, val ocultas: List<String>, val orden: List<String>)

private const val PUERTO_MOVIL = 8765
// Las mismas que TV Libre oculta de fábrica mientras no se sepa cómo las tiene
private val OCULTAS_DE_FABRICA = Regex("^(com\\.webos\\.|com\\.palm\\.|com\\.lge\\.)")
data class EntradaTV(val id: String, val nombre: String)
data class Fondo(val id: String, val nombre: String, val grupo: String, val miniatura: String?, val colores: List<String>)

class TV(private val contexto: Context, private val alCambiar: () -> Unit) {
    enum class Estado { SIN_TV, CONECTANDO, ESPERANDO_PERMISO, CONECTADA, ERROR }

    var estado = Estado.SIN_TV
        private set
    var error = ""
        private set
    private val prefs = contexto.getSharedPreferences("tv", Context.MODE_PRIVATE)
    var ip: String = prefs.getString("ip", "") ?: ""
    var apps: List<AppTV> = emptyList()
        private set
    var entradas: List<EntradaTV> = emptyList()
        private set
    var disposicion: Disposicion? = null
        private set
    private var servidor: ServerSocket? = null

    private val red = Executors.newSingleThreadExecutor()
    private val principal = Handler(Looper.getMainLooper())
    private var ordenes: WebSocket? = null
    private var botones: WebSocket? = null
    private val pendientes = ConcurrentHashMap<String, (JSONObject?) -> Unit>()
    private val siguiente = AtomicInteger()
    @Volatile private var abrirHasta = 0L   // tras encenderla, si conecta antes de esta hora se abre TV Libre

    private fun cambiar(nuevo: Estado, texto: String = "") {
        principal.post { estado = nuevo; error = texto; alCambiar() }
    }

    // ---------- Conexión y emparejamiento ----------

    fun conectar() {
        if (ip.isEmpty()) { cambiar(Estado.SIN_TV); return }
        desconectar()
        cambiar(Estado.CONECTANDO)
        disposicion = prefs.getString("disposicion:$ip", null)?.let(::leerDisposicion)
        escuchar()
        val destino = ip
        red.execute {
            try {
                val ws = WebSocket(URI("wss://$destino:3001"), ::huellaValida, ::atender) { e ->
                    if (estado == Estado.CONECTADA) cambiar(Estado.ERROR, "Conexión perdida")
                    else if (e != null) cambiar(Estado.ERROR, e.message ?: "Sin conexión")
                }
                ws.conectar()
                ordenes = ws
                val carga = JSONObject(manifiesto())
                prefs.getString("clave:$destino", null)?.let { carga.put("client-key", it) }
                ws.enviar(JSONObject().put("type", "register").put("id", "registro").put("payload", carga).toString())
            } catch (e: Exception) {
                val texto = if (e.message?.contains("certificado") == true || e.cause?.message?.contains("certificado") == true)
                    "El certificado de la TV ha cambiado. Si reinstalaste algo en la TV, olvídala y vuelve a emparejar."
                else "No se pudo conectar con $destino"
                cambiar(Estado.ERROR, texto)
            }
        }
    }

    fun desconectar() {
        val o = ordenes; val b = botones; val s = servidor
        ordenes = null; botones = null; servidor = null
        red.execute { o?.cerrar(); b?.cerrar() }
        runCatching { s?.close() }
        pendientes.clear()
    }

    /** Borra la clave, la huella y la MAC guardadas: la próxima vez se vuelve a emparejar. */
    fun olvidar() {
        desconectar()
        prefs.edit().remove("clave:$ip").remove("huella:$ip").remove("mac:$ip").remove("disposicion:$ip").remove("ip").apply()
        ip = ""
        apps = emptyList(); entradas = emptyList()
        cambiar(Estado.SIN_TV)
    }

    private fun huellaValida(huella: String): Boolean {
        val guardada = prefs.getString("huella:$ip", null)
        if (guardada == null) { prefs.edit().putString("huella:$ip", huella).apply(); return true }
        return guardada == huella
    }

    private fun atender(texto: String) {
        val r = try { JSONObject(texto) } catch (_: Exception) { return }
        val id = r.optString("id")
        val tipo = r.optString("type")
        val carga = r.optJSONObject("payload") ?: JSONObject()
        if (id == "registro") {
            when (tipo) {
                "registered" -> {
                    prefs.edit().putString("clave:$ip", carga.optString("client-key")).putString("ip", ip).apply()
                    cambiar(Estado.CONECTADA)
                    abrirBotones()
                    cargarListas()
                    guardarMAC()
                    pedirDisposicion()
                    if (System.currentTimeMillis() < abrirHasta) {
                        abrirHasta = 0
                        principal.postDelayed({ inicio() }, 2500)   // que el sistema termine de arrancar antes
                    }
                }
                "error" -> cambiar(Estado.ERROR, "La TV rechazó el emparejamiento")
                else -> if (carga.optString("pairingType") == "PROMPT") cambiar(Estado.ESPERANDO_PERMISO)
            }
            return
        }
        val respuesta = pendientes.remove(id) ?: return
        val ok = tipo != "error" && carga.optBoolean("returnValue", true)
        principal.post { respuesta(if (ok) carga else null) }
    }

    fun pedir(uri: String, carga: JSONObject = JSONObject(), respuesta: ((JSONObject?) -> Unit)? = null) {
        val ws = ordenes ?: run { respuesta?.invoke(null); return }
        val id = "p" + siguiente.incrementAndGet()
        if (respuesta != null) pendientes[id] = respuesta
        red.execute { ws.enviar(JSONObject().put("type", "request").put("id", id).put("uri", uri).put("payload", carga).toString()) }
    }

    // ---------- Botones ----------

    private fun abrirBotones(despues: (() -> Unit)? = null) {
        pedir("ssap://com.webos.service.networkinput/getPointerInputSocket") { r ->
            val ruta = r?.optString("socketPath").orEmpty()
            if (ruta.isEmpty()) return@pedir
            red.execute {
                try {
                    val ws = WebSocket(URI(ruta), ::huellaValida, {}, {})
                    ws.conectar()
                    botones = ws
                    despues?.invoke()
                } catch (_: Exception) {}
            }
        }
    }

    /** UP, DOWN, LEFT, RIGHT, ENTER, BACK, HOME, MUTE, RED, GREEN, YELLOW, BLUE, PLAY, PAUSE… */
    fun boton(nombre: String) {
        val mensaje = "type:button\nname:$nombre\n\n"
        val ws = botones
        if (ws == null || !ws.abierto) { abrirBotones { botones?.enviar(mensaje) }; return }
        red.execute { ws.enviar(mensaje) }
    }

    // ---------- Órdenes ----------

    fun abrir(id: String, parametros: JSONObject? = null) {
        val carga = JSONObject().put("id", id)
        if (parametros != null) carga.put("params", parametros)
        pedir("ssap://system.launcher/launch", carga)
    }

    fun entrada(id: String) = pedir("ssap://tv/switchInput", JSONObject().put("inputId", id))
    fun volumen(subir: Boolean) = pedir(if (subir) "ssap://audio/volumeUp" else "ssap://audio/volumeDown")
    fun apagar() = pedir("ssap://system/turnOff")
    fun escribir(texto: String) = pedir("ssap://com.webos.service.ime/insertText", JSONObject().put("text", texto).put("replace", false))
    fun borrar(n: Int) = pedir("ssap://com.webos.service.ime/deleteCharacters", JSONObject().put("count", n))
    fun intro() = pedir("ssap://com.webos.service.ime/sendEnterKey")

    /** Abre YouTube directamente en su búsqueda (contentTarget acepta una dirección de youtube.com/tv). */
    fun buscarEnYouTube(texto: String) = abrir("youtube.leanback.v4", JSONObject().put("contentTarget",
        "https://www.youtube.com/tv#/search?q=" + java.net.URLEncoder.encode(texto, "UTF-8").replace("+", "%20")))

    /** El botón Home del móvil abre TV Libre, no el inicio de LG con anuncios. */
    fun inicio() = abrir(ID_TV_LIBRE, conMovil(JSONObject()))
    fun fondo(id: String) = abrir(ID_TV_LIBRE, conMovil(JSONObject().put("fondo", id)))
    fun tema(tema: String) = abrir(ID_TV_LIBRE, conMovil(JSONObject().put("tema", tema)))
    fun abrir(app: AppTV) = abrir(app.appId, app.params)

    private fun cargarListas() {
        pedir("ssap://com.webos.applicationManager/listLaunchPoints") { r ->
            val lista = r?.optJSONArray("launchPoints") ?: return@pedir
            val vistos = HashSet<String>()
            apps = (0 until lista.length()).mapNotNull { i ->
                val a = lista.getJSONObject(i)
                val appId = a.optString("id")
                if (appId.isEmpty() || appId == ID_TV_LIBRE) return@mapNotNull null
                // Como separarAccesos en app/js/luna.js: el acceso principal de cada app se conoce por su id;
                // los fijados (un vídeo de YouTube…), por su launchPointId, y se abren con sus params
                val lp = a.optString("launchPointId")
                val tipo = a.optString("lptype")
                val esPrincipal = if (tipo.isNotEmpty()) tipo == "default" else (lp.isEmpty() || lp == appId || lp.endsWith("_default"))
                val id = if (esPrincipal) appId else lp.ifEmpty { appId + ":" + a.optString("title") }
                if (!vistos.add(id)) return@mapNotNull null
                // Solo se pueden cargar los iconos que la TV sirve por http; si es una ruta interna, se usa la inicial
                val icono = a.optString("largeIcon").ifEmpty { a.optString("icon") }
                AppTV(id, a.optString("title", id), icono.takeIf { it.startsWith("http") }, a.optString("bgColor").ifEmpty { null },
                    appId, if (esPrincipal) null else a.optJSONObject("params"))
            }
            alCambiar()
        }
        pedir("ssap://tv/getExternalInputList") { r ->
            val lista = r?.optJSONArray("devices") ?: return@pedir
            entradas = (0 until lista.length()).map { i ->
                val e = lista.getJSONObject(i)
                EntradaTV(e.optString("id"), e.optString("label", e.optString("id")))
            }
            alCambiar()
        }
    }

    // ---------- Las apps como en TV Libre ----------

    /** Favoritas y el resto, en el orden y sin las ocultas de la pantalla de TV Libre (ver ordenarApps y appsDeFila en app.js). */
    fun filas(): Pair<List<AppTV>, List<AppTV>> {
        val d = disposicion
        val ocultas = d?.ocultas?.toSet() ?: apps.filter { OCULTAS_DE_FABRICA.containsMatchIn(it.id) }.map { it.id }.toSet()
        val pos = d?.orden?.withIndex()?.associate { it.value to it.index } ?: emptyMap()
        val ordenadas = apps.sortedBy { pos[it.id] ?: 1_000_000 }
        val favIds = d?.favoritas ?: ordenadas.filter { it.id !in ocultas }.take(7).map { it.id }
        val porId = ordenadas.associateBy { it.id }
        val favoritas = favIds.mapNotNull { porId[it] }.filter { it.id !in ocultas }
        val resto = ordenadas.filter { it.id !in favIds && it.id !in ocultas }
        return favoritas to resto
    }

    /** Cambia cuando hay que volver a pintar la pestaña de apps. */
    val firmaApps get() = "${apps.size}/${entradas.size}/${disposicion.hashCode()}"

    private fun leerDisposicion(texto: String): Disposicion? {
        val j = runCatching { JSONObject(texto) }.getOrNull() ?: return null
        fun lista(n: String) = j.optJSONArray(n)?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
        return Disposicion(lista("favoritas"), lista("ocultas"), lista("orden"))
    }

    /** La dirección del móvil en la red de la TV, para que TV Libre le mande cómo tiene las apps. */
    private fun direccionMovil(): String? {
        if (servidor == null) return null
        val red = ip.substringBeforeLast('.')
        val propias = runCatching {
            NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }
                .flatMap { it.inetAddresses.toList() }.filterIsInstance<Inet4Address>().filter { it.isSiteLocalAddress }
                .mapNotNull { it.hostAddress }
        }.getOrNull().orEmpty()
        val propia = propias.firstOrNull { it.substringBeforeLast('.') == red } ?: propias.firstOrNull() ?: return null
        return "http://$propia:$PUERTO_MOVIL/"
    }

    private fun conMovil(p: JSONObject) = p.apply { direccionMovil()?.let { put("movil", it) } }

    /** Si TV Libre está delante, le pide que mande cómo tiene las apps (sin cambiar nada en la pantalla de la TV). */
    fun pedirDisposicion() {
        val yo = direccionMovil() ?: return
        pedir("ssap://com.webos.applicationManager/getForegroundAppInfo") { r ->
            if (r?.optString("appId") == ID_TV_LIBRE) abrir(ID_TV_LIBRE, JSONObject().put("movil", yo).put("soloMovil", true))
        }
    }

    /** Un servidor HTTP mínimo, solo mientras la app está abierta, que solo acepta lo que manda la TV. */
    private fun escuchar() {
        val s = runCatching { ServerSocket().apply { reuseAddress = true; bind(InetSocketAddress(PUERTO_MOVIL)) } }.getOrNull() ?: return
        servidor = s
        Thread {
            while (!s.isClosed) {
                val c = runCatching { s.accept() }.getOrNull() ?: break
                runCatching { c.soTimeout = 3000; atenderTV(c) }
                runCatching { c.close() }
            }
        }.start()
    }

    private fun atenderTV(c: Socket) {
        val entrada = c.getInputStream().buffered()
        val cabecera = StringBuilder()
        while (!cabecera.endsWith("\r\n\r\n") && cabecera.length < 8192) {
            val b = entrada.read()
            if (b < 0) return
            cabecera.append(b.toChar())
        }
        val lineas = cabecera.lines()
        val metodo = lineas.first().substringBefore(' ')
        val largo = lineas.firstOrNull { it.startsWith("content-length:", true) }?.substringAfter(':')?.trim()?.toIntOrNull() ?: 0
        val cuerpo = ByteArray(largo.coerceIn(0, 65536))
        var leido = 0
        while (leido < cuerpo.size) { val n = entrada.read(cuerpo, leido, cuerpo.size - leido); if (n < 0) break; leido += n }
        c.getOutputStream().write(("HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Headers: Content-Type\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").toByteArray())
        if (metodo != "POST" || c.inetAddress.hostAddress != ip) return
        val texto = String(cuerpo, 0, leido, Charsets.UTF_8)
        val d = leerDisposicion(texto) ?: return
        prefs.edit().putString("disposicion:$ip", texto).apply()
        principal.post { disposicion = d; alCambiar() }
    }

    // ---------- Encender (Wake-on-LAN) ----------

    private fun guardarMAC() {
        pedir("ssap://com.webos.service.connectionmanager/getinfo") { r ->
            // Las dos: la TV da la MAC del cable aunque esté por Wi-Fi, y solo despierta con la de la tarjeta que usa
            val macs = listOf("wiredInfo", "wifiInfo").mapNotNull { r?.optJSONObject(it)?.optString("macAddress") }
                .filter { it.isNotEmpty() && it != "00:00:00:00:00:00" }.distinct()
            if (macs.isNotEmpty()) prefs.edit().putString("mac:$ip", macs.joinToString(",")).apply()
        }
    }

    val puedeEncender get() = prefs.getString("mac:$ip", null) != null

    /**
     * Paquete mágico (6 × 0xFF y 16 veces la MAC) a toda la red. En la TV: "Encender TV con móvil" activado.
     * Cuando la TV contesta se abre TV Libre: una app de desarrollador no puede abrirse sola al encender.
     */
    fun encender() {
        val macs = prefs.getString("mac:$ip", null) ?: return
        val paquetes = macs.split(",").map { mac -> mac.split(":").mapNotNull { it.toIntOrNull(16)?.toByte() } }
            .filter { it.size == 6 }
            .map { bytes -> ByteArray(6) { 0xFF.toByte() } + (1..16).flatMap { bytes }.toByteArray() }
        if (paquetes.isEmpty()) return
        Thread {
            try {
                DatagramSocket().use { s ->
                    s.broadcast = true
                    for (paquete in paquetes) for (destino in listOf("255.255.255.255", ip)) for (puerto in listOf(9, 7)) {
                        s.send(DatagramPacket(paquete, paquete.size, InetAddress.getByName(destino), puerto))
                    }
                }
            } catch (_: Exception) {}
            // La TV tarda en arrancar: se reintenta hasta que conteste, y al conectar se abre TV Libre
            abrirHasta = System.currentTimeMillis() + 60_000
            for (i in 1..10) {
                Thread.sleep(if (i == 1) 6000 else 4000)
                if (estado == Estado.CONECTADA) break
                if (estado != Estado.CONECTANDO) principal.post { conectar() }
            }
        }.start()
    }

    // ---------- Buscar la TV (SSDP) ----------

    /** Pregunta por la red quién es una TV LG (servicio webos-second-screen) y devuelve las IPs que contestan. */
    fun buscar(alTerminar: (List<String>) -> Unit) {
        Thread {
            val wifi = contexto.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            val cerrojo = wifi.createMulticastLock("tvlibre").apply { setReferenceCounted(false); acquire() }
            val encontradas = linkedSetOf<String>()
            try {
                DatagramSocket().use { s ->
                    s.soTimeout = 3000
                    val pregunta = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\n" +
                        "ST: urn:lge-com:service:webos-second-screen:1\r\n\r\n").toByteArray()
                    s.send(DatagramPacket(pregunta, pregunta.size, InetAddress.getByName("239.255.255.250"), 1900))
                    val buffer = ByteArray(2048)
                    while (true) {
                        val p = DatagramPacket(buffer, buffer.size)
                        try { s.receive(p) } catch (_: SocketTimeoutException) { break }
                        p.address.hostAddress?.let { encontradas.add(it) }
                    }
                }
            } catch (_: Exception) {
            } finally {
                cerrojo.release()
            }
            principal.post { alTerminar(encontradas.toList()) }
        }.start()
    }

    // ---------- Datos compartidos con iOS (movil/compartido) ----------

    private fun manifiesto() = contexto.assets.open("ssap-registro.json").bufferedReader().use { it.readText() }

    val fondos: List<Fondo> by lazy {
        val lista = JSONArray(contexto.assets.open("fondos.json").bufferedReader().use { it.readText() })
        (0 until lista.length()).map { i ->
            val f = lista.getJSONObject(i)
            val colores = f.optJSONArray("colores")
            Fondo(
                f.getString("id"), f.getString("nombre"), f.getString("grupo"),
                f.optString("miniatura").ifEmpty { null },
                if (colores == null) emptyList() else (0 until colores.length()).map { colores.getString(it) },
            )
        }
    }
}
