// Starts Stash. If a newer version has been downloaded from GitHub (into
// ~/Library/Application Support/Stash/app), that one runs; otherwise the built-in one.
const { app } = require('electron');
const path = require('path'), fs = require('fs');
const ver = d => { try { return JSON.parse(fs.readFileSync(path.join(d, 'version.json'), 'utf8')).version; } catch (e) { return '0.0.0'; } };
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++){ if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const updated = path.join(app.getPath('userData'), 'app');
const dir = fs.existsSync(path.join(updated, 'main.js')) && newer(ver(updated), ver(__dirname)) ? updated : __dirname;
require(path.join(dir, 'main.js'));
