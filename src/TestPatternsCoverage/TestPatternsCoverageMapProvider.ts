import { createSourceMapStore, MapStore } from 'istanbul-lib-source-maps';
import {
  createCoverageMap,
  CoverageMap,
  CoverageMapData,
  FileCoverage,
} from 'istanbul-lib-coverage';

export interface TestPatternCoverage {
  fileCoverage?: FileCoverage;
  isPass?: boolean;
  testPattern: string;
}

export class TestPatternsCoverageMapProvider {
  private _fileNameToTestPatterns!: Map<string, Set<string>>;
  private _testPatternsToIsPass!: Map<string, boolean>;
  private _testPatternsToMap!: Map<string, CoverageMap>;
  private mapStore!: MapStore;

  /**
   * Transformed coverage map
   */
  private _map!: CoverageMap;

  constructor() {
    this.reset();
  }

  reset(): void {
    this._fileNameToTestPatterns = new Map();
    this._testPatternsToIsPass = new Map();
    this._testPatternsToMap = new Map();
    this._map = createCoverageMap();
    this.mapStore = createSourceMapStore();
  }

  get map(): CoverageMap {
    return this._map;
  }

  async update(
    testPattern: string,
    isPass: boolean,
    obj?: CoverageMap | CoverageMapData
  ): Promise<void> {
    this._testPatternsToIsPass.set(testPattern, isPass);
    const map = createCoverageMap(obj);
    const transformed = await this.mapStore.transformCoverage(map);
    if (this._testPatternsToMap.get(testPattern)) {
      transformed.files().forEach((fileName) => {
        const fileNameToTestPatternSet = this._fileNameToTestPatterns.get(fileName);
        if (fileNameToTestPatternSet) fileNameToTestPatternSet.add(testPattern);
        else this._fileNameToTestPatterns.set(fileName, new Set<string>([testPattern]));
        this.setFileCoverage(testPattern, fileName, transformed);
      });
    } else {
      this._testPatternsToMap.set(testPattern, transformed);
    }
  }

  getSummary(filePath: string) {
    let numOfPassTests = 0;
    let numOfFailedTests = 0;
    this.getFileCoverages(filePath).forEach((c) => {
      if (c.isPass === true) numOfPassTests++;
      else if (c.isPass === false) numOfFailedTests++;
    });
    return `No. Failed Tests: ${numOfFailedTests} No. Pass Tests: ${numOfPassTests}`;
  }

  setFileCoverage(testPattern: string, filePath: string, map: CoverageMap): void {
    if (!this._testPatternsToMap.get(testPattern))
      this._testPatternsToMap.set(testPattern, createCoverageMap());
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this._testPatternsToMap.get(testPattern)!.data[filePath] = map.fileCoverageFor(filePath);
  }

  public getFileCoverages(filePath: string): TestPatternCoverage[] {
    const testPatternSet = this._fileNameToTestPatterns.get(filePath) || new Set<string>();
    return [...testPatternSet].map((testPattern: string) => {
      return {
        fileCoverage: this.getTestPatternFileCoverage(testPattern, filePath),
        testPattern: testPattern,
        isPass: this.getTestPatternIsPass(testPattern),
      };
    });
  }

  private getTestPatternFileCoverage(
    testPattern: string,
    filePath: string
  ): FileCoverage | undefined {
    const fileCoverage = this._testPatternsToMap.get(testPattern);
    if (fileCoverage) return fileCoverage?.data[filePath] as FileCoverage;
    else return undefined;
  }

  public getTestPatternIsPass(testPattern: string): boolean | undefined {
    const isPassInfo = this._testPatternsToIsPass.get(testPattern);
    return isPassInfo;
  }

  public onVisibilityChanged(visible: boolean): void {
    if (!visible) {
      // this.reset();
    }
  }
}
