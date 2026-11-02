import SwiftUI
import UIKit

// Estética de TV Libre: el fondo elegido en la TV, difuminado, y paneles de vidrio. La misma que la app de Android.

@main
struct TVLibreMandoApp: App {
    @StateObject private var tv = TV()
    @Environment(\.scenePhase) private var fase

    init() {
        // Iconos y miniaturas se guardan en disco: la próxima vez salen al instante y sin red
        URLCache.shared = URLCache(memoryCapacity: 16 << 20, diskCapacity: 80 << 20)
    }

    var body: some Scene {
        WindowGroup {
            Principal()
                .environmentObject(tv)
                .preferredColorScheme(.dark)
        }
        // Al volver a la app, reconecta (iOS corta los sockets en segundo plano): nada corre mientras no se usa
        .onChange(of: fase) { nueva in
            if nueva == .active, tv.estado != .conectada { Task { await tv.conectar() } }
            if nueva == .background { tv.desconectar() }
        }
    }
}

func vibrar(_ estilo: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
    UIImpactFeedbackGenerator(style: estilo).impactOccurred()
}

let TEXTO_2 = Color.white.opacity(0.7)
let TEXTO_3 = Color.white.opacity(0.45)

/** Se hunde un poco al tocarlo y rebota al soltar, como los botones de iOS. */
struct Hundible: ButtonStyle {
    var escala: CGFloat = 0.92
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? escala : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.55), value: configuration.isPressed)
    }
}

extension View {
    /** Panel de vidrio: blanco translúcido sobre la foto difuminada, con un borde fino. */
    func vidrio(_ radio: CGFloat, _ alfa: Double = 0.12) -> some View {
        background(RoundedRectangle(cornerRadius: radio, style: .continuous).fill(.white.opacity(alfa)))
            .overlay(RoundedRectangle(cornerRadius: radio, style: .continuous).strokeBorder(.white.opacity(0.18), lineWidth: 1))
    }
}

struct Principal: View {
    @EnvironmentObject var tv: TV
    @AppStorage("fondo") private var fondoElegido = "montanas-amanecer"
    @State private var pestana = 0
    @State private var antes = 0
    @State private var conexion = false

    var body: some View {
        ZStack {
            FondoDifuminado(id: fondoElegido)
            VStack(spacing: 0) {
                Cabecera(conexion: $conexion).padding(.horizontal, 20)
                Segmentos(opciones: ["Mando", "Apps", "Fondos"], elegido: $pestana, alto: 42)
                    .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 16)
                ZStack {
                    switch pestana {
                    case 0: Mando().transition(entrada)
                    case 1: Apps().transition(entrada)
                    default: Fondos().transition(entrada)
                    }
                }
                .frame(maxHeight: .infinity)
            }
            .padding(.top, 8)
        }
        .onChange(of: pestana) { nueva in
            if nueva == 1 { tv.pedirDisposicion() }
            DispatchQueue.main.async { antes = nueva }
        }
        .sheet(isPresented: $conexion) { Conexion() }
        .onAppear { if tv.ip.isEmpty { conexion = true } }
    }

    // La pestaña nueva entra desde el lado hacia el que se ha ido
    var entrada: AnyTransition {
        .asymmetric(insertion: .opacity.combined(with: .offset(x: pestana >= antes ? 28 : -28)), removal: .opacity)
    }
}

/** Control segmentado con la pastilla que se desliza hasta la opción elegida. */
struct Segmentos: View {
    let opciones: [String]
    @Binding var elegido: Int
    var alto: CGFloat = 40
    @Namespace private var espacio

