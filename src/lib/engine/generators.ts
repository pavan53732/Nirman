// Real generators — produce actual project file contents that the toolchain
// would create. Starting with the Desktop Generator → WinUI 3 scaffolding
// (the equivalent of `dotnet new winui3`), then expanding to other stacks.
//
// Each generator returns a set of virtual files { path, content } which the
// Artifact Registry versions and the Export Manager writes to disk. This is
// the real generator layer behind the Desktop/Android/Web generator agents.

import type { PlatformKind, ArtifactType, AgentRole } from "./types";
import { artifactRegistry } from "./artifact-registry";
import { registries } from "./registries";
import { generateNextjsApp } from "./generators/web-generator";

export interface VirtualFile {
  path: string;
  content: string;
  language?: string;
}

export interface GenerationResult {
  platform: PlatformKind;
  stack: string;
  files: VirtualFile[];
  producedBy: AgentRole;
  artifactIds: string[];
}

/** Slugify a project name into a valid identifier. */
export function slug(name: string): string {
  const s = name.replace(/[^a-zA-Z0-9]/g, "");
  if (!s) return "App";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ */
/* Desktop Generator — WinUI 3 scaffolding (dotnet new winui3 output)  */
/* ------------------------------------------------------------------ */

export function generateWinUI3(projectName: string, targetId: string): GenerationResult {
  const id = slug(projectName);
  const files: VirtualFile[] = [
    {
      path: `${id}.csproj`,
      language: "xml",
      content: `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows10.0.19041.0</TargetFramework>
    <TargetPlatformMinVersion>10.0.17763.0</TargetPlatformMinVersion>
    <WindowsPackageType>MSIX</WindowsPackageType>
    <UseWinUI>true</UseWinUI>
    <EnableMsixTooling>true</EnableMsixTooling>
    <Nullable>enable</Nullable>
    <LangVersion>latest</LangVersion>
    <RootNamespace>${id}</RootNamespace>
    <ApplicationManifest>app.manifest</ApplicationManifest>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.WindowsAppSDK" Version="1.6.*" />
    <PackageReference Include="Microsoft.Windows.SDK.BuildTools" Version="10.0.26100.*" />
    <PackageReference Include="CommunityToolkit.Mvvm" Version="8.3.*" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="8.0.*" />
  </ItemGroup>

  <ItemGroup>
    <None Update="app.manifest">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </None>
  </ItemGroup>
</Project>
`,
    },
    {
      path: "App.xaml",
      language: "xml",
      content: `<Application
    x:Class="${id}.App"
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    xmlns:local="using:${id}">
    <Application.Resources>
        <ResourceDictionary>
            <ResourceDictionary.MergedDictionaries>
                <XamlControlsResources xmlns="using:Microsoft.UI.Xaml.Controls" />
            </ResourceDictionary.MergedDictionaries>
        </ResourceDictionary>
    </Application.Resources>
</Application>
`,
    },
    {
      path: "App.xaml.cs",
      language: "csharp",
      content: `using Microsoft.UI.Xaml;

namespace ${id};

/// <summary>
/// Provides application-specific behavior to supplement the default Application class.
/// </summary>
public partial class App : Application
{
    private Window? _mainWindow;

    /// <summary>
    /// Initializes the singleton application object.
    /// </summary>
    public App()
    {
        this.InitializeComponent();
    }

    /// <summary>
    /// Invoked when the application is launched normally by the end user.
    /// </summary>
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _mainWindow = new MainWindow();
        _mainWindow.Activate();
    }
}
`,
    },
    {
      path: "MainWindow.xaml",
      language: "xml",
      content: `<Window
    x:Class="${id}.MainWindow"
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    xmlns:local="using:${id}"
    xmlns:d="http://schemas.microsoft.com/expression/blend/2008"
    xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
    mc:Ignorable="d">

    <Grid Padding="24" RowDefinitions="Auto,*,Auto">
        <TextBlock Grid.Row="0"
                   Text="${projectName}"
                   Style="{StaticResource TitleTextBlockStyle}" />

        <ScrollView Grid.Row="1" Margin="0,16,0,16">
            <StackPanel Spacing="12" MaxWidth="800">
                <TextBlock Text="Welcome to your generated WinUI 3 app." />
                <TextBlock Text="This project was scaffolded by the Pavan Desktop Generator (Anvil)."
                           Opacity="0.7" TextWrapping="Wrap" />
            </StackPanel>
        </ScrollView>

        <CommandBar Grid.Row="2" DefaultLabelPosition="Right">
            <AppBarButton Icon="Add" Label="New" />
            <AppBarButton Icon="Save" Label="Save" />
            <AppBarButton Icon="Setting" Label="Settings" />
        </CommandBar>
    </Grid>
</Window>
`,
    },
    {
      path: "MainWindow.xaml.cs",
      language: "csharp",
      content: `using Microsoft.UI.Xaml;

namespace ${id};

/// <summary>
/// An empty window that can be used on its own or navigated to within a Frame.
/// </summary>
public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        this.InitializeComponent();
        Title = "${projectName}";
    }
}
`,
    },
    {
      path: "app.manifest",
      language: "xml",
      content: `<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="1.0.0.0" name="${id}.app"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v2">
    <security>
      <requestedPrivileges xmlns="urn:schemas-microsoft-com:asm.v3">
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
`,
    },
    {
      path: "README.md",
      language: "markdown",
      content: `# ${projectName} — WinUI 3 Desktop App

Generated by Pavan's Desktop Generator (Anvil) using the WinUI 3 template,
equivalent to \`dotnet new winui3\`.

## Build & Run
\`\`\`bash
dotnet restore
dotnet build
dotnet run
\`\`\`

## Stack
- WinUI 3 + Windows App SDK 1.6
- .NET 8 (net8.0-windows10.0.19041.0)
- CommunityToolkit.Mvvm (MVVM source generators)
- EF Core SQLite (offline-first local storage)

## Structure
- \`App.xaml / App.xaml.cs\` — application root
- \`MainWindow.xaml / .cs\` — main window
- \`${id}.csproj\` — project file (MSIX packaging)
- \`app.manifest\` — Windows app manifest
`,
    },
  ];

  return registerFiles(files, "windows", "WinUI 3 + .NET 8", "desktop-generator", targetId, "source-code", "generate");
}

/* ------------------------------------------------------------------ */
/* Android Generator — Kotlin + Jetpack Compose (gradlew output)       */
/* ------------------------------------------------------------------ */

export function generateAndroidCompose(projectName: string, targetId: string): GenerationResult {
  const id = slug(projectName);
  const pkg = id.toLowerCase();
  const files: VirtualFile[] = [
    {
      path: `app/build.gradle.kts`,
      language: "kotlin",
      content: `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.pavan.${pkg}"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.pavan.${pkg}"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildFeatures { compose = true }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }
}

dependencies {
    implementation("androidx.compose.ui:ui:1.7.*")
    implementation("androidx.compose.material3:material3:1.3.*")
    implementation("androidx.activity:activity-compose:1.9.*")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.*")
}
`,
    },
    {
      path: `app/src/main/java/com/pavan/${pkg}/MainActivity.kt`,
      language: "kotlin",
      content: `package com.pavan.${pkg}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Column(modifier = Modifier.padding(24.dp)) {
                        Text(text = "${projectName}", style = MaterialTheme.typography.headlineMedium)
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(text = "Generated by Pavan's Android Generator (Droid).")
                    }
                }
            }
        }
    }
}
`,
    },
    {
      path: `app/src/main/AndroidManifest.xml`,
      language: "xml",
      content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:label="${projectName}"
        android:theme="@style/Theme.Material3.DayNight">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`,
    },
    {
      path: `README.md`,
      language: "markdown",
      content: `# ${projectName} — Android App

Generated by Pavan's Android Generator (Droid) using Kotlin + Jetpack Compose.

## Build
\`\`\`bash
./gradlew assembleRelease
\`\`\`

## Stack
- Kotlin + Jetpack Compose (Material 3)
- minSdk 26, targetSdk 34
`,
    },
  ];

  return registerFiles(files, "android", "Kotlin + Jetpack Compose", "android-generator", targetId, "source-code", "generate");
}

/* ------------------------------------------------------------------ */
/* Web Generator — Next.js (create-next-app output)                    */
/* ------------------------------------------------------------------ */

export function generateNextjs(projectName: string, targetId: string): GenerationResult {
  const id = slug(projectName);
  const files: VirtualFile[] = [
    {
      path: `package.json`,
      language: "json",
      content: `{
  "name": "${id.toLowerCase()}",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "16.1.1",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "typescript": "^5",
    "tailwindcss": "^4"
  }
}
`,
    },
    {
      path: `app/page.tsx`,
      language: "typescript",
      content: `export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold">${projectName}</h1>
      <p className="mt-2 text-gray-600">
        Generated by Pavan&apos;s Web Generator (Forge) using Next.js.
      </p>
    </main>
  );
}
`,
    },
    {
      path: `app/layout.tsx`,
      language: "typescript",
      content: `import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "${projectName}",
  description: "Generated by Pavan — Autonomous Software Creator.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    },
    {
      path: `README.md`,
      language: "markdown",
      content: `# ${projectName} — Web App

Generated by Pavan's Web Generator (Forge) using Next.js.

## Build
\`\`\`bash
npm install
npm run build
\`\`\`
`,
    },
  ];

  return registerFiles(files, "web", "Next.js + Node.js", "frontend-generator", targetId, "source-code", "generate");
}

/* ------------------------------------------------------------------ */
/* Registry helper — version each file as a source-code artifact       */
/* ------------------------------------------------------------------ */

export function registerFiles(
  files: VirtualFile[],
  platform: PlatformKind,
  stack: string,
  producedBy: AgentRole,
  targetId: string,
  type: ArtifactType,
  stageId: string
): GenerationResult {
  const artifactIds: string[] = [];
  for (const f of files) {
    const art = artifactRegistry.produce({
      type,
      name: f.path,
      producedBy,
      workflowId: "new-project",
      stageId,
      targetId,
      path: f.path,
      dependencies: [],
      sizeLabel: `${(f.content.length / 1024).toFixed(1)} KB`,
    });
    artifactIds.push(art.id);
  }
  // Tool Manager would invoke the packaging tool here (e.g. dotnet-build,
  // gradle-assemble, npm-build). We record the toolchain the adapter declares.
  const adapter = registries.platformAdapters.get(platform);
  void adapter;
  void stack;
  return { platform, stack, files, producedBy, artifactIds };
}

/** Dispatch to the right generator based on platform + stack. */
export function generateForTarget(
  platform: PlatformKind,
  stack: string,
  projectName: string,
  targetId: string,
  ctx?: { prompt: string; capabilities: import("./types").Capability[]; nonFunctionals: import("./types").NonFunctional[] }
): GenerationResult {
  if (platform === "windows") {
    if (/tauri/i.test(stack)) return generateTauri(projectName, targetId);
    return generateWinUI3(projectName, targetId);
  }
  if (platform === "android") {
    if (/flutter/i.test(stack)) return generateFlutter(projectName, targetId);
    return generateAndroidCompose(projectName, targetId);
  }
  if (platform === "web") {
    // Real generator: produces a compilable Next.js app with Prisma + auth + CRUD
    if (ctx) {
      return generateNextjsApp({
        projectName,
        targetId,
        prompt: ctx.prompt,
        capabilities: ctx.capabilities,
        nonFunctionals: ctx.nonFunctionals,
      });
    }
    return generateNextjs(projectName, targetId);
  }
  if (platform === "cli") return generateRustCli(projectName, targetId);
  // Fallback: minimal README
  return registerFiles(
    [{ path: "README.md", content: `# ${projectName}\n\nGenerated by Pavan.\n`, language: "markdown" }],
    platform,
    stack,
    "backend-generator",
    targetId,
    "source-code",
    "generate"
  );
}

/* ---- Additional generators (Tauri, Flutter, Rust CLI) ---- */

export function generateTauri(projectName: string, targetId: string): GenerationResult {
  const id = slug(projectName);
  const files: VirtualFile[] = [
    {
      path: `src-tauri/Cargo.toml`,
      language: "toml",
      content: `[package]
name = "${id.toLowerCase()}"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[build-dependencies]
tauri-build = { version = "2", features = [] }
`,
    },
    {
      path: `src-tauri/src/main.rs`,
      language: "rust",
      content: `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ${id.toLowerCase()}_lib::run()
}
`,
    },
    {
      path: `src-tauri/src/lib.rs`,
      language: "rust",
      content: `use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            println!("${projectName} (Tauri) started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
`,
    },
    {
      path: `package.json`,
      language: "json",
      content: `{
  "name": "${id.toLowerCase()}",
  "version": "0.1.0",
  "scripts": {
    "dev": "vite",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2",
    "vite": "^5",
    "typescript": "^5"
  }
}
`,
    },
    {
      // tauri.conf.json — configures the Tauri bundler.
      // bundle.targets ["nsis","msi"] produces both NSIS .exe and MSI installers.
      // webviewInstallMode "downloadBootstrapper" uses the system WebView2
      // (pre-installed on Windows 10/11) instead of bundling Chromium, giving
      // 3-8 MB installers vs 100 MB+ for Electron-style bundled runtimes.
      path: `src-tauri/tauri.conf.json`,
      language: "json",
      content: `{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "${projectName}",
  "version": "0.1.0",
  "identifier": "com.pavan.${id.toLowerCase()}",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "${projectName}",
        "width": 1200,
        "height": 800,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.ico"
    ],
    "windows": {
      "webviewInstallMode": {
        "type": "downloadBootstrapper"
      }
    }
  }
}
`,
    },
    {
      path: `README.md`,
      language: "markdown",
      content: `# ${projectName} — Tauri Desktop App

Generated by Pavan's Desktop Generator (Anvil) using Tauri (Rust + WebView2).

## Build
\`\`\`bash
npm install
npm run tauri build
\`\`\`

## Installer size
Uses the system WebView2 (downloadBootstrapper) on Windows rather than
bundling Chromium, producing **3-8 MB** NSIS .exe / MSI installers vs
100 MB+ for Electron-style bundled runtimes. \`bundle.targets\` is set to
\`["nsis","msi"]\` (add \`"msix"\` to also produce an MSIX package).
`,
    },
  ];
  return registerFiles(files, "windows", "Tauri + Rust", "desktop-generator", targetId, "source-code", "generate");
}

export function generateFlutter(projectName: string, targetId: string): GenerationResult {
  const id = slug(projectName);
  const files: VirtualFile[] = [
    {
      path: `pubspec.yaml`,
      language: "yaml",
      content: `name: ${id.toLowerCase()}
description: ${projectName} — generated by Pavan
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ^3.5.0

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8

flutter:
  uses-material-design: true
`,
    },
    {
      path: `lib/main.dart`,
      language: "dart",
      content: `import 'package:flutter/material.dart';

void main() => runApp(const ${id}App());

class ${id}App extends StatelessWidget {
  const ${id}App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '${projectName}',
      home: Scaffold(
        appBar: AppBar(title: const Text('${projectName}')),
        body: const Center(
          child: Text('Generated by Pavan\\'s Android Generator (Droid).'),
        ),
      ),
    );
  }
}
`,
    },
    {
      path: `README.md`,
      language: "markdown",
      content: `# ${projectName} — Flutter App

Generated by Pavan's Android Generator (Droid) using Flutter.

## Build
\`\`\`bash
flutter build apk
\`\`\`
`,
    },
  ];
  return registerFiles(files, "android", "Flutter + Dart", "android-generator", targetId, "source-code", "generate");
}

export function generateRustCli(projectName: string, targetId: string): GenerationResult {
  const id = slug(projectName).toLowerCase();
  const files: VirtualFile[] = [
    {
      path: `Cargo.toml`,
      language: "toml",
      content: `[package]
name = "${id}"
version = "0.1.0"
edition = "2021"

[dependencies]
clap = { version = "4", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
`,
    },
    {
      path: `src/main.rs`,
      language: "rust",
      content: `use clap::Parser;

/// ${projectName} — generated by Pavan
#[derive(Parser, Debug)]
#[command(name = "${id}", version, about)]
struct Args {
    /// Input path
    #[arg(short, long)]
    input: Option<String>,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    println!("${projectName} running (input: {:?})", args.input);
}
`,
    },
    {
      path: `README.md`,
      language: "markdown",
      content: `# ${projectName} — Rust CLI

Generated by Pavan's Backend Generator (Crucible) using Rust + clap.

## Build
\`\`\`bash
cargo build --release
\`\`\`
`,
    },
  ];
  return registerFiles(files, "cli", "Rust + clap", "backend-generator", targetId, "source-code", "generate");
}
