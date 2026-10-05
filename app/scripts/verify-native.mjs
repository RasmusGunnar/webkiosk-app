import {readFileSync,readdirSync} from 'node:fs'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import sharp from 'sharp'
const require=createRequire(import.meta.url),plist=require('plist'),xcode=require('xcode')
process.chdir(fileURLToPath(new URL('../',import.meta.url)))
const checks=[],pass=name=>{checks.push(name);console.log('PASS '+checks.length+': '+name)}
const config=JSON.parse(readFileSync('capacitor.config.json','utf8'))
assert.equal(config.appId,'dk.rasmusgunnar.familiekalender');assert.equal(config.webDir,'dist');assert.equal(config.server.cleartext,false);assert(!config.server.url);pass('Native identity uses bundled dist and secure local origin, no remote live-reload server')
const manifest=readFileSync('android/app/src/main/AndroidManifest.xml','utf8'),gradle=readFileSync('android/app/build.gradle','utf8'),variables=readFileSync('android/variables.gradle','utf8')
assert.match(variables,/targetSdkVersion = 36/);assert.match(variables,/minSdkVersion = 24/);assert.match(gradle,/versionName "1.0.0"/);assert.match(gradle,/versionCode 1/);pass('Android API 36 target, API 24 minimum and version 1.0.0 (1)')
assert.match(manifest,/usesCleartextTraffic="false"/);assert.match(manifest,/allowBackup="false"/);assert.match(manifest,/android:scheme="familiekalender"/);assert.match(manifest,/android:exported="false"/);assert(!/android.permission.(ACCESS_FINE_LOCATION|READ_CONTACTS|RECORD_AUDIO|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE)/.test(manifest));pass('Android custom scheme, no cleartext, private file provider, minimal declared permissions')
assert.match(gradle,/if \(hasReleaseSigning\) signingConfig signingConfigs.release/);assert.match(gradle,/throw new GradleException/);pass('Release signing fails closed without the four environment values')
const info=plist.parse(readFileSync('ios/App/App/Info.plist','utf8'))
assert.equal(info.CFBundleDisplayName,'Familiekalender');assert(info.CFBundleURLTypes[0].CFBundleURLSchemes.includes('familiekalender'));assert.equal(info.NSAppTransportSecurity.NSAllowsArbitraryLoads,false);pass('iOS plist parses with correct display name, URL scheme and ATS')
assert.match(manifest,/<queries>[\s\S]*android.media.action.IMAGE_CAPTURE/);assert.match(info.NSCameraUsageDescription,/opskrift/);assert.match(info.NSPhotoLibraryUsageDescription,/opskrift/);assert.match(readFileSync('src/lib/recipe-ui.js','utf8'),/id="scan-camera" type="file" accept="image\/\*" capture="environment"/);pass('Recipe camera uses Capacitor-compatible capture input, Android intent visibility and iOS purpose strings')
const privacy=plist.parse(readFileSync('ios/App/App/PrivacyInfo.xcprivacy','utf8'))
assert.equal(privacy.NSPrivacyTracking,false);assert(privacy.NSPrivacyAccessedAPITypes.some(t=>t.NSPrivacyAccessedAPITypeReasons.includes('C617.1')));pass('iOS privacy manifest declares filesystem reason without tracking')
const project=xcode.project('ios/App/App.xcodeproj/project.pbxproj');project.parseSync()
const projectText=readFileSync(project.filepath,'utf8');assert.match(projectText,/PrivacyInfo.xcprivacy in Resources/);assert(!projectText.includes('undefined'));assert.match(projectText,/MARKETING_VERSION = 1.0.0/);assert.match(projectText,/IPHONEOS_DEPLOYMENT_TARGET = 15.0/);pass('Xcode project parses, includes privacy resource, iOS 15 minimum and release version')
const scene=readFileSync('ios/App/App/SceneDelegate.swift','utf8'),delegate=readFileSync('ios/App/App/AppDelegate.swift','utf8')
assert.match(scene,/rootViewController = FamilyViewController/);assert.match(scene,/registerPluginInstance\(DeviceScreenPlugin\(\)\)/);assert.match(scene,/SceneDelegateProxy.shared.scene/);assert.match(delegate,/capacitorDidRegisterForRemoteNotifications/);pass('iOS SceneDelegate forwards cold/warm links and registers native wake and push callbacks')
const icon=await sharp('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png').metadata();assert.equal(icon.width,1024);assert.equal(icon.height,1024);assert.equal(icon.hasAlpha,false)
for(const name of readdirSync('ios/App/App/Assets.xcassets/Splash.imageset').filter(v=>v.endsWith('.png'))){const meta=await sharp('ios/App/App/Assets.xcassets/Splash.imageset/'+name).metadata();assert.equal(meta.width,2732)}
pass('iOS icon is opaque 1024px and all splash variants are valid')
for(const dpi of ['mdpi','hdpi','xhdpi','xxhdpi','xxxhdpi']){const m=await sharp('android/app/src/main/res/mipmap-'+dpi+'/ic_launcher_foreground.png').metadata();assert(m.width>0)}
pass('All Android adaptive foreground densities exist and decode')
const pwa=JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));assert.equal(pwa.display,'standalone');assert.equal(pwa.start_url,'/')
for(const icon of pwa.icons){const m=await sharp('public'+icon.src).metadata();assert.equal(icon.sizes,m.width+'x'+m.height)}
pass('PWA manifest and install icons have correct sizes')
console.log('NATIVE STRUCTURAL PASS '+checks.length+'/'+checks.length+'; physical device build/runtime NOT tested')
