// pont-safari : pont entre le serveur Python de claude-safari et Safari.
// Protocole : docs/PROTOCOLE-PONT.md (une ligne JSON par demande sur stdin, une par reponse sur stdout).
// Modes : "safari" (Apple Events vers le vrai Safari) et "banc" (WKWebView hors ecran, pour les tests).

import Cocoa
import WebKit
import ImageIO
import CoreText
import ScreenCaptureKit
import Speech
import AVFoundation
import CoreMedia
import CoreAudio
import UniformTypeIdentifiers

let VERSION = "1.0"

// MARK: - Types communs

struct PErr: Error {
    let code: String
    let msg: String
    init(_ code: String, _ msg: String) { self.code = code; self.msg = msg }
}

enum Resultat {
    case ok([String: Any])
    case ko(String, String)
}

typealias Rep = (Resultat) -> Void
typealias ImageRep = (Result<(CGImage, Double), PErr>) -> Void

func journal(_ s: String) {
    FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}

let sortieLock = NSLock()
func ecrireLigne(_ d: [String: Any]) {
    var data: Data
    if let x = try? JSONSerialization.data(withJSONObject: d, options: [.withoutEscapingSlashes]) {
        data = x
    } else {
        let repli: [String: Any] = ["id": d["id"] ?? NSNull(), "ok": false, "code": "INTERNE", "erreur": "reponse non serialisable"]
        data = (try? JSONSerialization.data(withJSONObject: repli, options: [])) ?? Data("{}".utf8)
    }
    data.append(10)
    sortieLock.lock()
    FileHandle.standardOutput.write(data)
    sortieLock.unlock()
}

func ecrireReponse(_ ident: Any, _ r: Resultat) {
    switch r {
    case .ok(let champs):
        var d = champs
        d["id"] = ident
        d["ok"] = true
        ecrireLigne(d)
    case .ko(let code, let msg):
        ecrireLigne(["id": ident, "ok": false, "code": code, "erreur": msg])
    }
}

final class Une {
    private var fait = false
    private let l = NSLock()
    func premiere() -> Bool {
        l.lock(); defer { l.unlock() }
        if fait { return false }
        fait = true
        return true
    }
}

// MARK: - Aides d'arguments

func entier(_ q: [String: Any], _ k: String) -> Int? {
    if let n = q[k] as? NSNumber { return n.intValue }
    return nil
}
func nombre(_ q: [String: Any], _ k: String) -> Double? {
    if let n = q[k] as? NSNumber { return n.doubleValue }
    return nil
}
func texte(_ q: [String: Any], _ k: String) -> String? {
    return q[k] as? String
}
func couleur3(_ q: [String: Any], _ k: String) -> [Int]? {
    guard let a = q[k] as? [Any] else { return nil }
    let v = a.compactMap { ($0 as? NSNumber)?.intValue }
    return v.count == 3 ? v : nil
}

// MARK: - Images (recadrage, echelle, encodage)

let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

func contexteOpaque(_ w: Int, _ h: Int) -> CGContext? {
    return CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: sRGB,
                     bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
}

func encoder(_ img: CGImage, png: Bool, qualite: Double) -> Data? {
    let data = NSMutableData()
    let type = png ? UTType.png.identifier : UTType.jpeg.identifier
    guard let dest = CGImageDestinationCreateWithData(data as CFMutableData, type as CFString, 1, nil) else { return nil }
    var props: [CFString: Any] = [:]
    if !png { props[kCGImageDestinationLossyCompressionQuality] = qualite }
    CGImageDestinationAddImage(dest, img, props as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return data as Data
}

/// Rogne (zone en points), met a l'echelle (largeur_sortie en pixels, jamais au-dela du natif), renvoie l'image opaque sRGB.
func preparerImage(_ img: CGImage, echelle: Double, q: [String: Any]) throws -> CGImage {
    var im = img
    if let z = q["zone"] as? [Any] {
        let v = z.compactMap { ($0 as? NSNumber)?.doubleValue }
        guard v.count == 4 else { throw PErr("ARGUMENT", "zone doit contenir 4 nombres [x0,y0,x1,y1]") }
        let r = CGRect(x: v[0] * echelle, y: v[1] * echelle, width: (v[2] - v[0]) * echelle, height: (v[3] - v[1]) * echelle)
            .integral.intersection(CGRect(x: 0, y: 0, width: img.width, height: img.height))
        guard !r.isNull, r.width >= 1, r.height >= 1, let c = img.cropping(to: r) else {
            throw PErr("ARGUMENT", "zone vide ou hors de la fenetre")
        }
        im = c
    }
    var w = im.width, h = im.height
    if let lo = nombre(q, "largeur_sortie"), lo >= 1, Int(lo) < w {
        h = max(1, Int((Double(h) * lo / Double(w)).rounded()))
        w = Int(lo)
    }
    guard let ctx = contexteOpaque(w, h) else { throw PErr("INTERNE", "contexte graphique impossible") }
    ctx.interpolationQuality = .high
    ctx.draw(im, in: CGRect(x: 0, y: 0, width: w, height: h))
    guard let out = ctx.makeImage() else { throw PErr("INTERNE", "image impossible") }
    return out
}

func faireCapture(_ b: Backend, _ q: [String: Any], _ rep: @escaping Rep) {
    guard let fen = entier(q, "fenetre") else { rep(.ko("ARGUMENT", "fenetre manquante")); return }
    let t0 = Date()
    b.image(fen) { r in
        switch r {
        case .failure(let e): rep(.ko(e.code, e.msg))
        case .success(let v):
            do {
                let im = try preparerImage(v.0, echelle: v.1, q: q)
                let png = (texte(q, "format") ?? "jpeg").lowercased() == "png"
                let qual = min(1, max(0, nombre(q, "qualite") ?? 0.8))
                guard let data = encoder(im, png: png, qualite: qual) else { rep(.ko("INTERNE", "encodage impossible")); return }
                if let f = texte(q, "fichier") {
                    do { try data.write(to: URL(fileURLWithPath: f)) }
                    catch { rep(.ko("ARGUMENT", "ecriture impossible : \(error.localizedDescription)")); return }
                }
                rep(.ok(["base64": data.base64EncodedString(), "largeur": im.width, "hauteur": im.height,
                         "ms": Int(Date().timeIntervalSince(t0) * 1000)]))
            } catch let e as PErr {
                rep(.ko(e.code, e.msg))
            } catch {
                rep(.ko("INTERNE", "\(error)"))
            }
        }
    }
}

/// Cherche les pixels proches de c1 puis c2 (+-14 par canal) dans une image deja capturee.
func calibrerImage(_ img: CGImage, echelle: Double, c1: [Int], c2: [Int]) -> [String: Any] {
    let w = img.width, h = img.height
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: sRGB,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
          let base = ctx.data else {
        return ["trouve": false, "x0": 0, "y0": 0, "x1": 0, "y1": 0, "echelle": echelle]
    }
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    let px = base.bindMemory(to: UInt8.self, capacity: w * h * 4)
    let tol = 14
    func boite(_ c: [Int]) -> (Int, Int, Int, Int)? {
        var minX = Int.max, minY = Int.max, maxX = -1, maxY = -1
        for y in 0..<h {
            let ligne = y * w * 4
            for x in 0..<w {
                let o = ligne + x * 4
                if abs(Int(px[o]) - c[0]) <= tol && abs(Int(px[o + 1]) - c[1]) <= tol && abs(Int(px[o + 2]) - c[2]) <= tol {
                    if x < minX { minX = x }
                    if x > maxX { maxX = x }
                    if y < minY { minY = y }
                    if y > maxY { maxY = y }
                }
            }
        }
        return maxX < 0 ? nil : (minX, minY, maxX, maxY)
    }
    guard let b1 = boite(c1), let b2 = boite(c2) else {
        return ["trouve": false, "x0": 0, "y0": 0, "x1": 0, "y1": 0, "echelle": echelle]
    }
    return ["trouve": true, "x0": Double(b1.0) / echelle, "y0": Double(b1.1) / echelle,
            "x1": Double(b2.2 + 1) / echelle, "y1": Double(b2.3 + 1) / echelle, "echelle": echelle]
}

// MARK: - GIF

let orange = CGColor(srgbRed: 0xD9 / 255.0, green: 0x77 / 255.0, blue: 0x57 / 255.0, alpha: 1)
let rouge = CGColor(srgbRed: 0.88, green: 0.14, blue: 0.14, alpha: 1)

func ligneTexte(_ s: String, taille: CGFloat, couleur: CGColor) -> CTLine {
    let font = CTFontCreateWithName("Helvetica-Bold" as CFString, taille, nil)
    let attrs: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): couleur,
    ]
    return CTLineCreateWithAttributedString(NSAttributedString(string: s, attributes: attrs))
}
func largeurLigne(_ l: CTLine) -> CGFloat {
    return CGFloat(CTLineGetTypographicBounds(l, nil, nil, nil))
}