    var body: some View {
        HStack(spacing: 0) {
            ForEach(opciones.indices, id: \.self) { i in
                Button {
                    vibrar()
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.78)) { elegido = i }
                } label: {
                    Text(opciones[i]).font(.subheadline.weight(.semibold))
                        .foregroundStyle(elegido == i ? Color.white : TEXTO_2)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background {
                            if elegido == i { Capsule().fill(.white.opacity(0.24)).matchedGeometryEffect(id: "pastilla", in: espacio) }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .frame(height: alto)
        .background(Capsule().fill(.white.opacity(0.1)))
        .overlay(Capsule().strokeBorder(.white.opacity(0.14), lineWidth: 1))
    }
}

struct FondoDifuminado: View {
    let id: String
    var body: some View {
        let fondo = TV.fondos.first { $0.id == id }
        ZStack {
            Color.black
            if let mini = fondo?.miniatura, let url = URL(string: mini) {
                // Se pide pequeña y se difumina: no hace falta más resolución para un fondo borroso
                AsyncImage(url: url) { imagen in
                    imagen.resizable().scaledToFill()
                } placeholder: { Color.black }
                .blur(radius: 40)
                .opacity(0.85)
            } else if let colores = fondo?.colores {
                LinearGradient(colors: colores.map { Color(hex: $0) }, startPoint: .topLeading, endPoint: .bottomTrailing)
            }
            LinearGradient(colors: [.black.opacity(0.25), .black.opacity(0.35), .black.opacity(0.75)], startPoint: .top, endPoint: .bottom)
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.6), value: id)
    }
}

struct Cabecera: View {
    @EnvironmentObject var tv: TV
    @Binding var conexion: Bool
    @State private var latido = false
    @State private var sinMAC = false

    var body: some View {
        HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 8) {
                Text("TV Libre").font(.system(size: 32, weight: .bold)).tracking(-0.6)
                // La pastilla de estado: punto de color, lo que se ve en la TV (o la IP) y una flecha para cambiar de TV
                Button { conexion = true } label: {
                    HStack(spacing: 7) {
                        Circle().fill(color).frame(width: 8, height: 8)
                            .opacity(esperando && latido ? 0.25 : 1)
                            .animation(esperando ? .easeInOut(duration: 0.7).repeatForever(autoreverses: true) : .default, value: latido)
                        if tv.estado == .conectada, let icono = tv.queSeVe?.icono {
                            AsyncImage(url: icono) { $0.resizable().scaledToFit() } placeholder: { Color.white.opacity(0.2) }
                                .frame(width: 18, height: 18)
                                .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
                        }
                        Text(texto).font(.footnote.weight(.medium)).foregroundStyle(TEXTO_2).lineLimit(1)
                        Image(systemName: "chevron.down").font(.caption2.weight(.bold)).foregroundStyle(TEXTO_3)
                    }
                    .padding(.leading, 11).padding(.trailing, 10)
                    .frame(height: 30)
                    .background(Capsule().fill(.white.opacity(0.1)))
                    .overlay(Capsule().strokeBorder(.white.opacity(0.14), lineWidth: 1))
                }
                .buttonStyle(Hundible(escala: 0.96))
            }
            Spacer(minLength: 12)
            Button {
                vibrar(.medium)
                if tv.estado == .conectada { tv.apagar() } else if tv.puedeEncender { tv.encender() } else { sinMAC = true }
            } label: {
                Image(systemName: "power").font(.title3.weight(.semibold))
                    .foregroundStyle(colorEncender)
                    .frame(width: 54, height: 54)
                    .background(Circle().fill(fondoEncender))
                    .overlay(Circle().strokeBorder(.white.opacity(0.2), lineWidth: 1))
            }
            .buttonStyle(Hundible())
        }
        .onAppear { latido = true }
        .alert("Aún no se puede encender desde aquí", isPresented: $sinMAC) {
            Button("Vale", role: .cancel) {}
        } message: {
            Text("Conecta una vez con la TV encendida: así el mando aprende su dirección para poder encenderla.")
        }
    }

    var esperando: Bool { tv.estado == .conectando || tv.estado == .esperandoPermiso }

    // Rojo si se puede apagar, verde si se puede encender, apagado si aún no se sabe su MAC
    var colorEncender: Color { tv.estado == .conectada ? Color(red: 1, green: 0.42, blue: 0.38) : tv.puedeEncender ? .green : TEXTO_3 }
    var fondoEncender: Color { tv.estado == .conectada ? .red.opacity(0.22) : tv.puedeEncender ? .green.opacity(0.18) : .white.opacity(0.1) }

    var color: Color {
        switch tv.estado {
        case .conectada: return .green
        case .conectando, .esperandoPermiso: return .yellow
        case .error: return .red
        case .sinTV: return .gray
        }
    }

    var texto: String {
        switch tv.estado {
        case .sinTV: return "Elegir televisor"
        case .conectando: return "Conectando con \(tv.ip)…"
        case .esperandoPermiso: return "Acepta el aviso en la TV"
        case .conectada: return tv.queSeVe.map { "Ahora: \($0.nombre)" } ?? "Conectada · \(tv.ip)"
        case .error(let e): return e
        }
    }
}

