import { TestPatternsCoverageMapProvider } from '../TestPatternsCoverageMapProvider';
import * as vscode from 'vscode';
import { CoverageColors, CoverageStatus } from '../CoverageOverlay';
import { FileCoverage } from 'istanbul-lib-coverage';

export type CoverageRanges = Partial<Record<CoverageStatus, vscode.Range[]>>;
interface LineHueCoverage {
  numOfFailedTests: number;
  numOfPassTests: number;
  hue?: number;
  isCovered: boolean;
}
type FunctionCoverageByLine = { [line: number]: number };
export abstract class AbstractFormatter {
  protected coverageMapProvider: TestPatternsCoverageMapProvider;
  protected colors?: CoverageColors;

  constructor(coverageMapProvider: TestPatternsCoverageMapProvider, colors?: CoverageColors) {
    this.coverageMapProvider = coverageMapProvider;
    this.colors = colors;
  }

  abstract format(editor: vscode.TextEditor): void;
  /** remove decoractors for the given editor */
  abstract clear(editor: vscode.TextEditor): void;
  /** dispose decoractors for all editors */
  abstract dispose(): void;

  private getFunctionCoverageByLine(fileCoverage: FileCoverage): FunctionCoverageByLine {
    const lineCoverage: FunctionCoverageByLine = {};
    Object.entries(fileCoverage.fnMap).forEach(([k, { decl }]) => {
      const hits = fileCoverage.f[k];
      for (let idx = decl.start.line; idx <= decl.end.line; idx++) {
        lineCoverage[idx] = hits;
      }
    });
    return lineCoverage;
  }
  /**
   * mapping the coverage map to a line-based coverage ranges
   * the coverage format is based on instanbuljs: https://github.com/istanbuljs/istanbuljs/blob/master/docs/raw-output.md
   * @param editor
   */
  lineCoverages(
    editor: vscode.TextEditor,
    onNoCoverageInfo?: () => CoverageStatus
  ): Map<number, LineHueCoverage> {
    const fileCoverages = this.coverageMapProvider.getFileCoverages(editor.document.fileName);
    const totalSuccess = fileCoverages.reduce<number>((p, c) => p + (c.isPass === true ? 1 : 0), 0);
    const totalFailed = fileCoverages.reduce<number>((p, c) => p + (c.isPass === false ? 1 : 0), 0);

    const lineToCoverage = new Map<number, LineHueCoverage>();
    for (let line = 1; line <= editor.document.lineCount; line++) {
      let numOfPassTests = 0;
      let numOfFailedTests = 0;
      fileCoverages.forEach((c) => {
        if (c.fileCoverage) {
          const lineCoverage = c.fileCoverage.getLineCoverage();
          const branchCoveravge = c.fileCoverage.getBranchCoverageByLine();
          const funcCoverage = this.getFunctionCoverageByLine(c.fileCoverage);
          const lc = lineCoverage[line];
          const bc = branchCoveravge[line];
          const fc = funcCoverage[line];
          const statusList: CoverageStatus[] = [];
          if (fc != null) {
            statusList.push(fc > 0 ? 'covered' : 'uncovered');
          }
          if (bc != null) {
            switch (bc.coverage) {
              case 0:
                statusList.push('uncovered');
                break;
              default:
                statusList.push('covered');
                break;
            }
          }
          if (lc != null) {
            statusList.push(lc > 0 ? 'covered' : 'uncovered');
          }
          if (statusList.length <= 0 && onNoCoverageInfo) {
            statusList.push(onNoCoverageInfo());
          }
          if (statusList.length <= 0) {
            statusList.push('uncovered');
          }
          // sort by severity: uncovered > partially-covered > covered
          statusList.sort((s1, s2) => {
            if (s1 === s2) {
              return 0;
            }
            switch (s1) {
              case 'covered':
                return 1;
              case 'partially-covered':
                return s2 === 'covered' ? -1 : 1;
              case 'uncovered':
                return -1;
            }
          });
          const status = statusList[0];
          if (status === 'covered') {
            if (c.isPass) numOfPassTests++;
            else numOfFailedTests++;
          }
        }
      });
      lineToCoverage.set(line, {
        numOfFailedTests,
        numOfPassTests,
        isCovered: numOfFailedTests + numOfPassTests > 0,
      });
    }
    for (const line of lineToCoverage.keys()) {
      const currentHue = lineToCoverage.get(line);
      if (currentHue) {
        lineToCoverage.set(line, {
          ...currentHue,
          hue: currentHue.isCovered
            ? 0 +
              currentHue?.numOfPassTests /
                totalSuccess /
                (currentHue.numOfPassTests / totalSuccess +
                  currentHue.numOfFailedTests / totalFailed)
            : undefined,
        });
      }
    }

    return lineToCoverage;
  }
}
