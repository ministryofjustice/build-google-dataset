import { IS_PROD } from "./config";

export type DestinationType = "MicrosoftForm" | "file" | "folder";

interface MigrationEntry {
  SourcePath: string;
  FullPath: string;
  MicrosoftPath: string;
  DestinationLocation: string;
  DestinationType: string;
  _getCount: number;
  _csvLineNumber: number;
}

export class MigrationMapper {
  private readonly map: Record<string, MigrationEntry> = {};

  // An array of every distinct character used in the log's FullPath column.
  public readonly allLogFullPathCharacters: Set<string> = new Set();

  // An array of every distinct character used in the Google fileNames.
  public readonly allGoogleFilenameCharacters: Set<string> = new Set();

  public readonly emails: string[] = [];

  public readonly mapCount: number;

  public readonly csvEntryCount: number;

  public csvCollisionCount: number = 0;

  public maxGetCount: number = 0;

  private readonly rootDestinationFolder: string = IS_PROD
    ? "/Documents/GW"
    : "/Documents/Google Migration";

  // An object of characters.
  // Keys are the characters that the Google API returns,
  // Values are what the migration tool returns.
  private readonly charSubstitutes: { [key: string]: string } = {
    "’": "?",
  };

  constructor(entries: MigrationEntry[]) {
    let csvLineNumber = 2;

    for (const entry of entries) {
      const key = this.createKey(
        entry.SourcePath,
        entry.DestinationType as DestinationType,
        entry.FullPath,
      );

      if (
        !["MicrosoftForm", "file", "folder"].includes(entry.DestinationType)
      ) {
        console.error(
          "Unknown destination type. Add it to the codebase",
          entry.DestinationType,
        );
      }

      if (
        this.map[key] &&
        this.map[key].MicrosoftPath !== entry.MicrosoftPath &&
        this.map[key].DestinationLocation !== entry.DestinationLocation &&
        this.map[key].DestinationType !== entry.DestinationType
      ) {
        console.warn(
          "In MigrationMapper, overwriting map entry, the same key (SourcePath::FullPath) was found at csv line numbers:",
          this.map[key]._csvLineNumber,
          csvLineNumber,
        );
        this.csvCollisionCount++;
      }

      this.map[key] = {
        ...entry,
        MicrosoftPath: entry.DestinationLocation.replace(
          /^(?!https:\/\/forms\.office\.com\/)https:\/\/[^\/]+/,
          "",
        ),
        _getCount: 0,
        _csvLineNumber: csvLineNumber,
      };

      if (!this.emails.includes(entry.SourcePath)) {
        this.emails.push(entry.SourcePath);
      }

      // For each character in the FullPath, add it to the allLogFullPathCharacters set, if it's not already there.
      for (const char of entry.FullPath) {
        this.allLogFullPathCharacters.add(char);
      }
      this.allLogFullPathCharacters.delete("/");

      csvLineNumber++;
    }
    this.mapCount = Object.keys(this.map).length;
    this.csvEntryCount = csvLineNumber - 2;
  }

  private replaceAll(
    haystack: string,
    replaceObject: { [key: string]: string },
  ): string {
    return Object.keys(replaceObject).reduce(
      (f, s, i) => `${f}`.replace(new RegExp(s, "ig"), replaceObject[s]),
      haystack,
    );
  }

  private createKey(
    sourcePath: string,
    fileType: DestinationType,
    fullPath: string,
  ): string {
    return `${sourcePath}::${fileType}::${this.replaceAll(
      fullPath.trim(),
      this.charSubstitutes,
    )}`;
  }

  public getEntry(
    sourcePath: string,
    fileType: DestinationType,
    fullPath: string,
    fileName: string,
  ): MigrationEntry | undefined {
    let returnedEntry: MigrationEntry | undefined;
    let loopIndex = 0;

    for (const char of fileName) {
      this.allGoogleFilenameCharacters.add(char);
    }

    while (!returnedEntry && loopIndex < 1000) {
      const key = this.createKey(
        sourcePath,
        fileType,
        this.addNumberToFileName(fullPath, loopIndex),
      );

      if (!this.map[key]) {
        break;
      }

      if (this.map[key]?._getCount === 0) {
        this.map[key]._getCount++;
        returnedEntry = this.map[key];
      }

      loopIndex++;
    }

    if (returnedEntry) {
      return returnedEntry;
    }

    // Let's have a second try to get the entry, if the file name contains a /
    // replace it with an underscore.
    if (fileName.includes("/")) {
      const normalisedFileName = fileName.replace(/\//g, "_");
      const normalisedFullPath = fullPath.replace(fileName, normalisedFileName);
      const normalisedKey = this.createKey(
        sourcePath,
        fileType,
        normalisedFullPath,
      );
      this.map[normalisedKey] && this.map[normalisedKey]._getCount++;
      if (
        this.map[normalisedKey] &&
        this.map[normalisedKey]?._getCount > this.maxGetCount
      ) {
        this.maxGetCount = this.map[normalisedKey]._getCount;
      }
      if (this.map[normalisedKey]) {
        return this.map[normalisedKey];
      }
    }

    return undefined;
  }

  public entryIsLikelyRootFolder(entry: MigrationEntry): boolean {
    if (entry.DestinationType !== "folder") {
      return false;
    }
    return entry.DestinationLocation.endsWith(this.rootDestinationFolder);
  }

  public getUnprocessedLogEntries() {
    const migrationLogIndexes = [];
    let loopIndex = 0;
    for (const entry of Object.values(this.map)) {
      if (!entry._getCount && !this.entryIsLikelyRootFolder(entry)) {
        // If the entry is not processed and is not a root folder, add it to the list
        // of unprocessed log entries.
        migrationLogIndexes.push(entry._csvLineNumber);
      }
      loopIndex++;
    }
    return migrationLogIndexes;
  }

  public getProcessedAggregates(): { [lookupCount: number]: number } {
    const aggregates: { [getCount: number]: number } = {};
    let loopIndex = 0;
    for (const entry of Object.values(this.map)) {
      const key = entry._getCount;
      if (!aggregates.hasOwnProperty(key)) {
        aggregates[key] = 0;
      }
      aggregates[key]++;
      loopIndex++;
    }
    return aggregates;
  }

  private addNumberToFileName(fileName: string, number: number): string {
    if (number === 0) {
      return fileName;
    }
    const fileNameParts = fileName.split(".");
    const fileExtension = fileNameParts.pop();
    const fileNameWithoutExtension = fileNameParts.join(".");
    return `${fileNameWithoutExtension} (${number}).${fileExtension}`;
  }

  public getCharacterStats(): {
    logFullPath: string[];
    googleFilenames: string[];
    onlyInGoogleFileNames: string[];
  } {
    return {
      logFullPath: Array.from(this.allLogFullPathCharacters).sort(),
      googleFilenames: Array.from(this.allGoogleFilenameCharacters).sort(),
      onlyInGoogleFileNames: Array.from(
        this.allGoogleFilenameCharacters.difference(
          this.allLogFullPathCharacters,
        ),
      ),
    };
  }
}
