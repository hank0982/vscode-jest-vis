import * as vscode from 'vscode';

import { GetJestExtByURI } from '../extensionManager';

export class TestPatternsCoverageCodeLensProvider implements vscode.CodeLensProvider {
  private getJestExt: GetJestExtByURI;
  private onDidChange: vscode.EventEmitter<void>;
  onDidChangeCodeLenses: vscode.Event<void>;

  constructor(getJestExt: GetJestExtByURI) {
    this.getJestExt = getJestExt;
    this.onDidChange = new vscode.EventEmitter();
    this.onDidChangeCodeLenses = this.onDidChange.event;
  }

  public provideCodeLenses(
    document: vscode.TextDocument
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    console.log('test');
    const ext = this.getJestExt(document.uri);
    const coverageSum =
      ext &&
      ext.testPatternOverlay.enabled &&
      ext.testPatternsCoverageMapProvider.getSummary(document.fileName);
    if (!coverageSum) {
      return;
    }
    const codeLenses: vscode.CodeLens[] = [];
    ext.testPatternOverlay.formatter
      .getLineCoveragesWithDocument(document)
      .forEach((lineCoverage, line) => {
        if (lineCoverage.isCovered && lineCoverage.hue !== undefined) {
          const suspiciousness = 1 - lineCoverage.hue;
          const command: vscode.Command = {
            title: `No. Pass Tests: ${lineCoverage.numOfPassTests}, No. Failed Tests: ${lineCoverage.numOfFailedTests}, Suspiciousness: ${suspiciousness}`,
            command: '',
          };
          codeLenses.push(new vscode.CodeLens(new vscode.Range(line - 1, 0, line - 1, 0), command));
        }
      });
    const range = new vscode.Range(0, 0, 0, 0);
    const command: vscode.Command = {
      title: coverageSum,
      command: '',
    };
    const compressedCodeLenses = this.compressCodeLenses(codeLenses);
    console.log('test');
    console.log(compressedCodeLenses);
    return [new vscode.CodeLens(range, command), ...compressedCodeLenses];
  }

  public coverageChanged(): void {
    this.onDidChange.fire();
  }

  private compressCodeLenses(codelenses: vscode.CodeLens[]): vscode.CodeLens[] {
    if (codelenses.length === 0) {
      return [];
    }
    const compressed: vscode.CodeLens[] = [];
    let firstLine = codelenses[0].range.start.line;
    for (let i = 0; i < codelenses.length - 1; i++) {
      if (
        !(
          codelenses[i].command?.title === codelenses[i + 1].command?.title &&
          codelenses[i].range.end.line === codelenses[i + 1].range.start.line - 1
        )
      ) {
        const currentCodelen = codelenses[i];
        if (currentCodelen.command?.title !== undefined) {
          const command: vscode.Command = {
            title: currentCodelen.command.title,
            command: '',
          };
          const range = new vscode.Range(firstLine, 0, firstLine, 0);
          compressed.push(new vscode.CodeLens(range, command));
          firstLine = codelenses[i + 1].range.start.line;
        }
      }
    }
    return compressed;
  }
}
