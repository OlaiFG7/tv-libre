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
        // En GitHub cada compilación sube el número: así la app sabe si hay una versión nueva (ver Actualizar.kt)
        versionCode = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1
        versionName = "1.$versionCode"
    }

    // Firma fija (la clave está en los secretos del repositorio): así cada versión se instala encima de la anterior.
    // Sin ella, la de depuración, que cambia en cada máquina y obliga a desinstalar para actualizar.
    val almacen = System.getenv("MANDO_KEYSTORE_FILE")?.let(::file)?.takeIf { it.exists() }
    signingConfigs {
        if (almacen != null) create("fija") {
            storeFile = almacen
            storePassword = System.getenv("MANDO_CLAVE")
            keyAlias = "mando"
            keyPassword = System.getenv("MANDO_CLAVE")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = signingConfigs.findByName("fija") ?: signingConfigs.getByName("debug")
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
