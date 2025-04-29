import {GoogleDriveService} from './googleDriveService';
import {CSVUtils} from './csvUtils';
import {S3Utils} from './s3Utils';
import {FileResult} from "./types/FileResult";
import {GoogleAuthService} from "./googleAuthService";
import {MigrationMapper} from "./migrationMapper";

async function main(): Promise<void> {
	S3Utils.checkWriteAccess();
	const authService = new GoogleAuthService();
	const emails = CSVUtils.readEmailAddresses();
	const migrationLog = CSVUtils.readMigrationLog();
	const migrationLogService = new MigrationMapper(migrationLog as any);

	const CHUNK_SIZE = 10_000;
	const CONCURRENCY = 25; // Process 5 users concurrently
	let accumulatedFiles: FileResult[] = [];

	for (let i = 0; i < emails.length; i += CONCURRENCY) {
		const batchEmails = emails.slice(i, i + CONCURRENCY);

		console.time(`Batch ${i / CONCURRENCY + 1} - Fetching Drive files`);

		const batchResults = await Promise.all(
			batchEmails.map(async (email) => {
				console.time(`Fetching files for ${email}`);

				const driveService = new GoogleDriveService(authService.getJwtForUser(email));
				try {
					const userFiles = await driveService.getDriveFiles();
					console.timeEnd(`Fetching files for ${email}`);

					return userFiles.map((file) => {
						const migrationEntry = migrationLogService.getEntry(email, file.googlePath);
						if (migrationEntry) {
							const { DestinationLocation, DestinationType, MicrosoftPath } = migrationEntry;
							return {
								...file,
								destinationLocation: DestinationLocation,
								destinationType: DestinationType,
								microsoftPath: MicrosoftPath,
							};
						}

						return file;
					});
				} catch (err) {
					console.error(`Error processing ${email}`, err);
					return [];
				}
			})
		);

		console.timeEnd(`Batch ${i / CONCURRENCY + 1} - Fetching Drive files`);

		console.time(`Batch ${i / CONCURRENCY + 1} - Data Processing`);
		// Flatten and add the entire batch at once
		accumulatedFiles.push(...batchResults.flat());

		// Write in large chunks instead of file-by-file
		if (accumulatedFiles.length >= CHUNK_SIZE) {
			CSVUtils.writeOutputCsv(accumulatedFiles, { append: true });
			accumulatedFiles.length = 0; // Clear the array
		}

		console.timeEnd(`Batch ${i / CONCURRENCY + 1} - Data Processing`);
	}

	// Write any remaining files after processing all users
	if (accumulatedFiles.length > 0) {
		CSVUtils.writeOutputCsv(accumulatedFiles, { append: true });
	}

	console.log('CSVUtils', 'Begin upload process to S3...')
	S3Utils.uploadToS3();
}

main().catch((err) => {
	console.error('Script error:', err);
});