func dessinerImageGif(_ src: CGImage, annotations: [[String: Any]], largeurCible: Int?, index: Int, total: Int,
                      barre: Bool, filigrane: String?) -> CGImage? {
    var r = 1.0
    if let lc = largeurCible, lc > 0, lc < src.width { r = Double(lc) / Double(src.width) }
    let w = max(1, Int((Double(src.width) * r).rounded()))
    let h = max(1, Int((Double(src.height) * r).rounded()))
    guard let ctx = contexteOpaque(w, h) else { return nil }
    ctx.interpolationQuality = .high
    ctx.draw(src, in: CGRect(x: 0, y: 0, width: w, height: h))
    let W = CGFloat(w), H = CGFloat(h)
    func Y(_ y: Double) -> CGFloat { return H - CGFloat(y * r) }
    func X(_ x: Double) -> CGFloat { return CGFloat(x * r) }

    for a in annotations {
        let type = (a["type"] as? String) ?? ""
        switch type {
        case "clic":
            let cx = X(nombre(a, "x") ?? 0), cy = Y(nombre(a, "y") ?? 0)
            let rayon = max(16, W * 0.025)
            ctx.setFillColor(orange.copy(alpha: 0.28)!)
            ctx.fillEllipse(in: CGRect(x: cx - rayon, y: cy - rayon, width: rayon * 2, height: rayon * 2))
            ctx.setStrokeColor(orange)
            ctx.setLineWidth(max(4, W * 0.004))
            ctx.strokeEllipse(in: CGRect(x: cx - rayon, y: cy - rayon, width: rayon * 2, height: rayon * 2))
        case "glisser":
            let ax = X(nombre(a, "x0") ?? 0), ay = Y(nombre(a, "y0") ?? 0)
            let bx = X(nombre(a, "x1") ?? 0), by = Y(nombre(a, "y1") ?? 0)
            let ep = max(4, W * 0.005)
            ctx.setStrokeColor(rouge)
            ctx.setLineWidth(ep)
            ctx.setLineCap(.round)
            ctx.move(to: CGPoint(x: ax, y: ay))
            ctx.addLine(to: CGPoint(x: bx, y: by))
            ctx.strokePath()
            let ang = atan2(by - ay, bx - ax)
            let tete = max(14, W * 0.02)
            for d in [CGFloat.pi * 5 / 6, -CGFloat.pi * 5 / 6] {
                ctx.move(to: CGPoint(x: bx, y: by))
                ctx.addLine(to: CGPoint(x: bx + tete * cos(ang + d), y: by + tete * sin(ang + d)))
                ctx.strokePath()
            }
        case "texte":
            let t = (a["texte"] as? String) ?? ""
            let bh = max(28, H * 0.07)
            ctx.setFillColor(CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.85))
            ctx.fill(CGRect(x: 0, y: 0, width: W, height: bh))
            var taille = bh * 0.45
            var l = ligneTexte(t, taille: taille, couleur: CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
            if largeurLigne(l) > W - 20 {
                taille = max(8, taille * (W - 20) / largeurLigne(l))
                l = ligneTexte(t, taille: taille, couleur: CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
            }
            ctx.textMatrix = .identity
            ctx.textPosition = CGPoint(x: max(10, (W - largeurLigne(l)) / 2), y: bh / 2 - taille * 0.35)
            CTLineDraw(l, ctx)
        default:
            break
        }
    }
    if let f = filigrane, !f.isEmpty {
        let taille = max(11, H * 0.025)
        let l = ligneTexte(f, taille: taille, couleur: CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.85))
        let ombre = ligneTexte(f, taille: taille, couleur: CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.6))
        let x = W - largeurLigne(l) - 10
        let y: CGFloat = (barre ? 4 : 0) + 8
        ctx.textMatrix = .identity
        ctx.textPosition = CGPoint(x: x + 1, y: y - 1)
        CTLineDraw(ombre, ctx)
        ctx.textPosition = CGPoint(x: x, y: y)
        CTLineDraw(l, ctx)
    }
    if barre && total > 0 {
        ctx.setFillColor(orange)
        ctx.fill(CGRect(x: 0, y: 0, width: W * CGFloat(index + 1) / CGFloat(total), height: 4))
    }
    return ctx.makeImage()
}

func faireGif(_ q: [String: Any], _ rep: Rep) {
    guard let images = q["images"] as? [[String: Any]], !images.isEmpty else { rep(.ko("ARGUMENT", "images manquantes")); return }
    guard let sortie = texte(q, "sortie") else { rep(.ko("ARGUMENT", "sortie manquante")); return }
    let opt = (q["options"] as? [String: Any]) ?? [:]
    let barre = (opt["barre"] as? Bool) ?? false
    let filigrane = opt["filigrane"] as? String
    let largeur = entier(opt, "largeur")
    let url = URL(fileURLWithPath: sortie)
    // On prepare toutes les images AVANT de creer la destination : ImageIO laisse un fichier temporaire si on abandonne.
    var cadres: [(CGImage, Double)] = []
    for (i, im) in images.enumerated() {
        guard let f = texte(im, "fichier") else { rep(.ko("ARGUMENT", "images[\(i)].fichier manquant")); return }
        guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: f) as CFURL, nil),
              let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
            rep(.ko("ARGUMENT", "image illisible : \(f)")); return
        }
        let ann = (im["annotations"] as? [[String: Any]]) ?? []
        guard let dessin = dessinerImageGif(cg, annotations: ann, largeurCible: largeur, index: i, total: images.count,
                                            barre: barre, filigrane: filigrane) else {
            rep(.ko("INTERNE", "dessin impossible")); return
        }
        cadres.append((dessin, max(0.02, (nombre(im, "duree_ms") ?? 800) / 1000.0)))
    }
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.gif.identifier as CFString, cadres.count, nil) else {
        rep(.ko("ARGUMENT", "impossible d'ecrire \(sortie)")); return
    }
    let fileProps: [CFString: Any] = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]]
    CGImageDestinationSetProperties(dest, fileProps as CFDictionary)
    for (dessin, duree) in cadres {
        let frame: [CFString: Any] = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: duree]]
        CGImageDestinationAddImage(dest, dessin, frame as CFDictionary)
    }
    guard CGImageDestinationFinalize(dest) else { rep(.ko("INTERNE", "encodage GIF impossible")); return }
    // ImageIO ecrit "GIF87a" alors que le fichier contient des extensions 89a (delais, boucle) : on corrige l'en-tete.
    if var brut = try? Data(contentsOf: url), brut.count > 6, brut.prefix(6) == Data("GIF87a".utf8) {
        brut[4] = 0x39
        try? brut.write(to: url)
    }
    let taille = ((try? FileManager.default.attributesOfItem(atPath: sortie))?[.size] as? NSNumber)?.intValue ?? 0
    rep(.ok(["fichier": sortie, "octets": taille, "images": images.count]))
}

// MARK: - Dialogue (mode safari)

func dialogueReel(_ q: [String: Any], _ rep: Rep) {
    let alert = NSAlert()
    alert.messageText = texte(q, "titre") ?? ""
    alert.informativeText = texte(q, "message") ?? ""
    let boutons = (q["boutons"] as? [Any])?.compactMap { $0 as? String } ?? []
    let liste = boutons.isEmpty ? ["OK"] : boutons
    for b in liste { alert.addButton(withTitle: b) }
    let delai = nombre(q, "delai_s") ?? 60
    var expire = false
    let t = Timer(timeInterval: max(0.1, delai), repeats: false) { _ in
        expire = true
        NSApp.abortModal()
    }
    RunLoop.main.add(t, forMode: .common)
    NSApp.activate(ignoringOtherApps: true)
    let r = alert.runModal()
    t.invalidate()
    let i = r.rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
    if expire || i < 0 || i >= liste.count {
        rep(.ok(["bouton": NSNull()]))
    } else {
        rep(.ok(["bouton": liste[i]]))
    }
}

// MARK: - Interface des deux modes

protocol Backend {
    func fenetreCreer(_ url: String, _ rep: @escaping Rep)
    func onglets(_ fen: Int, _ leger: Bool, _ rep: @escaping Rep)
    func ongletCreer(_ fen: Int, _ url: String, _ rep: @escaping Rep)
    func ongletFermer(_ fen: Int, _ idx: Int, _ rep: @escaping Rep)
    func ongletUrl(_ fen: Int, _ idx: Int, _ url: String, _ rep: @escaping Rep)
    func ongletCourant(_ fen: Int, _ idx: Int, _ rep: @escaping Rep)
    func fenetreAvant(_ fen: Int, _ rep: @escaping Rep)
    func fenetreFermer(_ fen: Int, _ rep: @escaping Rep)
    func js(_ fen: Int, _ idx: Int, _ code: String, _ delai: Double, _ rep: @escaping Rep)
    func devant(_ rep: @escaping Rep)
    func bornes(_ fen: Int, _ rep: @escaping Rep)
    func bornesPoser(_ fen: Int, _ l: Double, _ h: Double, _ rep: @escaping Rep)
    func image(_ fen: Int, _ rep: @escaping ImageRep)
    func calibrer(_ fen: Int, _ c1: [Int], _ c2: [Int], _ rep: @escaping Rep)
    func dialogue(_ q: [String: Any], _ rep: @escaping Rep)
    var nom: String { get }
}

// MARK: - Mode banc (WKWebView)

final class BancFenetre {
    let id: Int
    let win: NSWindow
    var vues: [WKWebView] = []
    var courant = 0
    init(id: Int, win: NSWindow) { self.id = id; self.win = win }
}

var capteurSource: String? = nil

func texteDeValeur(_ v: Any?) -> Any {
    guard let v = v, !(v is NSNull) else { return NSNull() }
    if let s = v as? String { return s }
    if let n = v as? NSNumber {
        if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "true" : "false" }
        return n.stringValue
    }
    if JSONSerialization.isValidJSONObject(v),
       let d = try? JSONSerialization.data(withJSONObject: v, options: [.withoutEscapingSlashes]),
       let s = String(data: d, encoding: .utf8) { return s }
    return "\(v)"
}

final class Banc: Backend {
    let nom = "banc"
    var fenetres: [Int: BancFenetre] = [:]
    var prochain = 1001

    func fen(_ id: Int) throws -> BancFenetre {
        guard let f = fenetres[id] else { throw PErr("FENETRE_INTROUVABLE", "fenetre \(id) introuvable") }
        return f
    }
    func vue(_ f: BancFenetre, _ idx: Int) throws -> WKWebView {
        guard idx >= 1, idx <= f.vues.count else { throw PErr("ONGLET_INTROUVABLE", "onglet \(idx) introuvable dans la fenetre \(f.id)") }
        return f.vues[idx - 1]
    }
    func nouvelleVue(_ f: BancFenetre, _ url: String) throws -> WKWebView {
        guard let u = URL(string: url) else { throw PErr("ARGUMENT", "url invalide : \(url)") }
        let cfg = WKWebViewConfiguration()
        if let s = capteurSource {
            cfg.userContentController.addUserScript(WKUserScript(source: s, injectionTime: .atDocumentStart,
                                                                 forMainFrameOnly: true, in: .page))
        }
        let cv = f.win.contentView!
        let v = WKWebView(frame: cv.bounds, configuration: cfg)
        v.autoresizingMask = [.width, .height]
        cv.addSubview(v)
        v.load(URLRequest(url: u))
        return v
    }
    func montrer(_ f: BancFenetre) {
        for (i, v) in f.vues.enumerated() { v.isHidden = (i != f.courant) }
    }

