// Static validation tools — pure Node functions, no SDK required.
// These validate generated desktop/Android source files for structural
// correctness without invoking dotnet/gradle/kotlinc. Used by the
// compilation gate when the real SDK is not installed.

export interface ValidationResult {
  exitCode: number; // 0 = valid, 1 = invalid
  success: boolean;
  stdout: string;
  stderr: string;
  errors: string[];
  checks: { name: string; passed: boolean; detail: string }[];
}

/* ---------------- XML Validator (csproj / .sln) ---------------- */

export function validateXmlCsproj(content: string, fileName: string): ValidationResult {
  const checks: ValidationResult["checks"] = [];
  const errors: string[] = [];

  // Parse XML structurally (no external dep — basic tag matching)
  const hasProjectOpen = /<Project\s+Sdk=/.test(content);
  const hasProjectClose = /<\/Project>/.test(content);
  checks.push({
    name: "xml-structure",
    passed: hasProjectOpen && hasProjectClose,
    detail: hasProjectOpen && hasProjectClose ? "Valid <Project> open/close" : "Missing <Project> tags",
  });
  if (!hasProjectOpen || !hasProjectClose) errors.push("Invalid XML: missing <Project> root tags");

  // Check required WinUI properties
  const hasUseWinUI = /<UseWinUI>\s*true\s*<\/UseWinUI>/i.test(content);
  checks.push({
    name: "use-winui",
    passed: hasUseWinUI,
    detail: hasUseWinUI ? "<UseWinUI>true</UseWinUI> present" : "Missing <UseWinUI>true</UseWinUI>",
  });
  if (!hasUseWinUI) errors.push("Missing <UseWinUI>true</UseWinUI>");

  const hasTargetFramework = /net8\.0-windows10\.0\.19041\.0/.test(content);
  checks.push({
    name: "target-framework",
    passed: hasTargetFramework,
    detail: hasTargetFramework ? "TargetFramework net8.0-windows10.0.19041.0 present" : "Missing correct TargetFramework",
  });
  if (!hasTargetFramework) errors.push("Missing TargetFramework net8.0-windows10.0.19041.0");

  const hasWindowsAppSDK = /Microsoft\.WindowsAppSDK/.test(content);
  checks.push({
    name: "windows-app-sdk",
    passed: hasWindowsAppSDK,
    detail: hasWindowsAppSDK ? "Microsoft.WindowsAppSDK PackageReference present" : "Missing WindowsAppSDK",
  });
  if (!hasWindowsAppSDK) errors.push("Missing Microsoft.WindowsAppSDK PackageReference");

  // Check tag balance (rough)
  const openTags = (content.match(/<(?!\/|!|\?)[a-zA-Z][^>\s\/]*[^>]*>/g) || []).length;
  const closeTags = (content.match(/<\/[a-zA-Z][^>]*>/g) || []).length;
  const selfClosing = (content.match(/<[a-zA-Z][^>]*\/>/g) || []).length;
  const balanced = openTags - selfClosing === closeTags;
  checks.push({
    name: "tag-balance",
    passed: balanced,
    detail: balanced ? `Tags balanced (${openTags - selfClosing} open, ${closeTags} close)` : `Unbalanced (${openTags - selfClosing} open vs ${closeTags} close)`,
  });
  if (!balanced) errors.push(`Unbalanced XML tags in ${fileName}`);

  const passed = checks.every((c) => c.passed);
  return {
    exitCode: passed ? 0 : 1,
    success: passed,
    stdout: passed ? `${fileName}: VALID (all ${checks.length} checks passed)` : "",
    stderr: passed ? "" : `${fileName}: INVALID\n${errors.join("\n")}`,
    errors,
    checks,
  };
}

