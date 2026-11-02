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

struct AppTV: Identifiable, Hashable {
    let id: String
    let nombre: String
    let icono: URL?
    let color: String?
}

struct EntradaTV: Identifiable, Hashable {
    let id: String
    let nombre: String
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

    private var sesion: URLSession!
    private var ordenes: URLSessionWebSocketTask?
    private var botones: URLSessionWebSocketTask?
    private var pendientes: [String: CheckedContinuation<[String: Any], Error>] = [:]
    private var siguiente = 0
    private var registro: CheckedContinuation<Void, Error>?

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
            await abrirBotones()
            await cargarListas()
            await guardarMAC()
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
    }

    /** Borra la clave y la huella guardadas de esta TV: la próxima vez se vuelve a emparejar. */
    func olvidar() {
        desconectar()
        for prefijo in ["clave:", "huella:", "mac:"] { UserDefaults.standard.removeObject(forKey: prefijo + ip) }
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

    /** El botón Home del móvil abre TV Libre, no el inicio de LG con anuncios. */
    func inicio() { abrir(ID_TV_LIBRE) }
    func fondo(_ id: String) { abrir(ID_TV_LIBRE, parametros: ["fondo": id]) }
    func tema(_ tema: String) { abrir(ID_TV_LIBRE, parametros: ["tema": tema]) }

    private func cargarListas() async {
        if let r = try? await pedir("ssap://com.webos.applicationManager/listLaunchPoints"),
           let lista = r["launchPoints"] as? [[String: Any]] {
            apps = lista.compactMap { a in
                guard let id = a["id"] as? String, id != ID_TV_LIBRE else { return nil }
                // Los iconos solo se pueden pedir si la TV los sirve por http; si es una ruta interna, se usa la inicial
                let ruta = (a["largeIcon"] as? String) ?? (a["icon"] as? String) ?? ""
                return AppTV(id: id, nombre: a["title"] as? String ?? id,
                             icono: ruta.hasPrefix("http") ? URL(string: ruta) : nil, color: a["bgColor"] as? String)
            }
        }
        if let r = try? await pedir("ssap://tv/getExternalInputList"),
           let lista = r["devices"] as? [[String: Any]] {
            entradas = lista.compactMap { e in
                guard let id = e["id"] as? String else { return nil }
                return EntradaTV(id: id, nombre: e["label"] as? String ?? id)
            }
        }
    }

    // MARK: - Encender (Wake-on-LAN)

    private func guardarMAC() async {
        guard let r = try? await pedir("ssap://com.webos.service.connectionmanager/getinfo") else { return }
        let mac = ((r["wiredInfo"] as? [String: Any])?["macAddress"] as? String)
            ?? ((r["wifiInfo"] as? [String: Any])?["macAddress"] as? String)
        if let mac, mac != "00:00:00:00:00:00" { UserDefaults.standard.set(mac, forKey: "mac:\(ip)") }
    }

    var puedeEncender: Bool { UserDefaults.standard.string(forKey: "mac:\(ip)") != nil }

    /**
     * Paquete mágico: 6 × 0xFF y la MAC 16 veces. iOS no deja enviar a la dirección de difusión sin un permiso
     * especial de Apple (multicast entitlement), así que se manda directo a la IP de la TV: funciona mientras el
     * router aún recuerda su MAC (normalmente un buen rato después de apagarla). En la TV hay que activar
     * "Encender TV con móvil".
     */
    func encender() {
        guard let mac = UserDefaults.standard.string(forKey: "mac:\(ip)") else { return }
        let bytes = mac.split(separator: ":").compactMap { UInt8($0, radix: 16) }
        guard bytes.count == 6 else { return }
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
        Task { try? await Task.sleep(nanoseconds: 6_000_000_000); await conectar() }
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
        var lista: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&lista) == 0, let primera = lista else { return nil }
        defer { freeifaddrs(lista) }
        for p in sequence(first: primera, next: { $0.pointee.ifa_next }) {
            let i = p.pointee
            guard String(cString: i.ifa_name) == "en0", let dir = i.ifa_addr, dir.pointee.sa_family == UInt8(AF_INET) else { continue }
            var nombre = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            getnameinfo(dir, socklen_t(dir.pointee.sa_len), &nombre, socklen_t(nombre.count), nil, 0, NI_NUMERICHOST)
            let partes = String(cString: nombre).split(separator: ".")
            if partes.count == 4 { return partes[0...2].joined(separator: ".") }
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
