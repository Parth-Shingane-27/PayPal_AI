import "dotenv/config";

// Tests always run against the dedicated test database, never the dev one.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL must be set to run tests");
process.env.DATABASE_URL = testUrl;