export function validateSln(content: string, fileName: string): ValidationResult {
  const checks: ValidationResult["checks"] = [];
  const errors: string[] = [];

  const hasHeader = /^Microsoft Visual Studio Solution File, Format Version 12\.00/m.test(content);
  checks.push({ name: "sln-header", passed: hasHeader, detail: hasHeader ? "Valid SLN header" : "Missing SLN header" });
  if (!hasHeader) errors.push("Missing SLN header");

  const hasProject = /^Project\(.*\)\s*=\s*".*?",\s*".*?\.csproj"/m.test(content);
  checks.push({ name: "project-reference", passed: hasProject, detail: hasProject ? "Project(.csproj) reference present" : "Missing Project reference" });
  if (!hasProject) errors.push("Missing Project(.csproj) reference");

  const hasGuid = /\{[0-9a-fA-F-]{36}\}/.test(content);
  checks.push({ name: "project-guid", passed: hasGuid, detail: hasGuid ? "Valid GUID present" : "Missing GUID" });
  if (!hasGuid) errors.push("Missing project GUID");

  const hasGlobalSection = /GlobalSection\(ProjectConfigurationPlatforms\)/.test(content);
  checks.push({ name: "global-section", passed: hasGlobalSection, detail: hasGlobalSection ? "ProjectConfigurationPlatforms section present" : "Missing GlobalSection" });
  if (!hasGlobalSection) errors.push("Missing GlobalSection(ProjectConfigurationPlatforms)");

  const passed = checks.every((c) => c.passed);
  return {
    exitCode: passed ? 0 : 1,
    success: passed,
    stdout: passed ? `${fileName}: VALID SLN` : "",
    stderr: passed ? "" : `${fileName}: INVALID SLN\n${errors.join("\n")}`,
    errors,
    checks,
  };
}

/* ---------------- C# Syntax Check (MainViewModel.cs) ---------------- */

export function validateCsSyntax(content: string, fileName: string, requiredClass?: string): ValidationResult {
  const checks: ValidationResult["checks"] = [];
  const errors: string[] = [];

  const hasNamespace = /^\s*namespace\s+[A-Za-z0-9_.]+;/m.test(content);
  checks.push({ name: "namespace", passed: hasNamespace, detail: hasNamespace ? "namespace declaration present" : "Missing namespace" });
  if (!hasNamespace) errors.push("Missing namespace declaration");

  const hasClass = /class\s+\w+/.test(content);
  checks.push({ name: "class", passed: hasClass, detail: hasClass ? "class declaration present" : "Missing class" });
  if (!hasClass) errors.push("Missing class declaration");

  if (requiredClass) {
    const hasRequiredClass = new RegExp(`class\\s+${requiredClass}`).test(content);
    checks.push({ name: "required-class", passed: hasRequiredClass, detail: hasRequiredClass ? `class ${requiredClass} present` : `Missing class ${requiredClass}` });
    if (!hasRequiredClass) errors.push(`Missing required class ${requiredClass}`);
  }

  // Check for RelayCommand (MVVM commands)
  const hasRelayCommand = /\[RelayCommand\]/.test(content);
  checks.push({ name: "relay-command", passed: hasRelayCommand, detail: hasRelayCommand ? "[RelayCommand] present" : "Missing [RelayCommand]" });

  // Check for ObservableObject (MVVM base)
  const hasObservable = /:\s*ObservableObject|ObservableObject/.test(content);
  checks.push({ name: "observable-object", passed: hasObservable, detail: hasObservable ? "ObservableObject base present" : "Missing ObservableObject" });

  // Brace balance
  const opens = (content.match(/{/g) || []).length;
  const closes = (content.match(/}/g) || []).length;
  const balanced = opens === closes;
  checks.push({ name: "brace-balance", passed: balanced, detail: balanced ? `Braces balanced (${opens})` : `Unbalanced (${opens} { vs ${closes} })` });
  if (!balanced) errors.push(`Unbalanced braces in ${fileName}`);

  const passed = checks.every((c) => c.passed);
  return {
    exitCode: passed ? 0 : 1,
    success: passed,
    stdout: passed ? `${fileName}: VALID C# (all ${checks.length} checks passed)` : "",
    stderr: passed ? "" : `${fileName}: INVALID C#\n${errors.join("\n")}`,
    errors,
    checks,
  };
}

