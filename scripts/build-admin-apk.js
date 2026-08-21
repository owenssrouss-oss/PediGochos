const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');

console.log('🚀 [1/5] Preparando archivos web para PediGochos Dueño...');
execSync('node scripts/build-admin-app.js', { stdio: 'inherit', cwd: rootDir });

console.log('⚙️ [2/5] Configurando Capacitor para PediGochos Dueño...');
fs.copyFileSync(
  path.join(rootDir, 'capacitor.admin.json'),
  path.join(rootDir, 'capacitor.config.json')
);

// Update strings.xml
const stringsXmlPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
if (fs.existsSync(stringsXmlPath)) {
  const stringsContent = `<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">PediGochos Dueño</string>
    <string name="title_activity_main">PediGochos Dueño</string>
    <string name="package_name">com.pedigochos.admin</string>
    <string name="custom_url_scheme">com.pedigochos.admin</string>
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

console.log('📦 [5/5] Exportando PediGochos-Duenio.apk...');
const apkSrc = path.join(rootDir, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const apkDestProject = path.join(rootDir, 'PediGochos-Duenio.apk');
const apkDestDesktop = 'C:\\Users\\Owen\\Desktop\\PediGochos-Duenio.apk';

if (fs.existsSync(apkSrc)) {
  fs.copyFileSync(apkSrc, apkDestProject);
  try {
    fs.copyFileSync(apkSrc, apkDestDesktop);
    console.log(`✅ APK exportado exitosamente a:\n   - ${apkDestDesktop}\n   - ${apkDestProject}`);
  } catch (err) {
    console.log(`✅ APK exportado a: ${apkDestProject}`);
  }
} else {
  console.error('❌ Error: No se encontró el APK generado en ' + apkSrc);
}
