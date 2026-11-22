// AI for Safari : petite app macOS dont la fenetre se colle au bord droit de la fenetre Safari de devant.
// Le contenu est une page web servie en local par panneau/discussion.py (affichee dans un WKWebView).
// Safari n'est jamais mis au premier plan par ce programme ; il ne fait que LIRE les bornes de sa fenetre
// (sauf demande explicite de la page : message "faire_place").

import Cocoa
import WebKit

let L_DEFAUT: CGFloat = 400
let L_MIN: CGFloat = 340
let L_MAX: CGFloat = 560
let ID_SAFARI = "com.apple.Safari"

func journal(_ s: String) {
    FileHandle.standardError.write((s + "\n").data(using: .utf8)!)
}

// MARK: - Arguments

let argv = CommandLine.arguments
func valeurArg(_ nom: String) -> String? {
    if let i = argv.firstIndex(of: nom), i + 1 < argv.count { return argv[i + 1] }
    return nil
}
let cheminCapture = valeurArg("--essai-capture")
let largeurEssai = CGFloat(Double(valeurArg("--largeur") ?? "") ?? 400)
let hauteurEssai = CGFloat(Double(valeurArg("--hauteur") ?? "") ?? 900)
let adresseEssai = ProcessInfo.processInfo.environment["CS_PANNEAU_URL"]

// MARK: - Vues

final class VuePanneau: WKWebView {
    // Le premier clic dans le panneau (app pas encore active) doit servir au champ de texte, pas seulement activer l'app.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { return true }
}

final class Panneau: NSPanel {
    override var canBecomeKey: Bool { return true }
    override var canBecomeMain: Bool { return false }
}

// MARK: - AppleScript (lecture des bornes de Safari)

let sourceAppleScript = """
on devant()
	tell application "Safari"
		with timeout of 2 seconds
			if (count of windows) is 0 then return {}
			set fw to front window
			set b to bounds of fw
			return {id of fw, item 1 of b, item 2 of b, item 3 of b, item 4 of b}
		end timeout
	end tell
end devant

on largeur(w, lw)
	tell application "Safari"
		with timeout of 2 seconds
			if exists window id w then
				set b to bounds of window id w
				set bounds of window id w to {item 1 of b, item 2 of b, (item 1 of b) + lw, item 4 of b}
			end if
		end timeout
	end tell
	return "ok"
end largeur
"""

enum Lecture {
    case aucune
    case fenetre(id: Int, l: Double, t: Double, r: Double, b: Double)
    case erreur
}

func echapper(_ s: String) -> String {
    return s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
}

func estLocal(_ u: URL) -> Bool {
    return u.host == "127.0.0.1" || u.isFileURL || u.scheme == "about" || u.scheme == "data"
}

func ouvrirDehors(_ u: URL) {
    guard let s = u.scheme?.lowercased(), s == "http" || s == "https" || s == "mailto" else { return }
    NSWorkspace.shared.open(u)
}

// MARK: - Controleur