/* ---------------- Kotlin Syntax Check ---------------- */

export function validateKotlinSyntax(content: string, fileName: string): ValidationResult {
  const checks: ValidationResult["checks"] = [];
  const errors: string[] = [];

  const hasPackage = /^package\s+[a-z0-9_.]+/m.test(content);
  checks.push({ name: "package", passed: hasPackage, detail: hasPackage ? "package declaration present" : "Missing package" });
  if (!hasPackage) errors.push("Missing package declaration");

  const hasComposeImport = /import\s+androidx\.compose/.test(content);
  checks.push({ name: "compose-import", passed: hasComposeImport, detail: hasComposeImport ? "androidx.compose imports present" : "Missing compose imports" });
  if (!hasComposeImport) errors.push("Missing androidx.compose imports");

  // @Composable may appear as an annotation on a function OR inline in a
  // lambda (e.g. setContent { @Composable ... }). For MainActivity, the
  // composable is implicit in setContent {} — so only require @Composable
  // on non-Activity files (screens).
  const isActivityFileK = /MainActivity/i.test(fileName);
  const hasComposable = /@Composable/.test(content);
  if (!isActivityFileK) {
    checks.push({ name: "composable", passed: hasComposable, detail: hasComposable ? "@Composable present" : "Missing @Composable" });
  } else {
    // Activity files use setContent { ... } which is implicitly composable
    checks.push({ name: "composable", passed: true, detail: "Activity file (setContent is implicitly composable)" });
  }

  const hasFun = /\bfun\s+\w+/.test(content);
  checks.push({ name: "function", passed: hasFun, detail: hasFun ? "function declaration present" : "Missing function" });
  if (!hasFun) errors.push("Missing function declaration");

  // Activity/setContent is only required for MainActivity, not screen files.
  // This is an informational check (warn, not fail) for non-Activity files.
  const isActivityFile = /MainActivity/i.test(fileName);
  const hasActivityOrSetContent = /ComponentActivity|setContent/.test(content);
  if (isActivityFile) {
    checks.push({ name: "activity-or-setcontent", passed: hasActivityOrSetContent, detail: hasActivityOrSetContent ? "Activity/setContent present" : "Missing Activity or setContent" });
    if (!hasActivityOrSetContent) errors.push("Missing Activity or setContent in MainActivity");
  }

  // Brace balance
  const opens = (content.match(/{/g) || []).length;
  const closes = (content.match(/}/g) || []).length;
  const balanced = opens === closes;
  checks.push({ name: "brace-balance", passed: balanced, detail: balanced ? `Braces balanced (${opens})` : `Unbalanced (${opens} { vs ${closes} })` });
  if (!balanced) errors.push(`Unbalanced braces in ${fileName}`);

  // Paren balance
  const popens = (content.match(/\(/g) || []).length;
  const pcloses = (content.match(/\)/g) || []).length;
  const pBalanced = popens === pcloses;
  checks.push({ name: "paren-balance", passed: pBalanced, detail: pBalanced ? `Parens balanced (${popens})` : `Unbalanced (${popens} ( vs ${pcloses} ))` });
  if (!pBalanced) errors.push(`Unbalanced parens in ${fileName}`);

  const passed = checks.every((c) => c.passed);
  return {
    exitCode: passed ? 0 : 1,
    success: passed,
    stdout: passed ? `${fileName}: VALID Kotlin (all ${checks.length} checks passed)` : "",
    stderr: passed ? "" : `${fileName}: INVALID Kotlin\n${errors.join("\n")}`,
    errors,
    checks,
  };
}

/* ---------------- Gradle KTS Syntax Check ---------------- */

