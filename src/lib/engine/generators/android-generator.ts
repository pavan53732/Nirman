// Real Android Generator — produces a complete, compilable Jetpack Compose
// app with Room persistence, Hilt DI, Navigation, and CRUD screens derived
// from the data model.
//
// Output structure:
//   settings.gradle.kts
//   build.gradle.kts (root)
//   gradle/libs.versions.toml
//   app/build.gradle.kts
//   app/src/main/AndroidManifest.xml
//   app/src/main/java/com/pavan/<app>/MainActivity.kt
//   app/src/main/java/com/pavan/<app>/data/local/AppDatabase.kt
//   app/src/main/java/com/pavan/<app>/data/local/<Entity>Dao.kt
//   app/src/main/java/com/pavan/<app>/data/local/<Entity>Entity.kt
//   app/src/main/java/com/pavan/<app>/data/repository/<Entity>Repository.kt
//   app/src/main/java/com/pavan/<app>/ui/theme/Theme.kt
//   app/src/main/java/com/pavan/<app>/ui/screens/<Entity>ListScreen.kt
//   app/src/main/java/com/pavan/<app>/ui/screens/<Entity>ViewModel.kt
//   app/src/main/java/com/pavan/<app>/PavanApp.kt (Application + Hilt)
//   app/src/main/res/values/strings.xml
//   app/src/main/res/values/themes.xml
//   gradle.properties
//   gradle/wrapper/gradle-wrapper.properties
//   README.md

import type { VirtualFile, GenerationResult } from "../generators";
import { registerFiles } from "../generators";
import type { Capability, NonFunctional } from "../types";
import { inferDataModel, pascal, camel, type DataModel } from "./data-model";

export interface AndroidGenerationContext {
  projectName: string;
  targetId: string;
  prompt: string;
  capabilities: Capability[];
  nonFunctionals: NonFunctional[];
}

