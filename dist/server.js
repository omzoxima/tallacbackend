"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const database_1 = require("./config/database");
// Import routes
const leads_1 = __importDefault(require("./routes/leads"));
const activities_1 = __importDefault(require("./routes/activities"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const auth_1 = __importDefault(require("./routes/auth"));
const territories_1 = __importDefault(require("./routes/territories"));
const companies_1 = __importDefault(require("./routes/companies"));
const users_1 = __importDefault(require("./routes/users"));
const knowledgeBase_1 = __importDefault(require("./routes/knowledgeBase"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// Middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Health check
app.get('/health', async (req, res) => {
    try {
        await database_1.pool.query('SELECT NOW()');
        res.json({ status: 'ok', database: 'connected' });
    }
    catch (error) {
        res.status(500).json({ status: 'error', database: 'disconnected' });
    }
});
// Routes
app.use('/api/auth', auth_1.default);
app.use('/api/leads', leads_1.default);
app.use('/api/activities', activities_1.default);
app.use('/api/dashboard', dashboard_1.default);
app.use('/api/territories', territories_1.default);
app.use('/api/companies', companies_1.default);
app.use('/api/users', users_1.default);
app.use('/api/knowledge-base', knowledgeBase_1.default);
// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        error: {
            message: err.message || 'Internal server error',
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
        },
    });
});
// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
//# sourceMappingURL=server.js.map