// Generates a self-signed cert/key pair for local HTTPS dev, if not already present.
// Runs automatically on `npm install` (see package.json "postinstall").
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const certDir = path.join(__dirname, '..', 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    console.log('certs/key.pem and certs/cert.pem already exist, skipping generation.');
    process.exit(0);
}

fs.mkdirSync(certDir, { recursive: true });

try {
    execSync(
        `openssl req -x509 -newkey rsa:2048 -nodes ` +
        `-keyout "${keyPath}" -out "${certPath}" ` +
        `-days 365 -subj "/CN=localhost"`,
        { stdio: 'inherit' }
    );
    console.log(`Generated self-signed certificate for https://localhost at ${certDir}`);
} catch (err) {
    console.error('\nFailed to generate a self-signed certificate.');
    console.error('Make sure OpenSSL is installed and on your PATH, then run:');
    console.error('  npm run generate-cert\n');
    process.exit(1);
}