export function generateAndroidApp(ctx: AndroidGenerationContext): GenerationResult {
  const { projectName, targetId, prompt, capabilities, nonFunctionals } = ctx;
  const appName = pascal(projectName) || "MyApp";
  const pkg = appName.toLowerCase();
  const pkgPath = `com/pavan/${pkg}`;
  const pkgName = `com.pavan.${pkg}`;
  const model = inferDataModel(prompt);
  const entity = model.entityName;
  const entityLower = model.entityNameLower;
  const entityRoute = entity.toLowerCase(); // lowercase route + table name
  const useRoom = capabilities.includes("offline-sync") || nonFunctionals.includes("offline-first");
  void nonFunctionals;

  const files: VirtualFile[] = [];

  // ---- settings.gradle.kts ----
  files.push({
    path: `settings.gradle.kts`,
    language: "kotlin",
    content: `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${appName}"
include(":app")
`,
  });

  // ---- root build.gradle.kts ----
  files.push({
    path: `build.gradle.kts`,
    language: "kotlin",
    content: `// Top-level build file
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.ksp) apply false
}
`,
  });

  // ---- gradle/libs.versions.toml ----
  files.push({
    path: `gradle/libs.versions.toml`,
    language: "toml",
    content: `[versions]
agp = "8.7.2"
kotlin = "2.0.21"
coreKtx = "1.13.1"
lifecycle = "2.8.7"
activityCompose = "1.9.3"
composeBom = "2024.10.01"
navigation = "2.8.4"
room = "2.6.1"
hilt = "2.52"
hiltNavigation = "1.2.0"
ksp = "2.0.21-1.0.27"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
androidx-lifecycle-runtime-ktx = { group = "androidx.lifecycle", name = "lifecycle-runtime-ktx", version.ref = "lifecycle" }
androidx-lifecycle-viewmodel-compose = { group = "androidx.lifecycle", name = "lifecycle-viewmodel-compose", version.ref = "lifecycle" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-ui = { group = "androidx.compose.ui", name = "ui" }
androidx-ui-graphics = { group = "androidx.compose.ui", name = "ui-graphics" }
androidx-ui-tooling = { group = "androidx.compose.ui", name = "ui-tooling" }
androidx-ui-tooling-preview = { group = "androidx.compose.ui", name = "ui-tooling-preview" }
androidx-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-material-icons-extended = { group = "androidx.compose.material", name = "material-icons-extended" }
androidx-navigation-compose = { group = "androidx.navigation", name = "navigation-compose", version.ref = "navigation" }
androidx-room-runtime = { group = "androidx.room", name = "room-runtime", version.ref = "room" }
androidx-room-ktx = { group = "androidx.room", name = "room-ktx", version.ref = "room" }
androidx-room-compiler = { group = "androidx.room", name = "room-compiler", version.ref = "room" }
hilt-android = { group = "com.google.dagger", name = "hilt-android", version.ref = "hilt" }
hilt-compiler = { group = "com.google.dagger", name = "hilt-compiler", version.ref = "hilt" }
androidx-hilt-navigation-compose = { group = "androidx.hilt", name = "hilt-navigation-compose", version.ref = "hiltNavigation" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
hilt = { id = "com.google.dagger.hilt.android", version.ref = "hilt" }
ksp = { id = "com.google.devtools.ksp", version.ref = "ksp" }
`,
  });

  // ---- app/build.gradle.kts ----
  files.push({
    path: `app/build.gradle.kts`,
    language: "kotlin",
    content: `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

android {
    namespace = "${pkgName}"
    compileSdk = 34

    defaultConfig {
        applicationId = "${pkgName}"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)

${useRoom ? `    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

` : ""}    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.androidx.hilt.navigation.compose)

    debugImplementation(libs.androidx.ui.tooling)
}
`,
  });

  // ---- AndroidManifest.xml ----
  files.push({
    path: `app/src/main/AndroidManifest.xml`,
    language: "xml",
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <application
        android:name=".PavanApp"
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="${projectName}"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.${appName}">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:theme="@style/Theme.${appName}">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
`,
  });

  // ---- PavanApp.kt (Application + Hilt) ----
  files.push({
    path: `app/src/main/java/${pkgPath}/PavanApp.kt`,
    language: "kotlin",
    content: `package ${pkgName}

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class PavanApp : Application()
`,
  });

  // ---- MainActivity.kt (NavHost + 2 screens) ----
  files.push({
    path: `app/src/main/java/${pkgPath}/MainActivity.kt`,
    language: "kotlin",
    content: `package ${pkgName}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import ${pkgName}.ui.theme.PavanTheme
import ${pkgName}.ui.screens.${entity}ListScreen
import ${pkgName}.ui.screens.OverviewScreen
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PavanTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    val navController = rememberNavController()
                    NavHost(
                        navController = navController,
                        startDestination = "overview",
                        modifier = Modifier.padding(innerPadding)
                    ) {
                        composable("overview") {
                            OverviewScreen(
                                onNavigateTo${entity} = { navController.navigate("${entityRoute}") }
                            )
                        }
                        composable("${entityRoute}") {
                            ${entity}ListScreen()
                        }
                    }
                }
            }
        }
    }
}
`,
  });

  // ---- ui/theme/Theme.kt ----
  files.push({
    path: `app/src/main/java/${pkgPath}/ui/theme/Theme.kt`,
    language: "kotlin",
    content: `package ${pkgName}.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFF6750A4),
    secondary = Color(0xFF625B71),
    tertiary = Color(0xFF7D5260),
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF6750A4),
    secondary = Color(0xFF625B71),
    tertiary = Color(0xFF7D5260),
)

@Composable
fun PavanTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }
    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
`,
  });

  // ---- data/local/<Entity>Entity.kt (Room) ----
  if (useRoom) {
    files.push({
      path: `app/src/main/java/${pkgPath}/data/local/${entity}Entity.kt`,
      language: "kotlin",
      content: `package ${pkgName}.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "${entityRoute}s")
data class ${entity}Entity(
    @PrimaryKey val id: String = java.util.UUID.randomUUID().toString(),
    val name: String,
    val description: String? = null,
    val quantity: Int = 0,
    val price: Double = 0.0,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)