// MARK: - Mando

struct Mando: View {
    @EnvironmentObject var tv: TV
    @State private var teclado = false

    var body: some View {
        VStack(spacing: 20) {
            Trackpad()
            // Como el mando del Apple TV: dos columnas de botones redondos y una pastilla alta para avanzar y
            // retroceder (el volumen no: con una barra de sonido por óptico la TV no lo controla)
            HStack(alignment: .center) {
                VStack(spacing: 14) {
                    Redondo(icono: "chevron.backward") { tv.boton("BACK") }
                    Redondo(icono: "keyboard") { teclado = true }
                }
                Spacer()
                VStack(spacing: 14) {
                    Redondo(icono: "house.fill") { tv.inicio() }   // TV Libre, no el inicio de LG
                    Redondo(icono: "playpause.fill") { tv.boton("PLAY") }
                }
                Spacer()
                Avance()
            }
            .padding(.horizontal, 6)
            HStack(spacing: 10) {
                ForEach([("RED", Color.red), ("GREEN", .green), ("YELLOW", .yellow), ("BLUE", .blue)], id: \.0) { nombre, color in
                    Button { vibrar(); tv.boton(nombre) } label: {
                        Capsule().fill(color).frame(width: 26, height: 8)
                            .frame(maxWidth: .infinity).frame(height: 40)
                            .vidrio(20, 0.1)
                    }
                    .buttonStyle(Hundible(escala: 0.94))
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
        .sheet(isPresented: $teclado) { Teclado().presentationDetents([.height(250)]) }
    }
}

struct Avance: View {
    @EnvironmentObject var tv: TV
    var body: some View {
        VStack(spacing: 0) {
            parte("forward.fill", "FASTFORWARD")
            Rectangle().fill(.white.opacity(0.14)).frame(height: 1).padding(.horizontal, 18)
            parte("backward.fill", "REWIND")
        }
        .frame(width: 66, height: 146)
        .background(Capsule().fill(LinearGradient(colors: [.white.opacity(0.22), .white.opacity(0.14)], startPoint: .top, endPoint: .bottom)))
        .overlay(Capsule().strokeBorder(.white.opacity(0.2), lineWidth: 1))
    }

    func parte(_ icono: String, _ boton: String) -> some View {
        Button { vibrar(); tv.boton(boton) } label: {
            Image(systemName: icono).font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity, maxHeight: .infinity).contentShape(Rectangle())
        }
        .buttonStyle(Hundible(escala: 0.85))
    }
}

/**
 * Deslizar = flechas: una cada vez que el dedo recorre un tramo, así un deslizamiento largo avanza varias casillas,
 * y si se suelta rápido sigue unas cuantas más, frenando (inercia). Tocar sin moverse = OK y mantener = mantener OK
 * (en TV Libre, coger la app para moverla). Un brillo sigue al dedo y se ilumina la flecha de esa dirección.
 */
struct Trackpad: View {
    @EnvironmentObject var tv: TV
    @State private var dedo: CGPoint?
    @State private var brilloGrande = false
    @State private var destellos: [String: Double] = [:]
    @State private var pulsado = false
    @State private var empezado = false
    @State private var origen = CGPoint.zero
    @State private var movido = false
    @State private var cogido = false
    @State private var ultima = "RIGHT"
    @State private var mantener: Task<Void, Never>?
    @State private var inercia: Task<Void, Never>?
    private let tramo: CGFloat = 46

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 36, style: .continuous)
                .fill(LinearGradient(colors: [.white.opacity(0.17), .white.opacity(0.07)], startPoint: .top, endPoint: .bottom))
            if let dedo {
                Circle()
                    .fill(RadialGradient(colors: [.white.opacity(0.36), .white.opacity(0)], center: .center, startRadius: 0, endRadius: 75))
                    .frame(width: 150, height: 150)
                    .scaleEffect(brilloGrande ? 1.6 : 1)
                    .position(dedo)
                    .allowsHitTesting(false)
            }
            Text("Desliza para moverte\nToca para OK · mantén para coger")
                .font(.subheadline.weight(.medium)).multilineTextAlignment(.center).lineSpacing(4)
                .foregroundStyle(TEXTO_3)
                .opacity(dedo == nil ? 1 : 0)
                .animation(.easeInOut(duration: dedo == nil ? 0.4 : 0.15).delay(dedo == nil ? 0.6 : 0), value: dedo == nil)
            flecha("chevron.up", "UP").frame(maxHeight: .infinity, alignment: .top)
            flecha("chevron.down", "DOWN").frame(maxHeight: .infinity, alignment: .bottom)
            flecha("chevron.left", "LEFT").frame(maxWidth: .infinity, alignment: .leading)
            flecha("chevron.right", "RIGHT").frame(maxWidth: .infinity, alignment: .trailing)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 36, style: .continuous)
                .strokeBorder(LinearGradient(colors: [.white.opacity(0.4), .white.opacity(0.08)], startPoint: .top, endPoint: .bottom), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 36, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: 36, style: .continuous))
        .scaleEffect(pulsado ? 0.97 : 1)
        .animation(.spring(response: 0.25, dampingFraction: 0.55), value: pulsado)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { g in tocando(g) }
                .onEnded { g in soltar(g) }
        )
        .frame(maxHeight: .infinity)
        .accessibilityLabel("Trackpad: desliza para moverte, toca para OK")
    }

    func flecha(_ icono: String, _ nombre: String) -> some View {
        let d = destellos[nombre] ?? 0
        return Image(systemName: icono).font(.title3.weight(.bold))
            .opacity(0.2 + 0.8 * d).scaleEffect(1 + 0.25 * d)
            .padding(16)
            .allowsHitTesting(false)
    }

    func destello(_ nombre: String) {
        var sinAnimar = Transaction()
        sinAnimar.disablesAnimations = true
        withTransaction(sinAnimar) { destellos[nombre] = 1 }
        DispatchQueue.main.async { withAnimation(.easeOut(duration: 0.42)) { destellos[nombre] = 0 } }
    }

    func direccion(_ dx: CGFloat, _ dy: CGFloat) -> String {
        abs(dx) > abs(dy) ? (dx > 0 ? "RIGHT" : "LEFT") : (dy > 0 ? "DOWN" : "UP")
    }

    func tocando(_ g: DragGesture.Value) {
        if !empezado {
            empezado = true
            inercia?.cancel()   // un toque para la inercia que quedara
            origen = g.startLocation; movido = false; cogido = false; brilloGrande = false
            withAnimation(.easeOut(duration: 0.12)) { dedo = g.location }
            mantener = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 520_000_000)
                guard !Task.isCancelled else { return }
                cogido = true; movido = true   // al soltar ya no es un OK
                UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
                withAnimation(.easeOut(duration: 0.2)) { brilloGrande = true }
                tv.mantenerOk()
            }
            return
        }
        dedo = g.location
        if hypot(g.translation.width, g.translation.height) > 14 { mantener?.cancel() }
        let dx = g.location.x - origen.x, dy = g.location.y - origen.y
        if max(abs(dx), abs(dy)) > tramo {
            let d = direccion(dx, dy)
            vibrar(); tv.boton(d); destello(d)
            origen = g.location; movido = true; ultima = d
        }
    }

    func soltar(_ g: DragGesture.Value) {
        empezado = false
        mantener?.cancel()
        withAnimation(.easeOut(duration: 0.26)) { dedo = nil }
        if !movido {
            let dx = g.translation.width, dy = g.translation.height
            if abs(dx) < 14 && abs(dy) < 14 {
                vibrar(.medium)
                tv.boton("ENTER")
                pulsado = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.07) { pulsado = false }
            } else {
                let d = direccion(dx, dy)
                vibrar(); tv.boton(d); destello(d)
            }
        } else if !cogido {
            // Soltar rápido en la misma dirección: unos pasos más (hasta 5), según lo lejos que iría el dedo
            let vx = g.predictedEndTranslation.width - g.translation.width
            let vy = g.predictedEndTranslation.height - g.translation.height
            let resto = max(abs(vx), abs(vy))
            guard resto > 120, direccion(vx, vy) == ultima else { return }
            let pasos = min(5, Int(resto / 120))
            let d = ultima
            inercia = Task { @MainActor in
                for k in 1...pasos {
                    try? await Task.sleep(nanoseconds: UInt64(55 + k * 25) * 1_000_000)   // cada vez un poco más despacio
                    guard !Task.isCancelled else { return }
                    if k == 1 { vibrar() }
                    tv.boton(d); destello(d)
                }
            }
        }
    }
}

