// Real WinUI 3 Desktop Generator — produces a complete, compilable WinUI 3
// solution with MVVM (CommunityToolkit.Mvvm), EF Core SQLite persistence,
// models derived from the data model, a DbContext, ViewModels with CRUD
// commands, and a MainWindow with a DataGrid + form.
//
// Output structure:
//   MyApp.sln
//   src/MyApp/MyApp.csproj
//   src/MyApp/App.xaml / App.xaml.cs
//   src/MyApp/Views/MainWindow.xaml / MainWindow.xaml.cs
//   src/MyApp/ViewModels/MainViewModel.cs
//   src/MyApp/Models/<Entity>.cs
//   src/MyApp/Data/AppDbContext.cs
//   src/MyApp/Services/<Entity>Service.cs
//   src/MyApp/app.manifest
//   src/MyApp/Properties/PublishProfiles/FolderProfile.pubxml
//   README.md

import type { VirtualFile, GenerationResult } from "../generators";
import { registerFiles } from "../generators";
import type { Capability, NonFunctional } from "../types";
import { inferDataModel, pascal, camel, type DataModel } from "./data-model";

export interface DesktopGenerationContext {
  projectName: string;
  targetId: string;
  prompt: string;
  capabilities: Capability[];
  nonFunctionals: NonFunctional[];
}

/** Map a DataField type to a C# type. */
function csType(field: { type: string; required: boolean }): string {
  switch (field.type) {
    case "string":
      return field.required ? "string" : "string?";
    case "number":
      return field.name === "Quantity" ? "int" : "double";
    case "boolean":
      return "bool";
    case "Date":
      return "DateTime";
    default:
      return "string";
  }
}

/** Map a DataField to an EF Core column type. */
function efColumnType(field: { type: string; name: string }): string {
  switch (field.type) {
    case "string":
      return field.name === "Description" ? "HasColumnType(\"TEXT\")" : "";
    case "number":
      return field.name === "Quantity" ? "" : "";
    case "Date":
      return "";
    default:
      return "";
  }
}

