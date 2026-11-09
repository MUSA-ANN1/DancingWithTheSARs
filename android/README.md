# Hyperia Android app

This Android Studio project wraps the existing Hyperia website in a native Android WebView. The website itself remains hosted on GitHub Pages, so website updates appear in the app without rebuilding the Android app.

## Open the project

1. Open Android Studio.
2. Select **Open** and choose this `android` folder.
3. Let Android Studio sync the Gradle project.
4. Connect an Android device or start an emulator.
5. Press **Run**.

## Configuration

- Language: Java
- Layout: XML
- Package: `com.hyperia.app`
- Minimum Android version: Android 6.0 (API 23)
- Website: https://musa-ann1.github.io/DancingWithTheSARs/

The app uses an immersive full-screen window. Swipe from the screen edge to temporarily reveal Android system bars. JavaScript and DOM storage are enabled for the interactive globe and website settings.

External links open in the device's browser. Links within the GitHub Pages site stay inside the app.
