package com.tvlibre.mando

import android.util.Base64
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager

/**
 * Cliente WebSocket mínimo (RFC 6455): lo justo para hablar con la TV, sin librerías.
 * Solo texto, sin extensiones; responde a ping y entiende mensajes fragmentados.
 *
 * El certificado de la TV es autofirmado: [huella] decide si se acepta (true la primera vez, y después
 * solo si coincide con la guardada). conectar() bloquea: llamarlo fuera del hilo principal.
 */
class WebSocket(
    private val url: URI,
    private val huella: (String) -> Boolean,
    private val alMensaje: (String) -> Unit,
    private val alCerrar: (Exception?) -> Unit,
) {
    private var socket: Socket? = null
    private var salida: OutputStream? = null
    private val aleatorio = SecureRandom()

    @Volatile
    var abierto = false
        private set

    fun conectar() {
        val segura = url.scheme == "wss"
        val puerto = if (url.port > 0) url.port else if (segura) 443 else 80
        val s: Socket = if (segura) {
            val contexto = SSLContext.getInstance("TLS")
            contexto.init(null, arrayOf(ConfiarConHuella(huella)), aleatorio)
            contexto.socketFactory.createSocket()
        } else {
            Socket()
        }
        s.connect(InetSocketAddress(url.host, puerto), 5000)
        s.soTimeout = 0
        if (s is SSLSocket) s.startHandshake()
        socket = s
        val out = BufferedOutputStream(s.getOutputStream())
        salida = out
        val clave = Base64.encodeToString(ByteArray(16).also { aleatorio.nextBytes(it) }, Base64.NO_WRAP)
        val ruta = url.rawPath.ifEmpty { "/" } + (url.rawQuery?.let { "?$it" } ?: "")
        out.write(
            ("GET $ruta HTTP/1.1\r\nHost: ${url.host}:$puerto\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                "Sec-WebSocket-Key: $clave\r\nSec-WebSocket-Version: 13\r\n\r\n").toByteArray()
        )
        out.flush()
        val entrada = DataInputStream(BufferedInputStream(s.getInputStream()))
        val estado = leerLinea(entrada)
        if (!estado.contains(" 101")) throw IOException("La TV respondió: $estado")
        while (leerLinea(entrada).isNotEmpty()) { /* cabeceras */ }
        abierto = true
        Thread({ leer(entrada) }, "ws-${url.port}").apply { isDaemon = true }.start()
    }

    fun enviar(texto: String) {
        if (!abierto) return
        try {
            trama(0x1, texto.toByteArray(Charsets.UTF_8))
        } catch (e: IOException) {
            cerrar()
        }
    }

    fun cerrar() {
        abierto = false
        try { socket?.close() } catch (_: IOException) {}
    }

    private fun leerLinea(e: DataInputStream): String {
        val linea = StringBuilder()
        while (true) {
            val c = e.read()
            if (c < 0) throw IOException("Conexión cerrada")
            if (c == '\n'.code) return linea.toString().trimEnd('\r')
            linea.append(c.toChar())
        }
    }

    private fun leer(e: DataInputStream) {
        try {
            val mensaje = ByteArrayOutputStream()
            while (true) {
                val b0 = e.readUnsignedByte()
                val b1 = e.readUnsignedByte()
                val op = b0 and 0x0F
                val fin = (b0 and 0x80) != 0
                var largo = (b1 and 0x7F).toLong()
                if (largo == 126L) largo = e.readUnsignedShort().toLong() else if (largo == 127L) largo = e.readLong()
                val mascara = if ((b1 and 0x80) != 0) ByteArray(4).also { e.readFully(it) } else null
                val datos = ByteArray(largo.toInt())
                e.readFully(datos)
                if (mascara != null) for (i in datos.indices) datos[i] = (datos[i].toInt() xor mascara[i % 4].toInt()).toByte()
                when (op) {
                    0x8 -> { cerrar(); alCerrar(null); return }
                    0x9 -> trama(0xA, datos)
                    0x0, 0x1 -> {
                        mensaje.write(datos)
                        if (fin) { alMensaje(mensaje.toString("UTF-8")); mensaje.reset() }
                    }
                }
            }
        } catch (ex: Exception) {
            val estaba = abierto
            abierto = false
            if (estaba) alCerrar(ex)
        }
    }

    // Las tramas del cliente van enmascaradas (lo exige el protocolo)
    @Synchronized
    private fun trama(op: Int, datos: ByteArray) {
        val out = ByteArrayOutputStream()
        out.write(0x80 or op)
        when {
            datos.size < 126 -> out.write(0x80 or datos.size)
            datos.size < 65536 -> { out.write(0x80 or 126); out.write(datos.size shr 8); out.write(datos.size and 0xFF) }
            else -> { out.write(0x80 or 127); for (i in 7 downTo 0) out.write(((datos.size.toLong() shr (8 * i)) and 0xFF).toInt()) }
        }
        val m = ByteArray(4).also { aleatorio.nextBytes(it) }
        out.write(m)
        for (i in datos.indices) out.write(datos[i].toInt() xor m[i % 4].toInt())
        val s = salida ?: throw IOException("Sin conexión")
        s.write(out.toByteArray())
        s.flush()
    }
}

/** Acepta el certificado de la TV solo si [huella] da el visto bueno a su SHA-256. */
private class ConfiarConHuella(private val huella: (String) -> Boolean) : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("No se usa")
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val certificado = chain?.firstOrNull() ?: throw CertificateException("Sin certificado")
        val sha = MessageDigest.getInstance("SHA-256").digest(certificado.encoded).joinToString("") { "%02x".format(it) }
        if (!huella(sha)) throw CertificateException("El certificado de la TV ha cambiado")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
}