struct Redondo: View {
    let icono: String
    let accion: () -> Void
    var body: some View {
        Button { vibrar(); accion() } label: {
            Image(systemName: icono).font(.title3.weight(.semibold))
                .frame(width: 66, height: 66)
                // Un poco más claro arriba, como si le diera la luz
                .background(Circle().fill(LinearGradient(colors: [.white.opacity(0.22), .white.opacity(0.14)], startPoint: .top, endPoint: .bottom)))
                .overlay(Circle().strokeBorder(.white.opacity(0.2), lineWidth: 1))
        }
        .buttonStyle(Hundible())
    }
}

/** Lo que escribes aquí aparece en el campo de texto que tenga el foco en la TV. */
struct Teclado: View {
    @EnvironmentObject var tv: TV
    @Environment(\.dismiss) private var cerrar
    @State private var texto = ""
    @State private var ultimo = ""
    @FocusState private var foco: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Escribir en la TV").font(.title2.bold())
            HStack(spacing: 12) {
                Image(systemName: "keyboard").foregroundStyle(TEXTO_3)
                TextField("Escribe en la TV…", text: $texto)
                    .font(.body.weight(.medium))
                    .focused($foco)
                    .submitLabel(.search)
                    .onChange(of: texto) { nuevo in
                        // Solo se manda la diferencia: lo añadido o lo borrado
                        let anterior = ultimo
                        if nuevo.hasPrefix(anterior) { tv.escribir(String(nuevo.dropFirst(anterior.count))) }
                        else { tv.borrar(anterior.count); tv.escribir(nuevo) }
                        ultimo = nuevo
                    }
                    .onSubmit { tv.intro(); ultimo = ""; texto = "" }
            }
            .padding(.horizontal, 16).frame(height: 56)
            .vidrio(16, 0.1)
            HStack(spacing: 10) {
                Button { vibrar(); tv.intro(); ultimo = ""; texto = "" } label: {
                    Text("Intro").font(.body.weight(.semibold)).frame(maxWidth: .infinity).frame(height: 52).vidrio(26)
                }
                .buttonStyle(Hundible(escala: 0.96))
                Button {
                    let q = texto.trimmingCharacters(in: .whitespaces)
                    if !q.isEmpty { vibrar(); tv.buscarEnYouTube(q); cerrar() }
                } label: {
                    Text("Buscar en YouTube").font(.body.weight(.semibold)).foregroundStyle(.black)
                        .frame(maxWidth: .infinity).frame(height: 52)
                        .background(Capsule().fill(.white))
                }
                .buttonStyle(Hundible(escala: 0.96))
                .layoutPriority(1)
            }
        }
        .padding(22)
        .onAppear { foco = true }
    }
}

