import SwiftUI
import UIKit

// Estética de TV Libre: el fondo elegido en la TV, difuminado, y paneles de vidrio (material de iOS).

@main
struct TVLibreMandoApp: App {
    @StateObject private var tv = TV()
    @Environment(\.scenePhase) private var fase

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

struct Principal: View {
    @EnvironmentObject var tv: TV
    @AppStorage("fondo") private var fondoElegido = "montanas-amanecer"
    @State private var pestana = 0
    @State private var conexion = false

    var body: some View {
        ZStack {
            FondoDifuminado(id: fondoElegido)
            VStack(spacing: 14) {
                Cabecera(conexion: $conexion)
                Picker("", selection: $pestana) {
                    Text("Mando").tag(0)
                    Text("Apps").tag(1)
                    Text("Fondos").tag(2)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 20)
                Group {
                    switch pestana {
                    case 0: Mando()
                    case 1: Apps()
                    default: Fondos()
                    }
                }
                .frame(maxHeight: .infinity)
            }
            .padding(.top, 8)
        }
        .sheet(isPresented: $conexion) { Conexion() }
        .onAppear { if tv.ip.isEmpty { conexion = true } }
    }
}

struct FondoDifuminado: View {
    let id: String
    var body: some View {
        let fondo = TV.fondos.first { $0.id == id }
        ZStack {
            Color.black
            if let mini = fondo?.miniatura, let url = URL(string: mini) {
                AsyncImage(url: url) { imagen in
                    imagen.resizable().scaledToFill()
                } placeholder: { Color.black }
                .blur(radius: 40)
                .opacity(0.75)
            } else if let colores = fondo?.colores {
                LinearGradient(colors: colores.map { Color(hex: $0) }, startPoint: .topLeading, endPoint: .bottomTrailing)
            }
            LinearGradient(colors: [.black.opacity(0.1), .black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.6), value: id)
    }
}

struct Cabecera: View {
    @EnvironmentObject var tv: TV
    @Binding var conexion: Bool

