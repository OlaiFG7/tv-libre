package com.tvlibre.mando

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.RenderEffect
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.abs

/**
 * Mando de TV Libre para Android, al estilo del mando de Apple TV: el fondo de la TV difuminado detrás,
 * paneles de vidrio, un trackpad (deslizar = flechas, tocar = OK) y pestañas de Apps y Fondos.
 * Vistas nativas sin librerías: el .apk ocupa unos cientos de KB y abre al instante.
 */
class Principal : Activity() {
    private lateinit var tv: TV
    private lateinit var fondoImagen: ImageView
    private lateinit var estadoTexto: TextView
    private lateinit var estadoPunto: View
    private lateinit var contenido: FrameLayout
    private val pestanas = mutableListOf<TextView>()
    private var pestana = 0
    private val prefs by lazy { getSharedPreferences("app", MODE_PRIVATE) }
    private val descargas = Executors.newFixedThreadPool(3)
    private val imagenes = HashMap<String, Bitmap>()

    private val Int.dp get() = (this * resources.displayMetrics.density).toInt()

    override fun onCreate(estado: Bundle?) {
        super.onCreate(estado)
        tv = TV(this) { refrescar() }
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        setContentView(construir())
        ponerFondo(prefs.getString("fondo", "montanas-amanecer")!!)
        mostrar(0)
        if (tv.ip.isEmpty()) elegirTV()
    }

    // Conecta solo mientras se ve: nada en segundo plano
    override fun onResume() { super.onResume(); if (tv.ip.isNotEmpty()) tv.conectar() }
    override fun onPause() { super.onPause(); tv.desconectar() }

    // ---------- Estructura ----------