// MARK: - Apps y entradas

/** Como la pantalla de TV Libre: el dock de favoritas, debajo el resto de apps y al final las entradas. */
struct Apps: View {
    @EnvironmentObject var tv: TV
    let cuatro = Array(repeating: GridItem(.flexible(), spacing: 6), count: 4)
    let dos = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        ScrollView(showsIndicators: false) {
            if tv.apps.isEmpty {
                VStack(spacing: 14) {
                    Image(systemName: "tv").font(.system(size: 44)).foregroundStyle(TEXTO_3)
                    Text(tv.estado == .conectada ? "Cargando apps…" : "Conecta con la TV para ver sus apps")
                        .font(.subheadline.weight(.medium)).foregroundStyle(TEXTO_2)
                }
                .frame(maxWidth: .infinity).padding(.top, 70)
            } else {
                let filas = tv.filas
                VStack(alignment: .leading, spacing: 0) {
                    Seccion(titulo: "Favoritas", comoLaTV: tv.disposicion != nil, primera: true)
                    Group {
                        if filas.favoritas.isEmpty {
                            Text("No hay favoritas en la TV").font(.subheadline.weight(.medium)).foregroundStyle(TEXTO_3)
                                .frame(maxWidth: .infinity).padding(.vertical, 24)
                        } else {
                            LazyVGrid(columns: cuatro, spacing: 0) {
                                ForEach(filas.favoritas) { app in Icono(app: app, tam: 64) }
                            }
                            .padding(.top, 14).padding(.horizontal, 6)
                        }
                    }
                    .background(RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .fill(LinearGradient(colors: [.white.opacity(0.18), .white.opacity(0.09)], startPoint: .top, endPoint: .bottom)))
                    .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(.white.opacity(0.2), lineWidth: 1))

                    if !filas.resto.isEmpty {
                        Seccion(titulo: "Otras apps")
                        LazyVGrid(columns: cuatro, spacing: 0) {
                            ForEach(filas.resto) { app in Icono(app: app, tam: 58) }
                        }
                    }

                    Seccion(titulo: "Entradas")
                    LazyVGrid(columns: dos, spacing: 10) {
                        Entrada(nombre: "TV", icono: "tv") { tv.abrir("com.webos.app.livetv") }
                        ForEach(tv.entradas) { e in Entrada(nombre: e.nombre, icono: "cable.connector") { tv.entrada(e.id) } }
                    }

                    Text(tv.disposicion != nil
                         ? "Las favoritas, el orden y las apps ocultas son los de la TV. Para cambiarlos, en la TV mantén OK sobre una app."
                         : "Abre TV Libre en la TV con la app abierta y aquí verás tus favoritas y apps ocultas tal como las tienes.")
                        .font(.footnote).foregroundStyle(TEXTO_3).multilineTextAlignment(.center).lineSpacing(3)
                        .frame(maxWidth: .infinity).padding(.horizontal, 12).padding(.top, 16)
                }
                .padding(.horizontal, 20).padding(.bottom, 16)
            }
        }
    }
}

