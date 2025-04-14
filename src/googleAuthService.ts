import fs from "fs";
import {SCOPES, SERVICE_ACCOUNT_FILE} from "./config";
import {JWT} from "google-auth-library";

export class GoogleAuthService {
	private serviceAccount: any;

	constructor() {
		this.serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_FILE, 'utf8'));
	}

	getJwtForUser(userEmail: string) {
		return new JWT({
			email: this.serviceAccount.client_email,
			key: this.serviceAccount.private_key,
			scopes: SCOPES,
			subject: userEmail,
		});
	}
}