    var body: some View {
        HStack {
            Button { conexion = true } label: {
                HStack(spacing: 8) {
                    Circle().fill(color).frame(width: 9, height: 9)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("TV Libre").font(.headline)
                        Text(texto).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            .buttonStyle(.plain)
            Spacer()
            Button {
                vibrar(.medium)
                if tv.estado == .conectada { tv.apagar() } else { tv.encender() }
            } label: {
                Image(systemName: "power").font(.title3.weight(.semibold))
                    .frame(width: 46, height: 46)
                    .background(.ultraThinMaterial, in: Circle())
                    .foregroundStyle(tv.estado == .conectada ? .red : .white)
            }
            .disabled(tv.estado != .conectada && !tv.puedeEncender)
        }
        .padding(.horizontal, 20)
    }

    var color: Color {
        switch tv.estado {
        case .conectada: return .green
        case .conectando, .esperandoPermiso: return .yellow
        default: return .gray
        }
    }

    var texto: String {
        switch tv.estado {
        case .sinTV: return "Toca para elegir la TV"
        case .conectando: return "Conectando con \(tv.ip)…"
        case .esperandoPermiso: return "Acepta el aviso en la TV"
        case .conectada: return tv.ip
        case .error(let e): return e
        }
    }
}

// MARK: - Mando

struct Mando: View {
    @EnvironmentObject var tv: TV
    @State private var teclado = false

    var body: some View {
        VStack(spacing: 16) {
            Trackpad()
            HStack(spacing: 14) {
                Redondo(icono: "chevron.backward") { tv.boton("BACK") }
                Redondo(icono: "house.fill") { tv.inicio() }   // TV Libre, no el inicio de LG
                Redondo(icono: "keyboard") { teclado = true }
                Redondo(icono: "playpause.fill") { tv.boton("PLAY") }
                VStack(spacing: 8) {
                    Pastilla(icono: "plus") { tv.volumen(true) }
                    Pastilla(icono: "minus") { tv.volumen(false) }
                }
            }
            HStack(spacing: 12) {
                ForEach([("RED", Color.red), ("GREEN", .green), ("YELLOW", .yellow), ("BLUE", .blue)], id: \.0) { nombre, color in
                    Button { vibrar(); tv.boton(nombre) } label: {
                        Capsule().fill(color.opacity(0.85)).frame(height: 10)
                            .padding(.vertical, 14).padding(.horizontal, 10)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                }
                Button { vibrar(); tv.boton("MUTE") } label: {
                    Image(systemName: "speaker.slash.fill").frame(width: 44, height: 38)
                        .background(.ultraThinMaterial, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
        .sheet(isPresented: $teclado) { Teclado().presentationDetents([.height(220)]) }
    }
}

/** Deslizar = flecha (la dirección dominante), tocar = OK. Como el trackpad del mando de Apple TV. */
struct Trackpad: View {
    @EnvironmentObject var tv: TV
    @State private var pulsado = false

    var body: some View {
        RoundedRectangle(cornerRadius: 32, style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay(
                RoundedRectangle(cornerRadius: 32, style: .continuous)
                    .strokeBorder(LinearGradient(colors: [.white.opacity(0.45), .white.opacity(0.05)], startPoint: .top, endPoint: .bottom), lineWidth: 1)
            )
            .overlay(Text("Desliza para moverte · toca para OK").font(.footnote).foregroundStyle(.secondary).padding(.bottom, 18), alignment: .bottom)
            .scaleEffect(pulsado ? 0.98 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: pulsado)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in pulsado = true }
                    .onEnded { g in
                        pulsado = false
                        let dx = g.translation.width, dy = g.translation.height
                        if abs(dx) < 18 && abs(dy) < 18 {
                            vibrar(.medium)
                            tv.boton("ENTER")
                        } else {
                            vibrar()
                            tv.boton(abs(dx) > abs(dy) ? (dx > 0 ? "RIGHT" : "LEFT") : (dy > 0 ? "DOWN" : "UP"))
                        }
                    }
            )
            .frame(maxHeight: .infinity)
    }
}

struct Redondo: View {
    let icono: String
    let accion: () -> Void
    var body: some View {
        Button { vibrar(); accion() } label: {
            Image(systemName: icono).font(.title3.weight(.semibold))
                .frame(width: 58, height: 58)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

struct Pastilla: View {
    let icono: String
    let accion: () -> Void
    var body: some View {
        Button { vibrar(); accion() } label: {
            Image(systemName: icono).font(.body.weight(.bold))
                .frame(width: 58, height: 25)
                .background(.ultraThinMaterial, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

/** Lo que escribes aquí aparece en el campo de texto que tenga el foco en la TV. */
struct Teclado: View {
    @EnvironmentObject var tv: TV
    @State private var texto = ""
    @FocusState private var foco: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Escribir en la TV").font(.headline)
            TextField("Busca o escribe…", text: $texto)
                .textFieldStyle(.roundedBorder)
                .focused($foco)
                .submitLabel(.search)
                .onChange(of: texto) { nuevo in
                    // Solo se manda la diferencia: lo añadido o lo borrado
                    let anterior = ultimo
                    if nuevo.hasPrefix(anterior) { tv.escribir(String(nuevo.dropFirst(anterior.count))) }
                    else { tv.borrar(anterior.count); tv.escribir(nuevo) }
                    ultimo = nuevo
                }
                .onSubmit { tv.intro(); texto = ""; ultimo = "" }
            HStack {
                Text("Intro en el teclado envía la búsqueda.").font(.footnote).foregroundStyle(.secondary)
                Spacer()
                Button("Buscar en YouTube") {
                    let q = texto.trimmingCharacters(in: .whitespaces)
                    if !q.isEmpty { tv.buscarEnYouTube(q) }
                }
                .disabled(texto.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(24)
        .onAppear { foco = true }
    }
    @State private var ultimo = ""
}

// MARK: - Apps y entradas

struct Apps: View {
    @EnvironmentObject var tv: TV
    let columnas = [GridItem(.adaptive(minimum: 96), spacing: 14)]

    var body: some View {
        ScrollView {
            if !tv.entradas.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        Chip(texto: "TV", icono: "tv") { tv.abrir("com.webos.app.livetv") }
                        ForEach(tv.entradas) { e in Chip(texto: e.nombre, icono: "cable.connector") { tv.entrada(e.id) } }
                    }
                    .padding(.horizontal, 20)
                }
            }
            LazyVGrid(columns: columnas, spacing: 18) {
                ForEach(tv.apps) { app in
                    Button { vibrar(); tv.abrir(app.id) } label: { Icono(app: app) }
                        .buttonStyle(.plain)
                }
            }
            .padding(20)
            if tv.apps.isEmpty {
                Text(tv.estado == .conectada ? "Cargando apps…" : "Conecta con la TV para ver sus apps")
                    .foregroundStyle(.secondary).padding(.top, 40)
            }
        }
    }
}

struct Chip: View {
    let texto: String
    let icono: String
    let accion: () -> Void
    var body: some View {
        Button { vibrar(); accion() } label: {
            Label(texto, systemImage: icono).font(.subheadline.weight(.semibold))
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(.ultraThinMaterial, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct Icono: View {
    let app: AppTV
    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(app.color.map { Color(hex: $0) } ?? Color.white.opacity(0.12))
                if let url = app.icono {
                    AsyncImage(url: url) { $0.resizable().scaledToFit() } placeholder: { inicial }
                        .padding(14)
                } else {
                    inicial
                }
            }
            .frame(height: 64)
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(.white.opacity(0.15), lineWidth: 1))
            Text(app.nombre).font(.caption).lineLimit(1)
        }
    }
    var inicial: some View { Text(String(app.nombre.prefix(1))).font(.title.bold()) }
}

// MARK: - Fondos

struct Fondos: View {
    @EnvironmentObject var tv: TV
    @AppStorage("fondo") private var fondoElegido = "montanas-amanecer"
    @AppStorage("tema") private var tema = "auto"
    let columnas = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var grupos: [String] {
        var vistos: [String] = []
        for f in TV.fondos where !vistos.contains(f.grupo) { vistos.append(f.grupo) }
        return vistos
    }

    var body: some View {
        ScrollView {
            Picker("Tema", selection: $tema) {
                Text("Automático").tag("auto")
                Text("Claro").tag("claro")
                Text("Oscuro").tag("oscuro")
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 20)
            .onChange(of: tema) { tv.tema($0) }
            ForEach(grupos, id: \.self) { grupo in
                VStack(alignment: .leading, spacing: 10) {
                    Text(grupo).font(.title3.bold()).padding(.horizontal, 20)
                    LazyVGrid(columns: columnas, spacing: 12) {
                        ForEach(TV.fondos.filter { $0.grupo == grupo }) { f in
                            Button {
                                vibrar()
                                fondoElegido = f.id
                                tv.fondo(f.id)
                            } label: { Miniatura(fondo: f, elegido: f.id == fondoElegido) }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 20)
                }
                .padding(.top, 18)
            }
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
            LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .center, endPoint: .bottom)
            Text(fondo.nombre).font(.caption.weight(.semibold)).padding(10)
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(elegido ? .white : .white.opacity(0.12), lineWidth: elegido ? 3 : 1))
        .scaleEffect(elegido ? 1.02 : 1)
        .animation(.spring(response: 0.3), value: elegido)
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
                        Button(candidata) { ip = candidata }
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