/** Título de sección; con la TV sincronizada, la de favoritas lleva una etiqueta que lo dice. */
struct Seccion: View {
    let titulo: String
    var comoLaTV = false
    var primera = false
    var body: some View {
        HStack {
            Text(titulo).font(.title3.bold()).tracking(-0.3)
            Spacer()
            if comoLaTV {
                Label("Como en la TV", systemImage: "checkmark")
                    .font(.caption.weight(.semibold)).foregroundStyle(TEXTO_2)
                    .labelStyle(EtiquetaVerde())
                    .padding(.horizontal, 10).frame(height: 26)
                    .background(Capsule().fill(.white.opacity(0.1)))
                    .overlay(Capsule().strokeBorder(.white.opacity(0.14), lineWidth: 1))
            }
        }
        .padding(.top, primera ? 4 : 24).padding(.bottom, 12).padding(.leading, 2)
    }
}

struct EtiquetaVerde: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 5) { configuration.icon.foregroundStyle(.green); configuration.title }
    }
}

/** El icono de cada app sobre su color, como las tarjetas del dock de la TV. */
struct Icono: View {
    @EnvironmentObject var tv: TV
    let app: AppTV
    let tam: CGFloat

    var body: some View {
        Button { vibrar(); tv.abrir(app) } label: {
            VStack(spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: tam * 0.28, style: .continuous)
                        .fill(app.color.map { Color(hex: $0) } ?? Color.white.opacity(0.14))
                    // Un poco más claro arriba, como la luz de las tarjetas de la TV
                    RoundedRectangle(cornerRadius: tam * 0.28, style: .continuous)
                        .fill(LinearGradient(colors: [.white.opacity(0.12), .clear], startPoint: .top, endPoint: .bottom))
                    if let url = app.icono {
                        AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { inicial }
                            .padding(tam * 0.17)
                    } else {
                        inicial
                    }
                }
                .frame(width: tam, height: tam)
                .overlay(RoundedRectangle(cornerRadius: tam * 0.28, style: .continuous).strokeBorder(.white.opacity(0.16), lineWidth: 1))
                .shadow(color: .black.opacity(app.color == nil ? 0 : 0.3), radius: 8, y: 4)
                Text(app.nombre).font(.caption.weight(.medium)).foregroundStyle(TEXTO_2).lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 16)
        }
        .buttonStyle(Hundible(escala: 0.9))
    }

    var inicial: some View { Text(String(app.nombre.prefix(1))).font(.system(size: tam * 0.4, weight: .bold)) }
}

struct Entrada: View {
    let nombre: String
    let icono: String
    let accion: () -> Void
    var body: some View {
        Button { vibrar(); accion() } label: {
            HStack(spacing: 10) {
                Image(systemName: icono).font(.subheadline.weight(.semibold))
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(.white.opacity(0.16)))
                Text(nombre).font(.body.weight(.semibold)).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10).frame(height: 58)
            .vidrio(20)
        }
        .buttonStyle(Hundible(escala: 0.96))
    }
}

// MARK: - Fondos

struct Fondos: View {
    @EnvironmentObject var tv: TV
    @AppStorage("fondo") private var fondoElegido = "montanas-amanecer"
    @AppStorage("tema") private var tema = "auto"
    let columnas = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
    let temas = ["auto", "claro", "oscuro"]

