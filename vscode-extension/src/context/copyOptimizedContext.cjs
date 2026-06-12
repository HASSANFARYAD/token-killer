const { execFile } = require('child_process');
const vscode = require('vscode');
const { optimizeCommandOutput } = require('../terminal/commandWrapper.cjs');

function execGit(args, cwd) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: 5000 }, (error, stdout, stderr) => {
      resolve(error ? '' : (stdout || stderr || ''));
    });
  });
}

function activeFileSummary(editor) {
  if (!editor) return [];
  const document = editor.document;
  const selected = editor.selection && !editor.selection.isEmpty
    ? document.getText(editor.selection)
    : '';
  const text = document.getText();
  const lineCount = document.lineCount;
  return [
    `Active file: ${document.uri.fsPath}`,
    `Language: ${document.languageId}`,
    `Lines: ${lineCount}`,
    selected ? `Selected text:\n${selected.slice(0, 8000)}` : `File preview:\n${text.slice(0, 4000)}`
  ];
}

async function copyOptimizedContext(context, workspacePath, options = {}) {
  const sections = [];
  const editor = vscode.window.activeTextEditor;
  sections.push(...activeFileSummary(editor));

  const lastTerminal = context.workspaceState.get('savytox.lastTerminalSummary');
  if (lastTerminal) {
    sections.push(`Recent terminal summary:\n${String(lastTerminal).slice(0, 8000)}`);
  }

  if (workspacePath) {
    const status = await execGit(['status', '--short', '--branch'], workspacePath);
    if (status) {
      const optimized = await optimizeCommandOutput('git status --short --branch', status, options);
      sections.push(`Git status:\n${optimized.text}`);
    }
    const diff = await execGit(['diff', '--stat'], workspacePath);
    if (diff) {
      const optimized = await optimizeCommandOutput('git diff --stat', diff, options);
      sections.push(`Git diff summary:\n${optimized.text}`);
    }
  }

  const output = [
    'SavytoX token-optimized context',
    `Generated: ${new Date().toISOString()}`,
    '',
    sections.filter(Boolean).join('\n\n---\n\n')
  ].join('\n');

  await vscode.env.clipboard.writeText(output);
  if (options.preview !== false) {
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: output
    });
    await vscode.window.showTextDocument(document, { preview: true });
  }
  vscode.window.showInformationMessage('SavytoX copied token-optimized context to clipboard.');
  return output;
}

module.exports = { copyOptimizedContext };