    func essayer(_ rep: Rep, _ corps: () throws -> [String: Any]) {
        do { rep(.ok(try corps())) }
        catch let e as PErr { rep(.ko(e.code, e.msg)) }
        catch { rep(.ko("INTERNE", "\(error)")) }
    }

    func fenetreCreer(_ url: String, _ rep: @escaping Rep) {
        essayer(rep) {
            let win = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: 1280, height: 800),
                               styleMask: [.borderless], backing: .buffered, defer: false)
            win.isReleasedWhenClosed = false
            let f = BancFenetre(id: prochain, win: win)
            prochain += 1
            // Essais : PONT_BANC_EPINGLES=n imite n onglets épinglés, que Safari met en tête de chaque nouvelle fenêtre
            let epingles = Int(ProcessInfo.processInfo.environment["PONT_BANC_EPINGLES"] ?? "") ?? 0
            for _ in 0..<max(0, epingles) { f.vues.append(try nouvelleVue(f, "about:blank#epingle")) }
            f.vues.append(try nouvelleVue(f, url))
            f.courant = f.vues.count - 1
            fenetres[f.id] = f
            montrer(f)
            return ["fenetre": f.id]
        }
    }
    func onglets(_ id: Int, _ leger: Bool, _ rep: @escaping Rep) {
        essayer(rep) {
            let f = try fen(id)
            var liste: [[String: Any]] = []
            for (i, v) in f.vues.enumerated() {
                liste.append(["index": i + 1, "url": v.url?.absoluteString ?? "", "titre": v.title ?? ""])
            }
            return ["onglets": liste, "courant": f.courant + 1]
        }
    }
    func ongletCreer(_ id: Int, _ url: String, _ rep: @escaping Rep) {
        essayer(rep) {
            let f = try fen(id)
            f.vues.append(try nouvelleVue(f, url))
            f.courant = f.vues.count - 1
            montrer(f)
            return ["index": f.vues.count]
        }
    }
    func ongletFermer(_ id: Int, _ idx: Int, _ rep: @escaping Rep) {
        essayer(rep) {
            let f = try fen(id)
            let v = try vue(f, idx)
            v.stopLoading()
            v.removeFromSuperview()
            f.vues.remove(at: idx - 1)
            if f.vues.isEmpty {
                f.win.close()
                fenetres[id] = nil
            } else {
                if idx - 1 < f.courant { f.courant -= 1 }
                f.courant = min(f.courant, f.vues.count - 1)
                montrer(f)
            }
            return [:]
        }
    }
    func ongletUrl(_ id: Int, _ idx: Int, _ url: String, _ rep: @escaping Rep) {
        essayer(rep) {
            let v = try vue(try fen(id), idx)
            guard let u = URL(string: url) else { throw PErr("ARGUMENT", "url invalide : \(url)") }
            v.load(URLRequest(url: u))
            return [:]
        }
    }
    func ongletCourant(_ id: Int, _ idx: Int, _ rep: @escaping Rep) {
        essayer(rep) {
            let f = try fen(id)
            _ = try vue(f, idx)
            f.courant = idx - 1
            montrer(f)
            return [:]
        }
    }
    func fenetreAvant(_ id: Int, _ rep: @escaping Rep) {
        essayer(rep) { _ = try fen(id); return [:] }
    }
    func fenetreFermer(_ id: Int, _ rep: @escaping Rep) {
        essayer(rep) {
            let f = try fen(id)
            f.win.orderOut(nil)
            fenetres[id] = nil
            return [:]
        }
    }
    func js(_ id: Int, _ idx: Int, _ code: String, _ delai: Double, _ rep: @escaping Rep) {
        let v: WKWebView
        do { v = try vue(try fen(id), idx) }
        catch let e as PErr { rep(.ko(e.code, e.msg)); return }
        catch { rep(.ko("INTERNE", "\(error)")); return }
        let une = Une()
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0.1, delai)) {
            if une.premiere() { rep(.ko("DELAI", "le script n'a pas fini en \(Int(delai)) s")) }
        }
        v.evaluateJavaScript(code) { res, err in
            guard une.premiere() else { return }
            if let err = err {
                let ns = err as NSError
                let m = (ns.userInfo["WKJavaScriptExceptionMessage"] as? String) ?? ns.localizedDescription
                rep(.ko("JS_ERREUR", m))
            } else {
                rep(.ok(["resultat": texteDeValeur(res)]))
            }
        }
    }
    func devant(_ rep: @escaping Rep) {
        essayer(rep) {
            guard let id = fenetres.keys.min(), let f = fenetres[id] else {
                throw PErr("FENETRE_INTROUVABLE", "aucune fenetre")
            }
            let v = f.vues[f.courant]
            let s = f.win.contentView!.bounds.size
            return ["fenetre": f.id, "index": f.courant + 1, "url": v.url?.absoluteString ?? "", "titre": v.title ?? "",
                    "x": 0, "y": 0, "largeur": Double(s.width), "hauteur": Double(s.height)]
        }
    }
    func bornes(_ id: Int, _ rep: @escaping Rep) {
        essayer(rep) {
            let f = try fen(id)
            let s = f.win.contentView!.bounds.size
            return ["x": 0, "y": 0, "largeur": Double(s.width), "hauteur": Double(s.height)]
        }
    }
    func bornesPoser(_ id: Int, _ l: Double, _ h: Double, _ rep: @escaping Rep) {
        let f: BancFenetre
        do { f = try fen(id) }
        catch let e as PErr { rep(.ko(e.code, e.msg)); return }
        catch { rep(.ko("INTERNE", "\(error)")); return }
        guard l >= 1, h >= 1 else { rep(.ko("ARGUMENT", "largeur et hauteur doivent etre positives")); return }
        f.win.setContentSize(NSSize(width: l, height: h))
        for v in f.vues { v.frame = f.win.contentView!.bounds }
        // laisse WebKit appliquer la nouvelle taille avant de repondre
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { rep(.ok([:])) }
    }
    func image(_ id: Int, _ rep: @escaping ImageRep) {
        let f: BancFenetre
        do { f = try fen(id) }
        catch let e as PErr { rep(.failure(e)); return }
        catch { rep(.failure(PErr("INTERNE", "\(error)"))); return }
        let v = f.vues[f.courant]
        let cfg = WKSnapshotConfiguration()
        v.takeSnapshot(with: cfg) { img, err in
            guard let img = img, let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
                rep(.failure(PErr("INTERNE", "snapshot impossible : \(err?.localizedDescription ?? "inconnu")"))); return
            }
            let echelle = Double(cg.width) / Double(max(1, v.bounds.width))
            rep(.success((cg, echelle)))
        }
    }
    func calibrer(_ id: Int, _ c1: [Int], _ c2: [Int], _ rep: @escaping Rep) {
        essayer(rep) {
            let f = try fen(id)
            let s = f.win.contentView!.bounds.size
            return ["trouve": true, "x0": 0, "y0": 0, "x1": Double(s.width), "y1": Double(s.height),
                    "echelle": Double(f.win.backingScaleFactor)]
        }
    }
    func dialogue(_ q: [String: Any], _ rep: @escaping Rep) {
        if let r = ProcessInfo.processInfo.environment["PONT_BANC_DIALOGUE"] {
            rep(.ok(["bouton": r]))
        } else {
            rep(.ok(["bouton": NSNull()]))
        }
    }
}

// MARK: - Mode safari (Apple Events)

let sourceAppleScript = """
on ping()
	return "ok"
end ping

on verifier(w, i)
	tell application "Safari"
		if not (exists window id w) then error "FENETRE_INTROUVABLE" number 9001
		if i > 0 then
			if i > (count of tabs of window id w) then error "ONGLET_INTROUVABLE" number 9002
		end if
	end tell
end verifier

on fenetre_creer(u)
	-- La fenêtre de Claude est celle qui N'EXISTAIT PAS avant. Jamais « la fenêtre de devant » : c'est celle
	-- de la personne (le 21/11, ce repli a fait agir les essais dans ses onglets). Pas trouvée : erreur, on ne devine pas.
	-- Deux Claude peuvent ouvrir leur fenêtre au même moment : chacun marque son adresse (après « # ») et ne prend que
	-- la nouvelle fenêtre qui porte SA marque.
	set marque to ""
	if u contains "#" then
		set AppleScript's text item delimiters to "#"
		set marque to last text item of u
		set AppleScript's text item delimiters to ""
	end if
	tell application "Safari"
		set avant to id of every window
		make new document with properties {URL:u}
		repeat 60 times
			set apres to id of every window
			repeat with i in apres
				set w to contents of i
				if avant does not contain w then
					if marque is "" then return w
					try
						if (URL of current tab of window id w) contains marque then return w
					end try
				end if
			end repeat
			delay 0.05
		end repeat
	end tell
	error "FENETRE_INTROUVABLE : la nouvelle fenetre de Claude n'a pas ete retrouvee" number 9001
end fenetre_creer

on onglets(w, leger)
	-- Trois événements Apple en tout, quel que soit le nombre d'onglets (c'est ce qui coûte du temps).
	tell application "Safari"
		try
			set us to URL of every tab of window id w
		on error
			error "FENETRE_INTROUVABLE" number 9001
		end try
		set ns to {}
		set c to 0
		if leger is 0 then
			set ns to name of every tab of window id w
			set c to 1
			try
				set c to index of current tab of window id w
			end try
		end if
	end tell
	set r to {}
	repeat with k from 1 to (count of us)
		set tu to item k of us
		if tu is missing value then set tu to ""
		set tn to ""
		try
			set tn to item k of ns
			if tn is missing value then set tn to ""
		end try
		set end of r to {tu as text, tn as text}
	end repeat
	return {c, r}
end onglets

on onglet_creer(w, u)
	verifier(w, 0)
	tell application "Safari"
		set nt to make new tab at end of tabs of window id w with properties {URL:u}
		set current tab of window id w to nt
		return count of tabs of window id w
	end tell
end onglet_creer

on onglet_fermer(w, i)
	verifier(w, i)
	tell application "Safari"
		close tab i of window id w
	end tell
	return "ok"
end onglet_fermer

on onglet_url(w, i, u)
	verifier(w, i)
	tell application "Safari"
		set URL of tab i of window id w to u
	end tell
	return "ok"
end onglet_url

on onglet_courant(w, i)
	verifier(w, i)
	tell application "Safari"
		set current tab of window id w to tab i of window id w
	end tell
	return "ok"
end onglet_courant

on fenetre_avant(w)
	-- Montre la fenêtre de Claude : devant les autres fenêtres de Safari, et Safari devant les autres apps.
	tell application "Safari"
		set index of window id w to 1
		activate
	end tell
	return "ok"
end fenetre_avant

on fenetre_fermer(w)
	tell application "Safari" to close window id w
	return "ok"
end fenetre_fermer

on js(w, i, lecode, d)
	-- Un seul événement Apple quand tout va bien ; on ne cherche la cause qu'en cas d'erreur.
	try
		tell application "Safari"
			with timeout of d seconds
				return do JavaScript lecode in tab i of window id w
			end timeout
		end tell
	on error msg number n
		verifier(w, i)
		error msg number n
	end try
end js

on devant()
	-- Une seule lecture de la fenetre de devant et de son onglet affiche (aucun effet sur Safari).
	tell application "Safari"
		if (count of windows) is 0 then error "FENETRE_INTROUVABLE" number 9001
		set fw to front window
		set wid to id of fw
		set b to bounds of fw
		set tc to current tab of fw
		set ti to index of tc
		set tu to URL of tc
		set tn to name of tc
	end tell
	if tu is missing value then set tu to ""
	if tn is missing value then set tn to ""
	return {wid, ti, tu as text, tn as text, item 1 of b, item 2 of b, item 3 of b, item 4 of b}
end devant

on bornes(w)
	verifier(w, 0)
	tell application "Safari"
		return bounds of window id w
	end tell
end bornes

on bornes_poser(w, lw, lh)
	verifier(w, 0)
	tell application "Safari"
		set b to bounds of window id w
		set bounds of window id w to {item 1 of b, item 2 of b, (item 1 of b) + lw, (item 2 of b) + lh}
	end tell
	return "ok"
end bornes_poser
"""

