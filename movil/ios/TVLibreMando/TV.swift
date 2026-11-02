import CryptoKit
import Foundation
import Network

/*
 * Conexión con la TV LG por SSAP, el protocolo de las apps de mando de LG.
 *
 *  - Órdenes: WebSocket wss://IP:3001 con mensajes JSON {type, id, uri, payload}.
 *  - Botones (flechas, OK, Atrás…): un segundo WebSocket que da la TV (getPointerInputSocket),
 *    con mensajes de texto "type:button\nname:UP\n\n".
 *  - La primera vez hay que emparejar: la TV pregunta en pantalla y devuelve una client-key que se guarda.
 *
 * El certificado de la TV es autofirmado. No se acepta cualquiera: en el primer emparejamiento se guarda
 * su huella SHA-256 y después solo se acepta ese (como la huella SSH en tools/install.py).
 */

/** id: el de TV Libre (la app, o el acceso fijado); se abre con appId y params. */
struct AppTV: Identifiable {
    let id: String
    let nombre: String
    let icono: URL?
    let color: String?
    var appId: String
    var params: [String: Any]? = nil
}

struct EntradaTV: Identifiable, Hashable {
    let id: String
    let nombre: String
    var appId: String = ""
}

/** Cómo tiene las apps la pantalla de TV Libre (lo manda la TV, ver avisarMovil en app/js/app.js). */
struct Disposicion: Codable, Equatable {
    var favoritas: [String] = []
    var ocultas: [String] = []
    var orden: [String] = []
}

struct Fondo: Identifiable, Decodable, Hashable {
    let id: String
    let nombre: String
    let grupo: String
    let miniatura: String?
    let colores: [String]?
}

enum ErrorTV: LocalizedError {
    case sinConexion, rechazado, huellaDistinta, respuesta(String)
    var errorDescription: String? {
        switch self {
        case .sinConexion: return "No hay conexión con la TV"
        case .rechazado: return "La TV rechazó el emparejamiento"
        case .huellaDistinta: return "El certificado de la TV ha cambiado. Si reinstalaste algo en la TV, olvídala y vuelve a emparejar."
        case .respuesta(let texto): return texto
        }
    }
}

let ID_TV_LIBRE = "com.tvlibre.inicio"
let PUERTO_MOVIL: UInt16 = 8765
// Las mismas que TV Libre oculta de fábrica mientras no se sepa cómo las tiene
let OCULTAS_DE_FABRICA = ["com.webos.", "com.palm.", "com.lge."]

@MainActor
final class TV: NSObject, ObservableObject {
    enum Estado: Equatable {
        case sinTV, conectando, esperandoPermiso, conectada, error(String)
    }

    @Published var estado: Estado = .sinTV
    @Published var ip: String = UserDefaults.standard.string(forKey: "ip") ?? ""
    @Published var apps: [AppTV] = []
    @Published var entradas: [EntradaTV] = []
    @Published var encontradas: [String] = []
    @Published var buscando = false
    @Published var disposicion: Disposicion?
    /** La app que se ve ahora en la TV (su appId), al día gracias a una suscripción. */
    @Published var ahora: String?

    private var sesion: URLSession!
    private var ordenes: URLSessionWebSocketTask?
    private var botones: URLSessionWebSocketTask?
    private var pendientes: [String: CheckedContinuation<[String: Any], Error>] = [:]
    private var siguiente = 0
    private var registro: CheckedContinuation<Void, Error>?
    private var suscripciones: [String: ([String: Any]) -> Void] = [:]
    private var oyente: NWListener?

