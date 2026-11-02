package com.tvlibre.mando

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.RenderEffect
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextUtils
import android.text.TextWatcher
import android.text.method.DigitsKeyListener
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.Window
import android.view.WindowInsets
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import android.net.Uri
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

// Colores al estilo de iOS: blanco con transparencias sobre la foto difuminada
private val TEXTO = Color.WHITE
private val TEXTO_2 = 0xB3FFFFFF.toInt()
private val TEXTO_3 = 0x73FFFFFF.toInt()
private val VERDE = 0xFF30D158.toInt()
private val AMARILLO = 0xFFFFD60A.toInt()
private val ROJO = 0xFFFF453A.toInt()
private val AZUL = 0xFF0A84FF.toInt()
private const val ENLACE_APK = "https://github.com/OlaiFG7/tv-libre/releases/download/mando/TVLibreMando.apk"
private const val ENLACE_VERSION = "https://github.com/OlaiFG7/tv-libre/releases/download/mando/version.json"

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
    private lateinit var encenderFondo: GradientDrawable
    private lateinit var encenderIcono: ImageView
    private lateinit var contenido: FrameLayout
    private var latido: ObjectAnimator? = null
    private var pestana = 0
    private val prefs by lazy { getSharedPreferences("app", MODE_PRIVATE) }
    private val descargas = Executors.newFixedThreadPool(3)
    private val imagenes = HashMap<String, Bitmap>()
    private val tarjetas = HashMap<String, Pair<GradientDrawable, View>>()   // fondo → (borde, marca de elegido)
    private val vistas = arrayOfNulls<View>(3)   // las pestañas ya hechas: cambiar de pestaña no las rehace
    private lateinit var ahoraIcono: ImageView
    private lateinit var novedad: View
    @Suppress("DEPRECATION")
    private val version: Long get() = runCatching {
        val info = packageManager.getPackageInfo(packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    }.getOrDefault(0L)

    private val Int.dp get() = (this * resources.displayMetrics.density).toInt()
    private val Float.dp get() = this * resources.displayMetrics.density
    private val anchoUtil get() = resources.displayMetrics.widthPixels - 40.dp

    override fun onCreate(estado: Bundle?) {
        super.onCreate(estado)
        tv = TV(this) { refrescar() }
        pantallaCompleta()
        setContentView(construir())
        ponerFondo(prefs.getString("fondo", "montanas-amanecer")!!)
        mostrar(0)
        if (tv.ip.isEmpty()) elegirTV()
        buscarNovedad()
    }

    // Conecta solo mientras se ve: nada en segundo plano
    override fun onResume() { super.onResume(); if (tv.ip.isNotEmpty()) tv.conectar() }
    override fun onPause() { super.onPause(); tv.desconectar() }

    @Suppress("DEPRECATION")
    private fun pantallaCompleta() {
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
    }

    /** Lo que ocupan arriba la barra de estado y abajo la de navegación (o el teclado). */
    @Suppress("DEPRECATION")
    private fun margenes(ins: WindowInsets): Pair<Int, Int> =
        if (Build.VERSION.SDK_INT >= 30) ins.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime()).let { it.top to it.bottom }
        else ins.systemWindowInsetTop to ins.systemWindowInsetBottom

    // ---------- Piezas ----------

    private fun fuente(peso: Int): Typeface =
        if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, peso, false)
        else Typeface.create(if (peso >= 500) "sans-serif-medium" else "sans-serif", if (peso >= 700) Typeface.BOLD else Typeface.NORMAL)

    private fun texto(t: String, tam: Float = 15f, peso: Int = 400, color: Int = TEXTO) = TextView(this).apply {
        text = t; textSize = tam; setTextColor(color); typeface = fuente(peso); includeFontPadding = false
    }

    private fun icono(res: Int, color: Int = TEXTO) = ImageView(this).apply {
        setImageResource(res); imageTintList = ColorStateList.valueOf(color)
    }

    private fun vidrio(radio: Float, alfa: Int = 0x1F, borde: Int = 0x2E) = GradientDrawable().apply {
        setColor(Color.argb(alfa, 255, 255, 255)); cornerRadius = radio.dp; setStroke(1.dp, Color.argb(borde, 255, 255, 255))
    }

    /** Botón redondo de vidrio: un poco más claro arriba, como si le diera la luz. */
    private fun circulo(alfa: Int = 0x24) = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
        intArrayOf(Color.argb(min(255, alfa + 0x14), 255, 255, 255), Color.argb(alfa, 255, 255, 255))).apply {
        shape = GradientDrawable.OVAL; setStroke(1.dp, 0x33FFFFFF)
    }

    private fun pulso(v: View) = v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)

    /** Se hunde un poco al tocarlo y rebota al soltar, como los botones de iOS. */
    @SuppressLint("ClickableViewAccessibility")
    private fun <T : View> T.pulsable(escala: Float = 0.92f, accion: () -> Unit): T {
        setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> v.animate().scaleX(escala).scaleY(escala).setDuration(90).setInterpolator(DecelerateInterpolator()).start()
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL ->
                    v.animate().scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(OvershootInterpolator(3f)).start()
            }
            false
        }
        setOnClickListener { pulso(it); accion() }
        return this
    }

    private fun botonRedondo(res: Int, tam: Int, nombre: String, accion: () -> Unit) = FrameLayout(this).apply {
        background = circulo()
        contentDescription = nombre
        addView(icono(res), FrameLayout.LayoutParams((tam * 0.38f).toInt().dp, (tam * 0.38f).toInt().dp, Gravity.CENTER))
        pulsable { accion() }
    }

    /** Botón ancho de las hojas: el principal, blanco relleno; los demás, de vidrio. */
    private fun boton(t: String, principal: Boolean = false, color: Int = TEXTO, accion: () -> Unit) =
        texto(t, 16f, 600, if (principal) Color.BLACK else color).apply {
            gravity = Gravity.CENTER
            background = if (principal) GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = 26f.dp } else vidrio(26f, 0x1F, 0x24)
            pulsable(0.96f) { accion() }
        }

    private fun titulo(t: String) = texto(t, 21f, 700).apply { letterSpacing = -0.01f; setPadding(2.dp, 22.dp, 0, 12.dp) }

    /** Control segmentado con la pastilla que se desliza hasta la opción elegida. */
    private fun segmentos(opciones: List<String>, elegido: Int, alto: Int, alElegir: (Int) -> Unit): View {
        val marco = FrameLayout(this).apply { background = vidrio(alto / 2f, 0x1A, 0x24); setPadding(3.dp, 3.dp, 3.dp, 3.dp) }
        val ancho = (anchoUtil - 6.dp) / opciones.size
        val pastilla = View(this).apply {
            background = GradientDrawable().apply { setColor(0x3DFFFFFF); cornerRadius = (alto / 2f - 3f).dp }
            translationX = (elegido * ancho).toFloat()
        }
        marco.addView(pastilla, FrameLayout.LayoutParams(ancho, -1))
        val fila = LinearLayout(this)
        val etiquetas = opciones.mapIndexed { i, nombre ->
            texto(nombre, 14f, 600, if (i == elegido) TEXTO else TEXTO_2).apply { gravity = Gravity.CENTER }
        }
        etiquetas.forEachIndexed { i, t ->
            t.setOnClickListener {
                pulso(it)
                pastilla.animate().translationX((i * ancho).toFloat()).setDuration(320).setInterpolator(OvershootInterpolator(0.9f)).start()
                etiquetas.forEachIndexed { j, o -> o.setTextColor(if (j == i) TEXTO else TEXTO_2) }
                alElegir(i)
            }
            fila.addView(t, LinearLayout.LayoutParams(0, -1, 1f))
        }
        marco.addView(fila, FrameLayout.LayoutParams(-1, -1))
        return marco
    }

    private fun campoTexto(pista: String, res: Int): Pair<View, EditText> {
        val marco = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(16.dp, 0, 16.dp, 0); background = vidrio(16f, 0x1A, 0x2E) }
        marco.addView(icono(res, TEXTO_3), LinearLayout.LayoutParams(20.dp, 20.dp).apply { rightMargin = 12.dp })
        val campo = EditText(this).apply {
            hint = pista; setHintTextColor(TEXTO_3); setTextColor(TEXTO); textSize = 17f; typeface = fuente(500)
            background = null; isSingleLine = true; setPadding(0, 0, 0, 0)
        }
        marco.addView(campo, LinearLayout.LayoutParams(0, -1, 1f))
        return marco to campo
    }

    /** Hoja que sube desde abajo, de vidrio oscuro (en Android 12+ con el fondo difuminado detrás). */
    private fun hoja(titulo: String, cuerpo: View): Dialog {
        val d = Dialog(this)
        d.requestWindowFeature(Window.FEATURE_NO_TITLE)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(0xEB1C1C20.toInt())
                val r = 28f.dp
                cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
            }
            setPadding(22.dp, 10.dp, 22.dp, 24.dp)
            setOnApplyWindowInsetsListener { v, ins -> v.setPadding(22.dp, 10.dp, 22.dp, 24.dp + margenes(ins).second); ins }
        }
        panel.addView(View(this).apply { background = GradientDrawable().apply { setColor(0x4DFFFFFF); cornerRadius = 3f.dp } },
            LinearLayout.LayoutParams(36.dp, 5.dp).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = 16.dp })
        panel.addView(texto(titulo, 24f, 700).apply { letterSpacing = -0.01f },
            LinearLayout.LayoutParams(-2, -2).apply { bottomMargin = 18.dp })
        panel.addView(cuerpo)
        d.setContentView(panel)
        d.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setLayout(-1, -2)
            setGravity(Gravity.BOTTOM)
            setWindowAnimations(android.R.style.Animation_InputMethod)
            setDimAmount(0.5f)
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            if (Build.VERSION.SDK_INT >= 31) {
                addFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND)
                attributes = attributes.apply { blurBehindRadius = 40.dp }
            }
        }
        return d
    }

    // ---------- Estructura ----------

    private fun construir(): View {
        val raiz = FrameLayout(this)
        fondoImagen = ImageView(this).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            if (Build.VERSION.SDK_INT >= 31) setRenderEffect(RenderEffect.createBlurEffect(90f, 90f, Shader.TileMode.CLAMP))
            alpha = 0.85f
        }
        raiz.addView(fondoImagen, FrameLayout.LayoutParams(-1, -1))
        raiz.addView(View(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x40000000, 0x59000000, 0xBF000000.toInt()))
        }, FrameLayout.LayoutParams(-1, -1))

        val columna = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20.dp, 48.dp, 20.dp, 24.dp)
            setOnApplyWindowInsetsListener { v, ins ->
                val (arriba, abajo) = margenes(ins)
                v.setPadding(20.dp, arriba + 14.dp, 20.dp, abajo + 18.dp); ins
            }
        }
        columna.addView(cabecera())
        novedad = LinearLayout(this).apply {
            visibility = View.GONE; gravity = Gravity.CENTER_VERTICAL; setPadding(16.dp, 0, 14.dp, 0)
            background = GradientDrawable().apply { setColor(0x330A84FF); cornerRadius = 18f.dp; setStroke(1.dp, 0x660A84FF) }
            addView(texto("Hay una versión nueva del mando", 14f, 600), LinearLayout.LayoutParams(0, -2, 1f))
            addView(texto("Actualizar", 14f, 700, 0xFF64B5FF.toInt()))
            pulsable(0.97f) { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(ENLACE_APK))) }
        }
        columna.addView(novedad, LinearLayout.LayoutParams(-1, 46.dp).apply { topMargin = 14.dp })
        columna.addView(segmentos(listOf("Mando", "Apps", "Fondos"), 0, 42) { if (it == 1) tv.pedirDisposicion(); mostrar(it) },
            LinearLayout.LayoutParams(-1, 42.dp).apply { topMargin = 20.dp; bottomMargin = 16.dp })
        contenido = FrameLayout(this)
        columna.addView(contenido, LinearLayout.LayoutParams(-1, 0, 1f))
        raiz.addView(columna, FrameLayout.LayoutParams(-1, -1))
        return raiz
    }

    private fun cabecera(): View {
        val fila = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        val textos = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        textos.addView(texto("TV Libre", 32f, 700).apply { letterSpacing = -0.02f })

        // La pastilla de estado: punto de color, IP o aviso, y una flecha que invita a cambiar de TV
        val estado = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL; setPadding(11.dp, 0, 8.dp, 0); background = vidrio(15f, 0x1A, 0x24)
        }
        estadoPunto = View(this).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.GRAY) } }
        estado.addView(estadoPunto, LinearLayout.LayoutParams(8.dp, 8.dp).apply { rightMargin = 8.dp })
        ahoraIcono = ImageView(this).apply {
            visibility = View.GONE; clipToOutline = true
            background = GradientDrawable().apply { cornerRadius = 5f.dp; setColor(0x33FFFFFF) }
        }
        estado.addView(ahoraIcono, LinearLayout.LayoutParams(18.dp, 18.dp).apply { rightMargin = 7.dp })
        estadoTexto = texto("", 13f, 500, TEXTO_2).apply {
            maxLines = 1; ellipsize = TextUtils.TruncateAt.END; maxWidth = resources.displayMetrics.widthPixels - 150.dp
        }
        estado.addView(estadoTexto)
        estado.addView(icono(R.drawable.ic_abajo, TEXTO_3), LinearLayout.LayoutParams(18.dp, 18.dp).apply { leftMargin = 2.dp })
        estado.pulsable(0.96f) { elegirTV() }
        textos.addView(estado, LinearLayout.LayoutParams(-2, 30.dp).apply { topMargin = 8.dp })
        fila.addView(textos, LinearLayout.LayoutParams(0, -2, 1f))

        encenderFondo = circulo()
        val encender = FrameLayout(this).apply { background = encenderFondo; contentDescription = "Encender o apagar la TV" }
        encenderIcono = icono(R.drawable.ic_encender)
        encender.addView(encenderIcono, FrameLayout.LayoutParams(24.dp, 24.dp, Gravity.CENTER))
        encender.pulsable {
            when {
                tv.estado == TV.Estado.CONECTADA -> tv.apagar()
                tv.puedeEncender -> { tv.encender(); estadoTexto.text = "Encendiendo la TV…" }
                else -> Toast.makeText(this, "Conecta una vez con la TV encendida para poder encenderla desde aquí", Toast.LENGTH_LONG).show()
            }
        }
        fila.addView(encender, LinearLayout.LayoutParams(54.dp, 54.dp))
        return fila
    }

    private fun mostrar(i: Int) {
        val antes = pestana
        pestana = i
        contenido.removeAllViews()
        // El mando y los fondos se hacen una vez; las apps, cuando cambian (ver refrescar)
        val vista = vistas[i]?.takeIf { i != 1 || it.tag == tv.firmaApps } ?: when (i) { 0 -> mando(); 1 -> apps(); else -> fondos() }
        vistas[i] = vista
        vista.alpha = 0f
        vista.translationX = when { i > antes -> 28f.dp; i < antes -> -28f.dp; else -> 0f }
        contenido.addView(vista, FrameLayout.LayoutParams(-1, -1))
        vista.animate().alpha(1f).translationX(0f).setDuration(280).setInterpolator(DecelerateInterpolator(2f)).start()
        refrescar()
    }

    private fun refrescar() {
        val (color, t) = when (tv.estado) {
            TV.Estado.SIN_TV -> Color.GRAY to "Elegir televisor"
            TV.Estado.CONECTANDO -> AMARILLO to "Conectando con ${tv.ip}…"
            TV.Estado.ESPERANDO_PERMISO -> AMARILLO to "Acepta el aviso en la TV"
            TV.Estado.CONECTADA -> VERDE to (tv.queSeVe()?.let { "Ahora: ${it.first}" } ?: "Conectada · ${tv.ip}")
            TV.Estado.ERROR -> ROJO to tv.error
        }
        (estadoPunto.background as GradientDrawable).setColor(color)
        estadoTexto.text = t
        val icono = tv.queSeVe()?.second.takeIf { tv.estado == TV.Estado.CONECTADA }
        ahoraIcono.visibility = if (icono != null) View.VISIBLE else View.GONE
        if (icono != null) cargar(icono, ahoraIcono, 64)
        // El punto late mientras se espera a la TV
        val esperando = tv.estado == TV.Estado.CONECTANDO || tv.estado == TV.Estado.ESPERANDO_PERMISO
        if (esperando && latido == null) {
            latido = ObjectAnimator.ofFloat(estadoPunto, View.ALPHA, 1f, 0.25f).apply {
                duration = 700; repeatMode = ValueAnimator.REVERSE; repeatCount = ValueAnimator.INFINITE; start()
            }
        } else if (!esperando) { latido?.cancel(); latido = null; estadoPunto.alpha = 1f }
        // Encender: rojo si se puede apagar, verde si se puede encender, apagado si aún no se sabe su MAC
        when {
            tv.estado == TV.Estado.CONECTADA -> { encenderFondo.setColor(0x38FF453A); encenderIcono.imageTintList = ColorStateList.valueOf(0xFFFF6B61.toInt()) }
            tv.puedeEncender -> { encenderFondo.setColor(0x2E30D158); encenderIcono.imageTintList = ColorStateList.valueOf(VERDE) }
            else -> { encenderFondo.setColor(0x1AFFFFFF); encenderIcono.imageTintList = ColorStateList.valueOf(TEXTO_3) }
        }
        if (pestana == 1 && contenido.childCount > 0 && contenido.getChildAt(0).tag != tv.firmaApps) mostrar(1)
    }

    // ---------- Mando ----------

    private fun mando(): View {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(trackpad(), LinearLayout.LayoutParams(-1, 0, 1f))

        // Como el mando del Apple TV: dos columnas de botones redondos y una pastilla alta para avanzar y retroceder
        // (el volumen no: con una barra de sonido por óptico la TV no lo controla)
        val tam = 66
        val bloque = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(6.dp, 20.dp, 6.dp, 0) }
        fun hueco() = bloque.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
        fun columna(vararg botones: View) = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            botones.forEachIndexed { i, b -> addView(b, LinearLayout.LayoutParams(tam.dp, tam.dp).apply { if (i > 0) topMargin = 14.dp }) }
        }
        bloque.addView(columna(
            botonRedondo(R.drawable.ic_atras, tam, "Atrás") { tv.boton("BACK") },
            botonRedondo(R.drawable.ic_teclado, tam, "Teclado") { teclado() }
        )); hueco()
        bloque.addView(columna(
            botonRedondo(R.drawable.ic_inicio, tam, "TV Libre") { tv.inicio() },   // TV Libre, no el inicio de LG
            botonRedondo(R.drawable.ic_play_pausa, tam, "Reproducir o pausar") { tv.boton("PLAY") }
        )); hueco()
        bloque.addView(avance(), LinearLayout.LayoutParams(tam.dp, (tam * 2 + 14).dp))
        col.addView(bloque)

        val colores = LinearLayout(this).apply { setPadding(0, 20.dp, 0, 0) }
        val lista = listOf("RED" to 0xFFFF453A, "GREEN" to 0xFF30D158, "YELLOW" to 0xFFFFD60A, "BLUE" to 0xFF0A84FF)
        lista.forEachIndexed { i, (nombre, color) ->
            val boton = FrameLayout(this).apply { background = vidrio(20f, 0x1A, 0x24); contentDescription = "Botón $nombre" }
            boton.addView(View(this).apply {
                background = GradientDrawable().apply { setColor(color.toInt()); cornerRadius = 4f.dp }
            }, FrameLayout.LayoutParams(26.dp, 8.dp, Gravity.CENTER))
            boton.pulsable(0.94f) { tv.boton(nombre) }
            colores.addView(boton, LinearLayout.LayoutParams(0, 40.dp, 1f).apply { if (i < lista.size - 1) rightMargin = 10.dp })
        }
        col.addView(colores)
        return col
    }

    private fun avance(): View {
        val pastilla = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x38FFFFFF, 0x24FFFFFF)).apply {
                cornerRadius = 33f.dp; setStroke(1.dp, 0x33FFFFFF)
            }
        }
        fun parte(res: Int, nombre: String, boton: String) = FrameLayout(this).apply {
            contentDescription = nombre
            addView(icono(res), FrameLayout.LayoutParams(26.dp, 26.dp, Gravity.CENTER))
            pulsable(0.85f) { tv.boton(boton) }
        }
        pastilla.addView(parte(R.drawable.ic_adelante, "Avanzar", "FASTFORWARD"), LinearLayout.LayoutParams(-1, 0, 1f))
        pastilla.addView(View(this).apply { setBackgroundColor(0x24FFFFFF) }, LinearLayout.LayoutParams(-1, 1.dp).apply { leftMargin = 18.dp; rightMargin = 18.dp })
        pastilla.addView(parte(R.drawable.ic_atras_rapido, "Retroceder", "REWIND"), LinearLayout.LayoutParams(-1, 0, 1f))
        return pastilla
    }

    /**
     * Deslizar = flechas: una cada vez que el dedo recorre un tramo, así un deslizamiento largo avanza varias
     * casillas, y si se suelta rápido sigue unas cuantas más, frenando (inercia). Tocar sin moverse = OK y mantener
     * = mantener OK (en TV Libre, coger la app para moverla). Un brillo sigue al dedo y se ilumina la flecha.
     */
    @SuppressLint("ClickableViewAccessibility")
    private fun trackpad(): View {
        val panel = FrameLayout(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x2BFFFFFF, 0x12FFFFFF)).apply {
                cornerRadius = 36f.dp; setStroke(1.dp, 0x33FFFFFF)
            }
            clipToOutline = true
            contentDescription = "Trackpad: desliza para moverte, toca para OK"
        }
        val brillo = View(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL; gradientType = GradientDrawable.RADIAL_GRADIENT; gradientRadius = 75f.dp
                colors = intArrayOf(0x5CFFFFFF, 0x00FFFFFF)
            }
            alpha = 0f
        }
        panel.addView(brillo, FrameLayout.LayoutParams(150.dp, 150.dp))
        val flechas = HashMap<String, ImageView>()
        for ((nombre, res, sitio) in listOf(
            Triple("UP", R.drawable.ic_arriba, Gravity.TOP or Gravity.CENTER_HORIZONTAL),
            Triple("DOWN", R.drawable.ic_abajo, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL),
            Triple("LEFT", R.drawable.ic_izquierda, Gravity.START or Gravity.CENTER_VERTICAL),
            Triple("RIGHT", R.drawable.ic_derecha, Gravity.END or Gravity.CENTER_VERTICAL)
        )) {
            val f = icono(res).apply { alpha = 0.2f }
            panel.addView(f, FrameLayout.LayoutParams(28.dp, 28.dp, sitio).apply { setMargins(14.dp, 14.dp, 14.dp, 14.dp) })
            flechas[nombre] = f
        }
        val pista = texto("Desliza para moverte\nToca para OK · mantén para coger", 14f, 500, TEXTO_3).apply { gravity = Gravity.CENTER; setLineSpacing(4f.dp, 1f) }
        panel.addView(pista, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))

        fun destello(nombre: String) {
            val f = flechas[nombre] ?: return
            f.animate().cancel(); f.alpha = 1f; f.scaleX = 1.25f; f.scaleY = 1.25f
            f.animate().alpha(0.2f).scaleX(1f).scaleY(1f).setDuration(420).start()
        }
        fun direccion(dx: Float, dy: Float) = if (abs(dx) > abs(dy)) (if (dx > 0) "RIGHT" else "LEFT") else (if (dy > 0) "DOWN" else "UP")
        fun soltar() {
            brillo.animate().alpha(0f).setDuration(260).start()
            pista.animate().alpha(1f).setDuration(400).setStartDelay(600).start()
        }

        var x0 = 0f; var y0 = 0f; var xInicio = 0f; var yInicio = 0f; var movido = false
        var ultima = "RIGHT"
        val tramo = 46.dp
        val reloj = Handler(Looper.getMainLooper())
        var velocidad: VelocityTracker? = null
        val mantener = Runnable {
            movido = true   // al soltar ya no es un OK
            panel.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            brillo.animate().scaleX(1.6f).scaleY(1.6f).setDuration(200).start()
            tv.mantenerOk()
        }
        fun inercia(pasos: Int) {
            var espera = 0L
            for (k in 1..pasos) {
                espera += 55L + k * 25L   // cada vez un poco más despacio, como un objeto que frena
                reloj.postDelayed({ tv.boton(ultima); destello(ultima); if (k == 1) pulso(panel) }, espera)
            }
        }
        panel.setOnTouchListener { v, e ->
            velocidad?.addMovement(e)
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    reloj.removeCallbacksAndMessages(null)   // un toque para la inercia que quedara
                    velocidad?.recycle(); velocidad = VelocityTracker.obtain().apply { addMovement(e) }
                    reloj.postDelayed(mantener, 520)
                    brillo.scaleX = 1f; brillo.scaleY = 1f
                    x0 = e.x; y0 = e.y; xInicio = e.x; yInicio = e.y; movido = false
                    brillo.translationX = e.x - 75.dp; brillo.translationY = e.y - 75.dp
                    brillo.animate().alpha(1f).setDuration(120).start()
                    pista.animate().alpha(0f).setDuration(150).setStartDelay(0).start()
                }
                MotionEvent.ACTION_MOVE -> {
                    brillo.translationX = e.x - 75.dp; brillo.translationY = e.y - 75.dp
                    val dx = e.x - x0; val dy = e.y - y0
                    if (max(abs(e.x - xInicio), abs(e.y - yInicio)) > 14.dp) reloj.removeCallbacks(mantener)
                    if (max(abs(dx), abs(dy)) > tramo) {
                        val d = direccion(dx, dy)
                        pulso(v); tv.boton(d); destello(d)
                        x0 = e.x; y0 = e.y; movido = true; ultima = d
                    }
                }
                MotionEvent.ACTION_UP -> {
                    reloj.removeCallbacks(mantener)
                    soltar()
                    val dx = e.x - xInicio; val dy = e.y - yInicio
                    val vt = velocidad?.apply { computeCurrentVelocity(1000) }
                    // Soltar rápido en la misma dirección: unos pasos más (hasta 5), según lo rápido que iba el dedo
                    if (movido && vt != null) {
                        val rapidez = max(abs(vt.xVelocity), abs(vt.yVelocity)) / resources.displayMetrics.density
                        if (rapidez > 900 && direccion(vt.xVelocity, vt.yVelocity) == ultima) inercia(min(5, ((rapidez - 600) / 500).toInt()))
                    }
                    velocidad?.recycle(); velocidad = null
                    if (!movido) {
                        if (abs(dx) < 14.dp && abs(dy) < 14.dp) {
                            v.performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY)
                            tv.boton("ENTER")
                            v.animate().scaleX(0.97f).scaleY(0.97f).setDuration(70)
                                .withEndAction { v.animate().scaleX(1f).scaleY(1f).setDuration(240).setInterpolator(OvershootInterpolator(3f)).start() }.start()
                        } else {
                            val d = direccion(dx, dy)
                            pulso(v); tv.boton(d); destello(d)
                        }
                    }
                    v.performClick()
                }
                MotionEvent.ACTION_CANCEL -> { reloj.removeCallbacks(mantener); velocidad?.recycle(); velocidad = null; soltar() }
            }
            true
        }
        return panel
    }

    /** Lo que se escribe aparece en el campo de texto que tenga el foco en la TV. */
    private fun teclado() {
        var ultimo = ""
        val cuerpo = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val (marco, campo) = campoTexto("Escribe en la TV…", R.drawable.ic_teclado)
        campo.imeOptions = EditorInfo.IME_ACTION_SEARCH
        campo.inputType = InputType.TYPE_CLASS_TEXT
        campo.addTextChangedListener(object : TextWatcher {
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
        campo.setOnEditorActionListener { _, _, _ -> tv.intro(); ultimo = ""; campo.setText(""); true }
        cuerpo.addView(marco, LinearLayout.LayoutParams(-1, 56.dp))
        val d = hoja("Escribir en la TV", cuerpo)
        val botones = LinearLayout(this).apply { setPadding(0, 16.dp, 0, 0) }
        botones.addView(boton("Intro") { tv.intro(); ultimo = ""; campo.setText("") }, LinearLayout.LayoutParams(0, 52.dp, 1f).apply { rightMargin = 10.dp })
        botones.addView(boton("Buscar en YouTube", principal = true) {
            val q = campo.text.toString().trim()
            if (q.isNotEmpty()) { tv.buscarEnYouTube(q); d.dismiss() }
        }, LinearLayout.LayoutParams(0, 52.dp, 1.6f))
        cuerpo.addView(botones)
        d.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
        d.show()
        campo.requestFocus()
    }

    // ---------- Apps y entradas ----------

    /** Como la pantalla de TV Libre: el dock de favoritas, debajo el resto de apps y al final las entradas. */
    private fun apps(): View {
        val scroll = ScrollView(this).apply { tag = tv.firmaApps; isVerticalScrollBarEnabled = false }
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, 0, 0, 16.dp) }
        scroll.addView(col)
        if (tv.apps.isEmpty()) {
            // Sin apps todavía: un aviso centrado en vez de una pantalla vacía
            val vacio = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(0, 70.dp, 0, 0) }
            vacio.addView(icono(R.drawable.ic_tv, TEXTO_3), LinearLayout.LayoutParams(56.dp, 56.dp))
            vacio.addView(texto(if (tv.estado == TV.Estado.CONECTADA) "Cargando apps…" else "Conecta con la TV para ver sus apps",
                15f, 500, TEXTO_2).apply { gravity = Gravity.CENTER; setPadding(0, 14.dp, 0, 0) })
            col.addView(vacio, LinearLayout.LayoutParams(-1, -2))
            return scroll
        }
        val (favoritas, resto) = tv.filas()
        val comoLaTV = tv.disposicion != null

        col.addView(seccion("Favoritas", comoLaTV, primera = true))
        val dock = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(6.dp, 14.dp, 6.dp, 0)
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0x2EFFFFFF, 0x17FFFFFF)).apply {
                cornerRadius = 28f.dp; setStroke(1.dp, 0x33FFFFFF)
            }
        }
        if (favoritas.isEmpty()) dock.addView(texto("No hay favoritas en la TV", 14f, 500, TEXTO_3).apply {
            gravity = Gravity.CENTER; setPadding(0, 10.dp, 0, 24.dp)
        }, LinearLayout.LayoutParams(-1, -2))
        else dock.addView(rejillaApps(favoritas, anchoUtil - 12.dp, 64))
        col.addView(dock, LinearLayout.LayoutParams(-1, -2))

        if (resto.isNotEmpty()) {
            col.addView(seccion("Otras apps"))
            col.addView(rejillaApps(resto, anchoUtil, 58))
        }

        val entradas = listOf(EntradaTV("com.webos.app.livetv", "TV")) + tv.entradas
        col.addView(seccion("Entradas"))
        val rejilla = GridLayout(this).apply { columnCount = 2 }
        val separacion = 10.dp
        val ancho = (anchoUtil - separacion) / 2
        entradas.forEachIndexed { i, e ->
            val tarjeta = LinearLayout(this).apply {
                gravity = Gravity.CENTER_VERTICAL; setPadding(10.dp, 0, 12.dp, 0); background = vidrio(20f, 0x1F, 0x2E)
                val circuloIcono = FrameLayout(this@Principal).apply { background = circulo(0x26) }
                circuloIcono.addView(icono(if (i == 0) R.drawable.ic_tv else R.drawable.ic_entrada), FrameLayout.LayoutParams(18.dp, 18.dp, Gravity.CENTER))
                addView(circuloIcono, LinearLayout.LayoutParams(36.dp, 36.dp).apply { rightMargin = 10.dp })
                addView(texto(e.nombre, 15f, 600).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END }, LinearLayout.LayoutParams(0, -2, 1f))
                pulsable(0.96f) { if (i == 0) tv.abrir(e.id) else tv.entrada(e.id) }
            }
            rejilla.addView(tarjeta, GridLayout.LayoutParams().apply {
                width = ancho; height = 58.dp
                setMargins(0, 0, if (i % 2 == 0) separacion else 0, separacion)
            })
        }
        col.addView(rejilla)

        col.addView(texto(
            if (comoLaTV) "Las favoritas, el orden y las apps ocultas son los de la TV. Para cambiarlos, en la TV mantén OK sobre una app."
            else "Abre TV Libre en la TV con la app abierta y aquí verás tus favoritas y apps ocultas tal como las tienes.",
            12.5f, 400, TEXTO_3
        ).apply { gravity = Gravity.CENTER; setPadding(12.dp, 14.dp, 12.dp, 0); setLineSpacing(3f.dp, 1f) }, LinearLayout.LayoutParams(-1, -2))
        return scroll
    }

    /** Título de sección; con la TV sincronizada, la de favoritas lleva una etiqueta que lo dice. */
    private fun seccion(t: String, comoLaTV: Boolean = false, primera: Boolean = false): View {
        val fila = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(2.dp, if (primera) 4.dp else 24.dp, 0, 12.dp) }
        fila.addView(texto(t, 21f, 700).apply { letterSpacing = -0.01f }, LinearLayout.LayoutParams(0, -2, 1f))
        if (comoLaTV) fila.addView(LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL; setPadding(8.dp, 0, 10.dp, 0); background = vidrio(12f, 0x1A, 0x24)
            addView(icono(R.drawable.ic_check, VERDE), LinearLayout.LayoutParams(14.dp, 14.dp).apply { rightMargin = 5.dp })
            addView(texto("Como en la TV", 12f, 600, TEXTO_2))
        }, LinearLayout.LayoutParams(-2, 26.dp))
        return fila
    }

    /** Rejilla de 4 columnas con el icono de cada app sobre su color, como las tarjetas del dock de la TV. */
    private fun rejillaApps(lista: List<AppTV>, ancho: Int, tam: Int): View {
        val rejilla = GridLayout(this).apply { columnCount = 4 }
        lista.forEach { app ->
            val celda = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
                setPadding(3.dp, 0, 3.dp, 16.dp)
            }
            val color = app.color?.let { runCatching { Color.parseColor(it) }.getOrNull() }
            val cara = FrameLayout(this).apply {
                background = GradientDrawable().apply {
                    if (color != null) {
                        // Un poco más claro arriba, como la luz de las tarjetas de la TV
                        colors = intArrayOf(mezclar(color, Color.WHITE, 0.12f), color)
                        orientation = GradientDrawable.Orientation.TOP_BOTTOM
                    } else setColor(0x24FFFFFF)
                    cornerRadius = (tam * 0.28f).dp; setStroke(1.dp, 0x29FFFFFF)
                }
                clipToOutline = true
                if (color != null) elevation = 8f.dp
            }
            val inicial = texto(app.nombre.take(1), tam * 0.4f, 700).apply { gravity = Gravity.CENTER }
            cara.addView(inicial, FrameLayout.LayoutParams(-1, -1))
            app.icono?.let { url ->
                val img = ImageView(this).apply { val m = (tam * 0.17f).toInt().dp; setPadding(m, m, m, m) }
                cara.addView(img, FrameLayout.LayoutParams(-1, -1))
                cargar(url, img) { inicial.visibility = View.GONE }
            }
            celda.addView(cara, LinearLayout.LayoutParams(tam.dp, tam.dp))
            celda.addView(texto(app.nombre, 12f, 500, TEXTO_2).apply {
                maxLines = 1; ellipsize = TextUtils.TruncateAt.END; gravity = Gravity.CENTER; setPadding(0, 8.dp, 0, 0)
            }, LinearLayout.LayoutParams(-1, -2))
            celda.pulsable(0.9f) { tv.abrir(app) }
            rejilla.addView(celda, GridLayout.LayoutParams().apply { width = ancho / 4 })
        }
        return rejilla
    }

    private fun mezclar(a: Int, b: Int, t: Float) = Color.rgb(
        (Color.red(a) + (Color.red(b) - Color.red(a)) * t).toInt(),
        (Color.green(a) + (Color.green(b) - Color.green(a)) * t).toInt(),
        (Color.blue(a) + (Color.blue(b) - Color.blue(a)) * t).toInt()
    )

    // ---------- Fondos ----------

    private fun fondos(): View {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, 0, 0, 12.dp) }
        col.addView(titulo("Tema").apply { setPadding(2.dp, 4.dp, 0, 12.dp) })
        val temas = listOf("auto" to "Automático", "claro" to "Claro", "oscuro" to "Oscuro")
        val elegido = temas.indexOfFirst { it.first == prefs.getString("tema", "auto") }.coerceAtLeast(0)
        col.addView(segmentos(temas.map { it.second }, elegido, 40) { i ->
            prefs.edit().putString("tema", temas[i].first).apply(); tv.tema(temas[i].first)
        }, LinearLayout.LayoutParams(-1, 40.dp))

        tarjetas.clear()
        val actual = prefs.getString("fondo", "")
        val separacion = 12.dp
        val ancho = (anchoUtil - separacion) / 2
        tv.fondos.groupBy { it.grupo }.forEach { (grupo, lista) ->
            col.addView(titulo(grupo))
            val rejilla = GridLayout(this).apply { columnCount = 2 }
            lista.forEachIndexed { i, f ->
                val tarjeta = FrameLayout(this).apply {
                    clipToOutline = true
                    background = GradientDrawable().apply {
                        cornerRadius = 16f.dp
                        if (f.colores.size >= 2) { colors = f.colores.map { Color.parseColor(it) }.toIntArray(); orientation = GradientDrawable.Orientation.TL_BR }
                        else setColor(0x14FFFFFF)
                    }
                }
                f.miniatura?.let { url ->
                    val img = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
                    tarjeta.addView(img, FrameLayout.LayoutParams(-1, -1))
                    cargar(url, img)
                }
                tarjeta.addView(View(this).apply {
                    background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0, 0, 0xA6000000.toInt()))
                }, FrameLayout.LayoutParams(-1, -1))
                tarjeta.addView(texto(f.nombre, 13f, 600).apply { setShadowLayer(6f, 0f, 1f, 0x80000000.toInt()) },
                    FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM).apply { setMargins(12.dp, 0, 12.dp, 10.dp) })
                // El elegido: borde blanco y una marca redonda arriba a la derecha
                val borde = GradientDrawable().apply { cornerRadius = 16f.dp }
                tarjeta.foreground = borde
                val marca = FrameLayout(this).apply {
                    background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.WHITE) }
                    addView(icono(R.drawable.ic_check, Color.BLACK), FrameLayout.LayoutParams(16.dp, 16.dp, Gravity.CENTER))
                }
                tarjeta.addView(marca, FrameLayout.LayoutParams(26.dp, 26.dp, Gravity.TOP or Gravity.END).apply { setMargins(0, 9.dp, 9.dp, 0) })
                tarjetas[f.id] = borde to marca
                tarjeta.pulsable(0.95f) {
                    tv.fondo(f.id)
                    prefs.edit().putString("fondo", f.id).apply()
                    ponerFondo(f.id); marcar(f.id)
                }
                rejilla.addView(tarjeta, GridLayout.LayoutParams().apply {
                    width = ancho; height = ancho * 9 / 16
                    setMargins(0, 0, if (i % 2 == 0) separacion else 0, separacion)
                })
            }
            col.addView(rejilla)
        }
        marcar(actual)
        return ScrollView(this).apply { isVerticalScrollBarEnabled = false; addView(col) }
    }

    /** Cambia el fondo elegido sin rehacer la lista (así no se pierde por dónde ibas). */
    private fun marcar(id: String?) {
        tarjetas.forEach { (fid, par) ->
            val si = fid == id
            par.first.setStroke(if (si) 3.dp else 1.dp, if (si) Color.WHITE else 0x1FFFFFFF)
            par.second.visibility = if (si) View.VISIBLE else View.GONE
        }
    }

    private fun ponerFondo(id: String) {
        val f = tv.fondos.firstOrNull { it.id == id } ?: return
        val url = f.miniatura
        if (url != null) cargar(url, fondoImagen)
        else if (f.colores.size >= 2) fondoImagen.setImageDrawable(
            GradientDrawable(GradientDrawable.Orientation.TL_BR, f.colores.map { Color.parseColor(it) }.toIntArray())
        )
    }

    /**
     * Descarga una imagen (miniatura o icono) en otro hilo. Se guarda en disco, así la próxima vez sale al
     * instante, y se reduce al tamaño al que se ve (menos memoria). El fondo, en Android 11 o anterior, se encoge
     * mucho: al estirarlo queda difuminado casi gratis (en 12+ lo difumina la tarjeta gráfica con RenderEffect).
     */
    private fun cargar(url: String, destino: ImageView, tamMax: Int = 320, listo: (() -> Unit)? = null) {
        val esFondo = destino === fondoImagen
        val clave = if (esFondo) "$url#fondo" else url
        imagenes[clave]?.let { destino.setImageBitmap(it); listo?.invoke(); return }
        destino.tag = clave
        descargas.execute {
            val archivo = File(cacheDir, "img-" + Integer.toHexString(url.hashCode()))
            val bytes = runCatching {
                if (archivo.exists()) archivo.readBytes()
                else (URL(url).openConnection() as HttpURLConnection).run {
                    connectTimeout = 5000; readTimeout = 8000
                    inputStream.use { it.readBytes() }
                }.also { archivo.writeBytes(it) }
            }.getOrNull() ?: return@execute
            val medidas = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, medidas)
            val objetivo = if (esFondo && Build.VERSION.SDK_INT < 31) 48 else tamMax
            var muestra = 1
            while (max(medidas.outWidth, medidas.outHeight) / (muestra * 2) >= objetivo) muestra *= 2
            var bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = muestra })
                ?: return@execute
            if (esFondo && Build.VERSION.SDK_INT < 31 && bitmap.width > 48)
                bitmap = Bitmap.createScaledBitmap(bitmap, 48, max(1, 48 * bitmap.height / bitmap.width), true)
            val listoBitmap = bitmap
            runOnUiThread {
                imagenes[clave] = listoBitmap
                if (destino.tag == clave) {
                    destino.alpha = 0f
                    destino.setImageBitmap(listoBitmap)
                    destino.animate().alpha(if (esFondo) 0.85f else 1f).setDuration(300).start()
                    listo?.invoke()
                }
            }
        }
    }

    /** Mira en GitHub si hay una versión más nueva del mando (un archivo de pocos bytes) y, si la hay, lo avisa. */
    private fun buscarNovedad() {
        val mia = version
        descargas.execute {
            val texto = runCatching {
                (URL(ENLACE_VERSION).openConnection() as HttpURLConnection).run {
                    connectTimeout = 5000; readTimeout = 5000
                    inputStream.bufferedReader().use { it.readText() }
                }
            }.getOrNull() ?: return@execute
            val ultima = runCatching { org.json.JSONObject(texto).optLong("version") }.getOrDefault(0L)
            if (mia in 1 until ultima) runOnUiThread {
                novedad.visibility = View.VISIBLE
                novedad.alpha = 0f; novedad.animate().alpha(1f).setDuration(300).start()
            }
        }
    }

    // ---------- Elegir la TV ----------

    private fun elegirTV() {
        val cuerpo = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val (marco, campo) = campoTexto("IP de la TV, p. ej. 192.168.1.50", R.drawable.ic_tv)
        campo.inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
        campo.keyListener = DigitsKeyListener.getInstance("0123456789.")   // el teclado decimal solo deja poner un punto
        campo.setText(tv.ip)
        cuerpo.addView(marco, LinearLayout.LayoutParams(-1, 56.dp))

        val resultados = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val buscarTexto = texto("Buscar en esta red", 15f, 600, AZUL)
        val buscar = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL; setPadding(16.dp, 0, 16.dp, 0); background = vidrio(16f, 0x14, 0x1F)
            addView(icono(R.drawable.ic_buscar, AZUL), LinearLayout.LayoutParams(20.dp, 20.dp).apply { rightMargin = 12.dp })
            addView(buscarTexto)
        }
        buscar.pulsable(0.97f) {
            buscarTexto.text = "Buscando…"
            tv.buscar { lista ->
                buscarTexto.text = if (lista.isEmpty()) "No encontré ninguna TV · buscar otra vez" else "Buscar otra vez"
                resultados.removeAllViews()
                lista.forEach { ip ->
                    resultados.addView(LinearLayout(this).apply {
                        gravity = Gravity.CENTER_VERTICAL; setPadding(16.dp, 0, 16.dp, 0); background = vidrio(16f, 0x1F, 0x2E)
                        addView(icono(R.drawable.ic_tv), LinearLayout.LayoutParams(20.dp, 20.dp).apply { rightMargin = 12.dp })
                        addView(texto(ip, 16f, 500), LinearLayout.LayoutParams(0, -2, 1f))
                        addView(texto("Usar", 14f, 600, AZUL))
                        pulsable(0.97f) { campo.setText(ip); campo.setSelection(ip.length) }
                    }, LinearLayout.LayoutParams(-1, 52.dp).apply { topMargin = 8.dp })
                }
            }
        }
        cuerpo.addView(buscar, LinearLayout.LayoutParams(-1, 52.dp).apply { topMargin = 10.dp })
        cuerpo.addView(resultados)
        cuerpo.addView(texto("La primera vez la TV pregunta si permites el acceso: acéptalo con el mando.", 13f, 400, TEXTO_3).apply {
            setPadding(4.dp, 16.dp, 4.dp, 0); setLineSpacing(3f.dp, 1f)
        })
        cuerpo.addView(texto("Mando versión 1.$version", 12f, 500, TEXTO_3).apply { setPadding(4.dp, 8.dp, 4.dp, 0) })

        val d = hoja("Televisor", cuerpo)
        cuerpo.addView(boton("Conectar", principal = true) {
            tv.ip = campo.text.toString().trim()
            tv.conectar()
            d.dismiss()
        }, LinearLayout.LayoutParams(-1, 52.dp).apply { topMargin = 20.dp })
        if (tv.ip.isNotEmpty()) cuerpo.addView(boton("Olvidar esta TV", color = ROJO) { tv.olvidar(); d.dismiss() },
            LinearLayout.LayoutParams(-1, 52.dp).apply { topMargin = 10.dp })
        d.show()
    }
}