let typeNullAE: DescType = 0x6E75_6C6C   // 'null'
let typeTrueAE: DescType = 0x7472_7565   // 'true'
let typeFalseAE: DescType = 0x6661_6C73  // 'fals'

var cacheSC: (Date, SCShareableContent)? = nil

final class Safari: Backend {
    let nom = "safari"
    var script: NSAppleScript?
    var erreurCompilation: String?

    init() {
        let s = NSAppleScript(source: sourceAppleScript)
        var info: NSDictionary?
        if let s = s, s.compileAndReturnError(&info) {
            script = s
        } else {
            erreurCompilation = (info?["NSAppleScriptErrorMessage"] as? String) ?? "compilation AppleScript impossible"
            journal("compilation AppleScript : \(erreurCompilation!)")
        }
    }

    func traduire(_ info: NSDictionary?, _ op: String) -> PErr {
        let num = (info?["NSAppleScriptErrorNumber"] as? NSNumber)?.intValue ?? 0
        let msg = (info?["NSAppleScriptErrorMessage"] as? String) ?? (info?["NSAppleScriptErrorBriefMessage"] as? String) ?? "erreur AppleScript"
        let bas = msg.lowercased()
        if bas.contains("allow javascript from apple events") || bas.contains("événements apple") || bas.contains("evenements apple") {
            return PErr("JS_APPLE_EVENTS_DESACTIVE", msg)
        }
        switch num {
        case -1743: return PErr("AUTOMATISATION_REFUSEE", msg)
        case 9001: return PErr("FENETRE_INTROUVABLE", "fenetre introuvable")
        case 9002: return PErr("ONGLET_INTROUVABLE", "onglet introuvable")
        case -1728, -1719: return PErr(op == "js" ? "ONGLET_INTROUVABLE" : "FENETRE_INTROUVABLE", msg)
        case -1712: return PErr("DELAI", msg)
        default: return PErr(op == "js" ? "JS_ERREUR" : "INTERNE", "\(msg) (\(num))")
        }
    }

    func appeler(_ nom: String, _ params: [NSAppleEventDescriptor]) -> Result<NSAppleEventDescriptor, PErr> {
        guard let script = script else { return .failure(PErr("INTERNE", erreurCompilation ?? "AppleScript non compile")) }
        let ev = NSAppleEventDescriptor(eventClass: 0x6173_6372,   // 'ascr' kASAppleScriptSuite
                                        eventID: 0x7073_6272,      // 'psbr' kASSubroutineEvent
                                        targetDescriptor: NSAppleEventDescriptor.currentProcess(),
                                        returnID: -1, transactionID: 0)
        ev.setParam(NSAppleEventDescriptor(string: nom.lowercased()), forKeyword: 0x736E_616D)  // 'snam'
        let liste = NSAppleEventDescriptor.list()
        for (i, p) in params.enumerated() { liste.insert(p, at: i + 1) }
        ev.setParam(liste, forKeyword: 0x2D2D_2D2D)  // '----'
        var info: NSDictionary?
        let r = script.executeAppleEvent(ev, error: &info)
        if info != nil { return .failure(traduire(info, nom)) }
        return .success(r)
    }

    func texteDe(_ d: NSAppleEventDescriptor?) -> Any {
        guard let d = d else { return NSNull() }
        if d.descriptorType == typeNullAE { return NSNull() }
        if d.descriptorType == typeTrueAE { return "true" }
        if d.descriptorType == typeFalseAE { return "false" }
        if let s = d.stringValue { return s }
        return NSNull()
    }

    func simple(_ nom: String, _ params: [NSAppleEventDescriptor], _ rep: Rep, _ suite: (NSAppleEventDescriptor) -> [String: Any] = { _ in [:] }) {
        switch appeler(nom, params) {
        case .failure(let e): rep(.ko(e.code, e.msg))
        case .success(let d): rep(.ok(suite(d)))
        }
    }

    func fenetreCreer(_ url: String, _ rep: @escaping Rep) {
        simple("fenetre_creer", [NSAppleEventDescriptor(string: url)], rep) { ["fenetre": Int($0.int32Value)] }
    }
    func onglets(_ fen: Int, _ leger: Bool, _ rep: @escaping Rep) {
        simple("onglets", [NSAppleEventDescriptor(int32: Int32(fen)), NSAppleEventDescriptor(int32: leger ? 1 : 0)], rep) { d in
            var liste: [[String: Any]] = []
            let courant = Int(d.atIndex(1)?.int32Value ?? 1)
            if let l = d.atIndex(2), l.numberOfItems > 0 {
                for i in 1...l.numberOfItems {
                    let it = l.atIndex(i)
                    liste.append(["index": i, "url": (self.texteDe(it?.atIndex(1)) as? String) ?? "",
                                  "titre": (self.texteDe(it?.atIndex(2)) as? String) ?? ""])
                }
            }
            return ["onglets": liste, "courant": courant]
        }
    }
    func ongletCreer(_ fen: Int, _ url: String, _ rep: @escaping Rep) {
        simple("onglet_creer", [NSAppleEventDescriptor(int32: Int32(fen)), NSAppleEventDescriptor(string: url)], rep) {
            ["index": Int($0.int32Value)]
        }
    }
    func ongletFermer(_ fen: Int, _ idx: Int, _ rep: @escaping Rep) {
        simple("onglet_fermer", [NSAppleEventDescriptor(int32: Int32(fen)), NSAppleEventDescriptor(int32: Int32(idx))], rep)
    }
    func ongletUrl(_ fen: Int, _ idx: Int, _ url: String, _ rep: @escaping Rep) {
        simple("onglet_url", [NSAppleEventDescriptor(int32: Int32(fen)), NSAppleEventDescriptor(int32: Int32(idx)),
                              NSAppleEventDescriptor(string: url)], rep)
    }
    func ongletCourant(_ fen: Int, _ idx: Int, _ rep: @escaping Rep) {
        simple("onglet_courant", [NSAppleEventDescriptor(int32: Int32(fen)), NSAppleEventDescriptor(int32: Int32(idx))], rep)
    }
    func fenetreAvant(_ fen: Int, _ rep: @escaping Rep) {
        simple("fenetre_avant", [NSAppleEventDescriptor(int32: Int32(fen))], rep)
    }
    func fenetreFermer(_ fen: Int, _ rep: @escaping Rep) {
        simple("fenetre_fermer", [NSAppleEventDescriptor(int32: Int32(fen))], rep)
    }
    func js(_ fen: Int, _ idx: Int, _ code: String, _ delai: Double, _ rep: @escaping Rep) {
        simple("js", [NSAppleEventDescriptor(int32: Int32(fen)), NSAppleEventDescriptor(int32: Int32(idx)),
                      NSAppleEventDescriptor(string: code), NSAppleEventDescriptor(int32: Int32(max(1, delai)))], rep) {
            ["resultat": self.texteDe($0)]
        }
    }
    func devant(_ rep: @escaping Rep) {
        simple("devant", [], rep) { d in
            func v(_ i: Int) -> Double { return Double(d.atIndex(i)?.int32Value ?? 0) }
            return ["fenetre": Int(v(1)), "index": Int(v(2)),
                    "url": (self.texteDe(d.atIndex(3)) as? String) ?? "", "titre": (self.texteDe(d.atIndex(4)) as? String) ?? "",
                    "x": v(5), "y": v(6), "largeur": v(7) - v(5), "hauteur": v(8) - v(6)]
        }
    }
    func bornes(_ fen: Int, _ rep: @escaping Rep) {
        simple("bornes", [NSAppleEventDescriptor(int32: Int32(fen))], rep) { d in
            func v(_ i: Int) -> Double { return Double(d.atIndex(i)?.int32Value ?? 0) }
            return ["x": v(1), "y": v(2), "largeur": v(3) - v(1), "hauteur": v(4) - v(2)]
        }
    }
    func bornesPoser(_ fen: Int, _ l: Double, _ h: Double, _ rep: @escaping Rep) {
        simple("bornes_poser", [NSAppleEventDescriptor(int32: Int32(fen)), NSAppleEventDescriptor(int32: Int32(l)),
                                NSAppleEventDescriptor(int32: Int32(h))], rep)
    }