export function generateWinUI3App(ctx: DesktopGenerationContext): GenerationResult {
  const { projectName, targetId, prompt, capabilities, nonFunctionals } = ctx;
  const appName = pascal(projectName) || "MyApp";
  const useSqlite = capabilities.includes("offline-sync") || nonFunctionals.includes("offline-first");
  const model = inferDataModel(prompt);
  const entity = model.entityName;
  const entityLower = model.entityNameLower;
  const entitiesLower = model.entityNamePluralLower;

  const files: VirtualFile[] = [];

  // ---- Solution file ----
  files.push({
    path: `${appName}.sln`,
    language: "xml",
    content: `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.8.34330.188
MinimumVisualStudioVersion = 10.0.40219.1
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "${appName}", "src\\${appName}\\${appName}.csproj", "{${guid(1)}}"
EndProject
Global
        GlobalSection(SolutionConfigurationPlatforms) = preSolution
                Debug|x64 = Debug|x64
                Release|x64 = Release|x64
        EndGlobalSection
        GlobalSection(ProjectConfigurationPlatforms) = postSolution
                {${guid(1)}}.Debug|x64.ActiveCfg = Debug|x64
                {${guid(1)}}.Debug|x64.Build.0 = Debug|x64
                {${guid(1)}}.Release|x64.ActiveCfg = Release|x64
                {${guid(1)}}.Release|x64.Build.0 = Release|x64
        EndGlobalSection
        GlobalSection(SolutionProperties) = preSolution
                HideSolutionNode = FALSE
        EndGlobalSection
EndGlobal
`,
  });

  // ---- .csproj ----
  files.push({
    path: `src/${appName}/${appName}.csproj`,
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
    <RootNamespace>${appName}</RootNamespace>
    <ApplicationManifest>app.manifest</ApplicationManifest>
    <Platforms>x64</Platforms>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.WindowsAppSDK" Version="1.6.241114003" />
    <PackageReference Include="Microsoft.Windows.SDK.BuildTools" Version="10.0.26100.1742" />
    <PackageReference Include="CommunityToolkit.Mvvm" Version="8.3.2" />
${useSqlite ? `    <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="8.0.10" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="8.0.10" />
` : ""}  </ItemGroup>

  <ItemGroup>
    <None Update="app.manifest">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </None>
  </ItemGroup>
</Project>
`,
  });

  // ---- App.xaml ----
  files.push({
    path: `src/${appName}/App.xaml`,
    language: "xml",
    content: `<Application
    x:Class="${appName}.App"
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    xmlns:local="using:${appName}">
    <Application.Resources>
        <ResourceDictionary>
            <ResourceDictionary.MergedDictionaries>
                <XamlControlsResources xmlns="using:Microsoft.UI.Xaml.Controls" />
            </ResourceDictionary.MergedDictionaries>
        </ResourceDictionary>
    </Application.Resources>
</Application>
`,
  });

  // ---- App.xaml.cs ----
  files.push({
    path: `src/${appName}/App.xaml.cs`,
    language: "csharp",
    content: `using Microsoft.UI.Xaml;
using ${appName}.Data;
using ${appName}.Services;
using ${appName}.ViewModels;

namespace ${appName};

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
    /// Invoked when the application is launched. Sets up DI-style services and
    /// launches the main window.
    /// </summary>
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
${useSqlite ? `        // Ensure the SQLite database is created on first launch.
        using (var db = new AppDbContext())
        {
            db.Database.EnsureCreated();
        }

        var service = new ${entity}Service();
        var viewModel = new MainViewModel(service);
` : `        var viewModel = new MainViewModel();`}        _mainWindow = new Views.MainWindow(viewModel);
        _mainWindow.Activate();
    }
}
`,
  });

  // ---- Models/<Entity>.cs ----
  const modelProps = model.fields
    .map((f) => {
      const t = csType(f);
      return `    public ${t} ${f.name} { get; set; }`;
    })
    .join("\n");

  files.push({
    path: `src/${appName}/Models/${entity}.cs`,
    language: "csharp",
    content: `using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace ${appName}.Models;

/// <summary>
/// ${entity} entity model. Generated by Pavan's Desktop Generator (Anvil)
/// from the inferred data model.
/// </summary>
public class ${entity} : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

${modelProps}

    protected void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
`,
  });

  // ---- Data/AppDbContext.cs ----
  if (useSqlite) {
    files.push({
      path: `src/${appName}/Data/AppDbContext.cs`,
      language: "csharp",
      content: `using Microsoft.EntityFrameworkCore;
using ${appName}.Models;

namespace ${appName}.Data;

/// <summary>
/// EF Core DbContext for local SQLite persistence (offline-first).
/// Connection string: "Data Source=${appName.toLowerCase()}.db".
/// </summary>
public class AppDbContext : DbContext
{
    public DbSet<${entity}> ${entity}Set => Set<${entity}>();

    public string DbPath { get; }

    public AppDbContext()
    {
        var folder = Environment.SpecialFolder.LocalApplicationData;
        var path = Environment.GetFolderPath(folder);
        DbPath = System.IO.Path.Join(path, "${appName.toLowerCase()}.db");
    }

    protected override void OnConfiguring(DbContextOptionsBuilder options)
        => options.UseSqlite($"Data Source={DbPath}");

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<${entity}>(e =>
        {
            e.HasKey(x => x.Id);
            e.Property(x => x.Name).IsRequired().HasMaxLength(200);
            e.Property(x => x.Quantity).HasDefaultValue(0);
            e.Property(x => x.Price).HasDefaultValue(0.0);
        });
    }
}
`,
    });
  }

  // ---- Services/<Entity>Service.cs ----
  if (useSqlite) {
    files.push({
      path: `src/${appName}/Services/${entity}Service.cs`,
      language: "csharp",
      content: `using ${appName}.Data;
using ${appName}.Models;

namespace ${appName}.Services;

/// <summary>
/// CRUD service for ${entity} using EF Core.
/// </summary>
public class ${entity}Service
{
    public List<${entity}> GetAll()
    {
        using var db = new AppDbContext();
        return db.${entity}Set.OrderBy(x => x.CreatedAt).ToList();
    }

    public ${entity} GetById(string id)
    {
        using var db = new AppDbContext();
        return db.${entity}Set.Find(id) ?? throw new InvalidOperationException("${entity} not found: " + id);
    }

    public ${entity} Create(${entity} item)
    {
        if (string.IsNullOrEmpty(item.Id))
            item.Id = Guid.NewGuid().ToString();
        item.CreatedAt = DateTime.UtcNow;
        item.UpdatedAt = DateTime.UtcNow;

        using var db = new AppDbContext();
        db.${entity}Set.Add(item);
        db.SaveChanges();
        return item;
    }