export function validateGradleKts(content: string, fileName: string, isSettings: boolean): ValidationResult {
  const checks: ValidationResult["checks"] = [];
  const errors: string[] = [];

  if (isSettings) {
    const hasInclude = /include\(":app"\)/.test(content);
    checks.push({ name: "include-app", passed: hasInclude, detail: hasInclude ? 'include(":app") present' : 'Missing include(":app")' });
    if (!hasInclude) errors.push('Missing include(":app")');

    const hasRepos = /google\(\)/.test(content) && /mavenCentral\(\)/.test(content);
    checks.push({ name: "repositories", passed: hasRepos, detail: hasRepos ? "google() + mavenCentral() present" : "Missing repositories" });

    const hasRootName = /rootProject\.name/.test(content);
    checks.push({ name: "root-name", passed: hasRootName, detail: hasRootName ? "rootProject.name present" : "Missing rootProject.name" });
  } else {
    // app/build.gradle.kts — accept both id("...") and alias(libs.plugins...) forms
    const hasAndroidApp = /id\("com\.android\.application"\)/.test(content) || /alias\(libs\.plugins\.android\.application\)/.test(content);
    checks.push({ name: "android-app-plugin", passed: hasAndroidApp, detail: hasAndroidApp ? "android application plugin present" : "Missing android application plugin" });
    if (!hasAndroidApp) errors.push('Missing android application plugin (id or alias)');

    const hasKotlin = /id\("org\.jetbrains\.kotlin\.android"\)/.test(content) || /alias\(libs\.plugins\.kotlin\.android\)/.test(content);
    checks.push({ name: "kotlin-plugin", passed: hasKotlin, detail: hasKotlin ? "kotlin plugin present" : "Missing kotlin plugin" });

    const hasNamespace = /namespace\s*=/.test(content);
    checks.push({ name: "namespace", passed: hasNamespace, detail: hasNamespace ? "namespace present" : "Missing namespace" });
    if (!hasNamespace) errors.push("Missing android namespace");

    const hasCompose = /compose\s*=\s*true/.test(content);
    checks.push({ name: "compose-enabled", passed: hasCompose, detail: hasCompose ? "compose = true present" : "Missing compose = true" });
    if (!hasCompose) errors.push("Missing buildFeatures { compose = true }");

    const hasCompileSdk = /compileSdk\s*=/.test(content);
    checks.push({ name: "compile-sdk", passed: hasCompileSdk, detail: hasCompileSdk ? "compileSdk present" : "Missing compileSdk" });
  }

  // Brace + paren balance
  const opens = (content.match(/{/g) || []).length;
  const closes = (content.match(/}/g) || []).length;
  const balanced = opens === closes;
  checks.push({ name: "brace-balance", passed: balanced, detail: balanced ? `Braces balanced (${opens})` : `Unbalanced (${opens} { vs ${closes} })` });
  if (!balanced) errors.push(`Unbalanced braces in ${fileName}`);

  const passed = checks.every((c) => c.passed);
  return {
    exitCode: passed ? 0 : 1,
    success: passed,
    stdout: passed ? `${fileName}: VALID Gradle KTS (all ${checks.length} checks passed)` : "",
    stderr: passed ? "" : `${fileName}: INVALID Gradle KTS\n${errors.join("\n")}`,
    errors,
    checks,
  };
}

/* ---------------- Dispatcher ---------------- */

export function runStaticValidator(
  toolId: "xml-validator" | "cs-syntax-check" | "kotlin-syntax-check" | "gradle-kts-syntax-check",
  content: string,
  fileName: string,
  opts?: { requiredClass?: string; isSettings?: boolean }
): ValidationResult {
  switch (toolId) {
    case "xml-validator":
      if (fileName.endsWith(".sln")) return validateSln(content, fileName);
      return validateXmlCsproj(content, fileName);
    case "cs-syntax-check":
      return validateCsSyntax(content, fileName, opts?.requiredClass);
    case "kotlin-syntax-check":
      return validateKotlinSyntax(content, fileName);
    case "gradle-kts-syntax-check":
      return validateGradleKts(content, fileName, opts?.isSettings ?? false);
    default:
      return { exitCode: 1, success: false, stdout: "", stderr: `Unknown validator: ${toolId}`, errors: ["unknown"], checks: [] };
  }
}
