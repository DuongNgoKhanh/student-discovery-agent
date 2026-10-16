# Backend API - Standardized Error Codes

## Error Code Format

All error codes follow the pattern: `PREFIX_CODE`

### Prefix Categories (Module/Error Type)

| Prefix | Category | HTTP Status | Type | Description |
|--------|----------|-------------|------|-------------|
| `AUTH_` | Authentication | 401 | Technical | Auth token/session issues |
| `AUTHZ_` | Authorization | 403 | Technical | Permission/access control issues |
| `RES_` | Resource | 404 | Technical | Resource not found errors |
| `VAL_` | Validation | 400/422 | Technical | Input validation failures |
| `REQ_` | Business Logic | 200/422 | Business | Business rule violations |
| `DB_` | Database | 500 | Technical | Database operation failures |
| `EXT_` | External Service | 502/503 | Technical | External service failures |
| `SYS_` | System | 500/503 | Technical | System/server errors |

### Error Type Classification

- **Technical Error**: HTTP status 4xx/5xx + `success=false`
- **Business Error**: HTTP status 200 + `success=false` (business rule violation, retriable with different input)

## HTTP Status Codes

| Status Code | Name | Description | When Used |
|-------------|------|-------------|-----------|
| `200` | OK | Request successful, data returned | Successful GET, POST, PUT operations |
| `201` | Created | Resource created successfully | Successful resource creation |
| `202` | Accepted | Request accepted for processing | Async operations (background tasks) |
| `400` | Bad Request | Invalid request parameters or body | Malformed request data |
| `401` | Unauthorized | Authentication required or failed | Missing/invalid/expired token |
| `403` | Forbidden | Authenticated but insufficient permissions | No access to resource |
| `404` | Not Found | Resource does not exist | Invalid resource ID |
| `415` | Unsupported Media Type | Request body is not JSON | Body sent without `Content-Type: application/json` (or `application/*+json`) |
| `422` | Unprocessable Entity | Validation errors or business rule violations | Invalid input data |
| `500` | Internal Server Error | Server error occurred | Unexpected server-side errors |
| `503` | Service Unavailable | Service temporarily unavailable | Maintenance or overload |

## API Response Format

All API responses follow a consistent format:

### Success Response

```json
{
  "success": true,
  "message": "Human-readable success message",
  "data": {
    // Response data
  },
  "errors": null
}
```

### Error Response

```json
{
  "success": false,
  "message": "Human-readable error message",
  "data": null,
  "errors": [
    "Field-specific error 1",
    "Field-specific error 2"
  ]
}
```

## Error Categories & Messages

### Authentication Errors (401 Unauthorized)

Occur when user authentication fails or token is invalid.

| Message | Description | Scenario |
|---------|-------------|----------|
| `Unauthorized - Invalid or expired token` | Token is missing, invalid, or expired | Token validation failed |
| `Unauthorized - Session expired` | User session has expired | Token TTL exceeded |
| `Could not validate credentials` | Credentials validation failed | Invalid auth header format |
| `User not activated` | User account not activated | Account pending activation |

**Client Action**: Redirect to login/re-authenticate

---

### Authorization Errors (403 Forbidden)

Occur when user lacks permissions for the requested operation.

| Message | Description | Scenario |
|---------|-------------|----------|
| `Access denied` | User lacks access to resource | Non-owner accessing private resource |
| `Admin access required` | Admin/owner role required | Regular member attempting admin action |
| `Access denied - Insufficient permissions` | Insufficient role permissions | Member trying to manage project |
| `Cannot remove last admin` | Cannot remove only remaining admin | Attempting to remove sole admin |
| `Cannot leave as last admin` | Cannot leave project as last admin | Sole admin leaving project |

**Client Action**: Show permission denied error, restrict UI options

---

### Resource Not Found Errors (404 Not Found)

Occur when requested resource doesn't exist.

| Resource | Message | Scenario |
|----------|---------|----------|
| User | `User not found` | Invalid user ID |
| Meeting | `Meeting not found` | Invalid meeting ID or deleted |
| Project | `Project not found` | Invalid project ID or deleted |
| File | `File not found` | Audio file, document, or attachment missing |
| Transcript | `Transcript not found` | Invalid transcript ID |
| Note | `Note not found` | Meeting note doesn't exist |
| Task | `Task not found` | Meeting item/task doesn't exist |
| Conversation | `Conversation not found` | Chat conversation invalid/deleted |
| Notification | `Notification not found` | Invalid notification ID |