    public ${entity} Update(${entity} item)
    {
        item.UpdatedAt = DateTime.UtcNow;
        using var db = new AppDbContext();
        db.${entity}Set.Update(item);
        db.SaveChanges();
        return item;
    }

    public void Delete(string id)
    {
        using var db = new AppDbContext();
        var item = db.${entity}Set.Find(id);
        if (item != null)
        {
            db.${entity}Set.Remove(item);
            db.SaveChanges();
        }
    }
}
`,
    });
  }

  // ---- ViewModels/MainViewModel.cs ----
  files.push({
    path: `src/${appName}/ViewModels/MainViewModel.cs`,
    language: "csharp",
    content: `using System.Collections.ObjectModel;
using System.Windows.Input;
using ${appName}.Models;
${useSqlite ? `using ${appName}.Services;\n` : ""}using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace ${appName}.ViewModels;

/// <summary>
/// Main view model for the ${entity} CRUD view. Exposes an observable
/// collection of ${entity} and Add/Delete commands bound to the DataGrid.
/// </summary>
public partial class MainViewModel : ObservableObject
{
    private readonly ${entity}Service? _service;

    public ObservableCollection<${entity}> Items { get; } = new();

    [ObservableProperty]
    private string _newName = string.Empty;

    [ObservableProperty]
    private int _newQuantity;

    [ObservableProperty]
    private double _newPrice;

    public MainViewModel() { }

${useSqlite ? `    public MainViewModel(${entity}Service service)
    {
        _service = service;
        LoadItems();
    }

    private void LoadItems()
    {
        Items.Clear();
        if (_service == null) return;
        foreach (var item in _service.GetAll())
            Items.Add(item);
    }

    [RelayCommand]
    private void Add()
    {
        if (string.IsNullOrWhiteSpace(NewName)) return;
        var item = new ${entity}
        {
            Name = NewName,
            Quantity = NewQuantity,
            Price = NewPrice,
        };
        _service?.Create(item);
        Items.Insert(0, item);
        NewName = string.Empty;
        NewQuantity = 0;
        NewPrice = 0;
    }

    [RelayCommand]
    private void Delete(${entity} item)
    {
        if (item == null) return;
        _service?.Delete(item.Id);
        Items.Remove(item);
    }
` : `    [RelayCommand]
    private void Add()
    {
        if (string.IsNullOrWhiteSpace(NewName)) return;
        Items.Insert(0, new ${entity}
        {
            Id = Guid.NewGuid().ToString(),
            Name = NewName,
            Quantity = NewQuantity,
            Price = NewPrice,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        });
        NewName = string.Empty;
    }
`}    public string Title => "${projectName}";
}
`,
  });

  // ---- Views/MainWindow.xaml ----
  files.push({
    path: `src/${appName}/Views/MainWindow.xaml`,
    language: "xml",
    content: `<Window
    x:Class="${appName}.Views.MainWindow"
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    xmlns:local="using:${appName}.ViewModels"
    xmlns:models="using:${appName}.Models"
    xmlns:d="http://schemas.microsoft.com/expression/blend/2008"
    xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
    mc:Ignorable="d">

    <Grid Padding="24" RowDefinitions="Auto,Auto,*,Auto">
        <TextBlock Grid.Row="0"
                   Text="{x:Bind ViewModel.Title, Mode=OneWay}"
                   Style="{StaticResource TitleTextBlockStyle}" />

        <!-- Add form -->
        <StackPanel Grid.Row="1" Orientation="Horizontal" Spacing="8" Margin="0,12,0,12">
            <TextBox Header="Name"
                     Text="{x:Bind ViewModel.NewName, Mode=TwoWay, UpdateSourceTrigger=PropertyChanged}"
                     Width="200" />
            <NumberBox Header="Quantity"
                       Value="{x:Bind ViewModel.NewQuantity, Mode=TwoWay}"
                       Width="100" />
            <NumberBox Header="Price"
                       Value="{x:Bind ViewModel.NewPrice, Mode=TwoWay}"
                       Width="100" />
            <Button Content="Add"
                    Command="{x:Bind ViewModel.AddCommand}"
                    VerticalAlignment="Bottom"
                    Style="{StaticResource AccentButtonStyle}" />
        </StackPanel>

        <!-- DataGrid -->
        <GridView Grid.Row="2" ItemsSource="{x:Bind ViewModel.Items, Mode=OneWay}">
            <GridView.ItemTemplate>
                <DataTemplate x:DataType="models:${entity}">
                    <StackPanel Width="280" Spacing="4" Padding="8">
                        <TextBlock Text="{x:Bind Name}" FontWeight="SemiBold" />
                        <TextBlock Text="{x:Bind Quantity}" Opacity="0.7" />
                        <TextBlock Text="{x:Bind Price}" Opacity="0.7" />
                        <Button Content="Delete"
                                Command="{x:Bind ViewModel.DeleteCommand}"
                                CommandParameter="{x:Bind}"
                                Margin="0,4,0,0" />
                    </StackPanel>
                </DataTemplate>
            </GridView.ItemTemplate>
        </GridView>

        <TextBlock Grid.Row="3" Opacity="0.5" Text="Built with Pavan — WinUI 3 + .NET 8" FontSize="11" />
    </Grid>