    override init() {
        super.init()
        sesion = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: .main)
        if !ip.isEmpty { Task { await conectar() } }
    }

    // MARK: - Conexión y emparejamiento

    func conectar() async {
        guard !ip.isEmpty else { estado = .sinTV; return }
        desconectar()
        estado = .conectando
        disposicion = UserDefaults.standard.data(forKey: "disposicion:\(ip)").flatMap { try? JSONDecoder().decode(Disposicion.self, from: $0) }
        guard let url = URL(string: "wss://\(ip):3001") else { estado = .error("IP no válida"); return }
        let tarea = sesion.webSocketTask(with: url)
        ordenes = tarea
        tarea.resume()
        recibir(tarea)
        do {
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
                registro = c
                var carga = Self.manifiesto
                if let clave = UserDefaults.standard.string(forKey: "clave:\(ip)") { carga["client-key"] = clave }
                enviar(["type": "register", "id": "registro", "payload": carga])
            }
            estado = .conectada
            UserDefaults.standard.set(ip, forKey: "ip")
            escuchar()
            await abrirBotones()
            suscribir("ssap://com.webos.applicationManager/getForegroundAppInfo") { [weak self] r in
                guard let self, let app = r["appId"] as? String, !app.isEmpty, app != self.ahora else { return }
                self.ahora = app
                if app == ID_TV_LIBRE && self.disposicion == nil { self.pedirDisposicion() }
            }
            await cargarListas()
            await guardarMAC()
            pedirDisposicion()
        } catch {
            estado = .error(error.localizedDescription)
        }
    }

    func desconectar() {
        ordenes?.cancel(with: .goingAway, reason: nil)
        botones?.cancel(with: .goingAway, reason: nil)
        ordenes = nil
        botones = nil
        for (_, c) in pendientes { c.resume(throwing: ErrorTV.sinConexion) }
        pendientes = [:]
        suscripciones = [:]
        ahora = nil
        oyente?.cancel()
        oyente = nil
    }

    /** Borra la clave y la huella guardadas de esta TV: la próxima vez se vuelve a emparejar. */
    func olvidar() {
        desconectar()
        for prefijo in ["clave:", "huella:", "mac:", "disposicion:"] { UserDefaults.standard.removeObject(forKey: prefijo + ip) }
        UserDefaults.standard.removeObject(forKey: "ip")
        ip = ""
        apps = []
        entradas = []
        estado = .sinTV
    }

    private func enviar(_ mensaje: [String: Any]) {
        guard let datos = try? JSONSerialization.data(withJSONObject: mensaje),
              let texto = String(data: datos, encoding: .utf8) else { return }
        ordenes?.send(.string(texto)) { _ in }
    }

    private func recibir(_ tarea: URLSessionWebSocketTask) {
        tarea.receive { [weak self] resultado in
            Task { @MainActor in
                guard let self, tarea === self.ordenes else { return }
                switch resultado {
                case .failure(let error):
                    self.registro?.resume(throwing: error)
                    self.registro = nil
                    if self.estado == .conectada { self.estado = .error("Conexión perdida") }
                case .success(let mensaje):
                    if case .string(let texto) = mensaje { self.atender(texto) }
                    self.recibir(tarea)
                }
            }
        }
    }

    private func atender(_ texto: String) {
        guard let datos = texto.data(using: .utf8),
              let r = (try? JSONSerialization.jsonObject(with: datos)) as? [String: Any] else { return }
        let id = r["id"] as? String ?? ""
        let tipo = r["type"] as? String ?? ""
        let carga = r["payload"] as? [String: Any] ?? [:]
        if id == "registro" {
            switch tipo {
            case "registered":
                if let clave = carga["client-key"] as? String { UserDefaults.standard.set(clave, forKey: "clave:\(ip)") }
                registro?.resume()
                registro = nil
            case "error":
                registro?.resume(throwing: ErrorTV.rechazado)
                registro = nil
            default:
                if carga["pairingType"] as? String == "PROMPT" { estado = .esperandoPermiso }
            }
            return
        }
        if let s = suscripciones[id] { if tipo != "error" { s(carga) }; return }
        guard let c = pendientes.removeValue(forKey: id) else { return }
        if tipo == "error" || carga["returnValue"] as? Bool == false {
            c.resume(throwing: ErrorTV.respuesta(r["error"] as? String ?? carga["errorText"] as? String ?? "Error"))
        } else {
            c.resume(returning: carga)
        }
    }

    @discardableResult
    func pedir(_ uri: String, _ carga: [String: Any] = [:]) async throws -> [String: Any] {
        guard ordenes != nil, estado == .conectada else { throw ErrorTV.sinConexion }
        siguiente += 1
        let id = "p\(siguiente)"
        return try await withCheckedThrowingContinuation { c in
            pendientes[id] = c
            enviar(["type": "request", "id": id, "uri": uri, "payload": carga])
        }
    }

    /** Como pedir(), pero la TV sigue avisando cada vez que cambia. */
    private func suscribir(_ uri: String, _ alCambiar: @escaping ([String: Any]) -> Void) {
        guard ordenes != nil else { return }
        siguiente += 1
        let id = "s\(siguiente)"
        suscripciones[id] = alCambiar
        enviar(["type": "subscribe", "id": id, "uri": uri, "payload": [String: Any]()])
    }

    // MARK: - Botones

    private func abrirBotones() async {
        guard let r = try? await pedir("ssap://com.webos.service.networkinput/getPointerInputSocket"),
              let ruta = r["socketPath"] as? String, let url = URL(string: ruta) else { return }
        let tarea = sesion.webSocketTask(with: url)
        botones = tarea
        tarea.resume()
    }

    /** UP, DOWN, LEFT, RIGHT, ENTER, BACK, HOME, MUTE, RED, GREEN, YELLOW, BLUE, PLAY, PAUSE… */
    func boton(_ nombre: String) {
        if botones == nil || botones?.state != .running { Task { await abrirBotones(); botones?.send(.string("type:button\nname:\(nombre)\n\n")) { _ in } }; return }
        botones?.send(.string("type:button\nname:\(nombre)\n\n")) { _ in }
    }

    // MARK: - Órdenes

    func abrir(_ id: String, parametros: [String: Any]? = nil) {
        var carga: [String: Any] = ["id": id]
        if let parametros { carga["params"] = parametros }
        Task { try? await pedir("ssap://system.launcher/launch", carga) }
    }

    func entrada(_ id: String) { Task { try? await pedir("ssap://tv/switchInput", ["inputId": id]) } }
    func volumen(_ subir: Bool) { Task { try? await pedir(subir ? "ssap://audio/volumeUp" : "ssap://audio/volumeDown") } }
    func apagar() { Task { try? await pedir("ssap://system/turnOff") } }
    func escribir(_ texto: String) { Task { try? await pedir("ssap://com.webos.service.ime/insertText", ["text": texto, "replace": false]) } }
    func borrar(_ n: Int) { Task { try? await pedir("ssap://com.webos.service.ime/deleteCharacters", ["count": n]) } }
    func intro() { Task { try? await pedir("ssap://com.webos.service.ime/sendEnterKey") } }

    /// Abre YouTube directamente en su búsqueda (contentTarget acepta una dirección de youtube.com/tv).
    func buscarEnYouTube(_ texto: String) {
        var permitidos = CharacterSet.urlQueryAllowed
        permitidos.remove(charactersIn: "&=+#?")
        let q = texto.addingPercentEncoding(withAllowedCharacters: permitidos) ?? texto
        abrir("youtube.leanback.v4", parametros: ["contentTarget": "https://www.youtube.com/tv#/search?q=" + q])
    }

    /** El botón Home del móvil abre TV Libre, no el inicio de LG con anuncios. */
    func inicio() { abrir(ID_TV_LIBRE, parametros: conMovil([:])) }
    func fondo(_ id: String) { abrir(ID_TV_LIBRE, parametros: conMovil(["fondo": id])) }
    func tema(_ tema: String) { abrir(ID_TV_LIBRE, parametros: conMovil(["tema": tema])) }
    func abrir(_ app: AppTV) { abrir(app.appId, parametros: app.params) }

    /** Mantener OK: en TV Libre coge la app para moverla (el socket de botones solo sabe pulsar y soltar). */
    func mantenerOk() {
        if ahora == ID_TV_LIBRE { abrir(ID_TV_LIBRE, parametros: ["mantenerOk": true]) } else { boton("ENTER") }
    }

    /** Nombre e icono de lo que se ve ahora en la TV, para la cabecera. */
    var queSeVe: (nombre: String, icono: URL?)? {
        guard let app = ahora else { return nil }
        if app == ID_TV_LIBRE { return ("TV Libre", nil) }
        if app == "com.webos.app.livetv" { return ("TV", nil) }
        if let e = entradas.first(where: { $0.appId == app }) { return (e.nombre, nil) }
        if let a = apps.first(where: { $0.appId == app && $0.params == nil }) { return (a.nombre, a.icono) }
        return nil   // el inicio de LG, un ajuste…: no se enseña
    }

    // MARK: - Las apps como en TV Libre

    /** Favoritas y el resto, en el orden y sin las ocultas de la pantalla de TV Libre (ver ordenarApps y appsDeFila en app.js). */
    var filas: (favoritas: [AppTV], resto: [AppTV]) {
        let d = disposicion
        let ocultas = Set(d?.ocultas ?? apps.filter { a in OCULTAS_DE_FABRICA.contains { a.id.hasPrefix($0) } }.map(\.id))
        var pos: [String: Int] = [:]
        for (i, id) in (d?.orden ?? []).enumerated() where pos[id] == nil { pos[id] = i }
        // Ordenación estable: las que no tienen puesto se quedan en el orden de la TV
        let ordenadas = apps.enumerated().sorted { (pos[$0.element.id] ?? 1_000_000, $0.offset) < (pos[$1.element.id] ?? 1_000_000, $1.offset) }.map(\.element)
        let favIds = d?.favoritas ?? Array(ordenadas.filter { !ocultas.contains($0.id) }.prefix(7).map(\.id))
        var porId: [String: AppTV] = [:]
        for a in ordenadas where porId[a.id] == nil { porId[a.id] = a }
        let favoritas = favIds.compactMap { porId[$0] }.filter { !ocultas.contains($0.id) }
        let resto = ordenadas.filter { !favIds.contains($0.id) && !ocultas.contains($0.id) }
        return (favoritas, resto)
    }

    /** La dirección del móvil en la Wi-Fi, para que TV Libre le mande cómo tiene las apps. */
    private var direccionMovil: String? {
        guard oyente != nil, let propia = Self.ipPropia() else { return nil }
        return "http://\(propia):\(PUERTO_MOVIL)/"
    }

    private func conMovil(_ p: [String: Any]) -> [String: Any] {
        var p = p
        if let d = direccionMovil { p["movil"] = d }
        return p
    }

    /** Si TV Libre está delante, le pide que mande cómo tiene las apps (sin cambiar nada en la pantalla de la TV). */
    func pedirDisposicion() {
        guard let yo = direccionMovil else { return }
        Task {
            guard let r = try? await pedir("ssap://com.webos.applicationManager/getForegroundAppInfo"),
                  r["appId"] as? String == ID_TV_LIBRE else { return }
            abrir(ID_TV_LIBRE, parametros: ["movil": yo, "soloMovil": true])
        }
    }

    /** Un servidor HTTP mínimo, solo mientras la app está abierta, que solo acepta lo que manda la TV. */
    private func escuchar() {
        guard oyente == nil, let puerto = NWEndpoint.Port(rawValue: PUERTO_MOVIL),
              let o = try? NWListener(using: .tcp, on: puerto) else { return }
        let tvIP = ip
        o.newConnectionHandler = { [weak self] c in
            // Solo la TV: cualquier otro de la red se corta sin leer nada
            guard case .hostPort(let host, _) = c.endpoint,
                  "\(host)".split(separator: "%").first.map(String.init) == tvIP else { c.cancel(); return }
            c.start(queue: .global())
            Self.leerPeticion(c, Data()) { cuerpo in
                guard let cuerpo, let d = try? JSONDecoder().decode(Disposicion.self, from: cuerpo) else { return }
                Task { @MainActor in
                    guard let self else { return }
                    UserDefaults.standard.set(cuerpo, forKey: "disposicion:\(self.ip)")
                    if self.disposicion != d { self.disposicion = d }
                }
            }
        }
        o.start(queue: .global())
        oyente = o
    }

    /** Lee cabeceras y cuerpo (Content-Length), contesta 204 y cierra. */
    nonisolated private static func leerPeticion(_ c: NWConnection, _ hasta: Data, _ listo: @escaping @Sendable (Data?) -> Void) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { datos, _, fin, error in
            var todo = hasta
            if let datos { todo.append(datos) }
            let separador = Data("\r\n\r\n".utf8)
            if let rango = todo.range(of: separador) {
                let cabecera = String(decoding: todo[..<rango.lowerBound], as: UTF8.self)
                let largo = cabecera.split(separator: "\r\n").first { $0.lowercased().hasPrefix("content-length:") }
                    .flatMap { Int($0.split(separator: ":")[1].trimmingCharacters(in: .whitespaces)) } ?? 0
                let cuerpo = todo[rango.upperBound...]
                if cuerpo.count >= largo || fin || error != nil {
                    let respuesta = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    c.send(content: Data(respuesta.utf8), completion: .contentProcessed { _ in c.cancel() })
                    listo(cabecera.hasPrefix("POST") ? Data(cuerpo.prefix(largo)) : nil)
                    return
                }
            }
            if fin || error != nil || todo.count > 70000 { c.cancel(); listo(nil); return }
            leerPeticion(c, todo, listo)
        }
    }

    private func cargarListas() async {
        if let r = try? await pedir("ssap://com.webos.applicationManager/listLaunchPoints"),
           let lista = r["launchPoints"] as? [[String: Any]] {
            var vistos = Set<String>()
            apps = lista.compactMap { a in
                guard let appId = a["id"] as? String, appId != ID_TV_LIBRE else { return nil }
                // Como separarAccesos en app/js/luna.js: el acceso principal de cada app se conoce por su id;
                // los fijados (un vídeo de YouTube…), por su launchPointId, y se abren con sus params
                let lp = a["launchPointId"] as? String ?? ""
                let tipo = a["lptype"] as? String ?? ""
                let principal = !tipo.isEmpty ? tipo == "default" : (lp.isEmpty || lp == appId || lp.hasSuffix("_default"))
                let id = principal ? appId : (lp.isEmpty ? appId + ":" + (a["title"] as? String ?? "") : lp)
                guard vistos.insert(id).inserted else { return nil }
                // Los iconos solo se pueden pedir si la TV los sirve por http; si es una ruta interna, se usa la inicial
                let ruta = (a["largeIcon"] as? String) ?? (a["icon"] as? String) ?? ""
                return AppTV(id: id, nombre: a["title"] as? String ?? id,
                             icono: ruta.hasPrefix("http") ? URL(string: ruta) : nil, color: a["bgColor"] as? String,
                             appId: appId, params: principal ? nil : a["params"] as? [String: Any])
            }
        }
        if let r = try? await pedir("ssap://tv/getExternalInputList"),
           let lista = r["devices"] as? [[String: Any]] {
            entradas = lista.compactMap { e in
                guard let id = e["id"] as? String else { return nil }
                return EntradaTV(id: id, nombre: e["label"] as? String ?? id, appId: e["appId"] as? String ?? "")
            }
        }
    }

    // MARK: - Encender (Wake-on-LAN)

    private func guardarMAC() async {
        guard let r = try? await pedir("ssap://com.webos.service.connectionmanager/getinfo") else { return }
        // Las dos: la TV da la MAC del cable aunque esté por Wi-Fi, y solo despierta con la de la tarjeta que usa
        var macs: [String] = []
        for clave in ["wiredInfo", "wifiInfo"] {
            if let mac = (r[clave] as? [String: Any])?["macAddress"] as? String, !mac.isEmpty,
               mac != "00:00:00:00:00:00", !macs.contains(mac) { macs.append(mac) }
        }
        if !macs.isEmpty { UserDefaults.standard.set(macs.joined(separator: ","), forKey: "mac:\(ip)") }
    }

    var puedeEncender: Bool { UserDefaults.standard.string(forKey: "mac:\(ip)") != nil }

    /**
     * Paquete mágico: 6 × 0xFF y la MAC 16 veces. iOS no deja enviar a la dirección de difusión sin un permiso
     * especial de Apple (multicast entitlement), así que se manda directo a la IP de la TV: funciona mientras el
     * router aún recuerda su MAC (normalmente un buen rato después de apagarla). En la TV hay que activar
     * "Encender TV con móvil". Cuando la TV contesta se abre TV Libre: una app de desarrollador no puede
     * abrirse sola al encender.
     */
    func encender() {
        guard let macs = UserDefaults.standard.string(forKey: "mac:\(ip)") else { return }
        for mac in macs.split(separator: ",") {
            let bytes = mac.split(separator: ":").compactMap { UInt8($0, radix: 16) }
            guard bytes.count == 6 else { continue }
            var paquete = Data(repeating: 0xFF, count: 6)
            for _ in 0..<16 { paquete.append(contentsOf: bytes) }
            let datos = paquete
            for puerto: UInt16 in [9, 7] {
                let c = NWConnection(host: NWEndpoint.Host(ip), port: NWEndpoint.Port(rawValue: puerto)!, using: .udp)
                c.stateUpdateHandler = { estado in
                    if case .ready = estado { c.send(content: datos, completion: .contentProcessed { _ in c.cancel() }) }
                }
                c.start(queue: .global())
            }
        }
        // La TV tarda en arrancar: se reintenta hasta que conteste, y entonces se abre TV Libre
        Task {
            for i in 0..<10 {
                try? await Task.sleep(nanoseconds: i == 0 ? 6_000_000_000 : 4_000_000_000)
                if estado == .conectada { break }
                if estado != .conectando { await conectar() }
            }
            guard estado == .conectada else { return }
            try? await Task.sleep(nanoseconds: 2_500_000_000)   // que el sistema termine de arrancar antes
            inicio()
        }
    }

    // MARK: - Buscar la TV

    /**
     * Prueba el puerto 3001 en las 254 direcciones de la red del móvil. iOS no deja usar SSDP (multicast) sin
     * permiso especial de Apple, pero sí conexiones normales en la red local tras aceptar el aviso de iOS.
     */
    func buscar() async {
        guard let base = Self.redLocal() else { return }
        buscando = true
        encontradas = []
        await withTaskGroup(of: String?.self) { grupo in
            for i in 1...254 {
                let candidata = "\(base).\(i)"
                grupo.addTask { await Self.puertoAbierto(candidata, 3001) ? candidata : nil }
            }
            for await ip in grupo { if let ip { encontradas.append(ip) } }
        }
        buscando = false
    }

    nonisolated private static func puertoAbierto(_ host: String, _ puerto: UInt16) async -> Bool {
        await withCheckedContinuation { c in
            let conexion = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: puerto)!, using: .tcp)
            let cola = DispatchQueue(label: "buscar.\(host)")
            final class Una: @unchecked Sendable { var hecho = false }   // todo ocurre en `cola`
            let una = Una()
            let terminar: @Sendable (Bool) -> Void = { abierto in
                guard !una.hecho else { return }
                una.hecho = true
                conexion.cancel()
                c.resume(returning: abierto)
            }
            conexion.stateUpdateHandler = { estado in
                switch estado {
                case .ready: terminar(true)
                case .failed, .waiting: terminar(false)
                default: break
                }
            }
            conexion.start(queue: cola)
            cola.asyncAfter(deadline: .now() + 1.5) { terminar(false) }
        }
    }

    /** "192.168.1" a partir de la IP del móvil en la Wi-Fi (en0). */
    nonisolated private static func redLocal() -> String? {
        guard let propia = ipPropia() else { return nil }
        return propia.split(separator: ".")[0...2].joined(separator: ".")
    }

    /** La IP del móvil en la Wi-Fi (en0). */
    nonisolated static func ipPropia() -> String? {
        var lista: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&lista) == 0, let primera = lista else { return nil }
        defer { freeifaddrs(lista) }
        for p in sequence(first: primera, next: { $0.pointee.ifa_next }) {
            let i = p.pointee
            guard String(cString: i.ifa_name) == "en0", let dir = i.ifa_addr, dir.pointee.sa_family == UInt8(AF_INET) else { continue }
            var nombre = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(dir, socklen_t(dir.pointee.sa_len), &nombre, socklen_t(nombre.count), nil, 0, NI_NUMERICHOST)
            let texto = String(cString: nombre)
            if texto.split(separator: ".").count == 4 { return texto }
        }
        return nil
    }

    // MARK: - Datos compartidos con Android (movil/compartido)

    static let manifiesto: [String: Any] = {
        guard let url = Bundle.main.url(forResource: "ssap-registro", withExtension: "json"),
              let datos = try? Data(contentsOf: url),
              let json = try? JSONSerialization.jsonObject(with: datos) as? [String: Any] else { return [:] }
        return json
    }()

    static let fondos: [Fondo] = {
        guard let url = Bundle.main.url(forResource: "fondos", withExtension: "json"),
              let datos = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([Fondo].self, from: datos)) ?? []
    }()
}

// MARK: - Certificado de la TV: confiar en el primero, rechazar si cambia

extension TV: URLSessionDelegate {
    nonisolated func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
                                completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let confianza = challenge.protectionSpace.serverTrust,
              let cadena = SecTrustCopyCertificateChain(confianza) as? [SecCertificate],
              let certificado = cadena.first else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        let host = challenge.protectionSpace.host
        let huella = SHA256.hash(data: SecCertificateCopyData(certificado) as Data).map { String(format: "%02x", $0) }.joined()
        let clave = "huella:\(host)"
        if let guardada = UserDefaults.standard.string(forKey: clave), guardada != huella {
            completionHandler(.cancelAuthenticationChallenge, nil)
            Task { @MainActor in self.estado = .error(ErrorTV.huellaDistinta.localizedDescription) }
            return
        }
        UserDefaults.standard.set(huella, forKey: clave)
        completionHandler(.useCredential, URLCredential(trust: confianza))
    }
}