**Client Action**: Show 404 page or redirect to list view

---

### Validation Errors (400/422 Bad Request)

Occur when input validation fails or business rules violated.

#### Email Validation

| Message | Description | Fix |
|---------|-------------|-----|
| `Invalid email format: {emails}` | Email addresses malformed | Use valid email format (<user@domain.com>) |
| `Email is already registered` | Email already exists | Use different email or login |

#### Password Validation

| Message | Description | Fix |
|---------|-------------|-----|
| `Password must be at least 8 characters long` | Password too short | Use 8+ characters |
| `Password must not exceed 128 characters` | Password too long | Use fewer characters |
| `Password must contain at least one uppercase letter` | Missing uppercase | Add A-Z |
| `Password must contain at least one lowercase letter` | Missing lowercase | Add a-z |
| `Password must contain at least one digit` | Missing number | Add 0-9 |
| `Password must contain at least one special character` | Missing special char | Add !@#$%^&* etc |
| `Passwords do not match` | Confirmation mismatch | Ensure passwords match |
| `Current password is incorrect` | Wrong current password | Enter correct password |

#### Project Validation

| Message | Description | Fix |
|---------|-------------|-----|
| `Project name is required` | Missing project name | Provide project name (1-255 chars) |
| `Project name must be 1-255 characters` | Name length invalid | Use 1-255 characters |
| `Project description must be at most 5000 characters` | Description too long | Use ≤5000 characters |

#### Meeting Validation

| Message | Description | Fix |
|---------|-------------|-----|
| `Meeting title is required` | Missing title | Provide meeting title |
| `Meeting type is invalid` | Invalid meeting type | Use valid type (online/hybrid/offline) |
| `Start time must be before end time` | Invalid time range | Set start before end |
| `Meeting date cannot be in the past` | Past meeting date | Use future date |

#### File Validation

| Message | Description | Fix |
|---------|-------------|-----|
| `File size exceeds maximum allowed` | File too large | Use smaller file |
| `Unsupported file type` | Invalid file format | Use supported format |
| `Empty file content` | No file data | Upload non-empty file |

#### Message Validation

| Message | Description | Fix |
|---------|-------------|-----|
| `Message content cannot be empty` | Empty message | Provide message content |
| `Message content exceeds maximum length` | Too many characters | Keep message concise |

#### Request Body Validation

| Code | HTTP | Message | Description | Fix |
|------|------|---------|-------------|-----|
| `VAL_INVALID_REQUEST` | 400 | `Request body is required` / `Malformed JSON body` | Missing or unparsable JSON body | Send a valid JSON body |
| `VAL_UNSUPPORTED_MEDIA_TYPE` | 415 | `Content-Type must be application/json` | Non-empty body without a JSON content type (`application/json`, optional `; charset=...`, or `application/*+json`). CSRF hardening: cross-site "simple" requests (`text/plain`, form, multipart) are rejected before any side effect, so no cookies are set | Send `Content-Type: application/json` |
| `VAL_PAYLOAD_TOO_LARGE` | 413 | `File size exceeds 1MB limit` | Avatar upload larger than 1048576 bytes | Upload a smaller image |
| `RES_USER_NOT_FOUND` | 404 | `User not found` | No user (or, for non-restore operations, no non-deleted user) with that id | Check the id |

#### Bulk Operation Validation

| Message | Description | Fix |
|---------|-------------|-----|
| `user_ids must be a non-empty array` | Empty user list | Provide at least one user |
| `tasks is required and cannot be empty` | Empty task list | Provide at least one task |
| `Invalid int format` | Non-integer ID | Use valid integer IDs |

---

### Business Logic Errors (422 Unprocessable Entity)

Occur when request violates business rules even if format is valid.

#### Project Management