`,
    });

    files.push({
      path: `app/src/main/java/${pkgPath}/data/local/${entity}Dao.kt`,
      language: "kotlin",
      content: `package ${pkgName}.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface ${entity}Dao {
    @Query("SELECT * FROM ${entityRoute}s ORDER BY createdAt DESC")
    fun getAll(): Flow<List<${entity}Entity>>

    @Insert
    suspend fun insert(item: ${entity}Entity)

    @Update
    suspend fun update(item: ${entity}Entity)

    @Delete
    suspend fun delete(item: ${entity}Entity)

    @Query("DELETE FROM ${entityRoute}s WHERE id = :id")
    suspend fun deleteById(id: String)
}
`,
    });

    files.push({
      path: `app/src/main/java/${pkgPath}/data/local/AppDatabase.kt`,
      language: "kotlin",
      content: `package ${pkgName}.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(entities = [${entity}Entity::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun ${entityLower}Dao(): ${entity}Dao
}
`,
    });

    // ---- data/repository/<Entity>Repository.kt ----
    files.push({
      path: `app/src/main/java/${pkgPath}/data/repository/${entity}Repository.kt`,
      language: "kotlin",
      content: `package ${pkgName}.data.repository

import ${pkgName}.data.local.${entity}Dao
import ${pkgName}.data.local.${entity}Entity
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ${entity}Repository @Inject constructor(
    private val dao: ${entity}Dao
) {
    fun getAll(): Flow<List<${entity}Entity>> = dao.getAll()

    suspend fun insert(item: ${entity}Entity) = dao.insert(item)

    suspend fun update(item: ${entity}Entity) = dao.update(item)

    suspend fun delete(item: ${entity}Entity) = dao.delete(item)

    suspend fun deleteById(id: String) = dao.deleteById(id)
}
`,
    });

    // ---- di/AppModule.kt (Hilt) ----
    files.push({
      path: `app/src/main/java/${pkgPath}/di/AppModule.kt`,
      language: "kotlin",
      content: `package ${pkgName}.di

import android.content.Context
import androidx.room.Room
import ${pkgName}.data.local.AppDatabase
import ${pkgName}.data.local.${entity}Dao
import ${pkgName}.data.repository.${entity}Repository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, "${pkg}.db")
            .fallbackToDestructiveMigration()
            .build()

    @Provides
    fun provide${entity}Dao(db: AppDatabase): ${entity}Dao = db.${entityLower}Dao()

    @Provides
    @Singleton
    fun provide${entity}Repository(dao: ${entity}Dao): ${entity}Repository = ${entity}Repository(dao)
}
`,
    });
  }

  // ---- ui/screens/<Entity>ViewModel.kt ----
  files.push({
    path: `app/src/main/java/${pkgPath}/ui/screens/${entity}ViewModel.kt`,
    language: "kotlin",
    content: `package ${pkgName}.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ${pkgName}.data.local.${entity}Entity
${useRoom ? `import ${pkgName}.data.repository.${entity}Repository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject` : ""}
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

${useRoom ? `@HiltViewModel
class ${entity}ViewModel @Inject constructor(
    private val repository: ${entity}Repository
) : ViewModel() {` : `class ${entity}ViewModel : ViewModel() {`}

    private val _items = MutableStateFlow<List<${entity}Entity>>(emptyList())
    val items: StateFlow<List<${entity}Entity>> = _items.asStateFlow()

    private val _name = MutableStateFlow("")
    val name: StateFlow<String> = _name.asStateFlow()

    private val _quantity = MutableStateFlow(0)
    val quantity: StateFlow<Int> = _quantity.asStateFlow()

    private val _price = MutableStateFlow(0.0)
    val price: StateFlow<Double> = _price.asStateFlow()

    init {
${useRoom ? `        viewModelScope.launch {
            repository.getAll().collect { items ->
                _items.value = items
            }
        }` : `        // No persistence layer; items stay in memory`}
    }

    fun onNameChange(value: String) { _name.value = value }
    fun onQuantityChange(value: Int) { _quantity.value = value }
    fun onPriceChange(value: Double) { _price.value = value }

    fun addItem() {
        val name = _name.value.trim()
        if (name.isEmpty()) return
        val item = ${entity}Entity(
            name = name,
            quantity = _quantity.value,
            price = _price.value,
        )
${useRoom ? `        viewModelScope.launch { repository.insert(item) }` : `        _items.value = listOf(item) + _items.value`}
        _name.value = ""
        _quantity.value = 0
        _price.value = 0.0
    }

    fun deleteItem(item: ${entity}Entity) {
${useRoom ? `        viewModelScope.launch { repository.delete(item) }` : `        _items.value = _items.value.filter { it.id != item.id }`}
    }
}
`,
  });

  // ---- ui/screens/InventoryListScreen.kt ----
  files.push({
    path: `app/src/main/java/${pkgPath}/ui/screens/${entity}ListScreen.kt`,
    language: "kotlin",
    content: `package ${pkgName}.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ${pkgName}.data.local.${entity}Entity
${useRoom ? `import androidx.hilt.navigation.compose.hiltViewModel` : ""}

@Composable
fun ${entity}ListScreen(
    viewModel: ${entity}ViewModel = ${useRoom ? "hiltViewModel()" : "${entity}ViewModel()"}
) {
    val items by viewModel.items.collectAsState()
    val name by viewModel.name.collectAsState()
    val quantity by viewModel.quantity.collectAsState()
    val price by viewModel.price.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text(
            text = "${entity}",
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.padding(bottom = 16.dp)
        )

        // Add form
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedTextField(
                value = name,
                onValueChange = viewModel::onNameChange,
                label = { Text("Name") },
                modifier = Modifier.weight(1f),
                singleLine = true
            )
            OutlinedTextField(
                value = quantity.toString(),
                onValueChange = { viewModel.onQuantityChange(it.toIntOrNull() ?: 0) },
                label = { Text("Qty") },
                modifier = Modifier.width(80.dp),
                singleLine = true
            )
            OutlinedTextField(
                value = price.toString(),
                onValueChange = { viewModel.onPriceChange(it.toDoubleOrNull() ?: 0.0) },
                label = { Text("Price") },
                modifier = Modifier.width(100.dp),
                singleLine = true
            )
            Button(onClick = viewModel::addItem) {
                Text("Add")
            }
        }

        // List
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(items, key = { it.id }) { item ->
                ${entity}Card(item = item, onDelete = { viewModel.deleteItem(item) })
            }
        }
    }
}

