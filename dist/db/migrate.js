"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const database_1 = require("../config/database");
async function runMigrations() {
    const migrationsDir = path_1.default.join(__dirname, 'migrations');
    const files = fs_1.default.readdirSync(migrationsDir).sort();
    console.log('Running migrations...');
    for (const file of files) {
        if (file.endsWith('.sql')) {
            const filePath = path_1.default.join(migrationsDir, file);
            const sql = fs_1.default.readFileSync(filePath, 'utf8');
            console.log(`Running migration: ${file}`);
            try {
                await database_1.pool.query(sql);
                console.log(`✓ Migration ${file} completed successfully`);
            }
            catch (error) {
                console.error(`✗ Migration ${file} failed:`, error);
                throw error;
            }
        }
    }
    console.log('All migrations completed successfully!');
    await database_1.pool.end();
}
runMigrations().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
});
//# sourceMappingURL=migrate.js.map