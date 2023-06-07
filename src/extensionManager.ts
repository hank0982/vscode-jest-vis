import * as vscode from 'vscode';
import { JestExt } from './JestExt';
import { DebugConfigurationProvider } from './DebugConfigurationProvider';
import { statusBar } from './StatusBar';
import { CoverageCodeLensProvider } from './Coverage';
import { extensionId, extensionName } from './appGlobals';
import {
  PendingSetupTask,
  PendingSetupTaskKey,
  startWizard,
  StartWizardOptions,
  WizardTaskId,
  IgnoreWorkspaceChanges,
} from './setup-wizard';
import { ItemCommand } from './test-provider/types';
import { enabledWorkspaceFolders } from './workspace-manager';
import { TestPatternsCoverageCodeLensProvider } from './TestPatternsCoverage/TestPatternsCoverageCodeLensProvider';

export type GetJestExtByURI = (uri: vscode.Uri) => JestExt | undefined;

export function addFolderToDisabledWorkspaceFolders(folder: string): void {
  const config = vscode.workspace.getConfiguration('jest');
  const disabledWorkspaceFolders = new Set(config.get<string[]>('disabledWorkspaceFolders') ?? []);
  disabledWorkspaceFolders.add(folder);
  config.update('disabledWorkspaceFolders', [...disabledWorkspaceFolders]);
}

export type RegisterCommand =
  | {
      type: 'all-workspaces';
      name: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: (extension: JestExt, ...args: any[]) => any;
    }
  | {
      type: 'select-workspace';
      name: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: (extension: JestExt, ...args: any[]) => any;
    }
  | {
      type: 'workspace';
      name: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: (extension: JestExt, ...args: any[]) => any;
    }
  | {
      type: 'active-text-editor' | 'active-text-editor-workspace';
      name: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback: (extension: JestExt, textEditor: vscode.TextEditor, ...args: any[]) => any;
    }
  | {
      type: 'rank-suspiciousness';
      name: string;
    };
type CommandType = RegisterCommand['type'];
const CommandPrefix: Record<CommandType, string> = {
  'all-workspaces': `${extensionName}`,
  'select-workspace': `${extensionName}.workspace`,
  workspace: `${extensionName}.with-workspace`,
  'active-text-editor': `${extensionName}.editor`,
  'active-text-editor-workspace': `${extensionName}.editor.workspace`,
  'rank-suspiciousness': `${extensionName}.editor.webview`,
};
export type StartWizardFunc = (options?: StartWizardOptions) => ReturnType<typeof startWizard>;
export class ExtensionManager {
  debugConfigurationProvider: DebugConfigurationProvider;
  coverageCodeLensProvider: CoverageCodeLensProvider;
  testPatternsCodeLensProvider: TestPatternsCoverageCodeLensProvider;
  startWizard: StartWizardFunc;