    // Capture : ScreenCaptureKit, l'id de fenetre de Safari est le CGWindowID.
    func contenu(force: Bool, _ cb: @escaping (SCShareableContent?, Error?) -> Void) {
        if !force, let c = cacheSC, Date().timeIntervalSince(c.0) < 5 { cb(c.1, nil); return }
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) { content, err in
            DispatchQueue.main.async {
                if let c = content { cacheSC = (Date(), c) }
                cb(content, err)
            }
        }
    }

    func image(_ fen: Int, _ rep: @escaping ImageRep) {
        guard CGPreflightScreenCaptureAccess() else {
            rep(.failure(PErr("CAPTURE_REFUSEE", "droit Enregistrement de l'ecran absent pour ce programme"))); return
        }
        func tenter(force: Bool) {
            contenu(force: force) { content, err in
                guard let content = content else {
                    rep(.failure(PErr("CAPTURE_REFUSEE", "liste des fenetres indisponible : \(err?.localizedDescription ?? "inconnu")"))); return
                }
                guard let w = content.windows.first(where: { Int($0.windowID) == fen }) else {
                    if !force { tenter(force: true) }
                    else { rep(.failure(PErr("FENETRE_INTROUVABLE", "fenetre \(fen) introuvable pour la capture"))) }
                    return
                }
                let filtre = SCContentFilter(desktopIndependentWindow: w)
                let info = SCShareableContent.info(for: filtre)
                let ech = Double(info.pointPixelScale)
                let cfg = SCStreamConfiguration()
                cfg.width = max(1, Int((Double(info.contentRect.width) * ech).rounded()))
                cfg.height = max(1, Int((Double(info.contentRect.height) * ech).rounded()))
                cfg.showsCursor = false
                cfg.colorSpaceName = CGColorSpace.sRGB
                cfg.ignoreShadowsSingleWindow = true
                cfg.captureResolution = .best
                SCScreenshotManager.captureImage(contentFilter: filtre, configuration: cfg) { img, e in
                    DispatchQueue.main.async {
                        if let img = img {
                            rep(.success((img, Double(img.width) / Double(max(1, info.contentRect.width)))))
                        } else {
                            rep(.failure(PErr("INTERNE", "capture impossible : \(e?.localizedDescription ?? "inconnu")")))
                        }
                    }
                }
            }
        }
        tenter(force: false)
    }

    func calibrer(_ fen: Int, _ c1: [Int], _ c2: [Int], _ rep: @escaping Rep) {
        image(fen) { r in
            switch r {
            case .failure(let e): rep(.ko(e.code, e.msg))
            case .success(let v): rep(.ok(calibrerImage(v.0, echelle: v.1, c1: c1, c2: c2)))
            }
        }
    }
    func dialogue(_ q: [String: Any], _ rep: @escaping Rep) {
        dialogueReel(q, rep)
    }
}

// MARK: - Ecouter (son de Safari -> texte, sur le Mac)

final class SortieSon: NSObject, SCStreamOutput {
    let url: URL
    var fichier: AVAudioFile?
    var erreur: String?
    let verrou = NSLock()
    init(_ url: URL) { self.url = url }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sb.isValid, CMSampleBufferGetNumSamples(sb) > 0,
              let fd = CMSampleBufferGetFormatDescription(sb),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fd) else { return }
        var a = asbd.pointee
        guard let fmt = AVAudioFormat(streamDescription: &a) else { return }
        let n = AVAudioFrameCount(CMSampleBufferGetNumSamples(sb))
        guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: n) else { return }
        buf.frameLength = n
        guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sb, at: 0, frameCount: Int32(n),
                                                           into: buf.mutableAudioBufferList) == noErr else { return }
        verrou.lock(); defer { verrou.unlock() }
        do {
            if fichier == nil {
                fichier = try AVAudioFile(forWriting: url, settings: fmt.settings, commonFormat: fmt.commonFormat,
                                          interleaved: fmt.isInterleaved)
            }
            try fichier?.write(from: buf)
        } catch {
            erreur = "ecriture du son impossible : \(error.localizedDescription)"
        }
    }
    func fermer() { verrou.lock(); fichier = nil; verrou.unlock() }
}

let fileSon = DispatchQueue(label: "pont.son")

/// SECOURS seulement (macOS < 14.4, sans robinet audio) : capture par ScreenCaptureKit. Elle affiche l'indicateur de
/// partage d'ecran ; elle n'est jamais appelee quand le robinet Core Audio existe.
func capturerSonSafariSC(duree: Double, url: URL, _ fin: @escaping (PErr?, SortieSon?) -> Void) {
    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) { content, err in
        DispatchQueue.main.async {
            guard let content = content else {
                fin(PErr("CAPTURE_REFUSEE", "liste des applications indisponible : \(err?.localizedDescription ?? "inconnu")"), nil); return
            }
            guard let app = content.applications.first(where: { $0.bundleIdentifier == "com.apple.Safari" }) else {
                fin(PErr("SAFARI_ABSENT", "Safari n'est pas capturable (pas lance, ou aucune fenetre ouverte)"), nil); return
            }
            guard let ecran = content.displays.first else { fin(PErr("INTERNE", "aucun ecran pour la capture"), nil); return }
            let filtre = SCContentFilter(display: ecran, including: [app], exceptingWindows: [])
            let cfg = SCStreamConfiguration()
            cfg.capturesAudio = true
            cfg.excludesCurrentProcessAudio = true
            cfg.sampleRate = 48000
            cfg.channelCount = 1
            cfg.width = 2
            cfg.height = 2
            cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            cfg.showsCursor = false
            let sortie = SortieSon(url)
            let flux = SCStream(filter: filtre, configuration: cfg, delegate: nil)
            do {
                try flux.addStreamOutput(sortie, type: .screen, sampleHandlerQueue: fileSon)
                try flux.addStreamOutput(sortie, type: .audio, sampleHandlerQueue: fileSon)
            } catch {
                fin(PErr("INTERNE", "flux audio impossible : \(error.localizedDescription)"), nil); return
            }
            flux.startCapture { e in
                DispatchQueue.main.async {
                    if let e = e {
                        fin(PErr("CAPTURE_REFUSEE", "demarrage de la capture impossible : \(e.localizedDescription)"), nil); return
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + duree) {
                        flux.stopCapture { _ in
                            fileSon.async {
                                sortie.fermer()
                                DispatchQueue.main.async { fin(nil, sortie) }
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Robinet audio Core Audio (macOS 14.4+) : le son des processus de Safari, sans capture d'ecran

func lireProp<T>(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ defaut: T) -> T? {
    var a = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var v = defaut
    var sz = UInt32(MemoryLayout<T>.size)
    let st = withUnsafeMutablePointer(to: &v) { AudioObjectGetPropertyData(obj, &a, 0, nil, &sz, $0) }
    return st == noErr ? v : nil
}

/// Objets processus audio dont l'identifiant de paquet commence par com.apple.Safari ou com.apple.WebKit.
func processusAudioSafari() -> [AudioObjectID] {
    var a = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal,
                                       mElement: kAudioObjectPropertyElementMain)
    var taille: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &taille) == noErr, taille > 0 else { return [] }
    var liste = [AudioObjectID](repeating: 0, count: Int(taille) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &taille, &liste) == noErr else { return [] }
    return liste.filter { obj in
        guard let b: CFString = lireProp(obj, kAudioProcessPropertyBundleID, "" as CFString) else { return false }
        let id = b as String
        return id.hasPrefix("com.apple.Safari") || id.hasPrefix("com.apple.WebKit")
    }
}

@available(macOS 14.4, *)
final class Robinet {
    var tap = AudioObjectID(kAudioObjectUnknown)
    var agg = AudioObjectID(kAudioObjectUnknown)
    var proc: AudioDeviceIOProcID?
    var demarre = false
    var fichier: AVAudioFile?
    var erreur: String?
    var recu = false
    let verrou = NSLock()
    let url: URL
    init(_ url: URL) { self.url = url }

    /// Cree le robinet, l'appareil agrege et lance l'ecriture. Renvoie une erreur (code, message) ou nil.
    func demarrer(_ processus: [AudioObjectID]) -> PErr? {
        let desc = CATapDescription(stereoMixdownOfProcesses: processus)
        desc.name = "claude-safari"
        desc.isPrivate = true
        desc.muteBehavior = .unmuted
        var st = AudioHardwareCreateProcessTap(desc, &tap)
        guard st == noErr else {
            tap = AudioObjectID(kAudioObjectUnknown)
            return PErr("AUDIO_REFUSE", "robinet audio refuse (code \(st)). Autorise le son : Reglages Systeme > Confidentialite et securite > Enregistrement de l'ecran et des sons du systeme > \"Enregistrement des sons du systeme uniquement\", pour l'application qui lance le pont")
        }
        guard let asbd: AudioStreamBasicDescription = lireProp(tap, kAudioTapPropertyFormat, AudioStreamBasicDescription()),
              var a = Optional(asbd), let fmt = AVAudioFormat(streamDescription: &a) else {
            arreter(); return PErr("INTERNE", "format du robinet audio illisible")
        }
        var liste: [String: Any] = [
            kAudioAggregateDeviceNameKey: "claude-safari-ecoute",
            kAudioAggregateDeviceUIDKey: "fr.antoinetollu.ai-for-safari.panneau.\(UUID().uuidString)",
            kAudioAggregateDeviceIsPrivateKey: 1,
            kAudioAggregateDeviceTapAutoStartKey: 1,
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: desc.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]],
        ]
        if let sortie: AudioObjectID = lireProp(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice, AudioObjectID(0)),
           sortie != 0, let uid: CFString = lireProp(sortie, kAudioDevicePropertyDeviceUID, "" as CFString) {
            liste[kAudioAggregateDeviceMainSubDeviceKey] = uid as String
            liste[kAudioAggregateDeviceSubDeviceListKey] = [[kAudioSubDeviceUIDKey: uid as String]]
        }
        st = AudioHardwareCreateAggregateDevice(liste as CFDictionary, &agg)
        guard st == noErr else {
            agg = AudioObjectID(kAudioObjectUnknown); arreter()
            return PErr("INTERNE", "appareil agrege impossible (code \(st))")
        }
        do {
            fichier = try AVAudioFile(forWriting: url, settings: fmt.settings, commonFormat: fmt.commonFormat, interleaved: fmt.isInterleaved)
        } catch { arreter(); return PErr("INTERNE", "fichier son impossible : \(error.localizedDescription)") }
        st = AudioDeviceCreateIOProcIDWithBlock(&proc, agg, fileSon) { [self] _, entree, _, _, _ in
            guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, bufferListNoCopy: entree, deallocator: nil), buf.frameLength > 0 else { return }
            verrou.lock(); defer { verrou.unlock() }
            guard fichier != nil else { return }
            do { try fichier?.write(from: buf); recu = true } catch { erreur = "ecriture du son impossible : \(error.localizedDescription)" }
        }
        guard st == noErr, proc != nil else { arreter(); return PErr("INTERNE", "lecture du robinet impossible (code \(st))") }
        st = AudioDeviceStart(agg, proc)
        guard st == noErr else { arreter(); return PErr("AUDIO_REFUSE", "demarrage du robinet audio refuse (code \(st)). Autorise le son : Reglages Systeme > Confidentialite et securite > Enregistrement de l'ecran et des sons du systeme > \"Enregistrement des sons du systeme uniquement\"") }
        demarre = true
        return nil
    }

    /// Detruit tout, dans l'ordre : arret, IOProc, appareil agrege, robinet. Sans danger si appele deux fois.
    func arreter() {
        if demarre, let p = proc { AudioDeviceStop(agg, p); demarre = false }
        if let p = proc { AudioDeviceDestroyIOProcID(agg, p); proc = nil }
        if agg != AudioObjectID(kAudioObjectUnknown) { AudioHardwareDestroyAggregateDevice(agg); agg = AudioObjectID(kAudioObjectUnknown) }
        if tap != AudioObjectID(kAudioObjectUnknown) { AudioHardwareDestroyProcessTap(tap); tap = AudioObjectID(kAudioObjectUnknown) }
        verrou.lock(); fichier = nil; verrou.unlock()
    }
}

/// Enregistre pendant `duree` secondes le son des processus de Safari. `fin(nil, true)` : fichier ecrit ; `fin(nil, false)` :
/// aucun processus audio de Safari ou aucun echantillon (silence, pas une erreur).
@available(macOS 14.4, *)
func capturerSonRobinet(duree: Double, url: URL, _ fin: @escaping (PErr?, Bool) -> Void) {
    let processus = processusAudioSafari()
    if processus.isEmpty { fin(nil, false); return }
    let r = Robinet(url)
    if let e = r.demarrer(processus) { fin(e, false); return }
    DispatchQueue.main.asyncAfter(deadline: .now() + duree) {
        r.arreter()
        if let m = r.erreur { fin(PErr("INTERNE", m), false); return }
        fin(nil, r.recu)
    }
}

/// Duree (s) et niveau RMS moyen (dBFS) d'un fichier son.
func analyserSon(_ url: URL) throws -> (Double, Double) {
    let f = try AVAudioFile(forReading: url)
    let fmt = f.processingFormat
    let total = f.length
    let cap: AVAudioFrameCount = 65536
    guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: cap) else { throw PErr("INTERNE", "tampon audio impossible") }
    var somme = 0.0, n = 0.0
    while f.framePosition < total {
        try f.read(into: buf, frameCount: cap)
        if buf.frameLength == 0 { break }
        guard let d = buf.floatChannelData else { break }
        for c in 0..<Int(fmt.channelCount) {
            let p = d[c]
            for i in 0..<Int(buf.frameLength) { let v = Double(p[i]); somme += v * v }
            n += Double(buf.frameLength)
        }
    }
    let rms = n > 0 ? (somme / n).squareRoot() : 0
    return (Double(total) / fmt.sampleRate, rms > 0 ? max(-120, 20 * log10(rms)) : -120)
}

var tacheDictee: SFSpeechRecognitionTask?

func autoriserDictee(_ suite: @escaping (PErr?) -> Void) {
    func refus() -> PErr {
        return PErr("DICTEE_REFUSEE", "reconnaissance vocale non autorisee : Reglages Systeme > Confidentialite et securite > Reconnaissance vocale")
    }
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized: suite(nil)
    case .denied, .restricted: suite(refus())
    default:
        // La demande se fait dans un processus fils : si macOS tue le demandeur (le programme qui lance le pont n'a pas de
        // description d'usage), seul le fils meurt et le pont reste en vie.
        let fils = Process()
        fils.executableURL = URL(fileURLWithPath: Bundle.main.executablePath ?? CommandLine.arguments[0])
        fils.arguments = ["demander-dictee"]
        fils.standardOutput = FileHandle.nullDevice
        fils.standardError = FileHandle.nullDevice
        let une = Une()
        fils.terminationHandler = { p in
            DispatchQueue.main.async {
                guard une.premiere() else { return }
                if p.terminationReason == .exit && p.terminationStatus == 0 { suite(nil) }
                else if p.terminationReason == .exit { suite(refus()) }
                else {
                    suite(PErr("DICTEE_REFUSEE", "macOS n'a pas pu poser la question de reconnaissance vocale (processus interrompu). Autorise-la dans Reglages Systeme > Confidentialite et securite > Reconnaissance vocale, ou lance le pont depuis une application qui a le droit de la demander"))
                }
            }
        }
        do { try fils.run() } catch { suite(PErr("INTERNE", "demande d'autorisation impossible : \(error.localizedDescription)")); return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 40) {
            if une.premiere() {
                fils.terminate()
                suite(PErr("DELAI", "demande d'autorisation de reconnaissance vocale sans reponse en 40 s"))
            }
        }
    }
}

