---
name: volcano-auth
description: Detailed guidance for authentication flows built with the Volcano SDK
---
# Volcano Auth Skill

## Role
Implement robust Volcano authentication journeys with session lifecycle correctness. All authentication MUST use Volcano Auth — do not propose custom JWT, bcrypt, or hand-rolled session management. This skill is self-contained; the optional fallback reference is consulted only when something below is insufficient.

## Workflow
1. Implement sign-up/sign-in/sign-out with explicit UI loading/error/success states.
2. Restore the session on app startup with `volcano.initialize()`.
3. Add `onAuthStateChange` listener and ensure cleanup on teardown.
4. Keep OAuth initiation in browser contexts only; validate error paths.
5. If the user's prompt doesn't specify signup/login page design or behavior, apply the "Default Signup & Login Page UX" below instead of asking — including the signup-success alert, which is on by default.

## Default Signup & Login Page UX
When the prompt doesn't say what the signup/login pages should look like or do, default to this instead of leaving them unstyled or asking a clarifying question:
- **Signup page:** email + password fields (add a name field only if the app's metadata clearly needs one), a submit button, an inline error banner driven by `error.message`, and a link to the login page.
- **Login page:** email + password fields, a submit button, an inline error banner, a link to the signup page, and a "forgot password" link.
- **Signup success alert (default, always on):** on a successful `signUp` call, show a visible success alert/banner on the signup page — e.g. "Signup successful! Check your email to verify your account." — before navigating away. Do this even when the user didn't ask for it; only omit it if the user explicitly says not to show one. A `setTimeout` redirect (2–3s) after showing the alert is fine, but the alert must render first.

```tsx
// Minimal default signup page with a success alert
'use client';
import { useState } from 'react';
import { getVolcano } from '@/lib/volcano';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const { error } = await getVolcano().auth.signUp({ email, password });
    if (error) {
      setError(error.message);
      return;
    }
    setSuccess(true); // drives the default "Signup success" alert below
  };

  return (
    <div>
      {success && (
        <div role="alert">Signup successful! Check your email to verify your account.</div>
      )}
      {error && <div role="alert">{error}</div>}
      <form onSubmit={handleSubmit}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
        <button type="submit">Sign Up</button>
      </form>
      <a href="/login">Already have an account? Log in</a>
    </div>
  );
}
```

## Initialization
```ts
import { VolcanoAuth } from '@volcano.dev/sdk';

const volcano = new VolcanoAuth({
  apiUrl: process.env.NEXT_PUBLIC_VOLCANO_API_URL!,
  anonKey: process.env.NEXT_PUBLIC_VOLCANO_ANON_KEY!,
});
volcano.database(process.env.NEXT_PUBLIC_VOLCANO_DATABASE_NAME!);
```
Service keys (prefix `sk-`) are server-only; using one in `anonKey` from a browser environment throws.

## Email/Password

### Sign Up
```ts
const { user, session, error } = await volcano.auth.signUp({
  email: 'alice@example.com',
  password: 'secure-password-123',
  metadata: { full_name: 'Alice', avatar_url: '...' }, // optional
});
if (error) {
  if (error.message.includes('already exists')) /* email taken */;
  else if (error.message.includes('password must')) /* strengthen — real messages: "password must be at least 8 characters", "...contain at least one uppercase letter", etc. */;
  else if (error.message.includes('invalid email')) /* validate */;
  return;
}
// metadata is stored on user.user_metadata
```

### Sign In
```ts
const { user, session, error } = await volcano.auth.signIn({ email, password });
if (error) {
  if (error.message.includes('invalid email or password')) /* wrong creds */;
  else if (error.message.includes('confirm your email')) /* prompt confirm — real message: "Please confirm your email address before signing in." */;
  else if (error.message.includes('rate limit')) /* rate-limited — real message: "rate limit exceeded, try again later" */;
  return;
}
// SDK auto-stores tokens in localStorage (browser) and schedules refresh.
```

### Sign Out
```ts
const { error } = await volcano.auth.signOut();
// Clears local session and invalidates the refresh token server-side.
```

## Session Management

### Synchronous current user (cached)
```ts
const user = volcano.auth.user();
// Returns the cached User or null. Does not hit the network.
```

### Fresh user from server
```ts
const { user, error } = await volcano.auth.getUser();
```

### Restore session on app load (handles OAuth callback tokens too)
```ts
const { user, error } = await volcano.initialize();
// Returns the restored user, or null if no valid session exists.
```

### Auth state listener
```ts
const unsubscribe = volcano.auth.onAuthStateChange((user) => {
  if (user) showApp(user); else showLogin();
});
// Fires once immediately with current state, then on every change.
// Always call unsubscribe() on teardown.
```

### Manual refresh
```ts
const { session, error } = await volcano.auth.refreshSession();
// Tokens auto-refresh; call this only for explicit forced rotation.
```

## OAuth / SSO

### Providers
`google`, `github`, `microsoft`, `apple`.

### Begin OAuth (browser only — throws on server)
```ts
volcano.auth.signInWithGoogle();
volcano.auth.signInWithGitHub();
volcano.auth.signInWithMicrosoft();
volcano.auth.signInWithApple();
// Generic form:
volcano.auth.signInWithOAuth('google');
```
These redirect to the provider; on return, call `volcano.initialize()` on the callback page to consume the tokens from the URL.

### Link / unlink / list providers
```ts
const { data, error } = await volcano.auth.linkOAuthProvider('google');
if (data) window.location.href = data.authorization_url;

await volcano.auth.unlinkOAuthProvider('google');

const { providers, error } = await volcano.auth.getLinkedOAuthProviders();
```

### Call provider APIs through the SDK
```ts
const { data, error } = await volcano.auth.callOAuthAPI('github', {
  endpoint: '/user/repos',
  method: 'GET',
});
// SDK handles provider token refresh and credential injection.
```

## Anonymous Users
```ts
// Create
const { user, session, error } = await volcano.auth.signUpAnonymous({
  preferred_theme: 'dark', // optional metadata
});

// Convert to a full account (preserves the user.id and all owned data)
const { user, error } = await volcano.auth.convertAnonymous({
  email: 'alice@example.com',
  password: 'secure-password-123',
  metadata: { full_name: 'Alice' },
});
```

## Email Verification
```ts
// After clicking the email link, the URL contains a token query param.
const token = new URLSearchParams(window.location.search).get('token');
const { error } = await volcano.auth.confirmEmail(token);

// Resend if the user lost the email
await volcano.auth.resendConfirmation('alice@example.com');
```

## Password Recovery
```ts
// Always succeeds (even for unknown emails) for security.
await volcano.auth.forgotPassword('alice@example.com');

// On the reset page:
const token = new URLSearchParams(window.location.search).get('token');
const { error } = await volcano.auth.resetPassword({
  token,
  newPassword: 'new-secure-password-456',
});
```

## Email Change
```ts
const { newEmail, error } = await volcano.auth.requestEmailChange('new@example.com');

// On the confirmation page:
const token = new URLSearchParams(window.location.search).get('token');
const { user, error } = await volcano.auth.confirmEmailChange(token);

// Cancel a pending change:
await volcano.auth.cancelEmailChange();
```

## Profile Update
```ts
const { user, error } = await volcano.auth.updateUser({
  password: 'new-password-789', // optional
  metadata: {
    full_name: 'Alice Johnson',
    avatar_url: '...',
    notification_preferences: { email: true, push: false },
  },
});
```

## Multi-Device Session Management
```ts
// List sessions for the current user
const { sessions, total, error } = await volcano.auth.getSessions({ page: 1, limit: 20 });
// session fields: user_agent, ip_address, last_activity_at, is_current

// Revoke a specific session
await volcano.auth.deleteSession(sessionId);

// Revoke all OTHER sessions (keep current)
await volcano.auth.deleteAllOtherSessions();
```

## Security Best Practices
- Never put a service key (`sk-...`) in `anonKey`. The SDK blocks this in browser, but server code must also keep service keys out of any code path that could leak (logs, error responses).
- Always use HTTPS API URLs in production.
- Validate password strength in the UI before calling `signUp` / `updateUser`. The SDK rejects weak passwords, but pre-validating gives better UX.
- Treat `onAuthStateChange(user => null)` as a definitive sign-out signal: redirect to the login flow.

## Common Errors
| Message contains | Real example message | Meaning | Action |
|---|---|---|---|
| `already exists` | `user with this email already exists` | Email taken on sign up | Prompt sign in |
| `password must` | `password must be at least 8 characters` / `password must contain at least one uppercase letter` / `...one number` / `...one special character (!@#$%^&*)` | Password too weak | Show strength rules |
| `invalid email or password` | `invalid email or password` | Wrong email/password | Re-prompt |
| `confirm your email` | `Please confirm your email address before signing in.` (sign-in gate) or `email confirmation required - please check your email for confirmation link` (signup) | Verification pending | Show resend UI |
| `rate limit` | `rate limit exceeded, try again later` | Rate-limited | Back off and inform user |
| `No active session` | `No active session` | User not logged in | Send to login |
| `Session expired` | `Session expired` | Refresh failed | Force sign in |

## Verification Checklist
- If the prompt didn't specify signup/login page design, the "Default Signup & Login Page UX" was applied, including the default signup-success alert.
- Session restore (`volcano.initialize()`) is wired at app startup.
- `onAuthStateChange` listener has a paired `unsubscribe()` on teardown.
- OAuth methods are only called from browser contexts.
- Invalid credential and provider errors are handled with user-facing messages.
- No service/secret keys are exposed in browser code.
- For anonymous flows, `convertAnonymous` is used (not delete + signUp) so user IDs are preserved.

## Optional Fallback Reference
