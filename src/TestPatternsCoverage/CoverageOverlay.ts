import { AbstractFormatter } from './Formatters/AbstractFormatter';
import { DefaultFormatter } from './Formatters/DefaultFormatter';
import * as vscode from 'vscode';
import { TestPatternsCoverageMapProvider } from './TestPatternsCoverageMapProvider';

export type CoverageStatus = 'covered' | 'partially-covered' | 'uncovered';
export type CoverageColors = {
  [key in CoverageStatus]?: string;
};

export class TestPatternCoverageOverlay {
  static readonly defaultVisibility = false;
  static readonly defaultFormatter = 'DefaultFormatter';
  formatter: AbstractFormatter;
  private _enabled: boolean;

  constructor(
    _context: vscode.ExtensionContext,
    testPatternCoverageMapProvider: TestPatternsCoverageMapProvider,
    enabled: boolean = TestPatternCoverageOverlay.defaultVisibility,
    coverageFormatter: string = TestPatternCoverageOverlay.defaultFormatter,
    colors?: CoverageColors
  ) {
    this._enabled = enabled;
    switch (coverageFormatter) {
      default:
        this.formatter = new DefaultFormatter(testPatternCoverageMapProvider, colors);
        break;
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.updateVisibleEditors();
  }

  /** give formatter opportunity to dispose the decorators */
  dispose(): void {
    this.formatter.dispose();
  }

  toggleVisibility(): void {
    this._enabled = !this._enabled;
    this.updateVisibleEditors();
  }

  updateVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.update(editor);
    }
  }

  update(editor: vscode.TextEditor): void {
    if (!editor.document) {
      return;
    }
    if (this._enabled) {
      this.formatter.format(editor);
    } else {
      this.formatter.clear(editor);
    }
  }
}