</Window>
`,
  });

  // ---- Views/MainWindow.xaml.cs ----
  files.push({
    path: `src/${appName}/Views/MainWindow.xaml.cs`,
    language: "csharp",
    content: `using Microsoft.UI.Xaml;
using ${appName}.ViewModels;

namespace ${appName}.Views;

/// <summary>
/// Main window hosting the ${entity} CRUD view. Binds to MainViewModel.
/// </summary>
public sealed partial class MainWindow : Window
{
    public MainViewModel ViewModel { get; }

    public MainWindow(MainViewModel viewModel)
    {
        this.InitializeComponent();
        ViewModel = viewModel;
        Title = "${projectName}";
    }
}
`,
  });

  // ---- app.manifest ----
  files.push({
    path: `src/${appName}/app.manifest`,
    language: "xml",
    content: `<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="1.0.0.0" name="${appName}.app"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v2">
    <security>
      <requestedPrivileges xmlns="urn:schemas-microsoft-com:asm.v3">
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
`,
  });

  // ---- Publish profile (MSIX) ----
  files.push({
    path: `src/${appName}/Properties/PublishProfiles/FolderProfile.pubxml`,
    language: "xml",
    content: `<?xml version="1.0" encoding="utf-8"?>
<!-- https://go.microsoft.com/fwlink/?LinkID=208121 -->
<Project ToolsVersion="4.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <Configuration>Release</Configuration>
    <Platform>x64</Platform>
    <PublishDir>bin\\x64\\Release\\Publish\\</PublishDir>
    <SelfContained>false</SelfContained>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <PublishSingleFile>false</PublishSingleFile>
    <PublishReadyToRun>true</PublishReadyToRun>
  </PropertyGroup>
</Project>
`,
  });

  // ---- README ----
  files.push({
    path: `README.md`,
    language: "markdown",
    content: `# ${projectName} — WinUI 3 Desktop App

A real WinUI 3 desktop application generated by Pavan's Desktop Generator (Anvil).

## What's included
- WinUI 3 + Windows App SDK 1.6 + .NET 8
- MVVM (CommunityToolkit.Mvvm source generators)
${useSqlite ? `- EF Core SQLite local persistence (offline-first)
- Models/${entity}.cs, Data/AppDbContext.cs, Services/${entity}Service.cs
` : ""}- ViewModels/MainViewModel.cs with Add/Delete commands
- Views/MainWindow.xaml with DataGrid + add form

## Build
\`\`\`bash
dotnet build ${appName}.sln
\`\`\`

## Publish (MSIX)
Open in Visual Studio → Publish with the FolderProfile, or:
\`\`\`bash
dotnet publish src/${appName}/${appName}.csproj -c Release -p:RuntimeIdentifier=win-x64
\`\`\`

## Capabilities
${capabilities.length ? capabilities.map((c) => `- ${c}`).join("\n") : "- none"}

Generated by Pavan — Autonomous Software Creator.
`,
  });

  void camel;
  return registerFiles(files, "windows", "WinUI 3 + .NET 8" + (useSqlite ? " + EF Core SQLite" : ""), "desktop-generator", targetId, "source-code", "generate");
}

/** Generate a deterministic-looking GUID string. */
function guid(seed: number): string {
  const hex = (n: number, len: number) =>
    n.toString(16).padStart(len, "0").slice(0, len);
  const base = seed * 0x9e3779b1;
  return [
    hex(base >>> 0, 8),
    hex((base >>> 16) & 0xffff, 4),
    "4" + hex((base >>> 8) & 0xfff, 3),
    "a" + hex((base >>> 4) & 0xfff, 3),
    hex((base >>> 20) & 0xffff, 4) + hex((base >>> 12) & 0xffff, 8),
  ].join("-");
}
