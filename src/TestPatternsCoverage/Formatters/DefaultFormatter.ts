import { AbstractFormatter } from './AbstractFormatter';
import * as vscode from 'vscode';
import { TestPatternsCoverageMapProvider } from '../TestPatternsCoverageMapProvider';
import { CoverageColors } from '../CoverageOverlay';

export class DefaultFormatter extends AbstractFormatter {
  constructor(coverageMapProvider: TestPatternsCoverageMapProvider, colors?: CoverageColors) {
    super(coverageMapProvider, colors);
  }

  format(editor: vscode.TextEditor): void {
    const coverageRanges = this.lineCoverages(editor);
    for (const [line, lineCoverage] of coverageRanges) {
      if (lineCoverage.isCovered && lineCoverage.hue !== undefined) {
        editor.setDecorations(
          vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: `hsl(${lineCoverage.hue * 120}, 100%, 50%, 0.4)`,
            overviewRulerColor: `hsl(${lineCoverage.hue * 120}, 100%, 50%, 0.8)`,
            overviewRulerLane: vscode.OverviewRulerLane.Left,
          }),
          [new vscode.Range(line - 1, 0, line - 1, 0)]
        );
      }
    }
  }

  clear(): void {
    console.log('clear');
  }

  dispose(): void {
    console.log('dispose`');
  }
}