func transcrire(_ url: URL, _ langue: String, secondes: Double, db: Double, _ rep: @escaping Rep) {
    guard let rec = SFSpeechRecognizer(locale: Locale(identifier: langue)) else {
        rep(.ko("DICTEE_INDISPONIBLE", "langue non prise en charge : \(langue)")); return
    }
    guard rec.isAvailable else { rep(.ko("DICTEE_INDISPONIBLE", "moteur de reconnaissance vocale indisponible pour \(langue)")); return }
    let surAppareil = rec.supportsOnDeviceRecognition
    let silencieux = db < -55
    var base: [String: Any] = ["secondes": (secondes * 10).rounded() / 10, "niveau_db": Int(db.rounded()),
                               "silencieux": silencieux, "sur_appareil": surAppareil, "langue": langue]
    if silencieux {
        base["texte"] = ""
        rep(.ok(base)); return
    }
    let req = SFSpeechURLRecognitionRequest(url: url)
    req.requiresOnDeviceRecognition = surAppareil
    req.shouldReportPartialResults = false
    let une = Une()
    tacheDictee = rec.recognitionTask(with: req) { res, err in
        DispatchQueue.main.async {
            guard une.premiere() else { return }
            if let r = res, r.isFinal || err == nil {
                base["texte"] = r.bestTranscription.formattedString
                rep(.ok(base))
            } else if let e = err as NSError? {
                if e.code == 1110 {   // aucune parole detectee
                    base["texte"] = ""
                    rep(.ok(base))
                } else if e.localizedDescription.lowercased().contains("disabled") || e.localizedDescription.lowercased().contains("not available") {
                    rep(.ko("DICTEE_INDISPONIBLE", e.localizedDescription))
                } else {
                    rep(.ko("INTERNE", "reconnaissance impossible : \(e.localizedDescription) (\(e.code))"))
                }
            } else {
                base["texte"] = ""
                rep(.ok(base))
            }
        }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + secondes + 30) {
        if une.premiere() {
            tacheDictee?.cancel()
            rep(.ko("DELAI", "la transcription n'a pas fini en \(Int(secondes) + 30) s"))
        }
    }
}

func faireEcouter(_ mode: String, _ q: [String: Any], _ rep: @escaping Rep) {
    let duree = nombre(q, "duree_s") ?? 15
    guard duree >= 1, duree <= 120 else { rep(.ko("ARGUMENT", "duree_s doit etre entre 1 et 120")); return }
    let langue = texte(q, "langue") ?? "fr-FR"
    let fichier = texte(q, "fichier")
    if fichier == nil && mode == "banc" { rep(.ko("ARGUMENT", "en mode banc, donne un fichier")); return }
    var avecRobinet = false
    if #available(macOS 14.4, *) { avecRobinet = true }
    if fichier == nil {
        if !avecRobinet {   // secours : l'ancienne capture demande le droit Enregistrement de l'ecran
            guard CGPreflightScreenCaptureAccess() else {
                rep(.ko("CAPTURE_REFUSEE", "droit Enregistrement de l'ecran absent pour ce programme")); return
            }
        }
        if NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Safari").isEmpty {
            rep(.ko("SAFARI_ABSENT", "Safari ne tourne pas")); return
        }
    }
    autoriserDictee { err in
        if let e = err { rep(.ko(e.code, e.msg)); return }
        if let f = fichier {
            let url = URL(fileURLWithPath: f)
            do {
                let (s, db) = try analyserSon(url)
                transcrire(url, langue, secondes: s, db: db, rep)
            } catch {
                rep(.ko("ARGUMENT", "fichier son illisible : \(f) (\(error.localizedDescription))"))
            }
            return
        }
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("pont-ecoute-\(UUID().uuidString).caf")
        func menage() { try? FileManager.default.removeItem(at: tmp) }
        func analyser() {
            guard FileManager.default.fileExists(atPath: tmp.path) else {
                transcrire(tmp, langue, secondes: duree, db: -120, rep); return   // aucun echantillon : Safari ne joue rien
            }
            do {
                let (s, db) = try analyserSon(tmp)
                transcrire(tmp, langue, secondes: s, db: db) { r in menage(); rep(r) }
            } catch {
                menage()
                rep(.ko("INTERNE", "son enregistre illisible : \(error.localizedDescription)"))
            }
        }
        if #available(macOS 14.4, *) {
            capturerSonRobinet(duree: duree, url: tmp) { e, ecrit in
                if let e = e { menage(); rep(.ko(e.code, e.msg)); return }
                if !ecrit { menage(); transcrire(tmp, langue, secondes: duree, db: -120, rep); return }   // silencieux
                analyser()
            }
        } else {
            capturerSonSafariSC(duree: duree, url: tmp) { e, sortie in
                if let e = e { menage(); rep(.ko(e.code, e.msg)); return }
                if let m = sortie?.erreur { menage(); rep(.ko("INTERNE", m)); return }
                analyser()
            }
        }
    }
}

