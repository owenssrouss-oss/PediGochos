const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');

console.log('🚀 [1/5] Preparando archivos web para PediGochos App Principal...');
execSync('node scripts/build-client-app.js', { stdio: 'inherit', cwd: rootDir });

console.log('⚙️ [2/5] Configurando Capacitor para PediGochos App Principal...');
fs.copyFileSync(
  path.join(rootDir, 'capacitor.client.json'),
  path.join(rootDir, 'capacitor.config.json')
);

// Update strings.xml
const stringsXmlPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
if (fs.existsSync(stringsXmlPath)) {
  const stringsContent = `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">PediGochos</string>
    <string name="title_activity_main">PediGochos</string>
    <string name="package_name">com.pedigochos.app</string>
    <string name="custom_url_scheme">com.pedigochos.app</string>
</resources>
`;
  fs.writeFileSync(stringsXmlPath, stringsContent, 'utf8');
}

console.log('🔄 [3/5] Sincronizando con plataforma Android nativa...');
execSync('npx cap sync android', { stdio: 'inherit', cwd: rootDir });

console.log('🔨 [4/5] Compilando APK nativo con Gradle...');
const javaHome = 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot';
const androidHome = 'C:\\Users\\Owen\\AppData\\Local\\Android\\Sdk';

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  PATH: `${javaHome}\\bin;${process.env.PATH}`
};

const gradlewPath = path.join(rootDir, 'android', 'gradlew.bat');
execSync(`"${gradlewPath}" assembleDebug`, { stdio: 'inherit', cwd: path.join(rootDir, 'android'), env });

console.log('📦 [5/5] Exportando PediGochos-Principal.apk...');
const apkSrc = path.join(rootDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const apkDestProject = path.join(rootDir, 'PediGochos-Principal.apk');
const apkDestDesktop = 'C:\\Users\\Owen\\Desktop\\PediGochos-Principal.apk';

if (fs.existsSync(apkSrc)) {
  fs.copyFileSync(apkSrc, apkDestProject);
  try {
    fs.copyFileSync(apkSrc, apkDestDesktop);
    console.log(`✅ APK exportado exitosamente a:\n   - ${apkDestDesktop}\n   - ${apkDestProject}`);
  } catch (err) {
    console.log(`✅ APK exportado a: ${apkDestProject}`);
  }
} else {
  console.error('❌ Error: No se encontró el archivo app-debug.apk generado.');
}