final class Controleur: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    var vue: VuePanneau!
    var panneau: Panneau?
    var fenetreEssai: NSWindow?
    var enfant: Process?
    var tampon = Data()
    var ligneRecue = false
    var minuterie: Timer?
    var script: NSAppleScript?
    var largeursOrigine: [Int: Double] = [:]   // id de fenetre Safari -> largeur avant "faire_place"
    var surChargement: (() -> Void)?
    var surEchec: ((String) -> Void)?
    var signaux: [DispatchSourceSignal] = []

    func applicationDidFinishLaunching(_ n: Notification) {
        construireVue()
        if let c = cheminCapture { lancerCapture(c); return }
        // Aucune demande à macOS au lancement : chaque droit n'est demandé qu'au moment où il sert pour la première
        // fois (capture d'écran, son des pages, micro), par l'outil qui en a besoin.
        construireMenu()
        construirePanneau()
        compilerScript()
        installerSignaux()
        if let a = adresseEssai {
            if let u = URL(string: a) { charger(u) } else { afficherErreur("L'adresse de l'essai n'est pas valide : \(a)") }
        } else {
            lancerEnfant()
        }
        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(t, forMode: .common)
        minuterie = t
        tick()
    }

    func applicationWillTerminate(_ n: Notification) {
        minuterie?.invalidate()
        restaurerSafari()
        arreterEnfant()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { return false }

    // MARK: Construction

    func construireVue() {
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "cs")
        let v = VuePanneau(frame: NSRect(x: 0, y: 0, width: L_DEFAUT, height: 700), configuration: cfg)
        v.autoresizingMask = [.width, .height]
        v.navigationDelegate = self
        v.uiDelegate = self
        vue = v
    }

    func construirePanneau() {
        let ecran = NSScreen.main ?? NSScreen.screens[0]
        let vis = ecran.visibleFrame
        let p = Panneau(contentRect: NSRect(x: vis.maxX - L_DEFAUT, y: vis.minY, width: L_DEFAUT, height: vis.height),
                        styleMask: [.borderless, .resizable], backing: .buffered, defer: false)
        p.isReleasedWhenClosed = false
        p.isFloatingPanel = true
        p.hidesOnDeactivate = false
        p.becomesKeyOnlyIfNeeded = false
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = true
        p.minSize = NSSize(width: L_MIN, height: 300)
        p.maxSize = NSSize(width: L_MAX, height: 10000)
        // Pas une fenetre d'app a part dans Mission Control ni dans le cycle des fenetres ; visible aussi sur Safari en plein ecran.
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle, .transient]
        let fond = NSView(frame: NSRect(origin: .zero, size: p.frame.size))
        fond.wantsLayer = true
        fond.layer?.cornerRadius = 12
        fond.layer?.masksToBounds = true
        fond.layer?.borderWidth = 0.5
        fond.layer?.borderColor = NSColor(white: 0, alpha: 0.25).cgColor
        fond.layer?.backgroundColor = NSColor(calibratedRed: 0.957, green: 0.953, blue: 0.933, alpha: 1).cgColor
        vue.frame = fond.bounds
        fond.addSubview(vue)
        p.contentView = fond
        panneau = p
    }

    func construireMenu() {
        let barre = NSMenu()
        let appItem = NSMenuItem()
        barre.addItem(appItem)
        let m = NSMenu()
        m.addItem(withTitle: "Quitter AI for Safari", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = m
        let edItem = NSMenuItem()
        barre.addItem(edItem)
        let e = NSMenu(title: "Édition")
        e.addItem(withTitle: "Annuler", action: NSSelectorFromString("undo:"), keyEquivalent: "z")
        let ref = e.addItem(withTitle: "Rétablir", action: NSSelectorFromString("redo:"), keyEquivalent: "z")
        ref.keyEquivalentModifierMask = [.command, .shift]
        e.addItem(NSMenuItem.separator())
        e.addItem(withTitle: "Couper", action: NSSelectorFromString("cut:"), keyEquivalent: "x")
        e.addItem(withTitle: "Copier", action: NSSelectorFromString("copy:"), keyEquivalent: "c")
        e.addItem(withTitle: "Coller", action: NSSelectorFromString("paste:"), keyEquivalent: "v")
        e.addItem(withTitle: "Tout sélectionner", action: NSSelectorFromString("selectAll:"), keyEquivalent: "a")
        edItem.submenu = e
        NSApp.mainMenu = barre
    }

    func installerSignaux() {
        for s in [SIGTERM, SIGINT] {
            signal(s, SIG_IGN)
            let src = DispatchSource.makeSignalSource(signal: s, queue: .main)
            src.setEventHandler { NSApp.terminate(nil) }
            src.resume()
            signaux.append(src)
        }
    }

    func compilerScript() {
        let s = NSAppleScript(source: sourceAppleScript)
        var info: NSDictionary?
        if let s = s, s.compileAndReturnError(&info) {
            script = s
        } else {
            journal("compilation AppleScript : \((info?["NSAppleScriptErrorMessage"] as? String) ?? "impossible")")
        }
    }

    // MARK: Programme de discussion

    func lancerEnfant() {
        guard let racine = Bundle.main.object(forInfoDictionaryKey: "CSRacine") as? String, !racine.isEmpty else {
            afficherErreur("L'app ne sait pas où est le programme de discussion (clé CSRacine absente). Reconstruis-la avec construire-app.sh.")
            return
        }
        let chemin = racine + "/panneau/discussion.py"
        guard FileManager.default.fileExists(atPath: chemin) else {
            afficherErreur("Le programme de discussion est introuvable : \(chemin)")
            return
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        p.arguments = [chemin]
        p.currentDirectoryURL = URL(fileURLWithPath: racine)
        let tube = Pipe()
        p.standardOutput = tube
        p.standardInput = FileHandle.nullDevice
        p.standardError = FileHandle.standardError
        tube.fileHandleForReading.readabilityHandler = { [weak self] h in
            let d = h.availableData
            if d.isEmpty { h.readabilityHandler = nil; return }
            DispatchQueue.main.async { self?.recevoir(d) }
        }
        p.terminationHandler = { [weak self] proc in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                guard let s = self, !s.ligneRecue else { return }
                s.ligneRecue = true
                s.afficherErreur("Le programme de discussion s'est arrêté avant d'être prêt (code \(proc.terminationStatus)).")
            }
        }
        do {
            try p.run()
        } catch {
            afficherErreur("Le programme de discussion n'a pas pu démarrer : \(error.localizedDescription)")
            return
        }
        enfant = p
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            guard let s = self, !s.ligneRecue else { return }
            s.ligneRecue = true
            s.afficherErreur("Le programme de discussion n'a pas répondu en 10 secondes.")
            s.arreterEnfant()
        }
    }

    func recevoir(_ d: Data) {
        guard !ligneRecue else { return }   // apres la premiere ligne, on lit et on jette (le tube ne doit pas se remplir)
        tampon.append(d)
        guard let nl = tampon.firstIndex(of: 10) else { return }
        ligneRecue = true
        let ligne = tampon[tampon.startIndex..<nl]
        guard let obj = (try? JSONSerialization.jsonObject(with: Data(ligne))) as? [String: Any],
              let a = obj["url"] as? String, let u = URL(string: a) else {
            afficherErreur("Le programme de discussion a donné une première ligne illisible.")
            return
        }
        charger(u)
    }

    func arreterEnfant() {
        guard let p = enfant, p.isRunning else { return }
        p.terminate()
        let fin = Date().addingTimeInterval(1)
        while p.isRunning && Date() < fin { usleep(20_000) }
        if p.isRunning { kill(p.processIdentifier, SIGKILL) }
    }

    func charger(_ u: URL) {
        if u.isFileURL {
            vue.loadFileURL(u, allowingReadAccessTo: u.deletingLastPathComponent())
        } else {
            vue.load(URLRequest(url: u))
        }
    }

    func afficherErreur(_ detail: String) {
        journal("erreur : \(detail)")
        let html = """
        <!doctype html><meta charset="utf-8"><body style="margin:0;padding:28px;background:#f4f3ee;color:#2b2a27;font:15px/1.5 -apple-system,sans-serif">
        <h2 style="margin:0 0 12px;font-size:19px">Claude ne peut pas s'afficher</h2>
        <p>\(echapper(detail))</p>
        <p style="color:#77746c">Ferme « AI for Safari » (⌘Q) puis rouvre-le.</p></body>
        """
        vue.loadHTMLString(html, baseURL: nil)
    }

    // MARK: Lecture de Safari

    func appeler(_ nom: String, _ params: [NSAppleEventDescriptor]) -> NSAppleEventDescriptor? {
        guard let script = script else { return nil }
        let ev = NSAppleEventDescriptor(eventClass: 0x6173_6372, eventID: 0x7073_6272,   // 'ascr' 'psbr'
                                        targetDescriptor: NSAppleEventDescriptor.currentProcess(),
                                        returnID: -1, transactionID: 0)
        ev.setParam(NSAppleEventDescriptor(string: nom.lowercased()), forKeyword: 0x736E_616D)  // 'snam'
        let liste = NSAppleEventDescriptor.list()
        for (i, p) in params.enumerated() { liste.insert(p, at: i + 1) }
        ev.setParam(liste, forKeyword: 0x2D2D_2D2D)  // '----'
        var info: NSDictionary?
        let r = script.executeAppleEvent(ev, error: &info)
        if info != nil { return nil }
        return r
    }

    func safariLance() -> Bool {
        return !NSRunningApplication.runningApplications(withBundleIdentifier: ID_SAFARI).isEmpty
    }

    func lireDevant() -> Lecture {
        guard let d = appeler("devant", []) else { return .erreur }
        if d.numberOfItems < 5 { return .aucune }
        func v(_ i: Int) -> Double { return Double(d.atIndex(i)?.int32Value ?? 0) }
        return .fenetre(id: Int(v(1)), l: v(2), t: v(3), r: v(4), b: v(5))
    }

    // MARK: Suivi

    func cacher() {
        if let p = panneau, p.isVisible { p.orderOut(nil) }
    }

    /// Le panneau flottant (avant l'extension) ne sert plus que si l'on pose ~/.claude-safari/panneau-flottant.
    /// Par défaut, l'app fait seulement tourner le programme de discussion : pas de fenêtre, pas d'AppleScript.
    var flottant: Bool { return FileManager.default.fileExists(atPath: NSHomeDirectory() + "/.claude-safari/panneau-flottant") }

    func montrer() {
        guard let p = panneau else { return }
        if !flottant {
            if p.isVisible { p.orderOut(nil) }
            return
        }
        if !p.isVisible {
            p.level = .floating
            p.orderFrontRegardless()
        }
    }

    func ecranPour(_ r: NSRect) -> NSScreen {
        var meilleur: NSScreen? = nil
        var aire: CGFloat = 0
        for e in NSScreen.screens {
            let i = e.frame.intersection(r)
            let a = i.isNull ? 0 : i.width * i.height
            if a > aire { aire = a; meilleur = e }
        }
        return meilleur ?? NSScreen.main ?? NSScreen.screens[0]
    }

    func largeurPanneau() -> CGFloat {
        guard let p = panneau else { return L_DEFAUT }
        return min(L_MAX, max(L_MIN, p.frame.width))
    }

    /// Bornes de Safari (haut-gauche, repere AppleScript) -> rectangle Cocoa (bas-gauche).
    func rectCocoa(_ l: Double, _ t: Double, _ r: Double, _ b: Double) -> NSRect {
        let hPrimaire = NSScreen.screens[0].frame.height
        return NSRect(x: l, y: hPrimaire - b, width: r - l, height: b - t)
    }

    func tick() {
        guard flottant else { cacher(); return }          // sans panneau flottant, on ne lit jamais Safari
        guard let p = panneau, !p.inLiveResize else { return }
        let devant = NSWorkspace.shared.frontmostApplication
        let estSafari = devant?.bundleIdentifier == ID_SAFARI
        let estNous = devant?.processIdentifier == getpid()
        guard estSafari || estNous, safariLance() else { cacher(); return }
        switch lireDevant() {
        case .aucune:
            cacher()
        case .erreur:
            // Lecture impossible (droit refuse, Safari occupe) : on garde la place actuelle, sinon le bord droit de l'ecran.
            if !p.isVisible {
                let vis = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
                let w = largeurPanneau()
                p.setFrame(NSRect(x: vis.maxX - w, y: vis.minY, width: w, height: vis.height), display: true)
            }
            montrer()
        case .fenetre(_, let l, let t, let r, let b):
            let sr = rectCocoa(l, t, r, b)
            let vis = ecranPour(sr).visibleFrame
            let w = largeurPanneau()
            var x = sr.maxX
            if x + w > vis.maxX { x = vis.maxX - w }   // pas de place a droite : le panneau recouvre le bord de Safari
            let cible = NSRect(x: x, y: sr.minY, width: w, height: sr.height)
            let a = p.frame
            if abs(a.minX - cible.minX) > 0.5 || abs(a.minY - cible.minY) > 0.5
                || abs(a.width - cible.width) > 0.5 || abs(a.height - cible.height) > 0.5 {
                p.setFrame(cible, display: true)
                p.invalidateShadow()
            }
            montrer()
        }
    }

    // MARK: Faire de la place / restaurer

    func fairePlace() {
        guard cheminCapture == nil, safariLance(), case .fenetre(let id, let l, let t, let r, let b) = lireDevant() else { return }
        let vis = ecranPour(rectCocoa(l, t, r, b)).visibleFrame
        let limite = Double(vis.maxX - largeurPanneau())
        if r <= limite { return }   // ca tient deja
        let nouvelleLargeur = max(480, limite - l)
        if largeursOrigine[id] == nil { largeursOrigine[id] = r - l }
        _ = appeler("largeur", [NSAppleEventDescriptor(int32: Int32(id)), NSAppleEventDescriptor(int32: Int32(nouvelleLargeur))])
    }

    func restaurerSafari() {
        guard !largeursOrigine.isEmpty, safariLance() else { return }
        for (id, lw) in largeursOrigine {
            _ = appeler("largeur", [NSAppleEventDescriptor(int32: Int32(id)), NSAppleEventDescriptor(int32: Int32(lw))])
        }
        largeursOrigine.removeAll()
    }

    // MARK: Pont JavaScript -> app

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        let o = m.frameInfo.securityOrigin
        guard o.host == "127.0.0.1" || o.protocol == "file" else { return }
        guard let d = m.body as? [String: Any], let type = d["type"] as? String else { return }
        switch type {
        case "fermer":
            NSApp.terminate(nil)
        case "faire_place":
            fairePlace()
        case "ouvrir":
            if let s = d["url"] as? String, let u = URL(string: s) { ouvrirDehors(u) }
        default:
            break
        }
    }

    // MARK: Navigation

    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if a.navigationType == .linkActivated, let u = a.request.url, !estLocal(u) {
            ouvrirDehors(u)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url {
            if estLocal(u) { w.load(a.request) } else { ouvrirDehors(u) }
        }
        return nil
    }

    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        surChargement?()
    }

    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { echecChargement(e) }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { echecChargement(e) }

    func echecChargement(_ e: Error) {
        let ns = e as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        if let f = surEchec { f(ns.localizedDescription); return }
        afficherErreur("La page du panneau n'a pas pu se charger : \(ns.localizedDescription)")
    }

    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.runModal()
        completionHandler()
    }

    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert()
        a.messageText = message
        a.addButton(withTitle: "OK")
        a.addButton(withTitle: "Annuler")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }

    // MARK: Essai : instantane de la vue, sans toucher a Safari

    func lancerCapture(_ chemin: String) {
        guard let a = adresseEssai, let u = URL(string: a) else {
            journal("--essai-capture : la variable CS_PANNEAU_URL est obligatoire")
            exit(2)
        }
        // Fenetre hors ecran, jamais affichee (meme methode que le banc du pont).
        let win = NSWindow(contentRect: NSRect(x: -20000, y: -20000, width: largeurEssai, height: hauteurEssai),
                           styleMask: [.borderless], backing: .buffered, defer: false)
        win.isReleasedWhenClosed = false
        fenetreEssai = win
        vue.frame = win.contentView!.bounds
        win.contentView!.addSubview(vue)
        var vu = false
        surChargement = { [weak self] in
            if vu { return }
            vu = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self?.prendre(chemin) }
        }
        surEchec = { msg in
            journal("chargement impossible : \(msg)")
            exit(1)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
            journal("delai depasse : la page ne s'est pas chargee en 30 s")
            exit(1)
        }
        charger(u)
    }

    func prendre(_ chemin: String) {
        vue.takeSnapshot(with: WKSnapshotConfiguration()) { img, err in
            guard let img = img, let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
                journal("instantane impossible : \(err?.localizedDescription ?? "inconnu")")
                exit(1)
            }
            guard let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:]) else {
                journal("encodage PNG impossible")
                exit(1)
            }
            do { try png.write(to: URL(fileURLWithPath: chemin)) }
            catch {
                journal("ecriture impossible : \(error.localizedDescription)")
                exit(1)
            }
            exit(0)
        }
    }
}

// MARK: - Demarrage

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controleur = Controleur()
app.delegate = controleur
app.run()