// MARK: - Dictee (mode a part, reste ouvert : micro -> barres de niveau + texte en direct)

func niveauDb(_ p: UnsafePointer<Float>, _ n: Int) -> Double {
    if n <= 0 { return -120 }
    var somme = 0.0
    for i in 0..<n { let v = Double(p[i]); somme += v * v }
    let rms = (somme / Double(n)).squareRoot()
    return rms > 0 ? max(-120, 20 * log10(rms)) : -120
}

struct Micro { let id: AudioDeviceID; let uid: String; let nom: String; let defaut: Bool }

func texteProp(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> String? {
    var a = AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var v: Unmanaged<CFString>?
    var sz = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    let st = withUnsafeMutablePointer(to: &v) { AudioObjectGetPropertyData(obj, &a, 0, nil, &sz, $0) }
    guard st == noErr, let u = v else { return nil }
    return u.takeRetainedValue() as String
}

func canauxEntree(_ dev: AudioObjectID) -> Int {
    var a = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration, mScope: kAudioObjectPropertyScopeInput,
                                       mElement: kAudioObjectPropertyElementMain)
    var taille: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(dev, &a, 0, nil, &taille) == noErr, taille > 0 else { return 0 }
    let brut = UnsafeMutableRawPointer.allocate(byteCount: Int(taille), alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { brut.deallocate() }
    guard AudioObjectGetPropertyData(dev, &a, 0, nil, &taille, brut) == noErr else { return 0 }
    let liste = UnsafeMutableAudioBufferListPointer(brut.assumingMemoryBound(to: AudioBufferList.self))
    return liste.reduce(0) { $0 + Int($1.mNumberChannels) }
}

func microsDisponibles() -> [Micro] {
    var a = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal,
                                       mElement: kAudioObjectPropertyElementMain)
    var taille: UInt32 = 0
    let sys = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(sys, &a, 0, nil, &taille) == noErr, taille > 0 else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(taille) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(sys, &a, 0, nil, &taille, &ids) == noErr else { return [] }
    let defaut: AudioObjectID = lireProp(sys, kAudioHardwarePropertyDefaultInputDevice, AudioObjectID(0)) ?? 0
    var res: [Micro] = []
    for d in ids where canauxEntree(d) > 0 {
        guard let uid = texteProp(d, kAudioDevicePropertyDeviceUID) else { continue }
        res.append(Micro(id: d, uid: uid, nom: texteProp(d, kAudioObjectPropertyName) ?? uid, defaut: d == defaut))
    }
    return res
}

func listerMicros() -> Never {
    let l = microsDisponibles().map { ["uid": $0.uid, "nom": $0.nom, "defaut": $0.defaut] as [String: Any] }
    ecrireLigne(["micros": l])
    exit(0)
}

final class Dictee {
    let langue: String
    let uidMicro: String?
    let local: Bool
    let engine = AVAudioEngine()
    var rec: SFSpeechRecognizer?
    var req: SFSpeechAudioBufferRecognitionRequest?      // requete courante (lue par le tap sous verrou)
    var taches: [SFSpeechRecognitionTask] = []
    var segments: [String] = []                          // texte de chaque requete, dans l'ordre
    var figes: [String] = []                             // texte deja dit dans cette requete, garde quand le moteur repart de zero
    var bruts: [String] = []                             // dernier texte brut rendu par le moteur pour cette requete
    var generation = 0                                   // index de la requete courante
    var dernierTexte = ""
    var minuteur: Timer?
    var arretDemande = false
    var termine = false
    var ecoute = false
    let verrou = NSLock()
    var anneau: [Double] = [0, 0, 0, 0, 0]

    init(_ langue: String, micro: String?, local: Bool) { self.langue = langue; self.uidMicro = micro; self.local = local }

    func erreur(_ code: String, _ msg: String) {
        guard !termine else { return }
        termine = true
        minuteur?.invalidate()
        if ecoute { engine.inputNode.removeTap(onBus: 0); engine.stop() }
        taches.forEach { $0.cancel() }
        ecrireLigne(["type": "erreur", "code": code, "message": msg])
        exit(0)
    }

    func demarrer() {
        // Micro introuvable : erreur claire avant toute demande d'autorisation.
        if let u = uidMicro, !microsDisponibles().contains(where: { $0.uid == u }) {
            erreur("MICRO_INTROUVABLE", "aucun micro avec l'identifiant \(u) (voir : pont-safari micros)"); return
        }
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: apresMicro()
        case .denied, .restricted: refusMicro()
        default:
            AVCaptureDevice.requestAccess(for: .audio) { ok in
                DispatchQueue.main.async { if ok { self.apresMicro() } else { self.refusMicro() } }
            }
        }
    }

    func refusMicro() {
        erreur("MICRO_REFUSE", "micro non autorise : Reglages Systeme > Confidentialite et securite > Microphone")
    }

    func apresMicro() {
        autoriserDictee { err in
            if let e = err { self.erreur(e.code, e.msg); return }
            self.lancer()
        }
    }

    func nouvelleRequete() -> SFSpeechAudioBufferRecognitionRequest {
        let q = SFSpeechAudioBufferRecognitionRequest()
        q.shouldReportPartialResults = true
        q.addsPunctuation = true
        q.taskHint = .dictation
        q.requiresOnDeviceRecognition = local
        return q
    }

    /// Lance la tache d'une requete ; son texte va dans segments[g].
    func demarrerTache(_ q: SFSpeechAudioBufferRecognitionRequest, _ g: Int) {
        guard let r = rec else { return }
        let t = r.recognitionTask(with: q) { res, err in
            DispatchQueue.main.async { self.resultat(res, err, g) }
        }
        taches.append(t)
        // Apple coupe une requete au-dela d'environ 1 minute : on enchaine a 55 s sans perdre le texte.
        DispatchQueue.main.asyncAfter(deadline: .now() + 55) { self.enchainer(g) }
    }

    func enchainer(_ g: Int) {
        guard !termine, !arretDemande, g == generation else { return }
        let q = nouvelleRequete()
        verrou.lock()
        let ancienne = req
        req = q
        verrou.unlock()
        generation += 1
        segments.append(""); figes.append(""); bruts.append("")
        demarrerTache(q, generation)
        ancienne?.endAudio()   // l'ancienne rend son texte final, qui reste dans son segment
    }

    func lancer() {
        guard let r = SFSpeechRecognizer(locale: Locale(identifier: langue)) else {
            erreur("DICTEE_INDISPONIBLE", "langue non prise en charge : \(langue)"); return
        }
        guard r.isAvailable else {
            erreur("DICTEE_INDISPONIBLE", "moteur de reconnaissance vocale indisponible pour \(langue)"); return
        }
        if local && !r.supportsOnDeviceRecognition {
            erreur("DICTEE_INDISPONIBLE", "reconnaissance sur l'appareil non disponible pour \(langue) (--local)"); return
        }
        rec = r
        let noeud = engine.inputNode
        var nomMicro = ""
        let liste = microsDisponibles()
        if let u = uidMicro {
            guard let m = liste.first(where: { $0.uid == u }) else {
                erreur("MICRO_INTROUVABLE", "aucun micro avec l'identifiant \(u) (voir : pont-safari micros)"); return
            }
            guard let au = noeud.audioUnit else { erreur("INTERNE", "unite audio d'entree indisponible"); return }
            var id = m.id
            let st = AudioUnitSetProperty(au, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id,
                                          UInt32(MemoryLayout<AudioDeviceID>.size))
            if st != noErr { erreur("INTERNE", "impossible de choisir le micro \(m.nom) (erreur \(st))"); return }
            nomMicro = m.nom
        } else {
            nomMicro = liste.first(where: { $0.defaut })?.nom ?? ""
        }
        let fmt = noeud.outputFormat(forBus: 0)   // format natif, aucune conversion
        guard fmt.sampleRate > 0, fmt.channelCount > 0 else {
            erreur("INTERNE", "aucun micro disponible (format d'entree vide)"); return
        }
        let q = nouvelleRequete()
        req = q
        segments = [""]; figes = [""]; bruts = [""]
        noeud.installTap(onBus: 0, bufferSize: 1024, format: fmt) { [self] buf, _ in
            verrou.lock()
            let courante = req
            verrou.unlock()
            courante?.append(buf)
            guard let d = buf.floatChannelData else { return }
            let n = Int(buf.frameLength)
            let morceau = 1024
            var debut = 0
            verrou.lock()
            while debut < n {
                let k = min(morceau, n - debut)
                anneau.removeFirst()
                anneau.append(niveauDb(d[0] + debut, k))
                debut += k
            }
            verrou.unlock()
        }
        ecoute = true
        engine.prepare()
        do { try engine.start() } catch {
            erreur("INTERNE", "micro impossible a demarrer : \(error.localizedDescription)"); return
        }
        demarrerTache(q, 0)
        ecrireLigne(["type": "pret", "micro": nomMicro, "sur_appareil": local])
        let t = Timer(timeInterval: 0.05, repeats: true) { _ in self.envoyerNiveau() }
        RunLoop.main.add(t, forMode: .common)
        minuteur = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 600) { self.arreter() }   // garde-fou : 10 minutes
    }

    func envoyerNiveau() {
        guard !termine else { return }
        verrou.lock()
        let v = anneau.map { db -> Double in
            let x = (db + 60) / 50
            return (min(1, max(0, x)) * 1000).rounded() / 1000
        }
        verrou.unlock()
        ecrireLigne(["type": "niveau", "v": v])
    }

    var relances = 0

    /// Vrai si le nouveau texte brut n'est pas la suite de l'ancien (le moteur a recommence apres une pause).
    static func repartDeZero(_ avant: String, _ apres: String) -> Bool {
        let a = Array(avant.lowercased()), b = Array(apres.lowercased())
        if a.count < 6 || b.isEmpty { return false }
        if Double(b.count) > Double(a.count) * 0.6 { return false }
        var commun = 0
        while commun < a.count && commun < b.count && a[commun] == b[commun] { commun += 1 }
        return commun < min(b.count, 4)
    }

    /// Texte complet : requetes finies + requete en cours, mis bout a bout.
    func texteTotal() -> String {
        return segments.filter { !$0.isEmpty }.joined(separator: " ")
    }

    func resultat(_ res: SFSpeechRecognitionResult?, _ err: Error?, _ g: Int) {
        guard !termine, g < segments.count else { return }
        if let r = res {
            let brut = r.bestTranscription.formattedString
            // Apres une pause, le moteur d'Apple repart parfois d'un texte vide dans la meme requete : ce qui etait
            // deja dit est alors garde (fige), et la suite s'ajoute derriere. Rien ne s'efface a l'ecran.
            if Dictee.repartDeZero(bruts[g], brut) {
                figes[g] = [figes[g], bruts[g]].filter { !$0.isEmpty }.joined(separator: " ")
            }
            bruts[g] = brut
            segments[g] = [figes[g], brut].filter { !$0.isEmpty }.joined(separator: " ")
            dernierTexte = texteTotal()
            ecrireLigne(["type": "texte", "t": dernierTexte, "final": false])
            if r.isFinal && g == generation {
                // Le moteur clot la requete apres un silence : on ne s'arrete que si la personne l'a demande.
                if arretDemande { finir() } else { enchainer(g) }
                return
            }
        }
        if let e = err as NSError? {
            if g != generation { return }   // une ancienne requete qui se ferme : son texte est deja gardé
            if arretDemande { finir(); return }
            if e.code == 1110 || e.code == 216 || e.code == 203 || e.code == 301 {
                // Silence ou requete close par le moteur : on reprend l'ecoute, le texte reste.
                relances += 1
                if relances > 200 { finir(); return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self.enchainer(g) }
            } else { erreur("INTERNE", "reconnaissance impossible : \(e.localizedDescription) (\(e.code))") }
        }
    }

    /// Demande l'arret : le micro se coupe, le moteur rend son dernier texte (2 s au plus).
    func arreter() {
        guard !arretDemande, !termine else { return }
        arretDemande = true
        minuteur?.invalidate()
        if ecoute { engine.inputNode.removeTap(onBus: 0); engine.stop() }
        verrou.lock(); let c = req; verrou.unlock()
        c?.endAudio()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.finir() }
    }

    func finir() {
        guard !termine else { return }
        termine = true
        minuteur?.invalidate()
        if ecoute && engine.isRunning { engine.inputNode.removeTap(onBus: 0); engine.stop() }
        taches.forEach { $0.cancel() }
        ecrireLigne(["type": "texte", "t": dernierTexte, "final": true])
        ecrireLigne(["type": "fin"])
        exit(0)
    }
}