| Message | Description | Scenario |
|---------|-------------|----------|
| `Cannot remove all admins from project` | No admins remaining | Prevent removing last admin |
| `Project not member` | User not project member | Accessing without membership |
| `Member already exists` | User already in project | Cannot add duplicate member |
| `Member not found` | User not in project | Invalid member removal |
| `Role already set` | Requesting same role | Cannot request current role |

#### Meeting Management

| Message | Description | Scenario |
|---------|-------------|----------|
| `Meeting already belongs to different project` | Wrong project association | Meeting in another project |
| `Cannot update past meeting` | Past meeting locked | Cannot modify completed meeting |
| `Meeting has no audio` | No transcription source | Cannot transcribe empty meeting |

#### Chat & Conversations

| Message | Description | Scenario |
|---------|-------------|----------|
| `Conversation already has max participants` | Limit exceeded | Too many people added |
| `User already in conversation` | Duplicate membership | Cannot add existing member |

#### File Operations

| Message | Description | Scenario |
|---------|-------------|----------|
| `File not accessible` | Access denied | Outside project/meeting scope |
| `Cannot move file` | Invalid move target | Moving to self or invalid target |

#### Notification Management

| Message | Description | Scenario |
|---------|-------------|----------|
| `TTL must be positive integer` | Invalid TTL | Use positive TTL value |
| `invalid notification type` | Unknown type | Use valid notification type |

---

### Server Errors (500 Internal Server Error)

Indicate unexpected server-side failures requiring investigation.

| Message | Description | Action |
|---------|-------------|--------|
| `Internal server error` | Unexpected exception | Check server logs |
| `Failed to process audio transcription` | Transcription service error | Retry or contact support |
| `Failed to generate meeting notes` | AI service error | Retry or contact support |
| `Failed to upload file to storage` | Storage service error | Retry or contact support |
| `Database connection error` | DB unavailable | Retry after delay |
| `Redis connection error` | Cache service down | Retry after delay |

**Client Action**: Show friendly error message, suggest retry, contact support

---

## Common Error Scenarios & Solutions

### Scenario: User Cannot Login

**Possible Errors:**

- `Unauthorized - Invalid or expired token`
- `Could not validate credentials`

**Solutions:**

1. Check credentials are correct
2. Verify email is registered
3. Check account is activated
4. Clear browser cache
5. Try password reset

### Scenario: User Cannot Access Resource

**Possible Errors:**

- `Access denied` (403)
- `User not found` (404)
- `Access denied - Insufficient permissions` (403)

**Solutions:**

1. Verify user ID or resource ID
2. Check user is project/meeting member
3. Verify user has required role
4. Request admin to grant access
5. Ask for invitation to project

### Scenario: Validation Fails on Form Submission

**Possible Errors:**

- Multiple validation errors in `errors` array
- Error messages specific to fields

**Solutions:**

1. Read error messages carefully
2. Fix each field as indicated
3. Re-submit form
4. Check browser console for details

### Scenario: File Upload Fails

**Possible Errors:**

- `File size exceeds maximum allowed`
- `Unsupported file type`
- `Failed to upload file to storage`

**Solutions:**

1. Check file size (≤50MB typical)
2. Check file type (PDF, Word, MP3, WAV, etc.)
3. Retry upload
4. Contact support if persists

### Scenario: Background Task Takes Too Long

**Possible Info:**

- Response: `202 Accepted` with `task_id`
- Message: Task queued for processing

**What to Do:**

1. Save `task_id` from response
2. Poll `/tasks/{task_id}/status` endpoint
3. Check WebSocket for real-time updates
4. Show progress to user

---

## Error Handling Best Practices

### Frontend Error Handling

```javascript
// Basic error handler
async function handleApiCall(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    
    // Check success flag in response
    if (!response.ok || !data.success) {
      const errorMessage = data.message || 'An error occurred';
      
      // Handle specific errors
      if (response.status === 401) {
        // Redirect to login
        window.location.href = '/login';
      } else if (response.status === 403) {
        // Show permission denied
        showError('You do not have permission to perform this action');
      } else if (response.status === 404) {
        // Show not found
        showError('The requested resource was not found');
      } else if (response.status === 422) {
        // Show validation errors
        const errorsList = data.errors?.join(', ') || errorMessage;
        showError(errorsList);
      } else {
        // Show generic error
        showError(errorMessage);
      }
      
      return null;
    }
    
    return data.data;
    
  } catch (error) {
    console.error('Request failed:', error);
    showError('Network error. Please try again.');
    return null;
  }
}

// Usage
const user = await handleApiCall('/api/v1/users/me');
```

