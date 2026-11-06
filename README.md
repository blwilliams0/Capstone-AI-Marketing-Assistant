# The Pocket AI Marketing Assistant

A browser-based AI marketing assistant for The Pocket restaurant in Carmel-by-the-Sea.

## Architecture Overview

This is a monorepo with the following structure:

`
apps/
??? api/        # Express REST API server
??? web/        # React web application
??? worker/     # Background job processor
packages/
??? shared/     # Shared types and utilities
db/
??? migrations/ # PostgreSQL database migrations
`

## Technology Stack

- **Runtime:** Node.js 24 LTS
- **Language:** TypeScript
- **Database:** Supabase PostgreSQL with pgvector
- **Authentication:** Supabase Auth
- **Storage:** Supabase Storage
- **Frontend:** React 19 + Vite + TypeScript + Tailwind CSS
- **API:** Express REST with Zod validation
- **AI:** Qwen 3.8-Flash, Qwen 3.7-Plus (US-scoped)
- **Embeddings:** AWS Bedrock Titan Text Embeddings V2 (1024 dimensions)

## Prerequisites

- Node.js 24 LTS or higher
- pnpm (recommended) or npm
- Supabase account (https://supabase.com)
- Optional: Alibaba Cloud Model Studio account for Qwen API
- Optional: AWS account for Bedrock embeddings

## Installation

`ash
# Clone the repository
git clone <your-repo-url>
cd <your-project>

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your configuration
`

## Development

### Start all services
`ash
pnpm dev
`

### Start individual services
`ash
pnpm dev:api    # Start API server on port 3000
pnpm dev:web    # Start React app on port 5173
pnpm dev:worker # Start background worker
`

### Run tests
`ash
pnpm test
`

### Run linter
`ash
pnpm lint
`

### Format code
`ash
pnpm format
`

## Database Migrations

`ash
# Apply migrations
pnpm db:migrate

# Generate new migration
pnpm db:generate
`

## Configuration

See .env.example for all configuration options:

- **Supabase:** Project URL, anon key, service role key
- **Qwen API:** API key, base URL
- **AWS:** Access key, secret key, region
- **Application:** Port, environment, session settings

## Security

- Never commit .env.local files
- Never store API keys in source code
- Use environment variables for all secrets
- Review and approve all AI-generated content before publishing
- Enable spending limits on all external services

## Deployment

See docs/DEPLOYMENT.md for deployment instructions.

## Development Status

See docs/STATUS.md for current feature status.

## Support

Contact the technical maintainer for issues and questions.

## Stage 1 Implementation Summary

Stage 1 (Foundation) is complete. See docs/IMPLEMENTATION_SUMMARY.md for details.

### What's Working

- Monorepo structure with Turbo
- Express REST API with middleware
- Mock Qwen and social publishing
- React web app with login
- Database migrations ready
- RBAC with 4 role tiers

### What Requires Configuration

- Supabase connection
- Qwen API credentials
- AWS Bedrock credentials
- Real social OAuth flow

### Known Limitations

1. Authentication is mock-only
2. Database requires Supabase connection
3. AI API is mocked
4. Social publishing is mocked
