const { execFile } = require('child_process');

function checkCommand(command, cwd) {
  return new Promise((resolve) => {
    if (!command) {
      resolve({ available: false, reason: 'No external command configured.' });
      return;
    }
    execFile(command, ['--version'], { cwd, windowsHide: true, timeout: 3000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ available: false, reason: stderr?.trim() || error.message });
        return;
      }
      resolve({ available: true, version: (stdout || '').trim() });
    });
  });
}

module.exports = { checkCommand };
