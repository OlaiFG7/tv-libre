// Sin dependencias: solo el SDK de Android (WebSocket propio en WebSocket.kt, JSON con org.json del sistema)
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.tvlibre.mando"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tvlibre.mando"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            // Firmado con la clave de depuración para poder instalar el .apk directamente
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    // Los datos compartidos con la app de iOS (manifiesto de emparejamiento y lista de fondos)
    sourceSets["main"].assets.srcDirs("../../compartido")

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
