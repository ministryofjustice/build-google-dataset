export interface FileResult {
	id: string;
	name: string;
	googlePath: string;
	googleType: "MicrosoftForm" | "file" | "folder";
	microsoftPath: string;
	url: string;
	ownerEmail: string;
	viewedByMeTime: string;
	lastModifyingUser: string;
	destinationLocation: string;
	destinationType: string
}