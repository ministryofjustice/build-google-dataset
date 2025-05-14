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

  private createKey(sourcePath: string, fullPath: string): string {
    return `${sourcePath}::${fullPath}`;
  }

  public getEntry(sourcePath: string, fullPath: string): MigrationEntry {
    const key = this.createKey(sourcePath, fullPath);
    return this.map[key];
  }
}
