const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist_admin');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy public directories
const foldersToCopy = ['css', 'js', 'images'];
foldersToCopy.forEach(folder => {
  const src = path.join(publicDir, folder);
  const dest = path.join(distDir, folder);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
  }
});

// Copy admin.html as index.html and kitchen.html
const adminHtml = fs.readFileSync(path.join(publicDir, 'admin.html'), 'utf8');
fs.writeFileSync(path.join(distDir, 'index.html'), adminHtml);
fs.writeFileSync(path.join(distDir, 'admin.html'), adminHtml);

if (fs.existsSync(path.join(publicDir, 'kitchen.html'))) {
  fs.copyFileSync(path.join(publicDir, 'kitchen.html'), path.join(distDir, 'kitchen.html'));
}

// Copy manifest and sw if needed
if (fs.existsSync(path.join(publicDir, 'manifest.json'))) {
  fs.copyFileSync(path.join(publicDir, 'manifest.json'), path.join(distDir, 'manifest.json'));
}
if (fs.existsSync(path.join(publicDir, 'sw.js'))) {
  fs.copyFileSync(path.join(publicDir, 'sw.js'), path.join(distDir, 'sw.js'));
}

console.log('✅ Admin app web assets successfully prepared in dist_admin/');
