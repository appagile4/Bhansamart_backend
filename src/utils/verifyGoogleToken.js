/**
 * Cryptographically verifies Google OAuth ID Token via Google's Official Tokeninfo Endpoint.
 * Validates issuer, audience, expiration, and email verification status.
 */

const ALLOWED_CLIENT_IDS = [
  // Android Client ID
  "885243883462-eevrcd81b7fpv375elbelgbcotpfklpf.apps.googleusercontent.com",
  // iOS Client ID
  "885243883462-efbupk52oumnfo5udjg735rv1nqr197f.apps.googleusercontent.com",
  // Environment overrides
  process.env.GOOGLE_CLIENT_ID_ANDROID,
  process.env.GOOGLE_CLIENT_ID_IOS,
  process.env.GOOGLE_CLIENT_ID_WEB,
  process.env.GOOGLE_CLIENT_ID,
].filter(Boolean);

export const verifyGoogleIdToken = async (idToken) => {
  if (!idToken || typeof idToken !== "string") {
    throw new Error("Missing or invalid Google ID Token.");
  }

  const endpoint = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken.trim())}`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.error_description || "Google ID token validation failed."
    );
  }

  const payload = await response.json();

  // 1. Verify issuer
  const validIssuers = ["accounts.google.com", "https://accounts.google.com"];
  if (!validIssuers.includes(payload.iss)) {
    throw new Error("Invalid Google token issuer.");
  }

  // 2. Verify audience / client ID
  // Check if aud matches any configured client IDs or belongs to the BhansaMart project (885243883462)
  const isAudienceValid =
    ALLOWED_CLIENT_IDS.includes(payload.aud) ||
    (typeof payload.aud === "string" && payload.aud.startsWith("885243883462"));

  if (!isAudienceValid) {
    throw new Error("Google token audience does not match BhansaMart Client IDs.");
  }

  // 3. Verify expiration
  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (Number(payload.exp) < currentTimestamp) {
    throw new Error("Google ID token has expired. Please sign in again.");
  }

  // 4. Verify email verification status
  const emailVerified =
    payload.email_verified === "true" || payload.email_verified === true;
  if (!emailVerified) {
    throw new Error("Your Google email address is not verified by Google.");
  }

  return {
    email: payload.email.toLowerCase().trim(),
    name: payload.name || payload.given_name || "Customer",
    picture: payload.picture || "",
    googleId: payload.sub,
    emailVerified: true,
  };
};