### Error Display Strategy

| Status Code | Display Type | Example |
|------------|--------------|---------|
| 400/422 | Form validation | Show inline field errors or error list |
| 401 | Redirect | Send to login page, show message |
| 403 | Modal/Alert | "You don't have permission for this action" |
| 404 | Page/Modal | Show 404 page or "Not found" message |
| 500 | Retry prompt | "Server error, please try again later" |

### Logging & Monitoring

```javascript
// Log errors for monitoring
function logError(error, context = {}) {
  console.error('API Error:', {
    message: error.message,
    status: error.status,
    responseData: error.data,
    context,
    timestamp: new Date().toISOString()
  });
  
  // Send to error tracking service
  if (window.Sentry) {
    Sentry.captureException(error);
  }
}
```

---

## Webhook Error Responses

When webhooks fail, they receive error responses with appropriate HTTP status codes:

```json
{
  "success": false,
  "message": "Invalid signature",
  "data": null,
  "errors": ["Webhook signature verification failed"]
}
```

**Webhook Retry Logic:**

- Automatic retry: 3 times with exponential backoff
- Retry delays: 5s, 25s, 125s
- Max attempts: 3
- Timeout: 30 seconds per attempt

---

## Rate Limiting

Coming Soon - API rate limiting documentation

---

## Troubleshooting Guide

### "Unauthorized" but token looks valid

- Check token format: Must be `Bearer {token}`
- Verify token not expired: Tokens valid for 24 hours
- Try refreshing token: Use refresh token endpoint
- Clear cached credentials

### "Access denied" but user should have permission

- Verify user role in resource (admin/member/owner)
- Check if user was recently added (might be pending)
- Verify project memberships
- Ask admin to verify permissions

### Intermittent "Internal server error"

- Check if service is under maintenance
- Verify network connection
- Wait and retry (might be temporary)
- Check system status page

### File upload hangs

- Check file size (large files take time)
- Verify internet connection
- Try uploading smaller file first
- Contact support if very large files

---

## API Response Examples by Scenario

### Successful Get Request

```
GET /api/v1/users/me
Authorization: Bearer eyJhbGc...

HTTP/1.1 200 OK
{
  "success": true,
  "message": "User retrieved successfully",
  "data": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe"
  },
  "errors": null
}
```

### Validation Error

```
POST /api/v1/projects
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "name": ""
}

HTTP/1.1 422 Unprocessable Entity
{
  "success": false,
  "message": "Validation failed",
  "data": null,
  "errors": [
    "Project name is required",
    "Project name must be 1-255 characters"
  ]
}
```

### Authentication Error

```
GET /api/v1/meetings

HTTP/1.1 401 Unauthorized
{
  "success": false,
  "message": "Unauthorized - Invalid or expired token",
  "data": null,
  "errors": null
}
```

### Permission Error

```
DELETE /api/v1/projects/1
Authorization: Bearer eyJhbGc... (regular member token)

HTTP/1.1 403 Forbidden
{
  "success": false,
  "message": "Admin access required",
  "data": null,
  "errors": null
}
```

### Resource Not Found

```
GET /api/v1/meetings/999

HTTP/1.1 404 Not Found
{
  "success": false,
  "message": "Meeting not found",
  "data": null,
  "errors": null
}
```

### Async Task Accepted

```
POST /api/v1/meetings/1/notes/generate
Authorization: Bearer eyJhbGc...

HTTP/1.1 202 Accepted
{
  "success": true,
  "message": "Note generation started",
  "data": {
    "task_id": "abc123def456",
    "status": "queued"
  },
  "errors": null
}
```

---

## Support

For questions or issues with error handling:

- **Documentation**: Check [API Reference](./README.md)
- **Issues**: Report bugs on GitHub Issues
- **Support**: Contact <support@example.com>
- **Status Page**: Check [status.example.com](https://status.example.com)

---

**Last Updated**: March 31, 2026  
**Version**: 1.0.0  
**Maintained By**: Backend API Team
