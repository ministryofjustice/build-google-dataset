import { google, drive_v3 } from "googleapis";
import { FileResult } from "./types/FileResult";
import { JWT } from "google-auth-library";

import type { DestinationType } from "./migrationMapper";

type FileData = {
  name: string;
  parents: string[];
  paths?: string[];
};

export const listParams: drive_v3.Params$Resource$Files$List = {
  spaces: "drive",
  fields: `nextPageToken, files(${[
    "id",
    "name",
    "mimeType",
    "parents",
    "webViewLink",
    "owners(emailAddress)",
    "lastModifyingUser(emailAddress)",
    "viewedByMeTime",
    "createdTime",
    "size",
    "shared",
    "originalFilename",
    "sha256Checksum",
    "resourceKey",
    "fullFileExtension",
    "fileExtension",
  ].join(", ")})`,
  // https://developers.google.com/workspace/drive/api/reference/rest/v3/files
  orderBy: "createdTime", // Important for working out which files should match renames like (1), (2), etc.
  supportsAllDrives: true,
  includeItemsFromAllDrives: true,
  corpora: "allDrives",
};

export class GoogleDriveService {
  private drive: drive_v3.Drive;
  private fileMetadata: Record<string, FileData> = {};
  private fetchPage = 0;

  constructor(private readonly jwt: JWT, private readonly identifier: string) {
    this.drive = google.drive({
      version: "v3",
      auth: this.jwt,
    });
  }

  public mimeTypeToGoogleType(
    googleType: string | null | undefined,
  ): DestinationType {
    if ("application/vnd.google-apps.form" === googleType) {
      return "MicrosoftForm";
    }
    if ("application/vnd.google-apps.folder" === googleType) {
      return "folder";
    }
    return "file";
  }

  public async getDriveFiles(): Promise<FileResult[]> {
    // 1 Collect all files from drive
    const allItems = await this.fetchAllFiles();

    // 2) Build a dictionary of file info for local path-building.
    for (const item of allItems) {
      if (!item.id) continue;
      this.fileMetadata[item.id] = {
        name: item.name ?? "",
        parents: item.parents ?? [],
      };
    }

    // 3) Build the FileResult array.
    const results: FileResult[] = [];

    for (const item of allItems) {
      const fileId = item.id ?? ""; // how can a file not have an ID?!
      const filePaths = this.buildPaths(fileId);

      for (const filePath of filePaths) {
        results.push({
          id: fileId,
          name: item.name ?? "",
          googlePath: filePath,
          googleType: this.mimeTypeToGoogleType(item.mimeType),
          microsoftPath: "",
          url: item.webViewLink ?? "",
          ownerEmail: item.owners?.[0]?.emailAddress ?? "",
          viewedByMeTime: item.viewedByMeTime ?? "N/A",
          lastModifyingUser: item.lastModifyingUser?.emailAddress ?? "N/A",
          destinationLocation: "",
          destinationType: "",
        });
      }
    }

    return results;
  }

  private async fetchAllFiles(
    pageToken?: string,
  ): Promise<drive_v3.Schema$File[]> {
    const response = await this.drive.files.list({
      ...listParams,
      pageSize: 1000,
      pageToken,
    });
    const files = response.data.files ?? [];

    if (response.data.nextPageToken) {
      this.fetchPage++;

      if (this.fetchPage % 5 === 0) {
        console.log(
          `Fetching page ${this.fetchPage} for ${this.identifier}...`,
        );
      }

      this.identifier;

      return [
        ...files,
        ...(await this.fetchAllFiles(response.data.nextPageToken)),
      ];
    }

    return files;
  }

  private buildPaths(fileId: string): string[] {
    const fileObj = this.fileMetadata[fileId];
    if (!fileObj) return [""];

    // If paths exist, return them
    if (fileObj.paths) {
      return fileObj.paths;
    }

    // Otherwise compute them and store them:
    if (!fileObj.parents.length) {
      fileObj.paths = [`/${fileObj.name}`];
    } else {
      fileObj.paths = fileObj.parents.flatMap((parentId) =>
        this.buildPaths(parentId).map(
          (parentPath) => `${parentPath}/${fileObj.name}`,
        ),
      );
    }

    return fileObj.paths;
  }
}
