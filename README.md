# Tallac CRM Backend API

Backend API for Tallac CRM system built with Node.js, Express, TypeScript, and PostgreSQL.

## Features

- 🔐 Authentication & Authorization (JWT-based)
- 👥 User Management with Role-Based Access Control (RBAC)
- 📊 Leads Management
- 🏢 Companies Management
- 📍 Territories Management
- 📝 Activities Management
- 📊 Dashboard Analytics
- 📚 Knowledge Base with File Upload (AWS S3)
- 🔒 Password Management (Default password reset flow)

## Tech Stack

- **Runtime**: Node.js 20
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL
- **Authentication**: JWT (JSON Web Tokens)
- **File Storage**: AWS S3
- **Password Hashing**: bcryptjs

## Prerequisites

- Node.js 20 or higher
- PostgreSQL database
- AWS Account (for S3 file storage)
- AWS CLI (for deployment)

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/omzoxima/tallacbackend.git
   cd tallacbackend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   Create a `.env` file in the root directory:
   ```env
   # Database Configuration
   DB_HOST=your_db_host
   DB_PORT=5432
   DB_USER=your_db_user
   DB_PASS=your_db_password
   DB_NAME=your_database_name

   # Server Configuration
   PORT=3001
   NODE_ENV=development

   # JWT Secret
   JWT_SECRET=your-secret-key-change-this-in-production

   # AWS S3 Configuration
   AWS_REGION=us-east-2
   AWS_ACCESS_KEY_ID=your_aws_access_key_id
   AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
   AWS_S3_BUCKET_NAME=your-s3-bucket-name

   # CORS Configuration
   CORS_ORIGIN=http://localhost:3000
   ```

4. **Run database migrations**
   ```bash
   npm run migrate
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the TypeScript code
- `npm start` - Start production server
- `npm run migrate` - Run database migrations
- `npm run seed` - Seed the database with sample data
- `npm run migrate:reset-passwords` - Reset all user passwords to default (12345)

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/change-password` - Change user password
- `GET /api/auth/me` - Get current user info

### Users
- `GET /api/users` - Get all users
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Companies
- `GET /api/companies` - Get all companies
- `POST /api/companies` - Create new company
- `PUT /api/companies/:id` - Update company
- `DELETE /api/companies/:id` - Delete company
- `PUT /api/companies/bulk/territories` - Bulk update company territories

### Territories
- `GET /api/territories` - Get all territories
- `POST /api/territories` - Create new territory
- `PUT /api/territories/:id` - Update territory
- `DELETE /api/territories/:id` - Delete territory

### Leads
- `GET /api/leads` - Get all leads
- `POST /api/leads` - Create new lead
- `PUT /api/leads/:id` - Update lead
- `DELETE /api/leads/:id` - Delete lead

### Activities
- `GET /api/activities` - Get all activities
- `POST /api/activities` - Create new activity
- `PUT /api/activities/:id` - Update activity
- `DELETE /api/activities/:id` - Delete activity

### Knowledge Base
- `GET /api/knowledge-base` - Get all files (role-based access)
- `POST /api/knowledge-base/upload` - Upload file
- `PUT /api/knowledge-base/:id/roles` - Update file roles
- `DELETE /api/knowledge-base/:id` - Delete file
- `GET /api/knowledge-base/:id/download` - Download file

### Dashboard
- `GET /api/dashboard/stats` - Get dashboard statistics

## Role-Based Access Control (RBAC)

The system supports 5 role tiers:

1. **Corporate Admin** - Highest level, full access
2. **Business Coach** - Manage teams and territories
3. **Territory Admin** - Manage territories and teams
4. **Territory Manager** - Manage leads and activities
5. **Sales User** - Basic access, manage own leads

## Database Migrations

Database migrations are located in `src/db/migrations/`. To run migrations:

```bash
npm run migrate
```

Migration files:
- `001_initial_schema.sql` - Initial database schema
- `002_add_companies_territories_users.sql` - Companies, territories, and users tables
- `003_set_default_password_12345.ts` - Set default passwords for all users
- `004_add_updated_at_to_users.sql` - Add updated_at column to users
- `005_add_knowledge_base.sql` - Knowledge base tables

## Docker Deployment

### Build Docker Image
```bash
docker build -t tallac-backend .
```

### Run Docker Container
```bash
docker run -p 3001:3001 --env-file .env tallac-backend
```

## AWS App Runner Deployment

See deployment instructions in the main project documentation for AWS App Runner deployment via ECR.

## Security

- Passwords are hashed using bcryptjs
- JWT tokens for authentication
- Role-based access control
- Environment variables for sensitive data
- CORS configuration for frontend access
- Helmet.js for security headers

## Health Check

The API includes a health check endpoint:
```
GET /health
```

Returns:
```json
{
  "status": "ok",
  "database": "connected"
}
```

## License

Private - All rights reserved

## Support

For issues and questions, please contact the development team.

