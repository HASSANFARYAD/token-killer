const vscode = require('vscode');
const { executeAndRecord } = require('./commandWrapper.cjs');

function crlf(text) {
  return String(text || '').replace(/\r?\n/g, '\r\n');
}

function extensionSettings() {
  const config = vscode.workspace.getConfiguration('savytox');
  return {
    optimizationMode: config.get('optimizationMode', 'balanced'),
    maxOutputChars: config.get('maxOutputChars', 18000)
  };
}

class TokenSaverPty {
  constructor(context, cwd, onDidRun) {
    this.context = context;
    this.cwd = cwd;
    this.onDidRun = onDidRun;
    this.buffer = '';
    this.writeEmitter = new vscode.EventEmitter();
    this.closeEmitter = new vscode.EventEmitter();
    this.onDidWrite = this.writeEmitter.event;
    this.onDidClose = this.closeEmitter.event;
  }

  open() {
    this.writeEmitter.fire('SavytoX Token Saver Terminal\r\n');
    this.writeEmitter.fire(`cwd: ${this.cwd}\r\n`);
    this.prompt();
  }

  close() {}

  handleInput(data) {
    for (const char of data) {
      if (char === '\r') {
        this.writeEmitter.fire('\r\n');
        const command = this.buffer.trim();
        this.buffer = '';
        this.run(command);
      } else if (char === '\u007f') {
        if (this.buffer.length) {
          this.buffer = this.buffer.slice(0, -1);
          this.writeEmitter.fire('\b \b');
        }
      } else {
        this.buffer += char;
        this.writeEmitter.fire(char);
      }
    }
  }

  prompt() {
    this.writeEmitter.fire('savytox> ');
  }

  async run(command) {
    if (!command) {
      this.prompt();
      return;
    }
    if (command === 'exit') {
      this.closeEmitter.fire();
      return;
    }
    if (command === 'clear' || command === 'cls') {
      this.writeEmitter.fire('\x1b[2J\x1b[3J\x1b[H');
      this.prompt();
      return;
    }
    if (command.startsWith('cd ')) {
      const next = command.slice(3).trim();
      const uri = vscode.Uri.file(require('path').resolve(this.cwd, next));
      this.cwd = uri.fsPath;
      this.writeEmitter.fire(`cwd: ${this.cwd}\r\n`);
      this.prompt();
      return;
    }

    try {
      const result = await executeAndRecord(this.context, command, this.cwd, extensionSettings());
      const text = result.optimized.text || '(no output)';
      this.writeEmitter.fire(crlf(text) + '\r\n');
      this.writeEmitter.fire(`[exit ${result.exitCode}; saved ${Math.max(0, result.output.length - text.length)} chars]\r\n`);
      await this.onDidRun?.();
    } catch (error) {
      this.writeEmitter.fire(crlf(error.message) + '\r\n');
    }
    this.prompt();
  }
}

function openTokenSaverTerminal(context, cwd, onDidRun) {
  const pty = new TokenSaverPty(context, cwd, onDidRun);
  const terminal = vscode.window.createTerminal({ name: 'SavytoX Token Saver', pty });
  terminal.show();
  return terminal;
}

module.exports = { openTokenSaverTerminal };