  private extByWorkspace: Map<string, JestExt> = new Map();
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    this.debugConfigurationProvider = new DebugConfigurationProvider();
    this.testPatternsCodeLensProvider = new TestPatternsCoverageCodeLensProvider(this.getByDocUri);
    this.coverageCodeLensProvider = new CoverageCodeLensProvider(this.getByDocUri);
    this.startWizard = (options?: StartWizardOptions) =>
      startWizard(this.debugConfigurationProvider, context, options);
    this.applySettings();
  }
  private getPendingSetupTask(): WizardTaskId | undefined {
    const root = vscode.workspace.workspaceFolders?.[0];
    const task = this.context.globalState.get<PendingSetupTask>(PendingSetupTaskKey);
    if (task && root?.name === task.workspace) {
      return task.taskId;
    }
  }
  applySettings(): void {
    const setupTask = this.getPendingSetupTask();
    if (setupTask) {
      console.warn(
        `setup task ${setupTask} in progress, skip extension activation to resume setup`
      );
      this.startWizard({ taskId: setupTask });
      return;
    }
    const enabled = enabledWorkspaceFolders();
    vscode.workspace.workspaceFolders?.forEach((ws) => {
      if (enabled.includes(ws)) {
        this.registerWorkspace(ws);
      } else {
        this.unregisterWorkspace(ws);
      }
    });
  }
  registerWorkspace(workspaceFolder: vscode.WorkspaceFolder): void {
    const enabled = enabledWorkspaceFolders();
    if (!enabled.includes(workspaceFolder) || this.extByWorkspace.has(workspaceFolder.name)) {
      return;
    }

    const jestExt = new JestExt(
      this.context,
      workspaceFolder,
      this.debugConfigurationProvider,
      this.coverageCodeLensProvider,
      this.testPatternsCodeLensProvider
    );
    this.extByWorkspace.set(workspaceFolder.name, jestExt);
    jestExt.startSession();
  }

  unregisterWorkspace(workspaceFolder: vscode.WorkspaceFolder): void {
    this.unregisterWorkspaceByName(workspaceFolder.name);
  }
  unregisterWorkspaceByName(name: string): void {
    const extension = this.extByWorkspace.get(name);
    if (extension) {
      extension.deactivate();
      this.extByWorkspace.delete(name);
    }
  }
  unregisterAllWorkspaces(): void {
    const keys = this.extByWorkspace.keys();
    for (const key of keys) {
      this.unregisterWorkspaceByName(key);
    }
  }

  public getByName = (workspaceFolderName: string): JestExt | undefined => {
    return this.extByWorkspace.get(workspaceFolderName);
  };
  public getByDocUri: GetJestExtByURI = (uri: vscode.Uri) => {
    const workspace = vscode.workspace.getWorkspaceFolder(uri);
    if (workspace) {
      return this.getByName(workspace.name);
    }
  };

  private async showWorkspaceFolderPick(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = enabledWorkspaceFolders();
    if (folders.length <= 0) {
      return Promise.resolve(undefined);
    }
    if (folders.length === 1) {
      return Promise.resolve(folders[0]);
    }
    const folderName = await vscode.window.showQuickPick(folders.map((f) => f.name));
    return folders.find((f) => f.name === folderName);
  }
  async selectExtension(): Promise<JestExt | undefined> {
    const workspace = await this.showWorkspaceFolderPick();
    const instance = workspace && this.getByName(workspace.name);
    if (instance) {
      return instance;
    } else if (workspace) {
      throw new Error(`No Jest instance in ${workspace.name} workspace`);
    }
  }

  /**
   * register commands in the context of workspaces
   * @param command
   * @param callback
   * @param thisArg
   */
  registerCommand(command: RegisterCommand, thisArg?: unknown): vscode.Disposable {
    const commandName = `${CommandPrefix[command.type]}.${command.name}`;
    switch (command.type) {
      case 'all-workspaces': {
        return vscode.commands.registerCommand(commandName, async (...args) => {
          enabledWorkspaceFolders().forEach((ws) => {
            const extension = this.getByName(ws.name);
            if (extension) {
              command.callback.call(thisArg, extension, ...args);
            }
          });
        });
      }
      case 'select-workspace': {
        return vscode.commands.registerCommand(commandName, async (...args) => {
          const extension = await this.selectExtension();
          if (extension) {
            command.callback.call(thisArg, extension, ...args);
          }
        });
      }
      case 'workspace': {
        return vscode.commands.registerCommand(
          commandName,
          async (workspace: vscode.WorkspaceFolder, ...args) => {
            const extension = this.getByName(workspace.name);
            if (extension) {
              command.callback.call(thisArg, extension, ...args);
            }
          }
        );
      }
      case 'active-text-editor':
      case 'active-text-editor-workspace': {
        return vscode.commands.registerTextEditorCommand(
          commandName,
          (editor: vscode.TextEditor, _edit, ...args: unknown[]) => {
            const workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (!workspace) {
              return;
            }
            const extension = this.getByName(workspace.name);
            if (extension) {
              command.callback.call(thisArg, extension, editor, ...args);
            }
          }
        );
      }
      case 'rank-suspiciousness': {
        return vscode.commands.registerCommand(commandName, () => {
          // Create and show a new webview
          if (vscode.window.activeTextEditor?.document) {
            const panel = vscode.window.createWebviewPanel(
              'rankSuspiciousness', // Identifies the type of the webview. Used internally
              'Rank Suspiciousness', // Title of the panel displayed to the user
              vscode.ViewColumn.Beside, // Editor column to show the new webview panel in.
              {
                // Enable scripts in the webview
                enableScripts: true,
              } // Webview options. More on these later.
            );
            const list: string[] = [];
            const lineCoverages = this.getByDocUri(
              vscode.window.activeTextEditor?.document.uri
            )?.testPatternOverlay.formatter.getLineCoveragesWithDocument(
              vscode.window.activeTextEditor?.document
            );
            if (lineCoverages) {
              const sortedLineCoverages = [...lineCoverages.entries()].filter(
                (a) => a[1].isCovered && a[1].hue !== undefined
              );
              sortedLineCoverages.sort((a, b) => {
                if (a[1].hue !== undefined && b[1].hue !== undefined) {
                  return 1 - b[1].hue - (1 - a[1].hue);
                } else return 0;
              });
              sortedLineCoverages.forEach(([line, lineCoverage]) => {
                const lineOfCode = vscode.window.activeTextEditor?.document.getText(
                  new vscode.Range(line - 1, 0, line, 0)
                );
                const passTestList = lineCoverage.passTests
                  ?.map((t) => {
                    return `<div class="item">
                      <div class="content">
                        <a class="header">${t.testPattern}</a>
                        <div class="description">File Path: ${t.fileCoverage?.path}</div>
                      </div>
                    </div>`;
                  })
                  .join();
                const failedTestList = lineCoverage.failedTests
                  ?.map((t) => {
                    return `<div class="item">
                      <div class="content">
                        <a class="header">${t.testPattern}</a>
                        <div class="description">File Path: ${t.fileCoverage?.path}</div>
                      </div>
                    </div>`;
                  })
                  .join();
                if (lineCoverage.isCovered && lineCoverage.hue !== undefined) {
                  const color = `hsl(${lineCoverage.hue * 120}, 100%, 50%, 0.4)`;
                  const html = `
                  <div class="item">    
                    <div class="right floated">
                      <button class="compact ui button" onclick="$('#line_${line}').modal('show');">?</button>
                    </div>              
                    <i class="square full icon" style="color: ${color}"></i> 
                    <div class="content">
                      <div class="header">${lineOfCode?.trim()}</div>
                      <div class="description">
                        No. failed tests: ${lineCoverage.numOfFailedTests}
                        No. pass tests: ${lineCoverage.numOfPassTests}
                      </div>
                    </div>
                  </div>
                  <div id="line_${line}"class="ui modal">
                    <i class="close icon"></i>
                    <div class="header">
                      Line ${line}
                    </div>
                    <div class="content">
                      <div class="description">
                        <div class="ui header">${lineOfCode?.trim()}</div>
                        <p>No. failed tests: ${lineCoverage.numOfFailedTests}</p>
                        <p>No. pass tests: ${lineCoverage.numOfPassTests}</p>
                        <h3 class="ui top attached header">
                          Pass test patterns
                        </h3>
                        <div class="ui attached segment">
                          <div class="ui relaxed divided list">
                            ${passTestList}
                          </div>
                        </div>
                        <h3 class="ui top attached header">
                          Failed test patterns
                        </h3>
                        <div class="ui attached segment">
                          <div class="ui relaxed divided list">
                            ${failedTestList}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="actions">
                      <div class="ui positive right labeled icon button">
                        Done
                        <i class="checkmark icon"></i>
                      </div>
                    </div>
                  </div>
                  `;
                  list.push(html);
                }
              });
            }

            panel.webview.html = getWebviewContent(list);
          }
        });
      }
    }
  }

  onDidChangeConfiguration(e: vscode.ConfigurationChangeEvent): void {
    let applied = false;
    vscode.workspace.workspaceFolders?.forEach((workspaceFolder, idx) => {
      if (e.affectsConfiguration('jest', workspaceFolder.uri)) {
        if (!applied && (idx === 0 || e.affectsConfiguration('jest.enable', workspaceFolder.uri))) {
          this.applySettings();
          applied = true;
        }

        this.getByName(workspaceFolder.name)?.triggerUpdateSettings();
      }
    });
  }
  onDidChangeWorkspaceFolders(e: vscode.WorkspaceFoldersChangeEvent): void {
    if (this.context.workspaceState.get<boolean>(IgnoreWorkspaceChanges)) {
      return;
    }

    e.added.forEach(this.registerWorkspace, this);
    e.removed.forEach(this.unregisterWorkspace, this);
  }
  onDidCloseTextDocument(document: vscode.TextDocument): void {
    const ext = this.getByDocUri(document.uri);
    if (ext) {
      ext.onDidCloseTextDocument(document);
    }
  }
  onDidChangeActiveTextEditor(editor?: vscode.TextEditor): void {
    if (editor && editor.document) {
      statusBar.onDidChangeActiveTextEditor(editor);
      const ext = this.getByDocUri(editor.document.uri);
      if (ext) {
        ext.onDidChangeActiveTextEditor(editor);
      }
    }
  }
  onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent): void {
    const ext = this.getByDocUri(event.document.uri);
    if (ext) {
      ext.onDidChangeTextDocument(event);
    }
  }

  onWillSaveTextDocument(event: vscode.TextDocumentWillSaveEvent): void {
    const ext = this.getByDocUri(event.document.uri);
    if (ext) {
      ext.onWillSaveTextDocument(event);
    }
  }
  onDidSaveTextDocument(document: vscode.TextDocument): void {
    const ext = this.getByDocUri(document.uri);
    if (ext) {
      ext.onDidSaveTextDocument(document);
    }
  }
  private onFilesChange(files: readonly vscode.Uri[], handler: (ext: JestExt) => void) {
    const exts = files.map((f) => this.getByDocUri(f)).filter((ext) => ext != null) as JestExt[];
    const set = new Set<JestExt>(exts);
    set.forEach(handler);
  }

  onDidCreateFiles(event: vscode.FileCreateEvent): void {
    this.onFilesChange(event.files, (ext) => ext.onDidCreateFiles(event));
  }
  onDidDeleteFiles(event: vscode.FileDeleteEvent): void {
    this.onFilesChange(event.files, (ext) => ext.onDidDeleteFiles(event));
  }
  onDidRenameFiles(event: vscode.FileRenameEvent): void {
    const files = event.files.reduce((list, f) => {
      list.push(f.newUri, f.oldUri);
      return list;
    }, [] as vscode.Uri[]);
    this.onFilesChange(files, (ext) => ext.onDidRenameFiles(event));
  }

  public register(): vscode.Disposable[] {
    return [
      this.registerCommand({
        type: 'all-workspaces',
        name: 'start',
        callback: (extension) => extension.startSession(),
      }),
      this.registerCommand({
        type: 'select-workspace',
        name: 'start',
        callback: (extension) => extension.startSession(),
      }),
      this.registerCommand({
        type: 'all-workspaces',
        name: 'stop',
        callback: (extension) => extension.stopSession(),
      }),
      this.registerCommand({
        type: 'select-workspace',
        name: 'stop',
        callback: (extension) => extension.stopSession(),
      }),
      this.registerCommand({
        type: 'all-workspaces',
        name: 'toggle-coverage',
        callback: (extension) => extension.toggleCoverageOverlay(),
      }),
      this.registerCommand({
        type: 'select-workspace',
        name: 'toggle-coverage',
        callback: (extension) => extension.toggleCoverageOverlay(),
      }),
      this.registerCommand({
        type: 'active-text-editor-workspace',
        name: 'toggle-coverage',
        callback: (extension) => extension.toggleCoverageOverlay(),
      }),
      this.registerCommand({
        type: 'all-workspaces',
        name: 'run-all-tests',
        callback: (extension) => extension.runAllTests(),
      }),
      this.registerCommand({
        type: 'select-workspace',
        name: 'run-all-tests',
        callback: (extension) => extension.runAllTests(),
      }),
      this.registerCommand({
        type: 'active-text-editor-workspace',
        name: 'run-all-tests',
        callback: (extension) => extension.runAllTests(),
      }),
      this.registerCommand({
        type: 'active-text-editor',
        name: 'run-all-tests',
        callback: (extension, editor) => extension.runAllTests(editor),
      }),
      this.registerCommand({
        type: 'rank-suspiciousness',
        name: 'rank-suspiciousness',
      }),
      this.registerCommand({
        type: 'active-text-editor',
        name: 'run-tarantula-coverage',
        callback: (extension, editor) => extension.gatherTarantulaCoverage(editor),
      }),
      this.registerCommand({
        type: 'active-text-editor',
        name: 'debug-tests',
        callback: (extension, editor, ...identifiers) => {
          extension.debugTests(editor.document, ...identifiers);
        },
      }),
      // with-workspace commands
      this.registerCommand({
        type: 'workspace',
        name: 'toggle-auto-run',
        callback: (extension) => {
          extension.toggleAutoRun();
        },
      }),
      this.registerCommand({
        type: 'workspace',
        name: 'toggle-coverage',
        callback: (extension) => {
          extension.toggleCoverageOverlay();
        },
      }),
      this.registerCommand({
        type: 'workspace',
        name: 'enable-login-shell',
        callback: (extension) => {
          extension.enableLoginShell();
        },
      }),
      this.registerCommand({
        type: 'workspace',
        name: 'item-command',
        callback: (extension, testItem: vscode.TestItem, itemCommand: ItemCommand) => {
          extension.runItemCommand(testItem, itemCommand);
        },
      }),

      // setup tool
      vscode.commands.registerCommand(`${extensionName}.setup-extension`, this.startWizard),

      // this provides the opportunity to inject test names into the DebugConfiguration
      vscode.debug.registerDebugConfigurationProvider('node', this.debugConfigurationProvider),
      // this provides the snippets generation
      vscode.debug.registerDebugConfigurationProvider(
        'vscode-jest-tests',
        this.debugConfigurationProvider
      ),
      vscode.workspace.onDidChangeConfiguration(this.onDidChangeConfiguration, this),

      vscode.workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders, this),

      vscode.workspace.onDidCloseTextDocument(this.onDidCloseTextDocument, this),

      vscode.window.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditor, this),
      vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this),
      vscode.workspace.onDidCreateFiles(this.onDidCreateFiles, this),
      vscode.workspace.onDidRenameFiles(this.onDidRenameFiles, this),
      vscode.workspace.onDidDeleteFiles(this.onDidDeleteFiles, this),
      vscode.workspace.onDidSaveTextDocument(this.onDidSaveTextDocument, this),
      vscode.workspace.onWillSaveTextDocument(this.onWillSaveTextDocument, this),
    ];
  }

  private showReleaseMessage(): void {
    const version = vscode.extensions.getExtension(extensionId)?.packageJSON.version;
    const releaseNote = ReleaseNotes[version];
    if (!releaseNote) {
      return;
    }
    const key = `${extensionId}-${version}-launch`;
    const didLaunch = this.context.globalState.get<boolean>(key, false);
    if (!didLaunch) {
      vscode.window
        .showInformationMessage(
          `vscode-jest has been updated to ${version}.`,
          'See What Is Changed'
        )
        .then((value) => {
          if (value === 'See What Is Changed') {
            vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(releaseNote));
          }
        });
      this.context.globalState.update(key, true);
    }
  }

  activate(): void {
    this.showReleaseMessage();
    if (vscode.window.activeTextEditor?.document.uri) {
      this.getByDocUri(vscode.window.activeTextEditor.document.uri)?.activate();
    }
  }
}

