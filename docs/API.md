# API Documentation

## Endpoints

### Health Check
GET /api/health

Returns system status.

### Mock Qwen API
POST /api/qwen/chat
POST /api/qwen/embeddings

### Mock Social Publishing
POST /api/social/connect
POST /api/social/publish

## Authentication

All authenticated endpoints require the user to be logged in.

## Error Responses

{
  "error": "Unauthorized"
}
{
  "error": "Forbidden",
  "message": "You do not have permission to perform this action"
}
{
  "error": "Internal server error"
}