@Composable
private fun ${entity}Card(item: ${entity}Entity, onDelete: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = item.name, style = MaterialTheme.typography.titleMedium)
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Qty: \\${'$'}{item.quantity}  •  Price: \\${'$'}{String.format("%.2f", item.price)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                if (item.description != null) {
                    Text(
                        text = item.description,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, contentDescription = "Delete")
            }
        }
    }
}
`,
  });

  // ---- ui/screens/OverviewScreen.kt ----
  files.push({
    path: `app/src/main/java/${pkgPath}/ui/screens/OverviewScreen.kt`,
    language: "kotlin",
    content: `package ${pkgName}.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun OverviewScreen(
    onNavigateTo${entity}: () -> Unit
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "${projectName}",
            style = MaterialTheme.typography.headlineMedium
        )
        Text(
            text = "Welcome to your generated Android app.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Card(
            modifier = Modifier.fillMaxWidth(),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("${entity} Management", style = MaterialTheme.typography.titleMedium)
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    "View, add, and delete ${entityRoute} records.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(12.dp))
                Button(onClick = onNavigateTo${entity}) {
                    Text("Open ${entity}")
                }
            }
        }
    }
}
`,
  });

  // ---- res/values/strings.xml ----
  files.push({
    path: `app/src/main/res/values/strings.xml`,
    language: "xml",
    content: `<resources>
    <string name="app_name">${projectName}</string>
</resources>
`,
  });

  // ---- res/values/themes.xml ----
  files.push({
    path: `app/src/main/res/values/themes.xml`,
    language: "xml",
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.${appName}" parent="android:Theme.Material.Light.NoActionBar" />
</resources>
`,
  });

  // ---- gradle.properties ----
  files.push({
    path: `gradle.properties`,
    language: "properties",
    content: `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
android.nonTransitiveRClass=true
`,
  });

  // ---- gradle wrapper properties ----
  files.push({
    path: `gradle/wrapper/gradle-wrapper.properties`,
    language: "properties",
    content: `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.9-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`,
  });

  // ---- proguard-rules.pro ----
  files.push({
    path: `app/proguard-rules.pro`,
    language: "text",
    content: `# Add project specific ProGuard rules here.
-keep class ${pkgName}.data.local.** { *; }
`,
  });

  // ---- README ----
  files.push({
    path: `README.md`,
    language: "markdown",
    content: `# ${projectName} — Android App

A real Jetpack Compose Android app generated by Pavan's Android Generator (Droid).

## What's included
- Kotlin + Jetpack Compose (Material 3)
- Navigation Compose (Overview + ${entity} screens)
${useRoom ? `- Room database (${entity}Entity + ${entity}Dao + AppDatabase)
- Hilt DI (AppModule + @HiltAndroidApp)
- Repository pattern (${entity}Repository)
` : ""}- ${entity}ViewModel with StateFlow
- ${entity}ListScreen with LazyColumn + add form + delete

## Build
\`\`\`bash
./gradlew assembleDebug
\`\`\`

## Structure
- \`app/src/main/java/${pkgPath}/MainActivity.kt\` — NavHost entry
- \`app/src/main/java/${pkgPath}/ui/screens/${entity}ListScreen.kt\` — CRUD screen
- \`app/src/main/java/${pkgPath}/ui/screens/OverviewScreen.kt\` — overview
${useRoom ? `- \`app/src/main/java/${pkgPath}/data/local/\` — Room DB, DAO, Entity
- \`app/src/main/java/${pkgPath}/data/repository/\` — Repository
- \`app/src/main/java/${pkgPath}/di/AppModule.kt\` — Hilt module
` : ""}
## Min SDK
- minSdk 26, targetSdk 34, Java 17

Generated by Pavan — Autonomous Software Creator.
`,
  });

  void camel;
  return registerFiles(files, "android", "Kotlin + Jetpack Compose" + (useRoom ? " + Room + Hilt" : ""), "android-generator", targetId, "source-code", "generate");
}
