import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = FamilyViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func sceneDidBecomeActive(_ scene: UIScene) { UIApplication.shared.isIdleTimerDisabled = DeviceScreenPlugin.requestedAwake }

    func sceneWillResignActive(_ scene: UIScene) { UIApplication.shared.isIdleTimerDisabled = false }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

final class FamilyViewController: CAPBridgeViewController {
 override func capacitorDidLoad() { bridge?.registerPluginInstance(DeviceScreenPlugin()) }
}
@objc(DeviceScreenPlugin)
public class DeviceScreenPlugin: CAPPlugin, CAPBridgedPlugin {
 static var requestedAwake = false
 public let identifier = "DeviceScreenPlugin"
 public let jsName = "DeviceScreen"
 public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "setAwake", returnType: CAPPluginReturnPromise)]
 @objc func setAwake(_ call: CAPPluginCall) {
  let enabled = call.getBool("enabled") ?? false
  DispatchQueue.main.async {
   DeviceScreenPlugin.requestedAwake = enabled
   UIApplication.shared.isIdleTimerDisabled = enabled
   call.resolve()
  }
 }
}