const ReleaseNoteBase = 'https://github.com/jest-community/vscode-jest/blob/master/release-notes';
const ReleaseNotes: Record<string, string> = {
  '5.2.3': `${ReleaseNoteBase}/release-note-v5.x.md#v523`,
  '5.2.2': `${ReleaseNoteBase}/release-note-v5.x.md#v522`,
  '5.2.1': `${ReleaseNoteBase}/release-note-v5.x.md#v521-pre-release`,
  '5.2.0': `${ReleaseNoteBase}/release-note-v5.x.md#v520-pre-release`,
  '5.1.0': `${ReleaseNoteBase}/release-note-v5.x.md#v510`,
  '5.0.4': `${ReleaseNoteBase}/release-note-v5.md#v50-pre-release-roll-up`,
  '5.0.3': `${ReleaseNoteBase}/release-note-v5.md#v50-pre-release-roll-up`,
  '5.0.2': `${ReleaseNoteBase}/release-note-v5.md#v50-pre-release-roll-up`,
  '5.0.1': `${ReleaseNoteBase}/release-note-v5.md#v50-pre-release-roll-up`,
  '5.0.0': `${ReleaseNoteBase}/release-note-v5.md#v50-pre-release-roll-up`,
};

function getWebviewContent(list: string[]) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <script src="https://code.jquery.com/jquery-3.7.0.min.js" integrity="sha256-2Pmvv0kuTBOenSvLm6bvfBSSHrUJ+3A7x6P5Ebd07/g=" crossorigin="anonymous"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/semantic-ui@2.5.0/dist/semantic.min.css">
    <script src="https://cdn.jsdelivr.net/npm/semantic-ui@2.5.0/dist/semantic.min.js"></script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Suspiciousness</title>
</head>
<body>
<div class="ui container">
  <div class="ui list middle aligned divided">
    ${list.join('\n')}
  </div>
</div>
</body>
</html>`;
}
