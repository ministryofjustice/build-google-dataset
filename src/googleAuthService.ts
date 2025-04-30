import {SCOPES} from "./config";
import {JWT} from "google-auth-library";

export class GoogleAuthService {
	getJwtForUser(userEmail: string) {
		return new JWT({
			email: process.env.SERVICE_ACCOUNT_EMAIL,
			key: process.env.SERVICE_ACCOUNT_PRIVATE_KEY,
			scopes: SCOPES,
			subject: userEmail,
		});
	}
}