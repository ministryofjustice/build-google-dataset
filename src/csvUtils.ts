import * as fs from 'fs';
import { EMAIL_INPUT_CSV, MIGRATION_LOG_INPUT_CSV, OUTPUT_CSV } from './config';
import { FileResult } from "./types/FileResult";

export class CSVUtils {
	public static readEmailAddresses(): string[] {
		const csvData = fs.readFileSync(EMAIL_INPUT_CSV, 'utf8').trim();
		const lines = csvData.split('\n');
		const startIndex = lines[0].toLowerCase().includes('email') ? 1 : 0;

		return lines
			.slice(startIndex)
			.map(line => line.trim())
			.filter(line => line.length > 0);
	}

	public static readMigrationLog(
		selectedFields = ['SourcePath', 'FullPath', 'DestinationLocation', 'DestinationType']
	): Record<string, string>[] {
		const csvData = fs.readFileSync(MIGRATION_LOG_INPUT_CSV, 'utf8').trim();
		const lines = csvData.split('\n');

		const headerLine = lines[0].trim();
		const headers = headerLine.split(',').map(h => h.replace(/"/g, '').trim());

		const fieldIndices = selectedFields.map(field => {
			const index = headers.findIndex(header => header.toLowerCase() === field.toLowerCase());
			if (index === -1) {
				throw new Error(`Field "${field}" not found in CSV headers.`);
			}
			return index;
		});

		return lines.slice(1)
			.filter(line => line.trim().length > 0)
			.map(line => {
				const values = line.split(',').map(value => value.replace(/"/g, '').trim());
				const row: Record<string, string> = {};
				fieldIndices.forEach((colIndex, idx) => {
					row[selectedFields[idx]] = values[colIndex] || '';
				});
				return row;
			});
	}

	/**
	 * Writes a list of FileResults to the output CSV.
	 * By default, it overwrites OUTPUT_CSV.
	 * If options.append is true, it will append without writing the header if the file already exists.
	 */
	public static writeOutputCsv(
		fileResults: FileResult[],
		options?: { append?: boolean }
	): void {
		const shouldAppend = options?.append === true;
		const fileExists = fs.existsSync(OUTPUT_CSV);

		// The header row for a fresh CSV
		const headerRow = [
			'Google File ID',
			'Google File Name',
			'Google Path',
			'Google URL',
			'Google Owner Email',
			'Google Last Accessed Time',
			'Google Last Modifying User',
			'Microsoft URL',
			'Microsoft Path',
			'Microsoft FileType'
		];

		// Convert fileResults to CSV lines (excluding header).
		const dataRows = fileResults.map(file =>
			[
				file.id || '',
				file.name || '',
				file.googlePath || '',
				file.url || '',
				file.ownerEmail || '',
				file.viewedByMeTime || '',
				file.lastModifyingUser || '',
				file.destinationLocation || '',
				file.microsoftPath || '',
				file.destinationType || ''
			]
				.map(value => `"${value.replace(/"/g, '""')}"`)
				.join(',')
		);

		// If we're appending but the file doesn't exist, we should include a header:
		const needsHeader = !fileExists || !shouldAppend;

		// Build the final CSV content to write
		// (header only if new file or not appending)
		const rowsToWrite = needsHeader
			? [headerRow.join(','), ...dataRows]
			: dataRows;

		// Always add a trailing newline between writes
		const csvContent = rowsToWrite.join('\n') + '\n';

		if (shouldAppend) {
			fs.appendFileSync(OUTPUT_CSV, csvContent, { encoding: 'utf8' });
			console.log(
				`Appended ${fileResults.length} items to ${OUTPUT_CSV}`
			);
		} else {
			fs.writeFileSync(OUTPUT_CSV, csvContent, { encoding: 'utf8' });
			console.log(
				`Wrote ${fileResults.length} items to ${OUTPUT_CSV}`
			);
		}
	}
}