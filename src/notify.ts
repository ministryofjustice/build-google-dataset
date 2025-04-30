/* @ts-ignore */
import { NotifyClient } from "notifications-node-client";

export class Notify {
  public static emailsFromEnvVariable(): string[] {
    const notifyEmailsString = process.env.NOTIFY_EMAIL_TO;

    if (!notifyEmailsString) {
      throw new Error("NOTIFY_EMAIL_TO environment variable is not set");
    }

    /* @ts-ignore */
    const emails = notifyEmailsString.split(",").map((email) => email.trim());

    return emails;
  }

  public static async sendEmail(templateId: string, personalisation?: {
    context: string;
    message: string;
  }): Promise<void> {
    const notifyClient = new NotifyClient(
      process.env.GOV_NOTIFY_API_KEY as string,
    );
    for (const email of Notify.emailsFromEnvVariable()) {
      try {
        await notifyClient.sendEmail(
          templateId,
          email,
          {
            personalisation: personalisation || {},
          },
        );
        console.log(`Email sent to ${email}`);
      } catch (error) {
        console.error(`Failed to send email to ${email}:`, error);
      }
    }
  }
}
