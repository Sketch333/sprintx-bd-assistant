import * as dotenv from 'dotenv';

dotenv.config();

const defaultSiteUrls = [
  'https://sprintx.net/',
  'https://www.fiverr.com/agencies/sprintx',
];

export const config = {
  port: Number(process.env.PORT ?? 3001),
  driveRoot: process.env.DRIVE_ROOT ?? './data/drive',
  userStorePath: process.env.USER_STORE_PATH ?? './data/users.json',
  databaseUrl: process.env.DATABASE_URL ?? '',
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET ?? '',
  requireAuth: process.env.REQUIRE_AUTH === 'true',
  adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
  googleApiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '',
  testGeminiApiKey: process.env.TEST_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '',
  siteUrls: (process.env.SITE_URLS ?? defaultSiteUrls.join(',')).split(',').map((value) => value.trim()).filter(Boolean),
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID ?? '',
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '',
};