    private fun construir(): View {
        val raiz = FrameLayout(this)
        fondoImagen = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            if (Build.VERSION.SDK_INT >= 31) setRenderEffect(RenderEffect.createBlurEffect(90f, 90f, Shader.TileMode.CLAMP))
            alpha = 0.8f
        }
        raiz.addView(fondoImagen, FrameLayout.LayoutParams(-1, -1))
        raiz.addView(View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x22000000, 0x99000000.toInt()))
        }, FrameLayout.LayoutParams(-1, -1))

        val columna = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20.dp, 44.dp, 20.dp, 24.dp)
        }
        columna.addView(cabecera())
        columna.addView(selector(), LinearLayout.LayoutParams(-1, 40.dp).apply { topMargin = 14.dp; bottomMargin = 14.dp })
        contenido = FrameLayout(this)
        columna.addView(contenido, LinearLayout.LayoutParams(-1, 0, 1f))
        raiz.addView(columna, FrameLayout.LayoutParams(-1, -1))
        return raiz
    }

    private fun vidrio(radio: Int, alfa: Int = 0x26) = GradientDrawable().apply {
        setColor(Color.argb(alfa, 255, 255, 255))
        cornerRadius = radio.dp.toFloat()
        setStroke(1.dp, Color.argb(0x40, 255, 255, 255))
    }

    private fun texto(t: String, tam: Float = 15f, negrita: Boolean = false, color: Int = Color.WHITE) = TextView(this).apply {
        text = t; textSize = tam; setTextColor(color)
        if (negrita) typeface = Typeface.DEFAULT_BOLD
    }

    private fun cabecera(): View {
        val fila = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        estadoPunto = View(this).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.GRAY) } }
        fila.addView(estadoPunto, LinearLayout.LayoutParams(9.dp, 9.dp).apply { rightMargin = 10.dp })
        val textos = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        textos.addView(texto("TV Libre", 18f, true))
        estadoTexto = texto("", 13f, color = 0xAAFFFFFF.toInt()).apply { maxLines = 1 }
        textos.addView(estadoTexto)
        fila.addView(textos, LinearLayout.LayoutParams(0, -2, 1f))
        fila.setOnClickListener { elegirTV() }
        fila.addView(redondo("⏻", 46) {
            if (tv.estado == TV.Estado.CONECTADA) tv.apagar() else if (tv.puedeEncender) tv.encender()
        })
        return fila
    }

    private fun selector(): View {
        val fila = LinearLayout(this).apply { background = vidrio(20); setPadding(3.dp, 3.dp, 3.dp, 3.dp) }
        listOf("Mando", "Apps", "Fondos").forEachIndexed { i, nombre ->
            val t = texto(nombre, 14f, true).apply { gravity = Gravity.CENTER; setOnClickListener { pulso(it); mostrar(i) } }
            pestanas.add(t)
            fila.addView(t, LinearLayout.LayoutParams(0, -1, 1f))
        }
        return fila
    }

    private fun mostrar(i: Int) {
        pestana = i
        pestanas.forEachIndexed { j, t ->
            t.background = if (j == i) GradientDrawable().apply { setColor(0x40FFFFFF); cornerRadius = 17.dp.toFloat() } else null
        }
        contenido.removeAllViews()
        val vista = when (i) { 0 -> mando(); 1 -> apps(); else -> fondos() }
        vista.alpha = 0f
        contenido.addView(vista, FrameLayout.LayoutParams(-1, -1))
        vista.animate().alpha(1f).setDuration(220).start()
        refrescar()
    }

    private fun refrescar() {
        val (color, t) = when (tv.estado) {
            TV.Estado.SIN_TV -> Color.GRAY to "Toca para elegir la TV"
            TV.Estado.CONECTANDO -> 0xFFFFD60A.toInt() to "Conectando con ${tv.ip}…"
            TV.Estado.ESPERANDO_PERMISO -> 0xFFFFD60A.toInt() to "Acepta el aviso en la TV"
            TV.Estado.CONECTADA -> 0xFF32D74B.toInt() to tv.ip
            TV.Estado.ERROR -> 0xFFFF453A.toInt() to tv.error
        }
        (estadoPunto.background as GradientDrawable).setColor(color)
        estadoTexto.text = t
        if (pestana == 1 && contenido.childCount > 0 && contenido.getChildAt(0).tag != tv.apps.size) mostrar(1)
    }

    private fun pulso(v: View) = v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)

    private fun redondo(simbolo: String, tam: Int, accion: () -> Unit) = texto(simbolo, 20f, true).apply {
        gravity = Gravity.CENTER
        background = vidrio(tam / 2).apply { shape = GradientDrawable.OVAL }
        layoutParams = LinearLayout.LayoutParams(tam.dp, tam.dp)
        setOnClickListener { pulso(it); accion() }
    }

    // ---------- Mando ----------

    private fun mando(): View {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(trackpad(), LinearLayout.LayoutParams(-1, 0, 1f))

        val fila = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(0, 16.dp, 0, 0) }
        fun hueco() = View(this).also { fila.addView(it, LinearLayout.LayoutParams(0, 1, 1f)) }
        fila.addView(redondo("‹", 58) { tv.boton("BACK") }); hueco()
        fila.addView(redondo("⌂", 58) { tv.inicio() }); hueco()           // TV Libre, no el inicio de LG
        fila.addView(redondo("⌨", 58) { teclado() }); hueco()
        fila.addView(redondo("⏯", 58) { tv.boton("PLAY") }); hueco()
        val volumen = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        for ((s, subir) in listOf("+" to true, "−" to false)) {
            volumen.addView(texto(s, 18f, true).apply {
                gravity = Gravity.CENTER; background = vidrio(13)
                setOnClickListener { pulso(it); tv.volumen(subir) }
            }, LinearLayout.LayoutParams(58.dp, 26.dp).apply { topMargin = if (subir) 0 else 6.dp })
        }
        fila.addView(volumen)
        col.addView(fila)

        val colores = LinearLayout(this).apply { setPadding(0, 14.dp, 0, 0) }
        for ((nombre, color) in listOf("RED" to 0xFFFF453A, "GREEN" to 0xFF32D74B, "YELLOW" to 0xFFFFD60A, "BLUE" to 0xFF0A84FF)) {
            val boton = FrameLayout(this).apply { background = vidrio(19); setOnClickListener { pulso(it); tv.boton(nombre) } }
            boton.addView(View(this).apply {
                background = GradientDrawable().apply { setColor(color.toInt()); cornerRadius = 5.dp.toFloat() }
            }, FrameLayout.LayoutParams(-1, 10.dp, Gravity.CENTER).apply { leftMargin = 12.dp; rightMargin = 12.dp })
            colores.addView(boton, LinearLayout.LayoutParams(0, 38.dp, 1f).apply { rightMargin = 10.dp })
        }
        colores.addView(texto("🔇", 15f).apply {
            gravity = Gravity.CENTER; background = vidrio(19)
            setOnClickListener { pulso(it); tv.boton("MUTE") }
        }, LinearLayout.LayoutParams(48.dp, 38.dp))
        col.addView(colores)
        return col
    }

    /** Deslizar = flecha en la dirección dominante; tocar = OK. */
    private fun trackpad(): View {
        val panel = FrameLayout(this).apply { background = vidrio(32, 0x1F) }
        panel.addView(texto("Desliza para moverte · toca para OK", 13f, color = 0x88FFFFFF.toInt()),
            FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = 18.dp })
        var x0 = 0f; var y0 = 0f
        panel.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { x0 = e.x; y0 = e.y; v.animate().scaleX(0.98f).scaleY(0.98f).setDuration(120).start() }
                MotionEvent.ACTION_UP -> {
                    v.animate().scaleX(1f).scaleY(1f).setDuration(200).start()
                    val dx = e.x - x0; val dy = e.y - y0
                    if (abs(dx) < 18.dp && abs(dy) < 18.dp) {
                        v.performHapticFeedback(HapticFeedbackConstants.CONFIRM.takeIf { Build.VERSION.SDK_INT >= 30 } ?: HapticFeedbackConstants.VIRTUAL_KEY)
                        tv.boton("ENTER")
                    } else {
                        pulso(v)
                        tv.boton(if (abs(dx) > abs(dy)) (if (dx > 0) "RIGHT" else "LEFT") else (if (dy > 0) "DOWN" else "UP"))
                    }
                    v.performClick()
                }
                MotionEvent.ACTION_CANCEL -> v.animate().scaleX(1f).scaleY(1f).setDuration(200).start()
            }
            true
        }
        return panel
    }

    /** Lo que se escribe aparece en el campo de texto que tenga el foco en la TV. */
    private fun teclado() {
        var ultimo = ""
        val campo = EditText(this).apply {
            hint = "Busca o escribe…"
            imeOptions = EditorInfo.IME_ACTION_SEARCH
            inputType = InputType.TYPE_CLASS_TEXT
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) {
                    val nuevo = s.toString()
                    // Solo se manda la diferencia: lo añadido o lo borrado
                    if (nuevo.startsWith(ultimo)) tv.escribir(nuevo.substring(ultimo.length))
                    else { tv.borrar(ultimo.length); tv.escribir(nuevo) }
                    ultimo = nuevo
                }
            })
            setOnEditorActionListener { _, _, _ -> tv.intro(); ultimo = ""; setText(""); true }
        }
        AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Escribir en la TV").setView(FrameLayout(this).apply { setPadding(20.dp, 8.dp, 20.dp, 0); addView(campo) })
            .setPositiveButton("Cerrar", null)
            .setNeutralButton("Buscar en YouTube") { _, _ ->
                val q = campo.text.toString().trim()
                if (q.isNotEmpty()) tv.buscarEnYouTube(q)
            }
            .show()
        campo.requestFocus()
    }

    // ---------- Apps y entradas ----------

    private fun apps(): View {
        val scroll = ScrollView(this).apply { tag = tv.apps.size }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        if (tv.entradas.isNotEmpty()) {
            val chips = LinearLayout(this)
            fun chip(t: String, accion: () -> Unit) = chips.addView(texto(t, 14f, true).apply {
                setPadding(16.dp, 10.dp, 16.dp, 10.dp); background = vidrio(20)
                setOnClickListener { pulso(it); accion() }
            }, LinearLayout.LayoutParams(-2, -2).apply { rightMargin = 10.dp })
            chip("TV") { tv.abrir("com.webos.app.livetv") }
            tv.entradas.forEach { e -> chip(e.nombre) { tv.entrada(e.id) } }
            col.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(chips) })
        }
        val rejilla = GridLayout(this).apply { columnCount = 4 }
        val ancho = (resources.displayMetrics.widthPixels - 40.dp) / 4
        tv.apps.forEach { app ->
            val celda = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
                setPadding(5.dp, 12.dp, 5.dp, 4.dp)
                setOnClickListener { pulso(it); tv.abrir(app.id) }
            }
            val cara = FrameLayout(this).apply {
                background = GradientDrawable().apply {
                    setColor(app.color?.let { runCatching { Color.parseColor(it) }.getOrNull() } ?: 0x22FFFFFF)
                    cornerRadius = 18.dp.toFloat(); setStroke(1.dp, 0x26FFFFFF)
                }
            }
            val inicial = texto(app.nombre.take(1), 24f, true).apply { gravity = Gravity.CENTER }
            cara.addView(inicial, FrameLayout.LayoutParams(-1, -1))
            app.icono?.let { url ->
                val img = ImageView(this).apply { setPadding(12.dp, 12.dp, 12.dp, 12.dp) }
                cara.addView(img, FrameLayout.LayoutParams(-1, -1))
                cargar(url, img) { inicial.visibility = View.GONE }
            }
            celda.addView(cara, LinearLayout.LayoutParams(-1, 60.dp))
            celda.addView(texto(app.nombre, 11f).apply { maxLines = 1; gravity = Gravity.CENTER })
            rejilla.addView(celda, GridLayout.LayoutParams().apply { width = ancho })
        }
        col.addView(rejilla)
        if (tv.apps.isEmpty()) col.addView(texto(
            if (tv.estado == TV.Estado.CONECTADA) "Cargando apps…" else "Conecta con la TV para ver sus apps", 14f, color = 0x99FFFFFF.toInt()
        ).apply { gravity = Gravity.CENTER; setPadding(0, 40.dp, 0, 0) }, LinearLayout.LayoutParams(-1, -2))
        scroll.addView(col)
        return scroll
    }

    // ---------- Fondos ----------

    private fun fondos(): View {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val temas = LinearLayout(this).apply { background = vidrio(18); setPadding(3.dp, 3.dp, 3.dp, 3.dp) }
        val elegido = prefs.getString("tema", "auto")
        for ((valor, nombre) in listOf("auto" to "Automático", "claro" to "Claro", "oscuro" to "Oscuro")) {
            temas.addView(texto(nombre, 13f, true).apply {
                gravity = Gravity.CENTER
                if (valor == elegido) background = GradientDrawable().apply { setColor(0x40FFFFFF); cornerRadius = 15.dp.toFloat() }
                setOnClickListener { pulso(it); prefs.edit().putString("tema", valor).apply(); tv.tema(valor); mostrar(2) }
            }, LinearLayout.LayoutParams(0, 34.dp, 1f))
        }
        col.addView(temas)
        val actual = prefs.getString("fondo", "")
        val ancho = (resources.displayMetrics.widthPixels - 52.dp) / 2
        tv.fondos.groupBy { it.grupo }.forEach { (grupo, lista) ->
            col.addView(texto(grupo, 19f, true).apply { setPadding(0, 22.dp, 0, 8.dp) })
            val rejilla = GridLayout(this).apply { columnCount = 2 }
            lista.forEach { f ->
                val tarjeta = FrameLayout(this).apply {
                    clipToOutline = true
                    background = GradientDrawable().apply {
                        cornerRadius = 14.dp.toFloat()
                        if (f.colores.size >= 2) { colors = f.colores.map { Color.parseColor(it) }.toIntArray(); orientation = GradientDrawable.Orientation.TL_BR }
                        else setColor(0x14FFFFFF)
                    }
                    foreground = GradientDrawable().apply {
                        cornerRadius = 14.dp.toFloat()
                        setStroke(if (f.id == actual) 3.dp else 1.dp, if (f.id == actual) Color.WHITE else 0x1FFFFFFF)
                    }
                    setOnClickListener {
                        pulso(it); tv.fondo(f.id)
                        prefs.edit().putString("fondo", f.id).apply(); ponerFondo(f.id); mostrar(2)
                    }
                }
                f.miniatura?.let { url ->
                    val img = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
                    tarjeta.addView(img, FrameLayout.LayoutParams(-1, -1))
                    cargar(url, img)
                }
                tarjeta.addView(View(this).apply {
                    background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0, 0x99000000.toInt()))
                }, FrameLayout.LayoutParams(-1, -1))
                tarjeta.addView(texto(f.nombre, 12f, true), FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM).apply { setMargins(10.dp, 0, 0, 8.dp) })
                rejilla.addView(tarjeta, GridLayout.LayoutParams().apply {
                    width = ancho; height = ancho * 9 / 16; setMargins(0, 0, 12.dp, 12.dp)
                })
            }
            col.addView(rejilla)
        }
        return ScrollView(this).apply { addView(col) }
    }

    private fun ponerFondo(id: String) {
        val f = tv.fondos.firstOrNull { it.id == id } ?: return
        val url = f.miniatura
        if (url != null) cargar(url, fondoImagen)
        else if (f.colores.size >= 2) fondoImagen.setImageDrawable(
            GradientDrawable(GradientDrawable.Orientation.TL_BR, f.colores.map { Color.parseColor(it) }.toIntArray())
        )
    }

    /** Descarga una imagen pequeña (miniatura o icono) en otro hilo y la guarda en memoria mientras la app está abierta. */
    private fun cargar(url: String, destino: ImageView, listo: (() -> Unit)? = null) {
        imagenes[url]?.let { destino.setImageBitmap(it); listo?.invoke(); return }
        destino.tag = url
        descargas.execute {
            val bitmap = runCatching { URL(url).openStream().use { BitmapFactory.decodeStream(it) } }.getOrNull() ?: return@execute
            runOnUiThread {
                imagenes[url] = bitmap
                if (destino.tag == url) {
                    destino.alpha = 0f
                    destino.setImageBitmap(bitmap)
                    destino.animate().alpha(if (destino === fondoImagen) 0.8f else 1f).setDuration(300).start()
                    listo?.invoke()
                }
            }
        }
    }

    // ---------- Elegir la TV ----------

    private fun elegirTV() {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(22.dp, 8.dp, 22.dp, 0) }
        val campo = EditText(this).apply {
            hint = "IP de la TV (p. ej. 192.168.1.50)"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText(tv.ip)
        }
        col.addView(campo)
        val encontradas = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val buscar = texto("Buscar en esta red", 15f, true, 0xFF0A84FF.toInt()).apply { setPadding(0, 14.dp, 0, 6.dp) }
        buscar.setOnClickListener {
            buscar.text = "Buscando…"
            tv.buscar { lista ->
                buscar.text = if (lista.isEmpty()) "No encontré ninguna TV. Buscar otra vez" else "Buscar otra vez"
                encontradas.removeAllViews()
                lista.forEach { ip -> encontradas.addView(texto("📺  $ip", 16f).apply {
                    setPadding(0, 10.dp, 0, 10.dp); setOnClickListener { campo.setText(ip) }
                }) }
            }
        }
        col.addView(buscar)
        col.addView(encontradas)
        col.addView(texto("La primera vez la TV pregunta si permites el acceso: acéptalo con el mando.", 12f, color = 0x99FFFFFF.toInt()).apply {
            setPadding(0, 12.dp, 0, 0)
        })
        val dialogo = AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Televisor").setView(col)
            .setPositiveButton("Conectar") { _, _ ->
                tv.ip = campo.text.toString().trim()
                tv.conectar()
            }
            .setNegativeButton("Cerrar", null)
        if (tv.ip.isNotEmpty()) dialogo.setNeutralButton("Olvidar") { _, _ -> tv.olvidar() }
        dialogo.show()
    }
}