func lancerDictee(_ langue: String, micro: String?, local: Bool) -> Never {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let d = Dictee(langue, micro: micro, local: local)
    let lecteurStop = Thread {
        while let ligne = readLine(strippingNewline: true) {
            if ligne.trimmingCharacters(in: .whitespaces).lowercased() == "stop" { break }
        }
        DispatchQueue.main.async { d.arreter() }   // "stop" ou entree fermee
    }
    lecteurStop.start()
    DispatchQueue.main.async { d.demarrer() }
    app.run()
    exit(0)
}

// MARK: - Aiguillage des operations

func traiter(_ b: Backend, _ q: [String: Any], _ rep: @escaping Rep) {
    guard let op = q["op"] as? String else { rep(.ko("ARGUMENT", "op manquante")); return }
    func ex(_ k: String) -> String { return "champ manquant ou invalide : \(k)" }
    switch op {
    case "ping":
        rep(.ok(["mode": b.nom, "version": VERSION]))
    case "droits":
        if b.nom == "banc" { rep(.ok(["capture_ecran": true, "accessibilite": true])) }
        else { rep(.ok(["capture_ecran": CGPreflightScreenCaptureAccess(), "accessibilite": AXIsProcessTrusted()])) }
    case "fenetre_creer":
        guard let u = texte(q, "url") else { rep(.ko("ARGUMENT", ex("url"))); return }
        b.fenetreCreer(u, rep)
    case "onglets":
        guard let f = entier(q, "fenetre") else { rep(.ko("ARGUMENT", ex("fenetre"))); return }
        b.onglets(f, (q["leger"] as? Bool) ?? false, rep)
    case "onglet_creer":
        guard let f = entier(q, "fenetre") else { rep(.ko("ARGUMENT", ex("fenetre"))); return }
        guard let u = texte(q, "url") else { rep(.ko("ARGUMENT", ex("url"))); return }
        b.ongletCreer(f, u, rep)
    case "onglet_fermer":
        guard let f = entier(q, "fenetre") else { rep(.ko("ARGUMENT", ex("fenetre"))); return }
        guard let i = entier(q, "index") else { rep(.ko("ARGUMENT", ex("index"))); return }
        b.ongletFermer(f, i, rep)
    case "onglet_url":
        guard let f = entier(q, "fenetre") else { rep(.ko("ARGUMENT", ex("fenetre"))); return }
        guard let i = entier(q, "index") else { rep(.ko("ARGUMENT", ex("index"))); return }
        guard let u = texte(q, "url") else { rep(.ko("ARGUMENT", ex("url"))); return }
        b.ongletUrl(f, i, u, rep)
    case "onglet_courant":
        guard let f = entier(q, "fenetre") else { rep(.ko("ARGUMENT", ex("fenetre"))); return }
        guard let i = entier(q, "index") else { rep(.ko("ARGUMENT", ex("index"))); return }
        b.ongletCourant(f, i, rep)
    case "fenetre_avant":
        guard let f = entier(q, "fenetre") else { rep(.ko("ARGUMENT", ex("fenetre"))); return }
        b.fenetreAvant(f, rep)
    case "fenetre_fermer":
        guard let f = entier(q, "fenetre") else { rep(.ko("ARGUMENT", ex("fenetre"))); return }
        b.fenetreFermer(f, rep)
    case "js":
        guard let f = entier(q, "fenetre") else { rep(.ko("ARGUMENT", ex("fenetre"))); return }
        guard let i = entier(q, "index") else { rep(.ko("ARGUMENT", ex("index"))); return }
        guard let c = texte(q, "code") else { rep(.ko("ARGUMENT", ex("code"))); return }
        b.js(f, i, c, nombre(q, "delai_s") ?? 30, rep)
    case "devant":
        b.devant(rep)
    case "bornes":
        guard let f = entier(q, "fenetre") else { rep(.ko("ARGUMENT", ex("fenetre"))); return }
        b.bornes(f, rep)
    case "bornes_poser":
        guard let f = entier(q, "fenetre") else { rep(.ko("ARGUMENT", ex("fenetre"))); return }
        guard let l = nombre(q, "largeur"), let h = nombre(q, "hauteur") else { rep(.ko("ARGUMENT", ex("largeur/hauteur"))); return }
        b.bornesPoser(f, l, h, rep)
    case "calibrer":
        guard let f = entier(q, "fenetre") else { rep(.ko("ARGUMENT", ex("fenetre"))); return }
        guard let c1 = couleur3(q, "c1"), let c2 = couleur3(q, "c2") else { rep(.ko("ARGUMENT", ex("c1/c2"))); return }
        b.calibrer(f, c1, c2, rep)
    case "capture":
        faireCapture(b, q, rep)
    case "gif":
        faireGif(q, rep)
    case "dialogue":
        b.dialogue(q, rep)
    case "ecouter":
        faireEcouter(b.nom, q, rep)
    case "quitter":
        rep(.ok([:]))
        exit(0)
    default:
        rep(.ko("ARGUMENT", "operation inconnue : \(op)"))
    }
}

// MARK: - Demarrage

let args = Array(CommandLine.arguments.dropFirst())
if args.first == "demander-dictee" {   // usage interne : voir autoriserDictee
    let sem = DispatchSemaphore(value: 0)
    var ok = false
    SFSpeechRecognizer.requestAuthorization { st in ok = (st == .authorized); sem.signal() }
    sem.wait()
    exit(ok ? 0 : 1)
}
if args.first == "dictee" {   // mode a part, qui reste ouvert : voir docs/PROTOCOLE-PONT.md
    var langue = "fr-FR", micro: String? = nil, local = false
    var i = 1, vuLangue = false
    while i < args.count {
        if args[i] == "--local" { local = true }
        else if args[i] == "--micro" {
            guard i + 1 < args.count else { journal("--micro : identifiant manquant"); exit(2) }
            micro = args[i + 1]; i += 1
        } else if !vuLangue && !args[i].hasPrefix("--") { langue = args[i]; vuLangue = true }
        else { journal("argument inconnu : \(args[i])"); exit(2) }
        i += 1
    }
    lancerDictee(langue, micro: micro, local: local)
}
if args.first == "micros" { listerMicros() }
guard let mode = args.first, mode == "safari" || mode == "banc" else {
    journal("usage : pont-safari safari | pont-safari banc [--capteur chemin.js] | pont-safari dictee [langue] [--micro UID] [--local] | pont-safari micros")
    exit(2)
}
if let i = args.firstIndex(of: "--capteur") {
    guard i + 1 < args.count, let s = try? String(contentsOfFile: args[i + 1], encoding: .utf8) else {
        journal("--capteur : fichier illisible")
        exit(2)
    }
    capteurSource = s
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let backend: Backend = (mode == "banc") ? Banc() : Safari()

let lecteur = Thread {
    while let ligne = readLine(strippingNewline: true) {
        if ligne.trimmingCharacters(in: .whitespaces).isEmpty { continue }
        guard let data = ligne.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            ecrireReponse(NSNull(), .ko("ARGUMENT", "ligne JSON invalide"))
            continue
        }
        let ident: Any = obj["id"] ?? NSNull()
        let sem = DispatchSemaphore(value: 0)
        let une = Une()
        DispatchQueue.main.async {
            traiter(backend, obj) { res in
                guard une.premiere() else { return }
                ecrireReponse(ident, res)
                sem.signal()
            }
        }
        sem.wait()
    }
    exit(0)
}
lecteur.start()

app.run()