    var grupos: [String] {
        var vistos: [String] = []
        for f in TV.fondos where !vistos.contains(f.grupo) { vistos.append(f.grupo) }
        return vistos
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                Seccion(titulo: "Tema", primera: true)
                Segmentos(opciones: ["Automático", "Claro", "Oscuro"], elegido: Binding(
                    get: { temas.firstIndex(of: tema) ?? 0 },
                    set: { tema = temas[$0]; tv.tema(temas[$0]) }
                ))
                ForEach(grupos, id: \.self) { grupo in
                    Seccion(titulo: grupo)
                    LazyVGrid(columns: columnas, spacing: 12) {
                        ForEach(TV.fondos.filter { $0.grupo == grupo }) { f in
                            Button {
                                vibrar()
                                withAnimation(.spring(response: 0.3)) { fondoElegido = f.id }
                                tv.fondo(f.id)
                            } label: { Miniatura(fondo: f, elegido: f.id == fondoElegido) }
                            .buttonStyle(Hundible(escala: 0.95))
                        }
                    }
                }
            }
            .padding(.horizontal, 20).padding(.bottom, 16)
        }
    }
}

struct Miniatura: View {
    let fondo: Fondo
    let elegido: Bool
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            if let mini = fondo.miniatura, let url = URL(string: mini) {
                AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.white.opacity(0.08) }
            } else {
                LinearGradient(colors: (fondo.colores ?? ["#1c1c1e", "#2c2c2e"]).map { Color(hex: $0) },
                               startPoint: .topLeading, endPoint: .bottomTrailing)
            }
            LinearGradient(colors: [.clear, .clear, .black.opacity(0.65)], startPoint: .top, endPoint: .bottom)
            Text(fondo.nombre).font(.footnote.weight(.semibold)).shadow(color: .black.opacity(0.5), radius: 3, y: 1)
                .padding(.horizontal, 12).padding(.bottom, 10)
        }
        // El elegido: borde blanco y una marca redonda arriba a la derecha
        .overlay(alignment: .topTrailing) {
            if elegido {
                Image(systemName: "checkmark").font(.caption.weight(.heavy)).foregroundStyle(.black)
                    .frame(width: 26, height: 26).background(Circle().fill(.white))
                    .padding(9)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(elegido ? .white : .white.opacity(0.12), lineWidth: elegido ? 3 : 1))
    }
}

// MARK: - Elegir la TV

struct Conexion: View {
    @EnvironmentObject var tv: TV
    @Environment(\.dismiss) private var cerrar
    @State private var ip = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("IP de la TV (p. ej. 192.168.1.50)", text: $ip)
                        .keyboardType(.decimalPad)
                    Button("Conectar") {
                        tv.ip = ip.trimmingCharacters(in: .whitespaces)
                        Task { await tv.conectar() }
                        cerrar()
                    }
                    .disabled(ip.isEmpty)
                } footer: {
                    Text("La primera vez la TV pregunta si permites el acceso: acéptalo con el mando. La IP está en Ajustes de la TV → General → Red.")
                }
                Section("En esta red") {
                    if tv.buscando { ProgressView("Buscando televisores…") }
                    ForEach(tv.encontradas, id: \.self) { candidata in
                        Button { ip = candidata } label: {
                            HStack {
                                Label(candidata, systemImage: "tv")
                                Spacer()
                                if ip == candidata { Image(systemName: "checkmark").foregroundStyle(.blue) }
                            }
                        }
                    }
                    Button("Buscar") { Task { await tv.buscar() } }.disabled(tv.buscando)
                }
                if !tv.ip.isEmpty {
                    Section {
                        Button("Olvidar esta TV", role: .destructive) { tv.olvidar(); ip = "" }
                    } footer: {
                        Text("Borra la clave de emparejamiento y la huella del certificado guardadas.")
                    }
                }
            }
            .navigationTitle("Televisor")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { cerrar() } } }
        }
        .onAppear { ip = tv.ip }
    }
}

extension Color {
    init(hex: String) {
        let limpio = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let valor = UInt64(limpio, radix: 16) ?? 0x1c1c1e
        self.init(red: Double((valor >> 16) & 0xFF) / 255, green: Double((valor >> 8) & 0xFF) / 255, blue: Double(valor & 0xFF) / 255)
    }
}
