interface MigrationEntry {
  SourcePath: string;
  FullPath: string;
  MicrosoftPath: string;
  DestinationLocation: string;
  DestinationType: string;
}

export class MigrationMapper {
  private readonly map: Record<string, MigrationEntry> = {};
  
  public readonly emails: string[] = [];

  // An object of characters.
  // Keys are the characters that the Google API returns,
  // Values are what the migration tool returns.
  private readonly charSubstitutes: { [key: string]: string } = {
    "’": "?",
  };

  constructor(entries: MigrationEntry[]) {
    for (const entry of entries) {
      const key = this.createKey(entry.SourcePath, entry.FullPath);
      this.map[key] = {
        ...entry,
        MicrosoftPath: entry.DestinationLocation.replace(
          /^(?!https:\/\/forms\.office\.com\/)https:\/\/[^\/]+/,
          "",
        ),
      };
      if (!this.emails.includes(entry.SourcePath)) {
        this.emails.push(entry.SourcePath);
      }
    }
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

  private createKey(sourcePath: string, fullPath: string): string {
    return `${sourcePath}::${this.replaceAll(fullPath, this.charSubstitutes)}`;
  }

  public getEntry(sourcePath: string, fullPath: string): MigrationEntry {
    const key = this.createKey(sourcePath, fullPath);
    return this.map[key];
  }
}
