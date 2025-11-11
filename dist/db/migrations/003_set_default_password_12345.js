"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = require("../../config/database");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
/**
 * Migration script to set all existing users password to 12345
 * This should be run once to reset all user passwords to default
 *
 * Run this script with: npx ts-node src/db/migrations/003_set_default_password_12345.ts
 */
const DEFAULT_PASSWORD = '12345';
async function setDefaultPasswords() {
    try {
        console.log('Starting migration: Setting all users password to 12345...');
        // Get all users
        const usersResult = await database_1.pool.query('SELECT id, email FROM users');
        const users = usersResult.rows;
        console.log(`Found ${users.length} users to update`);
        // Hash the default password once
        const passwordHash = await bcryptjs_1.default.hash(DEFAULT_PASSWORD, 10);
        // Update each user's password
        let updatedCount = 0;
        for (const user of users) {
            await database_1.pool.query('UPDATE users SET password_hash = $1, password_change_required = true WHERE id = $2', [passwordHash, user.id]);
            updatedCount++;
            console.log(`Updated user: ${user.email} (${updatedCount}/${users.length})`);
        }
        console.log(`\nMigration completed successfully!`);
        console.log(`Updated ${updatedCount} users with default password: ${DEFAULT_PASSWORD}`);
        console.log(`All users will be required to change their password on next login.`);
        process.exit(0);
    }
    catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}
// Run migration
setDefaultPasswords();
//# sourceMappingURL=003_set_default_password_12345.js.map